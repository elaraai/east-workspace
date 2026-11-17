/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The repository upgrade that carries stored dataflow runs into the form in
 * which a run forces none of its tasks, all of them, or the ones it names: the
 * run state's `force` became a variant, where it was a Boolean.
 *
 * A stored state's beast2 header names the whole state type, and a decode
 * refuses a header whose type differs, so every run an earlier release stored
 * is rewritten: one that forced its tasks forces `all` of them, and one that
 * did not, `none`.
 *
 * Both forms are frozen copies, which nothing but this upgrade reads: the step
 * reads what the releases before it wrote and writes what it shipped, however
 * the state changes after.
 *
 * @packageDocumentation
 */

import {
  ArrayType, BooleanType, DateTimeType, DictType, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
  encodeBeast2For, toEastTypeValue, variant, type EastType, type ValueTypeOf,
} from '@elaraai/east';
import type { RepositoryUpgrade } from '../storage/interfaces.js';
import { isStoredForm, storedFormReader } from './forms.js';
import { workStoredRunsInParts } from './parts.js';

/** A task's state in a run, as both forms hold it. */
const FrozenTaskStateType = StructType({
  name: StringType,
  status: StringType,
  cached: OptionType(BooleanType),
  outputHash: OptionType(StringType),
  error: OptionType(StringType),
  exitCode: OptionType(IntegerType),
  startedAt: OptionType(DateTimeType),
  completedAt: OptionType(DateTimeType),
  duration: OptionType(IntegerType),
  plan: OptionType(StringType),
  execution: OptionType(StructType({ inputsHash: StringType, executionId: StringType })),
});

/** A run's graph, as both forms hold it. */
const FrozenGraphType = StructType({
  tasks: ArrayType(StructType({
    name: StringType,
    hash: StringType,
    inputs: ArrayType(StringType),
    output: StringType,
    dependsOn: ArrayType(StringType),
  })),
});

/** A unit of a split task, as both forms' events name it. */
const FrozenStageUnitType = StructType({
  merge: OptionType(StructType({ level: IntegerType, levels: IntegerType })),
  index: IntegerType,
  units: IntegerType,
});

/** A run's events, as both forms hold them. */
const FrozenEventType = VariantType({
  execution_started: StructType({ seq: IntegerType, timestamp: DateTimeType, executionId: StringType, totalTasks: IntegerType }),
  task_ready: StructType({ seq: IntegerType, timestamp: DateTimeType, task: StringType }),
  task_started: StructType({ seq: IntegerType, timestamp: DateTimeType, task: StringType }),
  task_completed: StructType({
    seq: IntegerType, timestamp: DateTimeType, task: StringType, cached: BooleanType, outputHash: StringType, duration: IntegerType,
    peakBytes: OptionType(IntegerType),
  }),
  task_failed: StructType({
    seq: IntegerType, timestamp: DateTimeType, task: StringType, error: OptionType(StringType), exitCode: OptionType(IntegerType),
    duration: IntegerType,
  }),
  task_skipped: StructType({ seq: IntegerType, timestamp: DateTimeType, task: StringType, cause: StringType }),
  execution_completed: StructType({
    seq: IntegerType, timestamp: DateTimeType, success: BooleanType, executed: IntegerType, cached: IntegerType, failed: IntegerType,
    skipped: IntegerType, duration: IntegerType,
  }),
  execution_cancelled: StructType({ seq: IntegerType, timestamp: DateTimeType, reason: OptionType(StringType) }),
  input_changed: StructType({ seq: IntegerType, timestamp: DateTimeType, path: StringType, previousHash: StringType, newHash: StringType }),
  task_invalidated: StructType({ seq: IntegerType, timestamp: DateTimeType, task: StringType, reason: StringType }),
  task_deferred: StructType({ seq: IntegerType, timestamp: DateTimeType, task: StringType, conflictPath: StringType }),
  task_split: StructType({ seq: IntegerType, timestamp: DateTimeType, task: StringType, pieces: IntegerType }),
  task_merge_started: StructType({
    seq: IntegerType, timestamp: DateTimeType, task: StringType, level: IntegerType, levels: IntegerType, units: IntegerType,
  }),
  task_merge_completed: StructType({ seq: IntegerType, timestamp: DateTimeType, task: StringType, level: IntegerType, levels: IntegerType }),
  unit_requeued: StructType({
    seq: IntegerType, timestamp: DateTimeType, task: StringType, unit: FrozenStageUnitType,
    reason: VariantType({ budget: NullType, machine: NullType, cap: NullType }), peak: IntegerType, reserves: IntegerType,
  }),
});

