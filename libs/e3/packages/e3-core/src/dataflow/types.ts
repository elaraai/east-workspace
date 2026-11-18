/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Resumable dataflow execution types.
 *
 * These types support both local and cloud execution by separating
 * execution state from orchestration. The state can be persisted to
 * a file (local) or DynamoDB (cloud) and resumed after interruption.
 *
 * Types are derived from EastType definitions in @elaraai/e3-types using
 * ValueTypeOf for proper branded variant/option support.
 */

import { type ValueTypeOf } from '@elaraai/east';
import {
  TaskStateType,
  DataflowGraphTaskType,
  DataflowGraphType,
  ExecutionEventType,
  DataflowExecutionStateType,
  ExecutionStateSummaryType,
} from '@elaraai/e3-types';

// Re-export EastType schemas for serialization
export {
  TaskStateType,
  DataflowGraphTaskType,
  DataflowGraphType,
  ExecutionEventType,
  DataflowExecutionStateType,
  ExecutionStateSummaryType,
  executionStateSummary,
} from '@elaraai/e3-types';

// Re-export status type aliases
export type { DataflowExecutionStatus, TaskStatus } from '@elaraai/e3-types';

// =============================================================================
// Types derived from EastTypes via ValueTypeOf
// =============================================================================

/**
 * Task state information.
 */
export type TaskState = ValueTypeOf<typeof TaskStateType>;

/**
 * Task in the dataflow graph.
 */
export type DataflowGraphTask = ValueTypeOf<typeof DataflowGraphTaskType>;

/**
 * Dataflow dependency graph.
 */
export type DataflowGraph = ValueTypeOf<typeof DataflowGraphType>;

/**
 * Execution event (discriminated union via VariantType).
 */
export type ExecutionEvent = ValueTypeOf<typeof ExecutionEventType>;

/**
 * Dataflow execution state.
 */
export type DataflowExecutionState = ValueTypeOf<typeof DataflowExecutionStateType>;

/**
 * A run's state but its graph, tasks, reactive tracking and events: what a
 * poll of the run serves but the events, with its last event's sequence
 * number.
 */
export type ExecutionStateSummary = ValueTypeOf<typeof ExecutionStateSummaryType>;

// =============================================================================
// Step Results (TypeScript-only, not persisted)
// =============================================================================

/**
 * Result of stepInitialize.
 */
export interface InitializeResult {
  /** The initialized execution state */
  state: DataflowExecutionState;
  /** Tasks that are immediately ready (no dependencies) */
  readyTasks: string[];
}

/**
 * Result of stepPrepareTask - information needed to execute a task.
 */
export interface PrepareTaskResult {
  /** The task is prepared: every input can be read */
  kind: 'prepared';
  /** Task name */
  task: string;
  /** Task object hash */
  taskHash: string;
  /** Input dataset hashes (in order) */
  inputHashes: string[];
  /** Output path string */
  outputPath: string;
  /** The execution the cache serves the task from — its output and its id —
   *  or `null` when the task must run */
  cached: { outputHash: string; executionId: string } | null;
}

/**
 * A catch-up run: a task run once over the inputs it had at earlier versions
 * of the run's records, for a task that reads its result there
 * (`dataflowResolveInputs`).
 *
 * @remarks
 * A task that reads several results reads them all as of one commit of each
 * record, the oldest its inputs came from. A result made from a newer commit
 * is read at the older one from the execution cache, and where the cache has
 * none the task that made it runs there once. The run applies it to no task's
 * state and writes no ref for it: its execution is recorded, and nothing else.
 */
export interface CatchUpRun {
  /** The task run, by name */
  task: string;
  /** Its task object's hash */
  taskHash: string;
  /** Its inputs' objects at the versions, in the task's input order */
  inputHashes: string[];
  /** The hash of those inputs, which with the task is the run's identity in
   *  the execution cache */
  inputsHash: string;
  /** The versions it runs at: each root it reads, at the version the task
   *  that waits for it reads */
  versions: Map<string, string>;
}

/**
 * What stepPrepareTask answers for a task whose inputs are not all at hand at
 * the versions it reads: the catch-up runs that make them, those whose own
 * inputs are at hand, the deepest first. Once they have settled the task is
 * prepared again at the same versions.
 */
