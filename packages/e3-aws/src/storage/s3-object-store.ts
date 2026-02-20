/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * S3ObjectStore with DynamoDB Object Catalogue
 *
 * Objects are tracked in a DynamoDB catalogue that stores:
 * - Current S3 version ID (for large objects)
 * - Inline data (for small objects ≤4KB)
 * - Last referenced timestamp (for GC race protection)
 *
 * This design supports concurrent-safe garbage collection through S3 versioning
 * and catalogue-based tracking. See design/gc-concurrent.md for details.
 */

import { createHash } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
  QueryCommand,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { ObjectStore } from '@elaraai/e3-core';

/**
 * Inline threshold: objects ≤ this size are stored directly in DynamoDB.
 * 4KB is a good tradeoff between DynamoDB item size limits and S3 request overhead.
 */
const INLINE_THRESHOLD = 4096;

/**
 * S3-backed ObjectStore with DynamoDB object catalogue.
 *
 * The catalogue provides:
 * 1. Fast existence checks (DynamoDB GetItem vs S3 HeadObject)
 * 2. Small object inlining (avoid S3 for tiny objects)
 * 3. Version pinning for concurrent-safe GC
 *
 * Objects are stored with the key pattern:
 *   {repo}/objects/{hash}
 *
 * Catalogue entries are stored as:
 *   PK: OBJ/{repo}
 *   SK: {hash}
 */
