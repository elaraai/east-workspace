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
  { kind: 'plain'; input: string; through: string[] };

/**
 * What stepTaskCommits answers: the version of each root the task reads —
 * for a record, the commit — or why it is deferred.
 */
export type TaskCommits =
  | { kind: 'commits'; versions: Map<string, string> }
  | { kind: 'deferred'; reason: DeferReason };

/**
 * What stepPrepareTask answers for a task that cannot run yet: an input of it
 * cannot be read — one nothing has set, a record whose first state is not yet
 * committed, or an index its record's state does not hold
 * (`dataflowResolveInputs`) — so the task is left waiting
 * (stepTasksWaiting) and the run goes on without it.
 */
export interface PrepareTaskWaiting {
  /** The task waits */
  kind: 'waiting';
  /** Task name */
  task: string;
  /** The task's inputs it cannot read, as keypaths, in the task's input
   *  order: unassigned, or an index its record's state does not hold */
  unassigned: string[];
}

/**
 * Result of stepTasksWaiting.
 */
export interface TasksWaitingResult {
  /** Each task left waiting, the one with an input it cannot read first and
   *  its dependents after it, with the inputs each waits on: a dependent waits
   *  on the outputs of the waiting tasks it reads */
  waiting: Array<{ task: string; inputs: string[] }>;
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
