/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Package operations for e3 repositories.
 *
 * Manages packages in the content-addressed object store: reading, listing,
 * resolving and removing them, walking the objects a package consists of, and
 * a package's zip, which every backend reads and writes here: its import from
 * a zip read by ranges, a view of one without importing it, and its export to
 * a stream. A zip given as a file on this machine, or written to a Node
 * stream, is the root entry's (`package-files.ts`).
 */

import { StringType, decodeBeast2For, encodeBeast2For } from '@elaraai/east';
import {
  E3_RELEASE,
  EnvironmentSpecType,
  compareReleases,
  environmentSpecObjectHashes,
  decodeExecutionStatus,
  decodeFunctionObject,
  decodeMigrationObject,
  decodeMutationObject,
  decodePackageObject,
  decodeRecordIndexObject,
  decodeRecordObject,
  decodeTaskObject,
} from '@elaraai/e3-types';
import type { PackageObject } from '@elaraai/e3-types';
import { ExportStoppedError, PackageInvalidError, PackageNotFoundError } from './errors.js';
import { OBJECT_CONCURRENCY, TOUCH_BATCH, eachAtMost } from './concurrency.js';
import { readManifest } from './dataset-open.js';
import { computeHash } from './objects.js';
import { readRecordState } from './records.js';
import { withRunningWork } from './running-work.js';
import type { StorageBackend } from './storage/interfaces.js';
import type { PackageZipCheckpoint } from './transfer/types.js';
import {
  ZipSourceError, ZipWriter, openZip, zipSinkOf, zipSourceOf, type ZipEntry, type ZipReader, type ZipSource, type ZipWritten,
} from './zip.js';

/**
 * Result of importing a package
 */
export interface PackageImportResult {
  name: string;
  version: string;
  packageHash: string;
  objectCount: number;
}

/**
 * Options for package import
 */
export interface PackageImportOptions {
  /** Called after each object is written, or found in the store already. Can
   *  be used for progress reporting. */
  onProgress?: (progress: { objectsProcessed: number }) => Promise<void>;
  /**
   * Aborting it stops the import between entries, with an `AbortError`. What
   * it wrote stays, named by nothing until the package ref, which is written
   * last; an import of the zip again reads only the objects the store does not
   * hold. So compute with a time limit takes a large zip in over several
   * calls.
   */
  signal?: AbortSignal;
}

/**
 * The entry a package zip names the release of e3 that exported it in: a
 * String, first in the zip.
 */
export const ZIP_RELEASE_ENTRY = 'release.beast2';

/** The most bytes of objects an export reads ahead of the one it writes. */
const EXPORT_READ_AHEAD_BYTES = 64 * 1024 * 1024;

/** The largest object an import reads beside others; a larger one is read on
 *  its own, so an import holds at most {@link OBJECT_CONCURRENCY} of these. */
const IMPORT_BESIDE_BYTES = 8 * 1024 * 1024;

/** A run's logs, as an import files them. */
const LOG_TEXT = new TextDecoder();

/**
 * A package zip opened where it is: its package ref, and its objects, each
 * read from the zip when it is asked for.
 */
export interface PackageZip {
  /** The package's name, as the zip's package ref names it. */
  readonly name: string;
  /** The package's version, as the zip's package ref names it. */
  readonly version: string;
  /** The package object's hash, which the package ref holds. */
  readonly packageHash: string;
  /** How many objects the zip holds. */
  readonly objectCount: number;
  /**
   * A storage backend that reads as `storage` would once the package was
   * imported, and writes nothing.
   *
   * @remarks
   * The zip's package ref and objects are read from the zip, each object
   * checked against the hash that names it, and everything else from
   * `storage`. Every write is refused, and so is a garbage collection, so
   * whatever reads through it, such as a deploy's plan, leaves the repository
   * as it was. Its locks are `storage`'s own, so a plan through it takes the
   * workspace's lock as any plan does.
   *
   * @param storage - The repository's storage backend
   * @returns The backend to read through
   */
  view(storage: StorageBackend): StorageBackend;
  /** Closes the zip. Nothing reads from it, or through a view of it, after. */
  close(): void;
}

/**
 * Remove a package ref from the repository.
 *
 * Objects remain until gc is run.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Package name
 * @param version - Package version
 * @throws {PackageNotFoundError} If package doesn't exist
 */
export async function packageRemove(
  storage: StorageBackend,
  repo: string,
  name: string,
  version: string
): Promise<void> {
  // Check if package exists first (storage.refs.packageRemove is idempotent)
  const hash = await storage.refs.packageResolve(repo, name, version);
  if (hash === null) {
    throw new PackageNotFoundError(name, version);
  }

  await storage.refs.packageRemove(repo, name, version);
}

/**
 * List all installed packages.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @returns Array of (name, version) pairs
 */
export async function packageList(
  storage: StorageBackend,
  repo: string
): Promise<Array<{ name: string; version: string }>> {
  return storage.refs.packageList(repo);
}

/**
 * Get the latest version of a package.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Package name
 * @returns Latest version string, or undefined if package not found
 */
export async function packageGetLatestVersion(
  storage: StorageBackend,
  repo: string,
  name: string
): Promise<string | undefined> {
  const packages = await packageList(storage, repo);
  const versions = packages
    .filter(p => p.name === name)
    .map(p => p.version)
    .sort();
  return versions[versions.length - 1];
}

/**
 * Resolve a package to its PackageObject hash.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Package name
 * @param version - Package version
 * @returns PackageObject hash
 * @throws {PackageNotFoundError} If package doesn't exist
 */
