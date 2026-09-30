/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Shared processing handlers for package import and export: a job whose zip
 * is a file or a stream.
 *
 * These are cloud-agnostic handlers that perform the actual work of each job.
 * Used by both the local InMemoryTransferBackend and cloud backends
 * (e.g. AWS Lambda/Step Functions). The handlers of the jobs that read no zip
 * — deploy, gc and split calls — are `process.ts`'s.
 */

import { stat, unlink } from 'node:fs/promises';
import type { Writable } from 'node:stream';
import { variant } from '@elaraai/east';

import { ExportStoppedError } from '../errors.js';
import { packageExport, packageImport } from '../package-files.js';
import { workspaceExport } from '../workspace-files.js';
import type { LockHandle, StorageBackend } from '../storage/interfaces.js';
import type { ZipSource } from '../zip.js';
import type { PackageExportStore, PackageImportStore } from './interfaces.js';
import type { PackageZipCheckpoint } from './types.js';

// =============================================================================
// Throttled progress callback
// =============================================================================

/**
 * Creates a progress callback that throttles updates to at most once per interval.
 *
 * @param fn - The function to call with throttled updates
 * @param intervalMs - Minimum interval between calls in milliseconds
 * @returns A throttled version of the progress callback
 */
function throttledProgress(
  fn: (progress: { objectsProcessed: number }) => Promise<void>,
  intervalMs = 1000,
) {
  let lastCall = 0;
  let pending: { objectsProcessed: number } | null = null;

  const throttled = async (progress: { objectsProcessed: number }) => {
    const now = Date.now();
    if (now - lastCall >= intervalMs) {
      lastCall = now;
      pending = null;
      await fn(progress);
    } else {
      pending = progress;
    }
  };

  throttled.flush = async () => {
    if (pending) {
      await fn(pending);
      pending = null;
    }
  };

  return throttled;
}

// =============================================================================
// Process Export
// =============================================================================

/** Dependencies for handleProcessExport. */
export interface ProcessExportDeps {
  storage: StorageBackend;
  exportStore: PackageExportStore;
  /**
   * The workspace lock, when the caller holds it, for a workspace's export.
   * The export takes none of its own and leaves this one held, so a caller
   * that runs one job over several calls holds the workspace from the first
   * to the last: nothing changes it in between, and so the export's resume is
   * never refused for a workspace that changed. A package's export takes no
   * lock, and leaves it alone.
   */
  lock?: LockHandle;
  /**
   * Aborted when the caller stops this call to run the job again, as compute
   * with a time limit does before a large export has finished. The export
   * stops once the entry it is writing is written, and the call throws an
   * {@link ExportStoppedError} whose checkpoint the next call resumes from,
   * with the job left `processing`.
   */
  signal?: AbortSignal;
}

/** Input for handleProcessExport. */
export interface ProcessExportInput {
  id: string;
  repo: string;
  /** Where the zip is written: its path, or a stream, such as a multipart
   *  upload, which the export ends once the zip is whole. */
  zip: string | Writable;
  /** The checkpoint a call of this job that was stopped handed over: the
   *  export goes on from it, and `zip` holds the bytes it counts. */
  resume?: PackageZipCheckpoint;
}

/**
 * Processes a package or workspace export job.
 *
 * Gets the export record, determines whether this is a package or workspace
 * export (based on the `workspace` field), runs the appropriate export
 * function, and updates the status to completed or failed.
 *
 * @param deps - Storage backend, export store, and the caller's workspace lock
 *   and the signal that stops the call
 * @param input - Job ID, repository path, where the zip is written, and the
 *   checkpoint it resumes from
 *
 * @throws {ExportStoppedError} When `deps.signal` stopped the export, with the
 *   job left `processing`.
 * @throws Re-throws errors after updating status to failed and cleaning up
 */
