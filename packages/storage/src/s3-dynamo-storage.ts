/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import type { S3Client } from '@aws-sdk/client-s3';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { StorageBackend, ObjectStore, RefStore, LockService, LogStore } from '@elaraai/e3-core';
import { RepositoryNotFoundError } from '@elaraai/e3-core';

import { S3ObjectStore } from './s3-object-store.js';
import { DynamoRefStore } from './dynamo-ref-store.js';
import { DynamoLockService } from './dynamo-lock-service.js';
import { DynamoLogStore } from './dynamo-log-store.js';

/**
 * S3 + DynamoDB backed StorageBackend implementation.
 *
 * This is the main storage backend for e3 cloud deployments:
 * - Objects: S3 (content-addressed, keyed by {repo}/objects/{hash})
 * - Refs: DynamoDB (packages, workspaces, executions)
 * - Locks: DynamoDB (with TTL for automatic cleanup)
 * - Logs: DynamoDB (chunked for real-time access)
 *
 * The backend is initialized once at Lambda cold start with the AWS clients
 * and resource names. The `repo` parameter is passed to each method call,
 * enabling multiple repositories to share the same S3 bucket and DynamoDB table.
 *
 * @example
 * ```typescript
 * // Initialize once at Lambda cold start
 * const storage = new S3DynamoStorage(
 *   new S3Client({}),
 *   new DynamoDBClient({}),
 *   process.env.BUCKET_NAME!,
 *   process.env.TABLE_NAME!
 * );
 *
 * // Use with repo from URL
 * const workspaces = await storage.refs.workspaceList(repo);
 * ```
 */
export class S3DynamoStorage implements StorageBackend {
  public readonly objects: ObjectStore;
  public readonly refs: DynamoRefStore;
  public readonly locks: LockService;
  public readonly logs: LogStore;

  constructor(
    s3: S3Client,
    dynamo: DynamoDBClient,
    bucket: string,
    tableName: string
  ) {
    this.objects = new S3ObjectStore(s3, dynamo, bucket, tableName);
    this.refs = new DynamoRefStore(dynamo, tableName);
    this.locks = new DynamoLockService(dynamo, tableName);
    this.logs = new DynamoLogStore(dynamo, tableName);
  }

  /**
   * Validate that a repository exists and is accessible.
   *
   * For cloud storage, a repository is valid if:
   * - It has metadata in DynamoDB
   * - Its status is 'active' or 'gc' (not 'creating' or 'deleting')
   *
   * @param repo - Repository name
   * @throws {RepositoryNotFoundError} If repository doesn't exist or is not accessible
   */
  async validateRepository(repo: string): Promise<void> {
    const metadata = await this.refs.getRepoMetadata(repo);

    if (!metadata) {
      throw new RepositoryNotFoundError(repo);
    }

    // Repository exists but is being created or deleted - not accessible
    if (metadata.status === 'creating' || metadata.status === 'deleting') {
      throw new RepositoryNotFoundError(repo);
    }
  }
}
