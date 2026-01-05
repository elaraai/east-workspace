/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { EfsBackend } from '@elaraai/e3-cloud-storage';

interface GetGraphEvent {
  tenantId: string;
  workspace: string;
}

interface TaskGraph {
  tasks: Record<string, { dependencies: string[] }>;
}

/**
 * Lambda handler: Get the task dependency graph for a workspace.
 * Called by Step Functions at the start of dataflow execution.
 */
export async function handler(event: GetGraphEvent): Promise<TaskGraph> {
  const { tenantId, workspace } = event;

  const storage = new EfsBackend(tenantId);
  console.log(`Getting graph for ${workspace} at ${storage.repoPath}`);

  // TODO: Call e3-core dataflowGetGraph() once StorageBackend is implemented
  // const graph = await dataflowGetGraph(storage, workspace);
  // return graph;

  // Placeholder
  return {
    tasks: {},
  };
}
