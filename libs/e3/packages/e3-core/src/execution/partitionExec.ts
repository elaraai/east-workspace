/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The byte-level steps of partitioned execution — bounded-memory fan-out and
 * fan-in over canonical beast2 segments (issue #770).
 *
 * The template interpreter (`steps.ts`) runs a partitioned task as plan →
 * map → reduce/splice; this module supplies the plan and the byte hooks:
 * {@link planPartitions} reads the primary partitioned input's segment index
 * and chooses partition boundaries (deterministically, from the index + the
 * `by` projection + `targetPartitionBytes`) and each co-partitioned
 * secondary's split points; {@link carvePartitionSlices} carves a
 * partition's slices (byte copy; at most the two edge segments of each
 * secondary are re-encoded); {@link planMergeRanges} chooses the key ranges
 * a merged component's fan-in runs over and writes them as the range blobs
 * its merge units take as an input — nothing is carved for a range: each
 * runner seeks every partial to it; {@link spliceBlobs} splices stored
 * blobs under one header, validating the canonical shard order. The local
 * interpreter calls these directly; a remote backend supplies its kernel's
 * carve and splice.
 *
 * Because each per-partition execution is content-addressed by
 * `(taskHash, inputsHash([functionIr, ...slices, ...broadcast]))` and
 * boundaries are a pure function of the input blob + task metadata,
 * partition-level memoization rides the existing execution cache: appends
 * and tail-localized changes leave earlier slices byte-identical and their
 * executions cache-hit. A mid-key-space insertion shifts subsequent segment
 * packing, so partitions after the insertion point re-run — append-friendly,
 * not general.
 *
 * Orchestrator memory is bounded too (issue #506): blobs are addressed by
 * their ranged extents, boundary probes decode one segment at a time, and
 * slices and the spliced output stream to the object store chunk by chunk —
 * the orchestrator never holds a whole input, slice or shard. On a backend
 * without ranged reads each blob degrades to one whole read behind the same
 * code path.
 */

import {
  OptionType,
  StructType,
  compareFor,
  decodeEastIR,
  encodeBeast2For,
  equalFor,
  fromEastTypeValue,
  none,
  rebuildBeast2,
  some,
  toEastTypeValue,
} from '@elaraai/east';
import type { EastTypeValue, FunctionTypeValue } from '@elaraai/east';
import { PartitionBlob, bufferPart, spliceChunks, type SplicePart } from './partitionIo.js';
import {
  PartitionPlanType,
  decodePartitionPlan,
  partitionProjectionShape,
  projectKey,
  projectedKeyType,
  type MergeRangePlan,
  type PartitionPlan,
  type ProjectionShape,
  type TaskObject,
} from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/interfaces.js';
import type { ExecuteOptions, ExecutionResult } from './LocalTaskRunner.js';

export { partitionTaskExecute } from './steps.js';

/** A carve position: the first element of the slice, as a segment index and
 *  an element offset within that segment (`offset` 0 = the segment start). */
export interface SplitPoint {
  seg: number;
  offset: number;
}

/**
 * Runs one unit of a partitioned task — a partition execution, a combine step
 * or a merge unit — once the interpreter's own cache probe has missed (or
 * `force` skipped it): the unit is an ordinary content-addressed execution of
 * `task` over `inputHashes`, recorded under a fresh execution id.
 *
 * @remarks
 * The local default runs the standard execution body in this process; a
 * remote backend supplies its own, so the orchestration (planning, carving,
 * caching, the tree) stays in e3-core whatever runs the unit.
 */
export type PartitionUnitExecutor = (taskHash: string, task: TaskObject, inputHashes: string[], options: ExecuteOptions) => Promise<ExecutionResult>;

/** What {@link planPartitions} plans over. */
export interface PlanRequest {
  /** The primary partitioned input's hash. */
  primary: string;
  /** The co-partitioned secondaries' hashes, in wire order. */
  secondaries: string[];
  /** The `by` projection's IR bundle, or `null` for free partitioning. */
  by: Uint8Array | null;
  /** Target carved-slice size in wire bytes. */
  targetBytes: number;
}

/**
 * Plans a partitioned execution: the partition boundaries of the primary
 * (greedy byte packing, then `by` alignment so rows with equal projections
 * never split across partitions) and each co-partitioned secondary's split
 * point at every boundary. Deterministic — a pure function of the segment
 * indexes, `by` and the byte target — and bounded: one decoded segment at a
 * time.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param request - The inputs, the projection and the byte target
 * @returns The plan (its `slices` empty) and its number of partitions
 * @throws {Error} With the logical execution's error message: an input that
 *   is not a segmented, indexed collection; a `by` projection that does not
 *   decode or is not a leading-prefix key read; a boundary probe that fails;
 *   a co-partitioned primary whose projected partition boundaries, or a
 *   secondary whose projected fences, do not ascend.
 */
export async function planPartitions(
  storage: StorageBackend,
  repo: string,
  request: PlanRequest,
): Promise<{ plan: PartitionPlan; partitions: number }> {
  const partitionHashes = [request.primary, ...request.secondaries];

  // ---------------------------------------------------------------------
  // Primary geometry + the boundary projection.
  // ---------------------------------------------------------------------
  let primary: PartitionBlob;
  try {
    primary = await PartitionBlob.open(storage, repo, request.primary);
  } catch (err) {
    throw new Error(
      `Partitioned input is not a segmented, indexed beast2 v5 collection blob (${err instanceof Error ? err.message : err}) — ` +
      `re-write the dataset so it carries a segment index`
    );
  }
  const primaryExtents = primary.extents;

  const rootKind = primaryExtents.typeValue.type as 'Array' | 'Set' | 'Dict';
  const keyTypeValue: EastTypeValue = rootKind === 'Dict'
    ? (primaryExtents.typeValue as any).value.key
    : (primaryExtents.typeValue as any).value;

  // `by` is evaluated by reading key fields, never by compiling its IR: the
  // SDK builds only leading-prefix projections (the key itself, leading
  // fields, a first-field path), so the IR's shape is the projection. The
  // projected keys compare under the type the projection was built over —
  // the `by` IR's parameter type, which under co-partitioning is the shared
  // key fields rather than the primary's own key.
  let projOf = (k: unknown): unknown => k;
  let cmpOf = compareFor(keyTypeValue as any) as (a: unknown, b: unknown) => number;
  if (request.by !== null) {
    let shape: ProjectionShape | null;
    let byKeyType: EastTypeValue;
    try {
      const ir = decodeEastIR(request.by).ir;
      shape = partitionProjectionShape(ir);
      byKeyType = (ir.value.type as FunctionTypeValue).value.inputs[0] as EastTypeValue;
    } catch (err) {
      primary.release();
      throw new Error(`Failed to decode the partition \`by\` projection: ${err}`);
    }
    if (shape === null) {
      primary.release();
      throw new Error('partition by projection is not a leading-prefix key projection — re-export the package with the current SDK');
    }
    const byShape = shape;
    try {
      cmpOf = compareFor(projectedKeyType(byShape, byKeyType) as any) as (a: unknown, b: unknown) => number;
    } catch (err) {
      primary.release();
      throw new Error(`Failed to decode the partition \`by\` projection: ${err instanceof Error ? err.message : err}`);
    }
    projOf = (k) => projectKey(byShape, k);
  }

  // ---------------------------------------------------------------------
  // Boundary selection: greedy byte packing, then `by` alignment so rows
  // with equal projections never split across partitions.
  // ---------------------------------------------------------------------
  const segCount = primaryExtents.offsets.length;
  const segmentByteSize = (i: number): number =>
    (i + 1 < segCount ? primaryExtents.offsets[i + 1]! : primaryExtents.segmentsEnd) - primaryExtents.offsets[i]!;

  const cuts: number[] = [0];
  let acc = 0;
  for (let i = 0; i < segCount; i++) {
    const size = segmentByteSize(i);
    if (acc > 0 && acc + size > request.targetBytes) {
      cuts.push(i);
      acc = 0;
    }
    acc += size;
  }

  let boundaries = cuts;
  if (request.by !== null && cuts.length > 1) {
    // Boundary probes decode segments and project their keys — a decode or
    // projection failure here must record an error execution, not escape as
    // an unhandled throw (the stuck-dataflow class).
    try {
      const lastKeyOf = (segment: unknown): unknown => {
        let last: unknown;
        if (segment instanceof Map) {
          for (const k of segment.keys()) last = k;
        } else {
          for (const k of segment as Iterable<unknown>) last = k;
        }
        return last;
      };
      boundaries = [0];
      for (let cut of cuts.slice(1)) {
        // A group spanning the cut has equal projections either side of it —
        // advance the cut until the projection changes at the fence.
        while (
          cut < segCount &&
          cmpOf(projOf(lastKeyOf(await primary.segmentValue(cut - 1))), projOf(await primary.fence(cut))) === 0
        ) {
          cut++;
        }
        if (cut < segCount && cut > boundaries[boundaries.length - 1]!) {
          boundaries.push(cut);
        }
      }
    } catch (err) {
      primary.release();
      throw new Error(`Failed to align partition boundaries: ${err instanceof Error ? err.message : err}`);
    }
  }
  const partitions = boundaries.length;
  if (partitions === 1) {
    primary.release();
    return { plan: { partitions: partitionHashes, boundaries: [0n], splits: [], slices: [], merges: [] }, partitions };
  }

  // ---------------------------------------------------------------------
  // Plan each co-partitioned secondary's split point at every primary
  // boundary (fence search per boundary). The primary splits at segment
  // boundaries, so its slices are pure byte copies; a secondary re-encodes at
  // most the two edge segments a split falls inside.
  // ---------------------------------------------------------------------
  const secondarySplits: SplitPoint[][] = [];
  // Each blob is released once read, so at most one of them holds a decoded
  // segment beside the primary.
  let secondary: PartitionBlob | null = null;
  try {
    // Boundary values, in projection space, at each internal boundary — what
    // each secondary's split points are searched for. Only the secondaries
    // need them, so a lone partitioned input probes no boundary fence at all.
    //
    // Where they ARE needed they carry the same soundness condition the
    // secondaries are checked against below: a Set/Dict primary's fences
    // ascend in its OWN canonical order, so a projection that follows that
    // order leaves the bounds ascending, and a descending bound means the
    // effective projection does not follow the primary's key order — which
    // the forward-only split searches below cannot survive, since they resume
    // from the segment the previous bound landed in and never go back.
    //
    // An ARRAY root has no canonical order — its elements sit where the value
    // put them — so there is nothing for its fences to ascend in and nothing
    // to check. (An Array primary cannot have secondaries anyway: the SDK
    // restricts co-partitioning to Dict/Set roots sharing a key space.)
    const bounds: unknown[] = [];
    if (request.secondaries.length > 0) {
      let prevBoundSeg = 0;
      for (let p = 1; p < partitions; p++) {
        const bound = projOf(await primary.fence(boundaries[p]!));
        if (rootKind !== 'Array' && bounds.length > 0 && cmpOf(bounds[bounds.length - 1], bound) > 0) {
          throw new Error(
            `partitioned dataset's projected partition boundaries are not monotone (segment ${prevBoundSeg} descends to ${boundaries[p]!}) — ` +
            `the boundary projection must follow every partitioned dataset's own key order`
          );
        }
        bounds.push(bound);
        prevBoundSeg = boundaries[p]!;
      }
    }

    for (const hash of request.secondaries) {
      const blob = await PartitionBlob.open(storage, repo, hash);
      secondary = blob;
      const isDict = blob.extents.typeValue.type === 'Dict';

      // The soundness condition boundary alignment relies on: the secondary's
      // fences ascend in its OWN canonical order, so the projection must be
      // non-decreasing over them. A descending projected fence means the
      // effective projection does not follow this dataset's key order (a
      // heterogeneous co-partition the definition-time validation predates)
      // — that must fail loudly, not mis-assign rows with a success status.
      // One bounded pass (each fence is a one-element probe).
      let prevFence: unknown;
      let hasFence = false;
      for (let i = 0; i < blob.extents.offsets.length; i++) {
        const fence = projOf(await blob.fence(i));
        if (hasFence && cmpOf(prevFence, fence) > 0) {
          throw new Error(
            `co-partitioned dataset's projected segment fences are not monotone (segment ${i - 1} descends to ${i}) — ` +
            `the boundary projection must follow every partitioned dataset's own key order`
          );
        }
        prevFence = fence;
        hasFence = true;
      }

      // Boundaries ascend monotonically, so each split search resumes from
      // the segment the previous one landed in instead of rescanning the
      // fences from 0 — one forward pass over the secondary in total.
      const splits: SplitPoint[] = [{ seg: 0, offset: 0 }];
      let resumeFrom = 0;
      for (const bound of bounds) {
        const split = await findSplitPoint(blob, isDict, projOf, cmpOf, bound, resumeFrom);
        splits.push(split);
        resumeFrom = Math.max(0, Math.min(split.seg, blob.extents.offsets.length - 1));
      }
      splits.push({ seg: blob.extents.offsets.length, offset: 0 });
      secondarySplits.push(splits);
      blob.release();
      secondary = null;
    }
  } catch (err) {
    secondary?.release();
    primary.release();
    throw new Error(`Failed to carve partition slices: ${err instanceof Error ? err.message : err}`);
  }
  primary.release();

  return {
    plan: {
      partitions: partitionHashes,
      boundaries: boundaries.map((b) => BigInt(b)),
      splits: secondarySplits.map((splits) => splits.map((split) => ({ seg: BigInt(split.seg), offset: BigInt(split.offset) }))),
      slices: [],
      merges: [],
    },
    partitions,
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
 * segment indexes and the byte target — and bounded: the boundary keys are
 * fence probes (a bounded prefix of each frame); no segment is decoded and
 * nothing is carved.
 *
 * The number of ranges is the component's bytes over `targetBytes`, capped by
 * the segments of its largest partial (the pilot), whose fences supply the
 * boundary keys: the pilot's segments pack greedily into runs of about equal
 * bytes, and each run after the first starts a range at its first fence. A
 * component of one range — every parity job, and any component smaller than
 * the target — merges its partials whole, over the open range. Each merge
 * unit's runner then seeks every partial to the segment owning its range's
 * lower bound and stops at the first key at or past its upper bound, so a
 * unit reads its range's share of every partial, plus at most one segment.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param partials - The component's partial hashes, in partition order; at least one
 * @param targetBytes - The bytes one merge unit's ranged inputs aim for — the task's `targetPartitionBytes`
 * @returns The range blobs' hashes, in key order; at least one
 * @throws {Error} When a partial is not a Set or Dict blob, or a probe fails.
 */
export async function planMergeRanges(
  storage: StorageBackend,
  repo: string,
  partials: readonly string[],
  targetBytes: number,
): Promise<string[]> {
  if (partials.length === 0) throw new Error('planMergeRanges: no partials');

  // The geometry of every partial from its head and tail alone.
  const geometry: { bytes: number; segments: number }[] = [];
  let typeValue: EastTypeValue | null = null;
  for (const hash of partials) {
    const blob = await PartitionBlob.open(storage, repo, hash);
    const { extents } = blob;
    typeValue ??= extents.typeValue;
    const segments = extents.offsets.length;
    geometry.push({ bytes: segments > 0 ? extents.segmentsEnd - extents.offsets[0]! : 0, segments });
    blob.release();
  }
  const collection = typeValue!;
  if (collection.type !== 'Dict' && collection.type !== 'Set') {
    throw new Error(`partition merge applies to Dict and Set outputs, got ${collection.type}`);
  }
  const keyType: EastTypeValue = collection.type === 'Dict' ? (collection as any).value.key : (collection as any).value;

  const totalBytes = geometry.reduce((sum, g) => sum + g.bytes, 0);
  let pilot = 0;
  for (let p = 1; p < geometry.length; p++) if (geometry[p]!.bytes > geometry[pilot]!.bytes) pilot = p;
  const ranges = Math.max(1, Math.min(Math.ceil(totalBytes / Math.max(1, targetBytes)), geometry[pilot]!.segments));

  // The boundary keys: the pilot's fences where its segments, packed greedily
  // into `ranges` runs of about equal bytes, start a new run.
  const bounds: unknown[] = [];
  if (ranges > 1) {
    const pilotBlob = await PartitionBlob.open(storage, repo, partials[pilot]!);
    try {
      const { extents } = pilotBlob;
      const segmentBytes = (i: number): number =>
        (i + 1 < extents.offsets.length ? extents.offsets[i + 1]! : extents.segmentsEnd) - extents.offsets[i]!;
      const runBytes = geometry[pilot]!.bytes / ranges;
      let acc = 0;
      for (let i = 0; i < extents.offsets.length && bounds.length < ranges - 1; i++) {
        const size = segmentBytes(i);
        if (acc > 0 && acc + size > runBytes) {
          bounds.push(await pilotBlob.fence(i));
          acc = 0;
        }
        acc += size;
      }
    } finally {
      pilotBlob.release();
    }
  }

  // The range blobs: `[from, to)` per range, the first open below and the
  // last open above — the one open range when there is no boundary.
  const encode = encodeBeast2For(mergeRangeTypeValue(keyType));
  const hashes: string[] = [];
  for (let r = 0; r <= bounds.length; r++) {
    const from = r === 0 ? none : some(bounds[r - 1]);
    const to = r === bounds.length ? none : some(bounds[r]);
    hashes.push(await storage.objects.write(repo, encode({ from, to })));
  }
  return hashes;
}

/**
 * The recorded plan a `plan` sidecar names, or `null` when it is gone or does
 * not decode.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param recordedPlanHash - The hash the sidecar names
 * @returns The plan, or `null`
 */
export async function readRecordedPlan(storage: StorageBackend, repo: string, recordedPlanHash: string): Promise<PartitionPlan | null> {
  try {
    return decodePartitionPlan(await storage.objects.read(repo, recordedPlanHash));
  } catch {
    return null;
  }
}

/**
 * The key ranges a recorded plan planned for a component, when it recorded
 * the same partials and every range blob still exists: the ranges are
 * trusted as recorded — a pure function of the partials and the task's byte
 * target, in the task's own plan — so a re-run skips the planning probes;
 * `null` when the recorded plan holds no such component, or a range blob is
 * gone (the ranges are planned again).
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param recorded - The recorded plan
 * @param partials - This run's partials of the component, in partition order
 * @returns The recorded range blobs' hashes, in key order, or `null`
 */
export async function recordedMergeRanges(
  storage: StorageBackend,
  repo: string,
  recorded: PartitionPlan,
  partials: readonly string[],
): Promise<string[] | null> {
  const samePartials = (entry: MergeRangePlan): boolean =>
    entry.partials.length === partials.length && entry.partials.every((hash, i) => hash === partials[i]);
  const entry = recorded.merges.find(samePartials);
  if (entry === undefined || entry.ranges.length === 0) return null;
  for (const hash of entry.ranges) {
    try {
      await storage.objects.stat(repo, hash);
    } catch {
      return null;
    }
  }
  return [...entry.ranges];
}

/**
 * Carves one partition's slice of every partitioned input, as a plan names
 * them: the primary's segments from `boundaries[p]` up to the next boundary
 * by byte copy, and each co-partitioned secondary's range between its split
 * points `p` and `p + 1` — whole segments by byte copy, at most the two edge
 * segments a split falls inside re-encoded. Slices stream to the object
 * store; no input is read whole.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param plan - The partition plan (its `slices` are not read)
 * @param p - Zero-based partition index
 * @returns The partition's slice hashes, one per partitioned input in wire order
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
  const slices = [
    await storage.objects.writeStream(repo, spliceChunks(primary.extents.head, [primary.spanPart(from, to)])),
  ];
  for (let s = 1; s < plan.partitions.length; s++) {
    const blob = await PartitionBlob.open(storage, repo, plan.partitions[s]!);
    try {
      const splits = plan.splits[s - 1]!;
      const split = (i: number): SplitPoint => ({ seg: Number(splits[i]!.seg), offset: Number(splits[i]!.offset) });
      const parts = await carveRangeParts(blob, blob.extents.typeValue.type === 'Dict', split(p), split(p + 1));
      slices.push(await storage.objects.writeStream(repo, spliceChunks(blob.extents.head, parts)));
    } finally {
      blob.release();
    }
  }
  return slices;
}

/**
 * The slices a recorded plan carved, when that plan plans exactly as `plan`:
 * `slices[input][partition]`, with `''` for a partition the recorded run
 * never carved or whose slice no longer exists (both are carved again);
 * `null` when the recorded plan differs.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param recorded - The recorded plan (see {@link readRecordedPlan})
 * @param plan - This run's plan
 * @returns The reusable slices, or `null`
 */
export async function recordedSlices(
  storage: StorageBackend,
  repo: string,
  recorded: PartitionPlan,
  plan: PartitionPlan,
): Promise<string[][] | null> {
  if (!equalFor(PartitionPlanType)({ ...recorded, slices: [], merges: [] }, { ...plan, slices: [], merges: [] })) return null;
  const partitions = plan.boundaries.length;
  if (recorded.slices.length !== plan.partitions.length || recorded.slices.some((slices) => slices.length !== partitions)) {
    return null;
  }
  const slices = recorded.slices.map((input) => input.slice());
  for (let p = 0; p < partitions; p++) {
    // A partition's slices are reused all together or carved all together.
    let present = slices.every((input) => input[p] !== '');
    for (const input of slices) {
      if (!present) break;
      try {
        await storage.objects.stat(repo, input[p]!);
      } catch {
        present = false;
      }
    }
    if (!present) for (const input of slices) input[p] = '';
  }
  return slices;
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
 * Splices stored blobs into one, in the given order, under the first blob's
 * header: every blob's segment frames are byte-copied and the index rebuilt,
 * streamed to the object store without decoding a value. Set and Dict blobs
 * must ascend disjointly in key order, which is checked first, one blob at a
 * time; Array blobs concatenate freely.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param hashes - The blobs to splice, in order; at least one
 * @returns The hash of the spliced blob
 * @throws {Error} When `hashes` is empty, the keys do not ascend disjointly
 *   ({@link SpliceOrderError}), or a blob's header sections differ from the
 *   first blob's.
 */
export async function spliceBlobs(storage: StorageBackend, repo: string, hashes: string[]): Promise<string> {
  if (hashes.length === 0) {
    throw new Error('spliceBlobs: no blobs to splice');
  }
  const violation = await findSpliceViolation(storage, repo, hashes);
  if (violation !== null) {
    throw new SpliceOrderError(violation.left, violation.right, hashes.length);
  }
  const { head } = (await PartitionBlob.open(storage, repo, hashes[0]!)).extents;
  // Parts open lazily, so one blob is open while its frames stream.
  async function* parts(): AsyncIterable<SplicePart> {
    for (const hash of hashes) {
      const blob = await PartitionBlob.open(storage, repo, hash);
      yield blob.spanPart(0, blob.extents.offsets.length);
    }
  }
  return storage.objects.writeStream(repo, spliceChunks(head, parts()));
}

/** Finds the first global position in a co-partitioned secondary whose
 *  projected key reaches `bound`: a fence scan starting at `fromSeg` (the
 *  segment the previous — smaller — bound landed in, so consecutive
 *  searches make one forward pass over the secondary in total), then a
 *  decode of the single segment the boundary may fall inside. The caller
 *  has already verified the projected fences ascend. */
async function findSplitPoint(
  blob: PartitionBlob,
  isDict: boolean,
  projOf: (key: unknown) => unknown,
  cmpOf: (a: unknown, b: unknown) => number,
  bound: unknown,
  fromSeg = 0,
): Promise<SplitPoint> {
  const segCount = blob.extents.offsets.length;
  if (segCount === 0) return { seg: 0, offset: 0 };
  let s = fromSeg;
  if (s === 0 && cmpOf(projOf(await blob.fence(0)), bound) >= 0) return { seg: 0, offset: 0 };
  while (s + 1 < segCount && cmpOf(projOf(await blob.fence(s + 1)), bound) < 0) s++;
  // The boundary may fall inside the last segment whose fence is below it —
  // segment s; when even s's fence reaches the bound (resumed searches), the
  // decode simply lands on its first qualifying key.
  const keys = segmentKeys(await blob.segmentValue(s), isDict);
  for (let i = 0; i < keys.length; i++) {
    if (cmpOf(projOf(keys[i]), bound) >= 0) return { seg: s, offset: i };
  }
  return { seg: s + 1, offset: 0 };
}

/** The keys of a decoded segment, in canonical order. */
function segmentKeys(segment: unknown, isDict: boolean): unknown[] {
  return isDict ? [...(segment as Map<unknown, unknown>).keys()] : [...(segment as Iterable<unknown>)];
}

/** Carves `[from, to)` out of a secondary as splice parts: whole segments as
 *  a ranged span, plus in-memory rebuilds of at most the two edge segments a
 *  boundary splits (all parts share the source's header bytes by
 *  construction). May be empty. */
async function carveRangeParts(
  blob: PartitionBlob,
  isDict: boolean,
  from: SplitPoint,
  to: SplitPoint,
): Promise<SplicePart[]> {
  const extents = blob.extents;
  const segCount = extents.offsets.length;
  const partial = async (seg: number, start: number, end: number | undefined): Promise<SplicePart | null> => {
    const decoded = await blob.segmentValue(seg);
    const batch = isDict
      ? new Map([...(decoded as Map<unknown, unknown>).entries()].slice(start, end))
      : new Set([...(decoded as Iterable<unknown>)].slice(start, end));
    if ((batch as Map<unknown, unknown> | Set<unknown>).size === 0) return null;
    return bufferPart(rebuildBeast2(extents.head, [batch], { extents }));
  };

  const parts: SplicePart[] = [];
  if (from.seg === to.seg) {
    if (from.seg < segCount && from.offset < to.offset) {
      const head = await partial(from.seg, from.offset, to.offset);
      if (head !== null) parts.push(head);
    }
  } else {
    let middleStart = from.seg;
    if (from.offset > 0) {
      const tail = await partial(from.seg, from.offset, undefined);
      if (tail !== null) parts.push(tail);
      middleStart = from.seg + 1;
    }
    if (to.seg > middleStart) {
      parts.push(blob.spanPart(middleStart, to.seg));
    }
    if (to.seg < segCount && to.offset > 0) {
      const head = await partial(to.seg, 0, to.offset);
      if (head !== null) parts.push(head);
    }
  }
  return parts;
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
      const isDict = extents.typeValue.type === 'Dict';
      const keyType: EastTypeValue = isDict ? (extents.typeValue as any).value.key : (extents.typeValue as any).value;
      cmp ??= compareFor(keyType as any) as (a: unknown, b: unknown) => number;
      const first = await shard.fence(0);
      if (prevIndex >= 0 && cmp(prevLast, first) >= 0) {
        return { left: prevIndex, right: i };
      }
      const keys = segmentKeys(await shard.segmentValue(extents.offsets.length - 1), isDict);
      prevLast = keys[keys.length - 1];
      prevIndex = i;
    } finally {
      shard.release();
    }
  }
  return null;
}
