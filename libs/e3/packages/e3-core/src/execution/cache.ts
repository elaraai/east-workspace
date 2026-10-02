/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The execution cache every runner serves a task or a unit from, and what an
 * execution is to every runner: the options it runs under, its identity, and
 * its result.
 *
 * The cache is the execution records a repository keeps. Its probe serves the
 * latest attempt when that attempt succeeded, and first rewrites a `running`
 * record whose execution can no longer finish as `interrupted`, with why.
 * Whether one can finish is the judgement of the runner that started it, which
 * the probe's caller passes: every backend's runner judges its own executions,
 * so a probe never judges a unit running on another host by what the host that
 * probes can see. The local runner's judgement, by processes on this machine,
 * is the local runner's own (`LocalTaskRunner.ts`).
 *
 * @packageDocumentation
 */

import { variant } from '@elaraai/east';
import type { ExecutionOwner, ExecutionStatus, PartitionProgress, StopReason } from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/interfaces.js';
import type { ExecutionLiveness, RunningExecution, UnitRequeue } from './interfaces.js';

/**
 * Options for task execution.
 *
 * @remarks
 * What a runner runs a task or a unit under, and what the engine takes for a
 * split task's stages. The local runner adds the option only it takes: the
 * process's budget (`LocalTaskRunner.ts`).
 */
export interface ExecuteOptions {
  /** Re-run even if cached (default: false) */
  force?: boolean;
  /** Pass `-v` to a stock runner's `exec`, so it prints where the time went
   *  and its peak memory to stderr. Runtime-only: it never affects the task
   *  hash or caching. */
  verbose?: boolean;
  /** Timeout in milliseconds (default: none) */
  timeout?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Stream stdout callback */
  onStdout?: (data: string) => void;
  /** Stream stderr callback */
  onStderr?: (data: string) => void;
  /** The memory, in bytes, the execution reserves from the budget while its
   *  runner runs: for a unit of a split task, the largest peak its stage has
   *  reached in the run. Absent, it reserves none. */
  expectedPeakBytes?: number;
  /** Called as each unit of a split task (a piece, or a merge of their
   *  outputs) starts, and as it succeeds. Runtime-only progress reporting. */
  onPartitionProgress?: (progress: PartitionProgress) => void;
  /** Called when the execution waits for room in the budget, with the memory
   *  in bytes it waits to reserve (0 when it waits for a core alone), and with
   *  `null` once it has room or stops waiting: again for each attempt that
   *  waits. Runtime-only. */
  onWaiting?: (needs: number | null) => void;
  /** Called when the guard, or the attempt's cgroup's cap, stopped a unit of
   *  a split task, which runs again under the same execution. Runtime-only. */
  onRequeued?: (requeue: UnitRequeue) => void;
  /** Variables every runner process of the execution gets in its environment,
   *  after this process's own: a unit's run and its output merge, and every
   *  unit of a split task. Runtime-only: never hashed and never logged. One
   *  that sets a variable e3 sets itself (`PATH`, `E3_RUNNER_SEARCH_DIRS`,
   *  `E3_FETCH_SEGMENTS`, which only a unit turns on) is refused. */
  extraEnv?: Readonly<Record<string, string>>;
  /**
   * Whether an execution the cache probe finds recorded `running` can still
   * finish, as the runner that started it judges it — its
   * `TaskRunner.executionAlive` — for the probe of the execution and, for a
   * split task, of each of its units. A backend whose executions run on other
   * hosts passes its own, so a probe here leaves one still running there as
   * it is. Absent, the probe judges as the local runner does: by the
   * execution's runner process and its recorded owner, on this host.
   * Runtime-only.
   */
  executionAlive?: ExecutionLiveness;
  /**
   * The owner the executions this call runs are recorded under: every
   * runner's, and a split task's own. This process when absent, which a probe
   * finds exited once it has; `null` records none, whose execution the local
   * judgement never repairs — what a host passes that runs an execution on
   * another's behalf and judges its liveness itself. Runtime-only.
   */
  owner?: ExecutionOwner | null;
}

/**
 * Result of task execution
 */
