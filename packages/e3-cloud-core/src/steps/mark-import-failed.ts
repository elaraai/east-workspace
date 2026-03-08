/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Cloud-agnostic handler for marking a failed package import.
 *
 * Called by the Step Function error-handling branch when the import Lambda
 * fails (OOM, timeout, unhandled exception). Extracts the error message
 * from the Step Function error payload and updates DynamoDB.
 */

import { variant } from '@elaraai/east';
import type { PackageImportStore } from '@elaraai/e3-core';

export interface MarkImportFailedDeps {
  importStore: Pick<PackageImportStore, 'updateStatus'>;
}

export interface MarkImportFailedInput {
  id: string;
  repo: string;
  error?: { Error?: string; Cause?: string };
}

export async function handleMarkImportFailed(
  deps: MarkImportFailedDeps,
  input: MarkImportFailedInput,
): Promise<void> {
  const message = input.error?.Cause ?? input.error?.Error ?? 'Import failed (unknown error)';
  await deps.importStore.updateStatus(input.id, variant('failed', { message }));
}
