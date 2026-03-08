/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Lambda handler for package import processing (Step Function task).
 *
 * AWS-specific: downloads zip from S3 to /tmp.
 * Cloud-agnostic: delegates verify + import + progress to handleProcessImport.
 *
 * Errors propagate to the Step Function catch handler (MarkImportFailed).
 */

import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { variant } from '@elaraai/east';
import { handleProcessImport } from '@elaraai/e3-cloud-core/steps';
import { getStorage, getImportStore } from '../../storage/init.js';

const s3 = new S3Client({});
const bucket = process.env.BUCKET_NAME!;

export async function handler(event: { id: string; repo: string }): Promise<{ id: string }> {
  const { id, repo } = event;
  const storage = getStorage();
  const importStore = getImportStore();
  const tmpPath = `/tmp/${id}.zip`;
  const s3Key = `${repo}/_transfer/${id}.zip`;

  try {
    // Phase 1: Download from S3 (AWS-specific)
    await importStore.updateStatus(id, variant('processing',
      variant('downloading', null),
    ));
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
    await pipeline(obj.Body as Readable, createWriteStream(tmpPath));

    // Phase 2+3: Verify + import (cloud-agnostic)
    const result = await handleProcessImport(
      { storage, importStore },
      { id, repo, zipPath: tmpPath },
    );

    return { id: result.id };
  } finally {
    await unlink(tmpPath).catch(() => {});
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: s3Key })).catch(() => {});
  }
}
