/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A kept function call, as a repository's call store keeps it
 * (east-workspace#1554).
 *
 * A call of a named function through a workspace is filed when it starts,
 * runs where its backend runs calls, and is kept once it ends, until the
 * lifetime its end gives it; so is a one-shot started as a call, its caller's
 * program run as an anonymous function. The store keeps what readers are
 * shown, the call as the API answers it ({@link FunctionCallType}). Beside it,
 * it keeps what the call's run needs and no reader is shown: the function
 * object it runs, the runner it runs on, whether it runs verbose, its
 * deadline, and a request to cancel it.
 *
 * It is stored state (`WIRE_MIGRATION.md`): a change to its type ships a
 * repository upgrade step.
 */

import {
  BooleanType, DateTimeType, IntegerType, OptionType, StringType, StructType, decodeBeast2For, encodeBeast2For, type ValueTypeOf,
} from '@elaraai/east';
import { FunctionCallType } from './api.js';
import { RunnerType } from './runner.js';

/**
 * A request to cancel a running call: who asked, and when.
 *
 * @property by - Who asked, as the host's auth names them; `none` without an
 *   identity
 * @property at - When they asked
 */
export const FunctionCallCancelType = StructType({
  by: OptionType(StringType),
  at: DateTimeType,
});
export type FunctionCallCancelType = typeof FunctionCallCancelType;

/** A request to cancel a running call. */
export type FunctionCallCancel = ValueTypeOf<typeof FunctionCallCancelType>;

/**
 * How long a call is kept once it ends, by how it ended, in milliseconds: the
 * lifetimes the host that filed it gives, which whatever records its end
 * applies.
 *
 * @property succeeded - A call that succeeded, or was cancelled
 * @property failed - A call that failed, was refused (`invalid`), returned too
 *   large a value, timed out, or was lost
 */
export const FunctionCallKeepType = StructType({
  succeeded: IntegerType,
  failed:    IntegerType,
});
export type FunctionCallKeepType = typeof FunctionCallKeepType;

/** How long a call is kept once it ends. */
export type FunctionCallKeep = ValueTypeOf<typeof FunctionCallKeepType>;

/**
 * A kept call, as its store keeps it.
 *
 * @property call - The call as readers are shown it
 * @property workspace - The workspace it was called through
 * @property functionObject - The hash of the function object it runs: the one
 *   the deployed package named when it started, whatever is deployed since;
 *   for a one-shot call, the anonymous one its start stored, naming the
 *   caller's program, its types and its runner, and no inputs
 * @property runner - The runner it runs on: the function's own, or one the
 *   call named and its caller's grant allowed; a one-shot call's own
 * @property verbose - Whether a stock runner runs it with `-v`
 * @property deadline - When its timeout ends: a call still recorded running
 *   once its deadline and a grace have passed is lost
 * @property cancel - A request to cancel it, once one is made
 * @property keep - How long it is kept once it ends, by how it ended
 */
export const FunctionCallJobType = StructType({
  call:           FunctionCallType,
  workspace:      StringType,
  functionObject: StringType,
  runner:         RunnerType,
  verbose:        BooleanType,
  deadline:       DateTimeType,
  cancel:         OptionType(FunctionCallCancelType),
  keep:           FunctionCallKeepType,
});
export type FunctionCallJobType = typeof FunctionCallJobType;

/** A kept call, as its store keeps it. */
export type FunctionCallJob = ValueTypeOf<typeof FunctionCallJobType>;

const encodeJob = encodeBeast2For(FunctionCallJobType);
const decodeJob = decodeBeast2For(FunctionCallJobType);

/**
 * Encode a kept call as its store keeps it, in beast2.
 *
 * @param job - The call
 * @returns Its bytes
 */
export function encodeFunctionCallJob(job: FunctionCallJob): Uint8Array {
  return encodeJob(job);
}

/**
 * Decode a kept call from its store's bytes.
 *
 * @param bytes - The call's bytes, as {@link encodeFunctionCallJob} wrote them
 * @returns The call
 * @throws {Error} When the bytes are not a kept call of this release's form
 */
export function decodeFunctionCallJob(bytes: Uint8Array): FunctionCallJob {
  return decodeJob(bytes);
}

/**
 * What a kept call names, which gc keeps while the call is kept: the function
 * object it runs, and with it the program the object names; each value
 * argument's object; the version of each dataset argument and each input it
 * read; and its value once it succeeded. A one-shot call's function object is
 * its own, which no package names, so the call alone keeps it, and its
 * program, for as long as it runs and is kept.
 *
 * @param job - The call
 * @returns The hashes it names: its function object's, then its arguments' in
 *   order, then its inputs', then its value's
 */
export function functionCallRoots(job: FunctionCallJob): string[] {
  const { call } = job;
  const roots = [job.functionObject, ...call.args.map((arg) => (arg.type === 'value' ? arg.value : arg.value.hash))];
  for (const input of call.inputs) roots.push(input.hash);
  if (call.state.type === 'succeeded') roots.push(call.state.value.value);
  return roots;
}
