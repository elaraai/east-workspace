/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import {
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dynamo = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;

// Stale claim threshold: 5 minutes
const STALE_CLAIM_THRESHOLD_MS = 5 * 60 * 1000;

export interface DispatchResult {
  taskName: string;
  status: 'dispatched' | 'cached' | 'not_ready';
  outputHash?: string;
}

export interface CheckCompletionEvent {
  repo: string;
  workspace: string;
  executionId: string;
  dispatchResults?: DispatchResult[];
}

export interface TaskCompletion {
  taskName: string;
  status: 'success' | 'cached' | 'failed' | 'error';
  outputPath?: string;
  outputHash?: string;
  exitCode?: number;
  error?: string;
}

export interface CheckCompletionResult {
  repo: string;
  workspace: string;
  executionId: string;
  completed: TaskCompletion[];
  failedTasks: string[];
  failedCount: number;
  stillRunning: string[];
  anyCompleted: boolean;
}

/**
 * Lambda handler: Check completion status of dispatched tasks.
 *
 * This handler:
 * 1. Queries DynamoDB for task statuses
 * 2. Detects stale claims (heartbeat > 5 min old) and marks them as failed
 * 3. Returns completed tasks and those still running
 */
export async function handler(event: CheckCompletionEvent): Promise<CheckCompletionResult> {
  const { repo, executionId, dispatchResults } = event;

  // Query all task statuses for this execution
  const taskStatuses = await getTaskStatuses(repo, executionId);

  // Get tasks to check: either from dispatchResults or from DynamoDB (all in-progress tasks)
  let tasksToCheck: string[];
  if (dispatchResults && dispatchResults.length > 0) {
    tasksToCheck = dispatchResults.map(r => r.taskName);
  } else {
    // No dispatchResults - find all tasks that are dispatched or running
    tasksToCheck = [];
    for (const [taskName, status] of taskStatuses) {
      if (status.status === 'dispatched' || status.status === 'running') {
        tasksToCheck.push(taskName);
      }
    }
  }

  console.log(`Checking completion for ${tasksToCheck.length} tasks in execution ${executionId}`);

  const completed: TaskCompletion[] = [];
  const failedTasks: string[] = [];
  const stillRunning: string[] = [];
  const now = Date.now();

  for (const taskName of tasksToCheck) {
    const taskStatus = taskStatuses.get(taskName);

    if (!taskStatus) {
      // Task not found - still waiting for dispatch
      stillRunning.push(taskName);
      continue;
    }

    switch (taskStatus.status) {
      case 'success':
      case 'cached':
        completed.push({
          taskName,
          status: taskStatus.status,
          outputPath: taskStatus.outputPath,
          outputHash: taskStatus.outputHash,
        });
        break;

      case 'failed':
      case 'error':
        // Failed tasks go to separate array for MarkSkipped processing
        failedTasks.push(taskName);
        break;

      case 'running':
        // Check for stale claim
        if (taskStatus.heartbeat && now - taskStatus.heartbeat > STALE_CLAIM_THRESHOLD_MS) {
          console.log(`Task ${taskName} has stale heartbeat, marking as failed`);
          await markTaskFailed(repo, executionId, taskName, 'Container heartbeat timeout');
          failedTasks.push(taskName);
        } else {
          stillRunning.push(taskName);
        }
        break;

      case 'dispatched':
        // Task dispatched but not yet picked up by container
        stillRunning.push(taskName);
        break;

      default:
        stillRunning.push(taskName);
    }
  }

  console.log(`Completed: ${completed.length}, Failed: ${failedTasks.length}, Still running: ${stillRunning.length}`);

  // Record events for completed and failed tasks (orchestrator observes state changes)
  if (completed.length > 0 || failedTasks.length > 0) {
    await recordTaskEvents(
      repo,
      event.workspace,
      executionId,
      completed,
      failedTasks,
      taskStatuses
    );
  }

  return {
    repo,
    workspace: event.workspace,
    executionId,
    completed,
    failedTasks,
    failedCount: failedTasks.length,
    stillRunning,
    anyCompleted: completed.length > 0 || failedTasks.length > 0,
  };
}

interface TaskStatusItem {
  status: string;
  outputPath?: string;
  outputHash?: string;
  exitCode?: number;
  error?: string;
  heartbeat?: number;
}

/**
 * Get all task statuses for an execution.
 */
async function getTaskStatuses(
  repo: string,
  executionId: string
): Promise<Map<string, TaskStatusItem>> {
  const statuses = new Map<string, TaskStatusItem>();
  let exclusiveStartKey: Record<string, any> | undefined;

  do {
    const response = await dynamo.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: marshall({
          ':pk': `REPO#${repo}`,
          ':prefix': `EXEC#TASK#${executionId}#`,
        }),
        ExclusiveStartKey: exclusiveStartKey,
        ConsistentRead: true,
      })
    );

    if (response.Items) {
      for (const item of response.Items) {
        const unmarshalled = unmarshall(item);
        // SK format: EXEC#TASK#{executionId}#{taskName}
        const sk = unmarshalled.SK as string;
        const prefixLen = `EXEC#TASK#${executionId}#`.length;
        const taskName = sk.slice(prefixLen);
        statuses.set(taskName, {
          status: unmarshalled.status as string,
          outputPath: unmarshalled.outputPath as string | undefined,
          outputHash: unmarshalled.outputHash as string | undefined,
          exitCode: unmarshalled.exitCode as number | undefined,
          error: unmarshalled.error as string | undefined,
          heartbeat: unmarshalled.heartbeat as number | undefined,
        });
      }
    }

    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return statuses;
}

