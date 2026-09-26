/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Runner wire types for e3 tasks, functions and records.
 *
 * `RunnerType` is the wire image of the SDK's `Runner` union. A known-runtime
 * tag pins the executable to one of the stock runners, which runs units through
 * its `exec` command; `custom` names a command of the author's own.
 */

import { VariantType, StructType, ArrayType, StringType, ValueTypeOf } from '@elaraai/east';

/**
 * Wire representation of a runner — shared by tasks, functions and records.
 *
 * A known-runtime tag names a stock runner, and `platforms` names the platform
 * packages the units it runs load. `custom` carries a command, which e3 runs
 * with the arguments of a stock runner's `run`: `-i` for each input, `-o` for
 * the output, then the program's file. A custom task's body is its own
 * command, and its runner's is empty. Package authors can already execute
 * arbitrary commands via custom tasks, so `custom` grants no capability that
 * tasks don't have.
 */
export const RunnerType = VariantType({
  east_node: StructType({ platforms: ArrayType(StringType) }),
  east_py:   StructType({ platforms: ArrayType(StringType) }),
  east_c:    StructType({ platforms: ArrayType(StringType) }),
  custom:    StructType({ command: ArrayType(StringType) }),
});
export type RunnerType = typeof RunnerType;

export type RunnerValue = ValueTypeOf<typeof RunnerType>;

/**
 * Insert the runner's `--exit-with-parent` flag into a fully-built argv, for
 * the known runtimes only — the stdin lifeline (issue #770).
 *
 * A stock runner given the flag and a stdin pipe its parent never writes to
 * exits as soon as the pipe reaches end of file: when the parent dies. A
 * `custom` runner's argv is user-authored, so the flag is never spliced into
 * it, and it keeps an ignored stdin. The flag goes at index 2, after
 * `[<bin>, <command>]`, and is a pure runtime toggle applied just before
 * spawn — never part of the task object or any hash.
 *
 * @param runner - the runner the argv was built for (gates the injection)
 * @param args - the fully-built argv
 * @returns the argv, with `--exit-with-parent` inserted for known runtimes
 */
export function withRunnerLifeline(runner: RunnerValue, args: string[]): string[] {
  if (runner.type === 'custom' || args.length < 2) return args;
  return [...args.slice(0, 2), '--exit-with-parent', ...args.slice(2)];
}
