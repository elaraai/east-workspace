/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A workspace's deploy that reads the files its package's `file` sources name,
 * and its export to a zip that is a file on this machine or a Node stream.
 *
 * The workspace operations every backend shares are `workspaces.ts`'s, an
 * export to a WHATWG stream among them; a deploy here reads each `file`
 * source's delivery where it lies and adopts it, and an export writes its zip
 * to a file or a Node stream, as `package-files.ts` writes a package's.
 */

import * as fs from 'fs/promises';
import type { Writable } from 'node:stream';
import { DatasetFileTypeMismatchError, readDatasetFileHeader } from '@elaraai/e3';
import { objectAdoptFile } from './dataset-adopt-file.js';
import { exportZipTo } from './package-files.js';
import type { StorageBackend } from './storage/interfaces.js';
import {
  workspaceDeployWith,
  workspaceExport as workspaceExportTo,
  type DeployFiles,
  type WorkspaceDeployOptions,
  type WorkspaceExportOptions,
  type WorkspaceExportResult,
} from './workspaces.js';

/** The files a deploy reads on this machine. */
const MACHINE_FILES: DeployFiles = {
  check(file, subject, type) {
    try {
      readDatasetFileHeader(file, subject, type);
      return null;
    } catch (err) {
      if (err instanceof DatasetFileTypeMismatchError) throw err;
      return { err };
    }
  },
  size: async (file) => (await fs.stat(file)).size,
  adopt: (storage, repo, file, options) => objectAdoptFile(storage, repo, file, options),
};

/**
 * Deploy a package to a workspace.
 *
 * Creates the workspace if it doesn't exist. Writes state file atomically
 * containing deployment info. Initializes per-dataset ref files from the
 * package's data/ directory.
 *
 * Acquires a workspace lock to prevent conflicts with running dataflows
 * or concurrent deploys. Throws WorkspaceLockError if the workspace is
 * currently locked by another process.
 *
 * A package's `file` source names a file on the machine that exported it: this
 * deploy reads it here, unless `options.resolveFileSources` is false, checks
 * its header against the type its input declares, and adopts it by hash.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Workspace name
 * @param pkgName - Package name
 * @param pkgVersion - Package version
 * @param options - Optional settings including external lock
 * @throws {InvalidNameError} If `name` is no workspace's name, before the lock
 *   is taken
 * @throws {WorkspaceLockError} If workspace is locked by another process
 * @throws {RecordDeployRefusedError} When a record cannot be carried into the
 *   package: it changed type with no migration, its applied migrations are not
 *   the package's, the policy runs none, or the package drops it
 * @throws {Error} When a garbage collection is running in the repository, the
 *   workspace's deployment does not read, or a migration or an index build
 *   fails
 */
export async function workspaceDeploy(
  storage: StorageBackend,
  repo: string,
  name: string,
  pkgName: string,
  pkgVersion: string,
  options: WorkspaceDeployOptions = {}
): Promise<void> {
  return workspaceDeployWith(storage, repo, name, pkgName, pkgVersion, options, MACHINE_FILES);
}

/**
 * Export a workspace as a package.
 *
 * 1. Read workspace state
 * 2. Read deployed package structure using stored packageHash
 * 3. Create new PackageObject with current structure
 * 4. Collect all referenced objects from dataset refs
 * 5. Write the release exporting it, the objects, the package ref and the
 *    executions the current run used to the .zip — not the run's record,
 *    which names this repository's workspace
 *
 * The zip is written an entry at a time, as the portable entry's
 * `workspaceExport` writes it to a WHATWG stream: to a file, by way of
 * `<path>.partial`, renamed once the zip is whole, or to a Node stream, as a
 * package's export writes it (`packageExport`), reading its segments ahead of
 * the entry it writes; and an export stopped at its signal is resumed from its
 * checkpoint.
 *
 * It writes a package object that nothing in the repository names, and reads
 * what the workspace named as it started, which a write may leave unnamed
 * since: so it holds the repository's running work, as a package's export
 * does, and gc holding the repository still sweeps none of it, and an upgrade
 * waits for it.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Workspace name
 * @param destination - The path to write the .zip file to, or the stream to
 *   write its bytes to
 * @param outputName - Package name (default: deployed package name)
 * @param version - Package version (default: <pkgVersion>-<short hash>)
 * @param options - Progress, the workspace lock, and the signal that stops the
 *   export and the checkpoint it resumes from
 * @returns Export result with package info and the zip's size
 * @throws {InvalidNameError} If `name` is no workspace's name, before a lock is
 *   taken or the file written
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace exists but has no package deployed
 * @throws {ExportStoppedError} When `options.signal` stopped the export.
 * @throws {Error} When `options.resume` is given without the version, or is a
 *   checkpoint of the workspace as it was before it changed; and when a
 *   garbage collection or an upgrade holds the repository.
 */
export async function workspaceExport(
  storage: StorageBackend,
  repo: string,
  name: string,
  destination: string | Writable,
  outputName?: string,
  version?: string,
  options?: WorkspaceExportOptions,
): Promise<WorkspaceExportResult> {
  return exportZipTo(destination, options?.resume, (sink) => workspaceExportTo(storage, repo, name, sink, outputName, version, options));
}
