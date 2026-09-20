/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The step interpreter of a partitioned task (issue #770).
 *
 * A partitioned task is one logical task node with one output dataset, and
 * under the hood a TEMPLATE of steps the orchestrator interprets:
 *
 * - `plan` — reads the primary partitioned input's segment index and chooses
 *   the partition boundaries (deterministically, from the index, the `by`
 *   projection and `targetPartitionBytes`) and each co-partitioned
 *   secondary's split points; its result is the partition plan.
 * - `map` — one execution per partition of the task's own command over its
 *   slices (carved on demand, or reused from a recorded plan) and the
 *   broadcast inputs; its result is one output hash per partition.
 * - `reduce` — a tree of executions of a task over the hashes of an earlier
 *   step: the entries are grouped (`all` as one group; `ranges`, the partials
 *   whose key ranges overlap grouped into components and each component cut
 *   into key ranges of about `rangeBytes` — the fan-in of a large component
 *   runs one range per unit, in parallel, every unit taking its range as an
 *   input and seeking the partials to it), every level groups `fanIn`
 *   consecutive entries into one unit (a group of one passes through) until
 *   one entry remains; its result is one hash per group. The merge
 *   template's reduce runs the runner's `merge` command — the package's own
 *   `mergeCommand`, written at export — over sorted partials; the combine
 *   template's runs the task's command over the combine IR and two partials.
 * - `splice` — the byte splice of an earlier step's hashes in order, under
 *   the first blob's header; its result is one hash.
 *
 * Three templates: splice `[plan, map, splice]`, combine `[plan, map,
 * reduce(fanIn 2, all)]` and merge `[plan, map, reduce(fanIn 32, ranges),
 * splice]`. Every unit is an ordinary content-addressed execution probed in
 * the execution cache and run by the unit executor only on a miss, so
 * partition-level memoization rides the execution cache; the carve and
 * splice byte hooks default to the local storage-layer code, and a remote
 * backend (e3-cloud) supplies its kernel's. The orchestrator never decodes a
 * partial: it reads segment indexes, fences and one edge segment at a time,
 * and carves nothing for a merge range — the range is a small blob the unit
 * takes as an input, and its runner seeks every partial to it.
 *
 * Every output is a deterministic function of the inputs and the task: the
 * partitions, the merge ranges and the tree are planned from the blobs'
 * indexes and the task's metadata, never from the pool width, the jobs
 * budget or timing, so the same job writes the same bytes on every machine
 * at every `--jobs`, and a forced re-run reuses its recorded slices and
 * ranges.
 *
 * While the units run the logical execution is recorded `running` under this
 * process, with the owner sidecar naming it, and its log names every unit's
 * execution; failure attribution is deterministic (the lowest-index unit of
 * a level), and an aborted run records the logical execution cancelled.
 */

import {
  ArrayType,
  EastIR,
  FunctionType,
  StringType,
  compareFor,
  encodeBeast2For,
  isTypeValueEqual,
  none,
  some,
  toEastTypeValue,
  variant,
  type EastTypeValue,
  type FunctionIR,
} from '@elaraai/east';
import {
  TASK_KIND_MERGE,
  TaskObjectType,
  decodePartitionTaskMetadata,
  encodePartitionPlan,
  type ExecutionStatus,
  type PartitionPlan,
  type PartitionTaskMetadata,
  type TaskObject,
} from '@elaraai/e3-types';
import { inputsHash } from '../executions.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { getBootId, getPidStartTime } from './processHelpers.js';
import { probeExecutionCache, type ExecuteOptions, type ExecutionIds, type ExecutionResult } from './LocalTaskRunner.js';
import { PartitionBlob, decodedSegmentPeak, resetDecodedSegmentPeak, spliceChunks } from './partitionIo.js';
import {
  SpliceOrderError,
  carvePartitionSlices,
  planMergeRanges,
  planPartitions,
  readRecordedPlan,
  recordedMergeRanges,
  recordedSlices,
  spliceBlobs,
  type PartitionUnitExecutor,
} from './partitionExec.js';

/** The most partials one merge unit merges. */
export const MERGE_TREE_FANIN = 32;

/** The default pool width — the most units in flight at once — without a
 *  jobs budget or an explicit `partitionConcurrency`. */
const DEFAULT_PARTITION_CONCURRENCY = 4;

/** Why a merge tree cannot run on a task's runner. */
const CUSTOM_RUNTIME_MERGE_MESSAGE =
  'partition merge needs a stock runtime (east-c, east-node, east-py); this task uses the custom runtime';

/** Why a merge tree cannot run for a package exported by an older SDK. */
const NO_MERGE_COMMAND_MESSAGE =
  'partition merge: the package was exported before merge commands existed — re-export it with the current SDK';

// =============================================================================
// Counters, for specs
// =============================================================================

/** Reduce units — merge units and combine steps — run or found cached since
 *  the counters were last reset. */
let assemblyUnits = 0;

/**
 * Counts one reduce unit, a merge unit or a combine step.
 *
 * @internal
 */
export function countAssemblyUnit(): void {
  assemblyUnits++;
}

/** The signature of a command IR, `(inputs, output) -> argv`. */
const COMMAND_IR_TYPE = toEastTypeValue(FunctionType([ArrayType(StringType), StringType], ArrayType(StringType)));

/**
 * The counters of a partitioned execution's fan-in — the orchestrator's side
 * of issue #770's memory claim.
 *
 * @internal
 */
export interface PartitionAssemblyStats {
  /** The most decoded segments e3-core held at once. */
  peakDecodedSegments: number;
  /** Functions compiled in this process other than command IRs: the merge,
   *  combine and `by` functions a partitioned task carries, which e3-core
   *  must never run itself. */
  compiledFunctions: number;
  /** Merge units and combine steps run or found cached. */
  units: number;
}

/**
 * Runs `run` and returns the partition fan-in's counters over it.
 *
 * @remarks
 * For specs. Compiles are counted by wrapping `EastIR.prototype.compile`
 * while `run` runs, and every counter is process-wide, so nothing else may
 * run meanwhile.
 *
 * @param run - A partitioned task's execution
 * @returns The counters
 * @internal
 */
export async function partitionAssemblyStats(run: () => Promise<unknown>): Promise<PartitionAssemblyStats> {
  resetDecodedSegmentPeak();
  assemblyUnits = 0;
  let compiledFunctions = 0;
  const compile = EastIR.prototype.compile;
  EastIR.prototype.compile = function (this: EastIR<any, any>, platform) {
    if (!isTypeValueEqual((this.ir as FunctionIR).value.type as EastTypeValue, COMMAND_IR_TYPE)) compiledFunctions++;
    return compile.call(this, platform);
  } as typeof compile;
  try {
    await run();
  } finally {
    EastIR.prototype.compile = compile;
  }
  return { peakDecodedSegments: decodedSegmentPeak(), compiledFunctions, units: assemblyUnits };
}

// =============================================================================
// Components and the tree's shape
// =============================================================================

/** Partials whose key ranges overlap, directly or through each other. */
export interface MergeComponent {
  /** The component's smallest key. */
  first: unknown;
  /** The component's partials, as partition indices in ascending order. */
  partitions: number[];
}

/**
 * Groups partials into components by key range.
 *
 * Each partial is opened in turn for its first fence and its last key and
 * dropped. The non-empty partials, ordered by first key and then partition
 * index, are walked once: a partial joins the current component when its first
 * key is at most the greatest last key the component has seen, and starts a
 * new component otherwise. Empty partials belong to no component.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param partials - The partials' hashes, in partition order; at least one
 * @returns The partials' collection type (the first partial's) and the
 *   components ordered by first key — none when every partial is empty
 * @throws {Error} When `partials` is empty or a partial is not a Dict or Set.
 */
export async function mergeComponents(
  storage: StorageBackend,
  repo: string,
  partials: readonly string[],
): Promise<{ typeValue: EastTypeValue; components: MergeComponent[] }> {
  if (partials.length === 0) {
    throw new Error('mergeComponents: no partials');
  }
  let typeValue: EastTypeValue | null = null;
  const ranges: { partition: number; first: unknown; last: unknown }[] = [];
  for (let p = 0; p < partials.length; p++) {
    const blob = await PartitionBlob.open(storage, repo, partials[p]!);
    try {
      typeValue ??= blob.extents.typeValue;
      if (blob.extents.offsets.length === 0) continue;
      ranges.push({ partition: p, first: await blob.fence(0), last: await blob.lastKey() });
    } finally {
      blob.release();
    }
  }
  const collection = typeValue!;
  if (collection.type !== 'Dict' && collection.type !== 'Set') {
    throw new Error(`partition merge applies to Dict and Set outputs, got ${collection.type}`);
  }
  const keyType: EastTypeValue = collection.type === 'Dict' ? collection.value.key : collection.value;
  const cmp = compareFor(keyType as any) as (a: unknown, b: unknown) => number;

  ranges.sort((a, b) => cmp(a.first, b.first) || a.partition - b.partition);
  const components: MergeComponent[] = [];
  let greatestLast: unknown;
  for (const range of ranges) {
    const current = components[components.length - 1];
    if (current !== undefined && cmp(range.first, greatestLast) <= 0) {
      current.partitions.push(range.partition);
      if (cmp(range.last, greatestLast) > 0) greatestLast = range.last;
    } else {
      components.push({ first: range.first, partitions: [range.partition] });
      greatestLast = range.last;
    }
  }
  for (const component of components) {
    component.partitions.sort((a, b) => a - b);
  }
  return { typeValue: collection, components };
}

/**
 * Splits one level of a group's entries into the runs the level reduces:
 * `fanIn` consecutive entries each, the last run holding the rest. A run of
 * one passes through to the next level.
 *
 * @param entries - The group's entries at this level, in order
 * @param fanIn - The most entries one unit takes
 * @returns The runs, in order
 */
export function mergeTreeGroups<T>(entries: readonly T[], fanIn = MERGE_TREE_FANIN): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < entries.length; i += fanIn) {
    groups.push(entries.slice(i, i + fanIn));
  }
  return groups;
}

