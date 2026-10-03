/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import type { StorageBackend, TransferBackend } from '@elaraai/e3-core/portable';
import { getStatus, getRecord, startGc, getGcStatus } from '../handlers/repository.js';
import { decodeBody } from '../beast2.js';
import { GcRequestType } from '../types.js';

/**
 * Repository routes, mounted at `/api/repos/:repo`: its status, its record,
 * and gc.
 *
 * @remarks
 * The record is read, never upgraded: mounted without the repository gate, the
 * route answers a repository that owes upgrades as the gate does, 503
 * `repository_upgrade_pending` with a `Retry-After` ({@link getRecord}).
 *
 * @param storage - Storage backend
 * @param getRepoPath - The repository identifier for a repo name
 * @param transferBackend - Files and dispatches the job gc runs as, and holds
 *   the status a poll reads
 * @returns The routes
 */
export function createRepositoryRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  transferBackend: TransferBackend,
) {
  const app = new Hono();

  // GET /api/repos/:repo/status - Get repository status
  app.get('/status', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    return getStatus(storage, repoPath);
  });

  // GET /api/repos/:repo/record - The repository's record: its release and upgrades
  app.get('/record', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    return getRecord(storage, repoPath);
  });

  // POST /api/repos/:repo/gc - Start a gc job
  app.post('/gc', async (c) => {
    const repo = c.req.param('repo')!;
    const request = await decodeBody(c, GcRequestType);
    return startGc(repo, request, transferBackend.repoGc);
  });

  // GET /api/repos/:repo/gc/:executionId - Poll a gc job
  app.get('/gc/:executionId', (c) => {
    const repo = c.req.param('repo')!;
    const executionId = c.req.param('executionId')!;
    return getGcStatus(transferBackend.repoGc, repo, executionId);
  });

  return app;
}
