/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  QueryCommand,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { encodeBeast2For, decodeBeast2For } from '@elaraai/east';
import { DatasetRefType, type DatasetRef } from '@elaraai/e3-types';
import type { DatasetRefStore } from '@elaraai/e3-core';

const encodeRef = encodeBeast2For(DatasetRefType);
const decodeRef = decodeBeast2For(DatasetRefType);

/**
 * DynamoDB-backed DatasetRefStore implementation.
 *
 * Per-dataset refs are stored with the key pattern:
 *   PK: DREF/{repo}
 *   SK: {workspace}#{refPath}
 *
 * The ref value is BEAST2-encoded using DatasetRefType, which is a variant:
 *   - unassigned: null
 *   - null: { versions: VersionVector }
 *   - value: { hash: string, versions: VersionVector }
 *
 * This enables:
 * - Atomic per-dataset writes (no cross-path contention)
 * - Efficient workspace-scoped listing via SK prefix query
 * - Version vector tracking for reactive dataflow
 */
export class DynamoDatasetRefStore implements DatasetRefStore {
  constructor(
    private readonly dynamo: DynamoDBClient,
    private readonly tableName: string
  ) {}

  async read(repo: string, ws: string, path: string): Promise<DatasetRef | null> {
    const response = await this.dynamo.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: `DREF/${repo}`,
          SK: `${ws}#${path}`,
        }),
        ConsistentRead: true,
      })
    );

    if (!response.Item) {
      return null;
    }

    const item = unmarshall(response.Item);
    const refData = item.ref;

    if (!refData || !(refData instanceof Uint8Array || Buffer.isBuffer(refData))) {
      return null;
    }

    return decodeRef(Buffer.from(refData));
  }

  async write(repo: string, ws: string, path: string, ref: DatasetRef): Promise<void> {
    const encoded = encodeRef(ref);

    await this.dynamo.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: marshall({
          PK: `DREF/${repo}`,
          SK: `${ws}#${path}`,
          ref: encoded,
        }),
      })
    );
  }

  async list(repo: string, ws: string): Promise<string[]> {
    const prefix = `${ws}#`;
    const paths: string[] = [];
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: marshall({
            ':pk': `DREF/${repo}`,
            ':prefix': prefix,
          }),
          ProjectionExpression: 'SK',
          ConsistentRead: true,
          ExclusiveStartKey: exclusiveStartKey,
        })
      );

      if (response.Items) {
        for (const item of response.Items) {
          const unmarshalled = unmarshall(item);
          const sk = unmarshalled.SK as string;
          paths.push(sk.slice(prefix.length));
        }
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return paths;
  }

  async remove(repo: string, ws: string, path: string): Promise<void> {
    await this.dynamo.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: `DREF/${repo}`,
          SK: `${ws}#${path}`,
        }),
      })
    );
  }

  /**
   * List all dataset refs with their values for a workspace in a single query.
   * DynamoDB-specific optimization to avoid N+1 queries during GC scanning.
   */
  async listWithRefs(repo: string, ws: string): Promise<Array<{ path: string; ref: DatasetRef }>> {
    const prefix = `${ws}#`;
    const results: Array<{ path: string; ref: DatasetRef }> = [];
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: marshall({
            ':pk': `DREF/${repo}`,
            ':prefix': prefix,
          }),
          ProjectionExpression: 'SK, #ref',
          ExpressionAttributeNames: { '#ref': 'ref' },
          ConsistentRead: true,
          ExclusiveStartKey: exclusiveStartKey,
        })
      );

      if (response.Items) {
        for (const item of response.Items) {
          const unmarshalled = unmarshall(item);
          const sk = unmarshalled.SK as string;
          const refData = unmarshalled.ref;
          if (refData && (refData instanceof Uint8Array || Buffer.isBuffer(refData))) {
            try {
              const ref = decodeRef(Buffer.from(refData));
              results.push({ path: sk.slice(prefix.length), ref });
            } catch {
              // Skip malformed refs
            }
          }
        }
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return results;
  }

  async removeAll(repo: string, ws: string): Promise<void> {
    const prefix = `${ws}#`;
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: marshall({
            ':pk': `DREF/${repo}`,
            ':prefix': prefix,
          }),
          ProjectionExpression: 'PK, SK',
          ConsistentRead: true,
          ExclusiveStartKey: exclusiveStartKey,
        })
      );

      if (response.Items && response.Items.length > 0) {
        // BatchWriteItem supports max 25 items per batch
        for (let i = 0; i < response.Items.length; i += 25) {
          const batch = response.Items.slice(i, i + 25);
          await this.batchWriteWithRetry(
            batch.map(item => ({
              DeleteRequest: { Key: item },
            }))
          );
        }
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);
  }

  /**
   * BatchWriteItem with retry for UnprocessedItems.
   * DynamoDB may return unprocessed items under throttling; retry with backoff.
   */
  private async batchWriteWithRetry(
    requests: Array<{ DeleteRequest: { Key: Record<string, any> } }>
  ): Promise<void> {
    const MAX_RETRIES = 10;
    let unprocessed: typeof requests | undefined = requests;
    let delay = 100;
    let retries = 0;

    while (unprocessed && unprocessed.length > 0) {
      const response = await this.dynamo.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [this.tableName]: unprocessed,
          },
        })
      );

      const remaining = response.UnprocessedItems?.[this.tableName];
      if (remaining && remaining.length > 0) {
        retries++;
        if (retries >= MAX_RETRIES) {
          console.error(`BatchWriteItem failed after ${MAX_RETRIES} retries, ${remaining.length} items remaining`);
          break;
        }
        unprocessed = remaining as typeof requests;
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 1000);
      } else {
        unprocessed = undefined;
      }
    }
  }
}
