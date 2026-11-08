/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Routes for named package functions and one-shot execution.
 *
 * Functions are callable at the package level (imported in a repo, no
 * workspace) and at the workspace level (resolved from the deployed package).
 * An argument is a value, or through a workspace one of its datasets, pinned
 * at launch as a one-shot's is; the package level has no workspace to read one
 * from, and answers a dataset argument `invalid`. A call through the package
 * runs within its request and keeps nothing. A call through a workspace is
 * kept for its lifetime, and runs where the transfer backend runs calls,
 * outliving its request: its start waits a while and answers `running` with
 * the call's id, which the calls routes poll (`routes/calls.ts`); the sync
 * route waits for it within the request. A function runs on its author's
 * runner for any caller the routes admit; a runner a call names instead is
 * held to the caller's grant, which the routes take as the one-shot routes do.
 *
 * One-shot is workspace-scoped, caller-supplied IR. Who may run what is the
 * host's to say, since only its auth knows who the caller is: the route takes
 * a {@link OneShotAccess}, which gives each request's caller a grant — `any`,
 * `platform_free` or `none` — and e3-core's `oneShotExecute` runs the request
 * under it. A caller who may read a workspace may run a platform-free
 * one-shot, which can only compute over its arguments. A one-shot started as
 * a call is kept as a function's call through a workspace is, under the same
 * grant, and outlives its request. A split call — a caller's program over a
 * dataset's pieces — is launched under the same grant, and runs as a job the
 * client polls.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { ArrayType } from '@elaraai/east';
import { isUuidv7, oneShotExecute, workspaceGetPackage } from '@elaraai/e3-core/portable';
import type { ExecuteCeilings, FunctionCallLifetimes, OneShotGrant, StorageBackend, TaskRunner, TransferBackend } from '@elaraai/e3-core/portable';
import { decodeBody, sendError, sendSuccess } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import type { Identity } from '../identity.js';
import {
  FunctionCallAnswerType,
  FunctionCallRequestType,
  FunctionSignatureType,
  OneShotRequestType,
  ExecuteResultType,
  PackageJobResponseType,
  SplitCallRequestType,
  SplitCallStatusType,
} from '../types.js';
import {
  listPackageFunctions,
  describePackageFunction,
  callFunctionSync,
  cancelSplitCall,
  getSplitCallStatus,
  startSplitCall,
} from '../handlers/functions.js';
import { callFunctionInWorkspace, startFunctionCall, startOneShotCall } from '../handlers/calls.js';
import { callerOfIdentity, type CallerOf } from './calls.js';
import { badQuery, wholeQuery } from './query.js';

/**
 * Per-repo TaskRunner accessor — the runner is injected (the local server
 * passes LocalTaskRunner), mirroring the orchestrator runner-injection seam.
 */
export type GetRunner = (repoPath: string) => TaskRunner;

/**
 * Gives each request's caller a one-shot grant. Only the host's auth knows who
 * the caller is, so every host that mounts the one-shot routes decides.
 */
export type OneShotAccess = (c: Context) => OneShotGrant | Promise<OneShotGrant>;

/** Options for {@link createOneShotRoutes}. */
export interface OneShotRoutesOptions {
  /** Who may run what. Required, so every host decides. */
  access: OneShotAccess;
  /** A sync call's deadline, under the host's request timeout (default
   *  120 000 ms). */
  syncDeadlineMs?: number;
  /** The most a request may ask for, where a host's response limits are
   *  tighter than a server's default. */
  ceilings?: ExecuteCeilings;
  /**
   * The most a one-shot started as a call may ask for: its timeout is the
   * ceiling's unless it asks for less, since it outlives its request
   * (default `ceilings`). A host whose calls run elsewhere than its one-shots
   * and split calls — e3-cloud's call function — gives that compute's own.
   */
  callCeilings?: ExecuteCeilings;
  /** The longest a started call's start waits for it to end before it
   *  answers `running` (default {@link DEFAULT_CALL_WINDOW_MS}): under the
   *  host's request timeout */
  windowMs?: number;
  /** How long a started call is kept once it ends (default: an hour for a
   *  success or a cancel, a week for any other end) */
  lifetimes?: FunctionCallLifetimes;
  /** Who makes a started call, as it is kept (default `callerOfIdentity`:
   *  the identity's email, else its subject) */
  callerOf?: CallerOf;
}

