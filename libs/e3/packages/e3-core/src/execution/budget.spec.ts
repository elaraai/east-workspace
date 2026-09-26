/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The budget of an e3 process: cores and memory handed out to runner
 * processes, the default capacity read from the machine, and the settings a
 * person gives.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { availableParallelism, totalmem } from 'node:os';
import {
  Budget,
  UNIT_MAX_THREADS,
  cgroupCpuQuota,
  cgroupMemoryMax,
  defaultCores,
  defaultMemory,
  parseMemory,
  resolveBudget,
  unitThreads,
} from './budget.js';

const GiB = 1024 ** 3;

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('Budget', () => {
  it('hands out its cores first come first served', async () => {
    const budget = new Budget({ cores: 2, memory: GiB });
    const order: string[] = [];
    const first = await budget.acquire();
    const second = await budget.acquire();
    assert.equal(budget.inFlight, 2);
    // The third and fourth wait, in order.
    const third = budget.acquire().then((release) => { order.push('third'); return release; });
    const fourth = budget.acquire().then((release) => { order.push('fourth'); return release; });
    await settle();
    assert.equal(budget.queued, 2);
    assert.deepEqual(order, []);
    first();
    const releaseThird = await third;
    assert.deepEqual(order, ['third']);
    assert.equal(budget.inFlight, 2);
    assert.equal(budget.queued, 1);
    second();
    await fourth;
    assert.deepEqual(order, ['third', 'fourth']);
    assert.equal(budget.peak, 2);
    // A release is idempotent.
    releaseThird();
    releaseThird();
    assert.equal(budget.inFlight, 1);
  });

  it('withdraws a waiting request when its signal aborts, and refuses an aborted one outright', async () => {
    const budget = new Budget({ cores: 1, memory: GiB });
    const release = await budget.acquire();
    const abort = new AbortController();
    const waiting = budget.acquire({ signal: abort.signal });
    await settle();
    assert.equal(budget.queued, 1);
    abort.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
    assert.equal(budget.queued, 0, 'the withdrawn request holds no place in the queue');
    // The core is still held by the first request; the next in line gets it.
    const next = budget.acquire();
    release();
    (await next)();
    await assert.rejects(budget.acquire({ signal: abort.signal }), { name: 'AbortError' });
    assert.equal(budget.inFlight, 0);
  });

  it('keeps its invariants under a seeded storm of requests, releases and aborts', async () => {
    // A deterministic pseudo-random interleaving of the three operations,
    // checked after every step: never more than the cores in flight, every
    // grant goes to the earliest waiter still in the queue, an aborted waiter
    // never holds a core, and the budget drains to nothing.
    let seed = 0x2545f491;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const cores = 3;
    const budget = new Budget({ cores, memory: GiB });
    const held: (() => void)[] = [];
    // Waiters in request order; a granted or aborted one leaves the list.
    const waiters: { id: number; granted: boolean; aborted: boolean; controller: AbortController | null; promise: Promise<void> }[] = [];
    const grants: number[] = [];
    let nextId = 0;

    for (let step = 0; step < 400; step++) {
      const roll = rnd();
      if (roll < 0.5) {
        // Request, with a signal half the time.
        const id = nextId++;
        const controller = rnd() < 0.5 ? new AbortController() : null;
        const waiter = { id, granted: false, aborted: false, controller, promise: Promise.resolve() };
        waiter.promise = budget.acquire({ signal: controller?.signal }).then((release) => {
          waiter.granted = true;
          grants.push(id);
          held.push(release);
        }, (err: Error) => {
          assert.equal(err.name, 'AbortError');
          waiter.aborted = true;
        });
        waiters.push(waiter);
      } else if (roll < 0.8 && held.length > 0) {
        // Release a random held grant.
        held.splice(Math.floor(rnd() * held.length), 1)[0]!();
      } else {
        // Abort a random waiter that still waits.
        const pending = waiters.filter((w) => !w.granted && !w.aborted && w.controller !== null && !w.controller.signal.aborted);
        if (pending.length > 0) pending[Math.floor(rnd() * pending.length)]!.controller!.abort();
      }
      await settle();
      assert.ok(budget.inFlight <= cores, `in flight ${budget.inFlight} > ${cores} at step ${step}`);
      assert.equal(budget.inFlight, held.length, 'every grant held is one a caller holds');
      // FIFO: the waiters granted so far are exactly the earliest of those not aborted.
      const outstanding = waiters.filter((w) => !w.aborted);
      const grantedIds = outstanding.filter((w) => w.granted).map((w) => w.id);
      assert.deepEqual(grantedIds, outstanding.slice(0, grantedIds.length).map((w) => w.id), `grants out of order at step ${step}`);
      assert.equal(budget.queued, outstanding.length - grantedIds.length, `queue length at step ${step}`);
      for (const w of waiters) if (w.aborted) assert.equal(w.granted, false, 'an aborted waiter never holds a core');
    }
    // Drain: release everything, and every remaining waiter gets its turn.
    while (held.length > 0 || budget.queued > 0) {
      while (held.length > 0) held.pop()!();
      await settle();
    }
    await Promise.all(waiters.map((w) => w.promise));
    assert.equal(budget.inFlight, 0);
    assert.equal(budget.queued, 0);
    assert.ok(budget.peak <= cores);
    assert.ok(waiters.some((w) => w.aborted) && grants.length > cores, 'the storm exercised aborts and queueing');
  });

  it('admits by memory too: a request that does not fit lets later ones that do pass', async () => {
    const budget = new Budget({ cores: 4, memory: 100 });
    const a = await budget.acquire({ memory: 60 });
    const order: string[] = [];
    const b = budget.acquire({ memory: 60 }).then((release) => { order.push('b'); return release; });
    const c = await budget.acquire({ memory: 30 });
    const d = budget.acquire({ memory: 20 }).then((release) => { order.push('d'); return release; });
    await settle();
    assert.deepEqual(order, [], 'b does not fit beside a, and d not beside a and c');
    assert.equal(budget.reserved, 90);
    assert.equal(budget.inFlight, 2);
    assert.equal(budget.queued, 2);
    a();
    await b;
    await settle();
    assert.deepEqual(order, ['b'], 'b fits once a is gone; d still does not');
    assert.equal(budget.reserved, 90);
    c();
    await d;
    assert.deepEqual(order, ['b', 'd']);
    assert.equal(budget.reserved, 80);
  });

  it('holds the line once the first request that does not fit has waited the bypass time', async () => {
    const budget = new Budget({ cores: 4, memory: 100 }, { bypassMs: 20 });
    const a = await budget.acquire({ memory: 60 });
    const order: string[] = [];
    const b = budget.acquire({ memory: 60 }).then((release) => { order.push('b'); return release; });
    await sleep(40);
    const c = budget.acquire({ memory: 10 }).then((release) => { order.push('c'); return release; });
    await settle();
    assert.deepEqual(order, [], 'c fits, but b has waited its time and holds the line');
    assert.equal(budget.queued, 2);
    a();
    await Promise.all([b, c]);
    assert.deepEqual(order, ['b', 'c']);
    assert.equal(budget.reserved, 70);
  });

  it('runs a request larger than the whole budget alone', async () => {
    const budget = new Budget({ cores: 4, memory: 100 }, { bypassMs: 20 });
    const a = await budget.acquire({ memory: 10 });
    const order: string[] = [];
    const x = budget.acquire({ memory: 150 }).then((release) => { order.push('x'); return release; });
    const b = await budget.acquire({ memory: 10 });
    await sleep(40);
    const c = budget.acquire().then((release) => { order.push('c'); return release; });
    await settle();
    assert.deepEqual(order, [], 'x waits for the budget to empty, and c behind it once x has waited its time');
    a();
    b();
    const releaseX = await x;
    await settle();
    assert.deepEqual(order, ['x'], 'nothing starts beside x');
    assert.equal(budget.inFlight, 1);
    assert.equal(budget.reserved, 100, 'x holds the whole budget');
    releaseX();
    await c;
    assert.deepEqual(order, ['x', 'c']);
    assert.equal(budget.reserved, 0);
  });

  it('refuses a capacity that is not positive, and a request for negative memory', async () => {
    for (const cores of [0, -1, 1.5, NaN]) {
      assert.throws(() => new Budget({ cores, memory: GiB }), RangeError);
    }
    for (const memory of [0, -1, NaN, Infinity]) {
      assert.throws(() => new Budget({ cores: 1, memory }), RangeError);
    }
    await assert.rejects(new Budget({ cores: 1, memory: GiB }).acquire({ memory: -1 }), RangeError);
  });
});

