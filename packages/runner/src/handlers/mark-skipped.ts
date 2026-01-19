/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { dataflowGetDependentsToSkip, type DataflowGraph } from '@elaraai/e3-core';

const dynamo = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;

export interface MarkSkippedEvent {
  repo: string;
  executionId: string;
  failedTask: string;
  graph?: DataflowGraph;
}

export interface MarkSkippedResult {
  skippedTasks: string[];
  skippedCount: number;
}

/**
 * Lambda handler: Mark downstream tasks as skipped after a task failure.
 *
 * When a task fails, all tasks that transitively depend on it should be
 * marked as skipped since they cannot execute without their dependency.
 */
export async function handler(event: MarkSkippedEvent): Promise<MarkSkippedResult> {
  const { repo, executionId, failedTask } = event;

  console.log(`Marking dependents of failed task ${failedTask} as skipped`);

  // Get graph from event or DynamoDB
  let graph = event.graph;
  if (!graph) {
    graph = await getStoredGraph(repo, executionId);
  }

  // Get current task states
  const taskStates = await getTaskStates(repo, executionId);

  // Build completed and skipped sets
  const completedTasks = new Set<string>();
  const skippedTasks = new Set<string>();

  for (const [taskName, status] of taskStates) {
    if (status === 'success' || status === 'cached') {
      completedTasks.add(taskName);
    } else if (status === 'skipped') {
      skippedTasks.add(taskName);
    }
  }

  // Find all tasks that should be skipped
  const toSkip = dataflowGetDependentsToSkip(graph, failedTask, completedTasks, skippedTasks);

  console.log(`Found ${toSkip.length} tasks to skip: ${toSkip.join(', ')}`);

  // Mark each task as skipped
  const now = new Date().toISOString();
  for (const taskName of toSkip) {
    await dynamo.send(
      new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall({
          PK: `REPO#${repo}`,
          SK: `EXEC#TASK#${executionId}#${taskName}`,
          status: 'skipped',
          reason: `Dependency '${failedTask}' failed`,
          skippedAt: now,
        }),
      })
    );
  }

  // Update execution state counters
  if (toSkip.length > 0) {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({
          PK: `REPO#${repo}`,
          SK: `EXEC#STATE#${executionId}`,
        }),
        UpdateExpression: 'SET skippedCount = if_not_exists(skippedCount, :zero) + :count',
        ExpressionAttributeValues: marshall({
          ':zero': 0,
          ':count': toSkip.length,
        }),
      })
    );
  }

  return {
    skippedTasks: toSkip,
    skippedCount: toSkip.length,
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
 * Get all task states for an execution.
 */
async function getTaskStates(
  repo: string,
  executionId: string
): Promise<Map<string, string>> {
  const states = new Map<string, string>();
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
        states.set(taskName, unmarshalled.status as string);
      }
    }

    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return states;
}
