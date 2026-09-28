/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The budget of an e3 process: cores and memory handed out to runner
 * processes, the guard that watches what they use, the default capacity read
 * from the machine, and the settings a person gives.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { availableParallelism, totalmem } from 'node:os';
import {
  Budget,
  UNIT_MAX_THREADS,
  defaultCores,
  defaultMemory,
  parseMemory,
  resolveBudget,
  unitThreads,
  type Grant,
  type WatchedRunner,
} from './budget.js';
import { cgroupCpuQuota, cgroupMemoryMax } from './cgroups.js';
import type { MachineMemory, MemorySampler } from './memory.js';

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
    const third = budget.acquire().then((grant) => { order.push('third'); return grant; });
    const fourth = budget.acquire().then((grant) => { order.push('fourth'); return grant; });
    await settle();
    assert.equal(budget.queued, 2);
    assert.deepEqual(order, []);
    first.release();
    const thirdGrant = await third;
    assert.deepEqual(order, ['third']);
    assert.equal(budget.inFlight, 2);
    assert.equal(budget.queued, 1);
    second.release();
    await fourth;
    assert.deepEqual(order, ['third', 'fourth']);
    assert.equal(budget.peak, 2);
    // A release is idempotent.
    thirdGrant.release();
    thirdGrant.release();
    assert.equal(budget.inFlight, 1);
  });

  it('tells a request that cannot be granted at once that it waits, once', async () => {
    const budget = new Budget({ cores: 1, memory: GiB });
    let waits = 0;
    const first = await budget.acquire({ onWaiting: () => { waits++; } });
    assert.equal(waits, 0, 'a request granted at once never waits');
    const second = budget.acquire({ onWaiting: () => { waits++; } });
    await settle();
    assert.equal(waits, 1);
    first.release();
    (await second).release();
    assert.equal(waits, 1);
  });

  it('withdraws a waiting request when its signal aborts, and refuses an aborted one outright', async () => {
    const budget = new Budget({ cores: 1, memory: GiB });
    const held = await budget.acquire();
    const abort = new AbortController();
    const waiting = budget.acquire({ signal: abort.signal });
    await settle();
    assert.equal(budget.queued, 1);
    abort.abort();
    await assert.rejects(waiting, { name: 'AbortError' });
    assert.equal(budget.queued, 0, 'the withdrawn request holds no place in the queue');
    // The core is still held by the first request; the next in line gets it.
    const next = budget.acquire();
    held.release();
    (await next).release();
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
    const held: Grant[] = [];
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
        waiter.promise = budget.acquire({ signal: controller?.signal }).then((grant) => {
          waiter.granted = true;
          grants.push(id);
          held.push(grant);
        }, (err: Error) => {
          assert.equal(err.name, 'AbortError');
          waiter.aborted = true;
        });
        waiters.push(waiter);
      } else if (roll < 0.8 && held.length > 0) {
        // Release a random held grant.
        held.splice(Math.floor(rnd() * held.length), 1)[0]!.release();
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
      while (held.length > 0) held.pop()!.release();
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
    const b = budget.acquire({ memory: 60 }).then((grant) => { order.push('b'); return grant; });
    const c = await budget.acquire({ memory: 30 });
    const d = budget.acquire({ memory: 20 }).then((grant) => { order.push('d'); return grant; });
    await settle();
    assert.deepEqual(order, [], 'b does not fit beside a, and d not beside a and c');
    assert.equal(budget.reserved, 90);
    assert.equal(budget.inFlight, 2);
    assert.equal(budget.queued, 2);
    a.release();
    await b;
    await settle();
    assert.deepEqual(order, ['b'], 'b fits once a is gone; d still does not');
    assert.equal(budget.reserved, 90);
    c.release();
    await d;
    assert.deepEqual(order, ['b', 'd']);
    assert.equal(budget.reserved, 80);
  });

  it('holds the line once the first request that does not fit has waited the bypass time', async () => {
    const budget = new Budget({ cores: 4, memory: 100 }, { bypassMs: 20 });
    const a = await budget.acquire({ memory: 60 });
    const order: string[] = [];
    const b = budget.acquire({ memory: 60 }).then((grant) => { order.push('b'); return grant; });
    await sleep(40);
    const c = budget.acquire({ memory: 10 }).then((grant) => { order.push('c'); return grant; });
    await settle();
    assert.deepEqual(order, [], 'c fits, but b has waited its time and holds the line');
    assert.equal(budget.queued, 2);
    a.release();
    await Promise.all([b, c]);
    assert.deepEqual(order, ['b', 'c']);
    assert.equal(budget.reserved, 70);
  });

  it('runs a request larger than the whole budget alone', async () => {
    const budget = new Budget({ cores: 4, memory: 100 }, { bypassMs: 20 });
    const a = await budget.acquire({ memory: 10 });
    const order: string[] = [];
    const x = budget.acquire({ memory: 150 }).then((grant) => { order.push('x'); return grant; });
    const b = await budget.acquire({ memory: 10 });
    await sleep(40);
    const c = budget.acquire().then((grant) => { order.push('c'); return grant; });
    await settle();
    assert.deepEqual(order, [], 'x waits for the budget to empty, and c behind it once x has waited its time');
    a.release();
    b.release();
    const xGrant = await x;
    await settle();
    assert.deepEqual(order, ['x'], 'nothing starts beside x');
    assert.equal(budget.inFlight, 1);
    assert.equal(budget.reserved, 100, 'x holds the whole budget');
    assert.equal(xGrant.alone, true);
    xGrant.release();
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

describe('the guard', () => {
  /** A sampler whose runners use what the test says, on a machine the test
   *  says it is; it counts its measurements. */
  function sampler(): { sampler: MemorySampler; usage: Map<number, number>; machine: { memory: MachineMemory | null }; samples: () => number } {
    const usage = new Map<number, number>();
    const machine: { memory: MachineMemory | null } = { memory: null };
    let samples = 0;
    return {
      sampler: {
        sample: async (runners) => {
          samples++;
          return new Map(runners.filter((runner) => usage.has(runner.pid)).map((runner) => [runner.pid, usage.get(runner.pid)!]));
        },
        machine: async () => machine.memory,
      },
      usage,
      machine,
      samples: () => samples,
    };
  }

  /** A runner that counts the times the guard stopped it. */
  const runner = (pid: number): WatchedRunner & { stops: number } => {
    const watched = { pid, stops: 0, stop: () => { watched.stops++; } };
    return watched;
  };

  it('counts a running grant at the larger of its reservation and what its runner uses', async () => {
    const fake = sampler();
    const budget = new Budget({ cores: 4, memory: 100 }, { sampler: fake.sampler, sampleMs: 0 });
    const a = await budget.acquire({ memory: 10, kind: 'unit' });
    a.watch(runner(1));
    fake.usage.set(1, 70);
    await budget.check();
    assert.equal(budget.used, 70);
    assert.equal(budget.reserved, 10, 'what a grant reserves is unchanged by what it uses');
    const order: string[] = [];
    const b = budget.acquire({ memory: 40 }).then((grant) => { order.push('b'); return grant; });
    await settle();
    assert.deepEqual(order, [], 'b does not fit beside what a uses');
    fake.usage.set(1, 20);
    await budget.check();
    await b;
    assert.deepEqual(order, ['b'], 'b is admitted once a uses less');
    assert.equal(budget.used, 60);
    a.unwatch();
    assert.equal(budget.used, 50, 'a grant whose runner has exited counts at its reservation');
  });

  it('past the budget, stops the most recently started unit, one at a time, and never a task', async () => {
    const fake = sampler();
    const budget = new Budget({ cores: 4, memory: 100 }, { sampler: fake.sampler, sampleMs: 0 });
    const older = await budget.acquire({ kind: 'unit' });
    const task = await budget.acquire({ kind: 'task' });
    const newer = await budget.acquire({ kind: 'unit' });
    const [o, t, n] = [runner(1), runner(2), runner(3)];
    older.watch(o);
    newer.watch(n);
    task.watch(t);
    fake.usage.set(1, 40).set(2, 40).set(3, 40);
    await budget.check();
    assert.deepEqual([o.stops, n.stops, t.stops], [0, 1, 0], 'the unit started last is stopped, though a task started after it');
    assert.deepEqual(newer.stopped, { reason: 'budget', peak: 40 });
    await budget.check();
    assert.deepEqual([o.stops, n.stops], [0, 1], 'nothing more is stopped until the stopped unit\'s grant is released');
    newer.release();
    await budget.check();
    assert.equal(o.stops, 0, 'the budget is not past once the stopped unit has gone');
    fake.usage.set(2, 70);
    await budget.check();
    assert.deepEqual([o.stops, t.stops], [1, 0], 'then the next unit, and still not the task');
    older.release();
    fake.usage.set(2, 150);
    await budget.check();
    assert.equal(t.stops, 0, 'a task past the budget is left running');
    assert.equal(task.stopped, null);
  });

  it('never stops a unit running alone for the budget, which it holds whole', async () => {
    const fake = sampler();
    const budget = new Budget({ cores: 2, memory: 100 }, { sampler: fake.sampler, sampleMs: 0 });
    const alone = await budget.acquire({ memory: 150, kind: 'unit' });
    assert.equal(alone.alone, true);
    const r = runner(1);
    alone.watch(r);
    fake.usage.set(1, 400);
    await budget.check();
    assert.equal(r.stops, 0);
  });

  it('with the machine nearly out of memory, stops the newest unit first, then a task, whatever the budget', async () => {
    const fake = sampler();
    const budget = new Budget({ cores: 4, memory: 1000 }, { sampler: fake.sampler, sampleMs: 0 });
    const unit = await budget.acquire({ kind: 'unit' });
    const task = await budget.acquire({ kind: 'task' });
    const [u, t] = [runner(1), runner(2)];
    unit.watch(u);
    task.watch(t);
    fake.usage.set(1, 10).set(2, 10);
    fake.machine.memory = { available: 6, total: 100 };
    await budget.check();
    assert.deepEqual([u.stops, t.stops], [0, 0], 'with 6% of the machine left, nothing is stopped');
    fake.machine.memory = { available: 4, total: 100 };
    await budget.check();
    assert.deepEqual([u.stops, t.stops], [1, 0], 'under 5%, the unit is stopped, though the task started after it');
    assert.deepEqual(unit.stopped, { reason: 'machine', peak: 10 });
    unit.release();
    await budget.check();
    assert.deepEqual([u.stops, t.stops], [1, 1], 'and with no unit left, the task');
    assert.deepEqual(task.stopped, { reason: 'machine', peak: 10 });
  });

  it('measures the runners it watches on its own timer, and stops measuring when it watches none', async () => {
    const fake = sampler();
    const budget = new Budget({ cores: 1, memory: 100 }, { sampler: fake.sampler, sampleMs: 5 });
    const grant = await budget.acquire();
    await sleep(30);
    assert.equal(fake.samples(), 0, 'a grant that watches no runner is not measured');
    grant.watch(runner(1));
    await sleep(60);
    const watching = fake.samples();
    assert.ok(watching >= 2, `measured ${watching} times while it watched a runner`);
    grant.unwatch();
    await sleep(30);
    const after = fake.samples();
    await sleep(60);
    assert.equal(fake.samples(), after, 'not measured once the runner is unwatched');
    grant.release();
  });

  it('runs no guard without a sampler', async () => {
    const budget = new Budget({ cores: 1, memory: 100 }, { sampler: null, sampleMs: 5 });
    const grant = await budget.acquire({ kind: 'unit' });
    const r = runner(1);
    grant.watch(r);
    await budget.check();
    assert.equal(budget.used, 0);
    assert.equal(r.stops, 0);
    grant.release();
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