export async function packageResolve(
  storage: StorageBackend,
  repo: string,
  name: string,
  version: string
): Promise<string> {
  const hash = await storage.refs.packageResolve(repo, name, version);
  if (hash === null) {
    throw new PackageNotFoundError(name, version);
  }
  return hash;
}

/**
 * Read and parse a PackageObject.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Package name
 * @param version - Package version
 * @returns Parsed PackageObject
 * @throws {PackageNotFoundError} If package doesn't exist
 */
export async function packageRead(
  storage: StorageBackend,
  repo: string,
  name: string,
  version: string
): Promise<PackageObject> {
  const hash = await packageResolve(storage, repo, name, version);
  const data = await storage.objects.read(repo, hash);
  try {
    return decodePackageObject(data);
  } catch (err: any) {
    throw new Error(`Failed to decode package ${name}@${version} (hash: ${hash}, size: ${data.byteLength} bytes): ${err.message}`);
  }
}

// =============================================================================
// Import
// =============================================================================

/**
 * Import a package from a zip read by ranges where it lies.
 *
 * Writes the zip's objects to the store and its package ref,
 * `packages/<name>/<version>.beast2`, to the repository, with the executions a
 * workspace's export carries, so the cache serves the outputs they made. A
 * run's record in the zip is not filed: it belongs to the repository the run
 * ran in.
 *
 * @remarks
 * The zip's directory is read before anything is written, so a zip a newer
 * release of e3 exported is refused with nothing of it imported. A zip an
 * older release exported is read as it is, object by object, whether its
 * entries are stored or deflated, as the SDK's `e3.export` writes them; each
 * entry's bytes are checked against the CRC-32 the zip names them by.
 *
 * The zip is read where it lies, through its source — an upload staged in an
 * object store, say; a zip that is a file on this machine is imported by the
 * root entry's `packageImport`. Its objects go first. Those the store holds
 * already — ones another package shares, or ones an import of this zip stopped
 * part way wrote — are not read but re-referenced (`ObjectStore.touch`), as a
 * write of each would be, a batch at a time; the rest are read and written
 * {@link OBJECT_CONCURRENCY} at a time, each object larger than 8 MiB on its
 * own, and each checked against the hash its entry names it by. The executions
 * come next, and the package ref is written last, once all it names is in.
 *
 * Nothing names what an import writes, or finds, until its package ref does,
 * so it holds the repository's running work ({@link withRunningWork}): gc
 * holding the repository still never sweeps them meanwhile, and an upgrade
 * waits for it. gc beside running work leaves them for its window. An import
 * stopped part way re-references every object again when it runs again,
 * since a gc between the two may have swept what the first wrote.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param zip - The zip's source
 * @param options - Progress, and a signal that stops the import between
 *   entries
 * @returns Import result with package name, version, and stats
 * @throws {PackageInvalidError} When the zip does not read — it is cut short,
 *   its directory does not read or names bytes past its end, an entry's bytes
 *   are not those its CRC-32 names — or holds no package ref, an object that
 *   is not the bytes its entry names, or an older e3 exported it in a form no
 *   longer read, or a newer release exported it
 * @throws {TypeError} When the zip is a path, which the root entry imports.
 * @throws {Error} An `AbortError`, when `options.signal` stopped the import; a
 *   read of the zip's source that failed, as the source raised it; and when a
 *   garbage collection or an upgrade holds the repository.
 */
export async function packageImport(
  storage: StorageBackend,
  repo: string,
  zip: ZipSource,
  options?: PackageImportOptions,
): Promise<PackageImportResult> {
  const source = zipSourceOf(zip, 'import');
  return packageImportFrom(storage, repo, () => openZip(source), options);
}

/**
 * Import a package from the zip `open` opens, as {@link packageImport} does:
 * what the root entry imports a zip on this machine through.
 *
 * @param open - Opens the zip, once the import holds the repository's running
 *   work
 * @internal
 */
export async function packageImportFrom(
  storage: StorageBackend,
  repo: string,
  open: () => Promise<ZipReader>,
  options?: PackageImportOptions,
): Promise<PackageImportResult> {
  return withRunningWork(storage, repo, () => importZip(storage, repo, open, options));
}

/** The import of {@link packageImportFrom}, holding the repository's running
 *  work. */
