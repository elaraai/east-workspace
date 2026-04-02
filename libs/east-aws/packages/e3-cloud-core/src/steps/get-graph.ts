/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { stepInitialize, type DataflowGraph } from '@elaraai/e3-core';
import { variant, none, decodeBeast2For } from '@elaraai/east';
import { WorkspaceStateType, type DataflowRun } from '@elaraai/e3-types';
import type { DataflowStorage } from '../dataflow-storage.js';
import type { DataflowRunStore } from '../dataflow-run-store.js';

const decodeWorkspaceState = decodeBeast2For(WorkspaceStateType);

export interface GetGraphEvent {
  repo: string;
  workspace: string;
  /** Execution ID created by API handler (passed from Step Function input) */
  executionId: number;
  force?: boolean; // Skip cache check if true
  /** Task names to force (skip cache for), resolved from schedule patterns */
  forceTasks?: string[];
  /** Filter to run only specific task(s) by exact name */
  filter?: string;
  /** UUIDv7 run ID for DataflowRun tracking */
  runId: string;
}

export interface GetGraphResult {
  repo: string;
  workspace: string;
  /** Numeric execution ID (from API handler) */
  executionId: number;
  graph: DataflowGraph;
  taskCount: number;
  force: boolean; // Pass through force flag
  /** Task names to force (skip cache for), resolved from schedule patterns */
  forceTasks: string[];
  /** UUIDv7 run ID for DataflowRun tracking */
  runId: string;
}

/**
 * Get the task dependency graph for a workspace.
 * Called by Step Functions at the start of dataflow execution.
 *
 * This handler:
 * 1. Cleans up old dataflow runs
 * 2. Creates initial DataflowRun record with status 'running'
 * 3. Calls e3-core stepInitialize to build the dependency graph and initial state
 * 4. Stores the state in the executions store
 * 5. Returns the execution ID and graph for the state machine
 *
 * Uses e3-core step functions to eliminate duplicated business logic.
 */
export interface GetGraphDeps {
  storage: DataflowStorage;
  dataflowRuns: DataflowRunStore;
}

export async function handleGetGraph(deps: GetGraphDeps, event: GetGraphEvent): Promise<GetGraphResult> {
  const { storage, dataflowRuns } = deps;
  const { repo, workspace, executionId, force, forceTasks, filter, runId } = event;
  const execId = executionId.toString().padStart(10, '0');

  console.log(`Getting graph for workspace ${workspace} in repo ${repo} (execution ${executionId}, run ${runId})`);

  // Clean up the previous dataflow run for this workspace (at most one under workspace lock)
  const previousRun = await dataflowRuns.getLatest(repo, workspace);
  if (previousRun) {
    await dataflowRuns.delete(repo, workspace, previousRun.runId);
  }

  // Get workspace state to capture package reference
  const wsState = await storage.refs.workspaceRead(repo, workspace);
  let packageRef = 'unknown@0.0.0';
  if (wsState) {
    try {
      const decoded = decodeWorkspaceState(wsState);
      packageRef = `${decoded.packageName}@${decoded.packageVersion}`;
    } catch {
      // Fall back if workspace state can't be decoded
    }
  }

  // Use stepInitialize to build the graph and create initial state
  const { state, readyTasks } = await stepInitialize(
    storage,
    repo,
    workspace,
    execId,
    { force: force ?? false, concurrency: 4, filter }
  );

  // Extract graph (stepInitialize always sets it inline)
  const graph = state.graph.type === 'some' ? state.graph.value : null;
  if (!graph) {
    throw new Error('stepInitialize did not return a graph');
  }

  console.log(`Graph has ${graph.tasks.length} tasks, ${readyTasks.length} ready`);

  // Create initial DataflowRun record after stepInitialize so we have inputSnapshot and graph
  const initialRun: DataflowRun = {
    runId,
    workspaceName: workspace,
    packageRef,
    startedAt: new Date(),
    completedAt: none,
    status: variant('running', {}),
    inputVersions: new Map(state.inputSnapshot),
    outputVersions: none,
    taskExecutions: new Map(),
    summary: {
      total: BigInt(graph.tasks.length),
      completed: 0n,
      cached: 0n,
      failed: 0n,
      skipped: 0n,
      reexecuted: 0n,
    },
  };
  await dataflowRuns.write(repo, workspace, initialRun);

  // Update the state in the executions store
  // (initial state was created by API handler to avoid race with polling)
  await storage.executions.update(state);

  console.log(`Started execution ${executionId} for workspace ${workspace}`);

  return {
    repo,
    workspace,
    executionId,
    graph,
    taskCount: graph.tasks.length,
    force: force ?? false,
    forceTasks: forceTasks ?? [],
    runId,
  };
}
