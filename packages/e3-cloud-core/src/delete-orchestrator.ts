/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Delete Orchestrator — Cloud-agnostic interface for repo deletion orchestration.
 */

export interface DeletionStatus {
  status: 'running' | 'succeeded' | 'failed' | 'not_found';
  error?: string;
}

/**
 * Orchestrator for async repo deletion via Step Functions.
 */
export interface DeleteOrchestrator {
  /** Start a repo deletion SFN execution. Returns execution ID. */
  startDeletion(params: { repo: string }): Promise<string>;

  /** Poll deletion status by execution ID. */
  getDeletionStatus(executionId: string): Promise<DeletionStatus>;
}
