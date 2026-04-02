/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import type { S3Client } from '@aws-sdk/client-s3';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { StorageBackend, LogStore, RepoStore, ExecutionStateStore, RefStore, DatasetRefStore } from '@elaraai/e3-core';
import { RepoNotFoundError } from '@elaraai/e3-core';

import type { RepoManager, DataflowRunStore, ExecutionTracker, DataflowStorage, CloudLockService } from '@elaraai/e3-cloud-core';

import { S3ObjectStore } from './s3-object-store.js';
import { DynamoRefStore, DynamoDataflowRunStore } from './dynamo-ref-store.js';
import { DynamoLockService } from './dynamo-lock-service.js';
import { DynamoLogStore } from './dynamo-log-store.js';
import { DynamoS3RepoStore } from './dynamo-s3-repo-store.js';
import { DynamoDBStateStore } from './dynamo-state-store.js';
import { DynamoDatasetRefStore } from './dynamo-dataset-ref-store.js';

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
export class S3DynamoStorage implements StorageBackend, DataflowStorage {
  public readonly objects: S3ObjectStore;
  public readonly refs: RefStore;
  public readonly locks: CloudLockService;
  public readonly logs: LogStore;
  public readonly repos: RepoStore;
  public readonly datasets: DatasetRefStore;
  public readonly executions: ExecutionStateStore;

  /** Cloud-agnostic repo lifecycle management */
  public readonly repoManager: RepoManager;
  /** Cloud-agnostic dataflow run tracking */
  public readonly dataflowRuns: DataflowRunStore;
  /** Cloud-agnostic execution/task status tracking */
  public readonly executionTracker: ExecutionTracker;

  constructor(
    s3: S3Client,
    dynamo: DynamoDBClient,
    bucket: string,
    tableName: string
  ) {
    this.objects = new S3ObjectStore(s3, dynamo, bucket, tableName);
    const dynamoRefs = new DynamoRefStore(dynamo, tableName);
    this.refs = dynamoRefs;
    this.locks = new DynamoLockService(dynamo, tableName);
    this.logs = new DynamoLogStore(dynamo, tableName);
    const dynamoDatasets = new DynamoDatasetRefStore(dynamo, tableName);
    this.datasets = dynamoDatasets;
    this.repos = new DynamoS3RepoStore(s3, dynamo, bucket, tableName, dynamoRefs, this.objects, dynamoDatasets);
    this.executions = new DynamoDBStateStore(dynamo, s3, bucket, tableName);

    // Cloud-agnostic interface accessors (backed by DynamoRefStore)
    this.repoManager = dynamoRefs;
    this.dataflowRuns = new DynamoDataflowRunStore(dynamoRefs);
    this.executionTracker = dynamoRefs;
  }

  /**
   * Validate that a repository exists and is accessible.
   *
   * For cloud storage, a repository is valid if:
   * - It has metadata in DynamoDB
   * - Its status is 'active' or 'gc' (not 'creating' or 'to_delete')
   *
   * @param repo - Repository name
   * @throws {RepoNotFoundError} If repository doesn't exist or is not accessible
   */
  async validateRepository(repo: string): Promise<void> {
    const metadata = await this.repoManager.getRepoMetadata(repo);

    if (!metadata) {
      throw new RepoNotFoundError(repo);
    }

    // Repository exists but is being created or deleted - not accessible
    if (metadata.status === 'creating' || metadata.status === 'to_delete' || metadata.status === 'deleting') {
      throw new RepoNotFoundError(repo);
    }
  }
}
