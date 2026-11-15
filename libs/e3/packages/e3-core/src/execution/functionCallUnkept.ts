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
 * instead (`functionCall.ts`), and the two read and end alike: the function
 * resolved in the package the workspace names by its hash, its inputs and its
 * dataset arguments pinned at the hash each holds as the call starts, under
 * the workspace's shared lock, its drafts laid over the records it reads and
 * its run staged by the one step (`functionDrafts.ts`'s `layAndStage`,
 * east-workspace#1619), and each end a draft gives it.
 *
 * @packageDocumentation
 */

import { variant } from '@elaraai/east';
import type { CallArg, ExecuteResult, FunctionCallRequest } from '@elaraai/e3-types';
import { withSharedWorkspaceLock } from '../records.js';
import { withRunningWork } from '../running-work.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { workspaceFunctionResolve } from './functionCall.js';
import { callDraftsRead, checkCallDrafts, draftedInputs, layAndStage, type StagedCallArg } from './functionDrafts.js';
import type { TaskRunner } from './interfaces.js';
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
 * 1. **Resolve, check and pin**, under the workspace's shared lock
 *    (`withSharedWorkspaceLock`), as a Save and a kept call's start run, so
 *    the package, the records the drafts are laid over and every input are one
 *    workspace's: the function, in the package the workspace names by its hash
 *    (`workspaceFunctionResolve`); its arity, the arguments alone; each draft
 *    it passes (`checkCallDrafts`), as a kept call's start checks one; and the
 *    function's inputs and its dataset arguments, each at the hash it holds
 *    now (`pinCallArguments`). A call found wrong is answered `invalid`, and
 *    nothing runs; an input or a dataset with no value is `invalid`, naming it.
 * 2. **Lay and stage** (`layAndStage`, the step a kept call's run takes): its
 *    drafts, in the order passed, each by its mutation's own program on
 *    `runner`, for what is left of the call's timeout. A draft that does not
 *    lay ends the call as a Save of it would have ended, and its function
 *    does not run.
 * 3. **Run.** Its function, on `runner` with `runDetached`, reading each input
 *    of a drafted record at the state its drafts left, and a dataset argument
 *    naming one as saved, at the state they were laid over, for what is left
 *    of the timeout.
 *
 * A call that passes drafts holds the repository's running work from its check
 * to its answer: the states its drafts leave are named by nothing, and a
 * garbage collection would sweep them under the function that reads them.
 * They are swept by the first collection after it. Its drafts are laid from
 * their arguments in hand: nothing of them is stored but what laying them
 * writes. No commit is stored and no record is moved. A call with no draft
 * stores nothing, and holds nothing once it is pinned.
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
 * @param fnName - The function's name in the deployed package
 * @param request - The arguments, and the drafts to lay over the records the
 *   function reads
 * @param options - The call's limits, its verbosity and its clock
 * @returns The call's result
 * @throws {WorkspaceNotFoundError} When there is no such workspace
 * @throws {WorkspaceNotDeployedError} When nothing is deployed to it
 * @throws {TaskNotFoundError} When the deployed package has no such function
 * @throws {WorkspaceLockError} When a deploy or a removal holds the workspace
 * @throws {Error} When a garbage collection or an upgrade holds the
 *   repository, or an object the call names cannot be read
 *
 * @example
 * ```ts
 * const result = await functionCallUnkept(storage, new LocalTaskRunner(repo), repo, 'dev', 'jobs_on', {
 *   args: [variant('value', encodeBeast2For(StringType)('P1'))],
 *   drafts: [{ record: 'jobs', mutation: 'move', args: [jobId, pressId] }],
 * }, { limits: { timeoutMs: 600_000, maxResultBytes: 64 * 1024 * 1024, maxLogBytes: 64 * 1024 } });
 * if (result.outcome.type === 'success') console.log(result.drafts); // [{ record: 'jobs', commit: '9f2c…' }]
 * ```
 */
export async function functionCallUnkept(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  workspace: string,
  fnName: string,
  request: Pick<FunctionCallRequest, 'args' | 'drafts'>,
  options: FunctionCallUnkeptOptions,
): Promise<ExecuteResult> {
  const now = options.now ?? Date.now;
  const { limits, verbose } = options;
  const deadline = now() + limits.timeoutMs;

  const call = async (): Promise<ExecuteResult> => {
    // Resolved, checked and pinned as one workspace's, as a Save reads it
    const started = await withSharedWorkspaceLock(storage, repo, workspace, undefined, async () => {
      const { pkg, fn } = await workspaceFunctionResolve(storage, repo, workspace, fnName);
      if (request.args.length !== fn.argTypes.length) {
        return invalidExecuteResult(`Expected ${fn.argTypes.length} argument(s), got ${request.args.length}`);
      }
      const drafted = await checkCallDrafts(storage, repo, workspace, pkg, fn, request.drafts);
      if ('invalid' in drafted) return invalidExecuteResult(drafted.invalid);
      const pinned = await pinCallArguments(storage, repo, workspace, request.args, { inputs: fn.inputs });
      if (!('args' in pinned)) return pinned;
      return { fn, drafted, pinned };
    });
    if (!('fn' in started)) return started;
    const { fn, drafted, pinned } = started;

    const count = fn.inputs.length;
    const staged = await layAndStage(storage, runner, repo, {
      // An input of a drafted record at the state its drafts are laid over
      inputs: draftedInputs(pinned.inputs.slice(0, count), drafted.map(({ path, base }) => ({ path, hash: base }))),
      args: stagedArgs(request.args, pinned.inputs.slice(count)),
      drafted,
      drafts: request.drafts,
    }, {
      deadline,
      timeoutMs: BigInt(limits.timeoutMs),
      maxLogBytes: limits.maxLogBytes,
      ...(verbose !== undefined && { verbose }),
      now,
    });
    const read = callDraftsRead(drafted);
    switch (staged.kind) {
      case 'ended':
        return {
          outcome: staged.end.outcome,
          stdout: '',
          stderr: staged.end.stderr,
          stdoutTruncated: false,
          stderrTruncated: staged.end.stderrTruncated,
          inputs: staged.read,
          drafts: read,
        };
      case 'staged': {
        const result = detachedToExecuteResult(await runner.runDetached({
          bodyIr: await storage.objects.read(repo, fn.bodyIr),
          args: staged.args,
          runner: fn.runner,
          limits: { ...limits, timeoutMs: staged.left },
          ...(fn.environment.type === 'some' && { environment: fn.environment.value }),
        }, { storage, ...(verbose !== undefined && { verbose }) }), staged.read);
        // One cut short names the call's timeout, whatever was left of it
        const outcome = result.outcome.type === 'timed_out' ? variant('timed_out', { ms: BigInt(limits.timeoutMs) }) : result.outcome;
        return { ...result, outcome, drafts: read };
      }
      // It is given no signal and no pin, so its laying is never stopped and it always goes on
      default:
        throw new Error(`the call's drafts ended its laying '${staged.kind}', which a call no store keeps does not`);
    }
  };
  // The states its drafts leave are named by nothing until its function has read them
  return request.drafts.length > 0 ? withRunningWork(storage, repo, call) : call();
}

/**
 * A call's arguments as its staging takes them: each value in hand, and each
 * dataset by its path and the hash it was pinned at, in order.
 *
 * @param args - The call's arguments
 * @param datasets - Each dataset argument as it was pinned, in order
 * @returns The arguments, in order
 */
function stagedArgs(args: readonly CallArg[], datasets: ExecuteResult['inputs']): StagedCallArg[] {
  let at = 0;
  return args.map((arg) => (arg.type === 'value' ? { value: arg.value } : { dataset: datasets[at++]! }));
}
