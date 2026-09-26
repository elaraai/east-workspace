/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The task execution interface: what runs one task, however it runs it.
 *
 * The dataflow's orchestration lives in `dataflow/` (the step functions and
 * `LocalOrchestrator`); a `TaskRunner` is what those steps call to execute a
 * task — locally by spawning a runner, or remotely.
 */

import type { PartitionProgress } from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/interfaces.js';
import type { DetachedSpec, DetachedResult, DetachedRunOptions } from './runDetached.js';
import type { MergeParts } from './units.js';

// =============================================================================
// Task Execution
// =============================================================================

/**
 * Options for task execution.
 */
export interface TaskExecuteOptions {
  /** Force execution even if cached */
  force?: boolean;
  /** Pass `-v` to the runner (known runtimes only) so it prints timing/perf
   *  to stderr. Runtime-only: never affects the task hash or caching. */
  verbose?: boolean;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Callback for stdout data */
  onStdout?: (data: string) => void;
  /** Callback for stderr data */
  onStderr?: (data: string) => void;
  /** The memory, in bytes, the execution is expected to need: for a unit of a
   *  split task, the largest peak a unit of its stage has reached in the run.
   *  A local runner reserves it from its budget; a remote one may size the
   *  unit's function by it. Absent while nothing has been measured. */
  expectedPeakBytes?: number;
  /** Called as each unit of a split task (a piece, or a merge of their
   *  outputs) starts, and as it succeeds. Runtime-only progress reporting. */
  onPartitionProgress?: (progress: PartitionProgress) => void;
}

/**
 * Result of a single task execution.
 */
export interface TaskResult {
  /** Final state */
  state: 'success' | 'failed' | 'error';
  /** Whether the result was served from cache */
  cached: boolean;
  /** Execution ID (UUIDv7) */
  executionId?: string;
  /** Output hash (if state is 'success') */
  outputHash?: string;
  /** Exit code (if state is 'failed') */
  exitCode?: number;
  /** What went wrong, when state is 'failed' or 'error': a failed runner's
   *  exit and the tail of its stderr, or why e3 could not run it */
  error?: string;
  /** True when e3 stopped the task because the run was aborted (state
   *  'error', message `cancelled: …`) — not the task's own failure */
  cancelled?: boolean;
  /** The highest peak resident memory, in bytes, a runner process of the
   *  execution reached, as its execution records it — for a result served
   *  from the cache too. Absent when no runner reported one. */
  peakBytes?: number;
}

/**
 * One unit of a task split into pieces: a piece, which runs the task's program
 * over the piece's inputs, or a merge of what the pieces wrote.
 */
export interface SplitUnit {
  /** The unit's inputs as its execution records them — a piece's inputs, or a
   *  merge's `merge` tag, its range and its parts — which, with the task, are
   *  its identity in the execution cache. */
  readonly inputs: string[];
  /** What a merge unit merges, or `null` for a piece. */
  readonly merge: MergeParts | null;
}

/**
 * Task execution abstraction.
 *
 * Implementations:
 * - LocalTaskRunner: Spawns east-node/east-py/julia processes locally
 * - LambdaTaskRunner: Dispatches to AWS Lambda
 * - FargateTaskRunner: Dispatches to AWS Fargate
 */
export interface TaskRunner {
  /**
   * Execute a task.
   *
   * @param storage - Storage backend
   * @param taskHash - Hash of the TaskObject
   * @param inputHashes - Hashes of input datasets
   * @param options - Execution options
   * @returns Task result
   */
  execute(
    storage: StorageBackend,
    taskHash: string,
    inputHashes: string[],
    options?: TaskExecuteOptions
  ): Promise<TaskResult>;

  /**
   * Execute one unit of a task split into pieces, which the caller planned: a
   * piece, or a merge of what the pieces wrote. Served from the execution
   * cache when the unit ran before, unless forced.
   *
   * @remarks
   * The unit's execution is recorded under the task and the unit's inputs, as
   * a task's is under its own. The dataflow runs a split task's units through
   * this, beside every other task's.
   *
   * @param storage - Storage backend
   * @param taskHash - Hash of the TaskObject
   * @param unit - The unit
   * @param options - Execution options
   * @returns The unit's result
   */
  executeUnit(
    storage: StorageBackend,
    taskHash: string,
    unit: SplitUnit,
    options?: TaskExecuteOptions
  ): Promise<TaskResult>;

  /**
   * Run a body IR detached from the dataflow graph (function / one-shot
   * call): marshal the args, run on the spec's runner, return the result
   * inline. Writes nothing durable — no output object, no execution record,
   * no logs.
   *
   * @param spec - Body IR, args, runner, and limits
   * @param options - Cancellation + runner search anchor
   */
  runDetached(spec: DetachedSpec, options?: DetachedRunOptions): Promise<DetachedResult>;
}
