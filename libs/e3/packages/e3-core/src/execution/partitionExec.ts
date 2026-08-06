/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Partitioned task execution — bounded-memory fan-out/fan-in over canonical
 * beast2 segments.
 *
 * A partition task is one logical task node with one output dataset. At run
 * time this module: reads the primary partitioned input's segment index →
 * chooses partition boundaries (deterministically, from the index + the `by`
 * projection + `targetPartitionBytes`) → carves per-partition slices (byte
 * copy; at most the two edge segments of each co-partitioned secondary are
 * re-encoded) → runs each partition as an ordinary content-addressed
 * execution through the standard runner path → assembles the output by byte
 * splice (validating the canonical shard order) or by folding partials
 * pairwise through combine executions.
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
 * Carving currently reads whole input blobs into orchestrator memory (the
 * same bound as the standard path's input marshalling); the runner processes
 * hold only slice-sized values. File-ranged carving is future work.
 */

import { variant } from '@elaraai/east';
import {
  compareFor,
  decodeEastIR,
  readBeast2Extents,
  carveBeast2,
  spliceBeast2,
  rebuildBeast2,
  openBeast2PagesFor,
  type Beast2Extents,
  type Beast2Pages,
} from '@elaraai/east';
import type { EastTypeValue } from '@elaraai/east';
import {
  decodePartitionTaskMetadata,
  type ExecutionStatus,
  type PartitionTaskMetadata,
  type TaskObject,
} from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/interfaces.js';
import {
  taskExecuteStandard,
  type ExecuteOptions,
  type ExecutionIds,
  type ExecutionResult,
} from './LocalTaskRunner.js';

/** A carve position: the first element of the slice, as a segment index and
 *  an element offset within that segment (`offset` 0 = the segment start). */
interface SplitPoint {
  seg: number;
  offset: number;
}

/** The default per-partition execution concurrency. */
const DEFAULT_PARTITION_CONCURRENCY = 4;

/**
 * Executes a partitioned task: carve → per-partition standard executions →
 * splice/combine fan-in, recording the logical result under the task's own
 * `(taskHash, inputsHash)` identity.
 *
 * Called by `taskExecute` after its cache probe and task decode; the
 * per-partition and combine executions run through `taskExecuteStandard`
 * (never back through the dispatch, which would re-enter this path).
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param taskHash - Hash of the task object
 * @param task - The decoded task object (kind `partition`)
 * @param inputHashes - Logical input hashes: `[functionIr, ...partitions, ...broadcast]`
 * @param ids - The logical execution's identity
 * @param options - Execution options
 * @returns The logical execution result
 */
export async function partitionTaskExecute(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  task: TaskObject,
  inputHashes: string[],
  ids: ExecutionIds,
  options: ExecuteOptions = {}
): Promise<ExecutionResult> {
  const { inHash, executionId, startTime } = ids;

  const record = async (status: ExecutionStatus): Promise<void> => {
    await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);
  };
  const errorResult = async (message: string): Promise<ExecutionResult> => {
    await record(variant('error', {
      executionId,
      inputHashes,
      startedAt: new Date(startTime),
      completedAt: new Date(),
      message,
    }));
    return {
      inputsHash: inHash,
      executionId,
      cached: false,
      state: 'error',
      outputHash: null,
      exitCode: null,
      duration: Date.now() - startTime,
      error: message,
    };
  };

  // ---------------------------------------------------------------------
  // Decode the partition spec and split the input layout.
  // ---------------------------------------------------------------------
  if (task.metadata.type !== 'some') {
    return errorResult(`Partition task carries no metadata`);
  }
  let meta: PartitionTaskMetadata;
  try {
    meta = decodePartitionTaskMetadata(task.metadata.value);
  } catch (err) {
    return errorResult(`Failed to decode partition task metadata: ${err}`);
  }
  const partitionCount = Number(meta.partitions);
  if (partitionCount < 1 || inputHashes.length < 1 + partitionCount) {
    return errorResult(`Partition task declares ${partitionCount} partitioned inputs but has ${inputHashes.length} input hashes`);
  }
  const fnIrHash = inputHashes[0]!;
  const partitionHashes = inputHashes.slice(1, 1 + partitionCount);
  const broadcastHashes = inputHashes.slice(1 + partitionCount);
  const targetBytes = Number(meta.targetPartitionBytes);

  // ---------------------------------------------------------------------
  // Primary geometry + the boundary projection.
  // ---------------------------------------------------------------------
  const primaryData = await storage.objects.read(repo, partitionHashes[0]!);
  let primaryExtents: Beast2Extents;
  try {
    primaryExtents = readBeast2Extents(primaryData);
  } catch (err) {
    return errorResult(
      `Partitioned input is not a segmented, indexed beast2 v5 collection blob (${err instanceof Error ? err.message : err}) — ` +
      `re-write the dataset so it carries a segment index`
    );
  }

  let proj: ((key: unknown) => unknown) | null = null;
  let projCmp: ((a: unknown, b: unknown) => number) | null = null;
  if (meta.by.type === 'some') {
    try {
      const bundle = decodeEastIR(meta.by.value);
      proj = bundle.compile([]) as (key: unknown) => unknown;
      const outType = (bundle.ir as any).value.type.value.output as EastTypeValue;
      projCmp = compareFor(outType as any) as (a: unknown, b: unknown) => number;
    } catch (err) {
      return errorResult(`Failed to decode the partition \`by\` projection: ${err}`);
    }
  }

  const rootKind = primaryExtents.typeValue.type as 'Array' | 'Set' | 'Dict';
  const keyTypeValue: EastTypeValue = rootKind === 'Dict'
    ? (primaryExtents.typeValue as any).value.key
    : (primaryExtents.typeValue as any).value;
  const keyCmp = compareFor(keyTypeValue as any) as (a: unknown, b: unknown) => number;
  const projOf = proj ?? ((k: unknown) => k);
  const cmpOf = projCmp ?? keyCmp;

  const primaryPages = openBeast2PagesFor(primaryExtents.typeValue)(primaryData);

  // ---------------------------------------------------------------------
  // Boundary selection: greedy byte packing, then `by` alignment so rows
  // with equal projections never split across partitions. Deterministic —
  // a pure function of the segment index, `by`, and targetPartitionBytes.
  // ---------------------------------------------------------------------
  const segCount = primaryExtents.offsets.length;
  const segmentByteSize = (i: number): number =>
    (i + 1 < segCount ? primaryExtents.offsets[i + 1]! : primaryExtents.segmentsEnd) - primaryExtents.offsets[i]!;

  const cuts: number[] = [0];
  let acc = 0;
  for (let i = 0; i < segCount; i++) {
    const size = segmentByteSize(i);
    if (acc > 0 && acc + size > targetBytes) {
      cuts.push(i);
      acc = 0;
    }
    acc += size;
  }

  let boundaries = cuts;
  if (proj !== null && cuts.length > 1) {
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
        cmpOf(projOf(lastKeyOf(primaryPages.segment(cut - 1))), projOf(primaryPages.fence(cut))) === 0
      ) {
        cut++;
      }
      if (cut < segCount && cut > boundaries[boundaries.length - 1]!) {
        boundaries.push(cut);
      }
    }
  }
  const partitions = boundaries.length;

  // ---------------------------------------------------------------------
  // Carve the primary (pure byte copy at segment boundaries) and each
  // co-partitioned secondary (fence search per boundary; at most the two
  // edge segments a boundary splits are re-encoded).
  // ---------------------------------------------------------------------
  const sliceHashes: string[][] = [];
  try {
    const primarySlices: string[] = [];
    for (let p = 0; p < partitions; p++) {
      const from = boundaries[p]!;
      const to = p + 1 < partitions ? boundaries[p + 1]! : segCount;
      const slice = carveBeast2(primaryData, from, to, primaryExtents);
      primarySlices.push(await storage.objects.write(repo, slice));
    }
    sliceHashes.push(primarySlices);

    // Boundary values, in projection space, at each internal boundary.
    const bounds: unknown[] = [];
    for (let p = 1; p < partitions; p++) {
      bounds.push(projOf(primaryPages.fence(boundaries[p]!)));
    }

    for (let s = 1; s < partitionCount; s++) {
      const data = await storage.objects.read(repo, partitionHashes[s]!);
      const extents = readBeast2Extents(data);
      const pages = openBeast2PagesFor(extents.typeValue)(data);
      const isDict = extents.typeValue.type === 'Dict';

      const splits: SplitPoint[] = [{ seg: 0, offset: 0 }];
      for (const bound of bounds) {
        splits.push(findSplitPoint(pages, extents, isDict, projOf, cmpOf, bound));
      }
      splits.push({ seg: extents.offsets.length, offset: 0 });

      const slices: string[] = [];
      for (let p = 0; p < partitions; p++) {
        const slice = carveRange(data, extents, pages, isDict, splits[p]!, splits[p + 1]!);
        slices.push(await storage.objects.write(repo, slice));
      }
      sliceHashes.push(slices);
    }
  } catch (err) {
    return errorResult(`Failed to carve partition slices: ${err instanceof Error ? err.message : err}`);
  }

  // ---------------------------------------------------------------------
  // Fan out: each partition is an ordinary content-addressed execution of
  // the same task with slice-sized inputs — memoized per partition.
  // ---------------------------------------------------------------------
  const concurrency = Math.max(1, options.partitionConcurrency ?? DEFAULT_PARTITION_CONCURRENCY);
  const results: (ExecutionResult | undefined)[] = new Array(partitions);
  let nextPartition = 0;
  let failedPartition = -1;
  const workers = Array.from({ length: Math.min(concurrency, partitions) }, async () => {
    for (;;) {
      const p = nextPartition++;
      if (p >= partitions || failedPartition >= 0) return;
      const subInputs = [fnIrHash, ...sliceHashes.map((slices) => slices[p]!), ...broadcastHashes];
      const result = await taskExecuteStandard(storage, repo, taskHash, task, subInputs, options);
      results[p] = result;
      if (result.state !== 'success' && failedPartition < 0) failedPartition = p;
    }
  });
  await Promise.all(workers);

  if (failedPartition >= 0) {
    const failed = results[failedPartition]!;
    const message = `Partition ${failedPartition + 1} of ${partitions} ${failed.state === 'failed' ? `failed (exit code ${failed.exitCode})` : `errored: ${failed.error}`}`;
    if (failed.state === 'failed') {
      await record(variant('failed', {
        executionId,
        inputHashes,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        exitCode: BigInt(failed.exitCode ?? -1),
      }));
      return {
        inputsHash: inHash,
        executionId,
        cached: false,
        state: 'failed',
        outputHash: null,
        exitCode: failed.exitCode,
        duration: Date.now() - startTime,
        error: message,
      };
    }
    return errorResult(message);
  }

  // ---------------------------------------------------------------------
  // Fan in: fold partials pairwise (combine mode) or splice shards in
  // partition order (splice mode).
  // ---------------------------------------------------------------------
  let outputHash: string;
  if (meta.combine.type === 'some') {
    // Combine steps are ordinary executions too: the combine IR is the
    // execution's input 0 (exactly as function_ir is for body executions),
    // so re-aggregation is memoized along the unchanged side of the tree.
    const combineIrHash = await storage.objects.write(repo, meta.combine.value);
    let layer = results.map((r) => r!.outputHash!);
    while (layer.length > 1) {
      const next: string[] = [];
      for (let i = 0; i + 1 < layer.length; i += 2) {
        const merged = await taskExecuteStandard(storage, repo, taskHash, task, [combineIrHash, layer[i]!, layer[i + 1]!], options);
        if (merged.state !== 'success' || merged.outputHash === null) {
          const message = `Combine step over partials ${i} and ${i + 1} ${merged.state === 'failed' ? `failed (exit code ${merged.exitCode})` : `errored: ${merged.error}`}`;
          return errorResult(message);
        }
        next.push(merged.outputHash);
      }
      if (layer.length % 2 === 1) next.push(layer[layer.length - 1]!);
      layer = next;
    }
    outputHash = layer[0]!;
  } else {
    try {
      const shards: Uint8Array[] = [];
      for (const r of results) {
        shards.push(await storage.objects.read(repo, r!.outputHash!));
      }
      const violation = findSpliceViolation(shards);
      if (violation !== null) {
        return errorResult(
          `Partition shards ${violation.left + 1} and ${violation.right + 1} of ${partitions} do not ascend disjointly in key order — ` +
          `a splice-mode partition task must keep (or monotonically re-key) the partition key order. ` +
          `Use \`combine\` to aggregate partials instead, or customTask for full control.`
        );
      }
      const spliced = spliceBeast2(shards);
      outputHash = await storage.objects.write(repo, spliced);
    } catch (err) {
      return errorResult(`Failed to splice partition shards: ${err instanceof Error ? err.message : err}`);
    }
  }

  await record(variant('success', {
    executionId,
    inputHashes,
    outputHash,
    startedAt: new Date(startTime),
    completedAt: new Date(),
  }));

  return {
    inputsHash: inHash,
    executionId,
    cached: false,
    state: 'success',
    outputHash,
    exitCode: 0,
    duration: Date.now() - startTime,
    error: null,
  };
}

