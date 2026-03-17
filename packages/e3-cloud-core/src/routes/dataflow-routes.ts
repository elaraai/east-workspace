/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Dataflow Routes for e3 Cloud Platform
 *
 * Provides dataflow execution endpoints:
 * - POST /api/repos/:repo/workspaces/:ws/dataflow — Start dataflow
 * - POST /api/repos/:repo/workspaces/:ws/dataflow/cancel — Cancel dataflow
 * - GET /api/repos/:repo/workspaces/:ws/dataflow/execution — Get execution status
 */

import { Hono } from 'hono';
import { NullType, variant, some, none } from '@elaraai/east';
import {
  stepCancel, coreStateToApiState, coreEventToApiEvent, uuidv7,
  dataflowGetGraph,
  WorkspaceNotFoundError, WorkspaceNotDeployedError,
  type DataflowExecutionState,
} from '@elaraai/e3-core';
import { sendSuccess, sendError, sendSuccessWithStatus, decodeBody } from '@elaraai/e3-api-server/beast2';
import { ApiTypes } from '@elaraai/e3-api-server';
import type { DataflowStorage } from '../dataflow-storage.js';
import type { DataflowOrchestrator } from '../dataflow-orchestrator.js';

/** Helper to create internal API errors */
const internalError = (message: string) => variant('internal', { message });

/**
 * Create dataflow routes.
 *
 * Cancel and status polling use storage.executions and storage.locks (already abstract).
 * Only startExecution uses the DataflowOrchestrator.
 */
export function createDataflowRoutes(deps: {
  storage: DataflowStorage;
  orchestrator: DataflowOrchestrator;
}): Hono {
  const { storage, orchestrator } = deps;
  const app = new Hono();

  // POST /api/repos/:repo/workspaces/:ws/dataflow - Start dataflow execution
  app.post('/api/repos/:repo/workspaces/:ws/dataflow', async (c) => {
    const repo = c.req.param('repo');
    const workspace = c.req.param('ws');

    // Decode BEAST2-encoded body to get force flag and filter
    const body = await decodeBody(c, ApiTypes.DataflowRequestType);
    const force = body.force;
    const filter = body.filter.type === 'some' ? body.filter.value : undefined;

    // Validate workspace exists and is deployed BEFORE acquiring lock
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

    // Acquire shared workspace lock (blocks deploy/remove/export, coexists with e3 set)
    const sharedLock = await storage.locks.acquire(
      repo,
      workspace,
      variant('dataflow', null),
      { wait: false, mode: 'shared' }
    );

    if (!sharedLock) {
      return sendError(NullType, variant('workspace_locked', {
        workspace,
        holder: variant('unknown', null),
      }));
    }

    // Acquire exclusive dataflow lock (prevents concurrent dataflow starts)
    const dataflowLock = await storage.locks.acquire(
      repo,
      `${workspace}#dataflow`,
      variant('dataflow', null),
      { wait: false }
    );

    if (!dataflowLock) {
      await sharedLock.release();
      return sendError(NullType, variant('workspace_locked', {
        workspace,
        holder: variant('unknown', null),
      }));
    }

    try {
      // Get next execution ID
      const execId = await storage.executions.nextExecutionId(repo, workspace);

      // Create initial execution state
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
        versionVectors: new Map(),
        inputSnapshot: new Map(),
        taskOutputPaths: [],
        reexecuted: 0n,
        events: [],
        eventSeq: 0n,
      };
      await storage.executions.create(initialState);

      // Generate runId for DataflowRun tracking
      const runId = uuidv7();

      // Start the dataflow via orchestrator
      await orchestrator.startExecution({
        repo,
        workspace,
        executionId: parseInt(execId, 10),
        force: force ?? false,
        forceTasks: [],
        filter,
        runId,
      });

      // DON'T release locks here - finalize-execution will release them
      return sendSuccessWithStatus(NullType, null, 202);
    } catch (err) {
      // Release both locks on error
      await dataflowLock.release();
      await sharedLock.release();
      console.error('Failed to start dataflow:', err);
      return sendError(NullType, internalError('Failed to start dataflow execution'));
    }
  });

  // POST /api/repos/:repo/workspaces/:ws/dataflow/cancel - Cancel running dataflow execution
  app.post('/api/repos/:repo/workspaces/:ws/dataflow/cancel', async (c) => {
    const repo = c.req.param('repo');
    const workspace = c.req.param('ws');

    try {
      const state = await storage.executions.readLatest(repo, workspace);

      if (!state) {
        return sendError(NullType, internalError('No execution found for this workspace'));
      }

      if (state.status !== 'running') {
        return sendError(NullType, internalError(`Cannot cancel execution in '${state.status}' state`));
      }

      stepCancel(state, 'User requested cancellation');
      await storage.executions.update(state);

      // Release both locks (exclusive first, then shared)
      try { await storage.locks.forceRelease(repo, `${workspace}#dataflow`); }
      catch (err) { console.error(`Failed to release dataflow lock for ${repo}/${workspace}#dataflow:`, err); }
      try { await storage.locks.forceRelease(repo, workspace); }
      catch (err) { console.error(`Failed to release workspace lock for ${repo}/${workspace}:`, err); }

      console.log(`Cancelled execution ${state.id} for ${repo}/${workspace}`);
      return sendSuccess(NullType, null);
    } catch (err) {
      console.error('Failed to cancel dataflow:', err);
      return sendError(NullType, internalError('Failed to cancel dataflow execution'));
    }
  });

  // GET /api/repos/:repo/workspaces/:ws/dataflow/execution - Get dataflow execution status
  app.get('/api/repos/:repo/workspaces/:ws/dataflow/execution', async (c) => {
    const repo = c.req.param('repo');
    const workspace = c.req.param('ws');

    const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!, 10) : 0;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;

    try {
      const state = await storage.executions.readLatest(repo, workspace);

      if (!state) {
        return sendError(ApiTypes.DataflowExecutionStateType, variant('execution_not_found', { task: workspace }));
      }

      const completedAt = state.completedAt.type === 'some' ? state.completedAt.value : null;
      const durationMs = completedAt
        ? completedAt.getTime() - state.startedAt.getTime()
        : Date.now() - state.startedAt.getTime();

      // Count only API-visible events
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

      const apiState = coreStateToApiState(state, slicedEvents, totalApiEvents, durationMs);

      const statusVariant = apiState.status === 'running'
        ? variant('running', null)
        : apiState.status === 'completed'
          ? variant('completed', null)
          : apiState.status === 'aborted'
            ? variant('aborted', null)
            : variant('failed', null);

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

  return app;
}