export async function handleProcessExport(
  deps: ProcessExportDeps,
  input: ProcessExportInput,
): Promise<void> {
  const { storage, exportStore, lock, signal } = deps;
  const { id, repo, zip, resume } = input;

  const record = await exportStore.get(id);
  if (!record) throw new Error(`Export record ${id} not found`);

  const onProgress = throttledProgress(async ({ objectsProcessed }) => {
    await exportStore.updateStatus(id,
      variant('processing', variant('exporting', { objectsProcessed: BigInt(objectsProcessed) })));
  });

  try {
    const result = record.workspace.type === 'some'
      ? await workspaceExport(storage, repo, record.workspace.value, zip, record.name, record.version, { onProgress, lock, signal, resume })
      : await packageExport(storage, repo, record.name, record.version, zip, { onProgress, signal, resume });
    await onProgress.flush();
    await exportStore.updateStatus(id, variant('completed', {
      size: BigInt(result.bytes),
    }));
  } catch (err) {
    // A call its caller stopped hands over, and the job goes on.
    if (err instanceof ExportStoppedError) throw err;
    if (typeof zip === 'string') await unlink(zip).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    await exportStore.updateStatus(id, variant('failed', { message }));
    throw err;
  }
}

// =============================================================================
// Process Import
// =============================================================================

/** Dependencies for handleProcessImport. */
export interface ProcessImportDeps {
  storage: StorageBackend;
  importStore: PackageImportStore;
  /**
   * Aborted when the caller stops this call to run the job again, as compute
   * with a time limit does before a large import has finished. The import
   * stops between entries, and the job is left `processing` with its zip where
   * it lies: the next call reads only the objects the store does not hold.
   */
  signal?: AbortSignal;
}

/** Input for handleProcessImport. */
export interface ProcessImportInput {
  id: string;
  repo: string;
  /** The staged zip: its path, removed once the job ends, or a source read by
   *  ranges where it lies, which its owner removes. */
  zip: string | ZipSource;
}

/**
 * Processes a package import job.
 *
 * Gets the import record, verifies the zip's size matches, runs packageImport,
 * and updates the status to completed or failed. A staged zip file is removed
 * once the job ends.
 *
 * @param deps - Storage backend, import store, and the signal that stops the
 *   call
 * @param input - Job ID, repository path, and the staged zip
 *
 * @throws Re-throws errors after updating status to failed; or, when
 *   `deps.signal` has aborted, with the job left `processing`
 */
export async function handleProcessImport(
  deps: ProcessImportDeps,
  input: ProcessImportInput,
): Promise<void> {
  const { storage, importStore, signal } = deps;
  const { id, repo, zip } = input;

  const record = await importStore.get(id);
  if (!record) throw new Error(`Import record ${id} not found`);

  // Verify the zip's size matches
  const size = typeof zip === 'string' ? (await stat(zip)).size : zip.size;
  if (BigInt(size) !== record.size) {
    const message = `size mismatch: expected ${record.size}, got ${size}`;
    await importStore.updateStatus(id, variant('failed', { message }));
    if (typeof zip === 'string') await unlink(zip).catch(() => {});
    throw new Error(message);
  }

  let handedOver = false;
  try {
    const onProgress = throttledProgress(async ({ objectsProcessed }) => {
      await importStore.updateStatus(id,
        variant('processing', variant('importing', { objectsProcessed: BigInt(objectsProcessed) })));
    });

    const result = await packageImport(storage, repo, zip, { onProgress, signal });

    await onProgress.flush();
    await importStore.updateStatus(id, variant('completed', {
      name: result.name,
      version: result.version,
      packageHash: result.packageHash,
      objectCount: BigInt(result.objectCount),
    }));
  } catch (err) {
    // A call its caller stopped hands over: the job goes on, from the zip.
    if (signal?.aborted === true) {
      handedOver = true;
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    await importStore.updateStatus(id, variant('failed', { message }));
    throw err;
  } finally {
    if (typeof zip === 'string' && !handedOver) await unlink(zip).catch(() => {});
  }
}
