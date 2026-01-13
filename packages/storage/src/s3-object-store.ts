/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { createHash } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import type { ObjectStore } from '@elaraai/e3-core';

/**
 * S3-backed ObjectStore implementation.
 *
 * Objects are stored in S3 with the key pattern:
 *   {repo}/objects/{hash}
 *
 * The `repo` parameter is used as a prefix, enabling multiple repositories
 * to share a single S3 bucket with isolated namespaces.
 */
export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string
  ) {}

  /**
   * Write data to S3, returning its SHA256 hash.
   */
  async write(repo: string, data: Uint8Array): Promise<string> {
    const hash = this.sha256(data);
    const key = this.objectKey(repo, hash);

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: 'application/octet-stream',
      })
    );

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
   * Read an object from S3 by its hash.
   * @throws Error if object doesn't exist (S3 NoSuchKey)
   */
  async read(repo: string, hash: string): Promise<Uint8Array> {
    const key = this.objectKey(repo, hash);

    try {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      if (!response.Body) {
        throw new Error(`Object ${hash} has no body`);
      }

      return response.Body.transformToByteArray();
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.Code === 'NoSuchKey') {
        throw new ObjectNotFoundError(repo, hash);
      }
      throw error;
    }
  }

  /**
   * Check if an object exists in S3.
   */
  async exists(repo: string, hash: string): Promise<boolean> {
    const key = this.objectKey(repo, hash);

    try {
      await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.Code === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * List all object hashes in a repository.
   */
  async list(repo: string): Promise<string[]> {
    const prefix = `${repo}/objects/`;
    const hashes: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key) {
            // Extract hash from key: {repo}/objects/{hash}
            const hash = obj.Key.slice(prefix.length);
            if (hash) {
              hashes.push(hash);
            }
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return hashes;
  }

  /**
   * Delete a batch of S3 objects for a repository.
   *
   * This is used by the delete state machine for incremental deletion.
   * Returns a cursor for pagination.
   *
   * @param repo - Repository name
   * @param cursor - Optional pagination cursor (S3 continuation token)
   * @param batchSize - Number of objects to delete per call (max 1000)
   * @returns Object with deleted count and optional cursor for next batch
   */
  async deleteRepoBatch(
    repo: string,
    cursor?: string,
    batchSize = 1000
  ): Promise<{ deleted: number; cursor?: string }> {
    const prefix = `${repo}/`;

    // List objects to delete
    const listResponse = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: Math.min(batchSize, 1000), // S3 DeleteObjects max is 1000
        ContinuationToken: cursor,
      })
    );

    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      return { deleted: 0 };
    }

    const keys = listResponse.Contents
      .filter((obj) => obj.Key)
      .map((obj) => ({ Key: obj.Key! }));

    if (keys.length > 0) {
      await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: keys,
            Quiet: true,
          },
        })
      );
    }

    return {
      deleted: keys.length,
      cursor: listResponse.NextContinuationToken,
    };
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
export class ObjectNotFoundError extends Error {
  constructor(
    public readonly repo: string,
    public readonly hash: string
  ) {
    super(`Object not found: ${hash} in repo ${repo}`);
    this.name = 'ObjectNotFoundError';
  }
}
