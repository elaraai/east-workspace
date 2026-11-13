/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Calls of named functions through a workspace, and one-shots started as
 * calls, each filed as it starts, run where its backend runs calls, and kept
 * for a lifetime once it ends (east-workspace#1554).
 *
 * A call is a record in the repository's call store (`StorageBackend.calls`):
 * - **Start** ({@link functionCallStart}): the function is resolved in the
 *   deployed package, the call is checked (its arity, a runner it names held to
 *   its caller's grant), its function's inputs and its dataset arguments are
 *   pinned at the hash each holds now, each value argument is stored through
 *   the store's door, and the call is filed `running`, with its limits, its
 *   deadline and its lifetimes. A call found wrong is filed ended `invalid`,
 *   and nothing runs. A one-shot's start ({@link oneShotCallStart}) holds the
 *   request to its caller's grant as a one-shot run within a request is held,
 *   and files its program as an anonymous function of its own, which runs as
 *   a named function's does from here on.
 * - **Run** ({@link functionCallRun}): the call runs on a runner with
 *   `runDetached`, its inputs and arguments staged as the stored objects they
 *   are, while it watches its record for a request to cancel it. Once it ends,
 *   a value is stored through the store's door and the call is recorded ended,
 *   with its log tails and the lifetime its end gives it.
 * - **Status** ({@link functionCallStatus}): what its caller's poll answers:
 *   `running`, the call's `ExecuteResult` once it ends, with its value read back
 *   inline, `cancelled` or `lost`.
 *
 * What a call writes before it names it — its arguments, its value — is written
 * holding the repository's running work, so gc holding the repository still
 * never sweeps it in between; once filed, the call roots everything it names
 * for its lifetime (`RepoStore.gcScanCallRoots`).
 *
 * Every step goes through `StorageBackend` and `TaskRunner`, so every backend
 * shares it: the local server's dispatch runs a call in its process, e3-web's
 * on the page's workers, and e3-cloud's on its own compute
 * (`TransferBackend.functionCalls`).
 *
 * @packageDocumentation
 */

import { encodeBeast2For, none, some, variant } from '@elaraai/east';
import {
  FunctionObjectType,
  decodeFunctionObject,
  type CallArg,
  type ExecuteResult,
  type FunctionCallArg,
  type FunctionCallJob,
  type FunctionCallKeep,
  type FunctionCallRequest,
  type FunctionCallState,
  type FunctionCallStatus,
  type FunctionCallSummary,
  type FunctionObject,
  type OneShotRequest,
  type RunnerValue,
} from '@elaraai/e3-types';
import { readDatasetWhole } from '../dataset-open.js';
import { PermissionDeniedError, TaskNotFoundError, checkId } from '../errors.js';
import { packageRead } from '../packages.js';
import { withRunningWork } from '../running-work.js';
import { storeDatasetBytes } from '../store-collection.js';
import type { FunctionCallEnd, StorageBackend } from '../storage/interfaces.js';
import { uuidv7, uuidv7Timestamp } from '../uuid.js';
import { workspaceGetPackage } from '../workspaces.js';
import type { DetachedArg, DetachedResult, TaskRunner } from './interfaces.js';
import {
  oneShotPlatformUse, pinCallArguments, programSignature, resolveExecuteLimits, resolveJobLimits, type ExecuteCeilings, type OneShotGrant,
  type ResolvedLimits,
} from './oneShot.js';

const encodeFunctionObject = encodeBeast2For(FunctionObjectType);

/**
 * How long a call is kept once it ends, in milliseconds, by how it ended.
 */
export interface FunctionCallLifetimes {
  /** A call that succeeded, or was cancelled */
  readonly succeededMs: number;
  /** A call that failed, was refused, returned too large a value, timed out,
   *  or was lost */
  readonly failedMs: number;
}

/** How long a call is kept unless its host says: a success an hour, a
 *  failure a week. */
export const DEFAULT_FUNCTION_CALL_LIFETIMES: FunctionCallLifetimes = {
  succeededMs: 60 * 60_000,
  failedMs: 7 * 24 * 60 * 60_000,
};

/** How long past its deadline a call still recorded running is waited for
 *  before it is taken for lost: its host had that long to record its end. */
export const FUNCTION_CALL_GRACE_MS = 5 * 60_000;

/** How often a running call reads its record for a request to cancel it,
 *  unless its host says. */
const WATCH_MS = 1000;

/** How far from the server's clock the time of an id a caller chose may be:
 *  one further is set aside for an id of the server's, so a workspace's ids
 *  still order as its calls started. */
const CHOSEN_ID_SKEW_MS = 5 * 60_000;

/** No log tails. */
const QUIET = { stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false };

/** Options for {@link functionCallStart}. */
export interface FunctionCallStartOptions {
  /** Who makes the call, as the host's auth names them; `null` without an identity */
  readonly caller: string | null;
  /** The caller's one-shot grant, which a runner the call names is held to
   *  (default `platform_free`) */
  readonly grant?: OneShotGrant;
  /** The most a call may ask for: a call's timeout is the ceiling's unless it
   *  asks for less (default: a server's) */
  readonly ceilings?: ExecuteCeilings;
  /**
   * A call answered within one request, the sync route's: its timeout
   * defaults as a sync call's does, and is clamped under the host's deadline
   * for a sync call (default 120 000 ms). Absent, the call is a job's, which
   * answers no request: its timeout defaults to the ceiling.
   */
  readonly sync?: { readonly deadlineMs?: number };
  /** How long the call is kept once it ends (default
   *  {@link DEFAULT_FUNCTION_CALL_LIFETIMES}) */
  readonly lifetimes?: FunctionCallLifetimes;
  /** Pass `-v` to a stock runner */
  readonly verbose?: boolean;
  /** The time, in epoch milliseconds (default `Date.now`) */
  readonly now?: () => number;
  /**
   * An id its caller chose for the call: a UUIDv7 of about now, which the call
   * is filed under, so its caller can ask it to stop before the start answers.
   * One whose time is more than five minutes from the server's clock is set
   * aside for an id of the server's, which the call's answer names. Default:
   * an id the server mints.
   */
  readonly id?: string;
}

/**
 * The runner a call names in place of the function's own, as the caller's
 * grant allows it: why it is refused, or `null` when it runs.
 *
 * @remarks
 * A function's body is its author's, and runs on its author's runner, so a call
 * that names no runner runs for any caller. A runner the call names is the
 * caller's:
 * - the `custom` runtime is refused whatever the grant, since it would run a
 *   command of the caller's own;
 * - a stock runtime given a platform package the function's own runner does
 *   not load makes more reachable than the author gave the body, and runs only
 *   under the elevated grant (`any`);
 * - any other — the function's packages, or fewer, on a stock runtime — runs
 *   for any caller.
 *
 * @param stored - The function's own runner
 * @param named - The runner the call names
 * @param grant - The caller's one-shot grant
 * @returns Why the call is refused (`invalid`), or `null` when it runs
 * @throws {PermissionDeniedError} When the runner gives a package the
 *   function's does not load, and the grant is not `any` (`path` `runner`).
 */
export function functionRunnerRefusal(stored: RunnerValue, named: RunnerValue, grant: OneShotGrant): string | null {
  if (named.type === 'custom') {
    return 'the call names the custom runtime to run the function on, which runs a command of its own: '
      + 'a function runs on its own runner, or on a stock runtime the call names — east_c, east_node or east_py';
  }
  const loaded = stored.type === 'custom' ? [] : stored.value.platforms;
  if (grant !== 'any' && named.value.platforms.some((platform) => !loaded.includes(platform))) {
    throw new PermissionDeniedError('runner');
  }
  return null;
}

/**
 * Files a call of a named function through a workspace, as it starts.
 *
 * @remarks
 * In order:
 * 1. **Resolve.** The function in the package deployed to the workspace; the
 *    call runs the function object it names now, whatever is deployed later.
 * 2. **Check.** Its arity, the arguments alone, never the inputs the server
 *    reads; and a runner it names, held to the caller's grant
 *    ({@link functionRunnerRefusal}).
 * 3. **Pin and store.** The function's inputs and its dataset arguments, each
 *    at the hash it holds now (`pinCallArguments`); an input or a dataset with
 *    no value refuses the call, naming it. Each value argument is stored
 *    through the store's door, so the call names it, and a runner elsewhere
 *    stages it as it stages a dataset.
 * 4. **File.** The call, `running`, under the id its caller chose (a UUIDv7
 *    of about now) or one the server mints, its deadline its timeout from now.
 *    It is kept past its deadline for a grace and then a failure's lifetime,
 *    so a call whose host stopped, which nothing ends, is still there for the
 *    first read past the grace to record `lost` ({@link functionCallRead}),
 *    and is forgotten as a failure is.
 *
 * A call found wrong is filed ended `invalid`, kept as a failure is, and runs
 * nothing.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param workspace - The workspace the call is made through
 * @param fnName - The function's name in the deployed package
 * @param request - The arguments, a runner to run on instead of the
 *   function's own, and the limits
 * @param options - Who calls, their grant, the host's ceilings and deadline,
 *   and the call's lifetimes
 * @returns The call as filed: `running`, or ended `invalid`
 * @throws {WorkspaceNotFoundError} When there is no such workspace
 * @throws {WorkspaceNotDeployedError} When nothing is deployed to it
 * @throws {TaskNotFoundError} When the deployed package has no such function
 * @throws {PermissionDeniedError} When the call names a runner its caller's
 *   grant does not allow (`path` `runner`)
 * @throws {InvalidNameError} When the id its caller chose is not a UUIDv7,
 *   before anything is read
 * @throws {Error} When a garbage collection or an upgrade holds the
 *   repository, or the workspace keeps a call under the id its caller chose
 */
export async function functionCallStart(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  fnName: string,
  request: FunctionCallRequest,
  options: FunctionCallStartOptions,
): Promise<FunctionCallJob> {
  if (options.id !== undefined) checkId('call id', options.id);
  const now = options.now ?? Date.now;
  const lifetimes = options.lifetimes ?? DEFAULT_FUNCTION_CALL_LIFETIMES;
  const deployed = await workspaceGetPackage(storage, repo, workspace);
  const pkg = await packageRead(storage, repo, deployed.name, deployed.version);
  const fnHash = pkg.functions.get(fnName);
  if (fnHash === undefined) throw new TaskNotFoundError(`function '${fnName}' in ${deployed.name}@${deployed.version}`);
  const fnObj = decodeFunctionObject(await storage.objects.read(repo, fnHash));

  const limits: ResolvedLimits = options.sync !== undefined
    ? resolveExecuteLimits(request.limits, {
        ...(options.sync.deadlineMs !== undefined && { syncDeadlineMs: options.sync.deadlineMs }),
        ...(options.ceilings !== undefined && { ceilings: options.ceilings }),
      })
    : resolveJobLimits(request.limits, options.ceilings);
  const startedAt = now();
  const filing: Filing = {
    id: filedId(options.id, startedAt),
    fn: some(fnName),
    pkg: some({ name: deployed.name, version: deployed.version }),
    caller: options.caller,
    workspace,
    startedAt,
    deadline: startedAt + limits.timeoutMs,
    limits,
    verbose: options.verbose ?? false,
    keep: keepOf(lifetimes),
  };
  const refuse = async (diagnostics: Diagnostics): Promise<FunctionCallJob> => {
    const job = filedCall(filing, variant('invalid', { diagnostics }), [], [], fnHash, fnObj.runner, startedAt + lifetimes.failedMs);
    await storage.calls.create(repo, job);
    return job;
  };

  if (request.args.length !== fnObj.argTypes.length) {
    return refuse(diagnostic(`Expected ${fnObj.argTypes.length} argument(s), got ${request.args.length}`));
  }
  let runner: RunnerValue = fnObj.runner;
  if (request.runner.type === 'some') {
    const refusal = functionRunnerRefusal(fnObj.runner, request.runner.value, options.grant ?? 'platform_free');
    if (refusal !== null) return refuse(diagnostic(refusal));
    runner = request.runner.value;
  }

  return withRunningWork(storage, repo, async () => {
    const pinned = await pinCallArguments(storage, repo, workspace, request.args, { inputs: fnObj.inputs });
    if (!('args' in pinned)) {
      return refuse(pinned.outcome.type === 'invalid' ? pinned.outcome.value.diagnostics : diagnostic('the call\'s arguments did not pin'));
    }
    const inputs = pinned.inputs.slice(0, fnObj.inputs.length);
    const args = await keptArguments(storage, repo, request.args, pinned.inputs, fnObj.inputs.length);
    // Kept past the grace, so a read finds a call its host stopped, and records it lost
    const job = filedCall(filing, variant('running', null), args, inputs, fnHash, runner, filing.deadline + FUNCTION_CALL_GRACE_MS + lifetimes.failedMs);
    await storage.calls.create(repo, job);
    return job;
  });
}

/** Options for {@link oneShotCallStart}. */
export interface OneShotCallStartOptions {
  /** Who makes the call, as the host's auth names them; `null` without an identity */
  readonly caller: string | null;
  /** The caller's one-shot grant: what they may run, as a one-shot run within
   *  a request is held to it (`oneShotExecute`) */
  readonly grant: OneShotGrant;
  /** The most a call may ask for: its timeout is the ceiling's unless it asks
   *  for less, since it answers no request (default: a server's) */
  readonly ceilings?: ExecuteCeilings;
  /** How long the call is kept once it ends (default
   *  {@link DEFAULT_FUNCTION_CALL_LIFETIMES}) */
  readonly lifetimes?: FunctionCallLifetimes;
  /** Pass `-v` to a stock runner */
  readonly verbose?: boolean;
  /** The time, in epoch milliseconds (default `Date.now`) */
  readonly now?: () => number;
  /** An id its caller chose for the call, as a named function's call takes
   *  one ({@link FunctionCallStartOptions.id}) */
  readonly id?: string;
}

/**
 * Files a one-shot started as a call through a workspace: its caller's
 * program, run as an anonymous function and kept as a named function's call
 * is, so it outlives the request that starts it.
 *
 * @remarks
 * In order:
 * 1. **Grant.** As a one-shot run within a request is held (`oneShotExecute`):
 *    `none` is refused; `platform_free` starts only a platform-free request
 *    (`oneShotPlatformUse`). Both come before any storage read.
 * 2. **Workspace.** It must exist and be deployed.
 * 3. **Store.** The program, and an anonymous function object naming it —
 *    its parameters' and return types, its runner, and no inputs — which the
 *    call runs as a named function's object runs, and which it alone keeps.
 * 4. **Check, pin and store.** Its arity; each dataset argument pinned at the
 *    hash it holds now, an unassigned one refusing the call; each value
 *    argument stored through the store's door.
 * 5. **File.** As a named function's call is filed
 *    ({@link functionCallStart}), naming no function and no package, its
 *    timeout the ceiling's unless it asks for less.
 *
 * A call found wrong — a program that is no function, a wrong arity, an
 * unassigned dataset — is filed ended `invalid`, kept as a failure is, and
 * runs nothing; one whose program is no function names the program as sent in
 * place of a function object.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param workspace - The workspace whose datasets the call reads
 * @param request - The body, its arguments, its runner and its limits
 * @param options - Who calls, their grant, the host's ceilings, and the
 *   call's lifetimes
 * @returns The call as filed: `running`, or ended `invalid`
 * @throws {PermissionDeniedError} For `none`, and for `platform_free` with a
 *   request that is not platform-free (`path` `one-shot`), before anything is
 *   read
 * @throws {WorkspaceNotFoundError} When there is no such workspace
 * @throws {WorkspaceNotDeployedError} When nothing is deployed to it
 * @throws {InvalidNameError} When the id its caller chose is not a UUIDv7,
 *   before anything is read
 * @throws {Error} When a garbage collection or an upgrade holds the
 *   repository, or the workspace keeps a call under the id its caller chose
 */
export async function oneShotCallStart(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  request: OneShotRequest,
  options: OneShotCallStartOptions,
): Promise<FunctionCallJob> {
  if (options.id !== undefined) checkId('call id', options.id);
  if (options.grant === 'none') throw new PermissionDeniedError('one-shot');
  // The program's types, which its function object names: one that is no
  // function is refused once the call is filed
  let signature: ReturnType<typeof programSignature> | null = null;
  let notAFunction = '';
  try {
    signature = programSignature(request.bodyIr);
  } catch (err) {
    notAFunction = `the body does not decode as a function: ${messageOf(err)}`;
  }
  if (options.grant === 'platform_free') {
    // Its runner first, and then its program, as a one-shot run within a request
    let use: string | null = null;
    try {
      use = oneShotPlatformUse(request);
    } catch {
      // A program that is no function: refused once the call is filed
    }
    if (use !== null) throw new PermissionDeniedError('one-shot');
  }
  await workspaceGetPackage(storage, repo, workspace);

  const now = options.now ?? Date.now;
  const lifetimes = options.lifetimes ?? DEFAULT_FUNCTION_CALL_LIFETIMES;
  const limits = resolveJobLimits(request.limits, options.ceilings);
  const startedAt = now();
  const filing: Filing = {
    id: filedId(options.id, startedAt),
    fn: none,
    pkg: none,
    caller: options.caller,
    workspace,
    startedAt,
    deadline: startedAt + limits.timeoutMs,
    limits,
    verbose: options.verbose ?? false,
    keep: keepOf(lifetimes),
  };

  return withRunningWork(storage, repo, async () => {
    const program = await storage.objects.write(repo, request.bodyIr);
    const refuse = async (functionObject: string, diagnostics: Diagnostics): Promise<FunctionCallJob> => {
      const job = filedCall(filing, variant('invalid', { diagnostics }), [], [], functionObject, request.runner, startedAt + lifetimes.failedMs);
      await storage.calls.create(repo, job);
      return job;
    };
    if (signature === null) return refuse(program, diagnostic(notAFunction));
    const fnObj: FunctionObject = {
      bodyIr: program,
      inputs: [],
      drafts: [],
      argTypes: signature.argTypes,
      outputType: signature.outputType,
      runner: request.runner,
      environment: none,
    };
    const functionObject = await storage.objects.write(repo, encodeFunctionObject(fnObj));
    if (request.args.length !== fnObj.argTypes.length) {
      return refuse(functionObject, diagnostic(`Expected ${fnObj.argTypes.length} argument(s), got ${request.args.length}`));
    }
    const pinned = await pinCallArguments(storage, repo, workspace, request.args);
    if (!('args' in pinned)) {
      return refuse(functionObject, pinned.outcome.type === 'invalid' ? pinned.outcome.value.diagnostics : diagnostic('the call\'s arguments did not pin'));
    }
    const args = await keptArguments(storage, repo, request.args, pinned.inputs, 0);
    // Kept past the grace, so a read finds a call its host stopped, and records it lost
    const job = filedCall(filing, variant('running', null), args, [], functionObject, request.runner,
      filing.deadline + FUNCTION_CALL_GRACE_MS + lifetimes.failedMs);
    await storage.calls.create(repo, job);
    return job;
  });
}

/** A refusal's diagnostics. */
type Diagnostics = Extract<FunctionCallState, { type: 'invalid' }>['value']['diagnostics'];

/** A refusal's one diagnostic, naming no place in a source. */
function diagnostic(message: string): Diagnostics {
  return [{ message, filename: none, line: none, column: none }];
}

/** What every call a start files names, beside how it stands and what it pinned. */
interface Filing {
  readonly id: string;
  /** The function's name; `none` for a one-shot */
  readonly fn: FunctionCallJob['call']['function'];
  /** The package it runs from; `none` for a one-shot */
  readonly pkg: FunctionCallJob['call']['package'];
  readonly caller: string | null;
  readonly workspace: string;
  readonly startedAt: number;
  readonly deadline: number;
  readonly limits: ResolvedLimits;
  readonly verbose: boolean;
  readonly keep: FunctionCallKeep;
}

/** The id a call is filed under: the one its caller chose, unless its clock
 *  is far from ours, else one the server mints. */
function filedId(chosen: string | undefined, startedAt: number): string {
  return chosen !== undefined && Math.abs(uuidv7Timestamp(chosen).getTime() - startedAt) <= CHOSEN_ID_SKEW_MS ? chosen : uuidv7();
}

/** How long a call is kept once it ends, as its record holds it. */
function keepOf(lifetimes: FunctionCallLifetimes): FunctionCallKeep {
  return { succeeded: BigInt(lifetimes.succeededMs), failed: BigInt(lifetimes.failedMs) };
}

/** A call as its start files it: `running`, or ended as it started. */
function filedCall(
  filing: Filing,
  state: FunctionCallState,
  args: FunctionCallArg[],
  inputs: FunctionCallJob['call']['inputs'],
  functionObject: string,
  runner: RunnerValue,
  expiresAt: number,
): FunctionCallJob {
  return {
    call: {
      id: filing.id,
      function: filing.fn,
      caller: filing.caller === null ? none : some(filing.caller),
      startedAt: new Date(filing.startedAt),
      endedAt: state.type === 'running' ? none : some(new Date(filing.startedAt)),
      state,
      package: filing.pkg,
      args,
      inputs,
      limits: {
        timeoutMs: BigInt(filing.limits.timeoutMs),
        maxResultBytes: BigInt(filing.limits.maxResultBytes),
        maxLogBytes: BigInt(filing.limits.maxLogBytes),
      },
      expiresAt: new Date(expiresAt),
      ...QUIET,
    },
    workspace: filing.workspace,
    functionObject,
    runner,
    verbose: filing.verbose,
    deadline: new Date(filing.deadline),
    cancel: none,
    keep: filing.keep,
  };
}

/**
 * A call's arguments as it keeps them: each value stored through the store's
 * door, and each dataset by the hash it was pinned at, which `pinned` holds
 * after the `skip` inputs pinned before the arguments.
 */
async function keptArguments(
  storage: StorageBackend,
  repo: string,
  args: readonly CallArg[],
  pinned: ExecuteResult['inputs'],
  skip: number,
): Promise<FunctionCallArg[]> {
  const kept: FunctionCallArg[] = [];
  let datasetAt = skip;
  for (const arg of args) {
    if (arg.type === 'value') {
      kept.push(variant('value', await storeDatasetBytes(storage, repo, arg.value)));
    } else {
      const pin = pinned[datasetAt++]!;
      kept.push(variant('dataset', { path: pin.path, hash: pin.hash }));
    }
  }
  return kept;
}

/** Options for {@link functionCallRun}. */
export interface FunctionCallRunOptions {
  /** Aborted when the call's host stops before the call ends: the call is
   *  then recorded `lost`, not cancelled */
  readonly signal?: AbortSignal;
  /** Aborted when the call is asked to stop, so it stops at once rather than
   *  at its next look at its record: what a host that keeps its runs in
   *  process gives */
  readonly cancel?: AbortSignal;
  /** How often the run reads its record for a request to cancel it, in ms
   *  (default 1000) */
  readonly watchMs?: number;
  /** The time, in epoch milliseconds (default `Date.now`) */
  readonly now?: () => number;
}

/** What {@link functionCallRun} came to. */
export interface FunctionCallRun {
  /** The call as it stands once the run is over: ended, or as another run
   *  left it; `null` when the store keeps no such call */
  readonly job: FunctionCallJob | null;
  /** The call's result as the run had it, its value in memory, when this run
   *  ended it with one: what a poll answering at once answers without reading
   *  the value back */
  readonly result: ExecuteResult | null;
}

/**
 * Runs a filed call, and records how it ended.
 *
 * @remarks
 * A call that has ended, or that the store keeps no longer, is left as it is.
 * One asked to stop before it runs ends `cancelled`, and one whose deadline has
 * passed `timed_out`. Otherwise it runs on `runner` with `runDetached`: its
 * inputs, then its arguments, each staged as the stored object it is, under
 * what is left of its timeout, while it reads its record every
 * `options.watchMs` for a request to cancel it, which stops the runner. Once it
 * ends:
 * - a value is stored through the store's door, holding the repository's
 *   running work, and the call ends `succeeded` naming it;
 * - a request to cancel it ends it `cancelled`, naming who asked;
 * - a run its host stopped, or one the runner could not start, ends `lost`;
 * - any other end is the run's own: `failed`, `too_large` or `timed_out`.
 *
 * Each end is recorded with its log tails and the lifetime the call's
 * `keep` gives it, the first end recorded standing.
 *
 * @param storage - Storage backend
 * @param runner - The runner the call runs on
 * @param repo - Repository identifier
 * @param workspace - The workspace the call was made through
 * @param id - The call's id
 * @param options - The host's signal, a signal of a request to cancel, how
 *   often the run looks for one, and the clock
 * @returns The call once the run is over, and its result as the run had it
 */
export async function functionCallRun(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  workspace: string,
  id: string,
  options: FunctionCallRunOptions = {},
): Promise<FunctionCallRun> {
  const now = options.now ?? Date.now;
  const job = await storage.calls.get(repo, workspace, id);
  if (job === null || job.call.state.type !== 'running') return { job, result: null };
  const end = (state: FunctionCallState, streams: typeof QUIET): Promise<FunctionCallJob> => endCall(storage, repo, job, state, streams, now());
  if (job.cancel.type === 'some') return { job: await end(variant('cancelled', { by: job.cancel.value.by }), QUIET), result: null };
  const left = job.deadline.getTime() - now();
  if (left <= 0) return { job: await end(variant('timed_out', { ms: job.call.limits.timeoutMs }), QUIET), result: null };

  let fnObj: FunctionObject;
  let bodyIr: Uint8Array;
  try {
    fnObj = decodeFunctionObject(await storage.objects.read(repo, job.functionObject));
    bodyIr = await storage.objects.read(repo, fnObj.bodyIr);
  } catch (err) {
    return { job: await end(variant('lost', { message: `the call's function could not be read: ${messageOf(err)}` }), QUIET), result: null };
  }
  const args: DetachedArg[] = [
    ...job.call.inputs.map((input) => ({ dataset: input.hash })),
    ...job.call.args.map((arg) => ({ dataset: arg.type === 'value' ? arg.value : arg.value.hash })),
  ];

  // The runner stops at a request to cancel the call, which the run looks for
  // in its record, or hears of at once from its host
  const stop = new AbortController();
  const done = new AbortController();
  // The request that stopped the call, once one did: set by the watch
  const asked: { cancel: FunctionCallJob['cancel'] } = { cancel: none };
  const askedToStop = async (): Promise<void> => {
    try {
      const current = await storage.calls.get(repo, workspace, id);
      if (current === null) stop.abort();
      else if (current.cancel.type === 'some') {
        asked.cancel = current.cancel;
        stop.abort();
      }
    } catch {
      // A look that fails looks again
    }
  };
  const watching = (async () => {
    const watchMs = options.watchMs ?? WATCH_MS;
    while (!stop.signal.aborted && !done.signal.aborted) {
      await pause(watchMs, done.signal);
      if (done.signal.aborted) return;
      await askedToStop();
    }
  })();
  const onCancel = (): void => { void askedToStop(); };
  const onStop = (): void => stop.abort();
  options.cancel?.addEventListener('abort', onCancel, { once: true });
  options.signal?.addEventListener('abort', onStop, { once: true });
  if (options.cancel?.aborted === true) onCancel();
  if (options.signal?.aborted === true) onStop();

  let result: DetachedResult;
  try {
    result = await runner.runDetached({
      bodyIr,
      args,
      runner: job.runner,
      limits: { timeoutMs: left, maxResultBytes: Number(job.call.limits.maxResultBytes), maxLogBytes: Number(job.call.limits.maxLogBytes) },
      ...(fnObj.environment.type === 'some' && { environment: fnObj.environment.value }),
    }, { storage, signal: stop.signal, verbose: job.verbose });
  } catch (err) {
    return { job: await end(variant('lost', { message: `the call could not run: ${messageOf(err)}` }), QUIET), result: null };
  } finally {
    done.abort();
    options.cancel?.removeEventListener('abort', onCancel);
    options.signal?.removeEventListener('abort', onStop);
    await watching;
  }

  const streams = {
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
  };
  const cancel = asked.cancel;
  if (cancel.type === 'some') {
    return { job: await end(variant('cancelled', { by: cancel.value.by }), streams), result: null };
  }
  if (stop.signal.aborted) {
    return { job: await end(variant('lost', { message: 'the call\'s host stopped before it ended' }), streams), result: null };
  }
  const read = functionCallInputs(job);
  switch (result.kind) {
    case 'success': {
      const value = result.value;
      const ended = await withRunningWork(storage, repo, async () => {
        const hash = await storeDatasetBytes(storage, repo, value);
        return end(variant('succeeded', { value: hash }), streams);
      });
      return { job: ended, result: { outcome: variant('success', { value }), ...streams, inputs: read } };
    }
    case 'failed':
      return {
        job: await end(variant('failed', { exitCode: BigInt(result.exitCode) }), streams),
        result: { outcome: variant('failed', { exitCode: BigInt(result.exitCode) }), ...streams, inputs: read },
      };
    case 'too_large':
      return {
        job: await end(variant('too_large', { bytes: BigInt(result.bytes), limit: BigInt(result.limit) }), streams),
        result: { outcome: variant('too_large', { bytes: BigInt(result.bytes), limit: BigInt(result.limit) }), ...streams, inputs: read },
      };
    case 'timed_out':
      return {
        job: await end(variant('timed_out', { ms: job.call.limits.timeoutMs }), streams),
        result: { outcome: variant('timed_out', { ms: job.call.limits.timeoutMs }), ...streams, inputs: read },
      };
  }
}

/**
 * Reads a call, recording one still recorded running past its deadline and a
 * grace as `lost`: its host stopped before it ended, since a run stops itself
 * at its timeout.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param workspace - The workspace the call was made through
 * @param id - The call's id
 * @param now - The time, in epoch milliseconds (default now)
 * @returns The call as it stands, or `null` when the store keeps none
 */
export async function functionCallRead(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  id: string,
  now: number = Date.now(),
): Promise<FunctionCallJob | null> {
  const job = await storage.calls.get(repo, workspace, id);
  if (job === null || job.call.state.type !== 'running') return job;
  if (now <= job.deadline.getTime() + FUNCTION_CALL_GRACE_MS) return job;
  return endCall(storage, repo, job, variant('lost', {
    message: 'the call\'s host stopped before it ended: it was still recorded running past its deadline',
  }), QUIET, now);
}

/**
 * Records a running call `lost`, as nothing will run it: its dispatch could not
 * hand it to the compute that runs calls, say. A call that has ended is left as
 * it is, the first end recorded standing.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param job - The call
 * @param message - Why it is lost
 * @param now - The time, in epoch milliseconds (default now)
 * @returns The call as it stands
 */
export async function functionCallLost(
  storage: StorageBackend,
  repo: string,
  job: FunctionCallJob,
  message: string,
  now: number = Date.now(),
): Promise<FunctionCallJob> {
  if (job.call.state.type !== 'running') return job;
  return endCall(storage, repo, job, variant('lost', { message }), QUIET, now);
}

/**
 * A call's status, as its caller's poll answers it: `running`; its result once
 * it ended, its value read back inline; `cancelled`, naming who asked; or
 * `lost`, and why.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param job - The call
 * @returns Its status
 */
export async function functionCallStatus(storage: StorageBackend, repo: string, job: FunctionCallJob): Promise<FunctionCallStatus> {
  const state = job.call.state;
  switch (state.type) {
    case 'running': return variant('running', null);
    case 'cancelled': return variant('cancelled', state.value);
    case 'lost': return variant('lost', state.value);
    default: return variant('completed', await functionCallResult(storage, repo, job));
  }
}

/**
 * An ended call's result, as a sync call answers it: its outcome, its value
 * read back inline when it succeeded, its log tails, and each input and
 * dataset argument it read with the hash it was pinned at.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param job - The call, ended
 * @returns Its result
 * @throws {Error} When the call has not ended, or ended `cancelled` or `lost`,
 *   which have no result
 */
export async function functionCallResult(storage: StorageBackend, repo: string, job: FunctionCallJob): Promise<ExecuteResult> {
  const { call } = job;
  const streams = {
    stdout: call.stdout,
    stderr: call.stderr,
    stdoutTruncated: call.stdoutTruncated,
    stderrTruncated: call.stderrTruncated,
  };
  const state = call.state;
  switch (state.type) {
    case 'succeeded':
      return { outcome: variant('success', { value: await readDatasetWhole(storage, repo, state.value.value) }), ...streams, inputs: functionCallInputs(job) };
    case 'failed':
      return { outcome: variant('failed', state.value), ...streams, inputs: functionCallInputs(job) };
    case 'invalid':
      return { outcome: variant('invalid', state.value), ...streams, inputs: [] };
    case 'too_large':
      return { outcome: variant('too_large', state.value), ...streams, inputs: functionCallInputs(job) };
    case 'timed_out':
      return { outcome: variant('timed_out', state.value), ...streams, inputs: functionCallInputs(job) };
    default:
      throw new Error(`call ${call.id} is ${state.type}, and has no result`);
  }
}

/**
 * A call as a workspace's list of calls shows it.
 *
 * @param job - The call
 * @returns Its summary
 */
export function functionCallSummary(job: FunctionCallJob): FunctionCallSummary {
  const { id, function: fn, caller, startedAt, endedAt, state } = job.call;
  return { id, function: fn, caller, startedAt, endedAt, state };
}

/** Options for {@link handleProcessFunctionCall}. */
export interface ProcessFunctionCallDeps {
  /** Storage backend */
  readonly storage: StorageBackend;
  /** The runner the call runs on */
  readonly runner: TaskRunner;
  /** Aborted when the host stops before the call ends */
  readonly signal?: AbortSignal;
  /** Aborted when the call is asked to stop */
  readonly cancel?: AbortSignal;
  /** How often the run looks for a request to cancel the call, in ms */
  readonly watchMs?: number;
}

/**
 * Processes a filed call: runs it ({@link functionCallRun}) and answers its
 * status, its result as the run had it when the run ended it with one. What
 * every dispatch runs, wherever it runs the call: the local server in its
 * process, e3-web on the page's workers, e3-cloud on its own compute.
 *
 * @param deps - Storage, the runner, the host's signals and how often the run
 *   looks for a request to cancel the call
 * @param input - The repository, the workspace and the call's id
 * @returns The call's status once the run is over; `null` when the store keeps
 *   no such call
 */
export async function handleProcessFunctionCall(
  deps: ProcessFunctionCallDeps,
  input: { readonly repo: string; readonly workspace: string; readonly id: string },
): Promise<FunctionCallStatus | null> {
  const { job, result } = await functionCallRun(deps.storage, deps.runner, input.repo, input.workspace, input.id, {
    ...(deps.signal !== undefined && { signal: deps.signal }),
    ...(deps.cancel !== undefined && { cancel: deps.cancel }),
    ...(deps.watchMs !== undefined && { watchMs: deps.watchMs }),
  });
  if (job === null) return null;
  const state = job.call.state.type;
  if (result !== null && state !== 'cancelled' && state !== 'lost' && state !== 'running') return variant('completed', result);
  return functionCallStatus(deps.storage, input.repo, job);
}

/**
 * What a call read: each of its function's inputs and each dataset argument,
 * with the hash it was pinned at, in parameter order, as its result names them.
 *
 * @param job - The call
 * @returns What it read; none for a call of a function with no inputs and
 *   value arguments only
 */
export function functionCallInputs(job: FunctionCallJob): ExecuteResult['inputs'] {
  return [
    ...job.call.inputs,
    ...job.call.args.flatMap((arg) => (arg.type === 'dataset' ? [{ path: arg.value.path, hash: arg.value.hash }] : [])),
  ];
}

/** Records how a call ended, with the lifetime its end gives it, and answers
 *  it as it stands: as the store has it, or as it ended when the store keeps
 *  it no longer (its workspace was removed meanwhile). */
async function endCall(
  storage: StorageBackend,
  repo: string,
  job: FunctionCallJob,
  state: FunctionCallState,
  streams: typeof QUIET,
  at: number,
): Promise<FunctionCallJob> {
  const keepMs = state.type === 'succeeded' || state.type === 'cancelled' ? job.keep.succeeded : job.keep.failed;
  const end: FunctionCallEnd = { state, endedAt: new Date(at), expiresAt: new Date(at + Number(keepMs)), ...streams };
  const ended = await storage.calls.end(repo, job.workspace, job.call.id, end);
  return ended ?? { ...job, call: { ...job.call, state, endedAt: some(end.endedAt), expiresAt: end.expiresAt, ...streams } };
}

/** Waits `ms`, or until `signal` aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