/**
 * Mark a task as failed due to stale heartbeat.
 */
async function markTaskFailed(
  repo: string,
  executionId: string,
  taskName: string,
  error: string
): Promise<void> {
  await dynamo.send(
    new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        PK: `REPO#${repo}`,
        SK: `EXEC#TASK#${executionId}#${taskName}`,
      }),
      UpdateExpression: 'SET #status = :status, #error = :error, failedAt = :now',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#error': 'error',
      },
      ExpressionAttributeValues: marshall({
        ':status': 'error',
        ':error': error,
        ':now': new Date().toISOString(),
      }),
    })
  );
}

/**
 * Event types that can be recorded.
 */
export type DataflowEventType =
  | { type: 'start'; task: string; timestamp: string }
  | { type: 'complete'; task: string; timestamp: string; duration: number }
  | { type: 'cached'; task: string; timestamp: string }
  | { type: 'failed'; task: string; timestamp: string; duration: number; exitCode: number }
  | { type: 'error'; task: string; timestamp: string; message: string }
  | { type: 'skipped'; task: string; timestamp: string; reason: string };

/**
 * Write an event to DynamoDB with the next sequence number.
 * Uses atomic increment to get unique, ordered sequence numbers.
 */
async function writeEvent(
  repo: string,
  workspace: string,
  executionId: string,
  event: DataflowEventType
): Promise<number> {
  // Atomically increment the event sequence counter and get the new value
  const updateResult = await dynamo.send(
    new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        PK: `REPO#${repo}`,
        SK: `EXEC#STATE#${workspace}`,
      }),
      UpdateExpression: 'SET eventSeq = if_not_exists(eventSeq, :zero) + :one',
      ExpressionAttributeValues: marshall({
        ':zero': 0,
        ':one': 1,
      }),
      ReturnValues: 'UPDATED_NEW',
    })
  );

  const seq = updateResult.Attributes
    ? (unmarshall(updateResult.Attributes).eventSeq as number)
    : 1;

  // Write the event with zero-padded sequence number for string sorting
  const seqStr = seq.toString().padStart(10, '0');
  await dynamo.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        PK: `REPO#${repo}`,
        SK: `EXEC#EVENT#${executionId}#${seqStr}`,
        eventType: event.type,
        task: event.task,
        timestamp: event.timestamp,
        ...(event.type === 'complete' && { duration: event.duration }),
        ...(event.type === 'failed' && { duration: event.duration, exitCode: event.exitCode }),
        ...(event.type === 'error' && { message: event.message }),
        ...(event.type === 'skipped' && { reason: event.reason }),
      }),
    })
  );

  return seq;
}

/**
 * Record events for completed/failed tasks observed by the orchestrator.
 */
async function recordTaskEvents(
  repo: string,
  workspace: string,
  executionId: string,
  completed: TaskCompletion[],
  failedTasks: string[],
  taskStatuses: Map<string, TaskStatusItem>
): Promise<void> {
  const now = new Date().toISOString();

  // Record events for successfully completed tasks
  for (const task of completed) {
    if (task.status === 'cached') {
      await writeEvent(repo, workspace, executionId, {
        type: 'cached',
        task: task.taskName,
        timestamp: now,
      });
    } else {
      // For executed tasks, we write both start and complete events
      await writeEvent(repo, workspace, executionId, {
        type: 'start',
        task: task.taskName,
        timestamp: now,
      });
      await writeEvent(repo, workspace, executionId, {
        type: 'complete',
        task: task.taskName,
        timestamp: now,
        duration: 0, // Duration not tracked at task level currently
      });
    }
  }

  // Record events for failed tasks
  for (const taskName of failedTasks) {
    const status = taskStatuses.get(taskName);
    await writeEvent(repo, workspace, executionId, {
      type: 'start',
      task: taskName,
      timestamp: now,
    });

    if (status?.status === 'error') {
      await writeEvent(repo, workspace, executionId, {
        type: 'error',
        task: taskName,
        timestamp: now,
        message: status.error ?? 'Unknown error',
      });
    } else {
      await writeEvent(repo, workspace, executionId, {
        type: 'failed',
        task: taskName,
        timestamp: now,
        duration: 0,
        exitCode: status?.exitCode ?? -1,
      });
    }
  }
}
