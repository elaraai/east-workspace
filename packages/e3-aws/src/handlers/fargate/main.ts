/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Fargate Compute Entrypoint
 *
 * Top-level script (not a Lambda handler) that runs inside a Fargate container.
 * Reads the task event from the TASK_EVENT environment variable, executes the task
 * using shared core logic, writes the result to the ComputeResultStore,
 * then exits with appropriate exit code.
 *
 * The result is later read by the collect-compute-result Lambda handler.
 *
 * Note: This entry point deliberately avoids importing S3DynamoStorage/getStorage()
 * to minimize the dependency tree loaded in the Fargate container. Instead, it
 * constructs lightweight deps directly from AWS SDK clients.
 */

import { executeTaskCore } from '@elaraai/e3-cloud-core/steps';
import type { TaskExecutionEvent, TaskExecutionResult, TaskExecutionDeps } from '@elaraai/e3-cloud-core/steps';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { S3ObjectStore } from '../../storage/s3-object-store.js';
import { DynamoComputeResultStore, DynamoLogStore } from '../../storage/index.js';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import type { ComputeResultStore } from '@elaraai/e3-cloud-core';

export interface ComputeEntryDeps {
  taskExecutionDeps: TaskExecutionDeps;
  computeResultStore: ComputeResultStore;
}

/**
 * Pure function: Execute a task, write the result to the ComputeResultStore.
 */
export async function handleComputeEntry(
  deps: ComputeEntryDeps,
  event: TaskExecutionEvent,
): Promise<TaskExecutionResult> {
  const { taskExecutionDeps, computeResultStore } = deps;
  const { repo, workspace, taskExecutionId, taskName, timeoutMinutes } = event;

  console.log(`Fargate compute: executing task ${taskName} (timeout: ${timeoutMinutes ?? 1440} min)`);

  // Execute with Fargate-appropriate timeout
  const timeoutMs = (timeoutMinutes ?? 1440) * 60 * 1000;
  let result: TaskExecutionResult;
  try {
    result = await executeTaskCore(event, taskExecutionDeps, { timeoutMs });
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

  // Write result to ComputeResultStore for collect-compute-result to read
  try {
    await computeResultStore.write(repo, workspace, taskExecutionId!, JSON.stringify(result));
    console.log(`Fargate compute: result written for ${taskName} (status: ${result.status})`);
  } catch (err) {
    console.error('Failed to write compute result:', err);
    // Exit with error — collect-compute-result will handle as crashed container
    process.exit(1);
  }

  return result;
}

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

  // Construct deps from raw AWS clients (deliberately avoids getStorage() / S3DynamoStorage)
  const s3 = new S3Client({});
  const dynamo = new DynamoDBClient({});
  const bucketName = process.env.BUCKET_NAME!;
  const tableName = process.env.TABLE_NAME!;

  const objectStore = new S3ObjectStore(s3, dynamo, bucketName, tableName);
  const logStore = new DynamoLogStore(dynamo, tableName);
  const computeResultStore = new DynamoComputeResultStore(dynamo, tableName);

  // For execution state and tracker, we use a lightweight stub that does
  // only what execute-task-core needs: read execution status and add events.
  // This avoids importing DynamoDBStateStore which pulls in heavy e3-core deps.
  const { DynamoDBStateStore } = await import('../../storage/dynamo-state-store.js');
  const executions = new DynamoDBStateStore(dynamo, s3, bucketName, tableName);
  const { DynamoRefStore } = await import('../../storage/dynamo-ref-store.js');
  const executionTracker = new DynamoRefStore(dynamo, tableName);

  const taskExecutionDeps: TaskExecutionDeps = {
    objects: objectStore,
    logs: logStore,
    executions,
    executionTracker,
  };

  const result = await handleComputeEntry({ taskExecutionDeps, computeResultStore }, event);

  // Signal Step Functions via task token callback (unblocks before container deprovisioning)
  const taskToken = process.env.TASK_TOKEN;
  if (taskToken) {
    const sfnClient = new SFNClient({});
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
