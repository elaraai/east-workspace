/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v5 frame pool — deflating frames on worker threads (issue #763).
 *
 * v5 frames are independent (one segment per frame, each decoded standalone),
 * so a writer can deflate them in parallel with no format change, provided it
 * puts them on the wire in submission order. The pool is only the parallel
 * half: {@link Beast2Writer} submits each segment's logical bytes and appends
 * the resulting frames in order, assigning index offsets as they land.
 *
 * The writer's API is synchronous — {@link Beast2Writer.write} is called from
 * inside compiled East bodies (the emit sink) — so results cannot come back as
 * messages the main thread would have to yield to receive. A frame instead
 * travels through a slot: three `SharedArrayBuffer`s — the logical bytes in,
 * the frame bytes out, and a status cell the worker flips and
 * `Atomics.notify`s — handed to one worker once and reused by every frame
 * after, grown only for a larger segment. The main thread polls the cell to
 * append what is done and `Atomics.wait`s on it only when it must
 * (back-pressure, a settle, `finish`).
 *
 * Nothing a frame allocates waits on a worker's garbage collector. A worker
 * allocates almost nothing on its own heap, so its collector rarely runs — V8
 * weighs buffers' memory towards a collection only after about 64 MiB of it per
 * isolate — and fresh buffers shared per frame were held up to that much per
 * worker (#841). The pool holds its slots: two segments' bytes for each frame in
 * flight, and a writer keeps at most two in flight per worker. A slot grows by
 * doubling, so the buffers it outgrew, which wait on that GC, come to less than
 * it holds.
 *
 * Node-only and optional: without `worker_threads`, `SharedArrayBuffer` or a
 * second CPU, {@link framePool} returns `null` and the writer frames inline,
 * which yields the same bytes. Node's modules are reached through
 * `process.getBuiltinModule` — as `frames.ts` reaches zlib — so browser
 * bundles never see a `node:` import.
 *
 * A runner granted a number of threads caps the pool at that many workers
 * ({@link configureFramePool}): a grant of one thread frames every write
 * inline.
 *
 * A worker can die without flipping a status cell — a worker-thread OOM ends
 * its isolate before its `catch` runs — and the main thread cannot receive the
 * worker's `exit` event while it is blocked waiting on that worker's frame. So
 * every wait is bounded: a frame pending past the wait timeout fails, the pool
 * is abandoned, and the process frames inline from then on. A worker's failure
 * the main thread hears between writes — its `error` event — abandons the pool
 * the same way, where unheard it would end the process.
 *
 * The pool is process-wide and outlives the write that started it, so a
 * long-lived process — an API server, a terminal UI — would otherwise keep one
 * idle V8 isolate per CPU for good. A pool with no frame outstanding and no
 * activity for the idle limit terminates its workers, and the next pooled
 * write starts a new pool. A writer abandoned mid-flight never takes its
 * frames, so it keeps the pool alive; the idle check is `unref`'d, so process
 * exit is unaffected either way.
 */

import { type Beast2Codec, FRAME_HEADER_MAX } from "./frames.js";

/** Status cell values. */
const PENDING = 0;
const DONE = 1;
const FAILED = 2;

/** A frame being deflated on a worker. */
export interface PendingFrame {
  /** Whether the frame is ready, without blocking. */
  ready(): boolean;
  /**
   * The frame's wire bytes, blocking until the worker has written them.
   *
   * @returns the frame bytes
   * @throws {Error} When the worker failed to build the frame, or stopped
   *   responding — the frame was still pending when the wait timed out, or its
   *   pool had already lost a worker. A lost worker abandons the pool: the
   *   process frames inline from then on.
   */
  take(): Uint8Array;
}

/** A process-wide set of frame workers. */
export interface FramePool {
  /** Worker count — the writer queues at most two frames per worker. */
  readonly workers: number;
  /**
   * Hands a segment's logical bytes to a worker.
   *
   * @param logical - the segment's logical bytes (copied; the caller may reuse them)
   * @param codec - the requested frame codec
   * @returns the frame, pending
   */
  submit(logical: Uint8Array, codec: Beast2Codec): PendingFrame;
  /**
   * Terminates every worker thread. A frame still pending on one never
   * completes, so its {@link PendingFrame.take} fails once the wait times out.
   *
   * @returns a promise that settles once every thread has exited
   * @internal
   */
  terminateWorkers(): Promise<void>;
}

/** The frame pool's settings — see {@link configureFramePool}. */
export interface FramePoolSettings {
  /** The most workers a pool starts — a runner's thread grant. Fewer than two
   *  frame every write inline. The pool never starts more workers than the
   *  CPUs the process may use, nor more than 32. */
  workers?: number;
  /** How long {@link PendingFrame.take} waits for one frame before it presumes
   *  the worker's thread lost, in milliseconds. */
  waitTimeoutMs?: number;
  /** How long a pool with no frame outstanding keeps its workers before it
   *  terminates them, in milliseconds. */
  idleMs?: number;
}

type WorkerLike = {
  postMessage(message: unknown): void;
  unref(): void;
  terminate(): Promise<number>;
  on(event: "error", listener: () => void): unknown;
};
type WorkerThreadsModule = {
  isMainThread: boolean;
  Worker: new (filename: URL, options: { workerData: unknown; execArgv: string[] }) => WorkerLike;
};
type OsModule = { availableParallelism?: () => number; cpus(): unknown[] };
type FsModule = { existsSync(path: URL): boolean };

/** How long pool creation waits for every worker to report it loaded. A
 *  worker boots in tens of milliseconds; this only bounds a broken install. */
const STARTUP_TIMEOUT_MS = 10_000;

/** The most workers the pool starts. A writer keeps two frames per worker in
 *  flight, so memory scales with the worker count, while deflate throughput
 *  flattens well before this (#763 measured 254 MB/s at 32 threads). east-c's
 *  writer caps its threads the same (`B2V5_POOL_MAX_THREADS`). */
const FRAME_POOL_MAX_WORKERS = 32;

/** How long {@link PendingFrame.take} waits for one frame before it presumes
 *  the worker's thread lost. A 4 MiB segment deflates in well under a second,
 *  so this fires only when the worker is gone. */
const FRAME_WAIT_TIMEOUT_MS = 60_000;

/** The slices a blocked {@link PendingFrame.take} waits in, checking its
 *  deadline between them. */
const FRAME_WAIT_SLICE_MS = 1_000;

/** How long a pool with no frame outstanding keeps its workers. Starting a
 *  pool costs tens of milliseconds, so a busy process never pays it twice;
 *  an idle one does not hold an isolate per CPU for its whole life. */
const FRAME_POOL_IDLE_MS = 30_000;

/** How often the live pool is checked for idleness (more often only when the
 *  idle limit is shorter). */
const IDLE_CHECK_INTERVAL_MS = 10_000;

/** The bytes a slot's input starts with, so a run of small segments does not
 *  grow it frame by frame. */
const SLOT_MIN_BYTES = 64 * 1024;

/** The settings in force; {@link configureFramePool} changes them. */
const settings: Required<FramePoolSettings> = {
  workers: FRAME_POOL_MAX_WORKERS,
  waitTimeoutMs: FRAME_WAIT_TIMEOUT_MS,
  idleMs: FRAME_POOL_IDLE_MS,
};

/** `undefined` until first asked for, and again once an idle pool retires;
 *  `null` when this runtime cannot pool, or once a pool has lost a worker. */
let shared: FramePool | null | undefined;

/** The live pool's idle check; `undefined` while no pool is live. */
let idleCheck: ReturnType<typeof setInterval> | undefined;

/**
 * The process's frame pool, created on first use — and again after an idle
 * pool retired its workers.
 *
 * @returns the pool, or `null` when frames must be written inline — a grant of
 *   fewer than two workers, no Node `worker_threads`, no `SharedArrayBuffer`, a
 *   single CPU, not the main thread (a pool per worker would only
 *   oversubscribe), worker start-up failed, or an earlier pool lost a worker
 */
export function framePool(): FramePool | null {
  if (settings.workers < 2) return null;
  if (shared === undefined) {
    shared = createPool();
    armIdleCheck();
  }
  return shared;
}

/**
 * Changes the frame pool's settings: the worker cap a runner is granted, and
 * the timeouts, for tests that cannot wait them out.
 *
 * @param options - the settings to change; an omitted one keeps its value
 * @returns every setting as it was before, to restore afterwards
 *
 * @remarks
 * A new worker cap applies to the next pool. A live pool with no frame
 * outstanding retires at once, so the next write starts one at the new cap;
 * one with frames outstanding keeps its workers until it goes idle.
 *
 * @example
 * ```ts
 * // A runner granted one thread frames every output inline.
 * configureFramePool({ workers: 1 });
 * ```
 */
export function configureFramePool(options: FramePoolSettings): Required<FramePoolSettings> {
  const previous = { ...settings };
  if (options.workers !== undefined && options.workers !== settings.workers) {
    settings.workers = options.workers;
    if (shared instanceof WorkerFramePool && shared.outstanding === 0) {
      void shared.terminateWorkers();
      shared = undefined;
    }
  }
  if (options.waitTimeoutMs !== undefined) settings.waitTimeoutMs = options.waitTimeoutMs;
  if (options.idleMs !== undefined) settings.idleMs = options.idleMs;
  armIdleCheck();
  return previous;
}

/**
 * Gives up on a pool that lost a worker: terminates its threads and makes the
 * process frame inline from then on — the same bytes, on the calling thread.
 * Every frame still pending on the pool fails at once rather than waiting out
 * its own timeout.
 */
function abandonPool(pool: WorkerFramePool): void {
  pool.lost = true;
  void pool.terminateWorkers();
  shared = null;
  armIdleCheck();
}

/** Starts, restarts or stops the idle check so it runs exactly while a pool
 *  is live, at a period no longer than the idle limit. */
function armIdleCheck(): void {
  if (idleCheck !== undefined) clearInterval(idleCheck);
  idleCheck = undefined;
  if (!(shared instanceof WorkerFramePool)) return;
  idleCheck = setInterval(retireIfIdle, Math.max(1, Math.min(IDLE_CHECK_INTERVAL_MS, settings.idleMs)));
  // Never keeps a finished process alive.
  (idleCheck as { unref?: () => void }).unref?.();
}

/** Terminates the live pool's workers once no frame is outstanding and none
 *  has moved for the idle limit; the next {@link framePool} starts a new one. */
function retireIfIdle(): void {
  const pool = shared;
  if (pool instanceof WorkerFramePool && pool.outstanding === 0 && Date.now() - pool.lastActivity > settings.idleMs) {
    void pool.terminateWorkers();
    shared = undefined;
  }
  if (!(shared instanceof WorkerFramePool)) armIdleCheck();
}

/** A frame's way to one worker and back: its buffers, reused by every frame
 *  the slot carries. */
interface Slot {
  readonly id: number;
  input: SharedArrayBuffer;
  output: SharedArrayBuffer;
  readonly status: Int32Array;
  /** Whether the worker has the slot's buffers as they are now. */
  sent: boolean;
}

/** The worker-thread pool {@link framePool} hands out. */
class WorkerFramePool implements FramePool {
  readonly workers: number;
  /** Set once a worker stopped responding; every pending frame then fails. */
  lost = false;
  /** Frames submitted and not yet taken — a pool with any is never idle. */
  outstanding = 0;
  /** When a frame was last submitted or taken, or the pool started. */
  lastActivity = Date.now();
  private readonly threads: readonly WorkerLike[];
  /** Each worker's slots with no frame in them. */
  private readonly free: Slot[][];
  private slots = 0;
  private next = 0;

  constructor(threads: readonly WorkerLike[]) {
    this.threads = threads;
    this.workers = threads.length;
    this.free = threads.map(() => []);
  }

  submit(logical: Uint8Array, codec: Beast2Codec): PendingFrame {
    const worker = this.next;
    this.next = (this.next + 1) % this.threads.length;
    // A worker has a slot for each frame it holds, so several writers sharing
    // the pool never wait on one another's slots.
    const slot = this.free[worker]!.pop() ?? {
      id: this.slots++,
      input: new SharedArrayBuffer(SLOT_MIN_BYTES),
      output: new SharedArrayBuffer(SLOT_MIN_BYTES + FRAME_HEADER_MAX),
      status: new Int32Array(new SharedArrayBuffer(8)),
      sent: false,
    };
    if (slot.input.byteLength < logical.length) {
      const bytes = 2 ** Math.ceil(Math.log2(logical.length));
      slot.input = new SharedArrayBuffer(bytes);
      slot.output = new SharedArrayBuffer(bytes + FRAME_HEADER_MAX);
      slot.sent = false;
    }
    new Uint8Array(slot.input).set(logical);
    Atomics.store(slot.status, 0, PENDING);
    const job: FrameJob = { slot: slot.id, length: logical.length, codec };
    if (!slot.sent) {
      job.buffers = { input: slot.input, output: slot.output, status: slot.status.buffer as SharedArrayBuffer };
      slot.sent = true;
    }
    this.threads[worker]!.postMessage(job);
    this.outstanding++;
    this.lastActivity = Date.now();
    let taken = false;
    return {
      ready: () => Atomics.load(slot.status, 0) !== PENDING,
      take: () => {
        try {
          const deadline = Date.now() + settings.waitTimeoutMs;
          while (Atomics.load(slot.status, 0) === PENDING) {
            const remaining = deadline - Date.now();
            if (this.lost || remaining <= 0) {
              abandonPool(this);
              throw new Error("beast2 v5: a frame worker stopped responding — its thread was lost");
            }
            Atomics.wait(slot.status, 0, PENDING, Math.min(FRAME_WAIT_SLICE_MS, remaining));
          }
          if (Atomics.load(slot.status, 0) === FAILED) {
            throw new Error("beast2 v5: a frame worker failed to build a frame");
          }
          return new Uint8Array(slot.output, 0, Atomics.load(slot.status, 1)).slice();
        } finally {
          // Taken once, however it ended: a failed frame is not outstanding,
          // and its slot is free.
          if (!taken) {
            taken = true;
            this.outstanding--;
            this.free[worker]!.push(slot);
          }
          this.lastActivity = Date.now();
        }
      },
    };
  }

  async terminateWorkers(): Promise<void> {
    await Promise.all(this.threads.map((worker) => worker.terminate()));
  }
}

function createPool(): FramePool | null {
  if (typeof SharedArrayBuffer === "undefined" || typeof Atomics === "undefined") return null;
  const getBuiltin = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } })
    .process?.getBuiltinModule;
  if (typeof getBuiltin !== "function") return null;
  const threads = getBuiltin("node:worker_threads") as WorkerThreadsModule | undefined;
  const os = getBuiltin("node:os") as OsModule | undefined;
  const fs = getBuiltin("node:fs") as FsModule | undefined;
  if (!threads || !os || !fs || !threads.isMainThread) return null;
  const cpus = Math.min(settings.workers, FRAME_POOL_MAX_WORKERS, os.availableParallelism?.() ?? os.cpus().length);
  if (cpus < 2) return null;

  // Bundled into a single file (or loaded as CommonJS), this module has no
  // worker script beside it — frame inline rather than fail.
  let script: URL;
  try {
    script = new URL("./frame-worker.js", import.meta.url);
    if (!fs.existsSync(script)) return null;
  } catch {
    return null;
  }

  // Each worker reports it has LOADED through a shared cell before the pool
  // is handed out. A worker that fails to load reports only through an
  // `error` event — which the main thread cannot receive while it is blocked
  // in `Atomics.wait` on that worker's first job. So a pool is only ever
  // returned once every worker has proven it runs.
  const ready = new Int32Array(new SharedArrayBuffer(4 * cpus));
  const workers: WorkerLike[] = [];
  let pool: WorkerFramePool | undefined;
  const abandon = (): null => {
    for (const worker of workers) void worker.terminate();
    return null;
  };
  // A worker that fails — its script does not load, or it throws — says so
  // only through an `error` event, and one nobody hears ends the process.
  const failed = (): void => {
    if (pool === undefined) abandon();
    else if (!pool.lost) abandonPool(pool);
  };
  try {
    for (let i = 0; i < cpus; i++) {
      // A worker loads one module and needs none of the process's options,
      // which it could refuse: `--input-type` stops it loading a file.
      const worker = new threads.Worker(script, { workerData: { ready: ready.buffer, index: i }, execArgv: [] });
      worker.on("error", failed);
      // Idle workers must not keep a finished process alive; a writer that
      // is waiting on one is blocked on the main thread anyway.
      worker.unref();
      workers.push(worker);
    }
  } catch {
    return abandon();
  }
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  for (let i = 0; i < workers.length; i++) {
    while (Atomics.load(ready, i) === 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return abandon();
      Atomics.wait(ready, i, 0, remaining);
    }
  }

  pool = new WorkerFramePool(workers);
  return pool;
}

/** Status cell values, for the worker. @internal */
export const FRAME_STATUS = { PENDING, DONE, FAILED } as const;

/** A frame, as the pool posts it to a worker. @internal */
export interface FrameJob {
  /** The slot the frame travels through. */
  slot: number;
  /** The logical bytes' length, from the start of the slot's input. */
  length: number;
  /** The requested frame codec. */
  codec: Beast2Codec;
  /** The slot's buffers, when the worker does not have them as they are now:
   *  the slot's first frame, and a frame larger than the slot held. */
  buffers?: { input: SharedArrayBuffer; output: SharedArrayBuffer; status: SharedArrayBuffer };
}
