/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Cloud-agnostic package export step handler.
 *
 * Receives a zip path, looks up the export record, runs packageExport or
 * workspaceExport with throttled progress updates. Does NOT mark completed
 * or handle errors — the AWS Lambda wrapper handles S3 upload, completion
 * marking, and error propagation to the Step Function catch handler.
 */

import { variant } from '@elaraai/east';
import { packageExport, workspaceExport } from '@elaraai/e3-core';
import type { PackageExportStore, StorageBackend } from '@elaraai/e3-core';

export interface ProcessExportDeps {
  storage: StorageBackend;
  exportStore: Pick<PackageExportStore, 'get' | 'updateStatus'>;
}

export interface ProcessExportInput {
  id: string;
  repo: string;
  zipPath: string;
}

const PROGRESS_INTERVAL_MS = 1000;

export async function handleProcessExport(
  deps: ProcessExportDeps,
  input: ProcessExportInput,
): Promise<void> {
  const record = await deps.exportStore.get(input.id);
  if (!record) throw new Error(`Package export ${input.id} not found`);

  // Throttled progress reporting
  let lastProgressUpdate = Date.now();
  const onProgress = async (progress: { objectsProcessed: number }) => {
    const now = Date.now();
    if (now - lastProgressUpdate >= PROGRESS_INTERVAL_MS) {
      await deps.exportStore.updateStatus(input.id, variant('processing',
        variant('exporting', { objectsProcessed: BigInt(progress.objectsProcessed) }),
      ));
      lastProgressUpdate = now;
    }
  };

  // Export to disk — workspaceExport acquires its own lock internally
  if (record.workspace.type === 'some') {
    await workspaceExport(deps.storage, input.repo, record.workspace.value, input.zipPath, record.name, record.version, {
      onProgress,
    });
  } else {
    await packageExport(deps.storage, input.repo, record.name, record.version, input.zipPath, {
      onProgress,
    });
  }
}