export interface ExecutionResult {
  /** Combined inputs hash (identifies this execution) */
  inputsHash: string;
  /** Execution ID (UUIDv7) */
  executionId: string;
  /** True if result was from cache */
  cached: boolean;
  /** Final state */
  state: 'success' | 'failed' | 'error';
  /** Output dataset hash (null on failure) */
  outputHash: string | null;
  /** Process exit code (null if not applicable) */
  exitCode: number | null;
  /** Execution time in ms (0 if cached) */
  duration: number;
  /** Error message on failure */
  error: string | null;
  /** True when e3 stopped the execution because the run was aborted: it is
   *  recorded `cancelled`, and is not the task's own failure */
  cancelled: boolean;
  /** The highest peak resident memory, in bytes, a runner process of the
   *  execution reached, as its execution records it: a unit's, the larger of
   *  its run's and its output merge's; a split task's, the largest of its
   *  units'. Absent when no runner reported one: a command body, or a runner
   *  that recorded no result. */
  peakBytes?: number;
}

/** The identity of one execution attempt: the execution-cache key it is
 *  recorded under, and its own ID and start. */
export interface ExecutionIds {
  /** Combined inputs hash. */
  inHash: string;
  /** Fresh execution ID (UUIDv7). */
  executionId: string;
  /** Wall-clock start of the attempt (epoch ms). */
  startTime: number;
}

/**
 * Probes the execution cache, which every runner serves a task or a unit from:
 * the latest attempt, when that attempt succeeded, with the peak its record
 * holds. A success followed by an attempt that failed or was cancelled is not
 * served, so the task runs again.
 *
 * @remarks
 * A latest record still `running` that cannot finish is first rewritten as
 * `interrupted`, so it no longer reads as live. Whether it can finish is the
 * judgement of the runner that started it, which `alive` gives: a backend whose
 * executions run on other hosts passes its own, and one still running there is
 * left as it is. The record says why it cannot: `owner_gone` when `alive`
 * answers `false`, or the reason it answers. Its log's last line says so too
 * (`e3: <message>`), flushed before the record is written.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param taskHash - Hash of the task object
 * @param inHash - Combined inputs hash
 * @param alive - Whether an execution recorded `running` can still finish, as
 *   the runner that started it judges it (`TaskRunner.executionAlive`)
 * @returns The cached result, or `null` when the latest attempt is not a
 *   `success`
 */
export async function probeExecutionCache(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  inHash: string,
  alive: ExecutionLiveness,
): Promise<ExecutionResult | null> {
  const status = await storage.refs.executionGetLatest(repo, taskHash, inHash);
  if (status?.type === 'running') {
    await repairInterruptedExecution(storage, repo, taskHash, inHash, status.value, alive);
    return null;
  }
  if (status?.type !== 'success') {
    return null;
  }
  return {
    inputsHash: inHash,
    executionId: status.value.executionId,
    cached: true,
    state: 'success',
    outputHash: status.value.outputHash,
    exitCode: 0,
    duration: 0,
    error: null,
    cancelled: false,
    ...(status.value.peakBytes.type === 'some' && { peakBytes: Number(status.value.peakBytes.value) }),
  };
}

/** Why an execution whose runner and owner are gone stopped, as its record
 *  and its log's last line say. */
const OWNER_GONE: StopReason = {
  kind: variant('owner_gone', null),
  message: 'interrupted: its runner and the process or browser tab that owned it are gone',
};

/**
 * Rewrites a `running` record as `interrupted` when its execution can no
 * longer finish, so nothing will ever write its outcome: when `alive`, the
 * judgement of the runner that started it, says so. The record names why —
 * `owner_gone` for `false`, or the reason `alive` gives — and so does the
 * log's last line, which is flushed before the record is written. A log that
 * cannot be appended to, or flushed, is warned of, and the record is written
 * all the same.
 */
async function repairInterruptedExecution(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  inHash: string,
  running: RunningExecution,
  alive: ExecutionLiveness,
): Promise<void> {
  const answer = await alive(storage, taskHash, inHash, running);
  let reason: StopReason;
  switch (answer) {
    case true: return;
    case false: reason = OWNER_GONE; break;
    default: reason = answer;
  }
  const { executionId } = running;
  try {
    await storage.logs.append(repo, taskHash, inHash, executionId, 'stderr', `e3: ${reason.message}\n`);
  } catch (err) {
    console.warn(`Failed to append stderr log: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    await storage.logs.flush(repo, taskHash, inHash, executionId);
  } catch (err) {
    console.warn(`Failed to flush the log: ${err instanceof Error ? err.message : String(err)}`);
  }
  const status: ExecutionStatus = variant('interrupted', {
    executionId,
    inputHashes: running.inputHashes,
    startedAt: running.startedAt,
    completedAt: new Date(),
    pid: running.pid,
    unit: running.unit,
    reason,
  });
  await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);
}
