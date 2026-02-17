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
  DynamoAclStore,
  DynamoScheduleStore,
  DynamoTaskConfigStore,
  InvalidRepoStatusError,
} from '@elaraai/e3-aws-storage';
import {
  SchedulerClient,
  DeleteScheduleCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-scheduler';
import { StringType, NullType, ArrayType, variant, some, none } from '@elaraai/east';
import {
  stepCancel, coreStateToApiState, coreEventToApiEvent, uuidv7,
  dataflowGetGraph,
  WorkspaceNotFoundError, WorkspaceNotDeployedError,
  type DataflowExecutionState,
} from '@elaraai/e3-core';

// =============================================================================
// Cloud Dataflow Notes
// =============================================================================
// The cloud implementation uses Step Functions for dataflow execution.
// We must match the e3-api-server's API contract exactly:
// - dataflowStart: Returns NullType (202 Accepted, no body)
// - dataflowExecute: Returns ApiTypes.DataflowResultType
// - dataflowExecution: Returns ApiTypes.DataflowExecutionStateType

// Auth routes
import { createDiscoveryRoutes, createDeviceFlowRoutes, extractIdentity } from './auth/index.js';
import { WhoamiResponseType } from '@elaraai/e3-admin-types';

// Admin routes
import { createAdminRoutes } from './admin-routes.js';

// Schedule routes
import { createScheduleRoutes, createScheduleListRoute } from './schedule-routes.js';

// Task config routes
import { createTaskConfigRoutes } from './task-config-routes.js';

// Authorization middleware
import { createAuthzMiddleware } from './authz-middleware.js';

// e3-api-server routes, types, and BEAST2 utilities
import {
  createRepositoryRoutes,
  createPackageRoutes,
  createWorkspaceRoutes,
  createDatasetRoutes,
  createTaskRoutes,
  createExecutionRoutes,
} from '@elaraai/e3-api-server/routes';
import { sendSuccess, sendError, sendSuccessWithStatus, decodeBody } from '@elaraai/e3-api-server/beast2';
import { ApiTypes } from '@elaraai/e3-api-server';

// Helper to create internal API errors
const internalError = (message: string) => variant('internal', { message });

// Initialize AWS clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const sfn = new SFNClient({});

// State machine ARNs and table name (set by CDK)
const GC_STATE_MACHINE_ARN = process.env.GC_STATE_MACHINE_ARN;
const DATAFLOW_STATE_MACHINE_ARN = process.env.DATAFLOW_STATE_MACHINE_ARN;
const _TABLE_NAME = process.env.TABLE_NAME!;

// Initialize storage
const storage = new S3DynamoStorage(
  s3,
  dynamo,
  process.env.BUCKET_NAME!,
  process.env.TABLE_NAME!
);

// Get DynamoRefStore for repo management (cloud-specific methods)
const refStore = storage.refs as DynamoRefStore;

// Initialize ACL store for repository user management
const aclStore = new DynamoAclStore(dynamo, process.env.TABLE_NAME!);

// Initialize schedule store for workspace schedule management
const scheduleStore = new DynamoScheduleStore(dynamo, process.env.TABLE_NAME!);

// Initialize task config store for per-task compute/timeout configuration
const taskConfigStore = new DynamoTaskConfigStore(dynamo, process.env.TABLE_NAME!);

// Initialize EventBridge Scheduler client
const schedulerClient = new SchedulerClient({});

// In cloud mode, repo name IS the path (used as S3 prefix and DynamoDB partition key)
const getRepoPath = (repo: string) => repo;

/**
 * Delete all EventBridge Scheduler schedules for a repo.
 * Reads schedule records from DynamoDB to get scheduler names, then deletes them.
 */
async function deleteSchedulesForRepo(repo: string): Promise<void> {
  const schedulerGroupName = process.env.SCHEDULER_GROUP_NAME;
  if (!schedulerGroupName) return;

  const schedules = await scheduleStore.listForRepo(repo);
  for (const schedule of schedules) {
    try {
      await schedulerClient.send(new DeleteScheduleCommand({
        Name: schedule.schedulerName,
        GroupName: schedulerGroupName,
      }));
    } catch (err) {
      if (!(err instanceof ResourceNotFoundException)) {
        console.error(`Failed to delete EventBridge schedule ${schedule.schedulerName}:`, err);
      }
    }
  }
  await scheduleStore.deleteAllForRepo(repo);
}

/**
 * Delete a single workspace's EventBridge Scheduler schedule.
 */
async function deleteScheduleForWorkspace(repo: string, workspace: string): Promise<void> {
  const schedulerGroupName = process.env.SCHEDULER_GROUP_NAME;
  if (!schedulerGroupName) return;

  const schedule = await scheduleStore.get(repo, workspace);
  if (schedule) {
    try {
      await schedulerClient.send(new DeleteScheduleCommand({
        Name: schedule.schedulerName,
        GroupName: schedulerGroupName,
      }));
    } catch (err) {
      if (!(err instanceof ResourceNotFoundException)) {
        console.error(`Failed to delete EventBridge schedule ${schedule.schedulerName}:`, err);
      }
    }
    await scheduleStore.delete(repo, workspace);
  }
}

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
// Identity (Whoami)
// ============================================================

// GET /api/whoami - Get current user identity
// Requires JWT authentication; returns identity from Cognito claims
app.get('/api/whoami', (c) => {
  // Access raw API Gateway event from Hono's Lambda bindings
  // The event is available via c.env.event when using hono/aws-lambda
  const env = c.env as { event: unknown };
  const identity = extractIdentity(env.event as Parameters<typeof extractIdentity>[0]);

  if (!identity) {
    // This shouldn't happen since route requires JWT, but handle it gracefully
    return c.json({ error: 'unauthorized', message: 'Unable to extract identity from token' }, 401);
  }

  return sendSuccess(WhoamiResponseType, {
    sub: identity.sub,
    email: identity.email ? some(identity.email) : none,
    name: identity.name ? some(identity.name) : none,
    isAdmin: identity.isAdmin,
  });
});

// ============================================================
// Admin Routes (repository user management)
// ============================================================
app.route('/', createAdminRoutes(aclStore, refStore));

// ============================================================
// Schedule Routes (workspace schedule management)
// ============================================================
app.route('/api/repos/:repo/workspaces/:ws/schedule', createScheduleRoutes(aclStore, scheduleStore, refStore, schedulerClient));
app.route('/api/repos/:repo/schedules', createScheduleListRoute(aclStore, scheduleStore));

// ============================================================
// Authorization Middleware (for all repo routes)
// ============================================================
// Mount authz middleware for all /api/repos/* routes
// This checks user has member/owner access before handlers execute
// Note: PUT /api/repos/:repo (create) and /api/repos/:repo/users/* are excluded
app.use('/api/repos/*', createAuthzMiddleware(aclStore));

// ============================================================
// Task Config Routes (per-task compute size configuration)
// ============================================================
app.route('/api/repos/:repo/workspaces/:ws/task-configs', createTaskConfigRoutes(taskConfigStore, storage));

// ============================================================
// Repository Management (BEAST2 format for e3-cli compatibility)
// ============================================================

// GET /api/repos - List repositories accessible to the user
// Returns: ArrayType(StringType)
// - Admins see all repositories
// - Regular users see only repos they have access to
app.get('/api/repos', async (c) => {
  // Extract identity from API Gateway event
  const env = c.env as { event: unknown };
  const identity = extractIdentity(env.event as Parameters<typeof extractIdentity>[0]);

  try {
    // Unauthenticated users see no repos
    if (!identity) {
      return sendSuccess(ArrayType(StringType), []);
    }

    // Admins see all repos
    if (identity.isAdmin) {
      const repos = await refStore.listRepos();
      return sendSuccess(ArrayType(StringType), repos);
    }

    // Regular users see only repos they have access to
    const repos = await aclStore.listReposForUser(identity.sub);
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

  // Extract identity for auto-adding creator as owner
  const env = c.env as { event: unknown };
  const identity = extractIdentity(env.event as Parameters<typeof extractIdentity>[0]);

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

    // Auto-add creator as owner
    if (identity) {
      await aclStore.addUser(repo, {
        userId: identity.sub,
        email: identity.email ?? 'unknown',
        name: identity.name ? some(identity.name) : none,
        role: variant('owner', null),
        addedBy: identity.sub,
        addedAt: new Date().toISOString(),
      });
      console.log(`Added ${identity.email ?? identity.sub} as owner of repo '${repo}'`);
    }

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

// DELETE /api/repos/:repo - Delete a repository (synchronous)
// Returns: NullType (void) - deletion completes synchronously
app.delete('/api/repos/:repo', async (c) => {
  const repo = c.req.param('repo');

  // Extract identity for audit logging
  const env = c.env as { event: unknown };
  const identity = extractIdentity(env.event as Parameters<typeof extractIdentity>[0]);

  try {
    // Check if repo exists and get its status
    const metadata = await refStore.getRepoMetadata(repo);
    if (!metadata) {
      return sendError(NullType, variant('repository_not_found', { repo }));
    }

    // If already deleting, return success (idempotent)
    if (metadata.status === 'deleting') {
      return sendSuccess(NullType, null);
    }

    // Block deletion during GC or creation
    if (metadata.status === 'gc') {
      return sendError(NullType, internalError(`Repository '${repo}' is currently running GC. Please wait for GC to complete.`));
    }
    if (metadata.status === 'creating') {
      return sendError(NullType, internalError(`Repository '${repo}' is still being created. Please wait.`));
    }

    // 1. Mark as 'deleting'
    await refStore.setRepoStatus(repo, 'active', 'deleting');

    // 2. Delete ACL entries
    await aclStore.deleteAllForRepo(repo);

    // 2b. Delete schedules (DynamoDB + EventBridge Scheduler)
    await deleteSchedulesForRepo(repo);

    // 2c. Delete task configs
    await taskConfigStore.deleteAllForRepo(repo);

    // 3. Delete refs synchronously
    let cursor: string | undefined;
    do {
      const result = await storage.repos.deleteRefsBatch(repo, cursor);
      cursor = result.status === 'continue' ? result.cursor : undefined;
    } while (cursor);

    // 4. Objects cleaned up by GC later (orphaned S3 versions are handled by GC cleanup)

    // 5. Remove repo metadata
    await storage.repos.remove(repo);

    console.log(`Repository '${repo}' deleted successfully, deletedBy=${identity?.sub ?? 'unknown'}, deletedByEmail=${identity?.email ?? 'unknown'}`);
    return sendSuccess(NullType, null);
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

  // Extract identity for audit logging
  const env = c.env as { event: unknown };
  const identity = extractIdentity(env.event as Parameters<typeof extractIdentity>[0]);

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

    console.log(`Started GC state machine for repo ${repo}: ${executionName}, startedBy=${identity?.sub ?? 'unknown'}, startedByEmail=${identity?.email ?? 'unknown'}`);

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

          // GC completed with stats from sweep phase
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
// Cloud Dataflow Endpoints (override e3-api-server's local execution)
// ============================================================

// POST /api/repos/:repo/workspaces/:ws/dataflow - Start dataflow execution via Step Functions
// Returns 202 Accepted with null body (matches e3-api-server's API contract)
app.post('/api/repos/:repo/workspaces/:ws/dataflow', async (c) => {
  const repo = c.req.param('repo');
  const workspace = c.req.param('ws');

  if (!DATAFLOW_STATE_MACHINE_ARN) {
    return sendError(NullType, internalError('Dataflow execution not available - state machine not configured'));
  }

  // Decode BEAST2-encoded body to get force flag and filter
  const body = await decodeBody(c, ApiTypes.DataflowRequestType);
  const force = body.force;
  const filter = body.filter.type === 'some' ? body.filter.value : undefined;

  // Validate workspace exists and is deployed BEFORE acquiring lock
  // This prevents lock leak if workspace is missing/undeployed
  let graph: { tasks: Array<{ name: string; hash: string; inputs: string[]; output: string; dependsOn: string[] }> };
  try {
    graph = await dataflowGetGraph(storage, repo, workspace);
  } catch (err) {
    if (err instanceof WorkspaceNotFoundError) {
      return sendError(NullType, variant('workspace_not_found', { workspace }));
    }
    if (err instanceof WorkspaceNotDeployedError) {
      return sendError(NullType, variant('workspace_not_deployed', { workspace }));
    }
    throw err;
  }

  // Validate filter task exists in the graph
  if (filter) {
    const taskExists = graph.tasks.some(t => t.name === filter);
    if (!taskExists) {
      return sendError(NullType, variant('task_not_found', { task: filter }));
    }
  }

  // Acquire workspace lock to prevent concurrent executions
  const lock = await storage.locks.acquire(
    repo,
    `workspace/${workspace}`,
    variant('dataflow', null),
    { wait: false }  // Don't wait, fail immediately if locked
  );

  if (!lock) {
    // Return workspace_locked error - the error code contains "lock" which tests check for
    return sendError(NullType, variant('workspace_locked', {
      workspace,
      holder: variant('unknown', null),
    }));
  }

  try {
    // Get next execution ID from NEW STATE/ schema
    const execId = await storage.executions.nextExecutionId(repo, workspace);

    // Create initial execution state in NEW STATE/ schema
    // This ensures polling can see the execution immediately, before Step Functions runs
    const initialState: DataflowExecutionState = {
      id: execId,
      repo,
      workspace,
      startedAt: new Date(),
      concurrency: 4n,
      force: force ?? false,
      filter: filter ? some(filter) : none,
      graph: none,
      graphHash: none,
      tasks: new Map(),
      executed: 0n,
      cached: 0n,
      failed: 0n,
      skipped: 0n,
      status: 'running',
      completedAt: none,
      error: none,
      events: [],
      eventSeq: 0n,
    };
    await storage.executions.create(initialState);

    // Generate runId for DataflowRun tracking
    const runId = uuidv7();

    // Generate unique Step Functions execution name
    const sfnExecutionId = randomUUID();
    const executionName = `dataflow-${repo}-${workspace}-${sfnExecutionId}`.slice(0, 80);

    // Start the dataflow state machine with the execution ID and runId
    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: DATAFLOW_STATE_MACHINE_ARN,
        name: executionName,
        input: JSON.stringify({
          repo,
          workspace,
          executionId: parseInt(execId, 10), // Convert to number for backward compatibility
          force, // Pass force flag to state machine
          forceTasks: [], // Empty for manual runs (scheduled runs populate this)
          filter, // Pass filter to state machine (undefined omitted by JSON.stringify)
          runId, // UUIDv7 for DataflowRun tracking
        }),
      })
    );

    // DON'T release lock here - finalize-execution will release it
    // Return 202 Accepted with null body (matches e3-api-server)
    return sendSuccessWithStatus(NullType, null, 202);
  } catch (err) {
    // Release lock on error
    await lock.release();
    console.error('Failed to start dataflow:', err);
    return sendError(NullType, internalError('Failed to start dataflow execution'));
  }
});

// POST /api/repos/:repo/workspaces/:ws/dataflow/cancel - Cancel running dataflow execution
// Returns NullType
app.post('/api/repos/:repo/workspaces/:ws/dataflow/cancel', async (c) => {
  const repo = c.req.param('repo');
  const workspace = c.req.param('ws');

  try {
    // Get latest execution state
    const state = await storage.executions.readLatest(repo, workspace);

    if (!state) {
      return sendError(NullType, internalError('No execution found for this workspace'));
    }

    // Check if execution is still running
    if (state.status !== 'running') {
      return sendError(NullType, internalError(`Cannot cancel execution in '${state.status}' state`));
    }

    // Use stepCancel to update state
    stepCancel(state, 'User requested cancellation');
    await storage.executions.update(state);

    // Release workspace lock since execution is being cancelled
    await storage.locks.forceRelease(repo, `workspace/${workspace}`);

    console.log(`Cancelled execution ${state.id} for ${repo}/${workspace}`);
    return sendSuccess(NullType, null);
  } catch (err) {
    console.error('Failed to cancel dataflow:', err);
    return sendError(NullType, internalError('Failed to cancel dataflow execution'));
  }
});

// GET /api/repos/:repo/workspaces/:ws/dataflow/execution - Get dataflow execution status
// Returns ApiTypes.DataflowExecutionStateType to match e3-api-server contract
app.get('/api/repos/:repo/workspaces/:ws/dataflow/execution', async (c) => {
  const repo = c.req.param('repo');
  const workspace = c.req.param('ws');

  // Get query params for pagination
  const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!, 10) : 0;
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;

  try {
    // Get latest execution state from ExecutionStateStore
    const state = await storage.executions.readLatest(repo, workspace);

    if (!state) {
      return sendError(ApiTypes.DataflowExecutionStateType, variant('execution_not_found', { task: workspace }));
    }

    // Calculate duration from timestamps
    const completedAt = state.completedAt.type === 'some' ? state.completedAt.value : null;
    const durationMs = completedAt
      ? completedAt.getTime() - state.startedAt.getTime()
      : Date.now() - state.startedAt.getTime();

    // Count only API-visible events for totalEvents (some core events have no API equivalent)
    const allEvents = state.events;
    let totalApiEvents = 0;
    for (const event of allEvents) {
      if (coreEventToApiEvent(event) !== null) {
        totalApiEvents++;
      }
    }
    const slicedEvents = limit !== undefined
      ? allEvents.slice(offset, offset + limit)
      : allEvents.slice(offset);

    // Use coreStateToApiState for conversion
    const apiState = coreStateToApiState(state, slicedEvents, totalApiEvents, durationMs);

    // Convert to the API response format with variant types
    const statusVariant = apiState.status === 'running'
      ? variant('running', null)
      : apiState.status === 'completed'
        ? variant('completed', null)
        : apiState.status === 'aborted'
          ? variant('aborted', null)
          : variant('failed', null);

    // Convert API events to variant format expected by sendSuccess
    const events = apiState.events.map(e => {
      switch (e.type) {
        case 'start':
          return variant('start', {
            task: e.task,
            timestamp: e.timestamp,
          });
        case 'complete':
          return variant('complete', {
            task: e.task,
            timestamp: e.timestamp,
            duration: e.duration ?? 0,
          });
        case 'cached':
          return variant('cached', {
            task: e.task,
            timestamp: e.timestamp,
          });
        case 'failed':
          return variant('failed', {
            task: e.task,
            timestamp: e.timestamp,
            duration: e.duration ?? 0,
            exitCode: e.exitCode ?? 0n,
          });
        case 'error':
          return variant('error', {
            task: e.task,
            timestamp: e.timestamp,
            message: e.message ?? 'Unknown error',
          });
        case 'input_unavailable':
          return variant('input_unavailable', {
            task: e.task,
            timestamp: e.timestamp,
            reason: e.reason ?? 'Upstream task failed',
          });
      }
    });

    return sendSuccess(ApiTypes.DataflowExecutionStateType, {
      status: statusVariant,
      startedAt: state.startedAt.toISOString(),
      completedAt: apiState.completedAt ? some(apiState.completedAt) : none,
      summary: apiState.summary ? some({
        executed: apiState.summary.executed,
        cached: apiState.summary.cached,
        failed: apiState.summary.failed,
        skipped: apiState.summary.skipped,
        duration: apiState.summary.duration,
      }) : none,
      events,
      totalEvents: apiState.totalEvents,
    });
  } catch (err) {
    console.error('Failed to get dataflow execution:', err);
    return sendError(ApiTypes.DataflowExecutionStateType, internalError('Failed to get dataflow execution status'));
  }
});

// ============================================================
// e3-api-server Routes
// ============================================================

// Note: GC endpoints are handled above; other repository routes (including status) pass through
app.route('/api/repos/:repo', createRepositoryRoutes(storage, getRepoPath) as any);

// Package routes: /api/repos/:repo/packages/*
app.route('/api/repos/:repo/packages', createPackageRoutes(storage, getRepoPath) as any);

// Intercept workspace deploy to clean up orphaned task configs after e3-api-server handles it
app.post('/api/repos/:repo/workspaces/:ws/deploy', async (c, next) => {
  await next();  // Let e3-api-server handle deploy first

  if (c.res.status >= 200 && c.res.status < 300) {
    const repo = c.req.param('repo')!;
    const ws = c.req.param('ws')!;
    try {
      const graph = await dataflowGetGraph(storage, repo, ws);
      const deployedTaskNames = new Set(graph.tasks.map(t => t.name));
      const computeConfigs = await taskConfigStore.listCompute(repo, ws);
      const timeoutConfigs = await taskConfigStore.listTimeout(repo, ws);
      const orphanedCompute = Object.keys(computeConfigs).filter(t => !deployedTaskNames.has(t));
      const orphanedTimeout = Object.keys(timeoutConfigs).filter(t => !deployedTaskNames.has(t));
      if (orphanedCompute.length > 0) await taskConfigStore.deleteComputeBatch(repo, ws, orphanedCompute);
      if (orphanedTimeout.length > 0) await taskConfigStore.deleteTimeoutBatch(repo, ws, orphanedTimeout);
      if (orphanedCompute.length > 0 || orphanedTimeout.length > 0) {
        console.log('Orphan cleanup', { repo, workspace: ws, orphanedCompute, orphanedTimeout });
      }
    } catch (err) {
      console.error('Orphan cleanup failed:', err);  // Don't fail the deploy
    }
  }
});

// Intercept workspace deletion to clean up schedules and task configs before e3-api-server handles it
app.delete('/api/repos/:repo/workspaces/:ws', async (c, next) => {
  const repo = c.req.param('repo');
  const workspace = c.req.param('ws');
  await deleteScheduleForWorkspace(repo, workspace);
  await taskConfigStore.deleteAllForWorkspace(repo, workspace);
  return next();
});

// Workspace routes: /api/repos/:repo/workspaces/*
app.route('/api/repos/:repo/workspaces', createWorkspaceRoutes(storage, getRepoPath) as any);

// Dataset routes: /api/repos/:repo/workspaces/:ws/datasets/*
app.route('/api/repos/:repo/workspaces/:ws/datasets', createDatasetRoutes(storage, getRepoPath) as any);

// Task routes: /api/repos/:repo/workspaces/:ws/tasks/*
app.route('/api/repos/:repo/workspaces/:ws/tasks', createTaskRoutes(storage, getRepoPath) as any);

// Execution/Dataflow routes: /api/repos/:repo/workspaces/:ws/dataflow/*
// Note: POST and /execution are overridden above for cloud Step Functions execution
// Other routes (GET graph, logs) pass through to e3-api-server
app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(storage, getRepoPath) as any);

// ============================================================
// Export Lambda Handler
// ============================================================

const honoHandler = handle(app);

export const handler = async (event: any, context: LambdaContext) => {
  // Track request ID for lock service
  setLambdaRequestId(context.awsRequestId);
  return honoHandler(event, context);
};
