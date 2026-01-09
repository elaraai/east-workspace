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
import { S3DynamoStorage, setLambdaRequestId, DynamoRefStore } from '@elaraai/e3-storage';

// Auth routes
import { createDiscoveryRoutes, createDeviceFlowRoutes } from './auth/index.js';

// e3-api-server routes
import {
  createRepositoryRoutes,
  createPackageRoutes,
  createWorkspaceRoutes,
  createDatasetRoutes,
  createTaskRoutes,
  createExecutionRoutes,
} from '@elaraai/e3-api-server/routes';

// Initialize AWS clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});

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
// Repository Management
// ============================================================

// GET /api/repos - List all repositories
app.get('/api/repos', async (c) => {
  try {
    const repos = await refStore.listRepos();
    return c.json({ repos });
  } catch (err) {
    console.error('Failed to list repos:', err);
    return c.json({ error: 'Failed to list repositories' }, 500);
  }
});

// PUT /api/repos/:repo - Create a repository
app.put('/api/repos/:repo', async (c) => {
  const repo = c.req.param('repo');

  // Validate repo name (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(repo)) {
    return c.json({ error: 'Invalid repository name. Use only letters, numbers, hyphens, and underscores.' }, 400);
  }

  try {
    await refStore.createRepo(repo);
    return c.json({ repo }, 201);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return c.json({ error: `Repository '${repo}' already exists` }, 409);
    }
    console.error('Failed to create repo:', err);
    return c.json({ error: 'Failed to create repository' }, 500);
  }
});

// DELETE /api/repos/:repo - Delete a repository
app.delete('/api/repos/:repo', async (c) => {
  const repo = c.req.param('repo');

  try {
    // Check if repo exists
    const exists = await refStore.repoExists(repo);
    if (!exists) {
      return c.json({ error: `Repository '${repo}' not found` }, 404);
    }

    // Delete repo and all its items
    await refStore.deleteRepo(repo);

    // TODO: Also delete S3 objects with prefix {repo}/

    return c.json({ deleted: true });
  } catch (err) {
    console.error('Failed to delete repo:', err);
    return c.json({ error: 'Failed to delete repository' }, 500);
  }
});

// ============================================================
// e3-api-server Routes
// ============================================================

// Repository status and GC: /api/repos/:repo/status, /api/repos/:repo/gc
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
