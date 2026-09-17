/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Keyed fan-in of a partitioned task as a merge tree of stream executions
 * (issue #770).
 *
 * The partials of a `merge` (Dict) or `mergeSets` (Set) partition task are
 * merged by the task's own runner; the orchestrator never decodes them. It
 * reads each partial's key range — its first fence and its last key — and
 * groups partials whose ranges overlap into components. A component of one
 * partial is already its own result; a larger component is merged through a
 * tree of ordinary stream executions, each merging up to
 * {@link MERGE_TREE_FANIN} entries: a synthesized stream task whose body emits
 * every entry of its inputs into a sink that folds equal keys with the task's
 * `merge` function (`--merge`) or keeps the first of equal elements
 * (`--union`). The components' results are then spliced in key order by the
 * caller.
 *
 * A unit is content-addressed like any execution: its task object is a pure
 * function of the parent's runner, environment, output type and merge
 * function, so the units along an unchanged part of the tree cache-hit.
 * `merge` must be associative, since the tree folds a key's values in groups.
 */

import {
  ArrayType,
  East,
  EastIR,
  FunctionType,
  NullType,
  StringType,
  compareFor,
  encodeBeast2For,
  encodeEastIR,
  fromEastTypeValue,
  isTypeValueEqual,
  some,
  toEastTypeValue,
  type EastTypeValue,
  type FunctionIR,
} from '@elaraai/east';
import {
  TASK_KIND_STREAM,
  TaskObjectType,
  decodePartitionTaskMetadata,
  encodeStreamTaskMetadata,
  streamCommandIr,
  stripIrLocations,
  type TaskObject,
} from '@elaraai/e3-types';
import { PartitionBlob, decodedSegmentPeak, resetDecodedSegmentPeak } from './partitionIo.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { ExecutionResult } from './LocalTaskRunner.js';

/** The most entries one merge unit merges. */
export const MERGE_TREE_FANIN = 8;

/** Why a merge tree cannot run on a task's runner. */
const CUSTOM_RUNTIME_MERGE_MESSAGE =
  'partition merge needs a stock runtime (east-c, east-node, east-py); this task uses the custom runtime';

/** Assembly units — merge units and combine steps — run or found cached since
 *  the counters were last reset. */
let assemblyUnits = 0;

/**
 * Counts one assembly unit, a merge unit or a combine step.
 *
 * @internal
 */
export function countAssemblyUnit(): void {
  assemblyUnits++;
}

/** The signature of a command IR, `(inputs, output) -> argv`. */
const COMMAND_IR_TYPE = toEastTypeValue(FunctionType([ArrayType(StringType), StringType], ArrayType(StringType)));

/**
 * The counters of a partitioned execution's assembly — the orchestrator's
 * side of issue #770's memory claim.
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
 * Runs `run` and returns the partition assembly's counters over it.
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
 * Splits one level of a component's entries into the groups the level
 * merges: {@link MERGE_TREE_FANIN} consecutive entries each, the last group
 * holding the rest. A group of one passes through to the next level.
 *
 * @param entries - The component's entries at this level, in order
 * @returns The groups, in order
 */
export function mergeTreeGroups<T>(entries: readonly T[]): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < entries.length; i += MERGE_TREE_FANIN) {
    groups.push(entries.slice(i, i + MERGE_TREE_FANIN));
  }
  return groups;
}

/**
 * The number of levels a merge tree over components of the given sizes
 * runs: the most grouping rounds any component takes to reach one entry.
 *
 * @param sizes - Each component's number of partials
 * @returns The number of levels; `0` when no component has two partials
 */
export function mergeTreeLevels(sizes: readonly number[]): number {
  let levels = 0;
  for (const size of sizes) {
    let entries = size;
    let depth = 0;
    while (entries > 1) {
      entries = Math.ceil(entries / MERGE_TREE_FANIN);
      depth++;
    }
    levels = Math.max(levels, depth);
  }
  return levels;
}

/**
 * The body of a merge unit over `m` partials: `(T, …, T, emit) -> Null`, which
 * emits every entry of every partial in parameter order — `emit(key, value)`
 * for a Dict, `emit(element)` for a Set. Built without locations (see
 * `stripIrLocations`).
 *
 * @param typeValue - The partials' collection type (Dict or Set)
 * @param m - The number of partials the unit merges
 * @returns The body IR
 * @throws {Error} When the type is not a Dict or Set.
 */