export interface PrepareTaskBehind {
  /** The task waits for catch-up runs */
  kind: 'behind';
  /** Task name */
  task: string;
  /** The runs to make, or to wait for where one is in flight already */
  runs: CatchUpRun[];
}

/**
 * Why a task is deferred: nothing says which version of an input it reads.
 *
 * @remarks
 * A task never waits for results made from different commits of a record: it
 * reads them all as of the oldest. A plain input keeps no earlier value to
 * read, so a task whose inputs read one at different values waits until they
 * agree.
 */
export type DeferReason =
  /** A plain input the task's inputs read at different values: `through`
   *  names those inputs, each a task by its name, or the input's own keypath
   *  where the task reads it directly, which comes first */
  | { kind: 'plain'; input: string; through: string[] }
  /** A fed record, by its keypath, whose delivery from `source` a rollback, a
   *  restore or a migration made it forget, so nothing says which versions of
   *  the roots its feed reads it holds: `roots` names those another input of
   *  the task names */
  | { kind: 'forgotten'; record: string; source: string; roots: string[] }
  /** Two fed sources holding deliveries made from different versions of one
   *  root: each by its record's keypath (`records`) and its name (`sources`),
   *  in the same order. They are two records' sources, or two sources of one
   *  record that the task reads beside the root */
  | { kind: 'carried'; records: [string, string]; sources: [string, string]; root: string }
  /** A fed record, by its keypath, read beside the plain input that feeds its
   *  source, which has moved on from the value its delivery was made from */
  | { kind: 'feed'; record: string; source: string; input: string };

/**
 * What stepTaskCommits answers: the version of each root the task reads —
 * for a record, the commit — or why it is deferred; or, where only a load's
 * commit would end the deferral and that load cannot commit in the run, the
 * load it waits on.
 */
export type TaskCommits =
  | { kind: 'commits'; versions: Map<string, string> }
  | { kind: 'deferred'; reason: DeferReason }
  /** The task waits on a record's load (`upstream`), as a reader of a load
   *  that cannot run does: it is left waiting (stepTasksWaiting) */
  | { kind: 'waiting'; waits: InputWait[] };

/**
 * An input a task waits on, by its keypath, and why the task cannot read it
 * now.
 *
 * @remarks
 * A task waits on an input it cannot read, and the run goes on without it.
 * Nothing stores the reason: it is told to the run's caller as the task is
 * left waiting (`onTaskWaiting`), and a workspace's status works it out again.
 */
export type InputWait =
  /** The input has no value — nothing has set it, the task that writes it has
   *  not run, or a record's first state is not yet committed — or it is an
   *  index its record's state does not hold */
  | { input: string; kind: 'unset' }
  /** The input is a composite record, or an index of one, that has yet to
   *  hear from these external sources: it holds the solution's own entries
   *  alone until each has delivered once */
  | { input: string; kind: 'pending'; sources: string[] }
  /** The input feeds a load, and holds the value the deployed package gave
   *  it: a load waits until someone sets it */
  | { input: string; kind: 'package' }
  /** The input is a composite record whose load node `task` waits: its
   *  readers wait with it. So does a reader that only that load's commit
   *  would decide, where the load cannot commit in the run: it failed, or
   *  the run's filter leaves it out */
  | { input: string; kind: 'upstream'; task: string };

/**
 * What stepPrepareTask answers for a task that cannot run yet: an input of it
 * cannot be read — one nothing has set, a record whose first state is not yet
 * committed, an index its record's state does not hold, or a composite record
 * that waits for an external source's first delivery
 * (`dataflowResolveInputs`) — so the task is left waiting
 * (stepTasksWaiting) and the run goes on without it.
 */
export interface PrepareTaskWaiting {
  /** The task waits */
  kind: 'waiting';
  /** Task name */
  task: string;
  /** The task's inputs it cannot read, in the task's input order, each with
   *  why */
  waits: InputWait[];
}

/**
 * What stepPrepareLoad answers for a load node that runs: its inputs — the
 * delivery its feed holds, and its source's run of the record's head — the
 * execution the cache serves, and what its commit needs.
 */