async function importZip(
  storage: StorageBackend,
  repo: string,
  open: () => Promise<ZipReader>,
  options: PackageImportOptions | undefined,
): Promise<PackageImportResult> {
  const zipfile = await readingZip(open);

  let ref: { name: string; version: string; hash: string } | undefined;
  let objectCount = 0;

  // Track current execution being assembled (flush on directory change)
  let currentExecDir: string | null = null;
  let currentExecFiles = new Map<string, Uint8Array>();

  const flushExecution = async () => {
    if (currentExecDir === null) return;
    const [taskHash, inputsHash, executionId] = currentExecDir.split('/') as [string, string, string];

    // Check if execution already exists — skip if so
    const existingStatus = await storage.refs.executionGet(repo, taskHash, inputsHash, executionId);
    if (existingStatus !== null) {
      currentExecDir = null;
      currentExecFiles = new Map();
      return;
    }

    // Write status first, in the current form whichever form it was exported in
    const statusData = currentExecFiles.get('status.beast2');
    if (statusData) {
      await storage.refs.executionWrite(repo, taskHash, inputsHash, executionId, decodeExecutionStatus(statusData));
    }

    // Write logs
    for (const stream of ['stdout.txt', 'stderr.txt'] as const) {
      const logData = currentExecFiles.get(stream);
      if (logData && logData.length > 0) {
        const streamName = stream === 'stdout.txt' ? 'stdout' : 'stderr';
        await storage.logs.append(repo, taskHash, inputsHash, executionId, streamName, LOG_TEXT.decode(logData));
      }
    }

    currentExecDir = null;
    currentExecFiles = new Map();
  };

  try {
    const entries = await zipEntries(zipfile);
    await checkZipRelease(entries.find(({ fileName }) => fileName === ZIP_RELEASE_ENTRY));

    // The objects, objects/<ab>/<cdef...>.beast2, first. Those the store holds
    // are not read again, but re-referenced a batch at a time, as a write of
    // each would be; the rest are read and written side by side.
    const objects = entries.filter(({ fileName }) => fileName.startsWith('objects/') && !fileName.endsWith('/'));
    const named = objects.flatMap(({ fileName }) => {
      const hash = objectHashOf(fileName);
      return hash === null ? [] : [hash];
    });
    const held = new Set<string>();
    for (let from = 0; from < named.length; from += TOUCH_BATCH) {
      if (options?.signal?.aborted) throw importStopped();
      const batch = named.slice(from, from + TOUCH_BATCH);
      const found = await storage.objects.touch(repo, batch);
      batch.forEach((hash, i) => {
        if (found[i] === true) held.add(hash);
      });
      objectCount += found.filter((isHeld) => isHeld).length;
      if (options?.onProgress) await options.onProgress({ objectsProcessed: objectCount });
    }
    const importObject = async ({ fileName, getData }: ZipEntry): Promise<void> => {
      if (options?.signal?.aborted) throw importStopped();
      const hash = objectHashOf(fileName);
      const written = await storage.objects.write(repo, await getData());
      if (hash !== null && written !== hash) throw new PackageInvalidError(`its object ${hash} holds the bytes of another`);
      objectCount++;
      if (options?.onProgress) {
        await options.onProgress({ objectsProcessed: objectCount });
      }
    };
    const unheld = objects.filter(({ fileName }) => {
      const hash = objectHashOf(fileName);
      return hash === null || !held.has(hash);
    });
    await eachAtMost(unheld.filter(({ size }) => size <= IMPORT_BESIDE_BYTES), OBJECT_CONCURRENCY, importObject);
    for (const entry of unheld.filter(({ size }) => size > IMPORT_BESIDE_BYTES)) await importObject(entry);

    for (const { fileName, getData } of entries) {
      if (options?.signal?.aborted) throw importStopped();

      // Skip directory entries, and the objects, which are in
      if (fileName.endsWith('/') || fileName.startsWith('objects/')) {
        continue;
      }

      // The package ref, packages/<name>/<version>.beast2, as a repository
      // keeps one: written once everything else is in.
      if (fileName.startsWith('packages/')) {
        const named = packageRefOf(fileName);
        if (named !== null) ref = { ...named, hash: decodeBeast2For(StringType)(await getData()) };
        continue;
      }

      // A run's record, dataflows/<workspace>/<runId>.beast2, which an export
      // no longer writes. It names a workspace of the repository the run ran
      // in: filed here under that name, it joined the history of a workspace
      // that is another, or of none, which gc never prunes.
      if (fileName.startsWith('dataflows/')) {
        continue;
      }

      // Handle executions: executions/<taskHash>/<inputsHash>/<executionId>/<file>
      if (fileName.startsWith('executions/')) {
        const parts = fileName.split('/');
        if (parts.length >= 5) {
          const taskHash = parts[1]!;
          const inputsHash = parts[2]!;
          const executionId = parts[3]!;
          const file = parts.slice(4).join('/');

          const execDir = `${taskHash}/${inputsHash}/${executionId}`;

          // Flush previous execution if we've moved to a new one
          if (currentExecDir !== null && currentExecDir !== execDir) {
            await flushExecution();
          }
          currentExecDir = execDir;
          currentExecFiles.set(file, await getData());
        }
        continue;
      }

      // Unknown entry type - ignore for forward compatibility
    }
  } finally {
    // Close the zip file
    zipfile.close();
  }

  // Flush the last execution
  await flushExecution();

  if (ref === undefined) {
    throw new PackageInvalidError('missing package ref');
  }
  await storage.refs.packageWrite(repo, ref.name, ref.version, ref.hash);

  return {
    name: ref.name,
    version: ref.version,
    packageHash: ref.hash,
    objectCount,
  };
}

/** The error an import stopped at its signal throws. */
function importStopped(): Error {
  const error = new Error('the import stopped at its signal: import the zip again to take in the rest');
  error.name = 'AbortError';
  return error;
}

/**
 * Runs a read of a package zip, telling the zip's faults from its source's.
 *
 * @remarks
 * A read of the zip's source that failed — a store's throttle, say, read by
 * ranges ({@link ZipSourceError}) — or the opening of a file on this machine
 * is raised as the failure it is, so a caller that runs an import in rounds
 * retries it. Any other failure to read the zip is the zip's own — it is cut
 * short, its directory names bytes past its end, an entry's bytes are damaged
 * — and no retry mends it: a {@link PackageInvalidError}.
 *
 * @throws {PackageInvalidError} When the zip does not read.
 */