/** The longest a call's start waits for it to end, unless the host says. */
export const DEFAULT_CALL_WINDOW_MS = 20_000;

/** Options for the named function routes. */
export interface FunctionRoutesOptions {
  /** A sync call's deadline, under the host's request timeout (default
   *  120 000 ms). */
  syncDeadlineMs?: number;
  /**
   * The grant each request's caller holds, as the one-shot routes' `access`
   * gives it, which decides whether a call may give the function a platform
   * package its own runner does not load: only `any` may. A call that names no
   * runner, or one on a stock runtime with no package the function's does not
   * load, runs for any caller; the `custom` runtime is refused every caller.
   * Absent, no caller may add a package.
   */
  access?: OneShotAccess;
  /**
   * The most a call may ask for. Through a workspace, a started call's timeout
   * is the ceiling's unless it asks for less, since it outlives its request; a
   * sync call's, and a call's through the package, defaults as before, and is
   * clamped under the sync deadline too (default: a server's, a 10-minute
   * timeout, a 1 MiB result and 256 KiB of logs).
   */
  ceilings?: ExecuteCeilings;
  /** The longest a call's start waits for it to end before it answers
   *  `running` (default {@link DEFAULT_CALL_WINDOW_MS}): under the host's
   *  request timeout */
  windowMs?: number;
  /** How long a call through a workspace is kept once it ends (default: an
   *  hour for a success or a cancel, a week for any other end) */
  lifetimes?: FunctionCallLifetimes;
  /** Who makes a call, as it is kept (default `callerOfIdentity`: the
   *  identity's email, else its subject) */
  callerOf?: CallerOf;
}

/** The grant of a function call's caller, by the routes' options. */
async function functionGrant(c: Context, options: FunctionRoutesOptions): Promise<OneShotGrant> {
  return options.access === undefined ? 'platform_free' : options.access(c);
}

/**
 * The one-shot grant of a caller by the roles its token carries: `any` for an
 * identity holding one of `elevated`, `platform_free` for any other identity,
 * and `none` for a request with none.
 *
 * @param elevated - The roles that run any one-shot (default `admin` and
 *   `owner`)
 * @returns The access a host with role-bearing tokens mounts
 */
export function oneShotAccessByRoles(elevated: readonly string[] = ['admin', 'owner']): OneShotAccess {
  return (c) => {
    const identity = (c as Context<{ Variables: { identity?: Identity } }>).get('identity');
    if (identity === undefined) return 'none';
    return (identity.roles ?? []).some((role) => elevated.includes(role)) ? 'any' : 'platform_free';
  };
}

/**
 * Package-scoped function routes, mounted at
 * `/api/repos/:repo/packages/:pkg/:version/functions`.
 *
 * @param storage - Storage backend
 * @param getRepoPath - A repository's identifier from its name
 * @param getRunner - Each repository's task runner
 * @param options - The host's sync deadline, the ceilings a call's limits are
 *   held to, and the grant a runner a call names is held to
 * @returns The routes
 */
