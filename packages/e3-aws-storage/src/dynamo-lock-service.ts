/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { LockService, LockHandle, LockState, LockOperation } from '@elaraai/e3-core';
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
 *   PK: REPO#{repo}
 *   SK: LOCK#{resource}
 *
 * Locks have a TTL for automatic cleanup by DynamoDB.
 * Holder info is stored as an East text string (e.g., `.lambda (requestId="...", functionName="...")`).
 */
export class DynamoLockService implements LockService {
  constructor(
    private readonly dynamo: DynamoDBClient,
    private readonly tableName: string
  ) {}

  /**
   * Acquire an exclusive lock on a resource.
   *
   * Uses conditional write to ensure atomicity:
   * - If no lock exists, create one
   * - If lock exists but is expired, overwrite it
   * - If lock exists and is active, fail (or wait and retry)
   */
  async acquire(
    repo: string,
    resource: string,
    operation: LockOperation,
    options?: { wait?: boolean; timeout?: number }
  ): Promise<LockHandle | null> {
    const wait = options?.wait ?? false;
    const timeout = options?.timeout ?? 30000;
    const startTime = Date.now();

    while (true) {
      const acquired = await this.tryAcquire(repo, resource, operation);
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
   * Used when lock was acquired in a different Lambda invocation.
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
            acquiredAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
            ttl, // DynamoDB TTL for automatic cleanup
          }),
          // Condition: either no lock exists, or existing lock is expired
          ConditionExpression: 'attribute_not_exists(PK) OR expiresAt < :now',
          ExpressionAttributeValues: marshall({
            ':now': now.toISOString(),
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
