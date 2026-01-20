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
  UpdateItemCommand,
  ScanCommand,
  BatchWriteItemCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { encodeBeast2For, decodeBeast2For } from '@elaraai/east';
import type { RefStore } from '@elaraai/e3-core';
import { ExecutionStatusType, type ExecutionStatus } from '@elaraai/e3-types';

// BEAST2 encoder/decoder for ExecutionStatus (includes Date fields)
const encodeExecutionStatus = encodeBeast2For(ExecutionStatusType);
const decodeExecutionStatus = decodeBeast2For(ExecutionStatusType);

/**
 * Repository lifecycle status.
 *
 * State transitions:
 *   CREATING → ACTIVE (on successful creation)
 *   ACTIVE → GC (on GC start)
 *   ACTIVE → DELETING (on delete start)
 *   GC → ACTIVE (on GC complete)
 *   DELETING → (repo removed)
 *
 * Note: GC → DELETING is blocked (must wait for GC to complete)
 */
export type RepoStatus = 'creating' | 'active' | 'gc' | 'deleting';

/**
 * Repository metadata stored in DynamoDB.
 */
export interface RepoMetadata {
  /** Repository name */
  name: string;
  /** Current lifecycle status */
  status: RepoStatus;
  /** When the repo was created */
  createdAt: string;
  /** When the repo entered its current status */
  statusChangedAt: string;
  /** Step Function execution ARN for current operation (if any) */
  executionArn?: string;
}

/**
 * Error thrown when a repo status transition is invalid.
 */
export class InvalidRepoStatusError extends Error {
  constructor(
    public readonly repo: string,
    public readonly expectedStatus: RepoStatus | RepoStatus[],
    public readonly actualStatus: RepoStatus | 'not_found'
  ) {
    const expected = Array.isArray(expectedStatus) ? expectedStatus.join(' or ') : expectedStatus;
    super(`Repository '${repo}' status is '${actualStatus}', expected '${expected}'`);
    this.name = 'InvalidRepoStatusError';
  }
}

/**
 * Execution state for a workspace dataflow.
 */
export interface DataflowExecutionState {
  executionId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  taskCount: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  cachedCount: number;
}

/**
 * Task status within a dataflow execution.
 */
export interface TaskExecutionStatus {
  taskName: string;
  status: 'dispatched' | 'running' | 'success' | 'cached' | 'failed' | 'error' | 'skipped' | 'ready';
  outputHash?: string;
  exitCode?: number;
  error?: string;
  duration?: number;
  readyAt?: string;     // ISO timestamp when task became ready
  completedAt?: string; // ISO timestamp when task completed
}

/**
 * Dataflow event types recorded by the orchestrator.
 */
