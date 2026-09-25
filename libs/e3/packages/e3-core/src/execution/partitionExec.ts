/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The byte-level steps of a fan-out — bounded-memory fan-out and fan-in over
 * canonical beast2 segments (issue #770).
 *
 * A record's index build (`recordSteps.ts`) runs as plan → map → merge →
 * splice over these: {@link planPartitions} reads the input's segment index
 * and chooses partition boundaries (deterministically, from the index and the
 * byte target); {@link carvePartitionSlices} carves a partition's slice by byte
 * copy; {@link planMergeRanges} chooses the key ranges a merged component's
 * fan-in runs over and writes them as the range blobs its merge units take as
 * an input — nothing is carved for a range: each runner seeks every partial to
 * it; {@link spliceBlobs} assembles stored collections through the store's
 * door, validating the canonical shard order. A split task's merges plan their
 * ranges with {@link planMergeRanges} too.
 *
 * Because each per-partition execution is content-addressed by its task and
 * inputs, and boundaries are a pure function of the input blob and the byte
 * target, partition-level memoization rides the existing execution cache: appends
 * and tail-localized changes leave earlier slices byte-identical and their
 * executions cache-hit. A mid-key-space insertion shifts subsequent segment
 * packing, so partitions after the insertion point re-run — append-friendly,
 * not general.
 *
 * Orchestrator memory is bounded too (issue #506): blobs are addressed by
 * their ranged extents, boundary probes decode one segment at a time, slices
 * stream to the object store chunk by chunk, and the assembled output is
 * written a segment at a time — the orchestrator never holds a whole input,
 * slice or shard.
 */

import {
  OptionType,
  StructType,
  compareFor,
  encodeBeast2For,
  fromEastTypeValue,
  none,
  segmentKeyTypeOf,
  some,
  toEastTypeValue,
} from '@elaraai/east';
import type { EastTypeValue } from '@elaraai/east';
import { PartitionBlob, spliceChunks } from './partitionIo.js';
import type { PartitionPlan } from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/interfaces.js';
import { DatasetSegments } from '../dataset-open.js';
import { storeCollection } from '../store-collection.js';

/** What {@link planPartitions} plans over. */
export interface PlanRequest {
  /** The input's hash. */
  primary: string;
  /** Target carved-slice size in wire bytes. */
  targetBytes: number;
}

/**
 * Plans a partitioned execution: the partition boundaries of the input, by
 * greedy byte packing of its segments. Deterministic — a pure function of the
 * segment index and the byte target — and bounded: nothing but the index is
 * read.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param request - The input and the byte target
 * @returns The plan (its `slices` empty) and its number of partitions
 * @throws {Error} When the input is not a segmented, indexed collection.
 */
export async function planPartitions(
  storage: StorageBackend,
  repo: string,
  request: PlanRequest,
): Promise<{ plan: PartitionPlan; partitions: number }> {
  let primary: PartitionBlob;
  try {
    primary = await PartitionBlob.open(storage, repo, request.primary);
  } catch (err) {
    throw new Error(
      `Partitioned input is not a segmented, indexed beast2 v5 collection blob (${err instanceof Error ? err.message : err}) — ` +
      `re-write the dataset so it carries a segment index`
    );
  }
  const extents = primary.extents;
  primary.release();

  const segCount = extents.offsets.length;
  const boundaries: number[] = [0];
  let acc = 0;
  for (let i = 0; i < segCount; i++) {
    const size = (i + 1 < segCount ? extents.offsets[i + 1]! : extents.segmentsEnd) - extents.offsets[i]!;
    if (acc > 0 && acc + size > request.targetBytes) {
      boundaries.push(i);
      acc = 0;
    }
    acc += size;
  }
  return {
    plan: {
      partitions: [request.primary],
      boundaries: boundaries.map((b) => BigInt(b)),
      splits: [],
      slices: [],
      merges: [],
    },
    partitions: boundaries.length,
  };
}

/**
 * The type of the key range a merge unit takes as an input: `[from, to)`
 * as `Struct{from: Option<K>, to: Option<K>}` over the output's key type, a
 * bound `none` when open — the shape every stock runner's `merge --range`
 * reads (east-node `merge.ts`, east-c `merge.c`).
 *
 * @param keyType - The output's key (Dict) or element (Set) type
 * @returns The range type
 */
export function mergeRangeTypeValue(keyType: EastTypeValue): EastTypeValue {
  const key = fromEastTypeValue(keyType);
  return toEastTypeValue(StructType({ from: OptionType(key), to: OptionType(key) }));
}

/**
 * Plans the ranged fan-in of one merged component: the key ranges its merge
 * units run over, written to the object store as the range blobs the units
 * take as their input. Deterministic — a pure function of the partials'
 * manifests and the byte target — and bounded: the sizes and the boundary keys
 * are read from the manifests, and no segment is read.
 *
 * The number of ranges is the component's stored bytes over `targetBytes`,
 * capped by the segments of its largest partial (the pilot), whose fences
 * supply the boundary keys: the pilot's segments pack greedily into runs of
 * about equal bytes, and each run after the first starts a range at its first
 * fence. A component of one range — any component smaller than the target —
 * merges its partials whole, over the open range. Each merge unit's runner
 * then seeks every partial to the segment owning its range's lower bound and
 * stops at the first key at or past its upper bound, so a unit reads its
 * range's share of every partial, plus at most one segment.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param partials - The component's partial hashes, in partition order; at least one
 * @param targetBytes - The stored bytes one merge unit's ranged inputs aim for
 * @returns The range blobs' hashes, in key order; at least one
 * @throws {Error} When a partial is not a Set or Dict, or a read fails.
 */
export async function planMergeRanges(
  storage: StorageBackend,
  repo: string,
  partials: readonly string[],
  targetBytes: number,
): Promise<string[]> {
  if (partials.length === 0) throw new Error('planMergeRanges: no partials');

  let totalBytes = 0;
  let pilot: DatasetSegments | null = null;
  let pilotBytes = -1;
  for (const hash of partials) {
    const segments = await DatasetSegments.open(storage, repo, hash);
    if (segments.typeValue.type !== 'Dict' && segments.typeValue.type !== 'Set') {
      throw new Error(`partition merge applies to Dict and Set outputs, got ${segments.typeValue.type}`);
    }
    let bytes = 0;
    for (let i = 0; i < segments.segmentCount; i++) bytes += segments.segmentBytes(i);
    totalBytes += bytes;
    if (bytes > pilotBytes) {
      pilot = segments;
      pilotBytes = bytes;
    }
  }
  const lead = pilot!;
  const ranges = Math.max(1, Math.min(Math.ceil(totalBytes / Math.max(1, targetBytes)), lead.segmentCount));

  // The boundary keys: the pilot's fences where its segments, packed greedily
  // into `ranges` runs of about equal bytes, start a new run.
  const bounds: unknown[] = [];
  if (ranges > 1) {
    const runBytes = pilotBytes / ranges;
    let acc = 0;
    for (let i = 0; i < lead.segmentCount && bounds.length < ranges - 1; i++) {
      const size = lead.segmentBytes(i);
      if (acc > 0 && acc + size > runBytes) {
        bounds.push(await lead.fence(i));
        acc = 0;
      }
      acc += size;
    }
  }

  // The range blobs: `[from, to)` per range, the first open below and the
  // last open above — the one open range when there is no boundary.
  const encode = encodeBeast2For(mergeRangeTypeValue(segmentKeyTypeOf(lead.typeValue)!));
  const hashes: string[] = [];
  for (let r = 0; r <= bounds.length; r++) {
    const from = r === 0 ? none : some(bounds[r - 1]);
    const to = r === bounds.length ? none : some(bounds[r]);
    hashes.push(await storage.objects.write(repo, encode({ from, to })));
  }
  return hashes;
}

/**
 * Carves one partition's slice of the input, as a plan names it: the
 * segments from `boundaries[p]` up to the next boundary, by byte copy. The
 * slice streams to the object store; the input is never read whole.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param plan - The partition plan (its `slices` are not read)
 * @param p - Zero-based partition index
 * @returns The partition's slice hash, as a one-element list
 * @throws {RangeError} When `p` is not a partition of the plan.
 */
export async function carvePartitionSlices(
  storage: StorageBackend,
  repo: string,
  plan: PartitionPlan,
  p: number,
): Promise<string[]> {
  const partitions = plan.boundaries.length;
  if (!Number.isInteger(p) || p < 0 || p >= partitions) {
    throw new RangeError(`partition ${p} is not one of the plan's ${partitions} partitions`);
  }
  const primary = await PartitionBlob.open(storage, repo, plan.partitions[0]!);
  const from = Number(plan.boundaries[p]!);
  const to = p + 1 < partitions ? Number(plan.boundaries[p + 1]!) : primary.extents.offsets.length;
  return [await storage.objects.writeStream(repo, spliceChunks(primary.extents.head, [primary.spanPart(from, to)]))];
}

/** The blobs a splice was given do not ascend disjointly in key order: the
 *  keys of blob `right` (0-based) do not all follow those of blob `left`, the
 *  last non-empty blob before it. */
export class SpliceOrderError extends Error {
  readonly left: number;
  readonly right: number;

  constructor(left: number, right: number, count: number) {
    super(`blobs ${left + 1} and ${right + 1} of ${count} do not ascend disjointly in key order`);
    this.left = left;
    this.right = right;
  }
}

/**
 * Assembles stored collections into one, in the given order, through the
 * store's door: every segment of every collection is carried over by
 * reference, and only the seams between them are re-cut, so the result is the
 * manifest the Writer writes for the whole value and no value is decoded but
 * at a seam. Set and Dict collections must ascend disjointly in key order,
 * which is checked first, one collection at a time; Array collections
 * concatenate freely.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param hashes - The collections to assemble, in order; at least one
 * @returns The hash of the assembled collection's manifest
 * @throws {Error} When `hashes` is empty, the keys do not ascend disjointly
 *   ({@link SpliceOrderError}), or a collection holds another type than the
 *   first.
 */
export async function spliceBlobs(storage: StorageBackend, repo: string, hashes: string[]): Promise<string> {
  if (hashes.length === 0) {
    throw new Error('spliceBlobs: no blobs to splice');
  }
  const violation = await findSpliceViolation(storage, repo, hashes);
  if (violation !== null) {
    throw new SpliceOrderError(violation.left, violation.right, hashes.length);
  }
  const { typeValue } = await DatasetSegments.open(storage, repo, hashes[0]!);
  return storeCollection(storage, repo, typeValue, hashes.map((hash) => ({ stored: hash })));
}

/**
 * Validates the splice contract for Set/Dict blobs: adjacent non-empty
 * blobs' key ranges must ascend disjointly in the given order. Bounded: one
 * blob is open at a time, and only its first fence and last segment decode.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param hashes - The blobs, in splice order
 * @returns The offending pair, or `null` when the blobs splice cleanly (Array
 *   blobs concatenate freely)
 */
export async function findSpliceViolation(
  storage: StorageBackend,
  repo: string,
  hashes: string[],
): Promise<{ left: number; right: number } | null> {
  let prevIndex = -1;
  let prevLast: unknown;
  let cmp: ((a: unknown, b: unknown) => number) | null = null;
  for (let i = 0; i < hashes.length; i++) {
    const shard = await PartitionBlob.open(storage, repo, hashes[i]!);
    try {
      const extents = shard.extents;
      if (extents.typeValue.type === 'Array') return null;
      if (extents.offsets.length === 0) continue;
      cmp ??= compareFor(segmentKeyTypeOf(extents.typeValue)!) as (a: unknown, b: unknown) => number;
      const first = await shard.fence(0);
      if (prevIndex >= 0 && cmp(prevLast, first) >= 0) {
        return { left: prevIndex, right: i };
      }
      prevLast = await shard.lastKey();
      prevIndex = i;
    } finally {
      shard.release();
    }
  }
  return null;
}
