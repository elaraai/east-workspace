/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage, DynamoRefStore } from '@elaraai/e3-aws-storage';
import { stepInitialize, type DataflowGraph } from '@elaraai/e3-core';
import { variant, none, decodeBeast2For } from '@elaraai/east';
import { WorkspaceStateType, type DataflowRun } from '@elaraai/e3-types';

const decodeWorkspaceState = decodeBeast2For(WorkspaceStateType);

// Initialize clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const storage = new S3DynamoStorage(
  s3,
  dynamo,
  process.env.BUCKET_NAME!,
  process.env.TABLE_NAME!
);

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
 * Lambda handler: Get the task dependency graph for a workspace.
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
export async function handler(event: GetGraphEvent): Promise<GetGraphResult> {
  const { repo, workspace, executionId, force, forceTasks, filter, runId } = event;
  const execId = executionId.toString().padStart(10, '0');

  console.log(`Getting graph for workspace ${workspace} in repo ${repo} (execution ${executionId}, run ${runId})`);

  // Clean up old dataflow runs for this workspace
  const refs = storage.refs as DynamoRefStore;
  const oldRunIds = await refs.dataflowRunList(repo, workspace);
  for (const oldRunId of oldRunIds) {
    await refs.dataflowRunDelete(repo, workspace, oldRunId);
  }

  // Get workspace state to capture input snapshot and package reference
  const wsState = await storage.refs.workspaceRead(repo, workspace);
  let inputSnapshot = '';
  let packageRef = 'unknown@0.0.0';
  if (wsState) {
    inputSnapshot = await getWorkspaceRootHash(wsState);
    try {
      const decoded = decodeWorkspaceState(wsState);
      packageRef = `${decoded.packageName}@${decoded.packageVersion}`;
    } catch {
      // Fall back if workspace state can't be decoded
    }
  }

  // Create initial DataflowRun record
  const initialRun: DataflowRun = {
    runId,
    workspaceName: workspace,
    packageRef,
    startedAt: new Date(),
    completedAt: none,
    status: variant('running', {}),
    inputSnapshot,
    outputSnapshot: none,
    taskExecutions: new Map(),
    summary: {
      total: 0n,
      completed: 0n,
      cached: 0n,
      failed: 0n,
      skipped: 0n,
    },
  };
  await refs.dataflowRunWrite(repo, workspace, initialRun);

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

/**
 * Extract workspace root hash from encoded workspace state.
 * The workspace state is BEAST2-encoded; we hash it for snapshot purposes.
 */
async function getWorkspaceRootHash(state: Uint8Array): Promise<string> {
  // Use SHA-256 to hash the workspace state as a snapshot identifier
  const hashBuffer = await crypto.subtle.digest('SHA-256', state);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