/** Finds the first global position in a co-partitioned secondary whose
 *  projected key reaches `bound`: a linear fence scan, then a decode of the
 *  single segment the boundary may fall inside. */
function findSplitPoint(
  pages: Beast2Pages,
  extents: Beast2Extents,
  isDict: boolean,
  projOf: (key: unknown) => unknown,
  cmpOf: (a: unknown, b: unknown) => number,
  bound: unknown,
): SplitPoint {
  const segCount = extents.offsets.length;
  let s = 0;
  while (s < segCount && cmpOf(projOf(pages.fence(s)), bound) < 0) s++;
  if (s === 0) return { seg: 0, offset: 0 };
  // The boundary may fall inside the last segment whose fence is below it.
  const keys = segmentKeys(pages.segment(s - 1), isDict);
  for (let i = 0; i < keys.length; i++) {
    if (cmpOf(projOf(keys[i]), bound) >= 0) return { seg: s - 1, offset: i };
  }
  return { seg: s, offset: 0 };
}

/** The keys of a decoded segment, in canonical order. */
function segmentKeys(segment: unknown, isDict: boolean): unknown[] {
  return isDict ? [...(segment as Map<unknown, unknown>).keys()] : [...(segment as Iterable<unknown>)];
}

/** Carves `[from, to)` out of a secondary: byte-copies whole segments and
 *  rebuilds at most the two edge segments a boundary splits, then splices
 *  the runs (all parts share the source's header bytes by construction). */
