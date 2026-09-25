/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Task object types for e3.
 *
 * A task object says what a task runs, on which runtime, over which datasets,
 * and what its output is: every field a mode used to be implied by is typed.
 * Task objects are stored in the object store and referenced by packages, so
 * they are content-addressed, which is what memoizes their executions.
 *
 * Input and output types are not stored here: they are the package structure's
 * at the paths the task names.
 */

import { StructType, StringType, ArrayType, IntegerType, NullType, OptionType, VariantType, ValueTypeOf, decodeBeast2For, encodeBeast2For } from '@elaraai/east';
import { TreePathType } from './structure.js';
import { RunnerType } from './runner.js';

/** The kind tag every task object carries, which the garbage collector
 *  dispatches on. */
export const TASK_OBJECT_KIND = '$task';

/**
 * What a task runs.
 *
 * - `east`: an East program, which a stock runner executes as a unit
 *   (`exec`): `program` is the hash of its IR bundle.
 * - `command`: a command, which the custom runtime spawns. `commandIr` is the
 *   hash of the IR bundle of the East function that builds its argv,
 *   `(inputs: Array<String>, output: String) -> Array<String>`.
 */
export const TaskBodyType = VariantType({
  east: StructType({ program: StringType }),
  command: StructType({ commandIr: StringType }),
});
export type TaskBodyType = typeof TaskBodyType;
export type TaskBody = ValueTypeOf<typeof TaskBodyType>;

/**
 * An input the work may be split over: `by` names the leading key fields
 * whose equal values are never split across pieces — a field, or a
 * first-field path written `a.b`. Empty when any key may start a piece.
 */
export const TaskPartitionType = StructType({ by: ArrayType(StringType) });
export type TaskPartitionType = typeof TaskPartitionType;
export type TaskPartition = ValueTypeOf<typeof TaskPartitionType>;

/** A dataset a task reads, and whether the work may be split over it. */
export const TaskInputType = StructType({
  path: TreePathType,
  partition: OptionType(TaskPartitionType),
});
export type TaskInputType = typeof TaskInputType;
export type TaskInput = ValueTypeOf<typeof TaskInputType>;

/**
 * How a task's output is made, which fixes how the parts of it that units
 * write combine.
 *
 * - `value`: the program returns it.
 * - `array`: emitted elements, concatenated in emission order.
 * - `set`: emitted elements, in any order, unioned.
 * - `dict`: emitted entries, in any order; equal keys fold with `merge`, the
 *   hash of a `(K, V, V) -> V` IR bundle, and without it are refused.
 * - `fold`: emitted values folded with `combine`, the hash of a `(T, T) -> T`
 *   IR bundle, starting at `zero`, the hash of a stored value.
 */
export const TaskOutputKindType = VariantType({
  value: NullType,
  array: NullType,
  set: NullType,
  dict: StructType({ merge: OptionType(StringType) }),
  fold: StructType({ zero: StringType, combine: StringType }),
});
export type TaskOutputKindType = typeof TaskOutputKindType;
export type TaskOutputKind = ValueTypeOf<typeof TaskOutputKindType>;

/** Where a task's output goes, and how it is made. */
export const TaskOutputType = StructType({
  path: TreePathType,
  kind: TaskOutputKindType,
});
export type TaskOutputType = typeof TaskOutputType;
export type TaskOutput = ValueTypeOf<typeof TaskOutputType>;

/**
 * What a ui task binds as it renders.
 *
 * @property paths - Dataset paths it reads or writes through `Data.bind`,
 *   including each bound record's own path, so the record's current value is
 *   preloaded and polled like any dataset.
 * @property functions - Package functions it calls through `Func.bind`.
 * @property records - Records it binds through `Record.bind`.
 * @property pages - Dataset paths it reads a window at a time through
 *   `Data.bindPaged`: declared apart from `paths` because they are never
 *   preloaded or polled whole.
 */
export const DataManifestType = StructType({
  paths: ArrayType(TreePathType),
  functions: ArrayType(StringType),
  records: ArrayType(StringType),
  pages: ArrayType(TreePathType),
});
export type DataManifestType = typeof DataManifestType;
export type DataManifest = ValueTypeOf<typeof DataManifestType>;

/**
 * What a task's output is for: `data`, or a `ui` whose output is a component
 * tree rendered against the datasets, functions and records it binds.
 */
export const TaskRoleType = VariantType({
  data: NullType,
  ui: DataManifestType,
});
export type TaskRoleType = typeof TaskRoleType;
export type TaskRole = ValueTypeOf<typeof TaskRoleType>;

/**
 * Task object stored in the object store.
 *
 * @remarks
 * A package-borne wire, so it changes by hard cutover: a package exported by
 * an older SDK is re-exported, and {@link decodeTaskObject} says so.
 *
 * @example
 * ```ts
 * import { none, variant } from '@elaraai/east';
 *
 * const task: TaskObject = {
 *   kind: TASK_OBJECT_KIND,
 *   body: variant('east', { program: '5e7a3b...' }),
 *   runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }),
 *   inputs: [{ path: [variant('field', 'inputs'), variant('field', 'sales')], partition: none }],
 *   output: { path: [variant('field', 'tasks'), variant('field', 'totals'), variant('field', 'output')], kind: variant('value', null) },
 *   role: variant('data', null),
 *   environment: none,
 * };
 * ```
 */
