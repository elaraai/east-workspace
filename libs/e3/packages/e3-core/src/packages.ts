/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Package operations for e3 repositories.
 *
 * Manages packages in the content-addressed object store: reading, listing,
 * resolving and removing them, and walking the objects a package consists of,
 * which its export writes. A package's zip is read and written by
 * `package-files.ts`.
 */

import { decodeBeast2For } from '@elaraai/east';
import {
  EnvironmentSpecType,
  environmentSpecObjectHashes,
  decodeFunctionObject,
  decodeMigrationObject,
  decodeMutationObject,
  decodePackageObject,
  decodeRecordIndexObject,
  decodeRecordObject,
  decodeTaskObject,
} from '@elaraai/e3-types';
import type { PackageObject } from '@elaraai/e3-types';
import { PackageNotFoundError } from './errors.js';
import { OBJECT_CONCURRENCY } from './concurrency.js';
import { readManifest } from './dataset-open.js';
import { readRecordState } from './records.js';
import type { StorageBackend } from './storage/interfaces.js';
import type { PackageZipCheckpoint } from './transfer/types.js';

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
   * file destination keeps the zip so far at `<path>.partial`.
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
