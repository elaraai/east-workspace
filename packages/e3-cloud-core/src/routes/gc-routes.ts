/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Routes for e3 Cloud Platform
 *
 * Provides garbage collection endpoints:
 * - POST /api/repos/:repo/gc — Start GC via orchestrator
 * - GET /api/repos/:repo/gc/:executionId — Get GC status
 */

import { Hono } from 'hono';
import { variant, some, none } from '@elaraai/east';
import { randomUUID } from 'node:crypto';
import { sendSuccess, sendError, sendSuccessWithStatus } from '@elaraai/e3-api-server/beast2';
import { ApiTypes } from '@elaraai/e3-api-server';
import type { IdentityBackend } from '../interfaces.js';
import type { RepoManager } from '../repo-manager.js';
import type { GcOrchestrator } from '../gc-orchestrator.js';

/** Helper to extract identity from Hono context via IdentityBackend. */
function getIdentity(c: any, identityBackend: IdentityBackend) {
  const env = c.env as { event: unknown };
  return identityBackend.getIdentity(env.event);
}

/** Helper to create internal API errors */
const internalError = (message: string) => variant('internal', { message });

/**
 * Create GC routes.
 */
export function createGcRoutes(deps: {
  repoManager: RepoManager;
  gc?: GcOrchestrator;
  identityBackend: IdentityBackend;
}): Hono {
  const { repoManager, gc, identityBackend } = deps;
  const app = new Hono();

  // POST /api/repos/:repo/gc - Start garbage collection
  app.post('/api/repos/:repo/gc', async (c) => {
    const repo = c.req.param('repo');
    const identity = getIdentity(c, identityBackend);

    if (!gc) {
      return sendError(ApiTypes.GcStartResultType, internalError('GC not available - state machine not configured'));
    }

    try {
      const metadata = await repoManager.getRepoMetadata(repo);
      if (!metadata) {
        return sendError(ApiTypes.GcStartResultType, internalError(`Repository '${repo}' not found`));
      }
      if (metadata.status === 'gc') {
        return sendError(ApiTypes.GcStartResultType, internalError(`Repository '${repo}' is already running GC`));
      }
      if (metadata.status === 'deleting') {
        return sendError(ApiTypes.GcStartResultType, internalError(`Repository '${repo}' is being deleted`));
      }
      if (metadata.status !== 'active') {
        return sendError(ApiTypes.GcStartResultType, internalError(`Repository '${repo}' is not in active state`));
      }

      const gcId = randomUUID();
      const startTime = Date.now();
      const executionId = await gc.startGc({ repo, gcId, startTime });

      console.log(`Started GC for repo ${repo}: ${executionId}, startedBy=${identity?.sub ?? 'unknown'}, startedByEmail=${identity?.email ?? 'unknown'}`);

      return sendSuccessWithStatus(ApiTypes.GcStartResultType, { executionId }, 202);
    } catch (err) {
      console.error('Failed to start GC:', err);
      return sendError(ApiTypes.GcStartResultType, internalError('Failed to start garbage collection'));
    }
  });

  // GET /api/repos/:repo/gc/:executionId - Get garbage collection status
  app.get('/api/repos/:repo/gc/:executionId', async (c) => {
    const executionId = c.req.param('executionId');

    if (!gc) {
      return sendError(ApiTypes.GcStatusResultType, internalError('GC not available'));
    }

    try {
      const gcStatus = await gc.getGcStatus(executionId);

      switch (gcStatus.status) {
        case 'running':
          return sendSuccess(ApiTypes.GcStatusResultType, {
            status: variant('running', null),
            stats: none,
            error: none,
          });

        case 'succeeded':
          return sendSuccess(ApiTypes.GcStatusResultType, {
            status: variant('succeeded', null),
            stats: gcStatus.stats
              ? some({
                  deletedObjects: BigInt(gcStatus.stats.deletedObjects),
                  deletedPartials: BigInt(0),
                  retainedObjects: BigInt(gcStatus.stats.retainedObjects),
                  skippedYoung: BigInt(gcStatus.stats.skippedYoung),
                  bytesFreed: BigInt(gcStatus.stats.bytesFreed),
                })
              : none,
            error: none,
          });

        case 'failed':
          return sendSuccess(ApiTypes.GcStatusResultType, {
            status: variant('failed', null),
            stats: none,
            error: some(gcStatus.error),
          });

        case 'not_found':
          return sendError(ApiTypes.GcStatusResultType, internalError(`GC execution not found: ${executionId}`));
      }
    } catch (err) {
      console.error('Failed to get GC status:', err);
      return sendError(ApiTypes.GcStatusResultType, internalError('Failed to get GC status'));
    }
  });

  return app;
}
