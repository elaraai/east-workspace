/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import type { S3DynamoStorage } from '@elaraai/e3-storage';
import type { DataflowGraph } from '@elaraai/e3-core';

/**
 * Get stored graph from execution record.
 * Phase 3 schema: Graph is stored as an attribute of the execution record
 * at PK: EXEC/{repo}/{workspace}, SK: {executionId}
 */
export async function getStoredGraph(
  storage: S3DynamoStorage,
  repo: string,
  workspace: string,
  executionId: number
): Promise<DataflowGraph> {
  const execution = await storage.refs.getExecution(repo, workspace, executionId);
  if (!execution) {
    throw new Error(`Execution ${executionId} not found for workspace ${workspace}`);
  }
  if (!execution.graph) {
    throw new Error(`Execution ${executionId} has no graph (status: ${execution.status})`);
  }
  return JSON.parse(execution.graph) as DataflowGraph;
}
