/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Task Config Routes for e3 Cloud Platform
 *
 * Provides endpoints for per-task compute and timeout configuration:
 * - GET / — List all task configs (compute + timeout) for a workspace
 * - GET /compute — List all compute configs for a workspace
 * - GET /compute/:task — Get compute config for a task
 * - POST /compute — Batch set compute configs
 * - PUT /compute/:task — Set compute config for a task
 * - DELETE /compute/:task — Delete compute config for a task
 * - GET /timeout — List all timeout configs for a workspace
 * - GET /timeout/:task — Get timeout for a task (with compute-aware default)
 * - POST /timeout — Batch set timeout configs
 * - PUT /timeout/:task — Set timeout for a task
 * - DELETE /timeout/:task — Delete timeout config for a task
 */

import { Hono } from 'hono';
import { NullType, variant } from '@elaraai/east';
import {
  ComputeSizeType,
  ComputeConfigMapType,
  TaskTimeoutType,
  TimeoutConfigMapType,
  TaskConfigsType,
  TIMEOUT_MIN_MINUTES,
  TIMEOUT_MAX_MINUTES,
  DEFAULT_TIMEOUT_SERVERLESS,
  DEFAULT_TIMEOUT_FARGATE,
  type ComputeSize,
  type TaskTimeout,
} from '@elaraai/e3-cloud-types';
import { sendSuccess, sendError, decodeBody } from '@elaraai/e3-api-server/beast2';
import type { TaskConfigStore } from '../task-config-store.js';
import type { LockService } from '@elaraai/e3-core';

const internalError = (message: string) => variant('internal', { message });

/** Convert Record<string, T> to Map<string, T> for BEAST2 DictType serialization */
function recordToMap<T>(record: Record<string, T>): Map<string, T> {
  return new Map(Object.entries(record));
}

/** Validate timeout minutes is within allowed range. */
function validateTimeout(minutes: bigint): string | null {
  if (minutes < BigInt(TIMEOUT_MIN_MINUTES) || minutes > BigInt(TIMEOUT_MAX_MINUTES)) {
    return `Timeout must be between ${TIMEOUT_MIN_MINUTES} and ${TIMEOUT_MAX_MINUTES} minutes, got ${minutes}`;
  }
  return null;
}

/**
 * Create task config routes for per-task compute size and timeout management.
 *
 * Mounted at /api/repos/:repo/workspaces/:ws/task-configs.
 * Auth is handled by the authz middleware on /api/repos/*.
 */
