/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A package's zip, read and written: an import of a zip given as a file on
 * this machine or as a source read by ranges, a view of one without importing
 * it, and an export to a file or a stream.
 *
 * The package operations every backend shares are `packages.ts`'s; a zip is
 * read and written here, on Node's streams.
 */

import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { once } from 'node:events';
import type { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { StringType, decodeBeast2For, encodeBeast2For } from '@elaraai/east';
import { E3_RELEASE, compareReleases, decodeExecutionStatus, decodePackageObject } from '@elaraai/e3-types';
import { ExportStoppedError, PackageInvalidError } from './errors.js';
import { OBJECT_CONCURRENCY, TOUCH_BATCH, eachAtMost } from './concurrency.js';
import { computeHash } from './objects.js';
import {
  ZIP_RELEASE_ENTRY,
  addPackageObjects,
  packageResolve,
  type PackageExportOptions,
  type PackageExportResult,
  type PackageImportOptions,
  type PackageImportResult,
  type PackageZip,
  type PackageZipWriter,
} from './packages.js';
import { withRunningWork } from './running-work.js';
import type { StorageBackend } from './storage/interfaces.js';
import type { PackageZipCheckpoint } from './transfer/types.js';
import { ZipSourceError, ZipWriter, iterateZipEntries, openZip, type ZipEntry, type ZipSource, type ZipWritten } from './zip.js';

/** The largest object an import reads beside others; a larger one is read on
 *  its own, so an import holds at most {@link OBJECT_CONCURRENCY} of these. */
const IMPORT_BESIDE_BYTES = 8 * 1024 * 1024;

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
 * The zip is read where it lies: a file, or a source read by ranges, such as
 * an upload staged in an object store. Its objects go first. Those the store
 * holds already — ones another package shares, or ones an import of this zip
 * stopped part way wrote — are not read but re-referenced (`ObjectStore.touch`),
 * as a write of each would be, a batch at a time; the rest are read and
 * written {@link OBJECT_CONCURRENCY} at a time, each object larger than 8 MiB
 * on its own, and each checked against the hash its entry names it by. The
 * executions come next, and the package ref is written last, once all it
 * names is in.
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
 * @param zip - The .zip package file's path, or its source
 * @param options - Progress, and a signal that stops the import between
 *   entries
 * @returns Import result with package name, version, and stats
 * @throws {PackageInvalidError} When the zip does not read — its directory
 *   names bytes past its end, say — or holds no package ref, an object that is
 *   not the bytes its entry names, or an older e3 exported it in a form no
 *   longer read, or a newer release exported it
 * @throws {Error} An `AbortError`, when `options.signal` stopped the import; a
 *   read of the zip's source that failed, as the source raised it; and when a
 *   garbage collection or an upgrade holds the repository.
 */
export async function packageImport(
  storage: StorageBackend,
  repo: string,
  zip: string | ZipSource,
  options?: PackageImportOptions,
): Promise<PackageImportResult> {
  return withRunningWork(storage, repo, () => importZip(storage, repo, zip, options));
}

/** The import of {@link packageImport}, holding the repository's running
 *  work. */
async function importZip(
  storage: StorageBackend,
  repo: string,
  zip: string | ZipSource,
  options: PackageImportOptions | undefined,
): Promise<PackageImportResult> {
  const zipfile = await readingZip(() => openZip(zip));

  let ref: { name: string; version: string; hash: string } | undefined;
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
 * ranges ({@link ZipSourceError}) — or of its file is raised as the failure it
 * is, so a caller that runs an import in rounds retries it. Any other failure
 * to read the zip is the zip's own — a directory that names bytes past its
 * end, an entry cut short — and no retry mends it: a
 * {@link PackageInvalidError}.
 *
 * @throws {PackageInvalidError} When the zip does not read.
 */
async function readingZip<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof ZipSourceError) throw err.cause;
    if (err instanceof PackageInvalidError || (err instanceof Error && typeof (err as NodeJS.ErrnoException).code === 'string')) throw err;
    throw new PackageInvalidError(`the zip does not read: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** An open zip's entries, in its directory's order, each read as
 *  {@link readingZip} reads. */
async function zipEntries(zipfile: Awaited<ReturnType<typeof openZip>>): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];
  await readingZip(async () => {
    for await (const entry of iterateZipEntries(zipfile)) {
      entries.push({ fileName: entry.fileName, size: entry.size, getData: () => readingZip(entry.getData) });
    }
  });
  return entries;
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
 * @param zip - The .zip package file's path, or its source
 * @returns The zip, open; the caller closes it
 * @throws {PackageInvalidError} When the zip does not read, holds no package
 *   ref, or an older e3 exported it in a form no longer read, or a newer
 *   release exported it, as {@link packageImport} refuses it
 * @throws {Error} A read of the zip's source that failed, as the source
 *   raised it.
 */
export async function packageZipOpen(zip: string | ZipSource): Promise<PackageZip> {
  const zipfile = await readingZip(() => openZip(zip));
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
          await fs.writeFile(destPath, data);
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

/**
 * Export a package to a .zip file, or to a stream.
 *
 * Collects the package object and every object it consists of
 * (`walkPackageObjects`).
 *
 * @remarks
 * The zip is written an entry at a time: to a file, by way of
 * `<path>.partial`, renamed once the zip is whole; or to a stream, such as a
 * multipart upload, ended once it is. Its segments are read ahead of the
 * entry it writes ({@link addPackageObjects}). An export stopped at
 * `options.signal` throws an {@link ExportStoppedError}, whose checkpoint an
 * export given it as `options.resume` goes on from.
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
 * @param destination - The path to write the .zip file to, or the stream to
 *   write its bytes to
 * @param options - Progress, and the signal that stops the export and the
 *   checkpoint it resumes from
 * @returns Export result with package hash, object count and the zip's size
 * @throws {ExportStoppedError} When `options.signal` stopped the export.
 * @throws {Error} When `options.resume` is a checkpoint of another package, or
 *   another release wrote it; and when a garbage collection or an upgrade
 *   holds the repository.
 */
export async function packageExport(
  storage: StorageBackend,
  repo: string,
  name: string,
  version: string,
  destination: string | Writable,
  options: PackageExportOptions = {},
): Promise<PackageExportResult> {
  return withRunningWork(storage, repo, async () => {
    const packageHash = await packageResolve(storage, repo, name, version);
    const packageObject = decodePackageObject(await storage.objects.read(repo, packageHash));

    return writePackageZip(destination, packageHash, options, async (zip) => {
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
 * Writes a package zip to `destination`, whose entries `write` adds: a file,
 * by way of `<path>.partial`, renamed once the zip is whole; or a stream,
 * ended once it is.
 *
 * @remarks
 * An export stopped at its signal ends between entries, with an
 * {@link ExportStoppedError}: a file keeps the partial zip, and a stream is
 * left as it is, holding the bytes the checkpoint counts. Given that
 * checkpoint, an export goes on: a file's partial zip is cut back to the
 * checkpoint's bytes, and the entries the checkpoint names are not written
 * again, so the zip is the one an export never stopped writes.
 *
 * @param destination - The zip's path, or the stream its bytes go to
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
  destination: string | Writable,
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
  const from = resume === undefined ? undefined : zipWrittenOf(resume);

  const run = async (sink: Writable): Promise<T & { bytes: number }> => {
    const zip = new ZipWriter(sink, from);
    const result = await write({
      add: async (name, data) => {
        if (zip.has(name)) return;
        if (options.signal?.aborted) throw new ExportStoppedError(checkpointOf(zip.progress, packageHash));
        await zip.add(name, typeof data === 'function' ? await data() : data);
      },
      has: (name) => zip.has(name),
    });
    return { ...result, bytes: await zip.finish() };
  };

  if (typeof destination !== 'string') {
    const result = await run(destination);
    destination.end();
    await finished(destination, { readable: false });
    return result;
  }

  const partial = `${destination}.partial`;
  if (from !== undefined) await fs.truncate(partial, from.bytes);
  const file = createWriteStream(partial, from === undefined ? {} : { flags: 'r+', start: from.bytes });
  let result: T & { bytes: number };
  try {
    result = await run(file);
  } catch (err) {
    // A stopped export keeps what it wrote, for the export that resumes it.
    if (err instanceof ExportStoppedError) {
      file.end();
      await once(file, 'close');
    } else {
      file.destroy();
      await fs.rm(partial, { force: true });
    }
    throw err;
  }
  file.end();
  await once(file, 'close');
  // Atomic rename to final path
  await fs.rename(partial, destination);
  return result;
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