/**
 * The number of levels a reduce tree over groups of the given sizes runs:
 * the most grouping rounds any group takes to reach one entry.
 *
 * @param sizes - Each group's number of entries
 * @param fanIn - The most entries one unit takes
 * @returns The number of levels; `0` when no group has two entries
 */
export function mergeTreeLevels(sizes: readonly number[], fanIn = MERGE_TREE_FANIN): number {
  let levels = 0;
  for (const size of sizes) {
    let entries = size;
    let depth = 0;
    while (entries > 1) {
      entries = Math.ceil(entries / fanIn);
      depth++;
    }
    levels = Math.max(levels, depth);
  }
  return levels;
}

// =============================================================================
// Steps
// =============================================================================

/** Where a step reads a hash from: a logical input, an earlier step's
 *  result, or an object the template wrote. */
export type StepSource = { input: number } | { step: number } | { object: string };

/** The plan step: partition boundaries from the primary's segment index. */
export interface PlanStep {
  kind: 'plan';
  /** The primary partitioned input, as a logical input index. */
  primary: number;
  /** The co-partitioned secondaries, as logical input indices. */
  secondaries: number[];
  /** The `by` projection's IR bundle, or `null` for free partitioning. */
  by: Uint8Array | null;
  /** Target carved-slice size in wire bytes. */
  targetBytes: number;
}

