/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Routes for record mutations and history, mounted at
 * `/api/repos/:repo/workspaces/:ws/records`.
 *
 * Records hold live state, so — unlike functions — there is no package-scoped
 * form. A mutation is the only write door; history is a read of the chain.
 */

import { Hono } from 'hono';
import type { StorageBackend } from '@elaraai/e3-core';
import { decodeBody, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import { MutationCallRequestType, MutationResultType, RecordSignatureType } from '../types.js';
import { callMutationSync, getRecordHistory, describeRecord } from '../handlers/records.js';
import type { GetRunner } from './functions.js';

export function createWorkspaceRecordRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  getRunner: GetRunner,
) {
  const app = new Hono();

  // GET /:rec — describe the record's mutations (for encoding arguments)
  app.get('/:rec', async (c) => {
    const repoPath = getRepoPath(c.req.param('repo')!);
    try {
      return await describeRecord(storage, repoPath, c.req.param('ws')!, c.req.param('rec')!);
    } catch (err) {
      return sendError(RecordSignatureType, errorToVariant(err));
    }
  });

  // GET /:rec/history?limit=N — commit chain, newest first
  app.get('/:rec/history', async (c) => {
    const repoPath = getRepoPath(c.req.param('repo')!);
    const limitRaw = c.req.query('limit');
    const parsed = limitRaw !== undefined ? Number(limitRaw) : NaN;
    const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    return getRecordHistory(storage, repoPath, c.req.param('ws')!, c.req.param('rec')!, limit);
  });

  // POST /:rec/mutations/:mut — apply a mutation synchronously (200 MutationResult)
  app.post('/:rec/mutations/:mut', async (c) => {
    const repoPath = getRepoPath(c.req.param('repo')!);
    try {
      const req = await decodeBody(c, MutationCallRequestType);
      return await callMutationSync(
        storage, repoPath, getRunner(repoPath),
        c.req.param('ws')!, c.req.param('rec')!, c.req.param('mut')!, req, 'api',
      );
    } catch (err) {
      return sendError(MutationResultType, errorToVariant(err));
    }
  });

  return app;
}
