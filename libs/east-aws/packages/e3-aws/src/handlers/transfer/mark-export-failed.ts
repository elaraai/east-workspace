/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Lambda handler for marking a failed package export (Step Function error path).
 *
 * Cloud-agnostic: delegates to handleMarkExportFailed.
 * AWS-specific: cleans up the S3 temp file.
 */

import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { handleMarkExportFailed } from '@elaraai/e3-cloud-core/steps';
import { getExportStore } from '../../storage/init.js';

const s3 = new S3Client({});
const bucket = process.env.BUCKET_NAME!;

export async function handler(event: { id: string; repo: string; error?: { Error?: string; Cause?: string } }) {
  const exportStore = getExportStore();

  // Cloud-agnostic: mark failed
  await handleMarkExportFailed({ exportStore }, event);

  // AWS-specific: clean up S3 temp file
  await s3.send(new DeleteObjectCommand({
    Bucket: bucket, Key: `${event.repo}/_transfer/${event.id}.zip`,
  })).catch(() => {});
}
