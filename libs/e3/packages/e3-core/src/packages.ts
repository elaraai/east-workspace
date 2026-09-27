/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Package operations for e3 repositories.
 *
 * Handles importing, exporting, and managing packages in the content-addressed
 * object store.
 */

import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { StringType, decodeBeast2For, encodeBeast2For } from '@elaraai/east';
import {
  E3_RELEASE,
  EnvironmentSpecType,
  RecordIndexObjectType,
  compareReleases,
  environmentSpecObjectHashes,
  decodeFunctionObject,
  decodeMigrationObject,
  decodeMutationObject,
  decodePackageObject,
  decodeExecutionStatus,
  decodeRecordObject,
  decodeTaskObject,
} from '@elaraai/e3-types';
import type { PackageObject } from '@elaraai/e3-types';
import {
  PackageNotFoundError,
  PackageInvalidError,
} from './errors.js';
import { readManifest } from './dataset-open.js';
import { computeHash } from './objects.js';
import { readRecordState } from './records.js';
import type { StorageBackend } from './storage/interfaces.js';

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
  /** Called after each object is written. Can be used for progress reporting. */
  onProgress?: (progress: { objectsProcessed: number }) => Promise<void>;
}

/**
 * The entry a package zip names the release of e3 that exported it in: a
 * String, first in the zip.
 */
export const ZIP_RELEASE_ENTRY = 'release.beast2';

/**
 * Import a package from a .zip file into the repository.
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
 * older release exported is read as it is, object by object.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param zipPath - Path to the .zip package file
 * @param options - Optional import options (e.g. progress callback)
 * @returns Import result with package name, version, and stats
 * @throws {PackageInvalidError} When the zip holds no package ref, or an older
 *   e3 exported it in a form no longer read, or a newer release exported it
 */
