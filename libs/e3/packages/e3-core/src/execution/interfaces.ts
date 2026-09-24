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
import type { JobSlots } from './jobs.js';

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
  /** The most units of a partitioned task in flight at once — its pool
   *  width. Defaults to the jobs budget's capacity, else 4. Runtime-only:
   *  never affects hashes or caching. */
  partitionConcurrency?: number;
  /** The local run's jobs budget (see {@link JobSlots}): every runner the
   *  local runner spawns holds one of its slots, the units of a partitioned
   *  task included. Runtime-only; a remote runner ignores it. */
  jobs?: JobSlots;
  /** Called as each unit of a partitioned task (slice execution or combine
   *  step) starts and completes. Runtime-only progress reporting. */
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
  /** Error message (if state is 'error') */
  error?: string;
  /** True when e3 stopped the task because the run was aborted (state
   *  'error', message `cancelled: …`) — not the task's own failure */
  cancelled?: boolean;
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
   * Run a body IR detached from the dataflow graph (function / one-shot
   * call): marshal the args, run on the spec's runner, return the result
   * inline. Writes nothing durable — no output object, no execution record,
   * no logs.
   *
   * @remarks
   * An arg is a value's beast2 bytes or a stream of them: a record's state is
   * passed as a stream of its segments. An implementation marshals a stream
   * however it moves its arguments — writing it out as it is read holds one
   * segment at a time, and sending it in one payload holds it whole.
   *
   * @param spec - Body IR, args, runner, and limits
   * @param options - Cancellation + runner search anchor
   */
  runDetached(spec: DetachedSpec, options?: DetachedRunOptions): Promise<DetachedResult>;
}
