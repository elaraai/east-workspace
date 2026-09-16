/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Partition fan-in by segment merge (issue #764).
 *
 * `combine` folds partials pairwise, and every level of that tree materializes
 * the whole output so far: the runner decodes both partials, unions them in
 * memory, and re-encodes the result. Measured on a 2 GB output in 8 partitions,
 * the fan-out was 52 s and the fan-in 666 s — and after a 2 % append, seven of
 * eight partitions cached while the three merges on the changed spine re-ran.
 * The fan-in, not the fan-out, is what memoization cannot save.
 *
 * Partials are canonical v5 collection blobs: strictly ascending, disjoint
 * segments with a fence per segment. So k partials merge with a k-way walk over
 * those fences, in the orchestrator, in one pass:
 *
 * - A segment whose key range no other partial reaches is emitted as a
 *   BYTE-COPIED span — exactly what a splice does, and exactly what disjoint
 *   partials are made of. This is the case for every re-key or per-entity
 *   aggregation whose partition key is a prefix of the output key.
 * - Segments that do overlap are decoded, merged element by element with the
 *   East comparator (equal keys resolved by the task's per-key function, or by
 *   union for a Set), and re-encoded under the partials' shared header bytes.
 *
 * Memory is O(k open segments + one output batch); the deflate is paid only for
 * rebuilt segments; there is no runner process.
 *
 * What it deliberately does NOT do: parallelize an overlapping merge. A body
 * that emits every partition's rows under one small key set decodes and
 * rebuilds most segments on one thread. The bound is "overlap only".
 *
 * @packageDocumentation
 */

import { compareFor, rebuildBeast2, type EastTypeValue } from '@elaraai/east';
import { bufferPart, spliceChunks, type PartitionBlob, type SplicePart } from './partitionIo.js';
import type { StorageBackend } from '../storage/interfaces.js';

/** Elements per rebuilt output segment. The partials' own segments are the
 *  natural unit, and a merged run is bounded by the same order of magnitude —
 *  this only caps a pathological overlap where every partial collides. */
const MERGE_BATCH_ELEMENTS = 4096;

/**
 * A per-key resolution for a Dict output, compiled from the task's `merge` IR.
 *
 * Called only for a key that is actually present in two partials.
 */
export type MergeResolve = (key: unknown, a: unknown, b: unknown) => unknown;

/** One partial's walk state: where its segment cursor is, and what it has
 *  decoded but not yet emitted. */
interface Cursor {
  readonly blob: PartitionBlob;
  /** Next segment not yet consumed. */
  segment: number;
  /** Decoded entries not yet emitted, in canonical order. */
  buffer: [unknown, unknown][];
  /** Read position within `buffer`. */
  at: number;
}

/**
 * Merge keyed partials into one canonical blob, by segment.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param partials - The partials, in partition order (their key ranges may
 *   overlap; the walk orders by key, not by partition)
 * @param resolve - Per-key resolution for a Dict output; `null` for a Set,
 *   whose elements need none
 * @returns The merged output's object hash
 * @throws {Error} When the partials do not share header bytes, or a partial is
 *   not self-contained — the same refusals a splice makes.
 */
export async function mergePartialsBySegments(
  storage: StorageBackend,
  repo: string,
  partials: readonly PartitionBlob[],
  resolve: MergeResolve | null,
): Promise<string> {
  const first = partials[0]!;
  const head = first.extents.head;
  const typeValue = first.extents.typeValue;
  const isDict = typeValue.type === 'Dict';
  const keyTypeValue: EastTypeValue = isDict
    ? (typeValue as EastTypeValue & { value: { key: EastTypeValue } }).value.key
    : (typeValue as EastTypeValue & { value: EastTypeValue }).value;
  const cmp = compareFor(keyTypeValue as never) as (a: unknown, b: unknown) => number;

  return storage.objects.writeStream(
    repo,
    spliceChunks(head, mergeParts(partials, head, isDict, cmp, resolve)),
  );
}

/**
 * The ordered splice parts of a merge: byte-copied spans where the partials
 * are disjoint, rebuilt blobs where they overlap.
 *
 * Yielded lazily, so a rebuilt part is streamed to the object store and
 * dropped rather than held until the walk ends — peak memory stays O(k open
 * segments + one output batch) however much of the output overlaps. Exported
 * because the SHAPE of an assembly (how much was copied, how much rebuilt) is
 * the whole claim this mode makes, and a spec can only assert it here.
 *
 * @param partials - The partials, in partition order
 * @param head - The shared header bytes every part must carry
 * @param isDict - Whether the output root is a Dict (else a Set)
 * @param cmp - The East comparator for the output's key type
 * @param resolve - Per-key resolution for a Dict; `null` for a Set
 * @returns The parts, in key order
 */
export async function* mergeParts(
  partials: readonly PartitionBlob[],
  head: Uint8Array,
  isDict: boolean,
  cmp: (a: unknown, b: unknown) => number,
  resolve: MergeResolve | null,
): AsyncGenerator<SplicePart> {
  const cursors: Cursor[] = partials.map((blob) => ({ blob, segment: 0, buffer: [], at: 0 }));
  let batch: [unknown, unknown][] = [];

  /** The blob's extents, for the rebuild's header reuse. */
  const extents = partials[0]!.extents;

  const takeBatch = (): SplicePart | null => {
    if (batch.length === 0) return null;
    const value = isDict
      ? new Map(batch)
      : new Set(batch.map(([key]) => key));
    batch = [];
    return bufferPart(rebuildBeast2(head, [value], { extents }));
  };

  /** Entries still buffered and unread in `c`. */
  const pending = (c: Cursor): number => c.buffer.length - c.at;
  /** Segments `c` has not yet consumed. */
  const segmentsLeft = (c: Cursor): number => c.blob.extents.offsets.length - c.segment;
  /** The smallest key `c` can still produce, or `undefined` when it is done. */
  const nextKey = async (c: Cursor): Promise<unknown> => {
    if (pending(c) > 0) return c.buffer[c.at]![0];
    if (segmentsLeft(c) > 0) return c.blob.fence(c.segment);
    return undefined;
  };
  const decodeInto = async (c: Cursor): Promise<void> => {
    const decoded = await c.blob.segmentValue(c.segment);
    c.segment++;
    const entries: [unknown, unknown][] = isDict
      ? [...(decoded as Map<unknown, unknown>).entries()]
      : [...(decoded as Iterable<unknown>)].map((element) => [element, element] as [unknown, unknown]);
    // Keep the unread tail: a decode can land while earlier entries of the
    // same cursor are still waiting behind a lower key elsewhere.
    c.buffer = pending(c) > 0 ? [...c.buffer.slice(c.at), ...entries] : entries;
    c.at = 0;
  };

  for (;;) {
    const live = cursors.filter((c) => pending(c) > 0 || segmentsLeft(c) > 0);
    if (live.length === 0) break;

    const buffered = live.filter((c) => pending(c) > 0);
    if (buffered.length === 0) {
      // Nothing decoded: the byte-splice fast path. Take the partial whose
      // next segment starts lowest; if no other partial reaches into that
      // segment's key range, its frame bytes go out untouched.
      let chosen = live[0]!;
      let chosenKey = await nextKey(chosen);
      for (const c of live.slice(1)) {
        const key = await nextKey(c);
        if (cmp(key, chosenKey) < 0) {
          chosen = c;
          chosenKey = key;
        }
      }
      // The segment's keys are bounded above by the next fence (exclusive),
      // or — for a partial's last segment — by the partial's own last key
      // (inclusive), which costs one decode per partial and is what lets a
      // disjoint partial's tail go out as bytes too.
      const isLast = chosen.segment + 1 >= chosen.blob.extents.offsets.length;
      const upper = isLast ? await chosen.blob.lastKey() : await chosen.blob.fence(chosen.segment + 1);
      let disjoint = true;
      for (const c of live) {
        if (c === chosen) continue;
        const next = await nextKey(c);
        // Exclusive bound: another partial's keys must reach at least it.
        // Inclusive bound (the last key): they must lie strictly above it.
        const clash = isLast ? cmp(next, upper) <= 0 : cmp(next, upper) < 0;
        if (clash) { disjoint = false; break; }
      }
      if (disjoint) {
        // Order matters: a byte-copied span must follow everything already
        // merged, so the pending batch goes out first.
        const pendingBatch = takeBatch();
        if (pendingBatch) yield pendingBatch;
        yield chosen.blob.spanPart(chosen.segment, chosen.segment + 1);
        chosen.segment++;
        continue;
      }
      await decodeInto(chosen);
      continue;
    }

    // Some entries are buffered. Everything strictly below the smallest key
    // that could still arrive from an undecoded segment is safe to emit —
    // and that includes the undecoded segments of cursors that ALSO hold
    // buffered entries: `c.segment` is always the next undecoded one.
    let limit: unknown;
    let bounded = false;
    for (const c of live) {
      if (segmentsLeft(c) === 0) continue;
      const fence = await c.blob.fence(c.segment);
      if (!bounded || cmp(fence, limit) < 0) {
        limit = fence;
        bounded = true;
      }
    }

    const emitted = emitBelow(buffered, limit, bounded, cmp, isDict, resolve, batch);
    if (emitted === 0) {
      // Every buffered key is at or above the limit: decode the segment that
      // set it, which is the only way the walk advances.
      let chosen: Cursor | null = null;
      let chosenFence: unknown;
      for (const c of live) {
        if (segmentsLeft(c) === 0) continue;
        const fence = await c.blob.fence(c.segment);
        if (chosen === null || cmp(fence, chosenFence) < 0) {
          chosen = c;
          chosenFence = fence;
        }
      }
      if (chosen === null) break;
      await decodeInto(chosen);
      continue;
    }
    if (batch.length >= MERGE_BATCH_ELEMENTS) {
      const full = takeBatch();
      if (full) yield full;
    }
  }

  const tail = takeBatch();
  if (tail) yield tail;
}

/**
 * Move every buffered entry strictly below `limit` into `batch`, resolving
 * equal keys.
 *
 * @returns how many entries were consumed
 */
function emitBelow(
  buffered: readonly Cursor[],
  limit: unknown,
  bounded: boolean,
  cmp: (a: unknown, b: unknown) => number,
  isDict: boolean,
  resolve: MergeResolve | null,
  batch: [unknown, unknown][],
): number {
  let consumed = 0;
  for (;;) {
    // The smallest buffered key across the cursors.
    let best: Cursor | null = null;
    for (const c of buffered) {
      if (c.at >= c.buffer.length) continue;
      if (best === null || cmp(c.buffer[c.at]![0], best.buffer[best.at]![0]) < 0) best = c;
    }
    if (best === null) return consumed;
    const [key, value] = best.buffer[best.at]!;
    if (bounded && cmp(key, limit) >= 0) return consumed;

    // Every cursor holding the same key contributes; a Dict resolves them
    // through the task's function, a Set's elements ARE the resolution.
    let merged = value;
    best.at++;
    consumed++;
    for (const c of buffered) {
      while (c.at < c.buffer.length && cmp(c.buffer[c.at]![0], key) === 0) {
        const other = c.buffer[c.at]![1];
        if (isDict) {
          if (resolve === null) {
            throw new Error(
              `partition merge: key collision in a Dict output with no per-key merge — ` +
              `this is a bug in the executor's mode selection`
            );
          }
          merged = resolve(key, merged, other);
        }
        c.at++;
        consumed++;
      }
    }
    batch.push([key, merged]);
  }
}
