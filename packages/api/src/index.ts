/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Lambda API Handler for e3 Cloud Platform
 *
 * This handler serves all API routes:
 * - Auth: OIDC discovery, device flow proxy (for e3 login)
 * - Repos: List, create, delete repositories
 * - API: All e3-api-server routes (packages, workspaces, datasets, tasks, dataflow)
 */

import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import type { LambdaContext } from 'hono/aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { SFNClient, StartExecutionCommand, DescribeExecutionCommand } from '@aws-sdk/client-sfn';
import { randomUUID } from 'node:crypto';
import {
  S3DynamoStorage,
  setLambdaRequestId,
  DynamoRefStore,
  InvalidRepoStatusError,
} from '@elaraai/e3-storage';
import { StringType, NullType, ArrayType, IntegerType, StructType, variant, some, none } from '@elaraai/east';

// Auth routes
import { createDiscoveryRoutes, createDeviceFlowRoutes } from './auth/index.js';

// e3-api-server routes, types, and BEAST2 utilities
import {
  createRepositoryRoutes,
  createPackageRoutes,
  createWorkspaceRoutes,
  createDatasetRoutes,
  createTaskRoutes,
  createExecutionRoutes,
} from '@elaraai/e3-api-server/routes';
import { sendSuccess, sendError, sendSuccessWithStatus } from '@elaraai/e3-api-server/beast2';
import { ApiTypes } from '@elaraai/e3-api-server';

// Helper to create internal API errors
const internalError = (message: string) => variant('internal', { message });

// Initialize AWS clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const sfn = new SFNClient({});

// State machine ARNs (set by CDK)
const DELETE_REPO_STATE_MACHINE_ARN = process.env.DELETE_REPO_STATE_MACHINE_ARN;
const GC_STATE_MACHINE_ARN = process.env.GC_STATE_MACHINE_ARN;

// Initialize storage
const storage = new S3DynamoStorage(
  s3,
  dynamo,
  process.env.BUCKET_NAME!,
  process.env.TABLE_NAME!
);

// Get DynamoRefStore for repo management (cloud-specific methods)
const refStore = storage.refs as DynamoRefStore;

// In cloud mode, repo name IS the path (used as S3 prefix and DynamoDB partition key)
const getRepoPath = (repo: string) => repo;

const app = new Hono();

// ============================================================
// Health Check
// ============================================================
app.get('/health', (c) => c.json({ status: 'ok' }));

// ============================================================
// Auth Routes (public, no JWT required)
// ============================================================

// OIDC discovery
app.route('/', createDiscoveryRoutes());

// Device flow proxy
app.route('/', createDeviceFlowRoutes());

// ============================================================
// Repository Management (BEAST2 format for e3-cli compatibility)
// ============================================================

// GET /api/repos - List all repositories
// Returns: ArrayType(StringType)
app.get('/api/repos', async () => {
  try {
    const repos = await refStore.listRepos();
    return sendSuccess(ArrayType(StringType), repos);
  } catch (err) {
    console.error('Failed to list repos:', err);
    return sendError(ArrayType(StringType), internalError('Failed to list repositories'));
  }
});

// PUT /api/repos/:repo - Create a repository
// Returns: StringType (repo name) with 201 status
app.put('/api/repos/:repo', async (c) => {
  const repo = c.req.param('repo');

  // Validate repo name (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(repo)) {
    return sendError(StringType, internalError('Invalid repository name. Use only letters, numbers, hyphens, and underscores.'));
  }

  try {
    // Check if repo already exists with a non-active status
    const existing = await refStore.getRepoMetadata(repo);
    if (existing) {
      switch (existing.status) {
        case 'active':
          return sendError(StringType, internalError(`Repository '${repo}' already exists`));
        case 'creating':
          return sendError(StringType, internalError(`Repository '${repo}' is being created. Please wait.`));
        case 'deleting':
          return sendError(StringType, internalError(`Repository '${repo}' is being deleted. Please wait and try again.`));
        case 'gc':
          return sendError(StringType, internalError(`Repository '${repo}' already exists (currently running GC)`));
      }
    }

    await refStore.createRepo(repo);
    return sendSuccessWithStatus(StringType, repo, 201);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      // Race condition - repo was created between check and create
      return sendError(StringType, internalError(`Repository '${repo}' already exists`));
    }
    console.error('Failed to create repo:', err);
    return sendError(StringType, internalError('Failed to create repository'));
  }
});

