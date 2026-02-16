/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { encodeBeast2For, decodeBeast2For } from '@elaraai/east';
import type { TaskConfigStore } from '@elaraai/e3-admin-core';
import {
  ComputeSizeType,
  type ComputeSize,
  TaskTimeoutType,
  type TaskTimeout,
} from '@elaraai/e3-admin-types';

const encodeComputeSize = encodeBeast2For(ComputeSizeType);
const decodeComputeSize = decodeBeast2For(ComputeSizeType);
const encodeTaskTimeout = encodeBeast2For(TaskTimeoutType);
const decodeTaskTimeout = decodeBeast2For(TaskTimeoutType);

/**
 * DynamoDB-backed TaskConfigStore implementation.
 *
 * Uses a single-table design:
 *   PK: TASKCONFIG/{repo}/{workspace}
 *   SK: compute#{taskName} | timeout#{taskName}
 *
 * Values are stored as BEAST2-encoded binary attributes.
 */
export class DynamoTaskConfigStore implements TaskConfigStore {
  constructor(
    private readonly dynamo: DynamoDBClient,
    private readonly tableName: string
  ) {}

  private pk(repo: string, workspace: string): string {
    return `TASKCONFIG/${repo}/${workspace}`;
  }

  // --- Compute ---

  async getCompute(repo: string, workspace: string, taskName: string): Promise<ComputeSize | null> {
    const response = await this.dynamo.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: this.pk(repo, workspace),
          SK: `compute#${taskName}`,
        }),
        ConsistentRead: true,
      })
    );

    if (!response.Item) return null;
    const item = unmarshall(response.Item);
    if (!item.value) return null;
    return decodeComputeSize(item.value as Uint8Array) as unknown as ComputeSize;
  }

  async putCompute(repo: string, workspace: string, taskName: string, size: ComputeSize): Promise<void> {
    const valueBytes = encodeComputeSize(size as unknown as Parameters<typeof encodeComputeSize>[0]);
    await this.dynamo.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: marshall(
          {
            PK: this.pk(repo, workspace),
            SK: `compute#${taskName}`,
            value: valueBytes,
            updatedAt: new Date().toISOString(),
          },
          { removeUndefinedValues: true }
        ),
      })
    );
  }

  async putComputeBatch(repo: string, workspace: string, configs: Record<string, ComputeSize>): Promise<void> {
    const pk = this.pk(repo, workspace);
    const entries = Object.entries(configs);
    const batchSize = 25;

    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      await this.dynamo.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [this.tableName]: batch.map(([taskName, size]) => ({
              PutRequest: {
                Item: marshall(
                  {
                    PK: pk,
                    SK: `compute#${taskName}`,
                    value: encodeComputeSize(size as unknown as Parameters<typeof encodeComputeSize>[0]),
                    updatedAt: new Date().toISOString(),
                  },
                  { removeUndefinedValues: true }
                ),
              },
            })),
          },
        })
      );
    }
  }

  async deleteCompute(repo: string, workspace: string, taskName: string): Promise<void> {
    await this.dynamo.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: this.pk(repo, workspace),
          SK: `compute#${taskName}`,
        }),
      })
    );
  }

  async deleteComputeBatch(repo: string, workspace: string, taskNames: string[]): Promise<void> {
    await this.batchDeleteBySKs(
      this.pk(repo, workspace),
      taskNames.map((name) => `compute#${name}`)
    );
  }

  async listCompute(repo: string, workspace: string): Promise<Record<string, ComputeSize>> {
    const result: Record<string, ComputeSize> = {};
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: marshall({
            ':pk': this.pk(repo, workspace),
            ':prefix': 'compute#',
          }),
          ExclusiveStartKey: exclusiveStartKey,
          ConsistentRead: true,
        })
      );

      if (response.Items) {
        for (const item of response.Items) {
          const unmarshalled = unmarshall(item);
          if (unmarshalled.value) {
            const taskName = (unmarshalled.SK as string).slice('compute#'.length);
            result[taskName] = decodeComputeSize(unmarshalled.value as Uint8Array) as unknown as ComputeSize;
          }
        }
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return result;
  }

  // --- Timeout ---

  async getTimeout(repo: string, workspace: string, taskName: string): Promise<TaskTimeout | null> {
    const response = await this.dynamo.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: this.pk(repo, workspace),
          SK: `timeout#${taskName}`,
        }),
        ConsistentRead: true,
      })
    );

    if (!response.Item) return null;
    const item = unmarshall(response.Item);
    if (!item.value) return null;
    return decodeTaskTimeout(item.value as Uint8Array) as unknown as TaskTimeout;
  }

  async putTimeout(repo: string, workspace: string, taskName: string, timeout: TaskTimeout): Promise<void> {
    const valueBytes = encodeTaskTimeout(timeout as unknown as Parameters<typeof encodeTaskTimeout>[0]);
    await this.dynamo.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: marshall(
          {
            PK: this.pk(repo, workspace),
            SK: `timeout#${taskName}`,
            value: valueBytes,
            updatedAt: new Date().toISOString(),
          },
          { removeUndefinedValues: true }
        ),
      })
    );
  }

  async putTimeoutBatch(repo: string, workspace: string, configs: Record<string, TaskTimeout>): Promise<void> {
    const pk = this.pk(repo, workspace);
    const entries = Object.entries(configs);
    const batchSize = 25;

    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      await this.dynamo.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [this.tableName]: batch.map(([taskName, timeout]) => ({
              PutRequest: {
                Item: marshall(
                  {
                    PK: pk,
                    SK: `timeout#${taskName}`,
                    value: encodeTaskTimeout(timeout as unknown as Parameters<typeof encodeTaskTimeout>[0]),
                    updatedAt: new Date().toISOString(),
                  },
                  { removeUndefinedValues: true }
                ),
              },
            })),
          },
        })
      );
    }
  }

  async deleteTimeout(repo: string, workspace: string, taskName: string): Promise<void> {
    await this.dynamo.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: this.pk(repo, workspace),
          SK: `timeout#${taskName}`,
        }),
      })
    );
  }

  async deleteTimeoutBatch(repo: string, workspace: string, taskNames: string[]): Promise<void> {
    await this.batchDeleteBySKs(
      this.pk(repo, workspace),
      taskNames.map((name) => `timeout#${name}`)
    );
  }

  async listTimeout(repo: string, workspace: string): Promise<Record<string, TaskTimeout>> {
    const result: Record<string, TaskTimeout> = {};
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: marshall({
            ':pk': this.pk(repo, workspace),
            ':prefix': 'timeout#',
          }),
          ExclusiveStartKey: exclusiveStartKey,
          ConsistentRead: true,
        })
      );

      if (response.Items) {
        for (const item of response.Items) {
          const unmarshalled = unmarshall(item);
          if (unmarshalled.value) {
            const taskName = (unmarshalled.SK as string).slice('timeout#'.length);
            result[taskName] = decodeTaskTimeout(unmarshalled.value as Uint8Array) as unknown as TaskTimeout;
          }
        }
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return result;
  }

  // --- Bulk deletion ---

  async deleteAllForWorkspace(repo: string, workspace: string): Promise<void> {
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: marshall({ ':pk': this.pk(repo, workspace) }),
          ProjectionExpression: 'PK, SK',
          ExclusiveStartKey: exclusiveStartKey,
        })
      );

      if (response.Items && response.Items.length > 0) {
        await this.batchDeleteItems(response.Items);
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);
  }

  async deleteAllForRepo(repo: string): Promise<void> {
    const prefix = `TASKCONFIG/${repo}/`;
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const response = await this.dynamo.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: 'begins_with(PK, :prefix)',
          ExpressionAttributeValues: marshall({ ':prefix': prefix }),
          ProjectionExpression: 'PK, SK',
          ExclusiveStartKey: exclusiveStartKey,
        })
      );

      if (response.Items && response.Items.length > 0) {
        await this.batchDeleteItems(response.Items);
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);
  }

  // --- Helpers ---

  private async batchDeleteBySKs(pk: string, sks: string[]): Promise<void> {
    const batchSize = 25;
    for (let i = 0; i < sks.length; i += batchSize) {
      const batch = sks.slice(i, i + batchSize);
      await this.dynamo.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [this.tableName]: batch.map((sk) => ({
              DeleteRequest: {
                Key: marshall({ PK: pk, SK: sk }),
              },
            })),
          },
        })
      );
    }
  }

  private async batchDeleteItems(items: Record<string, any>[]): Promise<void> {
    const batchSize = 25;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await this.dynamo.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [this.tableName]: batch.map((item) => {
              const unmarshalled = unmarshall(item);
              return {
                DeleteRequest: {
                  Key: marshall({ PK: unmarshalled.PK, SK: unmarshalled.SK }),
                },
              };
            }),
          },
        })
      );
    }
  }
}
