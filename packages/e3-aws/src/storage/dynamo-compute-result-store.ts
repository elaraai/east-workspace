/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { ComputeResultStore } from '@elaraai/e3-cloud-core';

/** Default TTL for compute results: 1 hour. */
const RESULT_TTL_SECONDS = 3600;

/**
 * DynamoDB-backed implementation of ComputeResultStore.
 *
 * Schema:
 *   PK: COMPUTE_RESULT/{repo}/{workspace}
 *   SK: {taskExecutionId}
 *   result: JSON string of TaskExecutionResult
 *   ttl: Unix epoch seconds (auto-expire after 1 hour)
 */
export class DynamoComputeResultStore implements ComputeResultStore {
  constructor(
    private readonly dynamo: DynamoDBClient,
    private readonly tableName: string,
  ) {}

  async write(repo: string, workspace: string, taskExecutionId: string, result: string): Promise<void> {
    const ttl = Math.floor(Date.now() / 1000) + RESULT_TTL_SECONDS;

    await this.dynamo.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: marshall(
          {
            PK: `COMPUTE_RESULT/${repo}/${workspace}`,
            SK: taskExecutionId,
            result,
            ttl,
          },
          { removeUndefinedValues: true },
        ),
      }),
    );
  }

  async read(repo: string, workspace: string, taskExecutionId: string): Promise<string | null> {
    const response = await this.dynamo.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: `COMPUTE_RESULT/${repo}/${workspace}`,
          SK: taskExecutionId,
        }),
        ConsistentRead: true,
      }),
    );

    if (!response.Item) return null;

    const item = unmarshall(response.Item);
    return item.result as string;
  }

  async delete(repo: string, workspace: string, taskExecutionId: string): Promise<void> {
    await this.dynamo.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: `COMPUTE_RESULT/${repo}/${workspace}`,
          SK: taskExecutionId,
        }),
      }),
    );
  }
}
