/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { variant, some } from '@elaraai/east';
import type { StorageBackend, TransferBackend } from '@elaraai/e3-core/portable';
import { workspaceGetState } from '@elaraai/e3-core/portable';
import { PackageJobResponseType } from '@elaraai/e3-types';
import {
  listWorkspaces,
  createWorkspace,
  getWorkspace,
  getWorkspaceStatus,
  getWorkspaceLockStatus,
  deleteWorkspace,
  startWorkspaceDeploy,
  getWorkspaceDeployStatus,
} from '../handlers/workspaces.js';
import { decodeBody, sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import { WorkspaceCreateRequestType, WorkspaceDeployRequestType, WorkspaceExportRequestType } from '../types.js';
import type { GetRunner } from './functions.js';
import { pathsQuery } from './query.js';

/**
 * Workspace routes, mounted at `/api/repos/:repo/workspaces`.
 *
 * @param storage - Storage backend
 * @param getRepoPath - The repository identifier for a repo name
 * @param transferBackend - Files and dispatches the jobs a deploy and an
 *   export run as, which outlast a request. A deploy job runs its migrations
 *   and index builds on the runner the backend was given.
 * @param getRunner - The runner a repository's tasks run on, which the status
 *   asks whether an execution recorded running can still finish
 * @returns The routes
 */
export function createWorkspaceRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  transferBackend: TransferBackend,
  getRunner: GetRunner,
) {
  const app = new Hono();

  // GET /api/repos/:repo/workspaces - List all workspaces
  app.get('/', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    return listWorkspaces(storage, repoPath);
  });

  // POST /api/repos/:repo/workspaces - Create a new workspace
  app.post('/', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const body = await decodeBody(c, WorkspaceCreateRequestType);
    return createWorkspace(storage, repoPath, body.name);
  });

  // GET /api/repos/:repo/workspaces/:ws - Get workspace state
  app.get('/:ws', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    return getWorkspace(storage, repoPath, ws);
  });

  // GET /api/repos/:repo/workspaces/:ws/status - Get comprehensive workspace
  // status; with `path` (repeated), only the datasets named and the tasks
  // that produce them
  app.get('/:ws/status', (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    const paths = pathsQuery(c);
    if (paths instanceof Response) return paths;
    return getWorkspaceStatus(storage, getRunner(repoPath), repoPath, ws, paths);
  });

  // GET /api/repos/:repo/workspaces/:ws/lock - What holds the workspace, and how far it has got
  app.get('/:ws/lock', (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    return getWorkspaceLockStatus(storage, repoPath, ws);
  });

  // DELETE /api/repos/:repo/workspaces/:ws - Remove a workspace
  app.delete('/:ws', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    return deleteWorkspace(storage, repoPath, ws);
  });

  // POST /api/repos/:repo/workspaces/:ws/deploy - Start a deploy job
  app.post('/:ws/deploy', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    const body = await decodeBody(c, WorkspaceDeployRequestType);
    return startWorkspaceDeploy(storage, repoPath, repo, ws, body, transferBackend.workspaceDeploy);
  });

  // GET /api/repos/:repo/workspaces/:ws/deploy/:id - Poll a deploy job
  app.get('/:ws/deploy/:id', (c) => {
    const repo = c.req.param('repo')!;
    const ws = c.req.param('ws')!;
    const id = c.req.param('id');
    return getWorkspaceDeployStatus(transferBackend.workspaceDeploy, repo, ws, id);
  });

  // POST /api/repos/:repo/workspaces/:ws/export - Start an export job, polled
  // at /api/repos/:repo/export/:id. The workspace is read before a job is
  // filed, so a name it cannot have (`invalid_name`) files none; every error
  // is answered as the other routes answer it.
  app.post('/:ws/export', async (c) => {
    const repo = c.req.param('repo')!;
    const ws = c.req.param('ws')!;

    // Determine name and version from request body or deployed package
    let requestName: string | undefined;
    let requestVersion: string | undefined;
    try {
      const body = await decodeBody(c, WorkspaceExportRequestType);
      if (body.name?.type === 'some') requestName = body.name.value;
      if (body.version?.type === 'some') requestVersion = body.version.value;
    } catch {
      // No body or invalid — use defaults
    }

    try {
      const state = await workspaceGetState(storage, getRepoPath(repo), ws);
      if (!state) {
        return sendError(PackageJobResponseType, variant('internal', { message: 'workspace not found or not deployed' }));
      }

      const exportName = requestName ?? state.packageName;
      const exportVersion = requestVersion ?? `${state.packageVersion}-${Date.now().toString(36)}`;

      const id = globalThis.crypto.randomUUID();
      await transferBackend.packageExport.create(id, {
        repo,
        name: exportName,
        version: exportVersion,
        workspace: some(ws),
        status: variant('processing', variant('pending', null)),
        createdAt: new Date(),
      });

      await transferBackend.packageExport.execute(id, repo);
      return sendSuccess(PackageJobResponseType, { id });
    } catch (err) {
      return sendError(PackageJobResponseType, errorToVariant(err));
    }
  });

  return app;
}