// DELETE /api/repos/:repo - Delete a repository
// Returns: NullType with 202 Accepted (async deletion via Step Functions)
app.delete('/api/repos/:repo', async (c) => {
  const repo = c.req.param('repo');

  try {
    // Check if repo exists and get its status
    const metadata = await refStore.getRepoMetadata(repo);
    if (!metadata) {
      return sendError(NullType, internalError(`Repository '${repo}' not found`));
    }

    // Check if repo is in a valid state for deletion
    if (metadata.status === 'deleting') {
      return sendError(NullType, internalError(`Repository '${repo}' is already being deleted`));
    }
    if (metadata.status === 'gc') {
      return sendError(NullType, internalError(`Repository '${repo}' is currently running GC. Please wait for GC to complete.`));
    }
    if (metadata.status === 'creating') {
      return sendError(NullType, internalError(`Repository '${repo}' is still being created. Please wait.`));
    }

    // Start the delete state machine
    if (!DELETE_REPO_STATE_MACHINE_ARN) {
      // Fallback to synchronous deletion if state machine not configured
      console.warn('DELETE_REPO_STATE_MACHINE_ARN not set, using synchronous deletion');
      await refStore.setRepoStatus(repo, 'active', 'deleting');
      await refStore.deleteRepo(repo);
      return sendSuccess(NullType, null);
    }

    // Start async deletion via Step Functions
    const executionName = `delete-${repo}-${Date.now()}`;
    const execution = await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: DELETE_REPO_STATE_MACHINE_ARN,
        name: executionName,
        input: JSON.stringify({ repo }),
      })
    );

    console.log(`Started delete state machine for repo ${repo}:`, execution.executionArn);

    // Return 202 Accepted - deletion is in progress
    return sendSuccessWithStatus(NullType, null, 202);
  } catch (err) {
    if (err instanceof InvalidRepoStatusError) {
      return sendError(NullType, internalError(err.message));
    }
    console.error('Failed to delete repo:', err);
    return sendError(NullType, internalError('Failed to delete repository'));
  }
});

// ============================================================
// Cloud GC Endpoints (override e3-api-server's in-memory GC)
// ============================================================

// POST /api/repos/:repo/gc - Start garbage collection via Step Functions
// Returns: 202 Accepted with executionId for polling
app.post('/api/repos/:repo/gc', async (c) => {
  const repo = c.req.param('repo');

  // Check if state machine is configured
  if (!GC_STATE_MACHINE_ARN) {
    return sendError(ApiTypes.GcStartResultType, internalError('GC not available - state machine not configured'));
  }

  try {
    // Check repo exists and is in valid state for GC
    const metadata = await refStore.getRepoMetadata(repo);
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

    // Generate unique GC ID and start Step Function
    const gcId = randomUUID();
    const startTime = Date.now();
    const executionName = `gc-${repo}-${gcId}`;

    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: GC_STATE_MACHINE_ARN,
        name: executionName,
        input: JSON.stringify({ repo, gcId, startTime, jitterSeconds: 0 }),
      })
    );

    console.log(`Started GC state machine for repo ${repo}: ${executionName}`);

    // Return 202 Accepted with executionId for status polling
    return sendSuccessWithStatus(ApiTypes.GcStartResultType, { executionId: executionName }, 202);
  } catch (err) {
    console.error('Failed to start GC:', err);
    return sendError(ApiTypes.GcStartResultType, internalError('Failed to start garbage collection'));
  }
});

