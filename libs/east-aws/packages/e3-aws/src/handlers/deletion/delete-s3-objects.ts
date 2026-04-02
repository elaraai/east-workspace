/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Delete S3 Objects Lambda Handler — thin wrapper.
 */

import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { handleDeleteS3Objects } from '@elaraai/e3-cloud-core/deletion';
import type { DeleteS3ObjectsInput, DeleteS3ObjectsOutput, ObjectCleanupStore } from '@elaraai/e3-cloud-core/deletion';

const s3 = new S3Client({});
const bucket = process.env.BUCKET_NAME!;

const objectCleanupStore: ObjectCleanupStore = {
  async deleteObjectsBatch(repo: string, continuationToken?: string) {
    const prefix = `${repo}/`;
    const listResponse = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      })
    );

    let deleted = 0;
    const contents = listResponse.Contents ?? [];
    if (contents.length > 0) {
      const toDelete = contents
        .filter(obj => obj.Key)
        .map(obj => ({ Key: obj.Key! }));

      if (toDelete.length > 0) {
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: toDelete, Quiet: true },
          })
        );
        deleted = toDelete.length;
      }
    }

    return {
      deleted,
      continuationToken: listResponse.IsTruncated ? listResponse.NextContinuationToken : undefined,
    };
  },
};

export const handler = async (input: DeleteS3ObjectsInput): Promise<DeleteS3ObjectsOutput> => {
  return handleDeleteS3Objects({ objectCleanupStore }, input);
};
