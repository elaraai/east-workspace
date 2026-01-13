/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Cleanup Lambda Handler
 *
 * Cleans up temporary files created during GC (reachable set file).
 * Called after sweep phase completes.
 */

import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

// Initialize AWS clients once at Lambda cold start
const s3 = new S3Client({});

const BUCKET_NAME = process.env.BUCKET_NAME!;

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
    deletedObjects: number;
    retainedObjects: number;
    skippedYoung: number;
    bytesFreed: number;
  };
}

/**
 * Output from the GC cleanup handler.
 */
export interface GcCleanupOutput {
  /** Repository name */
  repo: string;
  /** Unique GC run identifier */
  gcId: string;
  /** Final stats */
  stats: {
    deletedObjects: number;
    retainedObjects: number;
    skippedYoung: number;
    bytesFreed: number;
  };
  /** Number of temp files cleaned up */
  tempFilesDeleted: number;
}

/**
 * GC Cleanup handler.
 *
 * Deletes temporary files created during the GC run.
 */
export const handler = async (input: GcCleanupInput): Promise<GcCleanupOutput> => {
  const { repo, gcId, stats } = input;

  console.log(`Cleaning up GC temp files for repo: ${repo}, gcId: ${gcId}`);

  // Delete all files under gc-temp/{gcId}/
  const prefix = `gc-temp/${gcId}/`;
  let tempFilesDeleted = 0;

  let continuationToken: string | undefined;

  do {
    const listResponse = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
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
        tempFilesDeleted += toDelete.length;
      }
    }

    continuationToken = listResponse.NextContinuationToken;
  } while (continuationToken);

  console.log(`Deleted ${tempFilesDeleted} temp files`);

  return {
    repo,
    gcId,
    stats,
    tempFilesDeleted,
  };
};