// GET /api/repos/:repo/gc/:executionId - Get garbage collection status
// Returns: { status: running|succeeded|failed, stats?: GcResult, error?: string }
app.get('/api/repos/:repo/gc/:executionId', async (c) => {
  const executionId = c.req.param('executionId');

  if (!GC_STATE_MACHINE_ARN) {
    return sendError(ApiTypes.GcStatusResultType, internalError('GC not available'));
  }

  // Construct execution ARN from state machine ARN and execution name
  // State machine ARN format: arn:aws:states:region:account:stateMachine:name
  // Execution ARN format: arn:aws:states:region:account:execution:name:executionName
  const arnParts = GC_STATE_MACHINE_ARN.split(':');
  const region = arnParts[3];
  const account = arnParts[4];
  const stateMachineName = arnParts[6];
  const executionArn = `arn:aws:states:${region}:${account}:execution:${stateMachineName}:${executionId}`;

  try {
    const execution = await sfn.send(
      new DescribeExecutionCommand({ executionArn })
    );

    // Map Step Functions status to our API status
    switch (execution.status) {
      case 'RUNNING':
        return sendSuccess(ApiTypes.GcStatusResultType, {
          status: variant('running', null),
          stats: none,
          error: none,
        });

      case 'SUCCEEDED': {
        // Parse output to determine if GC completed or was skipped
        if (execution.output) {
          const output = JSON.parse(execution.output);

          // Check if GC was skipped (SetGC returned success: false)
          if (output.success === false) {
            // Include actual repo status in error message if available
            const errorMsg = output.error ?? (output.status
              ? `GC skipped - repo is in '${output.status}' state`
              : 'GC skipped - repo not in valid state');
            return sendSuccess(ApiTypes.GcStatusResultType, {
              status: variant('failed', null),
              stats: none,
              error: some(errorMsg),
            });
          }

          // GC completed with stats
          if (output.stats) {
            return sendSuccess(ApiTypes.GcStatusResultType, {
              status: variant('succeeded', null),
              stats: some({
                deletedObjects: BigInt(output.stats.deletedObjects ?? 0),
                deletedPartials: BigInt(0), // Not applicable for cloud storage
                retainedObjects: BigInt(output.stats.retainedObjects ?? 0),
                skippedYoung: BigInt(output.stats.skippedYoung ?? 0),
                bytesFreed: BigInt(output.stats.bytesFreed ?? 0),
              }),
              error: none,
            });
          }
        }
        // No stats available but GC completed
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
        // PENDING or other states - treat as running
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

// ============================================================
// e3-api-server Routes
// ============================================================

// Repository status: /api/repos/:repo/status
// Note: GC endpoints are handled above with Step Functions, but other routes pass through
app.route('/api/repos/:repo', createRepositoryRoutes(storage, getRepoPath));

// Package routes: /api/repos/:repo/packages/*
app.route('/api/repos/:repo/packages', createPackageRoutes(storage, getRepoPath));

// Workspace routes: /api/repos/:repo/workspaces/*
app.route('/api/repos/:repo/workspaces', createWorkspaceRoutes(storage, getRepoPath));

// Dataset routes: /api/repos/:repo/workspaces/:ws/datasets/*
app.route('/api/repos/:repo/workspaces/:ws/datasets', createDatasetRoutes(storage, getRepoPath));

// Task routes: /api/repos/:repo/workspaces/:ws/tasks/*
app.route('/api/repos/:repo/workspaces/:ws/tasks', createTaskRoutes(storage, getRepoPath));

// Execution/Dataflow routes: /api/repos/:repo/workspaces/:ws/dataflow/*
app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(storage, getRepoPath));

// ============================================================
// Export Lambda Handler
// ============================================================

const honoHandler = handle(app);

export const handler = async (event: any, context: LambdaContext) => {
  // Track request ID for lock service
  setLambdaRequestId(context.awsRequestId);
  return honoHandler(event, context);
};