describe("a unit's threads", () => {
  it('are at most four, and no more than the budget has cores', () => {
    assert.equal(unitThreads(new Budget({ cores: 16, memory: GiB })), UNIT_MAX_THREADS);
    assert.equal(unitThreads(new Budget({ cores: 2, memory: GiB })), 2);
    assert.equal(unitThreads(undefined), Math.min(UNIT_MAX_THREADS, availableParallelism()));
  });
});

describe('the default budget', () => {
  const files = (entries: Record<string, string>) => (path: string): string | null => entries[path] ?? null;

  it('is at least one core, and some of the memory', () => {
    assert.ok(defaultCores() >= 1);
    assert.ok(defaultMemory() > 0 && defaultMemory() <= totalmem());
  });

  it('caps the cores by the tightest cgroup v2 CPU quota up the hierarchy', () => {
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

  it('caps the memory by the tightest cgroup v2 memory.max up the hierarchy', () => {
    assert.equal(cgroupMemoryMax(files({ '/proc/self/cgroup': '0::/a/b\n', '/sys/fs/cgroup/a/b/memory.max': 'max\n' })), null);
    assert.equal(cgroupMemoryMax(files({ '/proc/self/cgroup': '0::/a/b\n', '/sys/fs/cgroup/a/b/memory.max': `${4 * GiB}\n` })), 4 * GiB);
    // A tighter limit on an ancestor wins, whatever the leaf says.
    assert.equal(cgroupMemoryMax(files({
      '/proc/self/cgroup': '0::/a/b\n',
      '/sys/fs/cgroup/a/b/memory.max': 'max\n',
      '/sys/fs/cgroup/a/memory.max': `${2 * GiB}\n`,
      '/sys/fs/cgroup/memory.max': `${8 * GiB}\n`,
    })), 2 * GiB);
    assert.equal(cgroupMemoryMax(files({ '/proc/self/cgroup': '12:memory:/\n' })), null);
    assert.equal(cgroupMemoryMax(files({})), null);
  });
});

describe('memory sizes', () => {
  it('reads bytes, and K, M, G and T in binary units', () => {
    assert.equal(parseMemory('100'), 100);
    assert.equal(parseMemory('100b'), 100);
    assert.equal(parseMemory('512M'), 512 * 1024 ** 2);
    assert.equal(parseMemory('8G'), 8 * GiB);
    assert.equal(parseMemory('8gb'), 8 * GiB);
    assert.equal(parseMemory('1.5GiB'), 1.5 * GiB);
    assert.equal(parseMemory(' 2 T '), 2 * 1024 ** 4);
  });

  it('refuses what is not a positive size', () => {
    for (const text of ['', 'x', '8X', '-1G', '0', '0.1b', 'G']) {
      assert.equal(parseMemory(text), null, text);
    }
  });
});

describe('resolveBudget', () => {
  it('takes a flag over the environment, and the environment over the machine', () => {
    assert.equal(resolveBudget({ jobs: '3', memory: '2G' }, { E3_JOBS: '5', E3_MEMORY: '1G' }).cores, 3);
    assert.equal(resolveBudget({ jobs: '3', memory: '2G' }, { E3_JOBS: '5', E3_MEMORY: '1G' }).memory, 2 * GiB);
    assert.equal(resolveBudget({}, { E3_JOBS: '5', E3_MEMORY: '1G' }).cores, 5);
    assert.equal(resolveBudget({}, { E3_JOBS: '5', E3_MEMORY: '1G' }).memory, GiB);
    const machine = resolveBudget({}, { E3_JOBS: '', E3_MEMORY: '' });
    assert.equal(machine.cores, defaultCores());
    assert.equal(machine.memory, defaultMemory());
  });

  it('names the flag or variable a bad value came from', () => {
    assert.throws(() => resolveBudget({ jobs: 'x' }, {}), { name: 'RangeError', message: "--jobs must be a positive integer, got 'x'" });
    assert.throws(() => resolveBudget({}, { E3_JOBS: '0' }), { name: 'RangeError', message: "E3_JOBS must be a positive integer, got '0'" });
    assert.throws(() => resolveBudget({ memory: 'lots' }, {}), { name: 'RangeError', message: /^--memory must be a size in bytes/ });
    assert.throws(() => resolveBudget({}, { E3_MEMORY: '-1G' }), { name: 'RangeError', message: /^E3_MEMORY must be a size in bytes/ });
  });
});
