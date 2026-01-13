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
import { StringType, NullType, ArrayType, variant } from '@elaraai/east';

// Auth routes
import { createDiscoveryRoutes, createDeviceFlowRoutes } from './auth/index.js';

// e3-api-server routes and BEAST2 utilities
import {
  createRepositoryRoutes,
  createPackageRoutes,
  createWorkspaceRoutes,
  createDatasetRoutes,
  createTaskRoutes,
  createExecutionRoutes,
} from '@elaraai/e3-api-server/routes';
import { sendSuccess, sendError, sendSuccessWithStatus } from '@elaraai/e3-api-server/beast2';

// Helper to create internal API errors
const internalError = (message: string) => variant('internal', { message });

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
    await refStore.createRepo(repo);
    return sendSuccessWithStatus(StringType, repo, 201);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return sendError(StringType, internalError(`Repository '${repo}' already exists`));
    }
    console.error('Failed to create repo:', err);
    return sendError(StringType, internalError('Failed to create repository'));
  }
});

// DELETE /api/repos/:repo - Delete a repository
// Returns: NullType
app.delete('/api/repos/:repo', async (c) => {
  const repo = c.req.param('repo');

  try {
    // Check if repo exists
    const exists = await refStore.repoExists(repo);
    if (!exists) {
      return sendError(NullType, internalError(`Repository '${repo}' not found`));
    }

    // Delete repo and all its items
    await refStore.deleteRepo(repo);

    // TODO: Also delete S3 objects with prefix {repo}/

    return sendSuccess(NullType, null);
  } catch (err) {
    console.error('Failed to delete repo:', err);
    return sendError(NullType, internalError('Failed to delete repository'));
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