export function mergeBodyIr(typeValue: EastTypeValue, m: number): EastIR<any, null> {
  if (typeValue.type !== 'Dict' && typeValue.type !== 'Set') {
    throw new Error(`partition merge applies to Dict and Set outputs, got ${typeValue.type}`);
  }
  const isDict = typeValue.type === 'Dict';
  const collectionType = fromEastTypeValue(typeValue);
  const emitType = isDict
    ? FunctionType([fromEastTypeValue(typeValue.value.key), fromEastTypeValue(typeValue.value.value)], NullType)
    : FunctionType([fromEastTypeValue(typeValue.value)], NullType);
  const partialTypes = Array.from({ length: m }, () => collectionType);
  const body = East.function([...partialTypes, emitType], NullType, ($, ...params: any[]) => {
    const emit = params[m];
    for (const partial of params.slice(0, m)) {
      if (isDict) {
        $.for(partial, ($, value, key) => {
          $(emit(key, value));
        });
      } else {
        $.for(partial, ($, element) => {
          $(emit(element));
        });
      }
    }
  });
  return stripIrLocations(body.toIR()) as EastIR<any, null>;
}

/** A merge unit's task, and the wire inputs that precede its partials. */
export interface SynthesizedMergeTask {
  /** Hash of the unit's task object. */
  taskHash: string;
  /** The unit's task object: a stream task on the parent's runner. */
  task: TaskObject;
  /** The body IR's hash, then the merge IR's in function mode. */
  inputs: string[];
}

/**
 * Writes the objects of a merge unit over `m` partials — its body IR, the
 * merge IR (function mode), its command IR and its task object — and returns
 * the task. Every object is a pure function of the arguments, so writing
 * them again on every run is idempotent; none of them is a gc root.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param parent - The partitioned task whose partials the unit merges
 * @param typeValue - The partials' collection type (Dict or Set)
 * @param mode - `function` folds equal Dict keys with the parent's `merge`;
 *   `union` keeps the first of equal Set elements
 * @param m - The number of partials the unit merges
 * @returns The unit's task and the inputs preceding its partials
 * @throws {Error} When the parent runs on the custom runtime, carries no
 *   `merge` function in function mode, or the type is not a Dict or Set.
 */
export async function synthesizeMergeTask(
  storage: StorageBackend,
  repo: string,
  parent: TaskObject,
  typeValue: EastTypeValue,
  mode: 'function' | 'union',
  m: number,
): Promise<SynthesizedMergeTask> {
  if (parent.runner.type === 'custom') {
    throw new Error(CUSTOM_RUNTIME_MERGE_MESSAGE);
  }
  const bodyIr = await storage.objects.write(repo, encodeEastIR(mergeBodyIr(typeValue, m)));
  const inputs = [bodyIr];
  if (mode === 'function') {
    const meta = parent.metadata.type === 'some' ? decodePartitionTaskMetadata(parent.metadata.value) : null;
    if (meta === null || meta.merge.type !== 'some') {
      throw new Error('partition merge: the task carries no merge function');
    }
    inputs.push(await storage.objects.write(repo, meta.merge.value));
  }
  const emit = typeValue.type === 'Dict' ? 'dict' : 'set';
  const commandIr = await storage.objects.write(
    repo, encodeEastIR(streamCommandIr(parent.runner, { emit, merge: mode, stream: 'all' })));
  const task: TaskObject = {
    commandIr,
    inputs: [],
    output: [],
    kind: some(TASK_KIND_STREAM),
    metadata: some(encodeStreamTaskMetadata({ stream: true, emit, merge: mode })),
    runner: parent.runner,
    environment: parent.environment,
  };
  const taskHash = await storage.objects.write(repo, encodeBeast2For(TaskObjectType)(task));
  return { taskHash, task, inputs };
}

/** Where a merge unit sits in the tree, for progress and the logical log. */
export interface MergeUnitPosition {
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
  /** Hash of the unit's task object. */
  taskHash: string;
}

/** Options for {@link assembleMergeTree}. */
export interface MergeTreeOptions {
  /** Storage backend */
  storage: StorageBackend;
  /** Repository identifier */
  repo: string;
  /** The partitioned task whose partials are merged. */
  parent: TaskObject;
  /** `function` for a Dict with a `merge` function, `union` for a Set. */
  mode: 'function' | 'union';
  /** The partials' hashes, in partition order. */
  partials: readonly string[];
  /** The most units that run at once. */
  concurrency: number;
  /** Runs one unit: probed in the execution cache, executed on a miss. */
  runUnit: (taskHash: string, task: TaskObject, inputs: string[]) => Promise<ExecutionResult>;
  /** The run's abort: once it fires, workers pick up no further unit. */
  signal?: AbortSignal;
  /** Called as a unit starts. */
  onUnitStarted?: (unit: MergeUnitPosition) => void;
  /** Called as a unit completes, whatever its result. */
  onUnitCompleted?: (unit: MergeUnitPosition, result: ExecutionResult) => void;
}

