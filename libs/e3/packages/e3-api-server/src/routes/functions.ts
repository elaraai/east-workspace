/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Routes for named package functions and one-shot execution.
 *
 * Functions touch no datasets, so they are callable at the package level
 * (imported in a repo, no workspace) and at the workspace level (resolved
 * from the deployed package). Both mount the same handlers.
 *
 * One-shot is workspace-scoped, caller-supplied IR — RCE with the server's
 * authority — and is gated: when the server has authentication configured,
 * only callers with an elevated role (admin/owner) may use it. A local
 * server without auth is single-tenant (author = operator) and one-shot is
 * allowed.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { variant } from '@elaraai/east';
import { workspaceGetPackage } from '@elaraai/e3-core';
import type { StorageBackend, TaskRunner } from '@elaraai/e3-core';
import { decodeBody, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import type { Identity } from '../middleware/auth.js';
import {
  FunctionCallRequestType,
  OneShotRequestType,
  ExecuteResultType,
} from '../types.js';
import {
  listPackageFunctions,
  describePackageFunction,
  callFunctionSync,
  callOneShotSync,
} from '../handlers/functions.js';

/** Roles allowed to use one-shot execution when auth is configured. */
const ONE_SHOT_ROLES = ['admin', 'owner'];

/**
 * Per-repo TaskRunner accessor — the runner is injected (the local server
 * passes LocalTaskRunner), mirroring the orchestrator runner-injection seam.
 */
export type GetRunner = (repoPath: string) => TaskRunner;


/**
 * Package-scoped function routes, mounted at
 * `/api/repos/:repo/packages/:pkg/:version/functions`.
 */
export function createPackageFunctionRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  getRunner: GetRunner
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
      const req = await decodeBody(c, FunctionCallRequestType);
      return await callFunctionSync(storage, repoPath, getRunner(repoPath), c.req.param('pkg')!, c.req.param('version')!, c.req.param('fn')!, req);
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
 */
export function createWorkspaceFunctionRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  getRunner: GetRunner
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
      const req = await decodeBody(c, FunctionCallRequestType);
      return await callFunctionSync(storage, repoPath, getRunner(repoPath), name, version, c.req.param('fn')!, req);
    } catch (err) {
      return sendError(ExecuteResultType, errorToVariant(err));
    }
  });

  return app;
}

/**
 * One-shot routes, mounted at `/api/repos/:repo/workspaces/:ws/one-shot`.
 *
 * Gated by role: with auth configured, the caller's JWT must carry an
 * elevated role (admin/owner). Without auth the server is single-tenant
 * local and the gate is open.
 */
export function createOneShotRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  getRunner: GetRunner
) {
  const app = new Hono<{ Variables: { identity?: Identity } }>();

  // Role gate: identity is set by the auth middleware when configured.
  app.use('*', async (c, next) => {
    const identity = c.get('identity');
    if (identity && !(identity.roles ?? []).some((r) => ONE_SHOT_ROLES.includes(r))) {
      return sendError(ExecuteResultType, variant('permission_denied', { path: 'one-shot' }));
    }
    await next();
  });

  app.post('/', async (c) => {
    const repoPath = getRepoPath(c.req.param('repo')!);
    try {
      const req = await decodeBody(c, OneShotRequestType);
      return await callOneShotSync(storage, repoPath, getRunner(repoPath), c.req.param('ws')!, req);
    } catch (err) {
      return sendError(ExecuteResultType, errorToVariant(err));
    }
  });

  return app;
}
