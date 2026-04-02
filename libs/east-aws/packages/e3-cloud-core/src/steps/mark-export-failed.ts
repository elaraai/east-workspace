/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Cloud-agnostic handler for marking a failed package export.
 *
 * Called by the Step Function error-handling branch when the export Lambda
 * fails (OOM, timeout, unhandled exception). Extracts the error message
 * from the Step Function error payload and updates DynamoDB.
 */

import { variant } from '@elaraai/east';
import type { PackageExportStore } from '@elaraai/e3-core';

export interface MarkExportFailedDeps {
  exportStore: Pick<PackageExportStore, 'updateStatus'>;
}

export interface MarkExportFailedInput {
  id: string;
  repo: string;
  error?: { Error?: string; Cause?: string };
}

export async function handleMarkExportFailed(
  deps: MarkExportFailedDeps,
  input: MarkExportFailedInput,
): Promise<void> {
  const message = input.error?.Cause ?? input.error?.Error ?? 'Export failed (unknown error)';
  await deps.exportStore.updateStatus(input.id, variant('failed', { message }));
}