export async function packageImport(
  storage: StorageBackend,
  repo: string,
  zipPath: string,
  options?: PackageImportOptions,
): Promise<PackageImportResult> {
  const zipfile = await openZip(zipPath);

  let packageName: string | undefined;
  let packageVersion: string | undefined;
  let packageHash: string | undefined;
  let objectCount = 0;

  // Track current execution being assembled (flush on directory change)
  let currentExecDir: string | null = null;
  let currentExecFiles = new Map<string, Buffer>();

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
        await storage.logs.append(repo, taskHash, inputsHash, executionId, streamName, logData.toString('utf-8'));
      }
    }

    currentExecDir = null;
    currentExecFiles = new Map();
  };

  try {
    const entries: ZipEntry[] = [];
    for await (const entry of iterateZipEntries(zipfile)) entries.push(entry);
    await checkZipRelease(entries.find(({ fileName }) => fileName === ZIP_RELEASE_ENTRY));

    for (const { fileName, getData } of entries) {
      // Skip directory entries
      if (fileName.endsWith('/')) {
        continue;
      }

      // The package ref, packages/<name>/<version>.beast2, as a repository
      // keeps one.
      if (fileName.startsWith('packages/')) {
        const ref = packageRefOf(fileName);
        if (ref !== null) {
          packageName = ref.name;
          packageVersion = ref.version;
          packageHash = decodeBeast2For(StringType)(await getData());
          await storage.refs.packageWrite(repo, packageName, packageVersion, packageHash);
        }
        continue;
      }

      // Handle object: objects/<ab>/<cdef...>.beast2
      if (fileName.startsWith('objects/')) {
        const data = await getData();

        // Store the object (storage.objects.write will verify the hash matches)
        await storage.objects.write(repo, data);
        objectCount++;
        if (options?.onProgress) {
          await options.onProgress({ objectsProcessed: objectCount });
        }
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

  if (!packageName || !packageVersion || !packageHash) {
    throw new PackageInvalidError('missing package ref');
  }

  return {
    name: packageName,
    version: packageVersion,
    packageHash,
    objectCount,
  };
}

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
 * Open a package zip where it is, to read the package without importing it.
 *
 * @remarks
 * Reads the zip's directory and its package ref, and no object: a view reads
 * an object when it is asked for one, so a caller holds no more of the zip
 * than it reads. A deploy's plan reads the package object, its record,
 * migration and index objects, and its initial values.
 *
 * @param zipPath - Path to the .zip package file
 * @returns The zip, open; the caller closes it
 * @throws {PackageInvalidError} When the zip holds no package ref, or an older
 *   e3 exported it in a form no longer read, or a newer release exported it,
 *   as {@link packageImport} refuses it
 */
export async function packageZipOpen(zipPath: string): Promise<PackageZip> {
  const zipfile = await openZip(zipPath);
  const entries = new Map<string, ZipEntry>();
  let ref: { name: string; version: string; hash: string } | undefined;
  try {
    for await (const entry of iterateZipEntries(zipfile)) {
      if (entry.fileName === ZIP_RELEASE_ENTRY) {
        await checkZipRelease(entry);
        continue;
      }
      const named = packageRefOf(entry.fileName);
      if (named !== null) {
        ref = { ...named, hash: decodeBeast2For(StringType)(await entry.getData()) };
        continue;
      }
      const object = /^objects\/([0-9a-f]{2})\/([0-9a-f]{62})\.beast2$/.exec(entry.fileName);
      if (object !== null) entries.set(`${object[1]}${object[2]}`, entry);
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
        adoptFile: refuse('adopt a file'),
        read: async (repo, hash) => (await readObject(hash)) ?? objects.read(repo, hash),
        readRange: async (repo, hash, offset, length) => {
          const data = await readObject(hash);
          return data === null ? objects.readRange(repo, hash, offset, length) : data.subarray(offset, offset + length);
        },
        materialize: async (repo, hash, destPath, options) => {
          const data = await readObject(hash);
          if (data === null) return objects.materialize(repo, hash, destPath, options);
          await fs.writeFile(destPath, data);
        },
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
    return decodePackageObject(Buffer.from(data));
  } catch (err: any) {
    throw new Error(`Failed to decode package ${name}@${version} (hash: ${hash}, size: ${data.byteLength} bytes): ${err.message}`);
  }
}

/**
 * Result of exporting a package
 */
export interface PackageExportResult {
  packageHash: string;
  objectCount: number;
}

/**
 * Options for package export
 */
export interface PackageExportOptions {
  /** Called after each object is added. Can be used for progress reporting. */
  onProgress?: (progress: { objectsProcessed: number }) => Promise<void>;
}

/**
 * Fixed mtime for deterministic zip output (Unix epoch)
 */
const DETERMINISTIC_MTIME = new Date(0);

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
 * @param visit - called once per object, in walk order
 */
export async function walkPackageObjects(
  storage: StorageBackend,
  repo: string,
  packageHash: string,
  pkg: PackageObject,
  visit: (hash: string) => Promise<void>,
): Promise<void> {
  const seen = new Set<string>();
  const add = async (hash: string): Promise<void> => {
    if (seen.has(hash)) return;
    seen.add(hash);
    await visit(hash);
  };

  // An IR may name objects by hash: any 64-hex run in it that the store
  // holds is taken to be one, and walked in turn.
  const addNamedIn = async (hash: string): Promise<void> => {
    const text = Buffer.from(await storage.objects.read(repo, hash)).toString('latin1');
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
  const decodeIndexObject = decodeBeast2For(RecordIndexObjectType);
  const addRecordIndex = async (indexHash: string): Promise<void> => {
    await add(indexHash);
    const index = decodeIndexObject(await storage.objects.read(repo, indexHash));
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
        for (const entry of manifest.entries) await add(entry.hash);
      }
    }
    for (const index of held.indexes.values()) await addRecordIndex(index.index);
  }
}

/**
 * Export a package to a .zip file.
 *
 * Collects the package object and every object it consists of
 * ({@link walkPackageObjects}).
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Package name
 * @param version - Package version
 * @param zipPath - Path to write the .zip file
 * @returns Export result with package hash and object count
 */
export async function packageExport(
  storage: StorageBackend,
  repo: string,
  name: string,
  version: string,
  zipPath: string,
  options?: PackageExportOptions,
): Promise<PackageExportResult> {
  const partialPath = `${zipPath}.partial`;

  const packageHash = await packageResolve(storage, repo, name, version);
  const packageObject = decodePackageObject(await storage.objects.read(repo, packageHash));

  const zipfile = new yazl.ZipFile();
  // The release exporting it, first, so an import meets it before anything
  zipfile.addBuffer(Buffer.from(encodeBeast2For(StringType)(E3_RELEASE)), ZIP_RELEASE_ENTRY, { mtime: DETERMINISTIC_MTIME });
  let objectCount = 0;
  await walkPackageObjects(storage, repo, packageHash, packageObject, async (hash) => {
    const data = await storage.objects.read(repo, hash);
    zipfile.addBuffer(Buffer.from(data), `objects/${hash.slice(0, 2)}/${hash.slice(2)}.beast2`, { mtime: DETERMINISTIC_MTIME });
    objectCount++;
    if (options?.onProgress) await options.onProgress({ objectsProcessed: objectCount });
  });

  // The package ref, as a repository keeps one
  zipfile.addBuffer(Buffer.from(encodeBeast2For(StringType)(packageHash)), `packages/${name}/${version}.beast2`, { mtime: DETERMINISTIC_MTIME });

  // Finalize and write zip to disk
  await new Promise<void>((resolve, reject) => {
    const writeStream = createWriteStream(partialPath);
    zipfile.outputStream.pipe(writeStream);
    zipfile.outputStream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('close', resolve);
    zipfile.end();
  });

  // Atomic rename to final path
  await fs.rename(partialPath, zipPath);

  return {
    packageHash,
    objectCount,
  };
}

// ============================================================================
// Zip file helpers using yauzl
// ============================================================================

interface ZipEntry {
  fileName: string;
  /** The entry's size once inflated. */
  size: number;
  getData(): Promise<Buffer>;
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

/**
 * Open a zip file for reading. It stays open once its entries have been
 * iterated, so they can be read after; its caller closes it.
 *
 * @param zipPath - The zip's path
 */
function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err) return reject(err);
      if (!zipfile) return reject(new Error('No zipfile'));
      resolve(zipfile);
    });
  });
}

