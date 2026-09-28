/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v5 frame worker — one of {@link framePool}'s threads.
 *
 * Frames a segment's logical bytes in one of its slots — `SharedArrayBuffer`s
 * the pool hands it once and reuses — with the frame writer the inline writer
 * uses, so the bytes cannot differ, and flips the slot's status cell. Only
 * bytes cross the thread boundary — never an East value.
 *
 * A job allocates no buffer: the frame is written into the slot's output, and
 * the deflate works in one scratch this worker keeps. A worker's garbage
 * collector rarely runs, so a buffer allocated per frame would be held until it
 * did (#841).
 *
 * @packageDocumentation
 */

import { parentPort, workerData } from "node:worker_threads";
import { FRAME_STATUS, type FrameJob } from "./frame-pool.js";
import { DeflateScratch } from "./deflate.js";
import { writeFrameInto } from "./frames.js";

// Report that this worker loaded — the pool hands itself out only once every
// worker has (see `framePool`).
const { ready, index } = workerData as { ready: SharedArrayBuffer; index: number };
const readyCells = new Int32Array(ready);
Atomics.store(readyCells, index, 1);
Atomics.notify(readyCells, index);

/** A slot's buffers, as this worker views them. */
interface Slot {
  input: Uint8Array;
  output: Uint8Array;
  status: Int32Array;
}

const slots = new Map<number, Slot>();
const scratch = new DeflateScratch();

parentPort?.on("message", (job: FrameJob) => {
  if (job.buffers !== undefined) {
    slots.set(job.slot, {
      input: new Uint8Array(job.buffers.input),
      output: new Uint8Array(job.buffers.output),
      status: new Int32Array(job.buffers.status),
    });
  }
  const slot = slots.get(job.slot)!;
  try {
    Atomics.store(slot.status, 1, writeFrameInto(slot.output, slot.input.subarray(0, job.length), job.codec, scratch));
    Atomics.store(slot.status, 0, FRAME_STATUS.DONE);
  } catch {
    Atomics.store(slot.status, 0, FRAME_STATUS.FAILED);
  }
  Atomics.notify(slot.status, 0);
});