async function readingZip<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof ZipSourceError) throw err.cause;
    if (err instanceof PackageInvalidError || (err instanceof Error && typeof (err as { code?: unknown }).code === 'string')) throw err;
    throw new PackageInvalidError(`the zip does not read: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** An open zip's entries, in its directory's order, each read as
 *  {@link readingZip} reads. */
async function zipEntries(zipfile: ZipReader): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];
  await readingZip(async () => {
    for await (const entry of zipfile.entries()) {
      entries.push({ fileName: entry.fileName, size: entry.size, getData: () => readingZip(entry.getData) });
    }
  });
  return entries;
}

// =============================================================================
// A zip's view
// =============================================================================

/**
 * Open a package zip read by ranges where it is, to read the package without
 * importing it.
 *
 * @remarks
 * Reads the zip's directory and its package ref, and no object: a view reads
 * an object when it is asked for one, so a caller holds no more of the zip
 * than it reads. A deploy's plan reads the package object, its record,
 * migration and index objects, and its initial values. A view places none of
 * the zip's objects in a file (`materialize`): the root entry's
 * `packageZipOpen`, which opens a zip on this machine too, does.
 *
 * @param zip - The zip's source
 * @returns The zip, open; the caller closes it
 * @throws {PackageInvalidError} When the zip does not read, holds no package
 *   ref, or an older e3 exported it in a form no longer read, or a newer
 *   release exported it, as {@link packageImport} refuses it
 * @throws {TypeError} When the zip is a path, which the root entry opens.
 * @throws {Error} A read of the zip's source that failed, as the source
 *   raised it.
 */
export async function packageZipOpen(zip: ZipSource): Promise<PackageZip> {
  const source = zipSourceOf(zip, 'open');
  return packageZipOpenFrom(() => openZip(source));
}

/**
 * Open the package zip `open` opens, as {@link packageZipOpen} does: what the
 * root entry opens a zip on this machine through.
 *
 * @param open - Opens the zip
 * @param place - Writes an object of the zip to a file on this machine, which
 *   a view's `materialize` asks for; without it, a view places none
 * @internal
 */
export async function packageZipOpenFrom(
  open: () => Promise<ZipReader>,
  place?: (destPath: string, data: Uint8Array) => Promise<void>,
): Promise<PackageZip> {
  const zipfile = await readingZip(open);
  const entries = new Map<string, ZipEntry>();
  let ref: { name: string; version: string; hash: string } | undefined;
  try {
    for (const entry of await zipEntries(zipfile)) {
      if (entry.fileName === ZIP_RELEASE_ENTRY) {
        await checkZipRelease(entry);
        continue;
      }
      const named = packageRefOf(entry.fileName);
      if (named !== null) {
        ref = { ...named, hash: decodeBeast2For(StringType)(await entry.getData()) };
        continue;
      }
      const object = objectHashOf(entry.fileName);
      if (object !== null) entries.set(object, entry);
    }
    if (ref === undefined) throw new PackageInvalidError('missing package ref');
  } catch (err) {
    zipfile.close();
    throw err;
  }
  const { name, version, hash: packageHash } = ref;

  // An object the zip holds, checked against the hash that names it; null for
  // one it does not.
  const readObject = async (hash: string): Promise<Uint8Array | null> => {
    const entry = entries.get(hash);
    if (entry === undefined) return null;
    const data = await entry.getData();
    if (computeHash(data) !== hash) throw new PackageInvalidError(`its object ${hash} holds the bytes of another`);
    return data;
  };

  const view = (storage: StorageBackend): StorageBackend => {
    const refuse = (what: string) => (): Promise<never> =>
      Promise.reject(new Error(`a view of a package zip writes nothing, and was asked to ${what}`));
    const { objects, refs, logs, repos, datasets } = storage;
    return {
      upgrades: storage.upgrades,
      objects: {
        write: refuse('write an object'),
        writeStream: refuse('write an object'),
        touch: refuse('re-reference an object'),
        adoptFile: refuse('adopt a file'),
        read: async (repo, hash) => (await readObject(hash)) ?? objects.read(repo, hash),
        readRange: async (repo, hash, offset, length) => {
          const data = await readObject(hash);
          return data === null ? objects.readRange(repo, hash, offset, length) : data.subarray(offset, offset + length);
        },
        materialize: async (repo, hash, destPath, options) => {
          const data = await readObject(hash);
          if (data === null) return objects.materialize(repo, hash, destPath, options);
          if (place === undefined) {
            throw new Error(`a view of a package zip places its object ${hash} in a file only as the root entry of @elaraai/e3-core opens the zip`);
          }
          await place(destPath, data);
        },
        placement: objects.placement,
        exists: async (repo, hash) => entries.has(hash) || objects.exists(repo, hash),
        stat: async (repo, hash) => {
          const entry = entries.get(hash);
          return entry === undefined ? objects.stat(repo, hash) : { size: entry.size };
        },
        list: async (repo) => [...new Set([...await objects.list(repo), ...entries.keys()])],
        count: async (repo) => new Set([...await objects.list(repo), ...entries.keys()]).size,
      },
      refs: {
        repositoryRead: refs.repositoryRead.bind(refs),
        repositoryWrite: refuse('write the repository record'),
        packageList: async (repo) => [
          ...(await refs.packageList(repo)).filter((p) => p.name !== name || p.version !== version),
          { name, version },
        ],
        packageResolve: async (repo, pkgName, pkgVersion) =>
          pkgName === name && pkgVersion === version ? packageHash : refs.packageResolve(repo, pkgName, pkgVersion),
        packageWrite: refuse('write a package ref'),
        packageRemove: refuse('remove a package ref'),
        workspaceList: refs.workspaceList.bind(refs),
        workspaceRead: refs.workspaceRead.bind(refs),
        workspaceWrite: refuse('write a workspace'),
        workspaceRemove: refuse('remove a workspace'),
        executionGet: refs.executionGet.bind(refs),
        executionWrite: refuse('write an execution'),
        executionDelete: refuse('delete an execution'),
        executionListIds: refs.executionListIds.bind(refs),
        executionGetLatest: refs.executionGetLatest.bind(refs),
        executionList: refs.executionList.bind(refs),
        executionListForTask: refs.executionListForTask.bind(refs),
        executionListLatest: refs.executionListLatest.bind(refs),
        executionOwnerWrite: refuse('write an execution\'s owner'),
        executionOwnerRead: refs.executionOwnerRead.bind(refs),
        executionPlanWrite: refuse('write an execution\'s plan'),
        executionPlanRead: refs.executionPlanRead.bind(refs),
        adoptionWrite: refuse('write an adoption'),
        adoptionRead: refs.adoptionRead.bind(refs),
        adoptionList: refs.adoptionList.bind(refs),
        adoptionDelete: refuse('forget an adoption'),
        dataflowRunGet: refs.dataflowRunGet.bind(refs),
        dataflowRunWrite: refuse('write a run'),
        dataflowRunList: refs.dataflowRunList.bind(refs),
        dataflowRunGetLatest: refs.dataflowRunGetLatest.bind(refs),
        dataflowRunDelete: refuse('delete a run'),
      },
      locks: storage.locks,
      logs: {
        append: refuse('append to a log'),
        read: logs.read.bind(logs),
        remove: refuse('remove a log'),
      },
      repos: {
        list: repos.list.bind(repos),
        exists: repos.exists.bind(repos),
        getMetadata: repos.getMetadata.bind(repos),
        create: refuse('create a repository'),
        setStatus: refuse('set a repository\'s status'),
        remove: refuse('remove a repository'),
        deleteRefsBatch: refuse('delete refs'),
        deleteObjectsBatch: refuse('delete objects'),
        gcScanPackageRoots: refuse('collect garbage'),
        gcScanWorkspaceRoots: refuse('collect garbage'),
        gcScanExecutionRoots: refuse('collect garbage'),
        gcScanObjects: refuse('collect garbage'),
        gcDeleteObjects: refuse('collect garbage'),
        gcNoteUnreachable: refuse('collect garbage'),
        gcClearUnreachable: refuse('collect garbage'),
        gcDeleteUnreachable: refuse('collect garbage'),
        gcRunWrite: refuse('collect garbage'),
        gcRunRead: refuse('collect garbage'),
        gcRunDelete: refuse('collect garbage'),
        gcSweepBackend: refuse('collect garbage'),
      },
      datasets: {
        read: datasets.read.bind(datasets),
        write: refuse('write a dataset ref'),
        readVersioned: datasets.readVersioned.bind(datasets),
        writeIf: refuse('write a dataset ref'),
        list: datasets.list.bind(datasets),
        remove: refuse('remove a dataset ref'),
        removeAll: refuse('remove a workspace\'s dataset refs'),
      },
      validateRepository: storage.validateRepository.bind(storage),
    };
  };

  return { name, version, packageHash, objectCount: entries.size, view, close: () => zipfile.close() };
}

// =============================================================================
// Export
// =============================================================================

/**
 * Result of exporting a package
 */
export interface PackageExportResult {
  packageHash: string;
  objectCount: number;
  /** The zip's size in bytes. */
  bytes: number;
}

/**
 * Options for package export
 */
export interface PackageExportOptions {
  /** Called after each object is added, or found in the zip already. Can be
   *  used for progress reporting. */
  onProgress?: (progress: { objectsProcessed: number }) => Promise<void>;
  /**
   * Aborting it stops the export once the entry it is writing is written: it
   * throws an `ExportStoppedError` holding the checkpoint it resumes from. A
   * stream is left open, holding the zip so far; a file destination of the
   * root entry's keeps it at `<path>.partial`.
   */
  signal?: AbortSignal;
  /**
   * The checkpoint a stopped export handed over: the export writes the
   * entries after it, to a destination that holds the zip's bytes up to it — a
   * file's `<path>.partial`, cut back to them — and the zip is the one an
   * export never stopped writes.
   */
  resume?: PackageZipCheckpoint;
}

/** The most bytes of an object {@link latin1Text} turns into characters at a
 *  time: under what one call's arguments hold. */
const LATIN1_CHUNK_BYTES = 8192;

/** An object's bytes as Latin-1 text: a character per byte, the character's
 *  code the byte's value. */
function latin1Text(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += LATIN1_CHUNK_BYTES) {
    text += String.fromCharCode(...bytes.subarray(at, at + LATIN1_CHUNK_BYTES));
  }
  return text;
}

/**
 * Visits every object a package consists of, each once.
 *
 * @remarks
 * The package object, then what it names: each task with its program or
 * command, the functions and value its output folds with, and its
 * environment; each function with its IR and environment; each record with its
 * mutations, index declarations and migrations; and the stored value of each
 * dataset ref.
 * A value is more than the object its ref names. A collection held as a
 * segment manifest is the manifest, its
 * header and every segment, and an indexed record's ref names a `$record`
 * state over the primary's manifest and one per index, each index built under
 * a declaration of its own. An export that stopped at the named object would
 * import a dataset whose segments are absent, or a record that cannot be
 * read, mutated or redeployed, so a package export and a workspace export
 * both walk this.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param packageHash - the package object's hash
 * @param pkg - the package object
 * @param visit - called once per object, in walk order, with its size in bytes
 *   when the walk knows it: a segment's, which its manifest records
 */
export async function walkPackageObjects(
  storage: StorageBackend,
  repo: string,
  packageHash: string,
  pkg: PackageObject,
  visit: (hash: string, bytes?: number) => Promise<void>,
): Promise<void> {
  const seen = new Set<string>();
  const add = async (hash: string, bytes?: number): Promise<void> => {
    if (seen.has(hash)) return;
    seen.add(hash);
    await visit(hash, bytes);
  };

  // An IR may name objects by hash: any 64-hex run in it that the store
  // holds is taken to be one, and walked in turn.
  const addNamedIn = async (hash: string): Promise<void> => {
    const text = latin1Text(await storage.objects.read(repo, hash));
    for (const [candidate] of text.matchAll(/[a-f0-9]{64}/g)) {
      if (seen.has(candidate) || !(await storage.objects.exists(repo, candidate))) continue;
      await add(candidate);
      await addNamedIn(candidate);
    }
  };

  // An environment spec, and every blob it names: manifest, lockfile, sdists.
  const decodeEnvironmentSpec = decodeBeast2For(EnvironmentSpecType);
  const addEnvironment = async (envHash: string): Promise<void> => {
    await add(envHash);
    const spec = decodeEnvironmentSpec(await storage.objects.read(repo, envHash));
    for (const blobHash of environmentSpecObjectHashes(spec)) await add(blobHash);
  };

  // An index declaration, and every IR bundle it names: the key function, the
  // covering projection and the build program. A record object names one per
  // declared index and a record STATE names the one each index was actually
  // built under — the same object only until a declaration changes, and both
  // have to travel.
  const addRecordIndex = async (indexHash: string): Promise<void> => {
    await add(indexHash);
    const index = decodeRecordIndexObject(await storage.objects.read(repo, indexHash));
    await add(index.keyIr);
    await add(index.buildIr);
    if (index.valueIr.type === 'some') await add(index.valueIr.value);
  };

  await add(packageHash);

  for (const taskHash of pkg.tasks.values()) {
    await add(taskHash);
    const task = decodeTaskObject(await storage.objects.read(repo, taskHash));
    const body = task.body.type === 'east' ? task.body.value.program : task.body.value.commandIr;
    await add(body);
    await addNamedIn(body);
    const kind = task.output.kind;
    if (kind.type === 'dict' && kind.value.merge.type === 'some') await add(kind.value.merge.value);
    if (kind.type === 'fold') {
      await add(kind.value.zero);
      await add(kind.value.combine);
    }
    if (task.environment.type === 'some') await addEnvironment(task.environment.value);
  }

  for (const fnHash of pkg.functions.values()) {
    await add(fnHash);
    const fn = decodeFunctionObject(await storage.objects.read(repo, fnHash));
    await add(fn.bodyIr);
    await addNamedIn(fn.bodyIr);
    if (fn.environment.type === 'some') await addEnvironment(fn.environment.value);
  }

  // A record travels as its state — a ref below — plus the programs that
  // write and rebuild it.
  const recordPaths = new Set<string>();
  for (const recHash of pkg.records.values()) {
    await add(recHash);
    const record = decodeRecordObject(await storage.objects.read(repo, recHash));
    recordPaths.add(record.path);
    for (const mutationHash of record.mutations.values()) {
      await add(mutationHash);
      const mutation = decodeMutationObject(await storage.objects.read(repo, mutationHash));
      await add(mutation.bodyIr);
      // A mutation deployed before the delta existed names no program.
      if (mutation.programIr !== '') await add(mutation.programIr);
    }
    for (const indexHash of record.indexes.values()) await addRecordIndex(indexHash);
    // A deploy of the import runs the steps a workspace has not applied: a
    // value step its function, a step split over the state its program.
    for (const step of record.migrations) {
      await add(step.migration);
      const migration = decodeMigrationObject(await storage.objects.read(repo, step.migration));
      await add(migration.bodyIr);
      if (migration.programIr !== '') await add(migration.programIr);
    }
  }

  for (const [refPath, ref] of pkg.data.refs) {
    if (ref.type !== 'value') continue;
    await add(ref.value.hash);
    const held = recordPaths.has(refPath)
      ? await readRecordState(storage, repo, ref.value.hash)
      : { primary: ref.value.hash, indexes: new Map<string, { manifest: string; index: string }>() };
    for (const manifestHash of [held.primary, ...[...held.indexes.values()].map((index) => index.manifest)]) {
      await add(manifestHash);
      const manifest = await readManifest(storage, repo, manifestHash);
      if (manifest !== null) {
        await add(manifest.header);
        for (const entry of manifest.entries) await add(entry.hash, Number(entry.bytes));
      }
    }
    for (const index of held.indexes.values()) await addRecordIndex(index.index);
  }
}

/**
 * Adds every object a package consists of ({@link walkPackageObjects}) to a
 * zip, in walk order, reading ahead of the one it writes.
 *
 * @remarks
 * An object whose size the walk knows — a segment, by its manifest — is read
 * ahead, {@link OBJECT_CONCURRENCY} at most and 64 MiB between them, so an
 * export from a store elsewhere waits on a request per few objects rather
 * than one each. Any other object, which may be a large value, is read when
 * it is next. One the zip holds already, which the export being resumed
 * wrote, is not read.
 *
 * @param zip - The zip being written
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param packageHash - The package object's hash
 * @param pkg - The package object
 * @param onProgress - Told as each object is added, or found in the zip
 * @returns How many objects the package consists of
 * @throws {ExportStoppedError} When the export's signal has aborted.
 * @internal
 */
export async function addPackageObjects(
  zip: PackageZipWriter,
  storage: StorageBackend,
  repo: string,
  packageHash: string,
  pkg: PackageObject,
  onProgress?: (progress: { objectsProcessed: number }) => Promise<void>,
): Promise<number> {
  const objects: { hash: string; bytes: number | null }[] = [];
  await walkPackageObjects(storage, repo, packageHash, pkg, (hash, bytes) => {
    objects.push({ hash, bytes: bytes ?? null });
    return Promise.resolve();
  });
  const unwritten = objects.filter(({ hash }) => !zip.has(objectEntryName(hash)));
  let added = objects.length - unwritten.length;
  if (added > 0 && onProgress) await onProgress({ objectsProcessed: added });
  const report = async (): Promise<void> => {
    added++;
    if (onProgress) await onProgress({ objectsProcessed: added });
  };
  const reads = new Map<number, Promise<Uint8Array>>();
  let next = 0;
  let ahead = 0;
  for (let i = 0; i < unwritten.length; i++) {
    // Read ahead the objects of known size that fit, and this one whatever it is
    while (next < unwritten.length && reads.size < OBJECT_CONCURRENCY) {
      const { hash, bytes } = unwritten[next]!;
      if (next > i && (bytes === null || ahead + bytes > EXPORT_READ_AHEAD_BYTES)) break;
      const reading = storage.objects.read(repo, hash);
      reading.catch(() => { /* heard by its turn, or dropped with the export */ });
      reads.set(next, reading);
      ahead += bytes ?? 0;
      next++;
    }
    const { hash, bytes } = unwritten[i]!;
    const data = await reads.get(i)!;
    reads.delete(i);
    ahead -= bytes ?? 0;
    await zip.add(objectEntryName(hash), data);
    await report();
  }
  return objects.length;
}

/** A package zip being written, entry by entry. @internal */
export interface PackageZipWriter {
  /**
   * Adds an entry, unless the zip holds it already — the export being resumed
   * wrote it — reading its bytes only when it is written.
   *
   * @param name - The entry's name
   * @param data - Its bytes, or how to read them
   * @throws {ExportStoppedError} When the export's signal has aborted.
   */
  add(name: string, data: Uint8Array | (() => Promise<Uint8Array>)): Promise<void>;
  /**
   * Whether the zip holds an entry of this name: the export being resumed
   * wrote it.
   *
   * @param name - The entry's name
   * @returns Whether it does
   */
  has(name: string): boolean;
}

/**
 * The name a package zip holds an object under:
 * `objects/<ab>/<cdef...>.beast2`, as a repository keeps it.
 *
 * @param hash - The object's hash
 * @returns The entry's name
 * @internal
 */
export function objectEntryName(hash: string): string {
  return `objects/${hash.slice(0, 2)}/${hash.slice(2)}.beast2`;
}

/**
 * Export a package to a stream.
 *
 * Collects the package object and every object it consists of
 * (`walkPackageObjects`).
 *
 * @remarks
 * The zip is written an entry at a time to the stream — a multipart upload, a
 * file a browser keeps — which is closed once the zip is whole; a file on this
 * machine, or a Node stream, is written to by the root entry's
 * `packageExport`. Its segments are read ahead of the entry it writes
 * ({@link addPackageObjects}). An export stopped at `options.signal` throws an
 * {@link ExportStoppedError}, whose checkpoint an export given it as
 * `options.resume` goes on from, and leaves the stream open, holding the bytes
 * the checkpoint counts.
 *
 * It holds the repository's running work ({@link withRunningWork}) while it
 * reads, as an import does: gc holding the repository still never sweeps what
 * it reads — a package removed meanwhile — and an upgrade waits for it rather
 * than rewrite the store under it. An export resumed in another call holds it
 * in that call, and refuses a checkpoint another release wrote, so an export
 * that straddles an upgraded release starts again.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Package name
 * @param version - Package version
 * @param destination - The stream the zip's bytes go to
 * @param options - Progress, and the signal that stops the export and the
 *   checkpoint it resumes from
 * @returns Export result with package hash, object count and the zip's size
 * @throws {ExportStoppedError} When `options.signal` stopped the export.
 * @throws {TypeError} When the destination is no `WritableStream`: a path or a
 *   Node stream, which the root entry writes to.
 * @throws {Error} When `options.resume` is a checkpoint of another package, or
 *   another release wrote it; when the stream fails a write; and when a
 *   garbage collection or an upgrade holds the repository.
 */
export async function packageExport(
  storage: StorageBackend,
  repo: string,
  name: string,
  version: string,
  destination: WritableStream<Uint8Array>,
  options: PackageExportOptions = {},
): Promise<PackageExportResult> {
  const sink = zipSinkOf(destination, 'export');
  return withRunningWork(storage, repo, async () => {
    const packageHash = await packageResolve(storage, repo, name, version);
    const packageObject = decodePackageObject(await storage.objects.read(repo, packageHash));

    return writePackageZip(sink, packageHash, options, async (zip) => {
      // The release exporting it, first, so an import meets it before anything
      await zip.add(ZIP_RELEASE_ENTRY, encodeBeast2For(StringType)(E3_RELEASE));
      const objectCount = await addPackageObjects(zip, storage, repo, packageHash, packageObject, options.onProgress);

      // The package ref, as a repository keeps one
      await zip.add(`packages/${name}/${version}.beast2`, encodeBeast2For(StringType)(packageHash));
      return { packageHash, objectCount };
    });
  });
}

/**
 * Writes a package zip to a stream, whose entries `write` adds, and closes the
 * stream once the zip is whole.
 *
 * @remarks
 * An export stopped at its signal ends between entries, with an
 * {@link ExportStoppedError}, and leaves the stream open, holding the bytes
 * the checkpoint counts. Given that checkpoint, an export goes on: the entries
 * the checkpoint names are not written again, to a stream that holds their
 * bytes, so the zip is the one an export never stopped writes. A stream that
 * fails a write is left as it is.
 *
 * @param sink - The stream the zip's bytes go to
 * @param packageHash - The package the zip carries, which a checkpoint names
 * @param options - The signal that stops the export, and the checkpoint it
 *   resumes from
 * @param write - Adds the zip's entries, in order, and returns what the export
 *   reports
 * @returns What `write` returned, and the zip's size in bytes
 * @throws {ExportStoppedError} When the signal stopped the export.
 * @throws {Error} When the checkpoint is of another package, or another
 *   release wrote it.
 * @internal
 */
export async function writePackageZip<T>(
  sink: WritableStream<Uint8Array>,
  packageHash: string,
  options: { signal?: AbortSignal; resume?: PackageZipCheckpoint },
  write: (zip: PackageZipWriter) => Promise<T>,
): Promise<T & { bytes: number }> {
  const resume = options.resume;
  if (resume !== undefined && resume.release !== E3_RELEASE) {
    throw new Error(`the export's checkpoint was written by e3 ${resume.release}, and this e3 is ${E3_RELEASE} — export it again from the start`);
  }
  if (resume !== undefined && resume.packageHash !== packageHash) {
    throw new Error(`the export's checkpoint is of package ${resume.packageHash}, and the package is now ${packageHash}: it changed since the export started — export it again from the start`);
  }
  const zip = new ZipWriter(sink, resume === undefined ? undefined : zipWrittenOf(resume));
  const result = await write({
    add: async (name, data) => {
      if (zip.has(name)) return;
      if (options.signal?.aborted) throw new ExportStoppedError(checkpointOf(zip.progress, packageHash));
      await zip.add(name, typeof data === 'function' ? await data() : data);
    },
    has: (name) => zip.has(name),
  });
  const bytes = await zip.finish();
  // The zip is whole: the stream ends.
  await sink.close();
  return { ...result, bytes };
}