/** The map step: one execution per partition of the plan. */
export interface MapStep {
  kind: 'map';
  /** Hash of the task each partition executes. */
  taskHash: string;
  /** The task each partition executes. */
  task: TaskObject;
  /** The step holding the plan. */
  plan: number;
  /** The unit's inputs, in wire order: `{ slice: n }` is partitioned input
   *  `n`'s slice for the partition, carved on demand. */
  inputs: (StepSource | { slice: number })[];
  /** The label of the unit's log lines and progress events. */
  label: 'partition';
}

/** The reduce step: a tree of executions over an earlier step's hashes. */
export interface ReduceStep {
  kind: 'reduce';
  /** Hash of the task each unit executes, or `null` when none can run. */
  taskHash: string | null;
  /** The task each unit executes, or `null` when none can run. */
  task: TaskObject | null;
  /** Why no unit can run — the logical execution's error, raised only when
   *  a unit would run. */
  unavailable: string | null;
  /** The inputs preceding a unit's entries, in wire order. */
  leading: StepSource[];
  /** The step whose hashes the tree reduces. */
  over: number;
  /** The most entries one unit takes. */
  fanIn: number;
  /** How the entries group: `all` as one group; `ranges`, the partials
   *  whose key ranges overlap grouped into components, each cut into key
   *  ranges of about `rangeBytes` that merge as their own groups, in key
   *  order — every unit of a group takes the group's range as an input. */
  group: 'all' | 'ranges';
  /** The bytes one range aims for under `ranges` — the task's
   *  `targetPartitionBytes`; unused otherwise. */
  rangeBytes: number;
  /** The label of the unit's log lines and progress events. */
  label: 'merge' | 'combine';
}

/** The splice step: the byte splice of an earlier step's hashes. */
export interface SpliceStep {
  kind: 'splice';
  /** The step whose hashes splice, in order. */
  over: number;
  /** The step whose first hash supplies the header when `over` yields no
   *  hash (every partial empty), or `null`. */
  fallback: number | null;
  /** What the hashes are, for the order error. */
  subject: 'shards' | 'components';
}

/** One step of a template. */
export type Step = PlanStep | MapStep | ReduceStep | SpliceStep;

/** A step's result. */
export type StepResult =
  | { kind: 'plan'; plan: PartitionPlan; partitions: number }
  | { kind: 'hashes'; hashes: string[] }
  | { kind: 'hash'; hash: string };

/**
 * What runs a template's units and moves its bytes.
 *
 * @remarks
 * The local executor runs the standard execution body in this process and
 * carves and splices through the storage layer; a remote backend supplies
 * its own unit executor and byte hooks, so the orchestration stays in
 * e3-core whatever runs the units.
 */
export interface StepExecutors {
  /** Runs one unit on a cache miss. */
  executeUnit: PartitionUnitExecutor;
  /** Carves one partition's slices of a plan; defaults to
   *  {@link carvePartitionSlices}. */
  carve?: (storage: StorageBackend, repo: string, plan: PartitionPlan, p: number) => Promise<string[]>;
  /** Splices stored blobs in order; defaults to {@link spliceBlobs}. */
  splice?: (storage: StorageBackend, repo: string, hashes: string[]) => Promise<string>;
}

