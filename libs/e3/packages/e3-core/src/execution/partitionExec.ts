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
 * projection + `targetPartitionBytes`) and each co-partitioned secondary's
 * split points — the partition PLAN → carves a partition's slices when a
 * worker picks it up (byte copy; at most the two edge segments of each
 * secondary are re-encoded), reusing the slices a previous run of the same
 * plan recorded → runs each partition as an ordinary content-addressed
 * execution, probed in the execution cache first → assembles the output by
 * byte splice (validating the canonical shard order), by a MERGE TREE of
 * stream executions on the task's own runner over keyed partials that may
 * collide (`partitionAssembly.ts` — disjoint partials are spliced, never
 * decoded), or by folding partials pairwise through combine executions. While
 * its units run, the logical execution is recorded `running`, and its log
 * names every unit's execution.
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

import { variant } from '@elaraai/east';
import {
  compareFor,
  decodeEastIR,
  equalFor,
  rebuildBeast2,
} from '@elaraai/east';
import type { EastTypeValue, FunctionTypeValue } from '@elaraai/east';
import { PartitionBlob, bufferPart, spliceChunks, type SplicePart } from './partitionIo.js';
import { assembleMergeTree, type MergeTreeOutcome } from './partitionAssembly.js';
import {
  PartitionPlanType,
  decodePartitionPlan,
  decodePartitionTaskMetadata,
  encodePartitionPlan,
  partitionProjectionShape,
  projectKey,
  projectedKeyType,
  type ExecutionStatus,
  type PartitionPlan,
  type PartitionTaskMetadata,
  type ProjectionShape,
  type TaskObject,
} from '@elaraai/e3-types';
import { inputsHash } from '../executions.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { getBootId, getPidStartTime } from './processHelpers.js';
import {
  probeExecutionCache,
  taskExecuteBody,
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
 * Runs one unit of a partitioned task — a partition execution, a combine step
 * or a merge unit — once {@link partitionTaskExecute}'s own cache probe has
 * missed (or `force` skipped it): the unit is an ordinary content-addressed
 * execution of `task` over `inputHashes`, recorded under a fresh execution id.
 *
 * @remarks
 * The local default runs the standard execution body in this process; a
 * remote backend supplies its own, so the orchestration (planning, carving,
 * caching, assembly) stays in e3-core whatever runs the unit.
 */
export type PartitionUnitExecutor = (taskHash: string, task: TaskObject, inputHashes: string[], options: ExecuteOptions) => Promise<ExecutionResult>;

/**
 * Executes a partitioned task: plan → carve on demand → per-partition
 * executions → splice/combine fan-in, recording the logical result under the
 * task's own `(taskHash, inputsHash)` identity.
 *
 * Called by `taskExecute` after its cache probe and task decode. Every unit —
 * a partition execution, a combine step or a merge unit — is probed in the
 * execution cache here and run through `executeUnit` only on a miss (never
 * back through the dispatch, which would re-enter this path).
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param taskHash - Hash of the task object
 * @param task - The decoded task object (kind `partition`)
 * @param inputHashes - Logical input hashes: `[functionIr, ...partitions, ...broadcast]`
 * @param ids - The logical execution's identity
 * @param options - Execution options
 * @param executeUnit - Runs a unit on a cache miss
 * @returns The logical execution result
 */
export async function partitionTaskExecute(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  task: TaskObject,
  inputHashes: string[],
  ids: ExecutionIds,
  options: ExecuteOptions,
  executeUnit: PartitionUnitExecutor,
): Promise<ExecutionResult> {
  const { inHash, executionId, startTime } = ids;

  // The logical execution's log: one stdout line per unit, appended when the
  // unit's result is known and naming the unit's execution in full, so its
  // own logs can be opened. Appends run one at a time; a record waits for them.
  let logWrites: Promise<void> = Promise.resolve();
  const logUnit = (label: string, unitTaskHash: string, result: ExecutionResult): void => {
    const state = result.cancelled ? 'cancelled' : result.cached ? 'cached' : result.state === 'success' ? 'completed' : 'failed';
    const line = `${label} ${state} task=${unitTaskHash} inputs=${result.inputsHash} execution=${result.executionId} duration=${result.duration}\n`;
    logWrites = logWrites.then(async () => {
      try {
        await storage.logs.append(repo, taskHash, inHash, executionId, 'stdout', line);
      } catch (err) {
        console.warn(`Failed to append partition log: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  };

  const record = async (status: ExecutionStatus): Promise<void> => {
    await logWrites;
    await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);
  };
  /** Records a unit's own non-zero exit as the logical execution's `failed`. */
  const failedResult = async (exitCode: number | null, message: string): Promise<ExecutionResult> => {
    await record(variant('failed', {
      executionId,
      inputHashes,
      startedAt: new Date(startTime),
      completedAt: new Date(),
      exitCode: BigInt(exitCode ?? -1),
    }));
    return {
      inputsHash: inHash,
      executionId,
      cached: false,
      state: 'failed',
      outputHash: null,
      exitCode,
      duration: Date.now() - startTime,
      error: message,
      cancelled: false,
    };
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
      cancelled: false,
    };
  };
  /** Records the logical execution stopped because the run was aborted. */
  const cancelledResult = async (): Promise<ExecutionResult> => ({
    ...await errorResult('cancelled: e3 stopped the partitioned run because the run was aborted'),
    cancelled: true,
  });

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
  let primary: PartitionBlob;
  try {
    primary = await PartitionBlob.open(storage, repo, partitionHashes[0]!);
  } catch (err) {
    return errorResult(
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
  if (meta.by.type === 'some') {
    let shape: ProjectionShape | null;
    let byKeyType: EastTypeValue;
    try {
      const ir = decodeEastIR(meta.by.value).ir;
      shape = partitionProjectionShape(ir);
      byKeyType = (ir.value.type as FunctionTypeValue).value.inputs[0] as EastTypeValue;
    } catch (err) {
      return errorResult(`Failed to decode the partition \`by\` projection: ${err}`);
    }
    if (shape === null) {
      return errorResult('partition by projection is not a leading-prefix key projection — re-export the package with the current SDK');
    }
    const byShape = shape;
    try {
      cmpOf = compareFor(projectedKeyType(byShape, byKeyType) as any) as (a: unknown, b: unknown) => number;
    } catch (err) {
      return errorResult(`Failed to decode the partition \`by\` projection: ${err instanceof Error ? err.message : err}`);
    }
    projOf = (k) => projectKey(byShape, k);
  }

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
  if (meta.by.type === 'some' && cuts.length > 1) {
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
      return errorResult(`Failed to align partition boundaries: ${err instanceof Error ? err.message : err}`);
    }
  }
  const partitions = boundaries.length;

  // A single partition's slice is byte-identical to the input, so carving
  // and splicing would only re-write the input blob and record the same
  // work twice (the sub-execution's identity collides with the logical
  // one). Run the standard body once under the LOGICAL identity instead.
  if (partitions === 1) {
    const progress = options.onPartitionProgress;
    progress?.({ phase: 'partition', index: 0, total: 1, completed: 0, state: 'started' });
    const result = await taskExecuteBody(storage, repo, taskHash, task, inputHashes, ids, options);
    progress?.({ phase: 'partition', index: 0, total: 1, completed: 1, state: 'completed', cached: result.cached, duration: result.duration });
    return result;
  }

  // Two or more partitions: the logical execution is this process's own work
  // while its units run — recorded `running` under this process, with the
  // owner sidecar naming it.
  const bootId = await getBootId();
  const pidStartTime = await getPidStartTime(process.pid);
  await record(variant('running', {
    executionId,
    inputHashes,
    startedAt: new Date(startTime),
    pid: BigInt(process.pid),
    pidStartTime: BigInt(pidStartTime),
    bootId,
  }));
  await storage.refs.executionOwnerWrite?.(repo, taskHash, inHash, executionId, { pid: process.pid, pidStartTime, bootId });

  // ---------------------------------------------------------------------
  // Plan each co-partitioned secondary's split point at every primary
  // boundary (fence search per boundary). The primary splits at segment
  // boundaries, so its slices are pure byte copies; a secondary re-encodes at
  // most the two edge segments a split falls inside.
  // ---------------------------------------------------------------------
  const secondarySplits: SplitPoint[][] = [];
  try {
    // Boundary values, in projection space, at each internal boundary.
    const bounds: unknown[] = [];
    for (let p = 1; p < partitions; p++) {
      bounds.push(projOf(await primary.fence(boundaries[p]!)));
    }

    for (let s = 1; s < partitionCount; s++) {
      const blob = await PartitionBlob.open(storage, repo, partitionHashes[s]!);
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
    }
  } catch (err) {
    return errorResult(`Failed to carve partition slices: ${err instanceof Error ? err.message : err}`);
  }

  // The plan is stored before anything is carved from it. The `plan` sidecar
  // names the completed plan of a previous run: when it plans exactly as this
  // one and every slice it names still exists, its slices are reused (`force`
  // re-runs executions, never the carve); otherwise each partition's slices
  // are carved when a worker picks the partition up.
  const plan: PartitionPlan = {
    partitions: partitionHashes,
    boundaries: boundaries.map((b) => BigInt(b)),
    splits: secondarySplits.map((splits) => splits.map((split) => ({ seg: BigInt(split.seg), offset: BigInt(split.offset) }))),
    slices: [],
  };
  let reusedSlices: string[][] | null = null;
  try {
    await storage.objects.write(repo, encodePartitionPlan(plan));
    const recordedPlanHash = await storage.refs.executionPlanRead?.(repo, taskHash, inHash) ?? null;
    if (recordedPlanHash !== null) {
      reusedSlices = await recordedSlices(storage, repo, recordedPlanHash, plan);
    }
  } catch (err) {
    return errorResult(`Failed to carve partition slices: ${err instanceof Error ? err.message : err}`);
  }

  // Every unit is probed in the execution cache here, and run by
  // `executeUnit` only on a miss.
  const runUnit = async (unitTaskHash: string, unitTask: TaskObject, unitInputs: string[]): Promise<ExecutionResult> => {
    if (!options.force) {
      const cached = await probeExecutionCache(storage, repo, unitTaskHash, inputsHash(unitInputs));
      if (cached !== null) return cached;
    }
    return executeUnit(unitTaskHash, unitTask, unitInputs, options);
  };

  // ---------------------------------------------------------------------
  // Fan out: each partition is an ordinary content-addressed execution of
  // the same task with slice-sized inputs — memoized per partition.
  // ---------------------------------------------------------------------
  const concurrency = Math.max(1, options.partitionConcurrency ?? DEFAULT_PARTITION_CONCURRENCY);
  const progress = options.onPartitionProgress;
  const results: (ExecutionResult | undefined)[] = Array.from({ length: partitions }, () => undefined);
  // sliceHashes[input][partition], filled in as partitions are carved.
  const sliceHashes: (string | undefined)[][] = reusedSlices
    ?? partitionHashes.map(() => Array.from({ length: partitions }, () => undefined));
  const carveFailures: (string | undefined)[] = Array.from({ length: partitions }, () => undefined);
  let nextPartition = 0;
  let partitionsCompleted = 0;
  let hasFailure = false;
  const workers = Array.from({ length: Math.min(concurrency, partitions) }, async () => {
    for (;;) {
      const p = nextPartition++;
      if (p >= partitions || hasFailure || options.signal?.aborted) return;
      if (reusedSlices === null) {
        try {
          const carved = await carvePartitionSlices(storage, repo, plan, p);
          for (let input = 0; input < carved.length; input++) {
            sliceHashes[input]![p] = carved[input]!;
          }
        } catch (err) {
          carveFailures[p] = err instanceof Error ? err.message : String(err);
          hasFailure = true;
          continue;
        }
      }
      progress?.({ phase: 'partition', index: p, total: partitions, completed: partitionsCompleted, state: 'started' });
      const subInputs = [fnIrHash, ...sliceHashes.map((slices) => slices[p]!), ...broadcastHashes];
      const result = await runUnit(taskHash, task, subInputs);
      results[p] = result;
      logUnit(`partition ${p + 1}/${partitions}`, taskHash, result);
      partitionsCompleted++;
      progress?.({ phase: 'partition', index: p, total: partitions, completed: partitionsCompleted, state: 'completed', cached: result.cached, duration: result.duration });
      // A unit e3 stopped because the run was aborted is not a failure.
      if (result.state !== 'success' && !result.cancelled) hasFailure = true;
    }
  });
  await Promise.all(workers);

  // Once every partition has run, the completed plan is recorded — after a
  // failed partition too, so the retry reuses the slices.
  if (results.every((r) => r !== undefined)) {
    try {
      const completedPlanHash = await storage.objects.write(repo, encodePartitionPlan({ ...plan, slices: sliceHashes as string[][] }));
      await storage.refs.executionPlanWrite?.(repo, taskHash, inHash, completedPlanHash);
    } catch (err) {
      return errorResult(`Failed to record the partition plan: ${err instanceof Error ? err.message : err}`);
    }
  }

  // An aborted run stops here, whatever its units did.
  if (options.signal?.aborted || results.some((r) => r?.cancelled)) {
    return cancelledResult();
  }

  // Attribute failure deterministically: the LOWEST-index failed partition
  // among the completed results, not whichever failing worker settled first
  // (that races the pool and made the reported partition nondeterministic).
  // A partition whose carve failed has no result, and counts at its index.
  const failedPartition = results.findIndex((r) => r !== undefined && r.state !== 'success');
  const failedCarve = carveFailures.findIndex((message) => message !== undefined);
  if (failedCarve >= 0 && (failedPartition < 0 || failedCarve < failedPartition)) {
    return errorResult(`Failed to carve partition slices: ${carveFailures[failedCarve]}`);
  }
  if (failedPartition >= 0) {
    const failed = results[failedPartition]!;
    // Include the runner's error tail on the failed branch too — without it
    // the message carries only an exit code and the cause is invisible
    // without digging into the sub-execution's logs.
    const message = `Partition ${failedPartition + 1} of ${partitions} ${failed.state === 'failed'
      ? `failed (exit code ${failed.exitCode})${failed.error ? `: ${failed.error}` : ''}`
      : `errored: ${failed.error}`}`;
    if (failed.state === 'failed') {
      return failedResult(failed.exitCode, message);
    }
    return errorResult(message);
  }

  // ---------------------------------------------------------------------
  // Fan in: merge keyed partials through a tree of stream executions on the
  // task's runner (merge mode), fold partials pairwise (combine mode), or
  // splice shards in partition order (splice mode).
  // ---------------------------------------------------------------------
  let outputHash: string;
  if (meta.merge.type === 'some' || meta.mergeSets) {
    const partials = results.map((r) => r!.outputHash!);
    let outcome: MergeTreeOutcome;
    try {
      outcome = await assembleMergeTree({
        storage,
        repo,
        parent: task,
        mode: meta.merge.type === 'some' ? 'function' : 'union',
        partials,
        concurrency,
        runUnit,
        signal: options.signal,
        onUnitStarted: (unit) => {
          progress?.({ phase: 'merge', index: unit.index, total: unit.total, completed: unit.completed, state: 'started' });
        },
        onUnitCompleted: (unit, result) => {
          logUnit(`merge level ${unit.level}/${unit.levels} unit ${unit.index + 1}/${unit.total}`, unit.taskHash, result);
          progress?.({ phase: 'merge', index: unit.index, total: unit.total, completed: unit.completed, state: 'completed', cached: result.cached, duration: result.duration });
        },
      });
    } catch (err) {
      return errorResult(`Failed to merge partition partials: ${err instanceof Error ? err.message : err}`);
    }
    if (outcome.kind === 'cancelled') {
      return cancelledResult();
    }
    if (outcome.kind === 'error') {
      return errorResult(outcome.message);
    }
    if (outcome.kind === 'unitFailed') {
      const { unit, result: merged } = outcome;
      const message = `Merge unit ${unit.index + 1} of ${unit.total} at level ${unit.level} of ${unit.levels} ${merged.state === 'failed'
        ? `failed (exit code ${merged.exitCode})${merged.error ? `: ${merged.error}` : ''}`
        : `errored: ${merged.error}`}`;
      if (merged.state === 'failed') {
        return failedResult(merged.exitCode, message);
      }
      return errorResult(message);
    }
    // One component is the output; several splice in key order; no
    // non-empty partial leaves an empty collection under the partials' head.
    try {
      if (outcome.results.length === 0) {
        const first = await PartitionBlob.open(storage, repo, partials[0]!);
        outputHash = await storage.objects.writeStream(repo, spliceChunks(first.extents.head, []));
      } else if (outcome.results.length === 1) {
        outputHash = outcome.results[0]!;
      } else {
        outputHash = await spliceBlobs(storage, repo, outcome.results);
      }
    } catch (err) {
      return errorResult(`Failed to merge partition partials: ${err instanceof Error ? err.message : err}`);
    }
  } else if (meta.combine.type === 'some') {
    // Combine steps are ordinary executions too: the combine IR is the
    // execution's input 0 (exactly as function_ir is for body executions),
    // so re-aggregation is memoized along the unchanged side of the tree.
    // Each level's pairwise merges run through the same worker pool as the
    // partition fan-out — a wide combine layer no longer serializes.
    const combineIrHash = await storage.objects.write(repo, meta.combine.value);
    let layer = results.map((r) => r!.outputHash!);
    let combineLevels = 0;
    for (let entries = layer.length; entries > 1; entries = Math.ceil(entries / 2)) combineLevels++;
    let combineLevel = 0;
    while (layer.length > 1) {
      const levelNumber = ++combineLevel;
      const pairs = layer.length >> 1;
      const next: string[] = new Array(pairs + (layer.length % 2));
      const level = layer;
      const mergeResults: (ExecutionResult | undefined)[] = new Array(pairs);
      let nextPair = 0;
      let pairsCompleted = 0;
      let mergeFailed = false;
      const mergeWorkers = Array.from({ length: Math.min(concurrency, pairs) }, async () => {
        for (;;) {
          const pair = nextPair++;
          if (pair >= pairs || mergeFailed || options.signal?.aborted) return;
          const i = pair * 2;
          progress?.({ phase: 'combine', index: pair, total: pairs, completed: pairsCompleted, state: 'started' });
          const merged = await runUnit(taskHash, task, [combineIrHash, level[i]!, level[i + 1]!]);
          mergeResults[pair] = merged;
          logUnit(`combine level ${levelNumber}/${combineLevels} unit ${pair + 1}/${pairs}`, taskHash, merged);
          if (merged.state !== 'success' || merged.outputHash === null) {
            if (!merged.cancelled) mergeFailed = true;
            return;
          }
          pairsCompleted++;
          progress?.({ phase: 'combine', index: pair, total: pairs, completed: pairsCompleted, state: 'completed', cached: merged.cached, duration: merged.duration });
          next[pair] = merged.outputHash;
        }
      });
      await Promise.all(mergeWorkers);
      if (options.signal?.aborted || mergeResults.some((r) => r?.cancelled)) {
        return cancelledResult();
      }
      // Deterministic attribution, exactly as for the partition fan-out.
      const failedPair = mergeResults.findIndex((r) => r !== undefined && (r.state !== 'success' || r.outputHash === null));
      if (failedPair >= 0) {
        const merged = mergeResults[failedPair]!;
        const left = failedPair * 2;
        const message = `Combine step over partials ${left} and ${left + 1} ${merged.state === 'failed'
          ? `failed (exit code ${merged.exitCode})${merged.error ? `: ${merged.error}` : ''}`
          : `errored: ${merged.error}`}`;
        // A failed merge is the runner's own exit — record it as `failed`
        // with the exit code, exactly as the partition branch does, so the
        // state distinction (failed vs orchestrator error) survives.
        if (merged.state === 'failed') {
          return failedResult(merged.exitCode, message);
        }
        return errorResult(message);
      }
      if (layer.length % 2 === 1) next[pairs] = layer[layer.length - 1]!;
      layer = next;
    }
    outputHash = layer[0]!;
  } else {
    try {
      outputHash = await spliceBlobs(storage, repo, results.map((r) => r!.outputHash!));
    } catch (err) {
      if (err instanceof SpliceOrderError) {
        return errorResult(
          `Partition shards ${err.left + 1} and ${err.right + 1} of ${partitions} do not ascend disjointly in key order — ` +
          `a splice-mode partition task must keep (or monotonically re-key) the partition key order. ` +
          `Use \`combine\` to aggregate partials instead, or customTask for full control.`
        );
      }
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
    cancelled: false,
  };
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
    const splits = plan.splits[s - 1]!;
    const split = (i: number): SplitPoint => ({ seg: Number(splits[i]!.seg), offset: Number(splits[i]!.offset) });
    const parts = await carveRangeParts(blob, blob.extents.typeValue.type === 'Dict', split(p), split(p + 1));
    slices.push(await storage.objects.writeStream(repo, spliceChunks(blob.extents.head, parts)));
  }
  return slices;
}

/** The slices a recorded plan carved, when that plan plans exactly as `plan`
 *  and every slice it names still exists; `null` otherwise, including when
 *  the recorded plan is gone or does not decode. */
async function recordedSlices(
  storage: StorageBackend,
  repo: string,
  recordedPlanHash: string,
  plan: PartitionPlan,
): Promise<string[][] | null> {
  let recorded: PartitionPlan;
  try {
    recorded = decodePartitionPlan(await storage.objects.read(repo, recordedPlanHash));
  } catch {
    return null;
  }
  if (!equalFor(PartitionPlanType)({ ...recorded, slices: [] }, plan)) return null;
  const partitions = plan.boundaries.length;
  if (recorded.slices.length !== plan.partitions.length || recorded.slices.some((slices) => slices.length !== partitions)) {
    return null;
  }
  for (const slices of recorded.slices) {
    for (const hash of slices) {
      try {
        await storage.objects.stat(repo, hash);
      } catch {
        return null;
      }
    }
  }
  return recorded.slices;
}

/** The blobs a splice was given do not ascend disjointly in key order: the
 *  keys of blob `right` (0-based) do not all follow those of blob `left`, the
 *  last non-empty blob before it. */
class SpliceOrderError extends Error {
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
 * @throws {Error} When `hashes` is empty, the keys do not ascend disjointly,
 *   or a blob's header sections differ from the first blob's.
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

/** Validates the splice contract for Set/Dict blobs: adjacent non-empty
 *  blobs' key ranges must ascend disjointly in the given order. Bounded: one
 *  blob is open at a time, and only its first fence and last segment decode.
 *  Returns the offending pair, or `null` when the blobs splice cleanly (Array
 *  blobs concatenate freely). */
async function findSpliceViolation(
  storage: StorageBackend,
  repo: string,
  hashes: string[],
): Promise<{ left: number; right: number } | null> {
  let prevIndex = -1;
  let prevLast: unknown;
  let cmp: ((a: unknown, b: unknown) => number) | null = null;
  for (let i = 0; i < hashes.length; i++) {
    const shard = await PartitionBlob.open(storage, repo, hashes[i]!);
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
  }
  return null;
}