/** The outcome of {@link assembleMergeTree}. */
export type MergeTreeOutcome =
  /** Every unit succeeded: each component's result, ordered by first key
   *  (none when every partial is empty), and the number of units the tree
   *  ran or found cached. */
  | { kind: 'merged'; results: string[]; units: number }
  /** A unit did not succeed — the lowest-index one of its level. */
  | { kind: 'unitFailed'; unit: MergeUnitPosition; result: ExecutionResult }
  /** The run was aborted, or a unit was stopped because it was. */
  | { kind: 'cancelled' }
  /** The tree cannot run; the message is the logical execution's error. */
  | { kind: 'error'; message: string };

/**
 * Merges a partitioned task's partials by component, through a tree of merge
 * units.
 *
 * Each component of two or more partials takes its partials in partition
 * order; every level groups {@link MERGE_TREE_FANIN} consecutive entries of
 * each component into one unit (a group of one passes through) until one
 * entry remains. A level's units, across every component, run in a pool of
 * `concurrency` workers; the next level starts when the level is done. A
 * worker picks up no further unit once a unit has not succeeded or the run's
 * signal has fired; a unit stopped because the run was aborted is not a
 * failure, and the tree ends `cancelled`.
 *
 * @param options - The partials, the parent task and how units run
 * @returns The components' results, the failed unit, or why no tree can run
 */
export async function assembleMergeTree(options: MergeTreeOptions): Promise<MergeTreeOutcome> {
  const { storage, repo, parent, mode, partials } = options;
  const { typeValue, components } = await mergeComponents(storage, repo, partials);

  // Each component's entries at the current level: its partials, first.
  let entries = components.map((component) => component.partitions.map((p) => partials[p]!));
  const levels = mergeTreeLevels(entries.map((component) => component.length));
  if (levels > 0 && parent.runner.type === 'custom') {
    return { kind: 'error', message: CUSTOM_RUNTIME_MERGE_MESSAGE };
  }

  const synthesized = new Map<number, SynthesizedMergeTask>();
  let unitCount = 0;
  for (let level = 1; level <= levels; level++) {
    const groups = entries.map((component) => mergeTreeGroups(component));
    const units: { component: number; group: number; partials: string[] }[] = [];
    groups.forEach((componentGroups, component) => {
      componentGroups.forEach((group, index) => {
        if (group.length > 1) units.push({ component, group: index, partials: group });
      });
    });
    for (const unit of units) {
      const m = unit.partials.length;
      if (!synthesized.has(m)) {
        synthesized.set(m, await synthesizeMergeTask(storage, repo, parent, typeValue, mode, m));
      }
    }

    const results: (ExecutionResult | undefined)[] = Array.from({ length: units.length }, () => undefined);
    const positions: (MergeUnitPosition | undefined)[] = Array.from({ length: units.length }, () => undefined);
    let nextUnit = 0;
    let completed = 0;
    let hasFailure = false;
    const workers = Array.from({ length: Math.min(Math.max(1, options.concurrency), units.length) }, async () => {
      for (;;) {
        const index = nextUnit++;
        if (index >= units.length || hasFailure || options.signal?.aborted) return;
        const unit = units[index]!;
        const unitTask = synthesized.get(unit.partials.length)!;
        const position = { level, levels, index, total: units.length, taskHash: unitTask.taskHash };
        options.onUnitStarted?.({ ...position, completed });
        const result = await options.runUnit(unitTask.taskHash, unitTask.task, [...unitTask.inputs, ...unit.partials]);
        countAssemblyUnit();
        results[index] = result;
        completed++;
        positions[index] = { ...position, completed };
        options.onUnitCompleted?.(positions[index], result);
        if ((result.state !== 'success' || result.outputHash === null) && !result.cancelled) hasFailure = true;
      }
    });
    await Promise.all(workers);
    unitCount += units.length;

    if (options.signal?.aborted || results.some((r) => r?.cancelled)) {
      return { kind: 'cancelled' };
    }

    // Deterministic attribution: the lowest-index unit that did not succeed.
    const failed = results.findIndex((r) => r !== undefined && (r.state !== 'success' || r.outputHash === null));
    if (failed >= 0) {
      return { kind: 'unitFailed', unit: positions[failed]!, result: results[failed]! };
    }

    // The next level's entries: each group's output, or its one entry.
    entries = groups.map((componentGroups) => componentGroups.map((group) => group[0]!));
    units.forEach((unit, index) => {
      entries[unit.component]![unit.group] = results[index]!.outputHash!;
    });
  }

  return { kind: 'merged', results: entries.map((component) => component[0]!), units: unitCount };
}