export interface PrepareLoadResult extends PrepareTaskResult {
  /** What the node's commit applies, and to what */
  load: {
    /** The record, as its ref is read and its commit names it */
    record: { refPath: string; selfKeypath: string };
    /** The source the node loads */
    source: string;
    /** The hash of the source's load object, which its `.load` slot names */
    loadHash: string;
    /** The record's head when the source's run was read: what the delta
     *  holds on; undefined for a record whose ref names none */
    base: string | undefined;
    /** The delivery: the object the feed holds at the node's versions */
    delivery: string;
    /** The source's run of the record at `base` */
    run: string;
    /** The execution the record's `.execution` slot names, when its slots
     *  name this delivery under this load already; null otherwise. A forced
     *  node commits only a delta that changes something, and completes with
     *  this execution when its delta changes nothing, as the record holds it */
    loadedBy: { inputsHash: string; executionId: string } | null;
  };
}

/**
 * What stepPrepareLoad answers for a load node whose record holds its feed's
 * delivery already, under the same load: it completes at once, served from
 * the record's slots, and nothing commits.
 */
export interface PrepareLoadAnswered {
  /** The record's slots answer the node */
  kind: 'answered';
  /** Node name, `<record>.<source>` */
  task: string;
  /** The record's head commit: the node's output */
  commit: string;
  /** The execution the record's `.execution` slot names, which made the
   *  delta its last load committed */
  execution: { inputsHash: string; executionId: string };
}

/**
 * Result of stepTasksWaiting.
 */
export interface TasksWaitingResult {
  /** Each task left waiting, the one with an input it cannot read first and
   *  its dependents after it, with what each waits on: a dependent waits on
   *  the outputs of the waiting tasks it reads, which are unset */
  waiting: Array<{ task: string; waits: InputWait[] }>;
}

/**
 * Result of a task execution (returned by TaskRunner).
 */
export interface TaskExecuteResult {
  /** Final state */
  state: 'success' | 'failed' | 'error';
  /** Whether the result was served from cache */
  cached: boolean;
  /** Output hash (if state is 'success') */
  outputHash?: string;
  /** Exit code (if state is 'failed') */
  exitCode?: number;
  /** Error message (if state is 'error') */
  error?: string;
}

/**
 * Result of stepTaskCompleted.
 */
export interface TaskCompletedResult {
  /** Tasks that became ready after this completion */
  newlyReady: string[];
}

/**
 * Result of stepTaskFailed.
 */
export interface TaskFailedResult {
  /** Tasks that should be skipped due to this failure */
  toSkip: string[];
}

/**
 * Result of stepFinalize.
 */
export interface FinalizeResult {
  /** Overall success - true if all tasks completed successfully */
  success: boolean;
  /** Dataflow run ID (UUIDv7) */
  runId: string;
  /** Number of tasks executed (not from cache) */
  executed: number;
  /** Number of tasks served from cache */
  cached: number;
  /** Number of tasks that failed */
  failed: number;
  /** Number of tasks skipped due to upstream failure */
  skipped: number;
  /** Number of tasks left waiting on an input they cannot read — an
   *  unassigned one, or an index its record's state does not hold — and of
   *  their dependents, which the run went on without: they run once it can be
   *  read */
  waiting: number;
  /** Number of tasks re-executed due to input changes */
  reexecuted: number;
  /** Total duration in milliseconds */
  duration: number;
  /**
   * True if the execution yielded (checkpointed) rather than completed.
   * The persisted state remains 'running' and can be continued with
   * orchestrator.resume(). When set, `success` is false and the counters
   * reflect progress so far.
   */
  yielded?: boolean;
}

/**
 * Result of stepApplyTreeUpdate.
 */
export interface TreeUpdateResult {
  /** Placeholder — per-dataset ref writes don't produce a root hash */
  ok: true;
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Type helper for mutable state (removes readonly).
 * Used by step functions and the orchestrator to mutate execution state.
 */
export type Mutable<T> = { -readonly [P in keyof T]: T[P] extends object ? Mutable<T[P]> : T[P] };
