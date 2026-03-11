/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Lambda handler for package/workspace export processing (Step Function task).
 *
 * AWS-specific: uploads zip to S3 from /tmp.
 * Cloud-agnostic: delegates export to packageExport/workspaceExport from e3-core.
 *
 * Errors propagate to the Step Function catch handler (MarkExportFailed).
 */

import { createReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { variant } from '@elaraai/east';
import { packageExport, workspaceExport } from '@elaraai/e3-core';
import { getStorage, getExportStore } from '../../storage/init.js';

const s3 = new S3Client({});
const bucket = process.env.BUCKET_NAME!;

const PROGRESS_INTERVAL_MS = 1000;

export async function handler(event: { id: string; repo: string }): Promise<{ id: string }> {
  const { id, repo } = event;
  const storage = getStorage();
  const exportStore = getExportStore();
  const tmpPath = `/tmp/${id}.zip`;
  const s3Key = `${repo}/_transfer/${id}.zip`;

  try {
    const record = await exportStore.get(id);
    if (!record) throw new Error(`Export record ${id} not found`);

    // Throttled progress reporting
    let lastProgressUpdate = Date.now();
    const onProgress = async (progress: { objectsProcessed: number }) => {
      const now = Date.now();
      if (now - lastProgressUpdate >= PROGRESS_INTERVAL_MS) {
        await exportStore.updateStatus(id, variant('processing',
          variant('exporting', { objectsProcessed: BigInt(progress.objectsProcessed) }),
        ));
        lastProgressUpdate = now;
      }
    };

    // Export to /tmp — workspaceExport acquires its own lock internally
    if (record.workspace.type === 'some') {
      await workspaceExport(storage, repo, record.workspace.value, tmpPath, record.name, record.version, {
        onProgress,
      });
    } else {
      await packageExport(storage, repo, record.name, record.version, tmpPath, {
        onProgress,
      });
    }

    // Upload zip to S3
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
  }
}
