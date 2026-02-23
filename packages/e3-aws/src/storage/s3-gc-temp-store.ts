/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * S3 implementation of GcTempStore.
 *
 * Stores GC temporary files (reachable sets) in S3 under the `gc-temp/` prefix.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type _Object,
} from '@aws-sdk/client-s3';
import type { GcTempStore } from '@elaraai/e3-cloud-core';

export class S3GcTempStore implements GcTempStore {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async writeReachableSet(gcId: string, hashes: Set<string>): Promise<string> {
    const key = `gc-temp/${gcId}/reachable.txt`;
    const data = Array.from(hashes).join('\n');

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: 'text/plain',
      })
    );

    return key;
  }

  async readReachableSet(key: string): Promise<Set<string>> {
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );

    if (!response.Body) {
      return new Set();
    }

    const data = await response.Body.transformToString();
    const hashes = data.split('\n').filter((h: string) => h.length === 64);
    return new Set(hashes);
  }

  async cleanupTempFiles(gcId: string): Promise<number> {
    const prefix = `gc-temp/${gcId}/`;
    let totalDeleted = 0;
    let continuationToken: string | undefined;

    do {
      const listResponse = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
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
          totalDeleted += toDelete.length;
        }
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    return totalDeleted;
  }
}
