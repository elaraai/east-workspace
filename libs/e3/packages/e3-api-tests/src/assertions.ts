/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Diagnostic assertions for dataflow execution results.
 *
 * A bare `assert.strictEqual(result.success, true)` collapses a rich
 * failure — a task that exited non-zero, a runner that failed to spawn,
 * a skipped input — into `false !== true`, which is useless when a test
 * flakes in CI (notably the Windows runner, where subprocess spawn and
 * `.ref` rename-over-open can transiently fail). These helpers fold the
 * per-task diagnostics already carried in `result.tasks` into the
 * assertion message so the next failure is actionable instead of opaque.
 */

import assert from 'node:assert/strict';

/** A single task entry in a dataflow result (subset we read for diagnostics). */
interface TaskResultLike {
  name: string;
  cached: boolean;
  state: { type: string; value?: unknown };
  duration?: number;
}

/** The dataflow execute/start result shape we assert against. */
interface DataflowResultLike {
  success: boolean;
  executed: bigint;
  cached: bigint;
  failed: bigint;
  skipped: bigint;
  tasks: TaskResultLike[];
}

/** Render one task's terminal state, surfacing exit code / error message. */
function describeTask(task: TaskResultLike): string {
  const { type, value } = task.state;
  let detail = type;
  if (type === 'failed' && value && typeof value === 'object' && 'exitCode' in value) {
    detail = `failed (exitCode ${String((value as { exitCode: unknown }).exitCode)})`;
  } else if (type === 'error' && value && typeof value === 'object' && 'message' in value) {
    detail = `error: ${String((value as { message: unknown }).message)}`;
  }
  return `  - ${task.name}${task.cached ? ' [cached]' : ''}: ${detail}`;
}

/** Build a human-readable summary of a dataflow result for failure messages. */
export function describeDataflowResult(result: DataflowResultLike): string {
  const counts =
    `executed=${result.executed} cached=${result.cached} ` +
    `failed=${result.failed} skipped=${result.skipped}`;
  const lines = result.tasks.map(describeTask);
  return lines.length > 0 ? `${counts}\ntasks:\n${lines.join('\n')}` : counts;
}

/**
 * Assert that a dataflow execution succeeded, surfacing every task's
 * terminal state (exit codes, runner error messages) when it did not.
 *
 * @param result - Result from dataflowExecute / dataflowStart polling.
 * @param context - Optional prefix to identify which execution failed
 *   (e.g. "after input change").
 */
export function assertDataflowSucceeded(result: DataflowResultLike, context?: string): void {
  const prefix = context ? `${context}: ` : '';
  assert.strictEqual(
    result.success,
    true,
    `${prefix}expected dataflow to succeed but it failed.\n${describeDataflowResult(result)}`
  );
}