/**
 * The template of a partitioned task: the steps its metadata selects.
 *
 * @remarks
 * Writes the objects the steps execute — the combine IR of a combine task;
 * the merge IR and the merge unit task (the runner's `merge` command, from
 * the package's `mergeCommand`) of a merge task. Every object is a pure
 * function of the package's own objects, so writing them again on every run
 * is idempotent; none of them is a gc root.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param taskHash - Hash of the partitioned task
 * @param task - The partitioned task
 * @param meta - Its partition metadata
 * @param inputCount - The number of logical inputs
 * @returns The steps, in order
 */
export async function templateFor(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  task: TaskObject,
  meta: PartitionTaskMetadata,
  inputCount: number,
): Promise<Step[]> {
  const partitionCount = Number(meta.partitions);
  const plan: PlanStep = {
    kind: 'plan',
    primary: 1,
    secondaries: Array.from({ length: partitionCount - 1 }, (_, i) => 2 + i),
    by: meta.by.type === 'some' ? meta.by.value : null,
    targetBytes: Number(meta.targetPartitionBytes),
  };
  const map: MapStep = {
    kind: 'map',
    taskHash,
    task,
    plan: 0,
    inputs: [
      { input: 0 },
      ...Array.from({ length: partitionCount }, (_, i) => ({ slice: i })),
      ...Array.from({ length: Math.max(0, inputCount - 1 - partitionCount) }, (_, i) => ({ input: 1 + partitionCount + i })),
    ],
    label: 'partition',
  };
  if (meta.merge.type === 'some' || meta.mergeSets) {
    let unit: { taskHash: string; task: TaskObject } | null = null;
    let unavailable: string | null = null;
    if (task.runner.type === 'custom') {
      unavailable = CUSTOM_RUNTIME_MERGE_MESSAGE;
    } else if (meta.mergeCommand.type !== 'some') {
      unavailable = NO_MERGE_COMMAND_MESSAGE;
    } else {
      const commandIr = await storage.objects.write(repo, meta.mergeCommand.value);
      const unitTask: TaskObject = {
        commandIr,
        inputs: [],
        output: [],
        kind: some(TASK_KIND_MERGE),
        metadata: none,
        runner: task.runner,
        environment: task.environment,
      };
      unit = { taskHash: await storage.objects.write(repo, encodeBeast2For(TaskObjectType)(unitTask)), task: unitTask };
    }
    const leading: StepSource[] = meta.merge.type === 'some'
      ? [{ object: await storage.objects.write(repo, meta.merge.value) }]
      : [];
    return [
      plan,
      map,
      { kind: 'reduce', taskHash: unit?.taskHash ?? null, task: unit?.task ?? null, unavailable, leading, over: 1, fanIn: MERGE_TREE_FANIN, group: 'ranges', rangeBytes: Number(meta.targetPartitionBytes), label: 'merge' },
      { kind: 'splice', over: 2, fallback: 1, subject: 'components' },
    ];
  }
  if (meta.combine.type === 'some') {
    // Combine steps are ordinary executions too: the combine IR is the
    // execution's input 0 (exactly as function_ir is for body executions),
    // so re-aggregation is memoized along the unchanged side of the tree.
    const combineIr = await storage.objects.write(repo, meta.combine.value);
    return [
      plan,
      map,
      { kind: 'reduce', taskHash, task, unavailable: null, leading: [{ object: combineIr }], over: 1, fanIn: 2, group: 'all', rangeBytes: 0, label: 'combine' },
    ];
  }
  return [plan, map, { kind: 'splice', over: 1, fallback: null, subject: 'shards' }];
}

/** A unit of a pool that threw — its executor or cache probe failing, which is
 *  not the unit's own failure — with its index in the step or level. */
interface ThrownUnit {
  index: number;
  error: unknown;
}

/**
 * The lowest-index unit of a pool that threw: deterministic attribution, as
 * for a unit that failed.
 *
 * @param thrown - The pool's thrown units, in any order; at least one
 * @returns The one with the lowest index
 */
function lowestThrown(thrown: readonly ThrownUnit[]): ThrownUnit {
  return thrown.reduce((lowest, unit) => (unit.index < lowest.index ? unit : lowest));
}

/** Where a reduce unit sits in its tree, for progress and the logical log. */
export interface ReduceUnitPosition {
  /** The unit's level, from 1. */
  level: number;
  /** The tree's number of levels. */
  levels: number;
  /** The unit's index within its level, from 0. */
  index: number;
  /** The level's number of units. */
  total: number;
  /** Units of the level completed so far, including this one once it has
   *  completed. */
  completed: number;
  /** The index of the unit's first entry within its group at this level. */
  first: number;
  /** Hash of the unit's task object. */
  taskHash: string;
}

