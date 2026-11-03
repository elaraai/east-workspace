/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A `first` split call's run (#1110): the task's pieces in input order, a few
 * at a time, stopped once the pieces finished in an unbroken run from the
 * first hold the call's limit, and the first `limit` elements stored.
 *
 * @packageDocumentation
 */

import { decodeBeast2For } from '@elaraai/east';
import { decodeTaskObject, type PartitionProgress } from '@elaraai/e3-types';
import { DatasetSegments } from '../dataset-open.js';
import { storeCollection, type CollectionSource } from '../store-collection.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { SplitUnit, TaskResult, TaskRunner } from './interfaces.js';
import { pieceSizes, planPieces } from './pieces.js';

/** How many units a `first` call keeps running at once when its host names
 *  no width. */
export const FIRST_CALL_WIDTH = 4;

/** Options for {@link runFirstPieces}. */
export interface FirstPiecesOptions {
  /** How many units it keeps running at once: at least 1. */
  readonly width: number;
  /** Stops the run: the units running are stopped, and it answers cancelled. */
  readonly signal: AbortSignal;
  /** Pass `-v` to the stock runners. */
  readonly verbose?: boolean;
  /** Told as each piece starts and finishes. */
  readonly onPartitionProgress?: (progress: PartitionProgress) => void;
}

/**
 * Runs an `array` split task's pieces for a `first` call: in input order, at
 * most `width` at once, each within `width` of the first piece not finished,
 * until the pieces finished in an unbroken run from the first hold `limit`
 * elements.
 *
 * @remarks
 * The pieces are the ones the engine plans ({@link planPieces}), each run
 * through `runner.executeUnit` as the engine runs it, so a piece is served
 * from the execution cache when it ran before, and an `array` call of the same
 * program is served the pieces this one ran. Once a piece finishes, its
 * element count is read from its manifest. A piece starts only within `width`
 * of the first piece not finished, so while piece `k` runs none past
 * `k + width` starts. Once the pieces finished from the first hold `limit`
 * elements, the units still running are stopped and none after them starts.
 * Fewer than `width` pieces past the end may have started, and those that
 * finished stay cached.
 *
 * The first `limit` elements — every element when the pieces hold fewer — are
 * stored through the store's door: the whole pieces by reference, and the
 * first elements of the last, its whole segments by reference too. No
 * execution of the task is recorded, as its whole output was never assembled;
 * the result names none.
 *
 * A piece that fails ends the run as the task's lowest failing unit would,
 * when the answer needs it: when the pieces before it hold fewer than `limit`
 * elements. Past the end, it does not matter.
 *
 * @param storage - Storage backend
 * @param runner - Runs the pieces
 * @param repo - Repository identifier
 * @param taskHash - The task: an `array` split call's
 * @param inputs - Its input hashes, in input order
 * @param limit - How many elements to answer: at least 1
 * @param options - The width, the signal, verbosity and progress
 * @returns The result, as `TaskRunner.execute` answers a task's: `success`
 *   with the stored first elements as its output; the failure of the piece
 *   the answer needed; or `error`, `cancelled`, once the signal stopped it
 */