export function createTaskConfigRoutes(
  taskConfigStore: TaskConfigStore,
  locks: LockService,
) {
  const app = new Hono();

  // GET / — List all task configs (compute + timeout)
  app.get('/', async (c) => {
    const repo = c.req.param('repo')!;
    const workspace = c.req.param('ws')!;

    try {
      const [compute, timeout] = await Promise.all([
        taskConfigStore.listCompute(repo, workspace),
        taskConfigStore.listTimeout(repo, workspace),
      ]);
      return sendSuccess(TaskConfigsType, {
        compute: recordToMap(compute),
        timeout: recordToMap(timeout),
      });
    } catch (err) {
      console.error('Failed to list task configs:', err);
      return sendError(TaskConfigsType, internalError('Failed to list task configs'));
    }
  });

  // GET /compute — List all compute configs for a workspace
  app.get('/compute', async (c) => {
    const repo = c.req.param('repo')!;
    const workspace = c.req.param('ws')!;

    try {
      const result = await taskConfigStore.listCompute(repo, workspace);
      return sendSuccess(ComputeConfigMapType, recordToMap(result));
    } catch (err) {
      console.error('Failed to list compute configs:', err);
      return sendError(ComputeConfigMapType, internalError('Failed to list compute configs'));
    }
  });

  // GET /compute/:task — Get compute config for a task
  app.get('/compute/:task', async (c) => {
    const repo = c.req.param('repo')!;
    const workspace = c.req.param('ws')!;
    const taskName = c.req.param('task')!;

    try {
      const result = await taskConfigStore.getCompute(repo, workspace, taskName);
      return sendSuccess(ComputeSizeType, result ?? variant('serverless', null));
    } catch (err) {
      console.error('Failed to get compute config:', err);
      return sendError(ComputeSizeType, internalError('Failed to get compute config'));
    }
  });

  // POST /compute — Batch set compute configs
  app.post('/compute', async (c) => {
    const repo = c.req.param('repo')!;
    const workspace = c.req.param('ws')!;

    const lock = await locks.acquire(repo, `workspace/${workspace}`, variant('dataset_write', null), { wait: false });
    if (!lock) {
      return sendError(ComputeConfigMapType, internalError('Workspace is locked by another operation'));
    }

    try {
      const body = await decodeBody(c, ComputeConfigMapType) as Map<string, ComputeSize>;

      // Partition into puts and deletes
      const puts: Record<string, ComputeSize> = {};
      const deletes: string[] = [];
      for (const [taskName, size] of body) {
        if (size.type === 'serverless') {
          deletes.push(taskName);
        } else {
          puts[taskName] = size;
        }
      }

      if (deletes.length > 0) {
        await taskConfigStore.deleteComputeBatch(repo, workspace, deletes);
      }
      if (Object.keys(puts).length > 0) {
        await taskConfigStore.putComputeBatch(repo, workspace, puts);
      }

      const result = await taskConfigStore.listCompute(repo, workspace);
      return sendSuccess(ComputeConfigMapType, recordToMap(result));
    } catch (err) {
      console.error('Failed to batch set compute configs:', err);
      return sendError(ComputeConfigMapType, internalError('Failed to batch set compute configs'));
    } finally {
      await lock.release();
    }
  });

  // PUT /compute/:task — Set compute config for a task
  app.put('/compute/:task', async (c) => {
    const repo = c.req.param('repo')!;
    const workspace = c.req.param('ws')!;
    const taskName = c.req.param('task')!;

    const lock = await locks.acquire(repo, `workspace/${workspace}`, variant('dataset_write', null), { wait: false });
    if (!lock) {
      return sendError(ComputeSizeType, internalError('Workspace is locked by another operation'));
    }

    try {
      const size = await decodeBody(c, ComputeSizeType) as ComputeSize;

      if (size.type === 'serverless') {
        await taskConfigStore.deleteCompute(repo, workspace, taskName);
      } else {
        await taskConfigStore.putCompute(repo, workspace, taskName, size);
      }

      return sendSuccess(ComputeSizeType, size);
    } catch (err) {
      console.error('Failed to set compute config:', err);
      return sendError(ComputeSizeType, internalError('Failed to set compute config'));
    } finally {
      await lock.release();
    }
  });

  // DELETE /compute/:task — Delete compute config for a task
  app.delete('/compute/:task', async (c) => {
    const repo = c.req.param('repo')!;
    const workspace = c.req.param('ws')!;
    const taskName = c.req.param('task')!;

    const lock = await locks.acquire(repo, `workspace/${workspace}`, variant('dataset_write', null), { wait: false });
    if (!lock) {
      return sendError(NullType, internalError('Workspace is locked by another operation'));
    }

    try {
      await taskConfigStore.deleteCompute(repo, workspace, taskName);
      return sendSuccess(NullType, null);
    } catch (err) {
      console.error('Failed to delete compute config:', err);
      return sendError(NullType, internalError('Failed to delete compute config'));
    } finally {
      await lock.release();
    }
  });

  // GET /timeout — List all timeout configs for a workspace
  app.get('/timeout', async (c) => {
    const repo = c.req.param('repo')!;
    const workspace = c.req.param('ws')!;

    try {
      const result = await taskConfigStore.listTimeout(repo, workspace);
      return sendSuccess(TimeoutConfigMapType, recordToMap(result));
    } catch (err) {
      console.error('Failed to list timeout configs:', err);
      return sendError(TimeoutConfigMapType, internalError('Failed to list timeout configs'));
    }
  });

  // GET /timeout/:task — Get timeout for a task (with compute-aware default)
  app.get('/timeout/:task', async (c) => {
    const repo = c.req.param('repo')!;
    const workspace = c.req.param('ws')!;
    const taskName = c.req.param('task')!;

    try {
      const result = await taskConfigStore.getTimeout(repo, workspace, taskName);
      if (result) return sendSuccess(TaskTimeoutType, result);

      // Return default based on compute size
      const computeSize = await taskConfigStore.getCompute(repo, workspace, taskName);
      const defaultMinutes = (!computeSize || computeSize.type === 'serverless') ? BigInt(DEFAULT_TIMEOUT_SERVERLESS) : BigInt(DEFAULT_TIMEOUT_FARGATE);
      return sendSuccess(TaskTimeoutType, { minutes: defaultMinutes });
    } catch (err) {
      console.error('Failed to get timeout config:', err);
      return sendError(TaskTimeoutType, internalError('Failed to get timeout config'));
    }
  });

  // POST /timeout — Batch set timeout configs
  app.post('/timeout', async (c) => {
    const repo = c.req.param('repo')!;
    const workspace = c.req.param('ws')!;

    const lock = await locks.acquire(repo, `workspace/${workspace}`, variant('dataset_write', null), { wait: false });
    if (!lock) {
      return sendError(TimeoutConfigMapType, internalError('Workspace is locked by another operation'));
    }

    try {
      const body = await decodeBody(c, TimeoutConfigMapType) as Map<string, TaskTimeout>;

      // Validate all timeout values
      for (const [taskName, timeout] of body) {
        const error = validateTimeout(timeout.minutes);
        if (error) {
          return sendError(TimeoutConfigMapType, internalError(`Invalid timeout for task '${taskName}': ${error}`));
        }
      }

      const puts: Record<string, TaskTimeout> = {};
      for (const [taskName, timeout] of body) {
        puts[taskName] = timeout;
      }

      if (Object.keys(puts).length > 0) {
        await taskConfigStore.putTimeoutBatch(repo, workspace, puts);
      }

      const result = await taskConfigStore.listTimeout(repo, workspace);
      return sendSuccess(TimeoutConfigMapType, recordToMap(result));
    } catch (err) {
      console.error('Failed to batch set timeout configs:', err);
      return sendError(TimeoutConfigMapType, internalError('Failed to batch set timeout configs'));
    } finally {
      await lock.release();
    }
  });

  // PUT /timeout/:task — Set timeout for a task
  app.put('/timeout/:task', async (c) => {
    const repo = c.req.param('repo')!;
    const workspace = c.req.param('ws')!;
    const taskName = c.req.param('task')!;

    const lock = await locks.acquire(repo, `workspace/${workspace}`, variant('dataset_write', null), { wait: false });
    if (!lock) {
      return sendError(TaskTimeoutType, internalError('Workspace is locked by another operation'));
    }

    try {
      const timeout = await decodeBody(c, TaskTimeoutType) as TaskTimeout;

      const error = validateTimeout(timeout.minutes);
      if (error) {
        return sendError(TaskTimeoutType, internalError(error));
      }

      await taskConfigStore.putTimeout(repo, workspace, taskName, timeout);
      return sendSuccess(TaskTimeoutType, timeout);
    } catch (err) {
      console.error('Failed to set timeout config:', err);
      return sendError(TaskTimeoutType, internalError('Failed to set timeout config'));
    } finally {
      await lock.release();
    }
  });

  // DELETE /timeout/:task — Delete timeout config for a task
  app.delete('/timeout/:task', async (c) => {
    const repo = c.req.param('repo')!;
    const workspace = c.req.param('ws')!;
    const taskName = c.req.param('task')!;

    const lock = await locks.acquire(repo, `workspace/${workspace}`, variant('dataset_write', null), { wait: false });
    if (!lock) {
      return sendError(NullType, internalError('Workspace is locked by another operation'));
    }

    try {
      await taskConfigStore.deleteTimeout(repo, workspace, taskName);
      return sendSuccess(NullType, null);
    } catch (err) {
      console.error('Failed to delete timeout config:', err);
      return sendError(NullType, internalError('Failed to delete timeout config'));
    } finally {
      await lock.release();
    }
  });

  return app;
}