export interface DataflowEvent {
  seq: number;
  type: 'start' | 'complete' | 'cached' | 'failed' | 'error' | 'skipped';
  task: string;
  timestamp: string;
  duration?: number;
  exitCode?: number;
  message?: string;
  reason?: string;
}

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
    // Status is stored as Binary (BEAST2-encoded ExecutionStatus)
    const statusBytes = item.status as Uint8Array;
    return decodeExecutionStatus(statusBytes) as unknown as ExecutionStatus;
  }

  async executionWrite(repo: string, taskHash: string, inputsHash: string, status: ExecutionStatus): Promise<void> {
    // Encode status as BEAST2 binary (ExecutionStatus contains Date fields)
    const statusBytes = encodeExecutionStatus(status as unknown as Parameters<typeof encodeExecutionStatus>[0]);
    await this.putItem(repo, `EXEC#${taskHash}#${inputsHash}`, {
      status: statusBytes,
      updatedAt: new Date().toISOString(),
    });
  }

  async executionGetOutput(repo: string, taskHash: string, inputsHash: string): Promise<string | null> {
    const item = await this.getItem(repo, `EXEC#${taskHash}#${inputsHash}`);
    if (!item?.status) {
      return null;
    }
    // Decode BEAST2-encoded status and extract outputHash from success variant
    const statusBytes = item.status as Uint8Array;
    const status = decodeExecutionStatus(statusBytes) as unknown as ExecutionStatus;
    if (status.type === 'success') {
      return status.value.outputHash;
    }
    return null;
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
  // Repository Management (cloud-specific, not part of RefStore interface)
  // ===========================================================================

  /**
   * List all repositories with their status.
   *
   * Scans for items with SK=#META (each repo has a metadata item).
   * Only returns repos with status='active' by default.
   *
   * @param includeAll - If true, include repos in all statuses
   */
  async listRepos(includeAll = false): Promise<string[]> {
    const repos: string[] = [];
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const response = await this.dynamo.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: includeAll
            ? 'SK = :sk'
            : 'SK = :sk AND #status = :active',
          ExpressionAttributeNames: includeAll ? undefined : { '#status': 'status' },
          ExpressionAttributeValues: marshall(
            includeAll
              ? { ':sk': '#META' }
              : { ':sk': '#META', ':active': 'active' }
          ),
          ProjectionExpression: 'PK',
          ExclusiveStartKey: exclusiveStartKey,
        })
      );

      if (response.Items) {
        for (const item of response.Items) {
          const pk = unmarshall(item).PK as string;
          // PK format: REPO#{repo}
          if (pk.startsWith('REPO#')) {
            repos.push(pk.slice(5));
          }
        }
      }

      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return repos;
  }

  /**
   * Get repository metadata.
   *
   * @param repo - Repository name
   * @returns Metadata if repo exists, null otherwise
   */
  async getRepoMetadata(repo: string): Promise<RepoMetadata | null> {
    const response = await this.dynamo.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: `REPO#${repo}`,
          SK: '#META',
        }),
      })
    );

    if (!response.Item) {
      return null;
    }

    const item = unmarshall(response.Item);
    return {
      name: item.name as string,
      status: (item.status as RepoStatus) ?? 'active', // Default for legacy repos
      createdAt: item.createdAt as string,
      statusChangedAt: (item.statusChangedAt as string) ?? item.createdAt,
      executionArn: item.executionArn as string | undefined,
    };
  }

  /**
   * Create a repository with status='active'.
   *
   * This is an atomic operation - either the repo is created successfully
   * or it fails (e.g., if repo already exists).
   *
   * @param repo - Repository name
   * @throws ConditionalCheckFailedException if repo already exists
   */
  async createRepo(repo: string): Promise<void> {
    const now = new Date().toISOString();
    await this.dynamo.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: marshall({
          PK: `REPO#${repo}`,
          SK: '#META',
          name: repo,
          status: 'active',
          createdAt: now,
          statusChangedAt: now,
        }),
        // Only succeed if repo doesn't already exist
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );
  }

  /**
   * Transition repository to a new status.
   *
   * Uses conditional write to ensure atomic state transition.
   * Optionally stores the Step Function execution ARN for tracking.
   *
   * @param repo - Repository name
   * @param expectedStatus - Current status(es) required for transition
   * @param newStatus - Target status
   * @param executionArn - Optional Step Function execution ARN
   * @throws InvalidRepoStatusError if current status doesn't match expected
   */
  async setRepoStatus(
    repo: string,
    expectedStatus: RepoStatus | RepoStatus[],
    newStatus: RepoStatus,
    executionArn?: string
  ): Promise<void> {
    const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    const now = new Date().toISOString();

    // Build condition expression for expected statuses
    const statusConditions = expected.map((_, i) => `#status = :expected${i}`).join(' OR ');

    const expressionAttributeValues: Record<string, any> = {
      ':newStatus': newStatus,
      ':now': now,
    };
    expected.forEach((status, i) => {
      expressionAttributeValues[`:expected${i}`] = status;
    });

    // Build update expression
    let updateExpression = 'SET #status = :newStatus, statusChangedAt = :now';
    if (executionArn !== undefined) {
      updateExpression += ', executionArn = :executionArn';
      expressionAttributeValues[':executionArn'] = executionArn;
    } else {
      updateExpression += ' REMOVE executionArn';
    }

    try {
      await this.dynamo.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({
            PK: `REPO#${repo}`,
            SK: '#META',
          }),
          UpdateExpression: updateExpression,
          ConditionExpression: `attribute_exists(PK) AND (${statusConditions})`,
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: marshall(expressionAttributeValues),
        })
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        // Get actual status to provide better error message
        const metadata = await this.getRepoMetadata(repo);
        throw new InvalidRepoStatusError(
          repo,
          expectedStatus,
          metadata?.status ?? 'not_found'
        );
      }
      throw error;
    }
  }

  /**
   * Check if a repository exists.
   *
   * @param repo - Repository name
   */
  async repoExists(repo: string): Promise<boolean> {
    const response = await this.dynamo.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: `REPO#${repo}`,
          SK: '#META',
        }),
      })
    );
    return response.Item !== undefined;
  }

  /**
   * Delete a batch of DynamoDB items for a repository.
   *
   * This is used by the delete state machine for incremental deletion.
   * Returns a cursor for pagination.
   *
   * @param repo - Repository name
   * @param cursor - Optional pagination cursor (lastEvaluatedKey as JSON)
   * @param batchSize - Number of items to delete per call
   * @returns Object with deleted count and optional cursor for next batch
   */
  async deleteRepoBatch(
    repo: string,
    cursor?: string,
    batchSize = 100
  ): Promise<{ deleted: number; cursor?: string }> {
    const exclusiveStartKey = cursor ? JSON.parse(cursor) : undefined;

    // Query for items to delete
    const response = await this.dynamo.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: marshall({
          ':pk': `REPO#${repo}`,
        }),
        ProjectionExpression: 'PK, SK',
        Limit: batchSize,
        ExclusiveStartKey: exclusiveStartKey,
      })
    );

    if (!response.Items || response.Items.length === 0) {
      return { deleted: 0 };
    }

    const items = response.Items.map((item) => {
      const unmarshalled = unmarshall(item);
      return { PK: unmarshalled.PK as string, SK: unmarshalled.SK as string };
    });

    // Batch delete in groups of 25 (DynamoDB limit)
    const deleteBatchSize = 25;
    for (let i = 0; i < items.length; i += deleteBatchSize) {
      const batch = items.slice(i, i + deleteBatchSize);
      await this.dynamo.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [this.tableName]: batch.map((item) => ({
              DeleteRequest: {
                Key: marshall({ PK: item.PK, SK: item.SK }),
              },
            })),
          },
        })
      );
    }

    return {
      deleted: items.length,
      cursor: response.LastEvaluatedKey
        ? JSON.stringify(response.LastEvaluatedKey)
        : undefined,
    };
  }

  /**
   * Delete a repository and all its items.
   *
   * @deprecated Use deleteRepoBatch with state machine for large repos.
   * This synchronous method is kept for backwards compatibility.
   *
   * @param repo - Repository name
   */
  async deleteRepo(repo: string): Promise<void> {
    let cursor: string | undefined;
    do {
      const result = await this.deleteRepoBatch(repo, cursor, 100);
      cursor = result.cursor;
    } while (cursor);
  }

  /**
   * Remove only the repository metadata item.
   *
   * Called as the final step after all other repo items are deleted.
   *
   * @param repo - Repository name
   */
  async removeRepoMetadata(repo: string): Promise<void> {
    await this.dynamo.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: `REPO#${repo}`,
          SK: '#META',
        }),
      })
    );
  }

  // ===========================================================================
  // Dataflow Execution State (for Step Functions orchestration)
  // ===========================================================================

  /**
   * Get the current execution state for a workspace.
   */
  async getExecutionState(repo: string, workspace: string): Promise<DataflowExecutionState | null> {
    const item = await this.getItem(repo, `EXEC#STATE#${workspace}`);
    if (!item) return null;

    return {
      executionId: item.executionId as string,
      status: item.status as 'running' | 'completed' | 'failed',
      startedAt: item.startedAt as string,
      completedAt: item.completedAt as string | undefined,
      taskCount: item.taskCount as number,
      completedCount: (item.completedCount as number) || 0,
      failedCount: (item.failedCount as number) || 0,
      skippedCount: (item.skippedCount as number) || 0,
      cachedCount: (item.cachedCount as number) || 0,
    };
  }

  /**
   * Get all task statuses for a dataflow execution.
   */
  async getExecutionTasks(repo: string, executionId: string): Promise<TaskExecutionStatus[]> {
    const items = await this.queryByPrefix(repo, `EXEC#TASK#${executionId}#`);
    return items.map(item => {
      const sk = item.SK as string;
      const prefixLen = `EXEC#TASK#${executionId}#`.length;
      const taskName = sk.slice(prefixLen);

      return {
        taskName,
        status: item.status as TaskExecutionStatus['status'],
        outputHash: item.outputHash as string | undefined,
        exitCode: item.exitCode as number | undefined,
        error: item.error as string | undefined,
        duration: item.duration as number | undefined,
        readyAt: item.readyAt as string | undefined,
        completedAt: item.completedAt as string | undefined,
      };
    });
  }

  /**
   * Get stored graph for an execution.
   */
  async getExecutionGraph(repo: string, executionId: string): Promise<string | null> {
    const item = await this.getItem(repo, `EXEC#GRAPH#${executionId}`);
    return item?.graph as string | null;
  }

  /**
   * Get events for a dataflow execution with pagination.
   *
   * Events are stored with sequence numbers (SK: EXEC#EVENT#{executionId}#{seq})
   * which provides stable ordering for offset-based pagination.
   *
   * @param repo - Repository name
   * @param executionId - Execution ID
   * @param offset - Number of events to skip (default: 0)
   * @param limit - Maximum number of events to return (default: all)
   * @returns Object with events array and total count
   */
  async getExecutionEvents(
    repo: string,
    executionId: string,
    offset = 0,
    limit?: number
  ): Promise<{ events: DataflowEvent[]; total: number }> {
    // Query all events for this execution (they're sorted by sequence number)
    const items = await this.queryByPrefix(repo, `EXEC#EVENT#${executionId}#`);

    const total = items.length;

    // Apply pagination
    const start = offset;
    const end = limit !== undefined ? offset + limit : items.length;
    const paginatedItems = items.slice(start, end);

    // Map to DataflowEvent
    const events: DataflowEvent[] = paginatedItems.map(item => {
      const sk = item.SK as string;
      // SK format: EXEC#EVENT#{executionId}#{seq}
      const seqStr = sk.split('#').pop()!;
      const seq = parseInt(seqStr, 10);

      return {
        seq,
        type: item.eventType as DataflowEvent['type'],
        task: item.task as string,
        timestamp: item.timestamp as string,
        duration: item.duration as number | undefined,
        exitCode: item.exitCode as number | undefined,
        message: item.message as string | undefined,
        reason: item.reason as string | undefined,
      };
    });

    return { events, total };
  }

  // ===========================================================================
  // Internal Helpers
  // ===========================================================================

  /**
   * Query items by SK prefix.
   *
   * Uses strongly consistent reads to avoid eventual consistency issues.
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
   * Get a single item by PK and SK.
   *
   * Uses strongly consistent reads to avoid eventual consistency issues
   * where a write from one Lambda invocation might not be visible to
   * another Lambda invocation hitting a different DynamoDB replica.
   */
  private async getItem(repo: string, sk: string): Promise<Record<string, unknown> | null> {
    const response = await this.dynamo.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: `REPO#${repo}`,
          SK: sk,
        }),
        ConsistentRead: true,
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
