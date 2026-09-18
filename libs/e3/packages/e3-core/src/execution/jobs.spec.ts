/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The jobs budget (issue #770): a first-come-first-served slot semaphore, and
 * the default budget read from the CPUs available to the process.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JobSlots, cgroupCpuQuota, defaultJobs } from './jobs.js';

describe('JobSlots', () => {
  it('hands out at most its capacity, first come first served', async () => {
    const jobs = new JobSlots(2);
    const order: string[] = [];
    const first = await jobs.acquire();
    const second = await jobs.acquire();
    assert.equal(jobs.inFlight, 2);
    // The third and fourth wait, in order.
    const third = jobs.acquire().then((release) => { order.push('third'); return release; });
    const fourth = jobs.acquire().then((release) => { order.push('fourth'); return release; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(jobs.queued, 2);
    assert.deepEqual(order, []);
    first();
    const releaseThird = await third;
    assert.deepEqual(order, ['third']);
    assert.equal(jobs.inFlight, 2);
    assert.equal(jobs.queued, 1);
    second();
    await fourth;
    assert.deepEqual(order, ['third', 'fourth']);
    assert.equal(jobs.peak, 2);
    // A release is idempotent.
    releaseThird();
    releaseThird();
    assert.equal(jobs.inFlight, 1);
  });

  it('withdraws a waiting acquisition when its signal aborts, and refuses an aborted one outright', async () => {
    const jobs = new JobSlots(1);
    const release = await jobs.acquire();
    const abort = new AbortController();
    const waiting = jobs.acquire(abort.signal);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(jobs.queued, 1);
    abort.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
    assert.equal(jobs.queued, 0, 'the withdrawn acquisition holds no place in the queue');
    // The slot is still held by the first acquisition; the next in line gets it.
    const next = jobs.acquire();
    release();
    (await next)();
    await assert.rejects(jobs.acquire(abort.signal), { name: 'AbortError' });
    assert.equal(jobs.inFlight, 0);
  });

  it('keeps its invariants under a seeded storm of acquisitions, releases and aborts', async () => {
    // A deterministic pseudo-random interleaving of the three operations,
    // checked after every step: never more than the capacity in flight,
    // every grant goes to the earliest waiter still in the queue, an aborted
    // waiter never holds a slot, and the budget drains to nothing.
    let seed = 0x2545f491;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const capacity = 3;
    const jobs = new JobSlots(capacity);
    const held: (() => void)[] = [];
    // Waiters in acquisition order; a granted or aborted one leaves the list.
    const waiters: { id: number; granted: boolean; aborted: boolean; controller: AbortController | null; promise: Promise<void> }[] = [];
    const grants: number[] = [];
    let nextId = 0;
    const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

    for (let step = 0; step < 400; step++) {
      const roll = rnd();
      if (roll < 0.5) {
        // Acquire, with a signal half the time.
        const id = nextId++;
        const controller = rnd() < 0.5 ? new AbortController() : null;
        const waiter = { id, granted: false, aborted: false, controller, promise: Promise.resolve() };
        waiter.promise = jobs.acquire(controller?.signal).then((release) => {
          waiter.granted = true;
          grants.push(id);
          held.push(release);
        }, (err: Error) => {
          assert.equal(err.name, 'AbortError');
          waiter.aborted = true;
        });
        waiters.push(waiter);
      } else if (roll < 0.8 && held.length > 0) {
        // Release a random held slot.
        held.splice(Math.floor(rnd() * held.length), 1)[0]!();
      } else {
        // Abort a random waiter that still waits.
        const pending = waiters.filter((w) => !w.granted && !w.aborted && w.controller !== null && !w.controller.signal.aborted);
        if (pending.length > 0) pending[Math.floor(rnd() * pending.length)]!.controller!.abort();
      }
      await settle();
      assert.ok(jobs.inFlight <= capacity, `in flight ${jobs.inFlight} > ${capacity} at step ${step}`);
      assert.equal(jobs.inFlight, held.length, 'every slot held is one a caller holds');
      // FIFO: the waiters granted so far are exactly the earliest of those not aborted.
      const outstanding = waiters.filter((w) => !w.aborted);
      const grantedIds = outstanding.filter((w) => w.granted).map((w) => w.id);
      assert.deepEqual(grantedIds, outstanding.slice(0, grantedIds.length).map((w) => w.id), `grants out of order at step ${step}`);
      assert.equal(jobs.queued, outstanding.length - grantedIds.length, `queue length at step ${step}`);
      for (const w of waiters) if (w.aborted) assert.equal(w.granted, false, 'an aborted waiter never holds a slot');
    }
    // Drain: release everything, and every remaining waiter gets its turn.
    while (held.length > 0 || jobs.queued > 0) {
      while (held.length > 0) held.pop()!();
      await settle();
    }
    await Promise.all(waiters.map((w) => w.promise));
    assert.equal(jobs.inFlight, 0);
    assert.equal(jobs.queued, 0);
    assert.ok(jobs.peak <= capacity);
    assert.ok(waiters.some((w) => w.aborted) && grants.length > capacity, 'the storm exercised aborts and queueing');
  });

  it('refuses a capacity that is not a positive integer', () => {
    for (const capacity of [0, -1, 1.5, NaN]) {
      assert.throws(() => new JobSlots(capacity), RangeError);
    }
  });
});

describe('the default jobs budget', () => {
  it('is at least one CPU', () => {
    assert.ok(defaultJobs() >= 1);
  });

  it('caps by the tightest cgroup v2 CPU quota up the hierarchy', () => {
    const files = (entries: Record<string, string>) => (path: string): string | null => entries[path] ?? null;
    // No quota anywhere: no cap.
    assert.equal(cgroupCpuQuota(files({ '/proc/self/cgroup': '0::/a/b\n', '/sys/fs/cgroup/a/b/cpu.max': 'max 100000\n' })), null);
    // A quota at the leaf, 1.5 CPUs, rounds up.
    assert.equal(cgroupCpuQuota(files({ '/proc/self/cgroup': '0::/a/b\n', '/sys/fs/cgroup/a/b/cpu.max': '150000 100000\n' })), 2);
    // A tighter quota on an ancestor wins.
    assert.equal(cgroupCpuQuota(files({
      '/proc/self/cgroup': '0::/a/b\n',
      '/sys/fs/cgroup/a/b/cpu.max': '400000 100000\n',
      '/sys/fs/cgroup/a/cpu.max': '200000 100000\n',
    })), 2);
    // The root cgroup, and a process cgroup v2 does not describe.
    assert.equal(cgroupCpuQuota(files({ '/proc/self/cgroup': '0::/\n' })), null);
    assert.equal(cgroupCpuQuota(files({ '/proc/self/cgroup': '12:cpu,cpuacct:/\n' })), null);
    assert.equal(cgroupCpuQuota(files({})), null);
  });
});