export function createPackageFunctionRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  getRunner: GetRunner,
  options: FunctionRoutesOptions = {}
) {
  const app = new Hono();

  // GET / - List functions with signatures
  app.get('/', async (c) => {
    const repoPath = getRepoPath(c.req.param('repo')!);
    return listPackageFunctions(storage, repoPath, c.req.param('pkg')!, c.req.param('version')!);
  });

  // GET /:fn - Describe a function
  app.get('/:fn', async (c) => {
    const repoPath = getRepoPath(c.req.param('repo')!);
    return describePackageFunction(storage, repoPath, c.req.param('pkg')!, c.req.param('version')!, c.req.param('fn')!);
  });

  // POST /:fn - Call synchronously (200 ExecuteResult)
  app.post('/:fn', async (c) => {
    const repoPath = getRepoPath(c.req.param('repo')!);
    try {
      const grant = await functionGrant(c, options);
      const req = await decodeBody(c, FunctionCallRequestType);
      return await callFunctionSync(storage, repoPath, getRunner(repoPath), c.req.param('pkg')!, c.req.param('version')!, c.req.param('fn')!, req,
        c.req.query('verbose') === '1', options.syncDeadlineMs, grant, null, options.ceilings);
    } catch (err) {
      return sendError(ExecuteResultType, errorToVariant(err));
    }
  });

  return app;
}

/**
 * Workspace-scoped function routes, mounted at
 * `/api/repos/:repo/workspaces/:ws/functions`. The package is resolved from
 * what's deployed in the workspace.
 *
 * - `GET /` lists the deployed package's functions, and `GET /:fn` describes
 *   one, as the package routes do.
 * - `POST /:fn/calls[?wait=ms&id=uuidv7]` starts a call: it is filed, run where
 *   the transfer backend runs calls, and kept for its lifetime. The start
 *   waits up to `wait` — at most `windowMs`, which it waits when none is
 *   given — and answers the call's id and its status: its result once it
 *   ended, or `running`, which the calls routes poll. `?wait=0` answers at
 *   once. An `id` the client chose, a UUIDv7 of about now, names the call, so
 *   the client can cancel it before the start answers; one far from the
 *   server's clock is set aside for the server's own, which the answer names,
 *   and an id that is no UUIDv7 is refused `400 bad_request`.
 * - `POST /:fn` calls it synchronously: the same call, filed and kept, waited
 *   for within the request, its timeout clamped under the sync deadline, and
 *   answered as its `ExecuteResult`.
 *
 * @remarks
 * A workspace whose package cannot be resolved — none deployed, or no such
 * workspace — is answered in the envelope of the route's own type, as its
 * handler answers every other error: the client decodes each route's answer by
 * that type, and would read another's as a decode error, not the API's.
 *
 * @param storage - Storage backend
 * @param getRepoPath - A repository's identifier from its name
 * @param transferBackend - Runs the calls where the backend runs them, and
 *   hears of their ends
 * @param options - The host's sync deadline, the grant a runner a call names
 *   is held to, the ceilings, the start's window, the lifetimes, and who calls
 * @returns The routes
 */
