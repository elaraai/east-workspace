/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Mark Phase Lambda Handler
 *
 * Implements the mark phase of mark-and-sweep garbage collection:
 * 1. Query all refs from DynamoDB (packages, workspaces, executions)
 * 2. Trace object graph by reading S3 objects and extracting hash references
 * 3. Write reachable set to S3 temp file for sweep phase
 *
 * The reachable set is stored in S3 rather than passed in Step Function payload
 * to avoid the 256KB payload limit.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { decodeBeast2For } from '@elaraai/east';
import { WorkspaceStateType } from '@elaraai/e3-types';

// Initialize AWS clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;

// Time limit: quit at 13 minutes to leave buffer before 15 min Lambda timeout
const TIME_LIMIT_MS = 13 * 60 * 1000;

// SHA256 hash pattern (64 hex characters)
const HASH_PATTERN = /[a-f0-9]{64}/g;

/**
 * Input for the GC mark phase handler.
 */
export interface GcMarkInput {
  /** Repository name */
  repo: string;
  /** Unique GC run identifier */
  gcId: string;
  /** Timestamp when GC started (for consistent minAge calculation) */
  startTime: number;
}

/**
 * Output from the GC mark phase handler.
 */
export interface GcMarkOutput {
  /** Repository name */
  repo: string;
  /** Unique GC run identifier */
  gcId: string;
  /** Timestamp when GC started */
  startTime: number;
  /** Number of reachable objects found */
  reachableCount: number;
  /** Number of root refs found */
  rootCount: number;
  /** S3 key where reachable set is stored */
  reachableSetKey: string;
}

/**
 * GC Mark phase handler.
 *
 * Collects all root hashes and traces the object graph to build the reachable set.
 */
export const handler = async (input: GcMarkInput): Promise<GcMarkOutput> => {
  const { repo, gcId, startTime } = input;
  const markStartTime = Date.now();

  console.log(`Starting GC mark phase for repo: ${repo}, gcId: ${gcId}`);

  // Step 1: Collect all root hashes from DynamoDB
  const roots = await collectRoots(repo);
  console.log(`Found ${roots.size} root hashes`);

  // Step 2: Trace object graph to find all reachable objects
  const reachable = new Set<string>();
  for (const root of roots) {
    // Check time limit
    if (Date.now() - markStartTime > TIME_LIMIT_MS) {
      console.warn('Time limit reached during mark phase - this should not happen for normal repos');
      break;
    }
    await markReachable(repo, root, reachable);
  }
  console.log(`Marked ${reachable.size} reachable objects`);

  // Step 3: Write reachable set to S3 temp file
  const reachableSetKey = `gc-temp/${gcId}/reachable.txt`;
  const reachableData = Array.from(reachable).join('\n');

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: reachableSetKey,
      Body: reachableData,
      ContentType: 'text/plain',
    })
  );
  console.log(`Wrote reachable set to s3://${BUCKET_NAME}/${reachableSetKey}`);

  return {
    repo,
    gcId,
    startTime,
    reachableCount: reachable.size,
    rootCount: roots.size,
    reachableSetKey,
  };
};

/**
 * Collect all root hashes from DynamoDB refs.
 *
 * Roots come from:
 * - Package refs (PKG#name#version -> hash)
 * - Workspace state (WS#name -> state with packageHash, rootHash)
 * - Execution outputs (EXEC#taskHash#inputsHash -> outputHash)
 */
async function collectRoots(repo: string): Promise<Set<string>> {
  const roots = new Set<string>();

  // Query all items for this repo
  let exclusiveStartKey: Record<string, any> | undefined;

  do {
    const response = await dynamo.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': { S: `REPO#${repo}` },
        },
        ExclusiveStartKey: exclusiveStartKey,
      })
    );

    if (response.Items) {
      for (const item of response.Items) {
        const unmarshalled = unmarshall(item);
        const sk = unmarshalled.SK as string;

        // Package refs: PKG#name#version -> hash stored in 'hash' attribute
        if (sk.startsWith('PKG#') && unmarshalled.hash) {
          const hash = unmarshalled.hash as string;
          if (isValidHash(hash)) {
            roots.add(hash);
          }
        }

        // Workspace state: WS#name -> state stored in 'state' attribute (BEAST2 encoded)
        if (sk.startsWith('WS#') && unmarshalled.state) {
          try {
            const stateData = unmarshalled.state as Uint8Array;
            if (stateData.length > 0) {
              const decoder = decodeBeast2For(WorkspaceStateType);
              const state = decoder(stateData);
              if (isValidHash(state.packageHash)) {
                roots.add(state.packageHash);
              }
              if (isValidHash(state.rootHash)) {
                roots.add(state.rootHash);
              }
            }
          } catch (err) {
            console.warn(`Failed to decode workspace state for ${sk}:`, err);
          }
        }

        // Execution outputs: EXEC#taskHash#inputsHash -> outputHash stored in 'outputHash' attribute
        if (sk.startsWith('EXEC#') && unmarshalled.outputHash) {
          const hash = unmarshalled.outputHash as string;
          if (isValidHash(hash)) {
            roots.add(hash);
          }
        }
      }
    }

    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return roots;
}

/**
 * Mark all objects reachable from a root hash.
 *
 * Traverses the object graph by scanning for hash patterns in object data.
 */
async function markReachable(
  repo: string,
  hash: string,
  reachable: Set<string>
): Promise<void> {
  // Already visited?
  if (reachable.has(hash)) {
    return;
  }

  // Try to load the object from S3
  try {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${repo}/objects/${hash}`,
      })
    );

    if (!response.Body) {
      return;
    }

    reachable.add(hash);

    // Read object data and scan for hash patterns
    const data = await response.Body.transformToByteArray();
    const dataStr = Buffer.from(data).toString('latin1');

    // Find all potential hash references
    const matches = dataStr.matchAll(HASH_PATTERN);
    for (const match of matches) {
      const potentialHash = match[0];
      if (!reachable.has(potentialHash)) {
        // Recursively mark if it exists
        await markReachable(repo, potentialHash, reachable);
      }
    }
  } catch (err: any) {
    // Object doesn't exist - not an error, just means this hash
    // wasn't actually a reference to an object
    if (err.name !== 'NoSuchKey' && err.Code !== 'NoSuchKey') {
      console.warn(`Error reading object ${hash}:`, err);
    }
  }
}

/**
 * Validate that a string looks like a SHA256 hash.
 */
function isValidHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
