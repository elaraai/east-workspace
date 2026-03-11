/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Lambda handler for package/workspace export processing (Step Function task).
 *
 * AWS-specific: uploads zip to S3 from /tmp.
 * Cloud-agnostic: delegates export to handleProcessExport from e3-cloud-core.
 *
 * Errors propagate to the Step Function catch handler (MarkExportFailed).
 */

import { createReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { variant } from '@elaraai/east';
import { handleProcessExport } from '@elaraai/e3-cloud-core/steps';
import { getStorage, getExportStore } from '../../storage/init.js';

const s3 = new S3Client({});
const bucket = process.env.BUCKET_NAME!;

export async function handler(event: { id: string; repo: string }): Promise<{ id: string }> {
  const { id, repo } = event;
  const storage = getStorage();
  const exportStore = getExportStore();
  const tmpPath = `/tmp/${id}.zip`;
  const s3Key = `${repo}/_transfer/${id}.zip`;

  try {
    // Phase 1: Export to /tmp (cloud-agnostic)
    await handleProcessExport(
      { storage, exportStore },
      { id, repo, zipPath: tmpPath },
    );

    // Phase 2: Upload zip to S3 (AWS-specific)
    await exportStore.updateStatus(id, variant('processing',
      variant('uploading', null),
    ));
    const fileStat = await stat(tmpPath);
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: createReadStream(tmpPath),
      ContentType: 'application/zip',
      ContentLength: fileStat.size,
    }));

    // Mark completed
    await exportStore.updateStatus(id, variant('completed', {
      size: BigInt(fileStat.size),
    }));

    return { id };
  } finally {
    await unlink(tmpPath).catch(() => {});
    await unlink(`${tmpPath}.partial`).catch(() => {});
  }
}
