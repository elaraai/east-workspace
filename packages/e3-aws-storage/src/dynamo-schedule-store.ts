/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import {
  DynamoDBClient,
  QueryCommand,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { encodeBeast2For, decodeBeast2For } from '@elaraai/east';
import type { ScheduleStore } from '@elaraai/e3-admin-core';
import { ScheduleType, type Schedule } from '@elaraai/e3-admin-types';

const encodeSchedule = encodeBeast2For(ScheduleType);
const decodeSchedule = decodeBeast2For(ScheduleType);

/**
 * DynamoDB-backed ScheduleStore implementation.
 *
 * Uses a single-table design:
 *   PK: SCHEDULE/{repo}
 *   SK: {workspace}
 *
 * The schedule is stored as a BEAST2-encoded binary attribute.
 */
export class DynamoScheduleStore implements ScheduleStore {
  constructor(
    private readonly dynamo: DynamoDBClient,
    private readonly tableName: string
  ) {}

  async get(repo: string, workspace: string): Promise<Schedule | null> {
    const response = await this.dynamo.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: `SCHEDULE/${repo}`,
          SK: workspace,
        }),
        ConsistentRead: true,
      })
    );

    if (!response.Item) return null;
    const item = unmarshall(response.Item);
    if (!item.schedule) return null;
    return decodeSchedule(item.schedule as Uint8Array) as unknown as Schedule;
  }

  async put(repo: string, workspace: string, schedule: Schedule): Promise<void> {
    const scheduleBytes = encodeSchedule(schedule as unknown as Parameters<typeof encodeSchedule>[0]);
    await this.dynamo.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: marshall(
          {
            PK: `SCHEDULE/${repo}`,
            SK: workspace,
            schedule: scheduleBytes,
            updatedAt: new Date().toISOString(),
          },
          { removeUndefinedValues: true }
        ),
      })
    );
  }

  async delete(repo: string, workspace: string): Promise<void> {
    await this.dynamo.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: `SCHEDULE/${repo}`,
          SK: workspace,
        }),
      })
    );
  }

  async listForRepo(repo: string): Promise<Schedule[]> {
    const schedules: Schedule[] = [];
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: marshall({ ':pk': `SCHEDULE/${repo}` }),
          ExclusiveStartKey: exclusiveStartKey,
          ConsistentRead: true,
        })
      );

      if (response.Items) {
        for (const item of response.Items) {
          const unmarshalled = unmarshall(item);
          if (unmarshalled.schedule) {
            schedules.push(
              decodeSchedule(unmarshalled.schedule as Uint8Array) as unknown as Schedule
            );
          }
        }
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return schedules;
  }

  async deleteAllForRepo(repo: string): Promise<void> {
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: marshall({ ':pk': `SCHEDULE/${repo}` }),
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

  private async batchDeleteItems(items: Record<string, any>[]): Promise<void> {
    const deleteBatchSize = 25;
    for (let i = 0; i < items.length; i += deleteBatchSize) {
      const batch = items.slice(i, i + deleteBatchSize);
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
