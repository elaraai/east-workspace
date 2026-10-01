/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The package import and export jobs of the root entry, whose zip may be a
 * file on this machine or a Node stream.
 *
 * Every backend's job reads its zip from a source read by ranges and writes it
 * to a WHATWG stream (`process.ts`); these are the same jobs, given a file — a
 * zip staged on the machine that runs the job, removed once the job ends — or
 * a Node stream, such as a multipart upload.
 */

import { stat, unlink } from 'node:fs/promises';
import type { Writable } from 'node:stream';

import { openZip, packageExport } from '../package-files.js';
import { workspaceExport } from '../workspace-files.js';
import type { ZipSource } from '../zip.js';
import { handleProcessExportWith, handleProcessImportWith, type ProcessExportDeps, type ProcessImportDeps } from './process.js';
import type { PackageZipCheckpoint } from './types.js';

export type { ProcessExportDeps, ProcessImportDeps } from './process.js';

// =============================================================================
// Process Export
// =============================================================================

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
 * @remarks
 * A file is written by way of `<path>.partial`, renamed once the zip is whole,
 * before the job is recorded completed, and removed when the job fails. A
 * stream is ended once the zip is whole.
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
  const { storage } = deps;
  const { repo, zip } = input;
  return handleProcessExportWith(deps, input, {
    package: (name, version, options) => packageExport(storage, repo, name, version, zip, options),
    workspace: (workspace, name, version, options) => workspaceExport(storage, repo, workspace, zip, name, version, options),
    discard: typeof zip === 'string' ? () => unlink(zip).catch(() => {}) : undefined,
  });
}

// =============================================================================
// Process Import
// =============================================================================

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
  const { zip } = input;
  return handleProcessImportWith(deps, input, typeof zip === 'string'
    ? { size: async () => (await stat(zip)).size, open: () => openZip(zip), discard: () => unlink(zip).catch(() => {}) }
    : { size: () => Promise.resolve(zip.size), open: () => openZip(zip) });
}