/** A run's stored state, with what it forced in the form given. */
function stateType<F extends EastType>(force: F) {
  return StructType({
    release: StringType,
    id: StringType,
    repo: StringType,
    workspace: StringType,
    startedAt: DateTimeType,
    force,
    filter: OptionType(StringType),
    graph: OptionType(FrozenGraphType),
    graphHash: OptionType(StringType),
    tasks: DictType(StringType, FrozenTaskStateType),
    executed: IntegerType,
    cached: IntegerType,
    failed: IntegerType,
    skipped: IntegerType,
    status: StringType,
    completedAt: OptionType(DateTimeType),
    error: OptionType(StringType),
    versionVectors: DictType(StringType, DictType(StringType, StringType)),
    inputSnapshot: DictType(StringType, StringType),
    taskOutputPaths: ArrayType(StringType),
    reexecuted: IntegerType,
    events: ArrayType(FrozenEventType),
    eventSeq: IntegerType,
  });
}

/**
 * A run's stored state as the releases before this upgrade wrote it, frozen:
 * whether it forced every task.
 *
 * @internal
 */
export const DataflowStateBeforeForceTasksType = stateType(BooleanType);

/**
 * A run's stored state as this upgrade writes it, frozen: it forces none of
 * its tasks, all of them, or the ones it names.
 *
 * @internal
 */
export const DataflowStateWithForceTasksType = stateType(VariantType({
  none: NullType,
  all: NullType,
  tasks: ArrayType(StringType),
}));

/** A stored run in the form before this upgrade. */
type StateBeforeForceTasks = ValueTypeOf<typeof DataflowStateBeforeForceTasksType>;
/** A stored run in the form this upgrade writes. */
type StateWithForceTasks = ValueTypeOf<typeof DataflowStateWithForceTasksType>;

const WITH_TYPE = toEastTypeValue(DataflowStateWithForceTasksType);
const encodeWith = encodeBeast2For(DataflowStateWithForceTasksType);

/** The name a repository's record keeps once the upgrade is applied. */
export const DATAFLOW_FORCE_TASKS = 'dataflow-force-tasks';

/** A stored run in the form before this upgrade, or null for bytes of any
 *  other form, or that do not decode. */
const beforeForceTasks = storedFormReader(DataflowStateBeforeForceTasksType);

/** What a run of the form before this upgrade forced, as this upgrade writes
 *  it: every task, or none. */
function forceOf(all: boolean): StateWithForceTasks['force'] {
  return all ? variant('all', null) : variant('none', null);
}

/** A run of the form before this upgrade, in the form it writes. */
function withForceTasks(state: StateBeforeForceTasks): StateWithForceTasks {
  return { ...state, force: forceOf(state.force) };
}

/**
 * Rewrites every dataflow run a repository stores in the form in which a run
 * forces none of its tasks, all of them, or the ones it names: one an earlier
 * release stored that forced its tasks forces `all`, and one that did not,
 * `none`.
 *
 * @remarks
 * Every run is read as it is stored, a workspace at a time
 * ({@link workStoredRunsInParts}), and written back through the stored run's
 * own `replace`. A run already in the form this upgrade writes is left as it
 * is; and so is one in neither form, which a crash or a failing disk left, and
 * which a read refuses as it did before.
 */
export const dataflowForceTasks: RepositoryUpgrade = {
  name: DATAFLOW_FORCE_TASKS,
  apply: (storage, repo, at, until) => workStoredRunsInParts(storage, repo, at, until, async (stored) => {
    if (isStoredForm(stored.bytes, WITH_TYPE)) return;
    const earlier = beforeForceTasks(stored.bytes);
    if (earlier !== null) await stored.replace(encodeWith(withForceTasks(earlier)));
  }),
};
