/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The unit protocol's edges, which a working worker never shows: the pool
 * over workers that never start, fail, cannot run a unit or answer what does
 * not decode, and a pool closed with units in it; what a message moves rather
 * than copies; the unit server's answers to a host; the in-process host's
 * terminate, which leaves no timer of the unit's behind; and what refuses to
 * be set up wrong. Every unit a worker runs is the runner cases' business
 * (`WebTaskRunner.spec.ts`, and in Chromium `../browser/runner.spec.ts`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { East, NullType, encodeEastIR, variant } from '@elaraai/east';
import { callUnitOf } from '@elaraai/e3-core/portable';
import { Console, Time } from '@elaraai/east-web-std';
import { MemoryLockSpace } from '../storage/memory.js';
import { serveUnits } from '../units.js';
import { inProcessUnits } from './in-process.js';
import { UnitPool, type UnitRun } from './pool.js';
import { transferOf, type HostMessage, type UnitWorker, type WorkerMessage } from './protocol.js';
import { UnitServer } from './unit-server.js';
import { WebTaskRunner } from './WebTaskRunner.js';

/** A unit, as the pool sends one: a call of a program on a platform-free
 *  runner. */
const UNIT = callUnitOf(variant('east_node', { platforms: [], decode: variant('lazy', null) }), 'program.beast2', [], 'output.beast2', 1, false);

/**
 * A unit worker that answers as a test says: each message it is sent is
 * handed to `answer` in a later task, as a worker answers.
 */
class FakeWorker implements UnitWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly sent: HostMessage[] = [];
  terminated = false;

  constructor(private readonly answer: (message: HostMessage, worker: FakeWorker) => void = () => {}) {}

  postMessage(message: HostMessage): void {
    this.sent.push(message);
    setTimeout(() => this.answer(message, this), 0);
  }

  /** Sends the pool a message, as a worker's script does. */
  say(message: WorkerMessage): void {
    this.onmessage?.(new MessageEvent('message', { data: message }));
  }

  /** Fails, as a worker whose script throws does. */
  fail(message: string): void {
    this.onerror?.({ message, preventDefault: () => {} } as unknown as ErrorEvent);
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** A worker that serves units, and answers each it is given as `run` says. */
function serving(run: (message: Extract<HostMessage, { kind: 'run' }>, worker: FakeWorker) => void = () => {}): FakeWorker {
  return new FakeWorker((message, worker) => {
    if (message.kind === 'start') worker.say({ kind: 'ready', lifeline: null });
    else run(message, worker);
  });
}

/** A pool over the workers a list makes, one each time it starts one. */
function poolOver(workers: Array<() => FakeWorker>, options: { width?: number; startTimeoutMs?: number } = {}): { pool: UnitPool; started: FakeWorker[] } {
  const started: FakeWorker[] = [];
  const pool = new UnitPool({
    units: () => {
      const make = workers[started.length];
      if (make === undefined) throw new Error('no more workers');
      const worker = make();
      started.push(worker);
      return worker;
    },
    width: options.width ?? 1,
    ...(options.startTimeoutMs !== undefined && { startTimeoutMs: options.startTimeoutMs }),
  });
  return { pool, started };
}

/** A run's failure message, or what it was instead. */
function failure(run: UnitRun): string {
  return run.kind === 'failed' ? run.message : `a run that ended ${run.kind}`;
}

describe('the unit pool', () => {
  it('is as wide as the machine has cores unless given a width, and refuses one that is not a whole number of at least one', () => {
    assert.equal(new UnitPool({ units: () => new FakeWorker() }).width, navigator.hardwareConcurrency);
    for (const width of [0, -1, 1.5, Number.NaN]) {
      assert.throws(() => new UnitPool({ units: () => new FakeWorker(), width }), {
        name: 'RangeError',
        message: /a unit pool's width is a whole number of at least one/,
      }, `a width of ${width}`);
    }
  });

  it('fails a unit whose worker never starts serving units, naming serveUnits, and starts another for the next', async () => {
    const { pool, started } = poolOver([() => new FakeWorker(), () => new FakeWorker()], { startTimeoutMs: 20 });
    const first = await pool.run(UNIT, []);
    assert.match(failure(first), /^the unit worker did not start serving units in 0\.02 s: its script calls serveUnits\(\) from @elaraai\/e3-web\/units$/);
    assert.equal(started[0]!.terminated, true, 'the worker is let go');
    await pool.run(UNIT, []);
    assert.equal(started.length, 2, 'the next unit starts a worker of its own');
    pool.close();
  });

  it('fails a unit whose worker fails, with what it said, letting the worker go', async () => {
    const { pool, started } = poolOver([() => serving((_message, worker) => worker.fail('boom')), () => serving()]);
    assert.equal(failure(await pool.run(UNIT, [])), 'the unit worker failed: boom');
    assert.equal(started[0]!.terminated, true);
    pool.close();
  });

  it('fails a unit its worker could not run, or whose result does not decode, and keeps the worker for the next', async () => {
    const { pool, started } = poolOver([() => serving((message, worker) => {
      if (message.id === 1) worker.say({ kind: 'broken', id: message.id, message: 'no such unit' });
      else worker.say({ kind: 'done', id: message.id, result: new Uint8Array([1, 2, 3]), files: [] });
    })]);
    assert.equal(failure(await pool.run(UNIT, [])), 'the unit worker could not run the unit: no such unit');
    assert.match(failure(await pool.run(UNIT, [])), /^the unit worker's result does not decode: /);
    assert.equal(started.length, 1, 'one worker ran both');
    assert.equal(started[0]!.terminated, false);
    assert.deepEqual(started[0]!.sent.map(({ kind }) => kind), ['start', 'run', 'run']);
    pool.close();
  });

  it('runs no unit whose run was aborted before it had a place', async () => {
    const { pool, started } = poolOver([() => serving()]);
    assert.deepEqual(await pool.run(UNIT, [], { signal: AbortSignal.abort() }), { kind: 'aborted', started: false });
    assert.equal(started.length, 0, 'no worker was started for it');
    pool.close();
  });

  it('fails the units in it once closed, the one running and the one waiting, and refuses any after', async () => {
    const { pool, started } = poolOver([() => serving()]);
    const running = pool.run(UNIT, []);
    const waited: Array<number | null> = [];
    const waiting = pool.run(UNIT, [], { onWaiting: (needs) => waited.push(needs) });
    while (started[0]?.sent.some(({ kind }) => kind === 'run') !== true || waited.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    pool.close();
    assert.equal(failure(await running), 'the unit pool was closed');
    assert.equal(failure(await waiting), 'the unit pool was closed');
    assert.deepEqual(waited, [0, null]);
    assert.equal(started[0]!.terminated, true, 'its worker is terminated');
    await assert.rejects(pool.run(UNIT, []), /the unit pool is closed/);
  });
});

describe('the unit protocol', () => {
  it('moves only the buffers a file\'s bytes are the whole of, each once', () => {
    const whole = new Uint8Array([1, 2, 3]);
    const pooled = new Uint8Array(16);
    const shared = new Uint8Array(new SharedArrayBuffer(4));
    assert.deepEqual(transferOf([['a', whole], ['b', whole], ['c', pooled.subarray(4, 8)], ['d', shared]]), [whole.buffer],
      'a view into a larger buffer, or into shared memory, is copied with the message');
  });

  it('serves a host: answers start ready, and a unit that does not decode broken, naming why', async () => {
    const said: WorkerMessage[] = [];
    const server = new UnitServer({ postMessage: (message) => said.push(message) }, { platforms: {} });
    await server.receive({ kind: 'start', port: null });
    await server.receive({ kind: 'run', id: 7, unit: new Uint8Array([1, 2, 3]), files: [] });
    assert.equal(said.length, 2);
    assert.deepEqual(said[0], { kind: 'ready', lifeline: null }, 'a server that takes no lifeline names none');
    const broken = said[1]!;
    assert.ok(broken.kind === 'broken' && broken.id === 7 && /^the unit does not decode: /.test(broken.message), JSON.stringify(broken));
  });

  it('serves units only in a dedicated Web Worker', () => {
    assert.throws(() => serveUnits(), /serveUnits serves units in a dedicated Web Worker/);
  });
});

/** How long the sleeping unit sleeps: ten minutes, which a timer no one
 *  clears holds the process for. */
const SLEEP_MS = 600_000;

/**
 * Watches the timers this thread sets for a while: those of a delay, as they
 * are set, and every timer cleared.
 *
 * @param ms - The delay of the timers watched
 * @returns What it saw, and what puts the thread's timers back
 */
function watchTimers(ms: number): { readonly set: Set<unknown>; readonly cleared: Set<unknown>; restore(): void } {
  const setTimer = globalThis.setTimeout;
  const clearTimer = globalThis.clearTimeout;
  const set = new Set<unknown>();
  const cleared = new Set<unknown>();
  globalThis.setTimeout = ((handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    const timer = setTimer(handler, delay, ...args);
    if (delay === ms) set.add(timer);
    return timer;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((timer?: Parameters<typeof clearTimer>[0]) => {
    cleared.add(timer);
    clearTimer(timer);
  }) as typeof globalThis.clearTimeout;
  return {
    set,
    cleared,
    restore: () => {
      globalThis.setTimeout = setTimer;
      globalThis.clearTimeout = clearTimer;
    },
  };
}

describe('the in-process host', () => {
  it('clears the timer of a sleep under way as it terminates the unit\'s worker, so nothing of the unit\'s holds the process', async () => {
    // A program that says it sleeps, and sleeps ten minutes.
    const sleeper = East.asyncFunction([], NullType, ($) => {
      $(Console.log('sleeping'));
      $(Time.sleep(BigInt(SLEEP_MS)));
    });
    const unit = callUnitOf(variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) }), 'program.beast2', [], 'output.beast2', 1, false);
    const pool = new UnitPool({ units: inProcessUnits(), width: 1 });
    const timers = watchTimers(SLEEP_MS);
    try {
      const controller = new AbortController();
      let said = '';
      const running = pool.run(unit, [['program.beast2', encodeEastIR(sleeper.toIR())]], {
        signal: controller.signal,
        onLog: (_stream, text) => {
          said += text;
        },
      });
      // Its sleep has begun once its timer is set, and what it said has come.
      for (let waited = 0; (timers.set.size === 0 || said === '') && waited < 10_000; waited += 5) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      assert.equal(said, 'sleeping\n', 'the unit said it sleeps');
      assert.equal(timers.set.size, 1, 'its sleep set its timer');
      controller.abort();
      assert.deepEqual(await running, { kind: 'aborted', started: true });
      assert.deepEqual([...timers.set].filter((timer) => !timers.cleared.has(timer)), [],
        'the sleep\'s timer was cleared: it holds the process for ten minutes no more');
    } finally {
      timers.restore();
      pool.close();
    }
  });
});

describe('WebTaskRunner\'s options', () => {
  it('refuses a whole-intake limit that is not a whole number of bytes, zero or more', async () => {
    const locks = await new MemoryLockSpace().open();
    const pool = new UnitPool({ units: () => new FakeWorker(), width: 1 });
    for (const wholeIntakeLimit of [-1, 1.5]) {
      assert.throws(() => new WebTaskRunner({ repo: 'default', pool, locks, wholeIntakeLimit }), {
        name: 'RangeError',
        message: /a runner's whole-intake limit is a whole number of bytes, zero or more/,
      });
    }
    assert.equal(new WebTaskRunner({ repo: 'default', pool, locks, wholeIntakeLimit: 0 }).wholeIntakeLimit, 0);
    await locks.close();
  });
});
