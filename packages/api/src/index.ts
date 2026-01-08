/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import type { LambdaContext } from 'hono/aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage, setLambdaRequestId } from '@elaraai/e3-storage';

// Initialize storage once at Lambda cold start
const storage = new S3DynamoStorage(
  new S3Client({}),
  new DynamoDBClient({}),
  process.env.BUCKET_NAME!,
  process.env.TABLE_NAME!
);

const app = new Hono();

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Repository-scoped routes: /repos/{repo}/api/...
app.get('/repos/:repo/api/workspaces', async (c) => {
  const repo = c.req.param('repo');
  const workspaces = await storage.refs.workspaceList(repo);
  return c.json({ repo, workspaces });
});

app.get('/repos/:repo/api/workspaces/:ws', async (c) => {
  const repo = c.req.param('repo');
  const ws = c.req.param('ws');
  const state = await storage.refs.workspaceRead(repo, ws);
  if (!state) {
    return c.json({ error: 'Workspace not found' }, 404);
  }
  // TODO: Decode workspace state using e3-core
  return c.json({ repo, workspace: ws, hasState: true });
});

app.post('/repos/:repo/api/workspaces/:ws/start', async (c) => {
  const repo = c.req.param('repo');
  const ws = c.req.param('ws');
  // TODO: Start Step Functions execution
  return c.json({ repo, workspace: ws, status: 'started' });
});

// Export Lambda handler with request ID tracking
const honoHandler = handle(app);

export const handler = async (event: any, context: LambdaContext) => {
  // Track request ID for lock service
  setLambdaRequestId(context.awsRequestId);
  return honoHandler(event, context);
};
