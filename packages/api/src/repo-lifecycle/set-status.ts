/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Set Status Lambda Handlers
 *
 * Handlers for transitioning repository status in the state machine.
 * Each handler is a separate export for use in different Step Function states.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoRefStore, InvalidRepoStatusError, type RepoStatus } from '@elaraai/e3-storage';

// Initialize AWS clients once at Lambda cold start
const dynamo = new DynamoDBClient({});
const refStore = new DynamoRefStore(dynamo, process.env.TABLE_NAME!);

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
}

/**
 * Set repo status to 'deleting'.
 *
 * Only succeeds if current status is 'active'.
 * Called at the start of the delete state machine.
 */
export const setDeletingHandler = async (input: SetStatusInput): Promise<SetStatusOutput> => {
  const { repo, executionArn } = input;

  console.log(`Setting repo ${repo} to 'deleting'`);

  try {
    await refStore.setRepoStatus(repo, 'active', 'deleting', executionArn);
    return { repo, status: 'deleting', success: true };
  } catch (error) {
    if (error instanceof InvalidRepoStatusError) {
      console.error(`Failed to set deleting: ${error.message}`);
      return {
        repo,
        status: error.actualStatus as RepoStatus,
        success: false,
        error: error.message,
      };
    }
    throw error;
  }
};

/**
 * Set repo status to 'gc'.
 *
 * Only succeeds if current status is 'active'.
 * Called at the start of the GC state machine.
 * Passes through gcId and startTime for subsequent handlers.
 */
export const setGCHandler = async (input: SetStatusInput): Promise<SetStatusOutput> => {
  const { repo, executionArn, gcId, startTime } = input;

  console.log(`Setting repo ${repo} to 'gc'`);

  try {
    await refStore.setRepoStatus(repo, 'active', 'gc', executionArn);
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
  const { repo } = input;

  console.log(`Setting repo ${repo} to 'active'`);

  try {
    await refStore.setRepoStatus(repo, 'gc', 'active');
    return { repo, status: 'active', success: true };
  } catch (error) {
    if (error instanceof InvalidRepoStatusError) {
      console.error(`Failed to set active: ${error.message}`);
      return {
        repo,
        status: error.actualStatus as RepoStatus,
        success: false,
        error: error.message,
      };
    }
    throw error;
  }
};

/**
 * Remove repo metadata (final deletion step).
 *
 * Called after all S3 objects and DynamoDB items are deleted.
 * Removes the repo metadata item, completing the deletion.
 */
export const removeMetadataHandler = async (input: { repo: string }): Promise<{ repo: string; removed: boolean }> => {
  const { repo } = input;

  console.log(`Removing metadata for repo ${repo}`);

  await refStore.removeRepoMetadata(repo);
  return { repo, removed: true };
};
