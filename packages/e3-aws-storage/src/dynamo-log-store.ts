/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import {
  DynamoDBClient,
  QueryCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { LogStore, LogChunk } from '@elaraai/e3-core';

/**
 * Default TTL for log chunks in seconds (7 days).
 * After this, DynamoDB will automatically delete the items.
 */
const DEFAULT_LOG_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * DynamoDB-backed LogStore implementation.
 *
 * Logs are stored as chunks with the key pattern:
 *   PK: LOG/{repo}/{taskHash}/{inputsHash}
 *   SK: {stream}/{chunk_index}  (chunk_index: 6-digit zero-padded)
 *
 * This enables:
 * - Per-task-execution partitions (isolates log writes from other repo operations)
 * - Near real-time log viewing (~100ms latency)
 * - Non-blocking writes from task runners
 * - Automatic cleanup via TTL
 * - Efficient stream-specific reads via SK prefix
 *
 * The task runner should buffer logs and flush periodically (e.g., every 2s
 * or 64KB) rather than writing every line individually.
 */
export class DynamoLogStore implements LogStore {
  private chunkCounters = new Map<string, number>();

  constructor(
    private readonly dynamo: DynamoDBClient,
    private readonly tableName: string
  ) {}

  /**
   * Append data to a log stream.
   *
   * Creates a new chunk item with a contiguous index-based sort key.
   * The caller should batch data to reduce write frequency.
   */
  async append(
    repo: string,
    taskHash: string,
    inputsHash: string,
    stream: 'stdout' | 'stderr',
    data: string
  ): Promise<void> {
    if (!data) {
      return; // Don't write empty chunks
    }

    const now = Date.now();
    const chunkIndex = this.getNextChunkIndex(repo, taskHash, inputsHash, stream);
    const ttl = Math.floor(now / 1000) + DEFAULT_LOG_TTL_SECONDS;

    // Pad chunk index for correct lexicographic ordering
    const paddedIndex = chunkIndex.toString().padStart(6, '0');

    await this.dynamo.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: marshall({
          PK: `LOG/${repo}/${taskHash}/${inputsHash}`,
          SK: `${stream}/${paddedIndex}`,
          data,
          timestamp: now,
          ttl,
        }),
      })
    );
  }

  /**
   * Read from a log stream.
   *
   * Queries all chunks for the stream and concatenates them.
   * Supports offset and limit for pagination.
   */
  async read(
    repo: string,
    taskHash: string,
    inputsHash: string,
    stream: 'stdout' | 'stderr',
    options?: { offset?: number; limit?: number }
  ): Promise<LogChunk> {
    const offset = options?.offset ?? 0;
    const limit = options?.limit;

    // Query all chunks for this stream
    const pk = `LOG/${repo}/${taskHash}/${inputsHash}`;
    const skPrefix = `${stream}/`;
    const chunks = await this.queryChunks(pk, skPrefix);

    // Concatenate all chunk data
    const fullLog = chunks.map((c) => c.data as string).join('');
    const totalSize = Buffer.byteLength(fullLog, 'utf-8');

    // Apply offset and limit
    let result = fullLog;
    let resultOffset = 0;

    if (offset > 0) {
      // Convert byte offset to string index (approximate for UTF-8)
      const bytes = Buffer.from(fullLog, 'utf-8');
      if (offset >= bytes.length) {
        result = '';
        resultOffset = bytes.length;
      } else {
        result = bytes.slice(offset).toString('utf-8');
        resultOffset = offset;
      }
    }

    if (limit !== undefined && Buffer.byteLength(result, 'utf-8') > limit) {
      const bytes = Buffer.from(result, 'utf-8');
      result = bytes.slice(0, limit).toString('utf-8');
    }

    const size = Buffer.byteLength(result, 'utf-8');
    const complete = resultOffset + size >= totalSize;

    return {
      data: result,
      offset: resultOffset,
      size,
      totalSize,
      complete,
    };
  }

  /**
   * Query all chunks for a given PK and SK prefix.
   */
  private async queryChunks(pk: string, skPrefix: string): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: marshall({
            ':pk': pk,
            ':prefix': skPrefix,
          }),
          ExclusiveStartKey: exclusiveStartKey,
          ScanIndexForward: true, // Ascending order by SK (chunk index)
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
   * Get the next chunk index for a log stream.
   * Contiguous index ensures correct ordering when reading.
   */
  private getNextChunkIndex(repo: string, taskHash: string, inputsHash: string, stream: string): number {
    const key = `${repo}#${taskHash}#${inputsHash}#${stream}`;
    const current = this.chunkCounters.get(key) ?? 0;
    this.chunkCounters.set(key, current + 1);
    return current;
  }
}
