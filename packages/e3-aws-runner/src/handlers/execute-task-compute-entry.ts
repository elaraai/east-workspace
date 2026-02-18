/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Fargate Compute Entrypoint
 *
 * Top-level script (not a Lambda handler) that runs inside a Fargate container.
 * Reads the task event from the TASK_EVENT environment variable, executes the task
 * using shared core logic, writes the result to a COMPUTE_RESULT/ DynamoDB key,
 * then exits with appropriate exit code.
 *
 * The result is later read by the collect-compute-result Lambda handler.
 */

import { executeTaskCore } from './execute-task-core.js';
import type { TaskExecutionResult } from './execute-task-core.js';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';

const TABLE_NAME = process.env.TABLE_NAME!;
const dynamo = new DynamoDBClient({});
const sfnClient = new SFNClient({});

async function main(): Promise<void> {
  const eventJson = process.env.TASK_EVENT;
  if (!eventJson) {
    console.error('TASK_EVENT environment variable is not set');
    process.exit(1);
  }

  let event: any;
  try {
    event = JSON.parse(eventJson);
  } catch (err) {
    console.error('Failed to parse TASK_EVENT:', err);
    process.exit(1);
  }

  const { repo, workspace, taskExecutionId, taskName, timeoutMinutes } = event;

  console.log(`Fargate compute: executing task ${taskName} (timeout: ${timeoutMinutes ?? 1440} min)`);

  // Execute with Fargate-appropriate timeout
  const timeoutMs = (timeoutMinutes ?? 1440) * 60 * 1000;
  let result: TaskExecutionResult;
  try {
    result = await executeTaskCore(event, { timeoutMs });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`Fargate compute: unhandled error: ${errorMsg}`);
    result = {
      taskName,
      status: 'failed',
      error: errorMsg,
      duration: 0,
    };
  }

  // Write result to COMPUTE_RESULT/ key for collect-compute-result to read
  const ttl = Math.floor(Date.now() / 1000) + 3600; // 1 hour TTL
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall(
          {
            PK: `COMPUTE_RESULT/${repo}/${workspace}`,
            SK: taskExecutionId,
            result: JSON.stringify(result),
            ttl,
          },
          { removeUndefinedValues: true }
        ),
      })
    );
    console.log(`Fargate compute: result written for ${taskName} (status: ${result.status})`);
  } catch (err) {
    console.error('Failed to write compute result to DynamoDB:', err);
    // Exit with error — collect-compute-result will handle as crashed container
    process.exit(1);
  }

  // Signal Step Functions via task token callback (unblocks before container deprovisioning)
  const taskToken = process.env.TASK_TOKEN;
  if (taskToken) {
    try {
      if (result.status === 'success') {
        await sfnClient.send(new SendTaskSuccessCommand({
          taskToken,
          output: JSON.stringify(result),
        }));
      } else {
        await sfnClient.send(new SendTaskFailureCommand({
          taskToken,
          error: 'TaskFailed',
          cause: result.error ?? 'Task execution failed',
        }));
      }
      console.log(`Fargate compute: task token callback sent (${result.status})`);
    } catch (err) {
      // If callback fails, heartbeat timeout will eventually fire — log and continue
      console.error('Failed to send task token callback:', err);
    }
  }

  process.exit(result.status === 'success' ? 0 : 1);
}

main().catch((err) => {
  console.error('Fargate compute: fatal error:', err);
  process.exit(1);
});
