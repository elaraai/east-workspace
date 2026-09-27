/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import type { Budget, DataflowOrchestrator, ExecutionStateStore, StorageBackend } from '@elaraai/e3-core';
import {
  startDataflow,
  getDataflowStatus,
  getDataflowGraph,
  getTaskLogs,
  getDataflowExecution,
  getDataflowBudget,
  cancelDataflow,
} from '../handlers/dataflow.js';
import { decodeBody } from '../beast2.js';
import { DataflowRequestType } from '../types.js';
import type { GetRunner } from './functions.js';

/**
 * The seams the dataflow routes go through, which the host that mounts them
 * gives: what runs a repository's dataflows, and where their runs are kept.
 * A local server's are a LocalOrchestrator and a FileStateStore for each
 * repository; a cloud's run its dataflows on its own compute, and keep their
 * state in its own store.
 */
export interface DataflowSeams {
  /** The runner a repository's tasks and units run on, which the status also
   *  asks whether an execution recorded running can still finish */
  getRunner: GetRunner;
  /** The orchestrator that runs a repository's dataflows, and cancels one */
  getOrchestrator: (repoPath: string) => DataflowOrchestrator;
  /** The store a repository's runs keep their state in, which a poll and a
   *  cancel read: the one the orchestrator writes */
  getStateStore: (repoPath: string) => ExecutionStateStore;
  /** The tasks and units the loop keeps in flight; the orchestrator's own
   *  default when absent */
  width?: number;
  /** The budget the runner holds, which the poll and the budget route serve;
   *  absent for a host whose runners hold none */
  budget?: Budget;
}

/**
 * The routes of a workspace's dataflow: start, poll, cancel, its graph, its
 * tasks' logs, and the budget a run gets.
 *
 * @param storage - Storage backend
 * @param getRepoPath - A repository's path from its name
 * @param seams - What runs a repository's dataflows, and where their runs are
 *   kept: a poll or a cancel reads the run's state from the store, whichever
 *   instance answers it
 * @returns The routes
 */
export function createExecutionRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  seams: DataflowSeams,
) {
  const app = new Hono();

  // POST /api/repos/:repo/workspaces/:ws/dataflow - Start dataflow execution (non-blocking)
  app.post('/', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;

    const body = await decodeBody(c, DataflowRequestType);
    const filter = body.filter.type === 'some' ? body.filter.value : undefined;

    return startDataflow(storage, seams.getOrchestrator(repoPath), repoPath, ws, {
      runner: seams.getRunner(repoPath),
      ...(seams.width !== undefined && { width: seams.width }),
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
    return getDataflowStatus(storage, seams.getRunner(repoPath), repoPath, ws);
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

    return getDataflowExecution(seams.getStateStore(repoPath), seams.getOrchestrator(repoPath), repoPath, ws, { offset, limit }, seams.budget);
  });

  // GET /api/repos/:repo/workspaces/:ws/dataflow/budget - The budget a run gets
  app.get('/budget', () => getDataflowBudget(seams.budget));

  // POST /api/repos/:repo/workspaces/:ws/dataflow/cancel - Cancel running execution
  app.post('/cancel', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;

    return cancelDataflow(seams.getStateStore(repoPath), seams.getOrchestrator(repoPath), repoPath, ws);
  });

  return app;
}