export function createWorkspaceFunctionRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  transferBackend: TransferBackend,
  options: FunctionRoutesOptions = {}
) {
  const app = new Hono();
  const windowMs = options.windowMs ?? DEFAULT_CALL_WINDOW_MS;
  const callerOf = options.callerOf ?? callerOfIdentity;
  const filing = (c: Context, grant: OneShotGrant) => ({
    caller: callerOf(c),
    grant,
    verbose: c.req.query('verbose') === '1',
    ...(options.ceilings !== undefined && { ceilings: options.ceilings }),
    ...(options.lifetimes !== undefined && { lifetimes: options.lifetimes }),
  });

  const deployed = async (c: Context): Promise<{ repoPath: string; name: string; version: string }> => {
    const repoPath = getRepoPath(c.req.param('repo')!);
    const ws = c.req.param('ws')!;
    const pkg = await workspaceGetPackage(storage, repoPath, ws);
    return { repoPath, name: pkg.name, version: pkg.version };
  };

  app.get('/', async (c) => {
    try {
      const { repoPath, name, version } = await deployed(c);
      return await listPackageFunctions(storage, repoPath, name, version);
    } catch (err) {
      return sendError(ArrayType(FunctionSignatureType), errorToVariant(err));
    }
  });

  app.get('/:fn', async (c) => {
    try {
      const { repoPath, name, version } = await deployed(c);
      return await describePackageFunction(storage, repoPath, name, version, c.req.param('fn')!);
    } catch (err) {
      return sendError(FunctionSignatureType, errorToVariant(err));
    }
  });

  // POST /:fn/calls - Start a call, kept for its lifetime (FunctionCallAnswer)
  app.post('/:fn/calls', async (c) => {
    const repo = c.req.param('repo')!;
    try {
      const query = wholeQuery(c, { wait: 0 });
      if (query instanceof Response) return query;
      // The id the client chose, so it can stop the call before this answers
      const id = c.req.query('id');
      if (id !== undefined && !isUuidv7(id)) return badQuery(`id must be a UUIDv7, got ${JSON.stringify(id)}`);
      const grant = await functionGrant(c, options);
      const req = await decodeBody(c, FunctionCallRequestType);
      return await startFunctionCall(storage, transferBackend.functionCalls, repo, getRepoPath(repo), c.req.param('ws')!, c.req.param('fn')!, req, {
        ...filing(c, grant),
        waitMs: Math.min(query.wait ?? windowMs, windowMs),
        ...(id !== undefined && { id }),
      });
    } catch (err) {
      return sendError(FunctionCallAnswerType, errorToVariant(err));
    }
  });

  // POST /:fn - Call synchronously, kept as a started call is (ExecuteResult)
  app.post('/:fn', async (c) => {
    const repo = c.req.param('repo')!;
    try {
      const grant = await functionGrant(c, options);
      const req = await decodeBody(c, FunctionCallRequestType);
      // A dataset argument is the workspace's, pinned at launch
      return await callFunctionInWorkspace(storage, transferBackend.functionCalls, repo, getRepoPath(repo), c.req.param('ws')!, c.req.param('fn')!, req, {
        ...filing(c, grant),
        ...(options.syncDeadlineMs !== undefined && { syncDeadlineMs: options.syncDeadlineMs }),
      });
    } catch (err) {
      return sendError(ExecuteResultType, errorToVariant(err));
    }
  });

  return app;
}

/**
 * One-shot routes, mounted at `/api/repos/:repo/workspaces/:ws/one-shot`.
 *
 * - `POST /` takes the caller's grant from `options.access`, and runs the
 *   request under it through e3-core's `oneShotExecute`, stopped when the
 *   caller hangs up: within the request, its timeout under the sync deadline,
 *   keeping nothing.
 * - `POST /calls[?wait=ms&id=uuidv7]` starts the request as a call under the
 *   same grant: filed, run where the transfer backend runs calls, and kept
 *   for its lifetime among the workspace's calls, naming no function. The
 *   start waits and answers as a function's start does
 *   (`POST …/functions/:fn/calls`): the call's id and its status, its result
 *   once it ended or `running`, which the calls routes poll and cancel.
 * - `POST /split` launches a split call under the same grant and answers its
 *   job's id; with `?explain=1` its job plans the call's pieces instead, and
 *   runs no unit.
 * - `GET /split/:id` answers a split call's status: how far it has got, its
 *   result, the pieces an explain planned, why e3 could not run it, or that
 *   it was cancelled.
 * - `POST /split/:id/cancel` cancels a split call that is still running, and
 *   answers its status after, as a poll does.
 *
 * A caller refused is answered `permission_denied` (`path` `one-shot`), and
 * nothing runs. A caller whose grant is `none` polls or cancels no split call,
 * and one whose grant is `platform_free` only a platform-free one, or one such
 * a caller launched.
 *
 * @param storage - Storage backend
 * @param getRepoPath - A repository's identifier from its name
 * @param transferBackend - Files and dispatches the jobs split calls run as,
 *   and runs started calls, each of which outlasts a request, on the runner
 *   the backend was given
 * @param getRunner - Each repository's task runner
 * @param options - Who may run what, the host's sync deadline, the most a
 *   request may ask for, and a started call's ceilings, window, lifetimes and
 *   caller
 * @returns The routes
 */