export const TaskObjectType = StructType({
  /** Always {@link TASK_OBJECT_KIND}. */
  kind: StringType,
  /** What the task runs. */
  body: TaskBodyType,
  /** The runtime it runs on. A `custom` runner's command is informational:
   *  the body's command IR is what spawns. */
  runner: RunnerType,
  /** The datasets it reads, in the order its program takes them. */
  inputs: ArrayType(TaskInputType),
  /** Where its output goes, and how it is made. */
  output: TaskOutputType,
  /** What its output is for. */
  role: TaskRoleType,
  /** Hash of the {@link EnvironmentSpecType} object it executes in; `none`
   *  for the stock runtime image. */
  environment: OptionType(StringType),
});
export type TaskObjectType = typeof TaskObjectType;

export type TaskObject = ValueTypeOf<typeof TaskObjectType>;

const decodeCurrentTask = decodeBeast2For(TaskObjectType);

/**
 * Decode a `TaskObject` from BEAST2 bytes.
 *
 * @param data - the stored bytes
 * @returns the task object
 * @throws {Error} When the bytes are not a current task object — a package
 *   exported by an older SDK, which is re-exported with the current one.
 */
export function decodeTaskObject(data: Uint8Array): TaskObject {
  let task: TaskObject;
  try {
    task = decodeCurrentTask(data);
  } catch (err) {
    throw new Error(
      `the task object does not decode: the package was exported by an older e3 SDK — re-export it with the current one ` +
      `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (task.kind !== TASK_OBJECT_KIND) {
    throw new Error(`the object is not a task object: its kind is '${task.kind}', not '${TASK_OBJECT_KIND}'`);
  }
  return task;
}

// =============================================================================
// Partition plan
// =============================================================================

/** A carve position: a segment index and an element offset within it. */
const SplitPointType = StructType({ seg: IntegerType, offset: IntegerType });

/**
 * The plan of one merged component's fan-in (issue #770): the partials whose
 * key ranges overlap, and the key ranges its merge units run over, as the
 * hashes of the range blobs the units take as their input.
 *
 * @remarks
 * The ranges are a pure function of the partials and the target byte size —
 * the boundary keys are fences of the largest partial — so a re-run whose
 * partials are the same objects plans the same ranges; recording them lets it
 * skip the planning probes, and because every unit's inputs are then the same
 * objects, every merge unit cache-hits.
 */
export const MergeRangePlanType = StructType({
  /** The component's partial hashes, in partition order. */
  partials: ArrayType(StringType),
  /** The hashes of the component's range blobs — `Struct{from: Option<K>,
   *  to: Option<K>}` over the output's key type — in key order; one open
   *  range for a component that merges whole. */
  ranges: ArrayType(StringType),
});
export type MergeRangePlanType = typeof MergeRangePlanType;

export type MergeRangePlan = ValueTypeOf<typeof MergeRangePlanType>;

/**
 * The plan of a partitioned execution (issue #770): the partitioned inputs,
 * where each partition starts in every one of them, the carved slices, and
 * the ranged fan-in of each merged component.
 *
 * @remarks
 * Stored state: repositories hold plans an earlier e3 recorded beside its
 * executions, and the garbage collector reads them to keep the slices and
 * ranges they name.
 */
export const PartitionPlanType = StructType({
  /** Partitioned input hashes, wire order. */
  partitions: ArrayType(StringType),
  /** First segment index of each partition of the primary; boundaries[0] = 0. */
  boundaries: ArrayType(IntegerType),
  /** Per secondary (partitions[1..]): the split point of every partition plus the end; length boundaries.length + 1. */
  splits: ArrayType(ArrayType(SplitPointType)),
  /** slices[input][partition] object hashes; empty until carved. */
  slices: ArrayType(ArrayType(StringType)),
  /** The ranged fan-in of each merged component, once its ranges are
   *  planned. Appended LAST (BEAST2 encodes struct fields positionally) with
   *  a dual decoder — see {@link decodePartitionPlan}. */
  merges: ArrayType(MergeRangePlanType),
});
export type PartitionPlanType = typeof PartitionPlanType;

export type PartitionPlan = ValueTypeOf<typeof PartitionPlanType>;

/**
 * The pre-`merges` plan wire shape, kept only so {@link decodePartitionPlan}
 * can read plans a run recorded before the fan-in ran per key range.
 */
const PreMergesPartitionPlanType = StructType({
  partitions: ArrayType(StringType),
  boundaries: ArrayType(IntegerType),
  splits: ArrayType(ArrayType(SplitPointType)),
  slices: ArrayType(ArrayType(StringType)),
});

/** Encode a {@link PartitionPlanType} value for the object store. */
export const encodePartitionPlan: (value: PartitionPlan) => Uint8Array =
  encodeBeast2For(PartitionPlanType);

const decodeCurrentPlan = decodeBeast2For(PartitionPlanType);
const decodePreMergesPlan = decodeBeast2For(PreMergesPartitionPlanType);

/**
 * Decode a {@link PartitionPlanType} object, tolerating the pre-`merges`
 * wire shape (dual-decode migration): an older plan decodes with no recorded
 * merge ranges.
 *
 * @param data - the plan object's bytes
 * @returns the decoded plan
 */
export function decodePartitionPlan(data: Uint8Array): PartitionPlan {
  try {
    return decodeCurrentPlan(data);
  } catch (err) {
    try {
      return { ...decodePreMergesPlan(data), merges: [] };
    } catch {
      throw err; // no known shape — surface the current-format error
    }
  }
}
