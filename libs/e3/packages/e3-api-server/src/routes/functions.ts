/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Routes for named package functions and one-shot execution.
 *
 * Functions touch no datasets, so they are callable at the package level
 * (imported in a repo, no workspace) and at the workspace level (resolved
 * from the deployed package). Both mount the same handlers. A function runs
 * on its author's runner for any caller the routes admit; a runner a call
 * names instead is held to the caller's grant, which the routes take as the
 * one-shot routes do.
 *
 * One-shot is workspace-scoped, caller-supplied IR. Who may run what is the
 * host's to say, since only its auth knows who the caller is: the route takes
 * a {@link OneShotAccess}, which gives each request's caller a grant — `any`,
 * `platform_free` or `none` — and e3-core's `oneShotExecute` runs the request
 * under it. A caller who may read a workspace may run a platform-free
 * one-shot, which can only compute over its arguments. A split call — a
 * caller's program over a dataset's pieces — is launched under the same grant,
 * and runs as a job the client polls.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { oneShotExecute, workspaceGetPackage } from '@elaraai/e3-core/portable';
import type { ExecuteCeilings, OneShotGrant, StorageBackend, TaskRunner, TransferBackend } from '@elaraai/e3-core/portable';
import { decodeBody, sendError, sendSuccess } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import type { Identity } from '../identity.js';
import {
  FunctionCallRequestType,
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
  getSplitCallStatus,
  startSplitCall,
} from '../handlers/functions.js';

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
}

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
 * @param options - The host's sync deadline, and the grant a runner a call
 *   names is held to
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
      return await callFunctionSync(storage, repoPath, getRunner(repoPath), c.req.param('pkg')!, c.req.param('version')!, c.req.param('fn')!, req, c.req.query('verbose') === '1', options.syncDeadlineMs, grant);
    } catch (err) {
      return sendError(ExecuteResultType, errorToVariant(err));
    }
  });

  return app;
}

/**
 * Workspace-scoped function routes, mounted at
 * `/api/repos/:repo/workspaces/:ws/functions`. The package is resolved from
 * what's deployed in the workspace; the handlers are identical.
 *
 * @param storage - Storage backend
 * @param getRepoPath - A repository's identifier from its name
 * @param getRunner - Each repository's task runner
 * @param options - The host's sync deadline, and the grant a runner a call
 *   names is held to
 * @returns The routes
 */
export function createWorkspaceFunctionRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  getRunner: GetRunner,
  options: FunctionRoutesOptions = {}
) {
  const app = new Hono();

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
      return sendError(ExecuteResultType, errorToVariant(err));
    }
  });

  app.get('/:fn', async (c) => {
    try {
      const { repoPath, name, version } = await deployed(c);
      return await describePackageFunction(storage, repoPath, name, version, c.req.param('fn')!);
    } catch (err) {
      return sendError(ExecuteResultType, errorToVariant(err));
    }
  });

  app.post('/:fn', async (c) => {
    try {
      const { repoPath, name, version } = await deployed(c);
      const grant = await functionGrant(c, options);
      const req = await decodeBody(c, FunctionCallRequestType);
      return await callFunctionSync(storage, repoPath, getRunner(repoPath), name, version, c.req.param('fn')!, req, c.req.query('verbose') === '1', options.syncDeadlineMs, grant);
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
 *   caller hangs up.
 * - `POST /split` launches a split call under the same grant and answers its
 *   job's id; with `?explain=1` its job plans the call's pieces instead, and
 *   runs no unit.
 * - `GET /split/:id` answers a split call's status: how far it has got, its
 *   result, the pieces an explain planned, or why e3 could not run it.
 *
 * A caller refused is answered `permission_denied` (`path` `one-shot`), and
 * nothing runs. A caller whose grant is `none` polls no split call, and one
 * whose grant is `platform_free` only a platform-free one, or one such a
 * caller launched.
 *
 * @param storage - Storage backend
 * @param getRepoPath - A repository's identifier from its name
 * @param transferBackend - Files and dispatches the jobs split calls run as,
 *   which outlast a request, on the runner the backend was given
 * @param getRunner - Each repository's task runner
 * @param options - Who may run what, the host's sync deadline and the most a
 *   request may ask for
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

  return app;
}
