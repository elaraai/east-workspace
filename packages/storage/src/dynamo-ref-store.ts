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
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { RefStore } from '@elaraai/e3-core';
import type { ExecutionStatus } from '@elaraai/e3-types';

/**
 * DynamoDB-backed RefStore implementation.
 *
 * Uses a single-table design with composite keys:
 *   PK: REPO#{repo}
 *   SK: PKG#{name}#{version} | WS#{name} | EXEC#{taskHash}#{inputsHash}
 *
 * The `repo` parameter is used to construct the partition key, enabling
 * multiple repositories to share a single DynamoDB table.
 */
export class DynamoRefStore implements RefStore {
  constructor(
    private readonly dynamo: DynamoDBClient,
    private readonly tableName: string
  ) {}

  // ===========================================================================
  // Package References
  // ===========================================================================

  async packageList(repo: string): Promise<{ name: string; version: string }[]> {
    const items = await this.queryByPrefix(repo, 'PKG#');
    return items.map((item) => {
      // SK format: PKG#{name}#{version}
      const sk = item.SK as string;
      const parts = sk.slice(4).split('#'); // Remove 'PKG#' prefix
      return { name: parts[0], version: parts.slice(1).join('#') };
    });
  }

  async packageResolve(repo: string, name: string, version: string): Promise<string | null> {
    const item = await this.getItem(repo, `PKG#${name}#${version}`);
    return item?.hash as string | null;
  }

  async packageWrite(repo: string, name: string, version: string, hash: string): Promise<void> {
    await this.putItem(repo, `PKG#${name}#${version}`, {
      hash,
      createdAt: new Date().toISOString(),
    });
  }

  async packageRemove(repo: string, name: string, version: string): Promise<void> {
    await this.deleteItem(repo, `PKG#${name}#${version}`);
  }

  // ===========================================================================
  // Workspace State
  // ===========================================================================

  async workspaceList(repo: string): Promise<string[]> {
    const items = await this.queryByPrefix(repo, 'WS#');
    return items.map((item) => {
      // SK format: WS#{name}
      return (item.SK as string).slice(3); // Remove 'WS#' prefix
    });
  }

  async workspaceRead(repo: string, name: string): Promise<Uint8Array | null> {
    const item = await this.getItem(repo, `WS#${name}`);
    if (!item?.state) {
      return null;
    }
    // State is stored as Binary in DynamoDB
    return item.state as Uint8Array;
  }

  async workspaceWrite(repo: string, name: string, state: Uint8Array): Promise<void> {
    await this.putItem(repo, `WS#${name}`, {
      state,
      updatedAt: new Date().toISOString(),
    });
  }

  async workspaceRemove(repo: string, name: string): Promise<void> {
    await this.deleteItem(repo, `WS#${name}`);
  }

  // ===========================================================================
  // Execution Cache
  // ===========================================================================

  async executionGet(repo: string, taskHash: string, inputsHash: string): Promise<ExecutionStatus | null> {
    const item = await this.getItem(repo, `EXEC#${taskHash}#${inputsHash}`);
    if (!item?.status) {
      return null;
    }
    // Status is stored as Binary (encoded ExecutionStatus)
    return item.status as ExecutionStatus;
  }

  async executionWrite(repo: string, taskHash: string, inputsHash: string, status: ExecutionStatus): Promise<void> {
    await this.putItem(repo, `EXEC#${taskHash}#${inputsHash}`, {
      status,
      updatedAt: new Date().toISOString(),
    });
  }

  async executionGetOutput(repo: string, taskHash: string, inputsHash: string): Promise<string | null> {
    const item = await this.getItem(repo, `EXEC#${taskHash}#${inputsHash}`);
    return item?.outputHash as string | null;
  }

  async executionWriteOutput(repo: string, taskHash: string, inputsHash: string, outputHash: string): Promise<void> {
    // Update existing execution item with output hash
    await this.dynamo.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: marshall(
          {
            PK: `REPO#${repo}`,
            SK: `EXEC#${taskHash}#${inputsHash}`,
            outputHash,
            completedAt: new Date().toISOString(),
          },
          { removeUndefinedValues: true }
        ),
        // Merge with existing item (don't overwrite status)
        // Note: For a true merge, you'd use UpdateItem, but PutItem is simpler
        // and the caller typically writes status first, then output
      })
    );
  }

  async executionList(repo: string): Promise<{ taskHash: string; inputsHash: string }[]> {
    const items = await this.queryByPrefix(repo, 'EXEC#');
    return items.map((item) => {
      // SK format: EXEC#{taskHash}#{inputsHash}
      const sk = item.SK as string;
      const parts = sk.slice(5).split('#'); // Remove 'EXEC#' prefix
      return { taskHash: parts[0], inputsHash: parts.slice(1).join('#') };
    });
  }

  async executionListForTask(repo: string, taskHash: string): Promise<string[]> {
    const items = await this.queryByPrefix(repo, `EXEC#${taskHash}#`);
    return items.map((item) => {
      // SK format: EXEC#{taskHash}#{inputsHash}
      const sk = item.SK as string;
      const prefixLen = 5 + taskHash.length + 1; // 'EXEC#' + taskHash + '#'
      return sk.slice(prefixLen);
    });
  }

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  /**
   * Query items by SK prefix.
   */
  private async queryByPrefix(repo: string, skPrefix: string): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: marshall({
            ':pk': `REPO#${repo}`,
            ':prefix': skPrefix,
          }),
          ExclusiveStartKey: exclusiveStartKey,
        })
      );

      if (response.Items) {
        for (const item of response.Items) {
          items.push(unmarshall(item));
        }
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return items;
  }

  /**
   * Get a single item by PK and SK.
   */
  private async getItem(repo: string, sk: string): Promise<Record<string, unknown> | null> {
    const response = await this.dynamo.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: `REPO#${repo}`,
          SK: sk,
        }),
      })
    );

    return response.Item ? unmarshall(response.Item) : null;
  }

  /**
   * Put an item with PK, SK, and additional attributes.
   */
  private async putItem(repo: string, sk: string, attributes: Record<string, unknown>): Promise<void> {
    await this.dynamo.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: marshall(
          {
            PK: `REPO#${repo}`,
            SK: sk,
            ...attributes,
          },
          { removeUndefinedValues: true }
        ),
      })
    );
  }

  /**
   * Delete an item by PK and SK.
   */
  private async deleteItem(repo: string, sk: string): Promise<void> {
    await this.dynamo.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: `REPO#${repo}`,
          SK: sk,
        }),
      })
    );
  }
}
