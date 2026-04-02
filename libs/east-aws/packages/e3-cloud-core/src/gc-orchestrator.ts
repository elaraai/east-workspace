/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Cloud-agnostic interface for orchestrating garbage collection executions.
 *
 * The AWS implementation wraps Step Functions StartExecutionCommand / DescribeExecutionCommand.
 */
export interface GcOrchestrator {
  /** Start a GC execution, returns an opaque execution ID */
  startGc(params: { repo: string; gcId: string; startTime: number }): Promise<string>;
  /** Get the status of a GC execution */
  getGcStatus(executionId: string): Promise<GcStatus>;
}

export type GcStatus =
  | { status: 'running' }
  | { status: 'succeeded'; stats?: GcStats }
  | { status: 'failed'; error: string }
  | { status: 'not_found' };

export interface GcStats {
  deletedObjects: number;
  retainedObjects: number;
  skippedYoung: number;
  bytesFreed: number;
}