/**
 * Async iterator over zip entries
 */
async function* iterateZipEntries(
  zipfile: yauzl.ZipFile
): AsyncGenerator<ZipEntry> {
  // Create a queue for entries
  const entryQueue: Array<yauzl.Entry | null> = [];
  let resolveNext: (() => void) | null = null;
  let rejectNext: ((err: Error) => void) | null = null;

  zipfile.on('entry', (entry: yauzl.Entry) => {
    entryQueue.push(entry);
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  });

  zipfile.on('end', () => {
    entryQueue.push(null); // Signal end
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  });

  zipfile.on('error', (err: Error) => {
    if (rejectNext) {
      rejectNext(err);
      rejectNext = null;
    }
  });

  // Start reading
  zipfile.readEntry();

  while (true) {
    // Wait for an entry if queue is empty
    if (entryQueue.length === 0) {
      await new Promise<void>((resolve, reject) => {
        resolveNext = resolve;
        rejectNext = reject;
      });
    }

    const entry = entryQueue.shift();
    if (entry === null || entry === undefined) {
      return; // End of entries
    }

    // Create getData function for this entry
    const getData = (): Promise<Buffer> => {
      return new Promise((resolve, reject) => {
        zipfile.openReadStream(entry, (err, readStream) => {
          if (err) return reject(err);
          if (!readStream) return reject(new Error('No read stream'));

          const chunks: Buffer[] = [];
          readStream.on('data', (chunk: Buffer) => chunks.push(chunk));
          readStream.on('end', () => resolve(Buffer.concat(chunks)));
          readStream.on('error', reject);
        });
      });
    };

    yield { fileName: entry.fileName, size: entry.uncompressedSize, getData };

    // Read next entry
    zipfile.readEntry();
  }
}
