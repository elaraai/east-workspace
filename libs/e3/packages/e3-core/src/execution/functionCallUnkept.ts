/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A call of a named function through a workspace that no store keeps: run
 * within the process that makes it, and answered as its result.
 *
 * What a call of a local repository is (`e3 call -w`). Nothing is filed, so
 * nothing lists the call, polls it or cancels it, and nothing roots what it
 * read once it has answered. A call a server takes through a workspace is kept
 * instead (`functionCall.ts`), and the two read and end alike: the function's
 * inputs and its dataset arguments pinned at the hash each holds as the call
 * starts, its drafts laid over the records it reads (`functionDrafts.ts`,
 * east-workspace#1619), and each end a draft gives it.
 *
 * @packageDocumentation
 */

import { variant } from '@elaraai/east';
import type { CallArg, ExecuteResult, FunctionCallRequest, FunctionObject, PackageObject } from '@elaraai/e3-types';
import { withRunningWork } from '../running-work.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { callDraftsEnd, callDraftsRead, draftedInputs, layCallDrafts, pinCallDrafts, type CallDraftsEnd } from './functionDrafts.js';
import type { DetachedArg, TaskRunner } from './interfaces.js';
import { detachedToExecuteResult, invalidExecuteResult, pinCallArguments } from './oneShot.js';

/** Options for {@link functionCallUnkept}. */
export interface FunctionCallUnkeptOptions {
  /** The call's limits, each as its caller resolved it. Its timeout covers
   *  the laying of its drafts and its function's run, one after the other. */
  readonly limits: { readonly timeoutMs: number; readonly maxResultBytes: number; readonly maxLogBytes: number };
  /** Pass `-v` to a stock runner. */
  readonly verbose?: boolean;
  /** The time, in epoch milliseconds (default `Date.now`). */
  readonly now?: () => number;
}

/**
 * Calls a function through a workspace within this process, and keeps nothing
 * of the call.
 *
 * @remarks
 * 1. **Check.** Its arity, the arguments alone; and each draft it passes
 *    (`pinCallDrafts`), as a kept call's start checks one. A call found wrong
 *    is answered `invalid`, and nothing runs.
 * 2. **Pin.** The function's inputs and its dataset arguments, each at the
 *    hash it holds now (`pinCallArguments`); an input or a dataset with no
 *    value is `invalid`, naming it.
 * 3. **Lay.** Its drafts, in the order passed, each by its mutation's own
 *    program on `runner`, for what is left of the call's timeout
 *    (`layCallDrafts`). A draft that does not lay ends the call as a Save of
 *    it would have ended, and its function does not run (`callDraftsEnd`).
 * 4. **Run.** Its function, on `runner` with `runDetached`, reading each input
 *    of a drafted record at the state its drafts left, for what is left of
 *    the timeout.
 *
 * A call that passes drafts holds the repository's running work from its check
 * to its answer: the states its drafts leave are named by nothing, and a
 * garbage collection would sweep them under the function that reads them.
 * They are swept by the first collection after it. No commit is stored and no
 * record is moved. A call with no draft stores nothing, and holds nothing.
 *
 * The result names what the call read, as a kept call's does: each input and
 * dataset argument with the hash it was read at, the drafted state's for an
 * input of a drafted record, and each drafted record with the commit it stood
 * at. A call a draft ended names its inputs as they were pinned.
 *
 * @param storage - Storage backend
 * @param runner - The runner its drafts' programs and its function run on
 * @param repo - Repository identifier
 * @param workspace - The workspace the call is made through
 * @param pkg - The package the function was resolved in, decoded: the records
 *   its drafts name are resolved in it too
 * @param fn - The function's object
 * @param request - The arguments, and the drafts to lay over the records the
 *   function reads
 * @param options - The call's limits, its verbosity and its clock
 * @returns The call's result
 * @throws {Error} When a call that passes drafts finds a garbage collection or
 *   an upgrade holding the repository, or an object it names cannot be read
 */
export async function functionCallUnkept(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  workspace: string,
  pkg: PackageObject,
  fn: FunctionObject,
  request: Pick<FunctionCallRequest, 'args' | 'drafts'>,
  options: FunctionCallUnkeptOptions,
): Promise<ExecuteResult> {
  const now = options.now ?? Date.now;
  const { limits, verbose } = options;
  if (request.args.length !== fn.argTypes.length) {
    return invalidExecuteResult(`Expected ${fn.argTypes.length} argument(s), got ${request.args.length}`);
  }
  const deadline = now() + limits.timeoutMs;
  const pin = (args: readonly CallArg[]): ReturnType<typeof pinCallArguments> => pinCallArguments(storage, repo, workspace, args, { inputs: fn.inputs });
  /** The function's run over what the call pinned, for the time `timeoutMs`:
   *  one cut short names the call's timeout, whatever was left of it. */
  const run = async (args: DetachedArg[], inputs: ExecuteResult['inputs'], timeoutMs: number): Promise<ExecuteResult> => {
    const result = detachedToExecuteResult(await runner.runDetached({
      bodyIr: await storage.objects.read(repo, fn.bodyIr),
      args,
      runner: fn.runner,
      limits: { ...limits, timeoutMs },
      ...(fn.environment.type === 'some' && { environment: fn.environment.value }),
    }, { storage, ...(verbose !== undefined && { verbose }) }), inputs);
    return result.outcome.type === 'timed_out' ? { ...result, outcome: variant('timed_out', { ms: BigInt(limits.timeoutMs) }) } : result;
  };

  if (request.drafts.length === 0) {
    const pinned = await pin(request.args);
    if (!('args' in pinned)) return pinned;
    return run(pinned.args, pinned.inputs, limits.timeoutMs);
  }

  return withRunningWork(storage, repo, async (): Promise<ExecuteResult> => {
    const drafts = await pinCallDrafts(storage, repo, workspace, pkg, fn, request.drafts);
    if ('invalid' in drafts) return invalidExecuteResult(drafts.invalid);
    const pinned = await pin(request.args);
    if (!('args' in pinned)) return pinned;

    const count = fn.inputs.length;
    const drafted = callDraftsRead(drafts.drafts);
    /** What the call read, its inputs of the drafted records at `states`:
     *  the function's inputs, then its dataset arguments as they are stored. */
    const readAt = (states: Parameters<typeof draftedInputs>[1]): ExecuteResult['inputs'] =>
      [...draftedInputs(pinned.inputs.slice(0, count), states), ...pinned.inputs.slice(count)];
    /** The call as a draft, or its timeout, ended it before its function ran. */
    const ended = (end: CallDraftsEnd, inputs: ExecuteResult['inputs']): ExecuteResult => ({
      outcome: end.outcome,
      stdout: '',
      stderr: end.stderr,
      stdoutTruncated: false,
      stderrTruncated: end.stderrTruncated,
      inputs,
      drafts: drafted,
    });

    const laid = await layCallDrafts(storage, runner, repo, drafts, {
      deadline,
      maxLogBytes: limits.maxLogBytes,
      ...(verbose !== undefined && { verbose }),
      now,
    });
    // A laying stops at its caller's signal alone, and it is given none
    if (laid.kind === 'aborted') throw new Error('the laying of the call\'s drafts was stopped');
    if (laid.kind !== 'laid') {
      return ended(callDraftsEnd(laid, BigInt(limits.timeoutMs)), readAt(drafts.drafted.map(({ path, base }) => ({ path, hash: base }))));
    }
    const inputs = readAt(laid.states);
    const left = deadline - now();
    // Its timeout ended as its drafts were laid: its function does not run
    if (left <= 0) return ended(callDraftsEnd({ kind: 'timed_out', stderr: '', stderrTruncated: false }, BigInt(limits.timeoutMs)), inputs);
    const args: DetachedArg[] = [...inputs.slice(0, count).map(({ hash }) => ({ dataset: hash })), ...pinned.args.slice(count)];
    return { ...await run(args, inputs, left), drafts: drafted };
  });
}