function carveRange(
  data: Uint8Array,
  extents: Beast2Extents,
  pages: Beast2Pages,
  isDict: boolean,
  from: SplitPoint,
  to: SplitPoint,
): Uint8Array {
  const segCount = extents.offsets.length;
  const partial = (seg: number, start: number, end: number | undefined): Uint8Array | null => {
    const decoded = pages.segment(seg);
    const batch = isDict
      ? new Map([...(decoded as Map<unknown, unknown>).entries()].slice(start, end))
      : new Set([...(decoded as Iterable<unknown>)].slice(start, end));
    if ((batch as Map<unknown, unknown> | Set<unknown>).size === 0) return null;
    return rebuildBeast2(data, [batch], { extents });
  };

  const parts: Uint8Array[] = [];
  if (from.seg === to.seg) {
    if (from.seg < segCount && from.offset < to.offset) {
      const head = partial(from.seg, from.offset, to.offset);
      if (head !== null) parts.push(head);
    }
  } else {
    let middleStart = from.seg;
    if (from.offset > 0) {
      const tail = partial(from.seg, from.offset, undefined);
      if (tail !== null) parts.push(tail);
      middleStart = from.seg + 1;
    }
    if (to.seg > middleStart) {
      parts.push(carveBeast2(data, middleStart, to.seg, extents));
    }
    if (to.seg < segCount && to.offset > 0) {
      const head = partial(to.seg, 0, to.offset);
      if (head !== null) parts.push(head);
    }
  }
  if (parts.length === 0) return carveBeast2(data, 0, 0, extents);
  return parts.length === 1 ? parts[0]! : spliceBeast2(parts);
}

