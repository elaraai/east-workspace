/**
 * finalize-execution.ts - Updates execution state when dataflow completes
 *
 * Called at the end of Step Functions before success/fail terminal states.
 * Updates the EXEC#STATE#{workspace} record with final status and counts.
 */

import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

const dynamo = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;

export interface FinalizeExecutionEvent {
  repo: string;
  workspace: string;
  executionId: string;
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
 */
export async function handler(event: FinalizeExecutionEvent): Promise<FinalizeExecutionResult> {
  const { repo, workspace, status } = event;

  await dynamo.send(
    new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: { S: `REPO#${repo}` },
        SK: { S: `EXEC#STATE#${workspace}` },
      },
      UpdateExpression: 'SET #status = :status, completedAt = :completedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': { S: status },
        ':completedAt': { S: new Date().toISOString() },
      },
    })
  );

  return { success: true };
}
