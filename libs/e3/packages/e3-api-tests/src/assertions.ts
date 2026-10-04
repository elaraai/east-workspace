/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Assertions the suites share: of a dataflow's result, and of the API's
 * refusal of a name no workspace can have.
 *
 * A bare `assert.strictEqual(result.success, true)` collapses a rich
 * failure — a task that exited non-zero, a runner that failed to spawn,
 * a skipped input — into `false !== true`, which is useless when a test
 * flakes in CI (notably the Windows runner, where subprocess spawn and
 * `.ref` rename-over-open can transiently fail). These helpers fold the
 * per-task diagnostics already carried in `result.tasks` into the
 * assertion message so the next failure is actionable instead of opaque.
 *
 * Every route of a workspace refuses a name no workspace can have before it
 * takes a lock, as `invalid_name` of a workspace: a lock's name may hold the
 * `#` and `~` that join its parts, so a route that took a lock first would
 * refuse such a name as a lock's, if at all.
 */

import assert from 'node:assert/strict';

import { equalFor, isValueOf, printFor, type ValueTypeOf } from '@elaraai/east';
import { InvalidNameErrorType } from '@elaraai/e3-types';
import { ApiError } from '@elaraai/e3-api-client';

/** Why no workspace's name may hold `c`: it joins the parts of a lock's name. */
const joinsLockNames = (c: string) => `holds ${JSON.stringify(c)}, which joins the parts of a lock's name`;

/**
 * Names no workspace can have, each with why, as a refusal says it: a lock's
 * name (`main#dataflow`, the lock a run of main's dataflow holds), the
 * characters that join a lock's parts, and one a file name cannot hold.
 */
export const MALFORMED_WORKSPACE_NAMES = [
  ['main#dataflow', joinsLockNames('#')],
  ['a#b', joinsLockNames('#')],
  ['a~b', joinsLockNames('~')],
  ['bad:name', `holds ":", which a file name cannot`],
] as const;

/**
 * Checks an error is the API's refusal of `name` as no workspace's:
 * `invalid_name`, whose details name the kind, the name and why.
 *
 * @param name - The name refused
 * @param why - Why, as the refusal's message ends
 * @returns An `assert.rejects` validator
 */
export function refusedAsWorkspaceName(name: string, why: string): (err: unknown) => true {
  return (err) => {
    assert.ok(err instanceof ApiError, `${name}: expected ApiError, got ${err}`);
    assert.strictEqual(err.code, 'invalid_name');
    assert.ok(isValueOf(err.details, InvalidNameErrorType), `${name}: the refusal names the name and why`);
    const said = err.details as ValueTypeOf<typeof InvalidNameErrorType>;
    const expected: ValueTypeOf<typeof InvalidNameErrorType> = {
      kind: 'workspace', name, message: `the workspace name ${JSON.stringify(name)} ${why}`,
    };
    assert.ok(equalFor(InvalidNameErrorType)(said, expected), `${name}: refused as ${printFor(InvalidNameErrorType)(said)}`);
    return true;
  };
}

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
