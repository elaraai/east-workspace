/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Set Status — Cloud-agnostic GC status transition logic.
 *
 * Handlers for transitioning repository status in the GC state machine.
 */

import type { RepoManager, RepoStatus } from '../repo-manager.js';
import { InvalidRepoStatusError } from '../errors.js';

export interface SetStatusDeps {
  repoManager: RepoManager;
}

export interface SetStatusInput {
  /** Repository name */
  repo: string;
  /** Execution reference (for tracking) */
  executionRef?: string;
  /** GC run ID */
  gcId?: string;
  /** GC start time */
  startTime?: number;
  /** Jitter in seconds */
  jitterSeconds?: number;
  /** GC stats (for pass-through from cleanup to final output) */
  stats?: {
    deletedObjects: number;
    retainedObjects: number;
    skippedYoung: number;
    bytesFreed: number;
  };
}

export interface SetStatusOutput {
  /** Repository name */
  repo: string;
  /** New status after transition */
  status: RepoStatus;
  /** Whether the transition succeeded */
  success: boolean;
  /** Error message if transition failed */
  error?: string;
  /** GC run ID (pass-through) */
  gcId?: string;
  /** GC start time (pass-through) */
  startTime?: number;
  /** GC stats (pass-through from cleanup) */
  stats?: {
    deletedObjects: number;
    retainedObjects: number;
    skippedYoung: number;
    bytesFreed: number;
  };
}

/**
 * Set repo status to 'gc'.
 *
 * Only succeeds if current status is 'active'.
 * Called at the start of the GC state machine.
 */
export async function handleSetGC(deps: SetStatusDeps, input: SetStatusInput): Promise<SetStatusOutput> {
  const { repo, executionRef, gcId, startTime } = input;

  try {
    await deps.repoManager.setRepoStatus(repo, 'active', 'gc', executionRef);
    return { repo, status: 'gc', success: true, gcId, startTime };
  } catch (error) {
    if (error instanceof InvalidRepoStatusError) {
      console.error(`Failed to set gc: ${error.message}`);
      return {
        repo,
        status: error.actualStatus as RepoStatus,
        success: false,
        error: error.message,
        gcId,
        startTime,
      };
    }
    throw error;
  }
}

/**
 * Set repo status back to 'active'.
 *
 * Only succeeds if current status is 'gc'.
 * Called at the end of the GC state machine.
 */
export async function handleSetActive(deps: SetStatusDeps, input: SetStatusInput): Promise<SetStatusOutput> {
  const { repo, stats } = input;

  try {
    await deps.repoManager.setRepoStatus(repo, 'gc', 'active');
    return { repo, status: 'active', success: true, stats };
  } catch (error) {
    if (error instanceof InvalidRepoStatusError) {
      console.error(`Failed to set active: ${error.message}`);
      return {
        repo,
        status: error.actualStatus as RepoStatus,
        success: false,
        error: error.message,
        stats,
      };
    }
    throw error;
  }
}
