/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import type { StorageBackend } from '@elaraai/e3-core/portable';
import { listTasks, getTask, listExecutions } from '../handlers/tasks.js';
import { TASK_EXECUTIONS_PAGE_DEFAULT, TASK_EXECUTIONS_PAGE_MAX } from '../types.js';
import { wholeQuery } from './query.js';

export function createTaskRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string
) {
  const app = new Hono();

  // GET /api/repos/:repo/workspaces/:ws/tasks - List tasks
  app.get('/', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    return listTasks(storage, repoPath, ws);
  });

  // GET /api/repos/:repo/workspaces/:ws/tasks/:task - Get task details
  app.get('/:task', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    const taskName = c.req.param('task')!;
    return getTask(storage, repoPath, ws, taskName);
  });

  // GET /api/repos/:repo/workspaces/:ws/tasks/:task/executions[?limit=<n>&before=<executionId>] - A page
  // of a task's history: its runs, the latest first, at most `limit` of them —
  // TASK_EXECUTIONS_PAGE_DEFAULT unless given, and never more than
  // TASK_EXECUTIONS_PAGE_MAX — those before the run `before` names. A limit
  // that is not a positive integer is refused before any store is asked, and
  // an id that is no UUIDv7 by the store.
  app.get('/:task/executions', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    const taskName = c.req.param('task')!;
    const window = wholeQuery(c, { limit: 1 });
    if (window instanceof Response) return window;
    const before = c.req.query('before');
    return listExecutions(storage, repoPath, ws, taskName, {
      limit: Math.min(window.limit ?? TASK_EXECUTIONS_PAGE_DEFAULT, TASK_EXECUTIONS_PAGE_MAX),
      ...(before !== undefined && before !== '' && { before }),
    });
  });

  return app;
}
