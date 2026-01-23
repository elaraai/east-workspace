/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Cleanup Lambda Handler
 *
 * Implements the cleanup phase of garbage collection:
 * 1. Scan S3 object versions in the {repo}/objects/ prefix
 * 2. For each version older than MIN_AGE (24 hours):
 *    - Check if it matches the currentVersion in the catalogue
 *    - If not, delete the orphaned version
 * 3. Delete temporary files created during GC (reachable set file)
 *
 * This phase runs after sweep, which deleted catalogue entries for unreachable
 * objects. Cleanup deletes the actual S3 versions that are no longer referenced.
 *
 * Designed to be called repeatedly by Step Functions until complete.
 */

import {
  S3Client,
  ListObjectVersionsCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// Initialize AWS clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});

const BUCKET_NAME = process.env.BUCKET_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;

// Time limit: quit at 13 minutes to leave buffer before 15 min Lambda timeout
const TIME_LIMIT_MS = 13 * 60 * 1000;

// Minimum age for S3 versions to be considered for deletion (24 hours)
// This protects against race conditions where an upload is in progress
const DEFAULT_MIN_AGE_MS = 24 * 60 * 60 * 1000;

// Batch size for S3 version listing
const LIST_BATCH_SIZE = 1000;

/**
 * Input for the GC cleanup handler.
 */
export interface GcCleanupInput {
  /** Repository name */
  repo: string;
  /** Unique GC run identifier */
  gcId: string;
  /** Final stats from sweep phase */
  stats: {
    deletedEntries: number;
    retainedEntries: number;
    skippedYoung: number;
  };
  /** S3 version pagination cursor for resuming */
  versionCursor?: string;
  /** Phase of cleanup: 'versions' or 'temp' */
  phase?: 'versions' | 'temp';
  /** Accumulated cleanup stats */
  cleanupStats?: GcCleanupStats;
  /** Minimum age in ms for versions to be deleted (default: 24 hours) */
  minAge?: number;
}

/**
 * Stats tracked during cleanup phase.
 */
export interface GcCleanupStats {
  /** Number of S3 versions deleted */
  deletedVersions: number;
  /** Number of S3 versions retained (current) */
  retainedVersions: number;
  /** Number of S3 versions skipped (too young) */
  skippedYoung: number;
  /** Number of temp files deleted */
  tempFilesDeleted: number;
}

/**
 * Output from the GC cleanup handler.
 */
export interface GcCleanupOutput {
  /** Repository name */
  repo: string;
  /** Unique GC run identifier */
  gcId: string;
  /** Final stats from sweep phase */
  stats: {
    deletedEntries: number;
    retainedEntries: number;
    skippedYoung: number;
  };
  /** Whether to continue ('continue') or if cleanup is complete ('done') */
  status: 'continue' | 'done';
  /** S3 version pagination cursor for next batch */
  versionCursor?: string;
  /** Phase of cleanup */
  phase?: 'versions' | 'temp';
  /** Accumulated cleanup stats */
  cleanupStats: GcCleanupStats;
}

/**
 * GC Cleanup handler.
 *
 * Deletes orphaned S3 versions and temporary GC files.
 */
export const handler = async (input: GcCleanupInput): Promise<GcCleanupOutput> => {
  const { repo, gcId, stats } = input;
  const minAge = input.minAge ?? DEFAULT_MIN_AGE_MS;
  const cleanupStartTime = Date.now();
  let phase = input.phase ?? 'versions';
  let versionCursor = input.versionCursor;

  // Initialize or continue cleanup stats
  const cleanupStats: GcCleanupStats = input.cleanupStats ?? {
    deletedVersions: 0,
    retainedVersions: 0,
    skippedYoung: 0,
    tempFilesDeleted: 0,
  };

  console.log(`Starting GC cleanup for repo: ${repo}, gcId: ${gcId}, phase: ${phase}`, {
    hasCursor: !!versionCursor,
    currentStats: cleanupStats,
  });

  // Calculate cutoff time for version deletion
  const cutoffTime = new Date(Date.now() - minAge);

  // Phase 1: Delete orphaned S3 versions
  if (phase === 'versions') {
    const prefix = `${repo}/objects/`;

    while (true) {
      // Check time limit
      if (Date.now() - cleanupStartTime > TIME_LIMIT_MS) {
        console.log('Time limit reached during version cleanup, continuing...');
        return {
          repo,
          gcId,
          stats,
          status: 'continue',
          versionCursor,
          phase: 'versions',
          cleanupStats,
        };
      }

      // Parse cursor for version pagination
      let keyMarker: string | undefined;
      let versionIdMarker: string | undefined;
      if (versionCursor) {
        const parsed = JSON.parse(versionCursor);
        keyMarker = parsed.keyMarker;
        versionIdMarker = parsed.versionIdMarker;
      }

      // List object versions
      const listResponse = await s3.send(
        new ListObjectVersionsCommand({
          Bucket: BUCKET_NAME,
          Prefix: prefix,
          MaxKeys: LIST_BATCH_SIZE,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        })
      );

      const versions = listResponse.Versions ?? [];

      if (versions.length === 0 && !listResponse.IsTruncated) {
        // No more versions, move to temp file cleanup
        phase = 'temp';
        versionCursor = undefined;
        break;
      }

      // Process each version
      for (const version of versions) {
        if (!version.Key || !version.VersionId || !version.LastModified) {
          continue;
        }

        // Extract hash from key: {repo}/objects/{hash}
        const hash = version.Key.slice(prefix.length);
        if (!hash || !/^[a-f0-9]{64}$/.test(hash)) {
          // Not a valid object hash
          continue;
        }

        // Skip if version is too young (created after cutoff)
        if (version.LastModified > cutoffTime) {
          cleanupStats.skippedYoung++;
          continue;
        }

        // Check if this version is the current version in the catalogue
        const catalogueEntry = await getCatalogueEntry(repo, hash);
        if (catalogueEntry && catalogueEntry.currentVersion === version.VersionId) {
          // This is the current version - don't delete
          cleanupStats.retainedVersions++;
          continue;
        }

        // Version is orphaned - delete it
        await s3.send(
          new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: version.Key,
            VersionId: version.VersionId,
          })
        );
        cleanupStats.deletedVersions++;
      }

      // Check for more versions
      if (listResponse.IsTruncated) {
        versionCursor = JSON.stringify({
          keyMarker: listResponse.NextKeyMarker,
          versionIdMarker: listResponse.NextVersionIdMarker,
        });
      } else {
        // No more versions, move to temp file cleanup
        phase = 'temp';
        versionCursor = undefined;
        break;
      }
    }
  }

  // Phase 2: Delete temporary GC files
  if (phase === 'temp') {
    const gcTempPrefix = `gc-temp/${gcId}/`;
    let continuationToken: string | undefined;

    do {
      // Check time limit
      if (Date.now() - cleanupStartTime > TIME_LIMIT_MS) {
        console.log('Time limit reached during temp cleanup, continuing...');
        return {
          repo,
          gcId,
          stats,
          status: 'continue',
          phase: 'temp',
          cleanupStats,
        };
      }

      const listResponse = await s3.send(
        new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: gcTempPrefix,
          ContinuationToken: continuationToken,
        })
      );

      if (listResponse.Contents && listResponse.Contents.length > 0) {
        const toDelete = listResponse.Contents
          .filter((obj) => obj.Key)
          .map((obj) => ({ Key: obj.Key! }));

        if (toDelete.length > 0) {
          await s3.send(
            new DeleteObjectsCommand({
              Bucket: BUCKET_NAME,
              Delete: {
                Objects: toDelete,
                Quiet: true,
              },
            })
          );
          cleanupStats.tempFilesDeleted += toDelete.length;
        }
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);
  }

  // Cleanup complete
  console.log(`GC cleanup complete for repo: ${repo}`, cleanupStats);

  return {
    repo,
    gcId,
    stats,
    status: 'done',
    cleanupStats,
  };
};

/**
 * Get a catalogue entry to check if a version is current.
 */
async function getCatalogueEntry(
  repo: string,
  hash: string
): Promise<{ currentVersion?: string } | null> {
  const response = await dynamo.send(
    new GetItemCommand({
      TableName: TABLE_NAME,
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