/** Validates the splice-mode shard contract for Set/Dict outputs: adjacent
 *  non-empty shards' key ranges must ascend disjointly in partition order.
 *  Returns the offending pair, or `null` when the shards splice cleanly
 *  (Array shards concatenate freely). */
function findSpliceViolation(shards: Uint8Array[]): { left: number; right: number } | null {
  let prevIndex = -1;
  let prevLast: unknown;
  let cmp: ((a: unknown, b: unknown) => number) | null = null;
  for (let i = 0; i < shards.length; i++) {
    const extents = readBeast2Extents(shards[i]!);
    if (extents.typeValue.type === 'Array') return null;
    if (extents.offsets.length === 0) continue;
    const isDict = extents.typeValue.type === 'Dict';
    const keyType: EastTypeValue = isDict ? (extents.typeValue as any).value.key : (extents.typeValue as any).value;
    cmp ??= compareFor(keyType as any) as (a: unknown, b: unknown) => number;
    const pages = openBeast2PagesFor(extents.typeValue)(shards[i]!);
    const first = pages.fence(0);
    if (prevIndex >= 0 && cmp(prevLast, first) >= 0) {
      return { left: prevIndex, right: i };
    }
    const lastSegment = pages.segment(extents.offsets.length - 1);
    const keys = segmentKeys(lastSegment, isDict);
    prevLast = keys[keys.length - 1];
    prevIndex = i;
  }
  return null;
}
