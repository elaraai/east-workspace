/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import {
  DynamoDBClient,
  GetItemCommand,
  DeleteItemCommand,
  QueryCommand,
  BatchWriteItemCommand,
  TransactWriteItemsCommand,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { UserSettingsStore } from '@elaraai/e3-cloud-core';
import { WorkspaceNotFoundError, WorkspaceLockedError } from '@elaraai/e3-cloud-core';

/**
 * DynamoDB-backed UserSettingsStore implementation.
 *
 * Uses a single-table design:
 *   PK: USERSETTINGS/{repo}/{workspace}    SK: {userId}
 *   Attributes: data (Binary), updatedAt (String)
 *
 * PUT uses TransactWriteItems with:
 *   1. ConditionCheck on WS/{repo} SK={workspace} — workspace must exist
 *   2. ConditionCheck on LOCK/{repo} SK=workspace/{workspace} — no active lock
 *   3. Put on USERSETTINGS/{repo}/{workspace} SK={userId} — write the blob
 */
export class DynamoUserSettingsStore implements UserSettingsStore {
  constructor(
    private readonly dynamo: DynamoDBClient,
    private readonly tableName: string,
  ) {}

  private pk(repo: string, workspace: string): string {
    return `USERSETTINGS/${repo}/${workspace}`;
  }

  async get(repo: string, workspace: string, userId: string): Promise<Uint8Array | null> {
    const response = await this.dynamo.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({ PK: this.pk(repo, workspace), SK: userId }),
        ConsistentRead: true,
      })
    );

    if (!response.Item) return null;
    const item = unmarshall(response.Item);
    if (!item.data) return null;
    return item.data as Uint8Array;
  }

  async put(repo: string, workspace: string, userId: string, data: Uint8Array): Promise<void> {
    try {
      await this.dynamo.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            // 1. Workspace must exist
            {
              ConditionCheck: {
                TableName: this.tableName,
                Key: marshall({ PK: `WS/${repo}`, SK: workspace }),
                ConditionExpression: 'attribute_exists(PK)',
              },
            },
            // 2. Workspace must not be locked
            {
              ConditionCheck: {
                TableName: this.tableName,
                Key: marshall({ PK: `LOCK/${repo}`, SK: `workspace/${workspace}` }),
                ConditionExpression: 'attribute_not_exists(PK) OR expiresAt < :now',
                ExpressionAttributeValues: marshall({ ':now': new Date().toISOString() }),
              },
            },
            // 3. Write the settings blob
            {
              Put: {
                TableName: this.tableName,
                Item: marshall(
                  {
                    PK: this.pk(repo, workspace),
                    SK: userId,
                    data,
                    updatedAt: new Date().toISOString(),
                  },
                  { removeUndefinedValues: true }
                ),
              },
            },
          ],
        })
      );
    } catch (err) {
      if (err instanceof TransactionCanceledException && err.CancellationReasons) {
        const reasons = err.CancellationReasons;
        if (reasons[0]?.Code === 'ConditionalCheckFailed') {
          throw new WorkspaceNotFoundError(repo, workspace);
        }
        if (reasons[1]?.Code === 'ConditionalCheckFailed') {
          throw new WorkspaceLockedError(repo, workspace);
        }
      }
      throw err;
    }
  }

  async delete(repo: string, workspace: string, userId: string): Promise<void> {
    await this.dynamo.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: marshall({ PK: this.pk(repo, workspace), SK: userId }),
      })
    );
  }

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
    // Query WS/{repo} to discover workspace names, then delete per-workspace
    let exclusiveStartKey: Record<string, any> | undefined;
    const workspaces: string[] = [];

    do {
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: marshall({ ':pk': `WS/${repo}` }),
          ProjectionExpression: 'SK',
          ExclusiveStartKey: exclusiveStartKey,
        })
      );

      if (response.Items) {
        for (const item of response.Items) {
          const unmarshalled = unmarshall(item);
          workspaces.push(unmarshalled.SK as string);
        }
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    for (const ws of workspaces) {
      await this.deleteAllForWorkspace(repo, ws);
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
