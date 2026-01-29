/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * finalize-execution.ts - Updates execution state when dataflow completes
 *
 * Called at the end of Step Functions before success/fail terminal states.
 * Uses e3-core stepFinalize to update execution status and compute summary.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage } from '@elaraai/e3-storage';
import { stepFinalize } from '@elaraai/e3-core';

// Initialize clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const storage = new S3DynamoStorage(
  s3,
  dynamo,
  process.env.BUCKET_NAME!,
  process.env.TABLE_NAME!
);

export interface FinalizeExecutionEvent {
  repo: string;
  workspace: string;
  /** Numeric execution ID */
  executionId: number;
  status: 'completed' | 'failed';
}

export interface FinalizeExecutionResult {
  success: boolean;
  executed?: number;
  cached?: number;
  failed?: number;
  skipped?: number;
  duration?: number;
}

/**
 * Finalize execution by updating status and computing summary.
 *
 * Uses e3-core stepFinalize to update the execution state with final
 * status, completedAt timestamp, and summary counts.
 */
export async function handler(event: FinalizeExecutionEvent): Promise<FinalizeExecutionResult> {
  const { repo, workspace, executionId } = event;
  const execId = executionId.toString().padStart(10, '0');

  console.log(`Finalizing execution ${executionId} for workspace ${workspace}`);

  // Read execution state
  const state = await storage.executions.read(repo, workspace, execId);
  if (!state) {
    console.error(`Execution ${executionId} not found`);
    // Still release lock even if state not found
    await storage.locks.forceRelease(repo, `workspace/${workspace}`);
    return { success: false };
  }

  // Check if execution was cancelled - preserve that status
  const wasCancelled = state.status === 'cancelled';

  // Use stepFinalize to update state with completion status
  const { result } = stepFinalize(state);

  // Restore cancelled status if it was cancelled (stepFinalize overwrites with completed/failed)
  if (wasCancelled) {
    (state as { status: string }).status = 'cancelled';
  }

  // Save updated state
  await storage.executions.update(state);

  // Release workspace lock after execution completes
  await storage.locks.forceRelease(repo, `workspace/${workspace}`);

  console.log(`Finalized execution ${executionId}: success=${result.success}, executed=${result.executed}, cached=${result.cached}, failed=${result.failed}, skipped=${result.skipped}`);

  return {
    success: result.success,
    executed: result.executed,
    cached: result.cached,
    failed: result.failed,
    skipped: result.skipped,
    duration: result.duration,
  };
}
