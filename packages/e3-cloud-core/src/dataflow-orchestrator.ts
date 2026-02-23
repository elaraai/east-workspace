/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Cloud-agnostic interface for starting dataflow executions.
 *
 * The AWS implementation wraps Step Functions StartExecutionCommand.
 * Cancel and status polling use ExecutionStateStore directly (already abstracted).
 */
export interface DataflowOrchestrator {
  /** Start a dataflow execution, returns an opaque execution name */
  startExecution(params: {
    repo: string;
    workspace: string;
    executionId: number;
    force: boolean;
    forceTasks: string[];
    filter?: string;
    runId: string;
    triggeredBy?: { type: string; value: unknown };
  }): Promise<string>;
}