/**
 * Where an export resumes when its destination holds only the zip's first
 * `bytes`: a stopped export's checkpoint names every entry it wrote, and a
 * multipart upload keeps only its whole parts.
 *
 * @param checkpoint - The checkpoint the stopped export handed over
 * @param bytes - How many of the zip's bytes the destination holds: no more
 *   than the checkpoint counts
 * @returns The checkpoint of the entries that end within those bytes; and how
 *   many of the bytes held an export resumed from it writes again — from the
 *   start of the first entry it writes — which the destination drops
 * @throws {Error} When `bytes` is more than the checkpoint counts.
 */
export function packageZipCheckpointWithin(
  checkpoint: PackageZipCheckpoint,
  bytes: number,
): { checkpoint: PackageZipCheckpoint; rewritten: number } {
  const written = zipWrittenOf(checkpoint);
  if (bytes > written.bytes) {
    throw new Error(`the destination holds ${bytes} bytes of a zip whose checkpoint counts ${written.bytes}`);
  }
  // An entry ends where the next begins, and the last where the zip so far ends.
  const entries = written.entries;
  const first = entries.findIndex((_, i) => (i + 1 < entries.length ? entries[i + 1]!.offset : written.bytes) > bytes);
  if (first === -1) return { checkpoint, rewritten: 0 };
  const start = entries[first]!.offset;
  return {
    checkpoint: checkpointOf({ bytes: start, entries: entries.slice(0, first) }, checkpoint.packageHash),
    rewritten: bytes - start,
  };
}

