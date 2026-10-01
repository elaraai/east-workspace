/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The unit workers a page's runners run units on: a pool of dedicated Web
 * Workers, started from the factory the app gives, as wide as the machine's
 * cores unless set.
 *
 * A unit takes one of the pool's places, and runs on an idle worker or on one
 * the pool starts for it; past the pool's width it waits for a place, in the
 * order units asked. A worker is started with `start`, handed the port of the
 * services its host serves units when the pool was given one, and serves units
 * once it answers `ready`. A unit's run is stopped by terminating its worker
 * — when the run is aborted, or runs past its timeout — and the worker is
 * replaced by the next unit that needs one. A worker that fails, or never
 * starts serving units, is let go the same way, failing the unit it was given.
 *
 * @packageDocumentation
 */

import { UnitResultType, UnitType, decodeBeast2For, encodeBeast2For, type Unit, type UnitResult } from '@elaraai/east';
import { transferOf, type UnitFile, type UnitWorker, type WorkerMessage } from './protocol.js';

/** How long a worker may take to start serving units. */
const START_TIMEOUT_MS = 60_000;

/**
 * How a {@link UnitPool} starts its workers.
 */
export interface UnitPoolOptions {
  /** Starts a unit worker: a dedicated Web Worker whose script calls
   *  `serveUnits()` from `@elaraai/e3-web/units`, or in-process ones
   *  (`inProcessUnits()`) */
  readonly units: () => UnitWorker;
  /** The most units that run at once, and so the most workers: the machine's
   *  cores (`navigator.hardwareConcurrency`) unless set */
  readonly width?: number;
  /**
   * Makes the port each worker is handed as it starts: the services the host
   * serves its units, such as a fetch into the e3 worker that e3's own
   * platform functions are bound to. Unset, a worker is handed none.
   */
  readonly connect?: () => MessagePort;
  /** How long a worker may take to start serving units, in milliseconds:
   *  60 s unless set */
  readonly startTimeoutMs?: number;
}

/**
 * How a unit's run ended.
 *
 * - `done`: the unit ran — its result, which says whether it succeeded, and
 *   every file it wrote, by its path relative to the unit;
 * - `failed`: its worker could not run it: the worker failed, never started
 *   serving units, or could not read the unit — why, as the message says;
 * - `aborted`: its run was aborted, before its worker was given it or while it
 *   ran, which terminated the worker;
 * - `timed_out`: it ran past its timeout, which terminated its worker.
 */
export type UnitRun =
  | { readonly kind: 'done'; readonly result: UnitResult; readonly files: ReadonlyMap<string, Uint8Array> }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'aborted'; readonly started: boolean }
  | { readonly kind: 'timed_out' };

/**
 * How {@link UnitPool.run} runs a unit.
 */
export interface UnitRunOptions {
  /** Aborting it stops the unit: a unit waiting for its place never runs, and
   *  one running has its worker terminated */
  readonly signal?: AbortSignal;
  /** How long the unit may run once its worker has it, in milliseconds,
   *  before its worker is terminated: no limit unless set */
  readonly timeoutMs?: number;
  /** Hears what the unit's console writes, as it writes it */
  readonly onLog?: (stream: 'stdout' | 'stderr', text: string) => void;
  /**
   * Called once the unit has a worker serving units, before the worker is
   * given it: where a runner records its execution `running`. When it throws,
   * the unit is not run, and the run throws what it threw.
   */
  readonly onStart?: () => Promise<void>;
  /** Called with 0 when the unit waits for its place, and with `null` once it
   *  has one or stops waiting: a wait for a core alone */
  readonly onWaiting?: (needs: number | null) => void;
}

/** A run in flight on a worker. */
interface InFlight {
  readonly id: number;
  readonly onLog: UnitRunOptions['onLog'];
  /** Ends the run, once: a later answer for it is not heard */
  readonly settle: (run: UnitRun) => void;
}

/** A worker the pool started, and the run it has in flight. */
class PooledWorker {
  /** Settles once the worker serves units; rejects when it fails first, or
   *  takes too long. */
  readonly ready: Promise<void>;
  /** Why the worker is let go, once it is: it failed, or was terminated */
  private ended: string | null = null;
  private inFlight: InFlight | null = null;
  private answerReady!: () => void;
  private refuseReady!: (err: Error) => void;
  private readonly startTimer: ReturnType<typeof setTimeout>;

