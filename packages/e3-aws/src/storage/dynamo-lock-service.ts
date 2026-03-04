/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  UpdateItemCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { LockHandle, LockState, LockOperation } from '@elaraai/e3-core';
import type { CloudLockService } from '@elaraai/e3-cloud-core';
import {
  variant,
  none,
  some,
  printFor,
  parseInferred,
  VariantType,
  StructType,
  StringType,
} from '@elaraai/east';

/**
 * Default lock expiry in seconds.
 * Locks older than this are considered stale and can be overwritten.
 */
const DEFAULT_LOCK_TTL_SECONDS = 300; // 5 minutes

/**
 * Polling interval when waiting for a lock.
 */
const LOCK_POLL_INTERVAL_MS = 1000;

/**
 * Lambda-specific holder information.
 */
interface LambdaHolderInfo {
  requestId: string;
  functionName: string;
}

/**
 * East type for Lambda holder, used for East text encoding.
 */
const LambdaHolderType = StructType({
  requestId: StringType,
  functionName: StringType,
});

/**
 * Variant type for encoding holder as East text.
 * The holder string stores `.lambda (...)` format.
 */
const HolderVariantType = VariantType({
  lambda: LambdaHolderType,
});

/** Print a lambda holder to East text format */
const printLambdaHolder = printFor(HolderVariantType);

/**
 * Parse an East text holder string.
 * Returns the parsed variant or null if parsing fails.
 */
function parseHolder(holderStr: string): { type: string; value: any } | null {
  try {
    const [_type, value] = parseInferred(holderStr);
    return value as { type: string; value: any };
  } catch {
    return null;
  }
}

/**
 * DynamoDB-backed LockService implementation.
 *
 * Uses conditional writes for atomic lock acquisition:
 *   PK: LOCK/{repo}
 *   SK: {resource}
 *
 * Locks have a TTL for automatic cleanup by DynamoDB.
 * Holder info is stored as an East text string (e.g., `.lambda (requestId="...", functionName="...")`).
 */
export class DynamoLockService implements CloudLockService {
  constructor(
    private readonly dynamo: DynamoDBClient,
    private readonly tableName: string
  ) {}

  /**
   * Acquire a lock on a resource.
   *
   * Supports two modes:
   * - exclusive (default): Only one holder at a time. Uses conditional write.
   * - shared: Multiple concurrent holders. Uses atomic counter.
   */
  async acquire(
    repo: string,
    resource: string,
    operation: LockOperation,
    options?: { wait?: boolean; timeout?: number; mode?: 'shared' | 'exclusive' }
  ): Promise<LockHandle | null> {
    const wait = options?.wait ?? false;
    const timeout = options?.timeout ?? 30000;
    const mode = options?.mode ?? 'exclusive';
    const startTime = Date.now();

    while (true) {
      const acquired = mode === 'shared'
        ? await this.tryAcquireShared(repo, resource, operation)
        : await this.tryAcquire(repo, resource, operation);
      if (acquired) {
        return acquired;
      }

      if (!wait) {
        return null;
      }

      // Check timeout
      if (Date.now() - startTime >= timeout) {
        return null;
      }

      // Wait before retrying
      await sleep(LOCK_POLL_INTERVAL_MS);
    }
  }

