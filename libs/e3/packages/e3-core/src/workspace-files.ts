/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A workspace's deploy that reads the files its package's `file` sources name,
 * and its export to a zip: on the machine that has the files, and on Node's
 * streams.
 *
 * The workspace operations every backend shares are `workspaces.ts`'s; a
 * deploy here reads each `file` source's delivery where it lies and adopts it,
 * and an export writes its zip to a file or a stream.
 */

import * as fs from 'fs/promises';
import type { Writable } from 'node:stream';
import { encodeBeast2For, StringType, variant } from '@elaraai/east';
import { DatasetFileTypeMismatchError, readDatasetFileHeader } from '@elaraai/e3';
import { E3_RELEASE, ExecutionStatusType, PackageObjectType, decodePackageObject, type DatasetRef, type PackageObject } from '@elaraai/e3-types';
import { objectAdoptFile } from './dataset-adopt-file.js';
import { WorkspaceLockError } from './errors.js';
import { ZIP_RELEASE_ENTRY, addPackageObjects } from './packages.js';
import { writePackageZip } from './package-files.js';
import { withRunningWork } from './running-work.js';
import type { LockHandle, StorageBackend } from './storage/interfaces.js';
import {
  readStateOrThrow,
  workspaceDeployWith,
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
 * The zip is written an entry at a time, to a file or to a stream, as a
 * package's export writes it (`packageExport`), reading its segments ahead of
 * the entry it writes, and an export stopped at its signal is resumed from its
 * checkpoint.
 *
 * It writes a package object that nothing in the repository names, and reads
 * what the workspace named as it started, which a write may leave unnamed
 * since: so it holds the repository's running work ({@link withRunningWork}),
 * as a package's export does, and gc holding the repository still sweeps none
 * of it, and an upgrade waits for it.
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
  return withRunningWork(storage, repo, () => exportWorkspace(storage, repo, name, destination, outputName, version, options));
}

/** The export of {@link workspaceExport}, holding the repository's running
 *  work. */
async function exportWorkspace(
  storage: StorageBackend,
  repo: string,
  name: string,
  destination: string | Writable,
  outputName: string | undefined,
  version: string | undefined,
  options: WorkspaceExportOptions | undefined,
): Promise<WorkspaceExportResult> {
  if (options?.resume !== undefined && version === undefined) {
    throw new Error('a resumed export of a workspace names the version the export it resumes named');
  }

  // Acquire workspace lock for snapshot consistency
  const externalLock = options?.lock;
  let lock: LockHandle | null = externalLock ?? null;
  if (!lock) {
    lock = await storage.locks.acquire(repo, name, variant('export', null));
    if (!lock) {
      const state = await storage.locks.getState(repo, name);
      throw new WorkspaceLockError(name, state ? {
        acquiredAt: state.acquiredAt.toISOString(),
        operation: state.operation.type,
      } : undefined);
    }
  }
  try {

  // Get workspace state
  const state = await readStateOrThrow(storage, repo, name);

  // Read the deployed package object using the stored hash
  const deployedPkgData = await storage.objects.read(repo, state.packageHash);
  const deployedPkgObject = decodePackageObject(Buffer.from(deployedPkgData));

  // Determine output name and version
  const finalName = outputName ?? state.packageName;
  // For version, use a short identifier from the workspace name + timestamp
  const finalVersion = version ?? `${state.packageVersion}-${Date.now().toString(36)}`;

  // Read all workspace refs for the package
  const refList = await storage.datasets.list(repo, name);
  const workspaceRefs = new Map<string, DatasetRef>();
  for (const refPath of refList) {
    const ref = await storage.datasets.read(repo, name, refPath);
    if (ref) {
      workspaceRefs.set(refPath, ref);
    }
  }

  // Create new PackageObject with inline refs (functions and records carry
  // through unchanged — the record dataset state lives in the refs)
  const newPkgObject: PackageObject = {
    tasks: deployedPkgObject.tasks,
    data: {
      structure: deployedPkgObject.data.structure,
      refs: workspaceRefs,
    },
    functions: deployedPkgObject.functions,
    records: deployedPkgObject.records,
    // No sources: a workspace export carries the workspace's RESOLVED refs
    // (`value { hash }` plus the object bytes), so a path-initialised input
    // travels as an ordinary object and the exported package is self-contained
    // on a machine that has never seen the delivery.
    sources: new Map(),
  };

  // Encode and store the new package object
  const encoder = encodeBeast2For(PackageObjectType);
  const pkgData = encoder(newPkgObject);
  const packageHash = await storage.objects.write(repo, pkgData);

  const { objectCount, bytes } = await writePackageZip(destination, packageHash, options ?? {}, async (zip) => {
    // The release exporting it, first, so an import meets it before anything
    await zip.add(ZIP_RELEASE_ENTRY, encodeBeast2For(StringType)(E3_RELEASE));
    const objectCount = await addPackageObjects(zip, storage, repo, packageHash, newPkgObject, options?.onProgress);

    // The package ref, as a repository keeps one
    await zip.add(`packages/${finalName}/${finalVersion}.beast2`, encodeBeast2For(StringType)(packageHash));

    // Include the executions and logs of the current run. The run's own record
    // stays here: it names this repository's workspace, and a run's history
    // belongs to the repository the run ran in. The executions travel so the
    // importing repository's cache serves the outputs they made.
    if (state.currentRunId.type === 'some') {
      const currentRunId = state.currentRunId.value;
      const dataflowRun = await storage.refs.dataflowRunGet(repo, name, currentRunId);
      if (dataflowRun) {
        // Include the execution each task used, which the run's record names
        // whole: its inputs may have changed in the workspace since.
        const statusEncoder = encodeBeast2For(ExecutionStatusType);
        for (const { taskHash, inputsHash: inHash, executionId } of dataflowRun.taskExecutions.values()) {
          // Read and add execution status
          const execStatus = await storage.refs.executionGet(repo, taskHash, inHash, executionId);
          if (execStatus) {
            await zip.add(`executions/${taskHash}/${inHash}/${executionId}/status.beast2`, statusEncoder(execStatus));
          }

          // Read and add logs (stdout/stderr)
          for (const stream of ['stdout', 'stderr'] as const) {
            let log: string;
            try {
              log = (await storage.logs.read(repo, taskHash, inHash, executionId, stream, { limit: 100 * 1024 * 1024 })).data;
            } catch {
              // Skip if log not available
              continue;
            }
            if (log.length > 0) {
              await zip.add(`executions/${taskHash}/${inHash}/${executionId}/${stream}.txt`, Buffer.from(log));
            }
          }
        }
      }
    }
    return { objectCount };
  });

  return {
    packageHash,
    objectCount,
    name: finalName,
    version: finalVersion,
    bytes,
  };

  } finally {
    if (!externalLock) {
      await lock.release();
    }
  }
}
