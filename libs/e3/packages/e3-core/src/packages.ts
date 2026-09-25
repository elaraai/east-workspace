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
import { decodeBeast2For, encodeBeast2For } from '@elaraai/east';
import {
  DataflowRunType,
  DatasetRefType,
  EnvironmentSpecType,
  RecordIndexObjectType,
  environmentSpecObjectHashes,
  decodeFunctionObject,
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
 * Import a package from a .zip file into the repository.
 *
 * Extracts objects to `objects/`, creates ref at `packages/<name>/<version>`.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param zipPath - Path to the .zip package file
 * @param options - Optional import options (e.g. progress callback)
 * @returns Import result with package name, version, and stats
 */
export async function packageImport(
  storage: StorageBackend,
  repo: string,
  zipPath: string,
  options?: PackageImportOptions,
): Promise<PackageImportResult> {
  // Open the zip file
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
    // Iterate through all entries
    for await (const entry of iterateZipEntries(zipfile)) {
      const { fileName, getData } = entry;

      // Skip directory entries
      if (fileName.endsWith('/')) {
        continue;
      }

      // Handle package ref: packages/<name>/<version>
      if (fileName.startsWith('packages/')) {
        const parts = fileName.split('/');
        if (parts.length === 3) {
          packageName = parts[1];
          packageVersion = parts[2];

          // Read the hash from the ref file
          const data = await getData();
          packageHash = data.toString('utf-8').trim();

          // Write the ref to the repository
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

      // Handle dataflow runs: dataflows/<workspace>/<runId>.beast2
      if (fileName.startsWith('dataflows/')) {
        const parts = fileName.split('/');
        if (parts.length === 3 && parts[2]!.endsWith('.beast2')) {
          const workspace = parts[1]!;

          // Decode and write the dataflow run
          const data = await getData();
          const decoder = decodeBeast2For(DataflowRunType);
          const run = decoder(data);
          await storage.refs.dataflowRunWrite(repo, workspace, run);
        }
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

      // Handle data refs: data/<path>.ref
      if (fileName.startsWith('data/') && fileName.endsWith('.ref')) {
        // Per-dataset ref files in the zip are redundant — refs are stored
        // inline in the PackageObject's data.refs field. Skip them.
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
 * mutations and index declarations; and the stored value of each dataset ref.
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
  let objectCount = 0;
  await walkPackageObjects(storage, repo, packageHash, packageObject, async (hash) => {
    const data = await storage.objects.read(repo, hash);
    zipfile.addBuffer(Buffer.from(data), `objects/${hash.slice(0, 2)}/${hash.slice(2)}.beast2`, { mtime: DETERMINISTIC_MTIME });
    objectCount++;
    if (options?.onProgress) await options.onProgress({ objectsProcessed: objectCount });
  });

  // Each DatasetRef as a data/ file too, for roundtrip compatibility.
  const refEncoder = encodeBeast2For(DatasetRefType);
  for (const [refPath, ref] of packageObject.data.refs) {
    zipfile.addBuffer(Buffer.from(refEncoder(ref)), `data/${refPath}.ref`, { mtime: DETERMINISTIC_MTIME });
  }

  // Write the package ref
  const refPath = `packages/${name}/${version}`;
  zipfile.addBuffer(Buffer.from(packageHash + '\n'), refPath, { mtime: DETERMINISTIC_MTIME });

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
  getData(): Promise<Buffer>;
}

/**
 * Open a zip file for reading
 */
function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
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

    yield { fileName: entry.fileName, getData };

    // Read next entry
    zipfile.readEntry();
  }
}
