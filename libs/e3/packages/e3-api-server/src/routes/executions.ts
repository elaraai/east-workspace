/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { NullType, variant } from '@elaraai/east';
import type { StorageBackend } from '@elaraai/e3-core';
import {
  startDataflow,
  getDataflowStatus,
  getDataflowGraph,
  getTaskLogs,
  getDataflowExecution,
  cancelDataflow,
} from '../handlers/dataflow.js';
import { decodeBody, sendError } from '../beast2.js';
import { DataflowRequestType } from '../types.js';
import type { GetRunner } from './functions.js';

/**
 * The routes of a workspace's dataflow: start, poll, cancel, its graph and
 * its tasks' logs.
 *
 * @param storage - Storage backend
 * @param getRepoPath - A repository's path from its name
 * @param dataflow - How the server runs a dataflow: the runner its tasks and
 *   units run on, which holds the server's budget, and the tasks and units
 *   the loop keeps in flight. Without it the server starts no dataflow: a
 *   host that runs them elsewhere, as e3-cloud does, mounts these routes for
 *   the rest.
 * @returns The routes
 */
export function createExecutionRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  dataflow?: { getRunner: GetRunner; width: number },
) {
  const app = new Hono();

  // POST /api/repos/:repo/workspaces/:ws/dataflow - Start dataflow execution (non-blocking)
  app.post('/', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;

    if (dataflow === undefined) {
      return sendError(NullType, variant('internal', { message: 'this server starts no dataflow: its host runs them' }));
    }
    const body = await decodeBody(c, DataflowRequestType);
    const filter = body.filter.type === 'some' ? body.filter.value : undefined;

    return startDataflow(storage, repoPath, ws, {
      runner: dataflow.getRunner(repoPath),
      width: dataflow.width,
      force: body.force,
      filter,
      verbose: c.req.query('verbose') === '1',
    });
  });

  // GET /api/repos/:repo/workspaces/:ws/dataflow - Get workspace status (for polling)
  app.get('/', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    return getDataflowStatus(storage, repoPath, ws);
  });

  // GET /api/repos/:repo/workspaces/:ws/dataflow/graph - Get dependency graph
  app.get('/graph', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    return getDataflowGraph(storage, repoPath, ws);
  });

  // GET /api/repos/:repo/workspaces/:ws/dataflow/logs/:task - Get task logs
  app.get('/logs/:task', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    const taskName = c.req.param('task')!;

    // Get query params
    const stream = (c.req.query('stream') as 'stdout' | 'stderr') || 'stdout';
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const limit = parseInt(c.req.query('limit') || '65536', 10);

    return getTaskLogs(storage, repoPath, ws, taskName, stream, offset, limit);
  });

  // GET /api/repos/:repo/workspaces/:ws/dataflow/execution - Get execution state (for polling)
  app.get('/execution', (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;

    // Get query params for pagination
    const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!, 10) : undefined;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;

    return getDataflowExecution(repoPath, ws, { offset, limit });
  });

  // POST /api/repos/:repo/workspaces/:ws/dataflow/cancel - Cancel running execution
  app.post('/cancel', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;

    return cancelDataflow(repoPath, ws);
  });

  return app;
}
