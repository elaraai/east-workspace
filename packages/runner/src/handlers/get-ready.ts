/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import {
  DynamoDBClient,
  QueryCommand,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { dataflowGetReadyTasks, type DataflowGraph } from '@elaraai/e3-core';

const dynamo = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;

export interface GetReadyEvent {
  repo: string;
  workspace: string;
  executionId: string;
  graph?: DataflowGraph;
}

export interface GetReadyResult {
  repo: string;
  workspace: string;
  executionId: string;
  readyTasks: string[];
  allCompleted: boolean;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  inProgressCount: number;
}

/**
 * Lambda handler: Find tasks that are ready to execute.
 *
 * A task is ready when:
 * - All its dependencies have completed (success or cached)
 * - It is not already dispatched, running, completed, failed, or skipped
 */
export async function handler(event: GetReadyEvent): Promise<GetReadyResult> {
  const { repo, executionId } = event;

  console.log(`Getting ready tasks for execution ${executionId} in repo ${repo}`);

  // Get graph from event or DynamoDB
  let graph = event.graph;
  if (!graph) {
    graph = await getStoredGraph(repo, executionId);
  }

  // Query all task statuses for this execution
  const taskStatuses = await getTaskStatuses(repo, executionId);

  // Build sets of task states
  const completed = new Set<string>();
  const inProgress = new Set<string>();
  const failed = new Set<string>();
  const skipped = new Set<string>();

  for (const [taskName, info] of taskStatuses) {
    switch (info.status) {
      case 'success':
      case 'cached':
        completed.add(taskName);
        break;
      case 'dispatched':
      case 'running':
        inProgress.add(taskName);
        break;
      case 'failed':
      case 'error':
        failed.add(taskName);
        break;
      case 'skipped':
        skipped.add(taskName);
        break;
    }
  }

  // Record events for newly completed tasks (orchestrator observes state changes)
  await recordEventsForCompletedTasks(repo, event.workspace, executionId, taskStatuses);

  // Get tasks that have all dependencies satisfied
  const readyCandidates = dataflowGetReadyTasks(graph, completed);

  // Filter out tasks that are already in-progress, failed, or skipped
  const readyTasks = readyCandidates.filter(
    (task) => !inProgress.has(task) && !failed.has(task) && !skipped.has(task)
  );

  // All tasks are complete when there are no ready tasks and no in-progress tasks
  // and all tasks are either completed, failed, or skipped
  const totalTasks = graph.tasks.length;
  const processedCount = completed.size + failed.size + skipped.size;
  const allCompleted = readyTasks.length === 0 && inProgress.size === 0 && processedCount >= totalTasks;

  console.log(`Ready: ${readyTasks.length}, In-progress: ${inProgress.size}, Completed: ${completed.size}, Failed: ${failed.size}, Skipped: ${skipped.size}`);

  return {
    repo,
    workspace: event.workspace,
    executionId,
    readyTasks,
    allCompleted,
    completedCount: completed.size,
    failedCount: failed.size,
    skippedCount: skipped.size,
    inProgressCount: inProgress.size,
  };
}

/**
 * Get stored graph from DynamoDB.
 */
async function getStoredGraph(repo: string, executionId: string): Promise<DataflowGraph> {
  const response = await dynamo.send(
    new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        PK: `REPO#${repo}`,
        SK: `EXEC#GRAPH#${executionId}`,
      }),
      ConsistentRead: true,
    })
  );

  if (!response.Item) {
    throw new Error(`Graph not found for execution ${executionId}`);
  }

  const item = unmarshall(response.Item);
  return JSON.parse(item.graph as string) as DataflowGraph;
}

interface TaskStatusInfo {
  status: string;
  eventRecorded?: boolean;
}

/**
 * Get all task statuses for an execution, including event tracking.
 */
async function getTaskStatuses(
  repo: string,
  executionId: string
): Promise<Map<string, TaskStatusInfo>> {
  const statuses = new Map<string, TaskStatusInfo>();
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
          eventRecorded: unmarshalled.eventRecorded as boolean | undefined,
        });
      }
    }

    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return statuses;
}

/**
 * Event types for dataflow events.
 */
type DataflowEventType =
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
 * Mark a task as having its event recorded.
 */
async function markEventRecorded(
  repo: string,
  executionId: string,
  taskName: string
): Promise<void> {
  await dynamo.send(
    new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        PK: `REPO#${repo}`,
        SK: `EXEC#TASK#${executionId}#${taskName}`,
      }),
      UpdateExpression: 'SET eventRecorded = :true',
      ExpressionAttributeValues: marshall({
        ':true': true,
      }),
    })
  );
}

/**
 * Record events for newly completed tasks.
 * Only records events for tasks that haven't had events recorded yet.
 */
async function recordEventsForCompletedTasks(
  repo: string,
  workspace: string,
  executionId: string,
  taskStatuses: Map<string, TaskStatusInfo>
): Promise<void> {
  const now = new Date().toISOString();

  for (const [taskName, info] of taskStatuses) {
    // Skip if event already recorded
    if (info.eventRecorded) {
      continue;
    }

    // Only record events for terminal states
    const terminalStates = ['success', 'cached', 'failed', 'error', 'skipped'];
    if (!terminalStates.includes(info.status)) {
      continue;
    }

    // Record appropriate event based on status
    switch (info.status) {
      case 'cached':
        await writeEvent(repo, workspace, executionId, {
          type: 'cached',
          task: taskName,
          timestamp: now,
        });
        break;

      case 'success':
        // Write both start and complete events for executed tasks
        await writeEvent(repo, workspace, executionId, {
          type: 'start',
          task: taskName,
          timestamp: now,
        });
        await writeEvent(repo, workspace, executionId, {
          type: 'complete',
          task: taskName,
          timestamp: now,
          duration: 0, // Duration not tracked at this level
        });
        break;

      case 'failed':
        await writeEvent(repo, workspace, executionId, {
          type: 'start',
          task: taskName,
          timestamp: now,
        });
        await writeEvent(repo, workspace, executionId, {
          type: 'failed',
          task: taskName,
          timestamp: now,
          duration: 0,
          exitCode: -1,
        });
        break;

      case 'error':
        await writeEvent(repo, workspace, executionId, {
          type: 'start',
          task: taskName,
          timestamp: now,
        });
        await writeEvent(repo, workspace, executionId, {
          type: 'error',
          task: taskName,
          timestamp: now,
          message: 'Task error',
        });
        break;

      case 'skipped':
        await writeEvent(repo, workspace, executionId, {
          type: 'skipped',
          task: taskName,
          timestamp: now,
          reason: 'Upstream task failed',
        });
        break;
    }

    // Mark event as recorded
    await markEventRecorded(repo, executionId, taskName);
  }
}
