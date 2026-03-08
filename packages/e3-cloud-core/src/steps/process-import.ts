/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Cloud-agnostic package import step handler.
 *
 * Receives a pre-downloaded zip path, verifies size, runs packageImport with
 * throttled progress updates, and marks the import as completed. The S3
 * download is left to the AWS Lambda wrapper.
 */

import { stat } from 'node:fs/promises';
import { variant } from '@elaraai/east';
import { packageImport } from '@elaraai/e3-core';
import type { PackageImportStore, StorageBackend } from '@elaraai/e3-core';

export interface ProcessImportDeps {
  storage: StorageBackend;
  importStore: Pick<PackageImportStore, 'get' | 'updateStatus'>;
}

export interface ProcessImportInput {
  id: string;
  repo: string;
  zipPath: string;
}

export interface ProcessImportOutput {
  id: string;
  name: string;
  version: string;
  packageHash: string;
  objectCount: number;
}

const PROGRESS_INTERVAL_MS = 1000;

export async function handleProcessImport(
  deps: ProcessImportDeps,
  input: ProcessImportInput,
): Promise<ProcessImportOutput> {
  const record = await deps.importStore.get(input.id);
  if (!record) throw new Error(`Package import ${input.id} not found`);

  // Verify size
  const fileStat = await stat(input.zipPath);
  if (BigInt(fileStat.size) !== record.size) {
    throw new Error(`Size mismatch: expected ${record.size}, got ${fileStat.size}`);
  }

  // Import with throttled progress reporting
  let lastProgressUpdate = Date.now();

  const result = await packageImport(deps.storage, input.repo, input.zipPath, {
    onProgress: async (progress) => {
      const now = Date.now();
      if (now - lastProgressUpdate >= PROGRESS_INTERVAL_MS) {
        await deps.importStore.updateStatus(input.id, variant('processing',
          variant('importing', { objectsProcessed: BigInt(progress.objectsProcessed) }),
        ));
        lastProgressUpdate = now;
      }
    },
  });

  // Mark completed
  await deps.importStore.updateStatus(input.id, variant('completed', {
    name: result.name,
    version: result.version,
    packageHash: result.packageHash,
    objectCount: BigInt(result.objectCount),
  }));

  return { id: input.id, ...result };
}
