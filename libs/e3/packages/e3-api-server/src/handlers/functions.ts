/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Handlers for named package functions.
 *
 * A call reduces to the graph-free `runDetached` primitive: marshal inputs →
 * run a body IR on a runner → return the result inline. Nothing durable is
 * written — no output object, no execution record, no logs, no dataset ref.
 * Named functions are author-published IR (same trust as a deployed task),
 * which any caller the route admits runs on the function's own runner; a
 * runner the caller names instead is held to its grant (`callFunctionSync`).
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
  invalidExecuteResult,
  resolveExecuteLimits,
  resolveJobLimits,
  splitCallInvalid,
  splitCallPlatformFree,
  splitCallPrepare,
  splitCallResult,
} from '@elaraai/e3-core/portable';
import type { ExecuteCeilings, OneShotGrant, SplitCallStore, StorageBackend, TaskRunner } from '@elaraai/e3-core/portable';
import { type FunctionObject, type RunnerValue, decodeFunctionObject } from '@elaraai/e3-types';
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
 * The runner a call names in place of the function's own, as the caller's
 * grant allows it: the `invalid` result that refuses it, or `null` when it
 * runs.
 *
 * @remarks
 * A function's body is its author's, and runs on its author's runner as a
 * task's does, so a call that names no runner runs for any caller the route
 * admits. A runner the call names is the caller's:
 * - the `custom` runtime is refused whatever the grant, since it would run a
 *   command of the caller's own;
 * - a stock runtime given a platform package the function's own runner does
 *   not load makes more reachable than the author gave the body, and runs only
 *   under the elevated grant (`any`);
 * - any other — the function's packages, or fewer, on a stock runtime — runs
 *   for any caller.
 *
 * @throws {PermissionDeniedError} When the runner gives a package the
 *   function's does not load, and the grant is not `any` (`path` `runner`).
 */
function overrideRefusal(stored: RunnerValue, override: RunnerValue, grant: OneShotGrant): ExecuteResult | null {
  if (override.type === 'custom') {
    return invalidExecuteResult(
      'the call names the custom runtime to run the function on, which runs a command of its own: '
      + 'a function runs on its own runner, or on a stock runtime the call names — east_c, east_node or east_py'
    );
  }
  const loaded = stored.type === 'custom' ? [] : stored.value.platforms;
  if (grant !== 'any' && override.value.platforms.some((platform) => !loaded.includes(platform))) {
    throw new PermissionDeniedError('runner');
  }
  return null;
}

/**
 * Execute a resolved named function: arity check → the caller's runner, when
 * it names one → read bodyIr → runDetached. Never throws for execution
 * outcomes — only for storage/infra errors, and a runner the caller's grant
 * does not allow.
 */
async function executeFunction(
  storage: StorageBackend,
  repoPath: string,
  runner: TaskRunner,
  fnObj: FunctionObject,
  req: FunctionCallRequest,
  syncDeadlineMs: number | undefined,
  grant: OneShotGrant,
  signal?: AbortSignal,
  verbose?: boolean
): Promise<ExecuteResult> {
  // Signature validation: arity is checked here, before anything runs.
  // Per-element type errors surface as a runtime decode failure (`failed`)
  // from the runner.
  if (req.args.length !== fnObj.inputTypes.length) {
    return invalidExecuteResult(
      `Expected ${fnObj.inputTypes.length} argument(s), got ${req.args.length}`
    );
  }
  if (req.runner.type === 'some') {
    const refused = overrideRefusal(fnObj.runner, req.runner.value, grant);
    if (refused !== null) return refused;
  }

  const bodyIr = await storage.objects.read(repoPath, fnObj.bodyIr);
  const runnerValue: RunnerValue = req.runner.type === 'some' ? req.runner.value : fnObj.runner;
  const limits = resolveExecuteLimits(req.limits, syncDeadlineMs === undefined ? {} : { syncDeadlineMs });

  const result = await runner.runDetached(
    {
      bodyIr,
      args: req.args,
      runner: runnerValue,
      limits,
      environment: fnObj.environment.type === 'some' ? fnObj.environment.value : undefined,
    },
    { signal, storage, verbose }
  );
  // A named function reads no dataset: its result names none.
  return detachedToExecuteResult(result);
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
        inputTypes: fnObj.inputTypes,
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
      inputTypes: fnObj.inputTypes,
      outputType: fnObj.outputType,
      runner: fnObj.runner,
    });
  } catch (err) {
    return sendError(FunctionSignatureType, errorToVariant(err));
  }
}

/**
 * Call a named function synchronously: resolve → validate arity → run →
 * 200 ExecuteResult. The call's timeout is clamped under the host's sync
 * deadline, so the caller gets a structured `timed_out` instead of a
 * transport cut.
 *
 * @remarks
 * A call that names no runner runs the function on its own, whatever the
 * caller's grant. One that names a runner is refused the `custom` runtime
 * (`invalid`), and a platform package the function's own runner does not
 * load unless the grant is `any` (`permission_denied`, `path` `runner`).
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
  grant: OneShotGrant = 'platform_free'
): Promise<Response> {
  try {
    const fnObj = await resolveFunction(storage, repoPath, pkgName, version, fnName);
    const result = await executeFunction(storage, repoPath, runner, fnObj, req, syncDeadlineMs, grant, undefined, verbose);
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
 * way, and its job plans the pieces, which stores them for the run to take up:
 * the request does no more than the launch's small writes. A request found
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
 * A split call's status: how far its job has got, its result, the pieces an
 * explain planned, or why e3 could not run it.
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
    if (grant === 'none') throw new PermissionDeniedError('one-shot');
    const job = await splitCallStore.get(id);
    if (job === null || job.repo !== repo || job.workspace !== workspace) {
      return sendError(SplitCallStatusType, variant('internal', {
        message: `workspace '${workspace}' has no split call '${id}'`,
      }));
    }
    if (grant === 'platform_free' && !job.platformFree) throw new PermissionDeniedError('one-shot');
    const status = job.status;
    switch (status.type) {
      case 'processing':
        return sendSuccess(SplitCallStatusType, variant('processing', status.value));
      case 'failed':
        return sendSuccess(SplitCallStatusType, variant('failed', status.value));
      case 'planned':
        return sendSuccess(SplitCallStatusType, variant('planned', status.value));
      case 'completed': {
        const result = await splitCallResult(storage, repoPath, status.value, job.read, Number(job.limits.maxResultBytes));
        return sendSuccess(SplitCallStatusType, variant('completed', { result, output: status.value.output }));
      }
    }
  } catch (err) {
    return sendError(SplitCallStatusType, errorToVariant(err));
  }
}
