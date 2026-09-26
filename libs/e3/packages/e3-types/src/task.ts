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

import { StructType, StringType, ArrayType, NullType, OptionType, VariantType, ValueTypeOf, decodeBeast2For } from '@elaraai/east';
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
