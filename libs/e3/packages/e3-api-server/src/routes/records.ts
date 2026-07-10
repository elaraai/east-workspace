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
 *
 * When auth is configured the committed `actor` is derived from the verified
 * identity (the client-supplied actor is ignored), so the audit trail cannot
 * be forged. Compaction is gated to an elevated role.
 */

import { Hono } from 'hono';
import { variant } from '@elaraai/east';
import type { StorageBackend } from '@elaraai/e3-core';
import { decodeBody, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import type { Identity } from '../middleware/auth.js';
import { MutationCallRequestType, MutationResultType, RecordSignatureType } from '../types.js';
import { callMutationSync, getRecordHistory, describeRecord, compactRecord } from '../handlers/records.js';
import type { GetRunner } from './functions.js';

/** Roles allowed to compact a record's history (drops the prior chain). */
const COMPACT_ROLES = ['admin', 'owner'];

/** The audited actor + whether it is authoritative (auth-verified, so the
 *  client-supplied actor must be ignored). */
function resolveActor(identity: Identity | undefined): { actor: string; authoritative: boolean } {
  if (identity) return { actor: `auth:${identity.email ?? identity.sub}`, authoritative: true };
  return { actor: 'api', authoritative: false };
}

export function createWorkspaceRecordRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  getRunner: GetRunner,
) {
  const app = new Hono<{ Variables: { identity?: Identity } }>();

  // GET /:rec — describe the record's mutations (for encoding arguments)
  app.get('/:rec', async (c) => {
    const repoPath = getRepoPath(c.req.param('repo')!);
    try {
      return await describeRecord(storage, repoPath, c.req.param('ws')!, c.req.param('rec')!);
    } catch (err) {
      return sendError(RecordSignatureType, errorToVariant(err));
    }
  });

  // GET /:rec/history?from=<hash>&limit=N — commit chain, newest first
  app.get('/:rec/history', async (c) => {
    const repoPath = getRepoPath(c.req.param('repo')!);
    const limitRaw = c.req.query('limit');
    const parsed = limitRaw !== undefined ? Number(limitRaw) : NaN;
    const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    const from = c.req.query('from') || undefined;
    return getRecordHistory(storage, repoPath, c.req.param('ws')!, c.req.param('rec')!, limit, from);
  });

  // POST /:rec/mutations/:mut — apply a mutation synchronously (200 MutationResult)
  app.post('/:rec/mutations/:mut', async (c) => {
    const repoPath = getRepoPath(c.req.param('repo')!);
    try {
      const req = await decodeBody(c, MutationCallRequestType);
      const { actor, authoritative } = resolveActor(c.get('identity'));
      // Idempotency key travels out-of-band as a header (not the Beast2 body), so
      // adding it changes no wire type; the request signal aborts on disconnect.
      const idempotencyKey = c.req.header('Idempotency-Key') || undefined;
      return await callMutationSync(
        storage, repoPath, getRunner(repoPath),
        c.req.param('ws')!, c.req.param('rec')!, c.req.param('mut')!, req, actor, authoritative,
        { signal: c.req.raw.signal, idempotencyKey, verbose: c.req.query('verbose') === '1' },
      );
    } catch (err) {
      return sendError(MutationResultType, errorToVariant(err));
    }
  });

  // POST /:rec/compact — drop the prior commit chain (elevated role when auth is on)
  app.post('/:rec/compact', async (c) => {
    const repoPath = getRepoPath(c.req.param('repo')!);
    const identity = c.get('identity');
    if (identity && !(identity.roles ?? []).some((r) => COMPACT_ROLES.includes(r))) {
      return sendError(MutationResultType, variant('permission_denied', { path: 'compact' }));
    }
    try {
      return await compactRecord(storage, repoPath, c.req.param('ws')!, c.req.param('rec')!, resolveActor(identity).actor);
    } catch (err) {
      return sendError(MutationResultType, errorToVariant(err));
    }
  });

  return app;
}
