/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Collect Compute Result Lambda Handler
 *
 * Reads the TaskExecutionResult from the COMPUTE_RESULT/ DynamoDB key
 * written by the Fargate container, deletes the item, and returns the result.
 * If the item is not found (container crashed before writing), returns
 * a failure result.
 *
 * Invoked by Step Functions after EcsRunTask completes.
 */

import { DynamoDBClient, GetItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const TABLE_NAME = process.env.TABLE_NAME!;
const dynamo = new DynamoDBClient({});

export interface CollectComputeResultEvent {
  repo: string;
  workspace: string;
  taskExecutionId: string;
  taskName: string;
}

export interface TaskExecutionResult {
  taskName: string;
  status: 'success' | 'failed';
  outputHash?: string;
  exitCode?: number;
  error?: string;
  duration?: number;
  stdout?: string;
  stderr?: string;
}

export async function handler(event: CollectComputeResultEvent): Promise<TaskExecutionResult> {
  const { repo, workspace, taskExecutionId, taskName } = event;

  console.log(`Collecting compute result for task ${taskName} (executionId: ${taskExecutionId})`);

  const pk = `COMPUTE_RESULT/${repo}/${workspace}`;
  const sk = taskExecutionId;

  try {
    // Read result from DynamoDB
    const response = await dynamo.send(
      new GetItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ PK: pk, SK: sk }),
        ConsistentRead: true,
      })
    );

    if (!response.Item) {
      // Container crashed or failed before writing result
      console.error(`No compute result found for task ${taskName} — container may have crashed`);
      return {
        taskName,
        status: 'failed',
        error: 'Compute container exited without writing result (possible crash or OOM)',
        duration: 0,
      };
    }

    const item = unmarshall(response.Item);
    const result: TaskExecutionResult = JSON.parse(item.result as string);

    // Delete the result item (one-time read)
    await dynamo.send(
      new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ PK: pk, SK: sk }),
      })
    );

    console.log(`Collected result for task ${taskName}: status=${result.status}`);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to collect compute result for task ${taskName}:`, err);
    return {
      taskName,
      status: 'failed',
      error: `Failed to collect compute result: ${errorMsg}`,
      duration: 0,
    };
  }
}
