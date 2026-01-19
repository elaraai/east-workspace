/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { DynamoDBClient, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
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

  for (const [taskName, status] of taskStatuses) {
    switch (status) {
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
    })
  );

  if (!response.Item) {
    throw new Error(`Graph not found for execution ${executionId}`);
  }

  const item = unmarshall(response.Item);
  return JSON.parse(item.graph as string) as DataflowGraph;
}

/**
 * Get all task statuses for an execution.
 */
async function getTaskStatuses(
  repo: string,
  executionId: string
): Promise<Map<string, string>> {
  const statuses = new Map<string, string>();
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
      })
    );

    if (response.Items) {
      for (const item of response.Items) {
        const unmarshalled = unmarshall(item);
        // SK format: EXEC#TASK#{executionId}#{taskName}
        const sk = unmarshalled.SK as string;
        const prefixLen = `EXEC#TASK#${executionId}#`.length;
        const taskName = sk.slice(prefixLen);
        statuses.set(taskName, unmarshalled.status as string);
      }
    }

    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return statuses;
}