  /**
   * @param worker - The worker, just started
   * @param port - The port it is handed, or `null`
   * @param startTimeoutMs - How long it may take to start serving units
   * @param lost - Tells the pool the worker is let go
   */
  constructor(private readonly worker: UnitWorker, port: MessagePort | null, startTimeoutMs: number, private readonly lost: (worker: PooledWorker) => void) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.answerReady = resolve;
      this.refuseReady = reject;
    });
    // Nothing need await it to hear it fail.
    this.ready.catch(() => undefined);
    this.startTimer = setTimeout(() => {
      this.fail(`the unit worker did not start serving units in ${startTimeoutMs / 1000} s: its script calls serveUnits() from @elaraai/e3-web/units`);
    }, startTimeoutMs);
    worker.onmessage = (event: MessageEvent) => this.hear(event.data as WorkerMessage);
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      this.fail(`the unit worker failed${event.message ? `: ${event.message}` : ''}`);
    };
    worker.postMessage({ kind: 'start', port }, port === null ? [] : [port]);
  }

  /** Whether the worker is let go. */
  get gone(): boolean {
    return this.ended !== null;
  }

  /** Hears a message from the worker. */
  private hear(message: WorkerMessage): void {
    if (message.kind === 'ready') {
      clearTimeout(this.startTimer);
      this.answerReady();
      return;
    }
    const flight = this.inFlight;
    if (flight === null || message.id !== flight.id) return;
    if (message.kind === 'log') {
      flight.onLog?.(message.stream, message.text);
    } else if (message.kind === 'broken') {
      flight.settle({ kind: 'failed', message: `the unit worker could not run the unit: ${message.message}` });
    } else {
      let result: UnitResult;
      try {
        result = decodeBeast2For(UnitResultType)(message.result);
      } catch (err) {
        flight.settle({ kind: 'failed', message: `the unit worker's result does not decode: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }
      flight.settle({ kind: 'done', result, files: new Map(message.files) });
    }
  }

  /** Lets the worker go, failing what it was doing. */
  private fail(why: string): void {
    if (this.ended !== null) return;
    this.end(why);
    this.refuseReady(new Error(why));
    this.inFlight?.settle({ kind: 'failed', message: why });
  }

  /** Terminates the worker, and tells the pool it is let go. */
  private end(why: string): void {
    this.ended = why;
    clearTimeout(this.startTimer);
    this.worker.terminate();
    this.lost(this);
  }

  /**
   * Terminates the worker at once, whatever it runs: the run in flight is
   * settled as `stop` says.
   *
   * @param stop - How the run in flight ended
   */
  terminate(stop: UnitRun = { kind: 'failed', message: 'the unit pool was closed' }): void {
    if (this.ended !== null) return;
    this.end('terminated');
    this.refuseReady(new Error('the unit worker was terminated'));
    this.inFlight?.settle(stop);
  }

  /**
   * Runs a unit on the worker, which serves units.
   *
   * @param id - The run's id, which the worker's answers name
   * @param unit - The unit's bytes
   * @param files - The files it names: their bytes are the worker's once sent
   * @param options - Its signal, timeout and log
   * @returns How it ended
   */
  run(id: number, unit: Uint8Array, files: readonly UnitFile[], options: UnitRunOptions): Promise<UnitRun> {
    return new Promise<UnitRun>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = (): void => this.terminate({ kind: 'aborted', started: true });
      const settle = (run: UnitRun): void => {
        if (this.inFlight?.id !== id) return;
        this.inFlight = null;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        resolve(run);
      };
      if (this.ended !== null) {
        resolve({ kind: 'failed', message: this.ended });
        return;
      }
      // Aborted once it was recorded running, and before it was sent.
      if (options.signal?.aborted) {
        resolve({ kind: 'aborted', started: true });
        return;
      }
      this.inFlight = { id, onLog: options.onLog, settle };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.timeoutMs !== undefined) {
        timer = setTimeout(() => this.terminate({ kind: 'timed_out' }), options.timeoutMs);
      }
      try {
        this.worker.postMessage({ kind: 'run', id, unit, files }, transferOf(files));
      } catch (err) {
        settle({ kind: 'failed', message: `the unit could not be sent to its worker: ${err instanceof Error ? err.message : String(err)}` });
      }
    });
  }
}

/** How a unit's wait for its place ended. */
type Placed = 'placed' | 'aborted' | 'closed';

/** A unit waiting for its place. */
interface Waiter {
  /** Gives it its place, or refuses it one */
  readonly answer: (placed: Placed) => void;
}

/** An error's message. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A pool of unit workers, which a page's runners share.
 *
 * @example
 * ```ts
 * const pool = new UnitPool({
 *   units: () => new Worker(new URL('./unit.worker.js', import.meta.url), { type: 'module' }),
 * });
 * const run = await pool.run(unit, files, { timeoutMs: 60_000 });
 * ```
 */
export class UnitPool {
  /** The most units that run at once. */
  readonly width: number;
  private readonly startTimeoutMs: number;
  /** Workers serving units, or starting to, with no run in flight */
  private readonly idle: PooledWorker[] = [];
  /** Every worker not let go */
  private readonly live = new Set<PooledWorker>();
  /** The units waiting for a place, first first */
  private readonly waiting: Waiter[] = [];
  /** The places taken */
  private taken = 0;
  private nextId = 1;
  private closed = false;

  /**
   * @param options - Its worker factory, its width, the port each worker is
   *   handed, and how long a worker may take to start
   * @throws {RangeError} When the width is not a whole number of at least one,
   *   or none is given and the platform reports no cores
   */
  constructor(private readonly options: UnitPoolOptions) {
    const width = options.width ?? (globalThis.navigator as Navigator | undefined)?.hardwareConcurrency;
    if (width === undefined || !Number.isSafeInteger(width) || width < 1) {
      throw new RangeError(`a unit pool's width is a whole number of at least one, not ${width}: set it where the platform reports no cores`);
    }
    this.width = width;
    this.startTimeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS;
  }

  /**
   * Runs a unit on a worker of the pool, once it has a place.
   *
   * @param unit - The unit
   * @param files - Every file it names, by its path relative to the unit: the
   *   bytes are the worker's once sent, so a caller keeps none of them
   * @param options - Its signal and timeout, what hears its console and its
   *   wait for a place, and what records it running
   * @returns How its run ended
   * @throws {Error} When the pool is closed, or `onStart` throws.
   */
  async run(unit: Unit, files: Iterable<UnitFile>, options: UnitRunOptions = {}): Promise<UnitRun> {
    if (this.closed) throw new Error('the unit pool is closed');
    const placed = await this.place(options);
    if (placed === 'aborted') return { kind: 'aborted', started: false };
    if (placed === 'closed') return { kind: 'failed', message: 'the unit pool was closed' };
    let worker: PooledWorker | undefined;
    try {
      try {
        worker = this.idle.pop() ?? this.start();
      } catch (err) {
        return { kind: 'failed', message: `the unit worker did not start: ${messageOf(err)}` };
      }
      try {
        await worker.ready;
      } catch (err) {
        return { kind: 'failed', message: messageOf(err) };
      }
      if (options.signal?.aborted) return { kind: 'aborted', started: false };
      await options.onStart?.();
      return await worker.run(this.nextId++, encodeBeast2For(UnitType)(unit), [...files], options);
    } finally {
      if (worker !== undefined && !worker.gone && !this.closed) this.idle.push(worker);
      this.leave();
    }
  }

  /**
   * Terminates every worker, whatever it runs, and refuses every unit after:
   * a unit running fails, and one waiting for its place never runs.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiting.splice(0)) waiter.answer('closed');
    for (const worker of [...this.live]) worker.terminate();
    this.idle.length = 0;
  }

  /** Starts a worker. */
  private start(): PooledWorker {
    const port = this.options.connect?.() ?? null;
    const worker = new PooledWorker(this.options.units(), port, this.startTimeoutMs, (gone) => {
      this.live.delete(gone);
      const at = this.idle.indexOf(gone);
      if (at >= 0) this.idle.splice(at, 1);
    });
    this.live.add(worker);
    return worker;
  }

  /**
   * Takes a place for a unit: at once while the pool has one, and otherwise
   * once a unit before it leaves one.
   *
   * @returns Whether it took one: not when the run was aborted, or the pool
   *   closed, while it waited
   */
  private async place(options: UnitRunOptions): Promise<Placed> {
    if (options.signal?.aborted) return 'aborted';
    if (this.taken < this.width) {
      this.taken++;
      return 'placed';
    }
    options.onWaiting?.(0);
    try {
      return await new Promise<Placed>((resolve) => {
        const waiter: Waiter = {
          answer: (placed) => {
            options.signal?.removeEventListener('abort', onAbort);
            resolve(placed);
          },
        };
        const onAbort = (): void => {
          const at = this.waiting.indexOf(waiter);
          if (at >= 0) this.waiting.splice(at, 1);
          waiter.answer('aborted');
        };
        options.signal?.addEventListener('abort', onAbort, { once: true });
        this.waiting.push(waiter);
      });
    } finally {
      options.onWaiting?.(null);
    }
  }

  /** Leaves a place: to the unit waiting longest, or free. */
  private leave(): void {
    const next = this.waiting.shift();
    if (next !== undefined) next.answer('placed');
    else this.taken--;
  }
}
