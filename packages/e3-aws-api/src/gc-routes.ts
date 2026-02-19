/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Routes for e3 Cloud Platform
 *
 * Provides garbage collection endpoints:
 * - POST /api/repos/:repo/gc — Start GC via Step Functions
 * - GET /api/repos/:repo/gc/:executionId — Get GC status
 */

import { Hono } from 'hono';
import { variant, some, none } from '@elaraai/east';
import { SFNClient, StartExecutionCommand, DescribeExecutionCommand } from '@aws-sdk/client-sfn';
import { randomUUID } from 'node:crypto';
import { sendSuccess, sendError, sendSuccessWithStatus } from '@elaraai/e3-api-server/beast2';
import { ApiTypes } from '@elaraai/e3-api-server';
import { extractIdentity } from './auth/index.js';
import type { RepoManager } from '@elaraai/e3-cloud-core';

/** Helper to extract identity from Hono context (API Gateway event). */
function getIdentity(c: any) {
  const env = c.env as { event: unknown };
  return extractIdentity(env.event as Parameters<typeof extractIdentity>[0]);
}

/** Helper to create internal API errors */
const internalError = (message: string) => variant('internal', { message });

/**
 * Create GC routes.
 *
 * GC uses SFNClient directly (not abstracted) since GC orchestration
 * abstraction is deferred to Phase 7.
 */
export function createGcRoutes(deps: {
  repoManager: RepoManager;
  sfn: SFNClient;
  gcStateMachineArn: string | undefined;
}): Hono {
  const { repoManager, sfn, gcStateMachineArn } = deps;
  const app = new Hono();

  // POST /api/repos/:repo/gc - Start garbage collection via Step Functions
  app.post('/api/repos/:repo/gc', async (c) => {
    const repo = c.req.param('repo');
    const identity = getIdentity(c);

    if (!gcStateMachineArn) {
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
      const executionName = `gc-${repo}-${gcId}`;

      await sfn.send(
        new StartExecutionCommand({
          stateMachineArn: gcStateMachineArn,
          name: executionName,
          input: JSON.stringify({ repo, gcId, startTime, jitterSeconds: 0 }),
        })
      );

      console.log(`Started GC state machine for repo ${repo}: ${executionName}, startedBy=${identity?.sub ?? 'unknown'}, startedByEmail=${identity?.email ?? 'unknown'}`);

      return sendSuccessWithStatus(ApiTypes.GcStartResultType, { executionId: executionName }, 202);
    } catch (err) {
      console.error('Failed to start GC:', err);
      return sendError(ApiTypes.GcStartResultType, internalError('Failed to start garbage collection'));
    }
  });

  // GET /api/repos/:repo/gc/:executionId - Get garbage collection status
  app.get('/api/repos/:repo/gc/:executionId', async (c) => {
    const executionId = c.req.param('executionId');

    if (!gcStateMachineArn) {
      return sendError(ApiTypes.GcStatusResultType, internalError('GC not available'));
    }

    // Construct execution ARN from state machine ARN and execution name
    const arnParts = gcStateMachineArn.split(':');
    const region = arnParts[3];
    const account = arnParts[4];
    const stateMachineName = arnParts[6];
    const executionArn = `arn:aws:states:${region}:${account}:execution:${stateMachineName}:${executionId}`;

    try {
      const execution = await sfn.send(
        new DescribeExecutionCommand({ executionArn })
      );

      switch (execution.status) {
        case 'RUNNING':
          return sendSuccess(ApiTypes.GcStatusResultType, {
            status: variant('running', null),
            stats: none,
            error: none,
          });

        case 'SUCCEEDED': {
          if (execution.output) {
            const output = JSON.parse(execution.output);

            if (output.success === false) {
              const errorMsg = output.error ?? (output.status
                ? `GC skipped - repo is in '${output.status}' state`
                : 'GC skipped - repo not in valid state');
              return sendSuccess(ApiTypes.GcStatusResultType, {
                status: variant('failed', null),
                stats: none,
                error: some(errorMsg),
              });
            }

            if (output.stats) {
              return sendSuccess(ApiTypes.GcStatusResultType, {
                status: variant('succeeded', null),
                stats: some({
                  deletedObjects: BigInt(output.stats.deletedObjects ?? 0),
                  deletedPartials: BigInt(0),
                  retainedObjects: BigInt(output.stats.retainedObjects ?? 0),
                  skippedYoung: BigInt(output.stats.skippedYoung ?? 0),
                  bytesFreed: BigInt(output.stats.bytesFreed ?? 0),
                }),
                error: none,
              });
            }
          }
          return sendSuccess(ApiTypes.GcStatusResultType, {
            status: variant('succeeded', null),
            stats: none,
            error: none,
          });
        }

        case 'FAILED':
        case 'TIMED_OUT':
        case 'ABORTED': {
          const errorMessage = execution.error
            ? `${execution.error}: ${execution.cause ?? ''}`
            : `GC ${execution.status.toLowerCase()}`;
          return sendSuccess(ApiTypes.GcStatusResultType, {
            status: variant('failed', null),
            stats: none,
            error: some(errorMessage),
          });
        }

        default:
          return sendSuccess(ApiTypes.GcStatusResultType, {
            status: variant('running', null),
            stats: none,
            error: none,
          });
      }
    } catch (err: any) {
      if (err.name === 'ExecutionDoesNotExist') {
        return sendError(ApiTypes.GcStatusResultType, internalError(`GC execution not found: ${executionId}`));
      }
      console.error('Failed to get GC status:', err);
      return sendError(ApiTypes.GcStatusResultType, internalError('Failed to get GC status'));
    }
  });

  return app;
}