/**
 * Executes a partitioned task by interpreting its template: plan → map →
 * reduce and/or splice, recording the logical result under the task's own
 * `(taskHash, inputsHash)` identity.
 *
 * Called by `taskExecute` after its cache probe and task decode. Every unit
 * is probed in the execution cache here and run through `executors.executeUnit`
 * only on a miss (never back through the dispatch, which would re-enter this
 * path). A plan of one partition runs its single unit through the executor
 * under the logical inputs: its slice would be byte-identical to the input,
 * and its identity is the logical one.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param taskHash - Hash of the task object
 * @param task - The decoded task object (kind `partition`)
 * @param inputHashes - Logical input hashes: `[functionIr, ...partitions, ...broadcast]`
 * @param ids - The logical execution's identity
 * @param options - Execution options
 * @param executors - What runs the units and moves the bytes
 * @returns The logical execution result
 */
export async function executeTemplate(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  task: TaskObject,
  inputHashes: string[],
  ids: ExecutionIds,
  options: ExecuteOptions,
  executors: StepExecutors,
): Promise<ExecutionResult> {
  const { inHash, executionId, startTime } = ids;
  const carve = executors.carve ?? carvePartitionSlices;
  const splice = executors.splice ?? spliceBlobs;

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
  /** A unit that did not succeed, as the logical execution's result. */
  const unitResult = async (message: string, unit: ExecutionResult): Promise<ExecutionResult> => {
    const detail = unit.state === 'failed'
      ? `failed (exit code ${unit.exitCode})${unit.error ? `: ${unit.error}` : ''}`
      // A unit reaching here in the success state is one that wrote no
      // output — an executor's broken promise, not a failure it reported —
      // so it is named for what it is rather than as `errored: undefined`.
      : unit.state === 'success'
        ? 'reported success without writing an output'
        : `errored: ${unit.error}`;
    return unit.state === 'failed' ? failedResult(unit.exitCode, `${message} ${detail}`) : errorResult(`${message} ${detail}`);
  };
  /**
   * Units that threw — their executor or cache probe failing, not the units'
   * own failure — end the logical execution once their pool has drained: it
   * is recorded `error`, naming the lowest-index unit that threw (its log
   * lines landing first), and that unit's error is rethrown to the caller.
   */
  const thrownUnits = async (thrown: readonly ThrownUnit[], describe: (index: number) => string): Promise<void> => {
    if (thrown.length === 0) return;
    const unit = lowestThrown(thrown);
    try {
      await errorResult(`${describe(unit.index)} could not run: ${unit.error instanceof Error ? unit.error.message : String(unit.error)}`);
    } catch {
      // The record cannot be written either: the unit's own error stands.
    }
    throw unit.error;
  };

  // ---------------------------------------------------------------------
  // Decode the partition spec and build the template.
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
  let steps: Step[];
  try {
    steps = await templateFor(storage, repo, taskHash, task, meta, inputHashes.length);
  } catch (err) {
    return errorResult(`Failed to build the partition template: ${err instanceof Error ? err.message : err}`);
  }

  // Every unit is probed in the execution cache here, and run by the
  // executor only on a miss.
  const runUnit = async (unitTaskHash: string, unitTask: TaskObject, unitInputs: string[]): Promise<ExecutionResult> => {
    if (!options.force) {
      const cached = await probeExecutionCache(storage, repo, unitTaskHash, inputsHash(unitInputs));
      if (cached !== null) return cached;
    }
    return executors.executeUnit(unitTaskHash, unitTask, unitInputs, options);
  };
  // The pool width: how many units a map step or a reduce level has in
  // flight at once. Under a jobs budget the pool is as wide as the budget —
  // the budget, not the pool, bounds the runner processes, and a unit waiting
  // for a slot has already carved its slices.
  const concurrency = Math.max(1, options.partitionConcurrency ?? options.jobs?.capacity ?? DEFAULT_PARTITION_CONCURRENCY);
  const progress = options.onPartitionProgress;
  const resolve = (source: StepSource, results: StepResult[]): string[] => {
    if ('input' in source) return [inputHashes[source.input]!];
    if ('object' in source) return [source.object];
    const result = results[source.step]!;
    return result.kind === 'hashes' ? result.hashes : result.kind === 'hash' ? [result.hash] : [];
  };

  const results: StepResult[] = [];
  let recordedRunning = false;
  // The plan of a previous run of this logical execution, if the `plan`
  // sidecar names one, and this run's own record of what it carved and
  // planned: the map step writes it with the partition slices, the reduce
  // step again with each component's merge ranges.
  let recordedPlan: PartitionPlan | null = null;
  let carved: { plan: PartitionPlan; slices: string[][]; merges: PartitionPlan['merges'] } | null = null;
  const recordPlan = async (): Promise<void> => {
    if (carved === null) return;
    const hash = await storage.objects.write(repo, encodePartitionPlan({ ...carved.plan, slices: carved.slices, merges: carved.merges }));
    await storage.refs.executionPlanWrite?.(repo, taskHash, inHash, hash);
  };
  for (const step of steps) {
    switch (step.kind) {
      case 'plan': {
        let planned: { plan: PartitionPlan; partitions: number };
        try {
          planned = await planPartitions(storage, repo, {
            primary: inputHashes[step.primary]!,
            secondaries: step.secondaries.map((i) => inputHashes[i]!),
            by: step.by,
            targetBytes: step.targetBytes,
          });
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err));
        }
        // A single partition's slice is byte-identical to the input, so
        // carving and splicing would only re-write the input blob and record
        // the same work twice (the unit's identity collides with the logical
        // one). Run the one unit under the logical inputs instead.
        if (planned.partitions === 1) {
          progress?.({ phase: 'partition', index: 0, total: 1, completed: 0, state: 'started' });
          const result = await executors.executeUnit(taskHash, task, inputHashes, options);
          progress?.({ phase: 'partition', index: 0, total: 1, completed: 1, state: 'completed', cached: result.cached, duration: result.duration });
          return result;
        }
        // Two or more partitions: the logical execution is this process's
        // own work while its units run — recorded `running` under this
        // process, with the owner sidecar naming it.
        if (!recordedRunning) {
          recordedRunning = true;
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
        }
        // The plan is stored before anything is carved from it.
        try {
          await storage.objects.write(repo, encodePartitionPlan(planned.plan));
        } catch (err) {
          return errorResult(`Failed to record the partition plan: ${err instanceof Error ? err.message : err}`);
        }
        results.push({ kind: 'plan', plan: planned.plan, partitions: planned.partitions });
        break;
      }

      case 'map': {
        const planned = results[step.plan]!;
        if (planned.kind !== 'plan') return errorResult('partition template: the map step reads no plan');
        const { plan, partitions } = planned;
        // The `plan` sidecar names the plan of a previous run: when it plans
        // exactly as this one, the slices it carved are reused, partition by
        // partition (`force` re-runs executions, never the carve); the rest
        // are carved when a worker picks the partition up.
        let reused: string[][] | null = null;
        try {
          const recordedPlanHash = await storage.refs.executionPlanRead?.(repo, taskHash, inHash) ?? null;
          if (recordedPlanHash !== null) recordedPlan = await readRecordedPlan(storage, repo, recordedPlanHash);
          if (recordedPlan !== null) reused = await recordedSlices(storage, repo, recordedPlan, plan);
        } catch (err) {
          return errorResult(`Failed to carve partition slices: ${err instanceof Error ? err.message : err}`);
        }
        const sliceCount = plan.partitions.length;
        // sliceHashes[input][partition], filled in as partitions are carved.
        const sliceHashes: string[][] = reused?.map((slices) => slices.slice())
          ?? Array.from({ length: sliceCount }, () => Array.from({ length: partitions }, () => ''));
        const unitResults: (ExecutionResult | undefined)[] = Array.from({ length: partitions }, () => undefined);
        const carveFailures: (string | undefined)[] = Array.from({ length: partitions }, () => undefined);
        // A unit that throws stops the pool as a failure does — no worker
        // takes another partition — and the step waits for the units in
        // flight before it rethrows, so none runs on, writing its record,
        // after the logical execution has ended.
        const thrown: ThrownUnit[] = [];
        let nextPartition = 0;
        let partitionsCompleted = 0;
        let hasFailure = false;
        const workers = Array.from({ length: Math.min(concurrency, partitions) }, async () => {
          for (;;) {
            const p = nextPartition++;
            if (p >= partitions || hasFailure || options.signal?.aborted) return;
            if (sliceHashes.some((slices) => slices[p] === '')) {
              try {
                const carved = await carve(storage, repo, plan, p);
                for (let input = 0; input < carved.length; input++) {
                  sliceHashes[input]![p] = carved[input]!;
                }
              } catch (err) {
                carveFailures[p] = err instanceof Error ? err.message : String(err);
                hasFailure = true;
                continue;
              }
            }
            try {
              progress?.({ phase: step.label, index: p, total: partitions, completed: partitionsCompleted, state: 'started' });
              const unitInputs = step.inputs.flatMap((source) => 'slice' in source ? [sliceHashes[source.slice]![p]!] : resolve(source, results));
              const result = await runUnit(step.taskHash, step.task, unitInputs);
              unitResults[p] = result;
              logUnit(`${step.label} ${p + 1}/${partitions}`, step.taskHash, result);
              partitionsCompleted++;
              progress?.({ phase: step.label, index: p, total: partitions, completed: partitionsCompleted, state: 'completed', cached: result.cached, duration: result.duration });
              // A unit e3 stopped because the run was aborted is not a failure.
              if (result.state !== 'success' && !result.cancelled) hasFailure = true;
            } catch (error) {
              thrown.push({ index: p, error });
              hasFailure = true;
              return;
            }
          }
        });
        await Promise.all(workers);

        // The plan is recorded with whatever was carved, whatever happened —
        // an uncarved slice as '' — so a retry reuses the slices it has.
        carved = { plan, slices: sliceHashes, merges: [] };
        try {
          await recordPlan();
        } catch (err) {
          return errorResult(`Failed to record the partition plan: ${err instanceof Error ? err.message : err}`);
        }
        await thrownUnits(thrown, (p) => `Partition ${p + 1} of ${partitions}`);

        // An aborted run stops here, whatever its units did.
        if (options.signal?.aborted || unitResults.some((r) => r?.cancelled)) {
          return cancelledResult();
        }
        // Attribute failure deterministically: the LOWEST-index failed
        // partition among the completed results, not whichever failing worker
        // settled first. A partition whose carve failed has no result, and
        // counts at its index; one that reports success without an output
        // counts as failed too, so the hashes below never carry a null.
        const failedPartition = unitResults.findIndex((r) => r !== undefined && (r.state !== 'success' || r.outputHash === null));
        const failedCarve = carveFailures.findIndex((message) => message !== undefined);
        if (failedCarve >= 0 && (failedPartition < 0 || failedCarve < failedPartition)) {
          return errorResult(`Failed to carve partition slices: ${carveFailures[failedCarve]}`);
        }
        if (failedPartition >= 0) {
          // The runner's error tail rides the message too — without it the
          // message carries only an exit code and the cause is invisible
          // without digging into the unit's logs.
          return unitResult(`Partition ${failedPartition + 1} of ${partitions}`, unitResults[failedPartition]!);
        }
        results.push({ kind: 'hashes', hashes: unitResults.map((r) => r!.outputHash!) });
        break;
      }

      case 'reduce': {
        const over = resolve({ step: step.over }, results);
        // The groups the tree reduces: each as its entries' hashes at level
        // 1, and the key range its units take as an input, when they do.
        let groups: { range: string | null; entries: string[] }[];
        try {
          if (step.group === 'all') {
            groups = [{ range: null, entries: over }];
          } else {
            // The partials whose key ranges overlap form components, and each
            // component is cut into key ranges of about `rangeBytes`, planned
            // from the partials' indexes alone and written as the range blobs
            // its units take as an input; every range merges the component's
            // partials as its own group — a component of one range merges
            // them whole, over the open range. The ranges are recorded in the
            // plan, so a re-run with the same partials reuses them and, its
            // units' inputs unchanged, cache-hits.
            groups = [];
            const components = (await mergeComponents(storage, repo, over)).components.map((component) => component.partitions.map((i) => over[i]!));
            for (const partials of components) {
              // A component of one partial is already its own result: no
              // unit runs over a group of one, so it passes through whole,
              // however many segments it spans — a range would only be
              // ignored, and a range per segment would repeat the partial.
              if (partials.length === 1) {
                groups.push({ range: null, entries: partials });
                continue;
              }
              if (options.signal?.aborted) return await cancelledResult();
              const ranges = (recordedPlan !== null ? await recordedMergeRanges(storage, repo, recordedPlan, partials) : null)
                ?? await planMergeRanges(storage, repo, partials, step.rangeBytes);
              for (const range of ranges) groups.push({ range, entries: partials });
              carved?.merges.push({ partials: [...partials], ranges });
            }
            // One record of every component's ranges: planning is fence
            // probes only, so a run that dies here just plans again.
            if (carved !== null && carved.merges.length > 0) await recordPlan();
          }
        } catch (err) {
          return errorResult(`Failed to merge partition partials: ${err instanceof Error ? err.message : err}`);
        }
        const levels = mergeTreeLevels(groups.map((group) => group.entries.length), step.fanIn);
        if (levels > 0 && step.unavailable !== null) {
          return errorResult(step.unavailable);
        }
        const leading = step.leading.flatMap((source) => resolve(source, results));
        for (let level = 1; level <= levels; level++) {
          const runs = groups.map((group) => mergeTreeGroups(group.entries, step.fanIn));
          const units: { group: number; run: number; entries: string[] }[] = [];
          runs.forEach((groupRuns, group) => {
            groupRuns.forEach((run, index) => {
              if (run.length > 1) units.push({ group, run: index, entries: run });
            });
          });
          const unitResults: (ExecutionResult | undefined)[] = Array.from({ length: units.length }, () => undefined);
          const positions: (ReduceUnitPosition | undefined)[] = Array.from({ length: units.length }, () => undefined);
          // As in the map step: a unit that throws stops the level's pool,
          // and the level drains before it rethrows.
          const thrown: ThrownUnit[] = [];
          let nextUnit = 0;
          let completed = 0;
          let hasFailure = false;
          const workers = Array.from({ length: Math.min(concurrency, units.length) }, async () => {
            for (;;) {
              const index = nextUnit++;
              if (index >= units.length || hasFailure || options.signal?.aborted) return;
              try {
                const unit = units[index]!;
                const position: Omit<ReduceUnitPosition, 'completed'> = {
                  level, levels, index, total: units.length, first: unit.run * step.fanIn, taskHash: step.taskHash!,
                };
                progress?.({ phase: step.label, index, total: units.length, completed, state: 'started' });
                const range = groups[unit.group]!.range;
                const result = await runUnit(step.taskHash!, step.task!, [...leading, ...(range !== null ? [range] : []), ...unit.entries]);
                countAssemblyUnit();
                unitResults[index] = result;
                completed++;
                positions[index] = { ...position, completed };
                logUnit(`${step.label} level ${level}/${levels} unit ${index + 1}/${units.length}`, step.taskHash!, result);
                if (result.state === 'success' && result.outputHash !== null) {
                  progress?.({ phase: step.label, index, total: units.length, completed, state: 'completed', cached: result.cached, duration: result.duration });
                } else if (!result.cancelled) {
                  hasFailure = true;
                }
              } catch (error) {
                thrown.push({ index, error });
                hasFailure = true;
                return;
              }
            }
          });
          await Promise.all(workers);
          await thrownUnits(thrown, (index) => {
            const first = units[index]!.run * step.fanIn;
            return step.label === 'combine'
              ? `Combine step over partials ${first} and ${first + units[index]!.entries.length - 1}`
              : `Merge unit ${index + 1} of ${units.length} at level ${level} of ${levels}`;
          });

          if (options.signal?.aborted || unitResults.some((r) => r?.cancelled)) {
            return cancelledResult();
          }
          // Deterministic attribution: the lowest-index unit that did not succeed.
          const failed = unitResults.findIndex((r) => r !== undefined && (r.state !== 'success' || r.outputHash === null));
          if (failed >= 0) {
            const position = positions[failed]!;
            const message = step.label === 'combine'
              ? `Combine step over partials ${position.first} and ${position.first + units[failed]!.entries.length - 1}`
              : `Merge unit ${position.index + 1} of ${position.total} at level ${position.level} of ${position.levels}`;
            return unitResult(message, unitResults[failed]!);
          }
          // The next level's entries: each run's output, or its one entry.
          const next = runs.map((groupRuns) => groupRuns.map((run) => run[0]!));
          units.forEach((unit, index) => {
            next[unit.group]![unit.run] = unitResults[index]!.outputHash!;
          });
          groups = groups.map((group, g) => ({ range: group.range, entries: next[g]! }));
        }
        results.push({ kind: 'hashes', hashes: groups.map((group) => group.entries[0]!) });
        break;
      }

      case 'splice': {
        const over = resolve({ step: step.over }, results);
        let hash: string;
        try {
          if (over.length === 0) {
            // Every partial is empty: the empty collection under the first
            // partial's header.
            const source = step.fallback !== null ? resolve({ step: step.fallback }, results) : [];
            if (source.length === 0) return await errorResult('partition template: nothing to splice');
            const first = await PartitionBlob.open(storage, repo, source[0]!);
            hash = await storage.objects.writeStream(repo, spliceChunks(first.extents.head, []));
          } else if (over.length === 1 && step.subject === 'components') {
            hash = over[0]!;
          } else {
            hash = await splice(storage, repo, over);
          }
        } catch (err) {
          if (err instanceof SpliceOrderError && step.subject === 'shards') {
            return errorResult(
              `Partition shards ${err.left + 1} and ${err.right + 1} of ${over.length} do not ascend disjointly in key order — ` +
              `a splice-mode partition task must keep (or monotonically re-key) the partition key order. ` +
              `Use \`combine\` to aggregate partials instead, or customTask for full control.`
            );
          }
          return errorResult(step.subject === 'shards'
            ? `Failed to splice partition shards: ${err instanceof Error ? err.message : err}`
            : `Failed to merge partition partials: ${err instanceof Error ? err.message : err}`);
        }
        results.push({ kind: 'hash', hash });
        break;
      }
    }
  }

  const last = results[results.length - 1];
  const outputHash = last?.kind === 'hash' ? last.hash : last?.kind === 'hashes' && last.hashes.length === 1 ? last.hashes[0]! : null;
  if (outputHash === null) {
    return errorResult('partition template: the last step yields no single output');
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
 * Executes a partitioned task with the local byte hooks: the template
 * interpreter over `executeUnit`. See {@link executeTemplate}.
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
export function partitionTaskExecute(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  task: TaskObject,
  inputHashes: string[],
  ids: ExecutionIds,
  options: ExecuteOptions,
  executeUnit: PartitionUnitExecutor,
): Promise<ExecutionResult> {
  return executeTemplate(storage, repo, taskHash, task, inputHashes, ids, options, { executeUnit });
}