/** A checkpoint, as a {@link ZipWriter} goes on from it. */
function zipWrittenOf(checkpoint: PackageZipCheckpoint): ZipWritten {
  return {
    bytes: Number(checkpoint.bytes),
    entries: checkpoint.entries.map((entry) => ({
      name: entry.name,
      crc32: Number(entry.crc32),
      size: Number(entry.size),
      offset: Number(entry.offset),
    })),
  };
}

/** Where a {@link ZipWriter} has got to, as a checkpoint of this release's
 *  export of `packageHash`. */
function checkpointOf(written: ZipWritten, packageHash: string): PackageZipCheckpoint {
  return {
    release: E3_RELEASE,
    packageHash,
    bytes: BigInt(written.bytes),
    entries: written.entries.map((entry) => ({
      name: entry.name,
      crc32: BigInt(entry.crc32),
      size: BigInt(entry.size),
      offset: BigInt(entry.offset),
    })),
  };
}

// =============================================================================
// A zip's entries
// =============================================================================

/** The hash an object entry's name names, or null when the entry is none. */
function objectHashOf(fileName: string): string | null {
  const object = /^objects\/([0-9a-f]{2})\/([0-9a-f]{62})\.beast2$/.exec(fileName);
  return object === null ? null : `${object[1]}${object[2]}`;
}

