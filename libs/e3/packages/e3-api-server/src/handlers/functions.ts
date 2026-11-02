/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Handlers for named package functions.
 *
 * A call through a package — the package route's, with no workspace — reduces
 * to the graph-free `runDetached` primitive: the caller's values → run a body
 * IR on a runner → return the result inline. Nothing durable is written — no
 * output object, no execution record, no logs, no dataset ref. A call through
 * a workspace is kept instead, as the calls handlers file and run it
 * (`handlers/calls.ts`).
 * Named functions are author-published IR (same trust as a deployed task),
 * which any caller the route admits runs on the function's own runner; a
 * runner the caller names instead is held to its grant (e3-core's
 * `functionRunnerRefusal`).
 * One-shot, whose IR is the caller's, runs through e3-core's `oneShotExecute`
 * under the grant the host gives the caller (routes/functions.ts), and so does
 * a split call's launch, which runs as a job the client polls.
 */

import { ArrayType, none, some, variant } from '@elaraai/east';
import {
  packageRead,
  PermissionDeniedError,
  TaskNotFoundError,
  detachedToExecuteResult,
  functionRunnerRefusal,
  invalidExecuteResult,
  pinCallArguments,
  resolveExecuteLimits,
  resolveJobLimits,
  splitCallInvalid,
  splitCallPlatformFree,
  splitCallPrepare,
  splitCallResult,
} from '@elaraai/e3-core/portable';
import type { DetachedArg, ExecuteCeilings, OneShotGrant, SplitCallJob, SplitCallStore, StorageBackend, TaskRunner } from '@elaraai/e3-core/portable';
import { type FunctionObject, type RunnerValue, decodeFunctionObject, pathToString } from '@elaraai/e3-types';
import { sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import {
  FunctionSignatureType,
  ExecuteResultType,
  PackageJobResponseType,
  SplitCallStatusType,
  type ExecuteResult,
  type FunctionCallRequest,
  type SplitCallRequest,
  type SplitCallStatus,
} from '../types.js';

/**
 * Resolve a named function in a package to its FunctionObject.
 *
 * @throws {TaskNotFoundError} If the function doesn't exist (functions are
 *   named callables; the wire format has no separate function_not_found tag —
 *   adding one would reorder ErrorType's sorted variant tags, a breaking
 *   wire change).
 */
async function resolveFunction(
  storage: StorageBackend,
  repoPath: string,
  pkgName: string,
  version: string,
  fnName: string
): Promise<FunctionObject> {
  const pkg = await packageRead(storage, repoPath, pkgName, version);
  const fnHash = pkg.functions.get(fnName);
  if (!fnHash) {
    throw new TaskNotFoundError(`function '${fnName}' in ${pkgName}@${version}`);
  }
  return decodeFunctionObject(await storage.objects.read(repoPath, fnHash));
}

/**
 * The arguments a named call hands its runner: the function's inputs, each
 * pinned by its hash in the workspace, then each value as its bytes and each
 * dataset argument pinned the same way, with what the call read. A call with
 * no workspace — through the package route — has none to read an input or a
 * dataset from, and is `invalid`.
 */
async function callArguments(
  storage: StorageBackend,
  repoPath: string,
  workspace: string | null,
  fnName: string,
  fnObj: FunctionObject,
  args: FunctionCallRequest['args'],
): Promise<{ args: DetachedArg[]; inputs: ExecuteResult['inputs'] } | ExecuteResult> {
  if (workspace !== null) return pinCallArguments(storage, repoPath, workspace, args, { inputs: fnObj.inputs });
  if (fnObj.inputs.length > 0) {
    return invalidExecuteResult(
      `'${fnName}' reads ${fnObj.inputs.map((path) => pathToString(path)).join(', ')} from the workspace it is called through, `
      + `and a call through the package has none: call it through a workspace it is deployed to, at …/workspaces/<ws>/functions/${fnName}`
    );
  }
  const values: DetachedArg[] = [];
  for (const [i, arg] of args.entries()) {
    if (arg.type === 'dataset') {
      return invalidExecuteResult(
        `Argument ${i} is the dataset ${pathToString(arg.value)}, and a call through the package has no workspace to read it from: `
        + `call the function through a workspace it is deployed to, at …/workspaces/<ws>/functions/${fnName}`
      );
    }
    values.push(arg.value);
  }
  return { args: values, inputs: [] };
}

/**
 * Execute a resolved named function: arity check → the caller's runner, when
 * it names one → its arguments, a dataset pinned in the workspace → read
 * bodyIr → runDetached. Never throws for execution outcomes — only for
 * storage/infra errors, and a runner the caller's grant does not allow.
 */
async function executeFunction(
  storage: StorageBackend,
  repoPath: string,
  runner: TaskRunner,
  fnName: string,
  fnObj: FunctionObject,
  req: FunctionCallRequest,
  workspace: string | null,
  syncDeadlineMs: number | undefined,
  ceilings: ExecuteCeilings | undefined,
  grant: OneShotGrant,
  signal?: AbortSignal,
  verbose?: boolean
): Promise<ExecuteResult> {
  // Signature validation: arity — the arguments alone, never the inputs the
  // server reads — is checked here, before anything runs. Per-element type
  // errors surface as a runtime decode failure (`failed`) from the runner.
  if (req.args.length !== fnObj.argTypes.length) {
    return invalidExecuteResult(
      `Expected ${fnObj.argTypes.length} argument(s), got ${req.args.length}`
    );
  }
  if (req.runner.type === 'some') {
    const refusal = functionRunnerRefusal(fnObj.runner, req.runner.value, grant);
    if (refusal !== null) return invalidExecuteResult(refusal);
  }
  const pinned = await callArguments(storage, repoPath, workspace, fnName, fnObj, req.args);
  if (!('args' in pinned)) return pinned;

  const bodyIr = await storage.objects.read(repoPath, fnObj.bodyIr);
  const runnerValue: RunnerValue = req.runner.type === 'some' ? req.runner.value : fnObj.runner;
  const limits = resolveExecuteLimits(req.limits, {
    ...(syncDeadlineMs !== undefined && { syncDeadlineMs }),
    ...(ceilings !== undefined && { ceilings }),
  });

  const result = await runner.runDetached(
    {
      bodyIr,
      args: pinned.args,
      runner: runnerValue,
      limits,
      environment: fnObj.environment.type === 'some' ? fnObj.environment.value : undefined,
    },
    { signal, storage, verbose }
  );
  // The result names each input and dataset argument the call read, at its
  // pinned hash
  return detachedToExecuteResult(result, pinned.inputs);
}

// =============================================================================
// Named function handlers
// =============================================================================

/**
 * List a package's functions with their signatures.
 */
export async function listPackageFunctions(
  storage: StorageBackend,
  repoPath: string,
  pkgName: string,
  version: string
): Promise<Response> {
  try {
    const pkg = await packageRead(storage, repoPath, pkgName, version);
    const signatures = [];
    for (const [name, fnHash] of pkg.functions) {
      const fnObj = decodeFunctionObject(await storage.objects.read(repoPath, fnHash));
      signatures.push({
        name,
        inputs: fnObj.inputs,
        argTypes: fnObj.argTypes,
        outputType: fnObj.outputType,
        runner: fnObj.runner,
      });
    }
    return sendSuccess(ArrayType(FunctionSignatureType), signatures);
  } catch (err) {
    return sendError(ArrayType(FunctionSignatureType), errorToVariant(err));
  }
}

/**
 * Describe a single function (signature) so dynamic callers can encode args.
 */
export async function describePackageFunction(
  storage: StorageBackend,
  repoPath: string,
  pkgName: string,
  version: string,
  fnName: string
): Promise<Response> {
  try {
    const fnObj = await resolveFunction(storage, repoPath, pkgName, version, fnName);
    return sendSuccess(FunctionSignatureType, {
      name: fnName,
      inputs: fnObj.inputs,
      argTypes: fnObj.argTypes,
      outputType: fnObj.outputType,
      runner: fnObj.runner,
    });
  } catch (err) {
    return sendError(FunctionSignatureType, errorToVariant(err));
  }
}

/**
 * Call a named function synchronously: resolve → validate arity → run →
 * 200 ExecuteResult. The call's limits are held to the host's ceilings, and its
 * timeout under the host's sync deadline too, so the caller gets a structured
 * `timed_out` instead of a transport cut. It runs within the request, on
 * `runner`, and keeps nothing: the package route's. A call through a
 * workspace's routes is kept, and runs where the host runs calls
 * (`callFunctionInWorkspace`).
 *
 * @remarks
 * A call that names no runner runs the function on its own, whatever the
 * caller's grant. One that names a runner is refused the `custom` runtime
 * (`invalid`), and a platform package the function's own runner does not
 * load unless the grant is `any` (`permission_denied`, `path` `runner`).
 *
 * The function's inputs come first among its parameters: through a workspace
 * each is read as stored at launch, pinned by its hash and named in the
 * result's `inputs`; an unassigned one is `invalid`, naming its path. The
 * caller passes the arguments alone, each a value or a dataset of the
 * workspace, pinned the same way. A call with no workspace, the package
 * route's, has none to read from: a function with inputs, and a dataset
 * argument, are `invalid`, and nothing runs.
 *
 * @param storage - Storage backend
 * @param repoPath - The repository
 * @param runner - The repository's task runner
 * @param pkgName - The package
 * @param version - Its version
 * @param fnName - The function
 * @param req - The arguments, and any runner and limits the caller names
 * @param verbose - Pass `-v` to a stock runner
 * @param syncDeadlineMs - The host's deadline for a sync call, under its
 *   request timeout (default 120 000 ms)
 * @param grant - The caller's one-shot grant, which decides whether its call
 *   may give the function a platform package the function does not load:
 *   only `any` may (default `platform_free`)
 * @param workspace - The workspace the call runs in, whose datasets its
 *   arguments may name, for a host that calls a workspace's function within
 *   its request and keeps nothing; `null`, the default, for the package
 *   route's, which has none
 * @param ceilings - The most the call may ask for (default: a server's, a
 *   10-minute timeout, a 1 MiB result and 256 KiB of logs)
 * @returns The call's result, or the error that stopped it
 */
export async function callFunctionSync(
  storage: StorageBackend,
  repoPath: string,
  runner: TaskRunner,
  pkgName: string,
  version: string,
  fnName: string,
  req: FunctionCallRequest,
  verbose?: boolean,
  syncDeadlineMs?: number,
  grant: OneShotGrant = 'platform_free',
  workspace: string | null = null,
  ceilings?: ExecuteCeilings,
): Promise<Response> {
  try {
    const fnObj = await resolveFunction(storage, repoPath, pkgName, version, fnName);
    const result = await executeFunction(storage, repoPath, runner, fnName, fnObj, req, workspace, syncDeadlineMs, ceilings, grant, undefined, verbose);
    return sendSuccess(ExecuteResultType, result);
  } catch (err) {
    return sendError(ExecuteResultType, errorToVariant(err));
  }
}

// =============================================================================
// Split call handlers
// =============================================================================

/** Options for {@link startSplitCall}. */
export interface StartSplitCallOptions {
  /** The most a request may ask for (default: a server's). */
  ceilings?: ExecuteCeilings;
  /** Whether the job only explains the call: it plans the call's pieces, and
   *  runs no unit. */
  explain?: boolean;
}

/**
 * Launch a split call, as a job the client polls; or an explain of one, a job
 * that plans its pieces.
 *
 * @remarks
 * The launch applies the caller's grant, pins the call's dataset arguments and
 * writes what the job runs (e3-core `splitCallPrepare`), then files the job and
 * dispatches it to the compute the store chooses. An explain launches the same
 * way, and its job plans the pieces as the run would, which a run that
 * follows plans again, finding the pieces it stored: the request does no more
 * than the launch's small writes. A request found
 * wrong is filed as a job already `completed` with its `invalid` result, so
 * every call's result, whatever it is, comes back through the poll. The job
 * records whether a caller whose grant is `platform_free` may poll it
 * (e3-core `splitCallPlatformFree`).
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param repo - The repository's name, which the job is filed under
 * @param workspace - The workspace whose datasets the call reads
 * @param request - The call
 * @param grant - What the caller may run: the grant the host's auth gave it
 * @param splitCallStore - Where the job is filed, and dispatched from
 * @param options - The ceilings the call's limits are held to, and whether
 *   the job only explains it
 * @returns The response: the job's id, or the error — `permission_denied`
 *   (`path` `one-shot`) for a caller whose grant does not run the call
 */
export async function startSplitCall(
  storage: StorageBackend,
  repoPath: string,
  repo: string,
  workspace: string,
  request: SplitCallRequest,
  grant: OneShotGrant,
  splitCallStore: SplitCallStore,
  options: StartSplitCallOptions = {},
): Promise<Response> {
  try {
    const { ceilings } = options;
    const launched = await splitCallPrepare(storage, repoPath, workspace, request, { grant, ...(ceilings !== undefined && { ceilings }) });
    const id = globalThis.crypto.randomUUID();
    const filed = {
      repo,
      workspace,
      explain: options.explain ?? false,
      platformFree: splitCallPlatformFree(request, grant),
      createdAt: new Date(),
    };
    if ('outcome' in launched) {
      const limits = resolveJobLimits(request.limits, ceilings);
      await splitCallStore.create(id, {
        ...filed,
        task: '',
        inputs: [],
        objects: [],
        then: none,
        limits: { timeoutMs: BigInt(limits.timeoutMs), maxResultBytes: BigInt(limits.maxResultBytes), maxLogBytes: BigInt(limits.maxLogBytes) },
        read: [],
        status: variant('completed', splitCallInvalid(launched)),
      });
      return sendSuccess(PackageJobResponseType, { id });
    }
    await splitCallStore.create(id, {
      ...filed,
      task: launched.task,
      inputs: [...launched.inputs],
      objects: launched.objects.map((index) => BigInt(index)),
      then: launched.then === null ? none : some(launched.then),
      limits: {
        timeoutMs: BigInt(launched.limits.timeoutMs),
        maxResultBytes: BigInt(launched.limits.maxResultBytes),
        maxLogBytes: BigInt(launched.limits.maxLogBytes),
      },
      read: launched.read,
      status: variant('processing', none),
    });
    await splitCallStore.execute(id, repo);
    return sendSuccess(PackageJobResponseType, { id });
  } catch (err) {
    return sendError(PackageJobResponseType, errorToVariant(err));
  }
}

/**
 * The split call a caller may poll, or cancel: `null` when the workspace
 * launched no such job.
 *
 * @remarks
 * A caller whose grant is `none` polls no job, and one whose grant is
 * `platform_free` only a job its record lets it (`platformFree`): a result
 * persists and is found by its id, so a reader never reads that of a call only
 * an elevated grant could run.
 *
 * @throws {PermissionDeniedError} (`path` `one-shot`) For a caller whose grant
 *   does not poll the job
 */
async function pollableSplitCall(
  splitCallStore: SplitCallStore,
  repo: string,
  workspace: string,
  id: string,
  grant: OneShotGrant,
): Promise<SplitCallJob | null> {
  if (grant === 'none') throw new PermissionDeniedError('one-shot');
  const job = await splitCallStore.get(id);
  if (job === null || job.repo !== repo || job.workspace !== workspace) return null;
  if (grant === 'platform_free' && !job.platformFree) throw new PermissionDeniedError('one-shot');
  return job;
}

/** The answer to a workspace that launched no split call `id`. */
function noSplitCall(workspace: string, id: string): Response {
  return sendError(SplitCallStatusType, variant('internal', {
    message: `workspace '${workspace}' has no split call '${id}'`,
  }));
}

/** A split call's status, as a poll answers it: a finished call's value read
 *  from the store. */
async function splitCallStatusOf(storage: StorageBackend, repoPath: string, job: SplitCallJob): Promise<SplitCallStatus> {
  const status = job.status;
  switch (status.type) {
    case 'processing':
      return variant('processing', status.value);
    case 'failed':
      return variant('failed', status.value);
    case 'planned':
      return variant('planned', status.value);
    case 'cancelled':
      return variant('cancelled', null);
    case 'completed': {
      const result = await splitCallResult(storage, repoPath, status.value, job.read, Number(job.limits.maxResultBytes));
      return variant('completed', { result, output: status.value.output, report: status.value.report });
    }
  }
}

/**
 * A split call's status: how far its job has got, its result, the pieces an
 * explain planned, why e3 could not run it, or that it was cancelled.
 *
 * @remarks
 * A job's record holds hashes: a finished call's value is read from the store
 * and answered inline up to the call's `maxResultBytes`, a collection spliced,
 * and over that the result is `too_large` and names the assembled output, which
 * the caller reads by its hash.
 *
 * A caller whose grant is `none` polls no job, and one whose grant is
 * `platform_free` only a job its record lets it (`platformFree`): a result
 * persists and is found by its id, so a reader never reads that of a call only
 * an elevated grant could run.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param splitCallStore - Where the job is filed
 * @param repo - The repository's name
 * @param workspace - Workspace name
 * @param id - The job's id
 * @param grant - What the caller may run: the grant the host's auth gave it
 * @returns The response: the status; or the error — `permission_denied`
 *   (`path` `one-shot`) for a caller whose grant does not poll the job, and
 *   `internal` when this workspace launched no such job
 */
export async function getSplitCallStatus(
  storage: StorageBackend,
  repoPath: string,
  splitCallStore: SplitCallStore,
  repo: string,
  workspace: string,
  id: string,
  grant: OneShotGrant,
): Promise<Response> {
  try {
    const job = await pollableSplitCall(splitCallStore, repo, workspace, id, grant);
    if (job === null) return noSplitCall(workspace, id);
    return sendSuccess(SplitCallStatusType, await splitCallStatusOf(storage, repoPath, job));
  } catch (err) {
    return sendError(SplitCallStatusType, errorToVariant(err));
  }
}

/**
 * Cancel a split call: a job still `processing` ends `cancelled`, and the
 * job's processor stops its units once it finds it so; one that has ended is
 * left as it is.
 *
 * @remarks
 * Whoever may poll the job may cancel it, by the rule
 * {@link getSplitCallStatus} polls by. The store writes the cancel only while
 * the job runs, in one step with its check, so a cancel never overwrites a
 * result, nor a result a cancel. The units that finished stay cached, so a
 * relaunch is served them.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param splitCallStore - Where the job is filed
 * @param repo - The repository's name
 * @param workspace - Workspace name
 * @param id - The job's id
 * @param grant - What the caller may run: the grant the host's auth gave it
 * @returns The response: the job's status after the cancel, as a poll answers
 *   it — `cancelled`, or the status it had ended with; or the error, as
 *   {@link getSplitCallStatus} answers it
 */
export async function cancelSplitCall(
  storage: StorageBackend,
  repoPath: string,
  splitCallStore: SplitCallStore,
  repo: string,
  workspace: string,
  id: string,
  grant: OneShotGrant,
): Promise<Response> {
  try {
    let job = await pollableSplitCall(splitCallStore, repo, workspace, id, grant);
    if (job === null) return noSplitCall(workspace, id);
    if (job.status.type === 'processing') {
      if (await splitCallStore.updateStatus(id, variant('cancelled', null))) {
        job = { ...job, status: variant('cancelled', null) };
      } else {
        // It ended as the cancel came: answered as it ended.
        job = await splitCallStore.get(id) ?? job;
      }
    }
    return sendSuccess(SplitCallStatusType, await splitCallStatusOf(storage, repoPath, job));
  } catch (err) {
    return sendError(SplitCallStatusType, errorToVariant(err));
  }
}
