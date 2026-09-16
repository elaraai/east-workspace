/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v5 frame worker — one of {@link framePool}'s threads.
 *
 * Receives a segment's logical bytes in a `SharedArrayBuffer`, writes the frame
 * with the same `writeFrame` the inline writer uses (so the bytes cannot
 * differ), copies it into the job's output buffer, and flips the job's status
 * cell. Only bytes cross the thread boundary — never an East value.
 *
 * @packageDocumentation
 */

import { parentPort, workerData } from "node:worker_threads";
import { BufferWriter } from "../../binary-utils.js";
import { FRAME_STATUS } from "./frame-pool.js";
import { writeFrame, type Beast2Codec } from "./frames.js";

// Report that this worker loaded — the pool hands itself out only once every
// worker has (see `framePool`).
const { ready, index } = workerData as { ready: SharedArrayBuffer; index: number };
const readyCells = new Int32Array(ready);
Atomics.store(readyCells, index, 1);
Atomics.notify(readyCells, index);

/** One frame job, as posted by the pool. */
interface FrameJob {
  input: SharedArrayBuffer;
  length: number;
  output: SharedArrayBuffer;
  status: SharedArrayBuffer;
  codec: Beast2Codec;
}

parentPort?.on("message", (job: FrameJob) => {
  const status = new Int32Array(job.status);
  try {
    const frame = new BufferWriter();
    writeFrame(frame, new Uint8Array(job.input, 0, job.length), job.codec);
    const bytes = frame.toUint8Array();
    new Uint8Array(job.output).set(bytes);
    Atomics.store(status, 1, bytes.length);
    Atomics.store(status, 0, FRAME_STATUS.DONE);
  } catch {
    Atomics.store(status, 0, FRAME_STATUS.FAILED);
  }
  Atomics.notify(status, 0);
});
