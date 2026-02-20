/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Mark Phase Lambda Handler
 *
 * Implements the mark phase of mark-and-sweep garbage collection:
 * 1. Collect all root hashes via RepoStore gcScan*Roots primitives
 * 2. Trace object graph using BEAST2 schema-aware traversal (e3-core)
 * 3. Write reachable set to S3 temp file for sweep phase
 *
 * The reachable set is stored in S3 rather than passed in Step Function payload
 * to avoid the 256KB payload limit.
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getStorage } from '../../storage/init.js';
import { collectAllRoots, markReachable } from '@elaraai/e3-core';

const s3 = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME!;

const storage = getStorage();
const repoStore = storage.repos;
const objectStore = storage.objects;

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
 * Collects all root hashes via RepoStore gcScan*Roots primitives, then
 * traces the object graph using e3-core's BEAST2-aware markReachable.
 */
export const handler = async (input: GcMarkInput): Promise<GcMarkOutput> => {
  const { repo, gcId, startTime } = input;

  // Step 1: Collect all root hashes from DynamoDB via e3-core
  const roots = await collectAllRoots(repoStore, repo);

  // Step 2: Trace object graph using BEAST2 schema-aware traversal
  const readObject = async (hash: string): Promise<Uint8Array | null> => {
    try {
      return await objectStore.read(repo, hash);
    } catch {
      return null;
    }
  };
  const reachable = await markReachable(readObject, roots);

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

  return {
    repo,
    gcId,
    startTime,
    reachableCount: reachable.size,
    rootCount: roots.size,
    reachableSetKey,
  };
};