export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly s3: S3Client,
    private readonly dynamo: DynamoDBClient,
    private readonly bucket: string,
    private readonly tableName: string
  ) {}

  /**
   * Write data to storage, returning its SHA256 hash.
   *
   * Small objects (≤4KB) are stored inline in DynamoDB.
   * Larger objects are uploaded to S3 with versioning, and the
   * catalogue is updated with the version ID.
   */
  async write(repo: string, data: Uint8Array): Promise<string> {
    const hash = this.sha256(data);
    const now = new Date().toISOString();

    if (data.length <= INLINE_THRESHOLD) {
      // Small object: store inline in DynamoDB catalogue
      await this.dynamo.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ PK: `OBJ/${repo}`, SK: hash }),
          UpdateExpression:
            'SET #inline = :data, #size = :size, lastReferencedAt = :now REMOVE currentVersion',
          ExpressionAttributeNames: {
            '#inline': 'inline',
            '#size': 'size',
          },
          ExpressionAttributeValues: marshall({
            ':data': data,
            ':size': data.length,
            ':now': now,
          }),
        })
      );
    } else {
      // Large object: upload to S3, record version in catalogue
      const key = this.objectKey(repo, hash);
      const result = await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: data,
          ContentType: 'application/octet-stream',
        })
      );

      // Update catalogue with S3 version ID
      await this.dynamo.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({ PK: `OBJ/${repo}`, SK: hash }),
          UpdateExpression:
            'SET currentVersion = :ver, #size = :size, lastReferencedAt = :now REMOVE #inline',
          ExpressionAttributeNames: {
            '#size': 'size',
            '#inline': 'inline',
          },
          ExpressionAttributeValues: marshall({
            ':ver': result.VersionId,
            ':size': data.length,
            ':now': now,
          }),
        })
      );
    }

    return hash;
  }

  /**
   * Write data from an async stream to S3.
   * Collects all chunks, computes hash, then uploads.
   */
  async writeStream(repo: string, stream: AsyncIterable<Uint8Array>): Promise<string> {
    // Collect all chunks
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // Concatenate into single buffer
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const data = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }

    return this.write(repo, data);
  }

  /**
   * Read an object by its hash.
   *
   * Checks the catalogue first:
   * - If inline data exists, return it directly
   * - Otherwise, fetch from S3 using the pinned version ID
   *
   * @throws ObjectNotFoundError if object doesn't exist in catalogue
   */
  async read(repo: string, hash: string): Promise<Uint8Array> {
    // Get catalogue entry
    const response = await this.dynamo.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({ PK: `OBJ/${repo}`, SK: hash }),
        ConsistentRead: true,
      })
    );

    if (!response.Item) {
      throw new ObjectNotFoundError(repo, hash);
    }

    const item = unmarshall(response.Item);

    // Check for inline data
    if (item.inline) {
      return item.inline as Uint8Array;
    }

    // Fetch from S3 using the pinned version
    const key = this.objectKey(repo, hash);
    try {
      const s3Response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          VersionId: item.currentVersion as string,
        })
      );

      if (!s3Response.Body) {
        throw new Error(`Object ${hash} has no body`);
      }

      return s3Response.Body.transformToByteArray();
    } catch (error: any) {
      // If version doesn't exist (shouldn't happen), throw not found
      if (error.name === 'NoSuchKey' || error.Code === 'NoSuchKey' ||
          error.name === 'NoSuchVersion' || error.Code === 'NoSuchVersion') {
        throw new ObjectNotFoundError(repo, hash);
      }
      throw error;
    }
  }

  /**
   * Check if an object exists in the catalogue.
   */
  async exists(repo: string, hash: string): Promise<boolean> {
    const response = await this.dynamo.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({ PK: `OBJ/${repo}`, SK: hash }),
        ProjectionExpression: 'PK',
        ConsistentRead: true,
      })
    );

    return !!response.Item;
  }

  /**
   * Count objects in the catalogue.
   * Uses SELECT COUNT to avoid transferring item data.
   */
  async count(repo: string): Promise<number> {
    let total = 0;
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: marshall({ ':pk': `OBJ/${repo}` }),
          Select: 'COUNT',
          ExclusiveStartKey: exclusiveStartKey,
        })
      );

      total += response.Count ?? 0;
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return total;
  }

  /**
   * List all object hashes in a repository by querying the catalogue.
   */
  async list(repo: string): Promise<string[]> {
    const hashes: string[] = [];
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: marshall({ ':pk': `OBJ/${repo}` }),
          ProjectionExpression: 'SK',
          ExclusiveStartKey: exclusiveStartKey,
          ConsistentRead: true,
        })
      );

      if (response.Items) {
        for (const item of response.Items) {
          const unmarshalled = unmarshall(item);
          hashes.push(unmarshalled.SK as string);
        }
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return hashes;
  }

  /**
   * Delete a batch of S3 objects for a repository.
   *
   * This is used by the delete state machine for incremental deletion.
   * With versioning enabled, this deletes all versions of objects.
   *
   * @param repo - Repository name
   * @param cursor - Optional pagination cursor (S3 key marker)
   * @param batchSize - Number of objects to delete per call (max 1000)
   * @returns Object with deleted count and optional cursor for next batch
   */
  async deleteRepoBatch(
    repo: string,
    cursor?: string,
    batchSize = 1000
  ): Promise<{ deleted: number; cursor?: string }> {
    const prefix = `${repo}/`;

    // Parse cursor for version pagination
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    if (cursor) {
      const parsed = JSON.parse(cursor);
      keyMarker = parsed.keyMarker;
      versionIdMarker = parsed.versionIdMarker;
    }

    // List object versions to delete
    const listResponse = await this.s3.send(
      new ListObjectVersionsCommand({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: Math.min(batchSize, 1000),
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      })
    );

    const versions = [
      ...(listResponse.Versions ?? []),
      ...(listResponse.DeleteMarkers ?? []),
    ];

    if (versions.length === 0) {
      return { deleted: 0 };
    }

    // Delete each version individually (DeleteObjects doesn't work well with versions)
    let deleted = 0;
    for (const version of versions) {
      if (version.Key && version.VersionId) {
        await this.s3.send(
          new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: version.Key,
            VersionId: version.VersionId,
          })
        );
        deleted++;
      }
    }

    // Return cursor for next batch if truncated
    let nextCursor: string | undefined;
    if (listResponse.IsTruncated) {
      nextCursor = JSON.stringify({
        keyMarker: listResponse.NextKeyMarker,
        versionIdMarker: listResponse.NextVersionIdMarker,
      });
    }

    return { deleted, cursor: nextCursor };
  }

  /**
   * Delete catalogue entries for a batch of hashes.
   * Used by GC sweep phase.
   *
   * @param repo - Repository name
   * @param hashes - Array of hashes to delete from catalogue
   */
  async deleteCatalogueEntries(repo: string, hashes: string[]): Promise<void> {
    if (hashes.length === 0) return;

    // BatchWriteItem has a limit of 25 items
    const batchSize = 25;
    for (let i = 0; i < hashes.length; i += batchSize) {
      const batch = hashes.slice(i, i + batchSize);
      await this.dynamo.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [this.tableName]: batch.map((hash) => ({
              DeleteRequest: {
                Key: marshall({ PK: `OBJ/${repo}`, SK: hash }),
              },
            })),
          },
        })
      );
    }
  }

  /**
   * Query catalogue entries for a repository with pagination.
   * Used by GC sweep phase.
   *
   * @param repo - Repository name
   * @param cursor - Optional pagination cursor
   * @param limit - Maximum entries to return
   * @returns Catalogue entries and optional cursor for next batch
   */
  async queryCatalogue(
    repo: string,
    cursor?: string,
    limit = 1000
  ): Promise<{
    entries: Array<{ hash: string; lastReferencedAt: string; currentVersion?: string }>;
    cursor?: string;
  }> {
    let exclusiveStartKey: Record<string, any> | undefined;
    if (cursor) {
      exclusiveStartKey = JSON.parse(cursor);
    }

    const response = await this.dynamo.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: marshall({ ':pk': `OBJ/${repo}` }),
        ProjectionExpression: 'SK, lastReferencedAt, currentVersion',
        ExclusiveStartKey: exclusiveStartKey,
        Limit: limit,
        ConsistentRead: true,
      })
    );

    const entries = (response.Items ?? []).map((item) => {
      const unmarshalled = unmarshall(item);
      return {
        hash: unmarshalled.SK as string,
        lastReferencedAt: unmarshalled.lastReferencedAt as string,
        currentVersion: unmarshalled.currentVersion as string | undefined,
      };
    });

    let nextCursor: string | undefined;
    if (response.LastEvaluatedKey) {
      nextCursor = JSON.stringify(response.LastEvaluatedKey);
    }

    return { entries, cursor: nextCursor };
  }

  /**
   * Get a single catalogue entry.
   * Used by GC cleanup phase to check if a version is current.
   *
   * @param repo - Repository name
   * @param hash - Object hash
   * @returns Catalogue entry or null if not found
   */
  async getCatalogueEntry(
    repo: string,
    hash: string
  ): Promise<{ currentVersion?: string } | null> {
    const response = await this.dynamo.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({ PK: `OBJ/${repo}`, SK: hash }),
        ProjectionExpression: 'currentVersion',
        ConsistentRead: true,
      })
    );

    if (!response.Item) {
      return null;
    }

    const item = unmarshall(response.Item);
    return { currentVersion: item.currentVersion as string | undefined };
  }

  /**
   * Compute SHA256 hash of data.
   */
  private sha256(data: Uint8Array): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Build S3 key for an object.
   */
  private objectKey(repo: string, hash: string): string {
    return `${repo}/objects/${hash}`;
  }
}

/**
 * Error thrown when an object is not found.
 */
class ObjectNotFoundError extends Error {
  constructor(
    public readonly repo: string,
    public readonly hash: string
  ) {
    super(`Object not found: ${hash} in repo ${repo}`);
    this.name = 'ObjectNotFoundError';
  }
}
