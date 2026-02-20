/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Set Status Lambda Handlers
 *
 * Handlers for transitioning repository status in the GC state machine.
 * Each handler is a separate export for use in different Step Function states.
 */

import { getStorage } from '../../storage/init.js';
import { InvalidRepoStatusError, type RepoStatus } from '../../storage/index.js';

const repoManager = getStorage().repoManager;

/**
 * Input for status transition handlers.
 */
export interface SetStatusInput {
  /** Repository name */
  repo: string;
  /** Step Function execution ARN (for tracking) */
  executionArn?: string;
  /** GC run ID (for GC handlers) */
  gcId?: string;
  /** GC start time (for GC handlers) */
  startTime?: number;
  /** Jitter in seconds (for GC handlers) */
  jitterSeconds?: number;
  /** GC stats (for pass-through from cleanup to final output) */
  stats?: {
    deletedObjects: number;
    retainedObjects: number;
    skippedYoung: number;
    bytesFreed: number;
  };
}

/**
 * Output from status transition handlers.
 * Includes input fields for pass-through in state machines.
 */
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
 * Passes through gcId and startTime for subsequent handlers.
 */
export const setGCHandler = async (input: SetStatusInput): Promise<SetStatusOutput> => {
  const { repo, executionArn, gcId, startTime } = input;

  try {
    await repoManager.setRepoStatus(repo, 'active', 'gc', executionArn);
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
};

/**
 * Set repo status back to 'active'.
 *
 * Only succeeds if current status is 'gc'.
 * Called at the end of the GC state machine.
 */
export const setActiveHandler = async (input: SetStatusInput): Promise<SetStatusOutput> => {
  const { repo, stats } = input;

  try {
    await repoManager.setRepoStatus(repo, 'gc', 'active');
    // Pass through stats from cleanup phase for final output
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
};
