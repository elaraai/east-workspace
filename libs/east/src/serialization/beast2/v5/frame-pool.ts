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
 * messages the main thread would have to yield to receive. Each job instead
 * carries three `SharedArrayBuffer`s: the logical bytes in, the frame bytes
 * out, and a status cell the worker flips and `Atomics.notify`s. The main
 * thread polls the cell to append what is done and `Atomics.wait`s on it only
 * when it must (back-pressure, a settle, `finish`).
 *
 * Node-only and optional: without `worker_threads`, `SharedArrayBuffer` or a
 * second CPU, {@link framePool} returns `null` and the writer frames inline,
 * which yields the same bytes. Node's modules are reached through
 * `process.getBuiltinModule` — as `frames.ts` reaches zlib — so browser
 * bundles never see a `node:` import.
 */

import type { Beast2Codec } from "./frames.js";

/** An upper bound on a frame's header: varint(codec) + varint(uncompressed
 *  length) + varint(payload length). A frame's payload never exceeds its
 *  logical bytes (`writeFrame` stores codec `none` when deflate does not
 *  shrink), so logical + this bounds a frame not yet written. */
export const FRAME_HEADER_MAX = 21;

/** Status cell values. */
const PENDING = 0;
const DONE = 1;
const FAILED = 2;

/** A frame being deflated on a worker. */
export interface PendingFrame {
  /** The logical bytes the frame carries — its payload's upper bound. */
  readonly logicalLength: number;
  /** Whether the frame is ready, without blocking. */
  ready(): boolean;
  /**
   * The frame's wire bytes, blocking until the worker has written them.
   *
   * @returns the frame bytes
   * @throws {Error} When the worker failed to build the frame.
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
}

type WorkerLike = {
  postMessage(message: unknown): void;
  unref(): void;
  terminate(): Promise<number>;
};
type WorkerThreadsModule = {
  isMainThread: boolean;
  Worker: new (filename: URL, options: { workerData: unknown }) => WorkerLike;
};
type OsModule = { availableParallelism?: () => number; cpus(): unknown[] };
type FsModule = { existsSync(path: URL): boolean };

/** How long pool creation waits for every worker to report it loaded. A
 *  worker boots in tens of milliseconds; this only bounds a broken install. */
const STARTUP_TIMEOUT_MS = 10_000;

/** `undefined` until first asked for; `null` when this runtime cannot pool. */
let shared: FramePool | null | undefined;

/**
 * The process's frame pool, created on first use.
 *
 * @returns the pool, or `null` when frames must be written inline — no Node
 *   `worker_threads`, no `SharedArrayBuffer`, a single CPU, not the main thread
 *   (a pool per worker would only oversubscribe), or worker start-up failed
 */
export function framePool(): FramePool | null {
  if (shared === undefined) shared = createPool();
  return shared;
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
  const cpus = os.availableParallelism?.() ?? os.cpus().length;
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
  const abandon = (): null => {
    for (const worker of workers) void worker.terminate();
    return null;
  };
  try {
    for (let i = 0; i < cpus; i++) {
      const worker = new threads.Worker(script, { workerData: { ready: ready.buffer, index: i } });
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

  let next = 0;
  return {
    workers: workers.length,
    submit(logical, codec) {
      const input = new SharedArrayBuffer(Math.max(1, logical.length));
      new Uint8Array(input).set(logical);
      const output = new SharedArrayBuffer(logical.length + FRAME_HEADER_MAX);
      const status = new Int32Array(new SharedArrayBuffer(8));
      workers[next]!.postMessage({ input, length: logical.length, output, status: status.buffer, codec });
      next = (next + 1) % workers.length;
      return {
        logicalLength: logical.length,
        ready: () => Atomics.load(status, 0) !== PENDING,
        take: () => {
          while (Atomics.load(status, 0) === PENDING) Atomics.wait(status, 0, PENDING);
          if (Atomics.load(status, 0) === FAILED) {
            throw new Error("beast2 v5: a frame worker failed to build a frame");
          }
          return new Uint8Array(output, 0, Atomics.load(status, 1)).slice();
        },
      };
    },
  };
}

/** Status cell values, for the worker. @internal */
export const FRAME_STATUS = { PENDING, DONE, FAILED } as const;