export async function runFirstPieces(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  taskHash: string,
  inputs: readonly string[],
  limit: number,
  options: FirstPiecesOptions,
): Promise<TaskResult> {
  const { signal } = options;
  const ended = (error: string, cancelled = false): TaskResult => ({
    state: 'error', cached: false, executionId: '', error, ...(cancelled && { cancelled }),
  });
  const task = decodeTaskObject(await storage.objects.read(repo, taskHash));
  let pieces: string[][];
  try {
    ({ pieces } = await planPieces(storage, repo, task.inputs, inputs, pieceSizes, { signal }));
  } catch (err) {
    if (signal.aborted) return ended('cancelled: the run was stopped', true);
    return ended(`Failed to plan the task's pieces: ${err instanceof Error ? err.message : String(err)}`);
  }
  // A task that cuts one piece runs as its own unit, as the engine runs it.
  const units: SplitUnit[] = pieces.length === 1
    ? [{ inputs: [...inputs], merge: null, own: true }]
    : pieces.map((piece) => ({ inputs: [...piece], merge: null, own: false }));
  const total = units.length;
  const stops = units.map(() => new AbortController());
  const finished: (DatasetSegments | undefined)[] = new Array<DatasetSegments | undefined>(total);
  // Each set by the lanes, which the compiler does not follow: the lowest
  // piece that failed, and the last piece the answer needs, once it is known.
  let failure = null as { index: number; result: TaskResult } | null;
  let cut = null as number | null;
  let next = 0;
  let completed = 0;
  let peakBytes: number | undefined;

  /** Finds the end: the pieces finished from the first holding `limit`
   *  elements, every piece finished, or the failed piece the answer needs. */
  const settle = (): void => {
    let held = 0;
    for (let i = 0; i < total; i++) {
      if (failure?.index === i) {
        for (const stop of stops) stop.abort();
        return;
      }
      const done = finished[i];
      if (done === undefined) return;
      held += done.elementCount;
      if (held >= limit) {
        cut = i;
        for (const stop of stops.slice(i + 1)) stop.abort();
        return;
      }
    }
    cut = total - 1;
  };

  /** Runs piece `i`, and settles what it finished. */
  const run = async (i: number): Promise<void> => {
    options.onPartitionProgress?.({ phase: 'partition', index: i, total, completed, state: 'started' });
    const started = Date.now();
    let result: TaskResult;
    try {
      result = await runner.executeUnit(storage, taskHash, units[i]!, {
        signal: AbortSignal.any([signal, stops[i]!.signal]),
        ...(options.verbose !== undefined && { verbose: options.verbose }),
      });
      // Stopped past the end, or with the run: no failure of the call's.
      if (stops[i]!.signal.aborted || signal.aborted) return;
      if (result.state === 'success' && result.outputHash !== undefined) {
        finished[i] = await DatasetSegments.open(storage, repo, result.outputHash);
        if (result.peakBytes !== undefined) peakBytes = Math.max(peakBytes ?? 0, result.peakBytes);
        completed++;
        options.onPartitionProgress?.({
          phase: 'partition', index: i, total, completed, state: 'completed', cached: result.cached, duration: Date.now() - started,
        });
        settle();
        return;
      }
    } catch (err) {
      if (stops[i]!.signal.aborted || signal.aborted) return;
      result = ended(`piece ${i + 1} of ${total} could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (failure === null || i < failure.index) failure = { index: i, result };
    for (const stop of stops.slice(i + 1)) stop.abort();
    settle();
  };

  const running = new Map<number, Promise<void>>();
  let low = 0;
  for (;;) {
    // Each piece within `width` of the first not finished, in input order.
    while (low < total && finished[low] !== undefined) low++;
    while (cut === null && !signal.aborted && next < total && next < low + options.width && (failure === null || next < failure.index)) {
      const i = next++;
      running.set(i, run(i).finally(() => running.delete(i)));
    }
    if (running.size === 0) break;
    await Promise.race(running.values());
  }
  if (signal.aborted) return ended('cancelled: the run was stopped', true);
  // With no end found, the answer needed the piece that failed.
  if (cut === null) return failure?.result ?? ended('the pieces stopped with no end found');

  // The first `limit` elements: whole pieces, then the start of the last.
  const sources: CollectionSource[] = [];
  let left = limit;
  for (let i = 0; i <= cut && left > 0; i++) {
    const piece = finished[i]!;
    if (piece.elementCount <= left) {
      sources.push({ stored: piece.hash, manifest: piece.manifest });
      left -= piece.elementCount;
      continue;
    }
    let whole = 0;
    while (piece.counts[whole]! <= left) left -= piece.counts[whole++]!;
    if (whole > 0) sources.push({ stored: piece.hash, from: 0, to: whole, manifest: piece.manifest });
    if (left > 0) {
      const elements = decodeBeast2For(piece.typeValue)(await piece.segment(whole)) as unknown[];
      sources.push({ elements: elements.slice(0, left) });
    }
    left = 0;
  }
  const outputHash = await storeCollection(storage, repo, finished[0]!.typeValue, sources);
  return { state: 'success', cached: false, executionId: '', outputHash, ...(peakBytes !== undefined && { peakBytes }) };
}
