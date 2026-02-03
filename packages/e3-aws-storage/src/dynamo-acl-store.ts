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
import { some, none } from '@elaraai/east';
import type { AclStore } from '@elaraai/e3-admin-core';
import type { RepoUser, RepoRole } from '@elaraai/e3-admin-types';
import { parseRepoRole, serializeRepoRole } from '@elaraai/e3-admin-types';

/**
 * DynamoDB-backed AclStore implementation.
 *
 * Uses a single-table design with GSI1 for user lookups:
 *
 *   PK: ACL#{repo}
 *   SK: USER#{userId}
 *   GSI1PK: USERACL#{userId}
 *   GSI1SK: REPO#{repo}
 *
 * Attributes: email, name, role, addedBy, addedAt
 */
export class DynamoAclStore implements AclStore {
  constructor(
    private readonly dynamo: DynamoDBClient,
    private readonly tableName: string
  ) {}

  /**
   * List all users with access to a repository.
   */
  async listUsers(repo: string): Promise<RepoUser[]> {
    const users: RepoUser[] = [];
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: marshall({ ':pk': `ACL#${repo}` }),
          ExclusiveStartKey: exclusiveStartKey,
          ConsistentRead: true,
        })
      );

      if (response.Items) {
        for (const item of response.Items) {
          users.push(this.itemToUser(unmarshall(item)));
        }
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return users;
  }

  /**
   * Add a user to a repository's ACL.
   */
  async addUser(repo: string, user: RepoUser): Promise<RepoUser> {
    const item: Record<string, unknown> = {
      PK: `ACL#${repo}`,
      SK: `USER#${user.userId}`,
      GSI1PK: `USERACL#${user.userId}`,
      GSI1SK: `REPO#${repo}`,
      userId: user.userId,
      email: user.email,
      role: serializeRepoRole(user.role),
      addedBy: user.addedBy,
      addedAt: user.addedAt,
    };

    // Only add name if present (Option.some)
    if (user.name.type === 'some') {
      item.name = user.name.value;
    }

    await this.dynamo.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
      })
    );

    return user;
  }

  /**
   * Remove a user from a repository's ACL.
   */
  async removeUser(repo: string, userId: string): Promise<void> {
    await this.dynamo.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: `ACL#${repo}`,
          SK: `USER#${userId}`,
        }),
      })
    );
  }

  /**
   * Get a user's role on a repository.
   *
   * @returns The user's role, or null if they have no access
   */
  async getRole(repo: string, userId: string): Promise<RepoRole | null> {
    const response = await this.dynamo.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: `ACL#${repo}`,
          SK: `USER#${userId}`,
        }),
        ConsistentRead: true,
      })
    );

    if (!response.Item) {
      return null;
    }

    const item = unmarshall(response.Item);
    return parseRepoRole(item.role as string);
  }

  /**
   * List all repositories a user has access to.
   *
   * Uses GSI1 to query by user ID.
   */
  async listReposForUser(userId: string): Promise<string[]> {
    const repos: string[] = [];
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: marshall({ ':pk': `USERACL#${userId}` }),
          ExclusiveStartKey: exclusiveStartKey,
        })
      );

      if (response.Items) {
        for (const item of response.Items) {
          const unmarshalled = unmarshall(item);
          // Extract repo from GSI1SK: REPO#{repo}
          const gsi1sk = unmarshalled.GSI1SK as string;
          const repo = gsi1sk.slice('REPO#'.length);
          repos.push(repo);
        }
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return repos;
  }

  /**
   * Delete all ACL entries for a repository.
   *
   * Used during repository deletion.
   */
  async deleteAllForRepo(repo: string): Promise<void> {
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      // Query for all ACL entries for this repo
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: marshall({ ':pk': `ACL#${repo}` }),
          ProjectionExpression: 'PK, SK',
          ExclusiveStartKey: exclusiveStartKey,
        })
      );

      if (response.Items && response.Items.length > 0) {
        // Delete in batches of 25 (DynamoDB limit)
        await this.batchDeleteItems(response.Items);
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);
  }

  /**
   * Helper to batch delete items (max 25 per BatchWriteItem).
   */
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

  /**
   * Convert a DynamoDB item to RepoUser.
   */
  private itemToUser(item: Record<string, unknown>): RepoUser {
    return {
      userId: item.userId as string,
      email: item.email as string,
      name: item.name ? some(item.name as string) : none,
      role: parseRepoRole(item.role as string),
      addedBy: item.addedBy as string,
      addedAt: item.addedAt as string,
    };
  }
}
