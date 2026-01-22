/**
 * finalize-execution.ts - Updates execution state when dataflow completes
 *
 * Called at the end of Step Functions before success/fail terminal states.
 * Phase 3 schema: Updates execution record at PK: EXEC/{repo}/{workspace}, SK: {executionId}
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage } from '@elaraai/e3-storage';

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
}

/**
 * Finalize execution by updating status and completedAt.
 *
 * Note: We only update status and completedAt, NOT the counts.
 * The counts (completedCount, cachedCount, etc.) are updated by write-result
 * as each task completes. This preserves those values.
 *
 * Phase 3 schema: Updates execution record at PK: EXEC/{repo}/{workspace}, SK: {executionId}
 */
export async function handler(event: FinalizeExecutionEvent): Promise<FinalizeExecutionResult> {
  const { repo, workspace, executionId, status } = event;

  await storage.refs.updateExecution(repo, workspace, executionId, {
    status,
    completedAt: new Date().toISOString(),
  });

  return { success: true };
}