/**
 * Refuses a zip a newer release of e3 exported, by the release its
 * {@link ZIP_RELEASE_ENTRY} names. A zip without one was exported before zips
 * named their release, and is read as an older release's is.
 *
 * @param entry - The zip's release entry, if it has one
 * @throws {PackageInvalidError} When a newer release exported the zip, or the
 *   entry names what is no release
 */
async function checkZipRelease(entry: ZipEntry | undefined): Promise<void> {
  if (entry === undefined) return;
  const release = decodeBeast2For(StringType)(await entry.getData());
  let order: number;
  try {
    order = compareReleases(release, E3_RELEASE);
  } catch (err) {
    throw new PackageInvalidError(err instanceof Error ? err.message : String(err));
  }
  if (order > 0) {
    throw new PackageInvalidError(`e3 ${release} exported it, and this e3 is ${E3_RELEASE} — import it with e3 ${release} or a newer one`);
  }
}

/**
 * The package a zip entry is the ref of: `packages/<name>/<version>.beast2`,
 * as a repository keeps one.
 *
 * @param fileName - The entry's name
 * @returns The package's name and version, or null when the entry is no ref
 * @throws {PackageInvalidError} When the entry is a ref as an older e3 wrote
 *   it, as text without the extension
 */
function packageRefOf(fileName: string): { name: string; version: string } | null {
  const parts = fileName.split('/');
  if (parts[0] !== 'packages' || parts.length !== 3) return null;
  if (!parts[2]!.endsWith('.beast2')) {
    throw new PackageInvalidError('an older e3 exported it — export it again with the current one');
  }
  return { name: parts[1]!, version: parts[2]!.slice(0, -'.beast2'.length) };
}
