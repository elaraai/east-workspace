/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Lambda API Handler for e3 Cloud Platform
 *
 * Composition root: constructs AWS clients and stores, builds concrete
 * implementations, and mounts all route modules.
 */

import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import type { LambdaContext } from 'hono/aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SFNClient } from '@aws-sdk/client-sfn';
import { SchedulerClient } from '@aws-sdk/client-scheduler';
import { some, none } from '@elaraai/east';
import {
  S3DynamoStorage,
  setLambdaRequestId,
  DynamoAclStore,
  DynamoScheduleStore,
  DynamoTaskConfigStore,
} from '../storage/index.js';
import { dataflowGetGraph } from '@elaraai/e3-core';
import { WhoamiResponseType } from '@elaraai/e3-cloud-types';
import { sendSuccess } from '@elaraai/e3-api-server/beast2';

// Auth routes (AWS-specific)
import { CognitoIdentityBackend } from '../services/cognito-identity.js';
import { createDiscoveryRoutes } from '../services/cognito-discovery.js';
import { createDeviceFlowRoutes } from '../services/cognito-device-flow.js';

// Cloud-agnostic route modules
import {
  createAdminRoutes,
  createScheduleRoutes,
  createScheduleListRoute,
  createTaskConfigRoutes,
  createAuthzMiddleware,
  createRepoRoutes,
  deleteScheduleForWorkspace,
  createGcRoutes,
  createDataflowRoutes,
} from '@elaraai/e3-cloud-core/routes';

// AWS implementations
import { SfnDataflowOrchestrator } from '../services/sfn-dataflow-orchestrator.js';
import { SfnGcOrchestrator } from '../services/sfn-gc-orchestrator.js';
import { EventBridgeSchedulerService } from '../services/eventbridge-scheduler.js';

// e3-api-server routes
import {
  createRepositoryRoutes,
  createPackageRoutes,
  createWorkspaceRoutes,
  createDatasetRoutes,
  createTaskRoutes,
  createExecutionRoutes,
} from '@elaraai/e3-api-server/routes';

// ============================================================
// AWS Client & Store Initialization (Lambda cold start)
// ============================================================

const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const sfn = new SFNClient({});
const schedulerClient = new SchedulerClient({});

const GC_STATE_MACHINE_ARN = process.env.GC_STATE_MACHINE_ARN;
const DATAFLOW_STATE_MACHINE_ARN = process.env.DATAFLOW_STATE_MACHINE_ARN;
const SCHEDULER_GROUP_NAME = process.env.SCHEDULER_GROUP_NAME;

const storage = new S3DynamoStorage(
  s3, dynamo,
  process.env.BUCKET_NAME!,
  process.env.TABLE_NAME!
);

const repoManager = storage.repoManager;
const aclStore = new DynamoAclStore(dynamo, process.env.TABLE_NAME!);
const scheduleStore = new DynamoScheduleStore(dynamo, process.env.TABLE_NAME!);
const taskConfigStore = new DynamoTaskConfigStore(dynamo, process.env.TABLE_NAME!);

// In cloud mode, repo name IS the path (used as S3 prefix and DynamoDB partition key)
const getRepoPath = (repo: string) => repo;

// ============================================================
// Concrete Implementations
// ============================================================

const identityBackend = new CognitoIdentityBackend();

const schedulerService = SCHEDULER_GROUP_NAME
  ? new EventBridgeSchedulerService(
      schedulerClient,
      SCHEDULER_GROUP_NAME,
      process.env.SCHEDULER_ROLE_ARN!,
      process.env.SCHEDULE_TRIGGER_FN_ARN!,
      process.env.SCHEDULE_DLQ_ARN,
    )
  : null;

const orchestrator = DATAFLOW_STATE_MACHINE_ARN
  ? new SfnDataflowOrchestrator(sfn, DATAFLOW_STATE_MACHINE_ARN)
  : null;

const gcOrchestrator = GC_STATE_MACHINE_ARN
  ? new SfnGcOrchestrator(sfn, GC_STATE_MACHINE_ARN)
  : null;

// ============================================================
// App Assembly
// ============================================================

const app = new Hono();

// Health Check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Auth Routes (public, no JWT required)
app.route('/', createDiscoveryRoutes());
app.route('/', createDeviceFlowRoutes());

// GET /api/whoami - Get current user identity
app.get('/api/whoami', (c) => {
  const env = c.env as { event: unknown };
  const identity = identityBackend.getIdentity(env.event);

  if (!identity) {
    return c.json({ error: 'unauthorized', message: 'Unable to extract identity from token' }, 401);
  }

  return sendSuccess(WhoamiResponseType, {
    sub: identity.sub,
    email: identity.email ? some(identity.email) : none,
    name: identity.name ? some(identity.name) : none,
    isAdmin: identity.isAdmin,
  });
});

// Admin Routes
app.route('/', createAdminRoutes(aclStore, repoManager, identityBackend));

// Schedule Routes
if (schedulerService) {
  app.route('/api/repos/:repo/workspaces/:ws/schedule', createScheduleRoutes(aclStore, scheduleStore, storage.refs, schedulerService, identityBackend));
}
app.route('/api/repos/:repo/schedules', createScheduleListRoute(aclStore, scheduleStore, identityBackend));

// Authorization Middleware (for all repo routes)
app.use('/api/repos/*', createAuthzMiddleware(aclStore, identityBackend));

// Task Config Routes
app.route('/api/repos/:repo/workspaces/:ws/task-configs', createTaskConfigRoutes(taskConfigStore, storage.locks));

// Repository Lifecycle Routes
app.route('/', createRepoRoutes({
  repoManager,
  aclStore,
  scheduleStore,
  taskConfigStore,
  schedulerService,
  repoStore: storage.repos,
  identityBackend,
}));

// GC Routes
app.route('/', createGcRoutes({
  repoManager,
  gc: gcOrchestrator ?? undefined,
  identityBackend,
}));

// Dataflow Routes (only if orchestrator is configured)
if (orchestrator) {
  app.route('/', createDataflowRoutes({
    storage,
    orchestrator,
  }));
}

// ============================================================
// e3-api-server Pass-through Routes
// ============================================================

app.route('/api/repos/:repo', createRepositoryRoutes(storage, getRepoPath) as any);
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
  await deleteScheduleForWorkspace(repo, workspace, scheduleStore, schedulerService);
  await taskConfigStore.deleteAllForWorkspace(repo, workspace);
  return next();
});

app.route('/api/repos/:repo/workspaces', createWorkspaceRoutes(storage, getRepoPath) as any);
app.route('/api/repos/:repo/workspaces/:ws/datasets', createDatasetRoutes(storage, getRepoPath) as any);
app.route('/api/repos/:repo/workspaces/:ws/tasks', createTaskRoutes(storage, getRepoPath) as any);
app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(storage, getRepoPath) as any);

// ============================================================
// Export Lambda Handler
// ============================================================

const honoHandler = handle(app);

export const handler = async (event: any, context: LambdaContext) => {
  setLambdaRequestId(context.awsRequestId);
  return honoHandler(event, context);
};
