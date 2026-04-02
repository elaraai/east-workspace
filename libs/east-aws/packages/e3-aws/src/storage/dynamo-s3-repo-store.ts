/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * DynamoS3RepoStore - RepoStore implementation for AWS cloud deployments.
 *
 * Implements the RepoStore interface from e3-core using:
 * - DynamoDB for repository metadata and refs
 * - S3 for object storage and GC temp files
 *
 * This class provides repository lifecycle operations including:
 * - Create/delete repositories
 * - Status tracking with atomic transitions
 * - Batched deletion for refs and objects
 * - Mark-sweep garbage collection
 */

import {
  S3Client,
  ListObjectVersionsCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type _Object,
} from '@aws-sdk/client-s3';
import {
  DynamoDBClient,
  QueryCommand,
  ConditionalCheckFailedException,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { decodeBeast2For } from '@elaraai/east';
import { WorkspaceStateType, ExecutionStatusType } from '@elaraai/e3-types';
import type {
  RepoStore,
  RepoStatus,
  RepoMetadata,
  BatchResult,
  GcRootScanResult,
  GcObjectScanResult,
  GcObjectEntry,
} from '@elaraai/e3-core';
import {
  RepoNotFoundError,
  RepoAlreadyExistsError,
  RepoStatusConflictError,
} from '@elaraai/e3-core';

import type { DynamoRefStore } from './dynamo-ref-store.js';
import { InvalidRepoStatusError } from './dynamo-ref-store.js';
import type { S3ObjectStore } from './s3-object-store.js';
import type { DynamoDatasetRefStore } from './dynamo-dataset-ref-store.js';

// Default minimum age for GC cleanup S3 versions (24 hours)
const DEFAULT_CLEANUP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

// Batch sizes for operations
const QUERY_BATCH_SIZE = 1000;

/** Map e3-core RepoStatus to cloud-internal RepoStatus (superset with 'to_delete'). */
type CloudRepoStatus = import('@elaraai/e3-cloud-core').RepoStatus;
const toCloudStatus = (s: RepoStatus): CloudRepoStatus =>
  s === 'deleting' ? 'to_delete' : s as CloudRepoStatus;

/**
 * Extended repository metadata including AWS-specific fields.
 * This is returned by the internal getRepoMetadata method.
 */
interface CloudRepoMetadata {
  name: string;
  status: CloudRepoStatus;
  createdAt: string;
  statusChangedAt: string;
  executionRef?: string;
}

/**
 * DynamoDB + S3 implementation of RepoStore.
 *
 * Provides repository lifecycle management for e3 cloud deployments,
 * implementing the standard RepoStore interface from e3-core.
 */
export class DynamoS3RepoStore implements RepoStore {
  constructor(
    private readonly s3: S3Client,
    private readonly dynamo: DynamoDBClient,
    private readonly bucket: string,
    private readonly tableName: string,
    private readonly refs: DynamoRefStore,
    private readonly objects: S3ObjectStore,
    private readonly datasets: DynamoDatasetRefStore
  ) {}

  // ===========================================================================
  // Queries
  // ===========================================================================

  async list(): Promise<string[]> {
    return this.refs.listRepos(false);
  }

  async exists(repo: string): Promise<boolean> {
    return this.refs.repoExists(repo);
  }

  async getMetadata(repo: string): Promise<RepoMetadata | null> {
    const metadata = await this.refs.getRepoMetadata(repo);
    if (!metadata) {
      return null;
    }
    // Map cloud-internal statuses to e3-core client-facing status
    const status: RepoStatus = (metadata.status === 'to_delete' || metadata.status === 'deleting')
      ? 'deleting' : metadata.status;
    return {
      name: metadata.name,
      status,
      createdAt: metadata.createdAt,
      statusChangedAt: metadata.statusChangedAt,
    };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async create(repo: string): Promise<void> {
    try {
      await this.refs.createRepo(repo);
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        throw new RepoAlreadyExistsError(repo);
      }
      throw error;
    }
  }

  async setStatus(
    repo: string,
    status: RepoStatus,
    expected?: RepoStatus | RepoStatus[]
  ): Promise<void> {
    const cloudStatus = toCloudStatus(status);
    const cloudExpected = expected !== undefined
      ? (Array.isArray(expected) ? expected.map(toCloudStatus) : toCloudStatus(expected))
      : undefined;
    try {
      if (cloudExpected !== undefined) {
        await this.refs.setRepoStatus(repo, cloudExpected, cloudStatus);
      } else {
        const metadata = await this.refs.getRepoMetadata(repo);
        if (!metadata) {
          throw new RepoNotFoundError(repo);
        }
        await this.refs.setRepoStatus(repo, metadata.status, cloudStatus);
      }
    } catch (error) {
      if (error instanceof InvalidRepoStatusError) {
        throw new RepoStatusConflictError(
          error.repo,
          error.expectedStatus,
          error.actualStatus
        );
      }
      throw error;
    }
  }

  async remove(repo: string): Promise<void> {
    await this.refs.removeRepoMetadata(repo);
  }

  // ===========================================================================
  // AWS-Specific Extension: Set status with execution ARN
  // ===========================================================================

  /**
   * Set repository status with execution reference tracking.
   * This is an AWS-specific extension for Lambda handlers.
   *
   * @param repo - Repository name
   * @param status - New status
   * @param expected - Expected current status for CAS
   * @param executionRef - Execution reference to track
   */
  async setStatusWithExecutionRef(
    repo: string,
    status: RepoStatus,
    expected: RepoStatus | RepoStatus[],
    executionRef?: string
  ): Promise<void> {
    const cloudStatus = toCloudStatus(status);
    const cloudExpected = Array.isArray(expected) ? expected.map(toCloudStatus) : toCloudStatus(expected);
    try {
      await this.refs.setRepoStatus(repo, cloudExpected, cloudStatus, executionRef);
    } catch (error) {
      if (error instanceof InvalidRepoStatusError) {
        throw new RepoStatusConflictError(
          error.repo,
          error.expectedStatus,
          error.actualStatus
        );
      }
      throw error;
    }
  }

  /**
   * Get full cloud metadata including execution reference.
   * This is an AWS-specific extension for Lambda handlers.
   */
  async getCloudMetadata(repo: string): Promise<CloudRepoMetadata | null> {
    return this.refs.getRepoMetadata(repo);
  }

  // ===========================================================================
  // Batched Deletion
  // ===========================================================================

  async deleteRefsBatch(repo: string, cursor?: string): Promise<BatchResult> {
    const result = await this.refs.deleteRepoBatch(repo, cursor);
    return {
      status: result.cursor ? 'continue' : 'done',
      cursor: result.cursor,
      deleted: result.deleted,
    };
  }

  async deleteObjectsBatch(repo: string, cursor?: string): Promise<BatchResult> {
    const result = await this.objects.deleteRepoBatch(repo, cursor);
    return {
      status: result.cursor ? 'continue' : 'done',
      cursor: result.cursor,
      deleted: result.deleted,
    };
  }

  // ===========================================================================
  // GC Data-Access Primitives
  // ===========================================================================

  async gcScanPackageRoots(repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    const roots: string[] = [];
    const packages = await this.queryPartition(`PKG/${repo}`);
    for (const item of packages) {
      if (item.hash && this.isValidHash(item.hash)) {
        roots.push(item.hash as string);
      }
    }
    return { roots };
  }

  async gcScanWorkspaceRoots(repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    const roots: string[] = [];
    const workspaces = await this.queryPartition(`WS/${repo}`);
    for (const item of workspaces) {
      if (item.state) {
        try {
          const stateData = item.state as Uint8Array;
          if (stateData.length > 0) {
            const decoder = decodeBeast2For(WorkspaceStateType);
            const state = decoder(stateData);
            if (this.isValidHash(state.packageHash)) {
              roots.push(state.packageHash);
            }
          }
        } catch {
          // Failed to decode workspace state - skip
        }
      }

      // Scan per-dataset refs for this workspace (single query via listWithRefs)
      const wsName = item.SK as string;
      if (wsName) {
        try {
          const entries = await this.datasets.listWithRefs(repo, wsName);
          for (const entry of entries) {
            if (entry.ref.type === 'value' && this.isValidHash(entry.ref.value.hash)) {
              roots.push(entry.ref.value.hash);
            }
          }
        } catch {
          // Failed to read dataset refs - skip
        }
      }
    }
    return { roots };
  }

  async gcScanExecutionRoots(repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    const roots: string[] = [];

    // 1. Legacy execution state (PK: REPO#{repo}, SK: EXEC#...)
    const executions = await this.queryPartition(`REPO#${repo}`, 'EXEC#');
    for (const item of executions) {
      if (item.outputHash && this.isValidHash(item.outputHash)) {
        roots.push(item.outputHash as string);
      }
    }

    // 2. Trace: WS → EXEC → TASK → taskHashes, collecting outputHash from TASK items
    const workspaces = await this.queryPartition(`WS/${repo}`);
    const taskHashes = new Set<string>();

    for (const ws of workspaces) {
      const wsName = ws.SK as string;
      if (!wsName) continue;

      const execItems = await this.queryPartition(`EXEC/${repo}/${wsName}`);
      for (const execItem of execItems) {
        const id = execItem.id as number | undefined;
        if (id === undefined) continue; // skip counter record

        const taskItems = await this.queryPartition(`TASK/${repo}/${id}`);
        for (const taskItem of taskItems) {
          // Collect outputHash from TASK items
          if (taskItem.outputHash && this.isValidHash(taskItem.outputHash)) {
            roots.push(taskItem.outputHash as string);
          }
          if (taskItem.taskHash) {
            taskHashes.add(taskItem.taskHash as string);
          }
        }
      }
    }

    // 3. Trace taskHashes → CACHE (outputHash) and TASK_EXEC/TASK_LOG (BEAST2-encoded status)
    const decodeStatus = decodeBeast2For(ExecutionStatusType);

    for (const taskHash of taskHashes) {
      // CACHE/{repo}/{taskHash} → outputHash
      const cacheItems = await this.queryPartition(`CACHE/${repo}/${taskHash}`);
      for (const item of cacheItems) {
        if (item.outputHash && this.isValidHash(item.outputHash)) {
          roots.push(item.outputHash as string);
        }
      }

      // TASK_EXEC/{repo}/{taskHash} → BEAST2-encoded status with outputHash
      const taskExecItems = await this.queryPartition(`TASK_EXEC/${repo}/${taskHash}`);
      for (const item of taskExecItems) {
        if (item.status) {
          try {
            const statusBytes = item.status as Uint8Array;
            const status = decodeStatus(statusBytes) as unknown as { type: string; value: { outputHash?: string } };
            if (status.type === 'success' && this.isValidHash(status.value.outputHash)) {
              roots.push(status.value.outputHash as string);
            }
          } catch {
            // Failed to decode execution status - skip corrupted record
          }
        }
      }

      // TASK_LOG/{repo}/{taskHash}/{inputsHash} → BEAST2-encoded status
      for (const taskExecItem of taskExecItems) {
        const inputsHash = taskExecItem.SK as string;
        const logItems = await this.queryPartition(`TASK_LOG/${repo}/${taskHash}/${inputsHash}`);
        for (const logItem of logItems) {
          if (logItem.status) {
            try {
              const statusBytes = logItem.status as Uint8Array;
              const status = decodeStatus(statusBytes) as unknown as { type: string; value: { outputHash?: string } };
              if (status.type === 'success' && this.isValidHash(status.value.outputHash)) {
                roots.push(status.value.outputHash as string);
              }
            } catch {
              // Failed to decode execution status - skip corrupted record
            }
          }
        }
      }
    }

    return { roots };
  }

  async gcScanObjects(repo: string, cursor?: unknown): Promise<GcObjectScanResult> {
    let exclusiveStartKey: Record<string, AttributeValue> | undefined;
    if (cursor) {
      exclusiveStartKey = cursor as Record<string, AttributeValue>;
    }

    const queryResponse = await this.dynamo.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: marshall({ ':pk': `OBJ/${repo}` }),
        ProjectionExpression: 'PK, SK, lastReferencedAt, #size',
        ExpressionAttributeNames: { '#size': 'size' },
        ExclusiveStartKey: exclusiveStartKey,
        Limit: QUERY_BATCH_SIZE,
        ConsistentRead: true,
      })
    );

    const objects: GcObjectEntry[] = [];
    if (queryResponse.Items) {
      for (const item of queryResponse.Items) {
        const unmarshalled = unmarshall(item);
        const hash = unmarshalled.SK as string;
        const lastReferencedAt = unmarshalled.lastReferencedAt as string | undefined;
        const size = (unmarshalled.size as number) || 0;
        objects.push({
          hash,
          lastModified: lastReferencedAt ? new Date(lastReferencedAt).getTime() : 0,
          size,
        });
      }
    }

    return {
      objects,
      cursor: queryResponse.LastEvaluatedKey,
    };
  }

  async gcDeleteObjects(repo: string, hashes: string[]): Promise<void> {
    if (hashes.length > 0) {
      await this.objects.deleteCatalogueEntries(repo, hashes);
    }
  }

  // ===========================================================================
  // Cloud-Specific GC Helpers (not part of RepoStore interface)
  // ===========================================================================

  /**
   * Clean up orphaned S3 versions.
   */
  async cleanupOrphanedVersions(repo: string): Promise<void> {
    const prefix = `${repo}/objects/`;
    const cutoffTime = new Date(Date.now() - DEFAULT_CLEANUP_MIN_AGE_MS);
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;

    do {
      const listResponse = await this.s3.send(
        new ListObjectVersionsCommand({
          Bucket: this.bucket,
          Prefix: prefix,
          MaxKeys: 1000,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        })
      );

      const versions = listResponse.Versions ?? [];

      for (const version of versions) {
        if (!version.Key || !version.VersionId || !version.LastModified) {
          continue;
        }

        // Extract hash from key
        const hash = version.Key.slice(prefix.length);
        if (!hash || !/^[a-f0-9]{64}$/.test(hash)) {
          continue;
        }

        // Skip if version is too young
        if (version.LastModified > cutoffTime) {
          continue;
        }

        // Check if this version is current
        const catalogueEntry = await this.objects.getCatalogueEntry(repo, hash);
        if (catalogueEntry && catalogueEntry.currentVersion === version.VersionId) {
          continue;
        }

        // Version is orphaned - delete it
        await this.s3.send(
          new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: version.Key,
            VersionId: version.VersionId,
          })
        );
      }

      if (listResponse.IsTruncated) {
        keyMarker = listResponse.NextKeyMarker;
        versionIdMarker = listResponse.NextVersionIdMarker;
      } else {
        break;
      }
    } while (true);
  }

  /**
   * Clean up temporary GC files.
   */
  async cleanupTempFiles(gcId: string): Promise<void> {
    const gcTempPrefix = `gc-temp/${gcId}/`;
    let continuationToken: string | undefined;

    do {
      const listResponse = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: gcTempPrefix,
          ContinuationToken: continuationToken,
        })
      );

      if (listResponse.Contents && listResponse.Contents.length > 0) {
        const toDelete = listResponse.Contents
          .filter((obj: _Object) => obj.Key)
          .map((obj: _Object) => ({ Key: obj.Key! }));

        if (toDelete.length > 0) {
          await this.s3.send(
            new DeleteObjectsCommand({
              Bucket: this.bucket,
              Delete: {
                Objects: toDelete,
                Quiet: true,
              },
            })
          );
        }
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);
  }

  /**
   * Query all items from a partition, handling pagination.
   */
  private async queryPartition(
    pk: string,
    skPrefix?: string
  ): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let exclusiveStartKey: Record<string, AttributeValue> | undefined;

    const keyCondition = skPrefix
      ? 'PK = :pk AND begins_with(SK, :prefix)'
      : 'PK = :pk';
    const expressionValues = skPrefix
      ? { ':pk': pk, ':prefix': skPrefix }
      : { ':pk': pk };

    do {
      const response = await this.dynamo.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: keyCondition,
          ExpressionAttributeValues: marshall(expressionValues),
          ExclusiveStartKey: exclusiveStartKey,
          ConsistentRead: true,
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
   * Validate that a string looks like a SHA256 hash.
   */
  private isValidHash(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  }
}