export function createOneShotRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  transferBackend: TransferBackend,
  getRunner: GetRunner,
  options: OneShotRoutesOptions
) {
  const app = new Hono<{ Variables: { identity?: Identity } }>();
  const windowMs = options.windowMs ?? DEFAULT_CALL_WINDOW_MS;
  const callerOf = options.callerOf ?? callerOfIdentity;
  const callCeilings = options.callCeilings ?? options.ceilings;

  app.post('/', async (c) => {
    const repoPath = getRepoPath(c.req.param('repo')!);
    try {
      const grant = await options.access(c);
      const req = await decodeBody(c, OneShotRequestType);
      const result = await oneShotExecute(storage, getRunner(repoPath), repoPath, c.req.param('ws')!, req, {
        grant,
        signal: c.req.raw.signal,
        verbose: c.req.query('verbose') === '1',
        ...(options.syncDeadlineMs !== undefined && { syncDeadlineMs: options.syncDeadlineMs }),
        ...(options.ceilings !== undefined && { ceilings: options.ceilings }),
      });
      return sendSuccess(ExecuteResultType, result);
    } catch (err) {
      return sendError(ExecuteResultType, errorToVariant(err));
    }
  });

  // POST /calls - Start a one-shot as a call, kept for its lifetime
  // (FunctionCallAnswer)
  app.post('/calls', async (c) => {
    const repo = c.req.param('repo')!;
    try {
      const query = wholeQuery(c, { wait: 0 });
      if (query instanceof Response) return query;
      // The id the client chose, so it can stop the call before this answers
      const id = c.req.query('id');
      if (id !== undefined && !isUuidv7(id)) return badQuery(`id must be a UUIDv7, got ${JSON.stringify(id)}`);
      const grant = await options.access(c);
      const req = await decodeBody(c, OneShotRequestType);
      return await startOneShotCall(storage, transferBackend.functionCalls, repo, getRepoPath(repo), c.req.param('ws')!, req, {
        caller: callerOf(c),
        grant,
        verbose: c.req.query('verbose') === '1',
        ...(callCeilings !== undefined && { ceilings: callCeilings }),
        ...(options.lifetimes !== undefined && { lifetimes: options.lifetimes }),
        waitMs: Math.min(query.wait ?? windowMs, windowMs),
        ...(id !== undefined && { id }),
      });
    } catch (err) {
      return sendError(FunctionCallAnswerType, errorToVariant(err));
    }
  });

  // POST /split - Launch a split call (or, with ?explain=1, a job that plans
  // its pieces)
  app.post('/split', async (c) => {
    const repo = c.req.param('repo')!;
    try {
      const grant = await options.access(c);
      const req = await decodeBody(c, SplitCallRequestType);
      return await startSplitCall(storage, getRepoPath(repo), repo, c.req.param('ws')!, req, grant, transferBackend.splitCall, {
        ...(options.ceilings !== undefined && { ceilings: options.ceilings }),
        explain: c.req.query('explain') === '1',
      });
    } catch (err) {
      return sendError(PackageJobResponseType, errorToVariant(err));
    }
  });

  // GET /split/:id - Poll a split call
  app.get('/split/:id', async (c) => {
    const repo = c.req.param('repo')!;
    try {
      const grant = await options.access(c);
      return await getSplitCallStatus(storage, getRepoPath(repo), transferBackend.splitCall, repo, c.req.param('ws')!, c.req.param('id'), grant);
    } catch (err) {
      return sendError(SplitCallStatusType, errorToVariant(err));
    }
  });

  // POST /split/:id/cancel - Cancel a split call
  app.post('/split/:id/cancel', async (c) => {
    const repo = c.req.param('repo')!;
    try {
      const grant = await options.access(c);
      return await cancelSplitCall(storage, getRepoPath(repo), transferBackend.splitCall, repo, c.req.param('ws')!, c.req.param('id'), grant);
    } catch (err) {
      return sendError(SplitCallStatusType, errorToVariant(err));
    }
  });

  return app;
}