  /**
   * Get the current lock state.
   */
  async getState(repo: string, resource: string): Promise<LockState | null> {
    const response = await this.dynamo.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({
          PK: `LOCK/${repo}`,
          SK: resource,
        }),
        ConsistentRead: true,
      })
    );

    if (!response.Item) {
      return null;
    }

    const item = unmarshall(response.Item);

    // Holder is stored as East text string (e.g., `.lambda (requestId="...", functionName="...")`)
    // Note: We use type assertion via unknown because different east versions have incompatible variant_symbol
    return {
      holder: item.holder as string,
      operation: item.operation as LockOperation,
      acquiredAt: new Date(item.acquiredAt),
      expiresAt: (item.expiresAt ? some(new Date(item.expiresAt)) : none) as unknown as LockState['expiresAt'],
    } as LockState;
  }

  /**
   * Check if a lock holder is still alive.
   *
   * For lambda holders (cloud backends), we can't remotely verify if the
   * holder is still running. We return true and rely on TTL/conditional writes.
   *
   * For process holders (shouldn't happen in cloud, but handle gracefully),
   * we can't check cross-machine PIDs so return false (assume dead).
   *
   * @param holderStr - East text-encoded holder string
   */
  isHolderAlive(holderStr: string): Promise<boolean> {
    const holder = parseHolder(holderStr);
    if (!holder) {
      // Can't parse - assume alive (safer default)
      return Promise.resolve(true);
    }

    if (holder.type === 'lambda') {
      // Lambda holder - can't check remotely, assume alive
      // TTL and conditional writes handle actual expiry
      return Promise.resolve(true);
    }

    if (holder.type === 'process') {
      // Process locks from local machines are not checkable from cloud
      // Assume dead - the lock will be stale anyway
      return Promise.resolve(false);
    }

    // Unknown holder type - assume alive (safer default)
    return Promise.resolve(true);
  }

  /**
   * Force release a lock by repo and resource (without holding the handle).
   * Used for error cleanup only (e.g. finalize-execution finally block).
   * Unconditionally deletes the lock item — acceptable because this is only
   * called when the execution is terminating and the lock must not persist.
   */
  async forceRelease(repo: string, resource: string): Promise<void> {
    try {
      await this.dynamo.send(
        new DeleteItemCommand({
          TableName: this.tableName,
          Key: marshall({
            PK: `LOCK/${repo}`,
            SK: resource,
          }),
        })
      );
    } catch (error) {
      console.warn(`Failed to force release lock ${resource}:`, error);
    }
  }

  /**
   * Renew an existing lock's TTL.
   *
   * Extends the lock expiry by DEFAULT_LOCK_TTL_SECONDS from now.
   * Works for both shared and exclusive locks — the TTL/expiresAt fields
   * apply uniformly regardless of lock mode.
   * Returns true if the lock was renewed, false if the lock no longer exists.
   * Non-fatal errors are logged and return false (TTL is the last resort).
   */
  async renewLock(repo: string, resource: string): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEFAULT_LOCK_TTL_SECONDS * 1000);
    const ttl = Math.floor(expiresAt.getTime() / 1000);

    try {
      await this.dynamo.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({
            PK: `LOCK/${repo}`,
            SK: resource,
          }),
          UpdateExpression: 'SET expiresAt = :expiresAt, #ttl = :ttl',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: {
            '#ttl': 'ttl',
          },
          ExpressionAttributeValues: marshall({
            ':expiresAt': expiresAt.toISOString(),
            ':ttl': ttl,
          }),
        })
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        // Lock no longer exists
        return false;
      }
      console.warn(`Failed to renew lock ${resource}:`, error);
      return false;
    }
  }

  /**
   * Attempt to acquire the lock once.
   */
  private async tryAcquire(
    repo: string,
    resource: string,
    operation: LockOperation
  ): Promise<LockHandle | null> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEFAULT_LOCK_TTL_SECONDS * 1000);
    const ttl = Math.floor(expiresAt.getTime() / 1000);

    // Create holder as East text string: .lambda (requestId="...", functionName="...")
    const holderInfo: LambdaHolderInfo = {
      requestId: getRequestId(),
      functionName: process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'unknown',
    };
    const holder = printLambdaHolder(variant('lambda', holderInfo));

    try {
      await this.dynamo.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: marshall({
            PK: `LOCK/${repo}`,
            SK: resource,
            holder, // Stored as plain string, reconstructed as opaque variant on read
            operation,
            mode: 'exclusive',
            sharedCount: 0,
            acquiredAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
            ttl, // DynamoDB TTL for automatic cleanup
          }),
          // Condition: no lock exists, existing lock is expired, or stale shared lock (count <= 0)
          ConditionExpression: 'attribute_not_exists(PK) OR expiresAt < :now OR (#mode = :shared AND sharedCount <= :zero)',
          ExpressionAttributeNames: {
            '#mode': 'mode',
          },
          ExpressionAttributeValues: marshall({
            ':now': now.toISOString(),
            ':shared': 'shared',
            ':zero': 0,
          }),
        })
      );

      // Lock acquired successfully
      return this.createHandle(repo, resource);
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        // Lock is held by someone else
        return null;
      }
      throw error;
    }
  }

  /**
   * Attempt to acquire a shared lock once.
   *
   * Uses a two-path approach to avoid metadata overwrite and stale count issues:
   * - Path 1: Create new lock (or overwrite expired) with sharedCount=1
   * - Path 2: Join existing shared lock by incrementing sharedCount
   */
  private async tryAcquireShared(
    repo: string,
    resource: string,
    operation: LockOperation
  ): Promise<LockHandle | null> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEFAULT_LOCK_TTL_SECONDS * 1000);
    const ttl = Math.floor(expiresAt.getTime() / 1000);

    const holderInfo: LambdaHolderInfo = {
      requestId: getRequestId(),
      functionName: process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'unknown',
    };
    const holder = printLambdaHolder(variant('lambda', holderInfo));

    // Path 1: Try to create a new shared lock (or overwrite expired lock)
    try {
      await this.dynamo.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: marshall({
            PK: `LOCK/${repo}`,
            SK: resource,
            holder,
            operation,
            mode: 'shared',
            sharedCount: 1, // Reset count (not ADD) to avoid stale increment
            acquiredAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
            ttl,
          }),
          // Succeed only if: no lock exists, or existing lock is expired
          ConditionExpression: 'attribute_not_exists(PK) OR expiresAt < :now',
          ExpressionAttributeValues: marshall({
            ':now': now.toISOString(),
          }),
        })
      );

      return this.createSharedHandle(repo, resource);
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) {
        throw error;
      }
      // Lock exists and is not expired — try to join it as shared
    }

    // Path 2: Join existing shared lock (only update expiresAt/ttl, preserve original holder/acquiredAt)
    try {
      await this.dynamo.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: marshall({
            PK: `LOCK/${repo}`,
            SK: resource,
          }),
          UpdateExpression: 'SET expiresAt = :expiresAt, #ttl = :ttl ADD sharedCount :one',
          ConditionExpression: '#mode = :shared',
          ExpressionAttributeNames: {
            '#mode': 'mode',
            '#ttl': 'ttl',
          },
          ExpressionAttributeValues: marshall({
            ':shared': 'shared',
            ':expiresAt': expiresAt.toISOString(),
            ':ttl': ttl,
            ':one': 1,
          }),
        })
      );

      return this.createSharedHandle(repo, resource);
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        // Exclusive lock exists — cannot acquire shared
        return null;
      }
      throw error;
    }
  }

  /**
   * Create a lock handle for releasing the lock.
   */
  private createHandle(repo: string, resource: string): LockHandle {
    let released = false;

    return {
      resource,
      release: async () => {
        if (released) {
          return; // Idempotent
        }
        released = true;

        try {
          await this.dynamo.send(
            new DeleteItemCommand({
              TableName: this.tableName,
              Key: marshall({
                PK: `LOCK/${repo}`,
                SK: resource,
              }),
            })
          );
        } catch (error) {
          // Log but don't throw - lock will expire anyway
          console.warn(`Failed to release lock ${resource}:`, error);
        }
      },
    };
  }

  /**
   * Create a lock handle for releasing a shared lock.
   * Decrements sharedCount and deletes the item when count reaches 0.
   */
  private createSharedHandle(repo: string, resource: string): LockHandle {
    let released = false;

    return {
      resource,
      release: async () => {
        if (released) {
          return; // Idempotent
        }
        released = true;

        try {
          // Decrement sharedCount
          const result = await this.dynamo.send(
            new UpdateItemCommand({
              TableName: this.tableName,
              Key: marshall({
                PK: `LOCK/${repo}`,
                SK: resource,
              }),
              UpdateExpression: 'ADD sharedCount :minusOne',
              ExpressionAttributeValues: marshall({
                ':minusOne': -1,
              }),
              ReturnValues: 'ALL_NEW',
            })
          );

          // If sharedCount reached 0 or below, conditionally delete the lock item.
          // The condition prevents deleting if another Lambda acquired between decrement and delete.
          if (result.Attributes) {
            const updated = unmarshall(result.Attributes);
            if ((updated.sharedCount as number) <= 0) {
              try {
                await this.dynamo.send(
                  new DeleteItemCommand({
                    TableName: this.tableName,
                    Key: marshall({
                      PK: `LOCK/${repo}`,
                      SK: resource,
                    }),
                    ConditionExpression: 'sharedCount <= :zero',
                    ExpressionAttributeValues: marshall({
                      ':zero': 0,
                    }),
                  })
                );
              } catch (error) {
                if (!(error instanceof ConditionalCheckFailedException)) {
                  throw error;
                }
                // Another Lambda acquired between decrement and delete — correct to keep the lock
              }
            }
          }
        } catch (error) {
          // Log but don't throw - lock will expire anyway via TTL
          console.warn(`Failed to release shared lock ${resource}:`, error);
        }
      },
    };
  }
}

/**
 * Parse an East text holder string to extract Lambda-specific info.
 * Returns null if parsing fails or it's not a Lambda holder.
 *
 * @param holderStr - East text-encoded holder string (e.g., `.lambda (requestId="...", functionName="...")`)
 */
export function parseLambdaHolder(holderStr: string): LambdaHolderInfo | null {
  const holder = parseHolder(holderStr);
  if (!holder || holder.type !== 'lambda') {
    return null;
  }
  return holder.value as LambdaHolderInfo;
}

/**
 * Get the Lambda request ID from the environment.
 * Falls back to a random ID for local testing.
 */
function getRequestId(): string {
  // In Lambda, the request ID is available in the context
  // We store it in a global for access here
  return (globalThis as any).__lambdaRequestId ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Set the Lambda request ID (call from Lambda handler).
 */
export function setLambdaRequestId(requestId: string): void {
  (globalThis as any).__lambdaRequestId = requestId;
}
