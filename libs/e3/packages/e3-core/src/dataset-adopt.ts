/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Taking an existing file into a workspace as a dataset value.
 *
 * A large external table — a supplier's delivery of beast2 files — used to
 * reach a dataflow only as a String input naming a directory plus a
 * `FileSystem.openBeast` inside a task body. The file's bytes were then in no
 * inputs hash (a new delivery under the same path invalidated nothing) and a
 * schema change surfaced as `cannot open a blob of type ... as ...` inside the
 * running task. This module is the other half of the answer (#765): the file
 * becomes an ordinary, content-addressed dataset, so change detection is exact
 * and every runner pages it like any other collection.
 *
 * Four properties hold at once, and each one is why a step is shaped the way it
 * is:
 *
 * - **A collection delivery is split into segment objects.** It is read a
 *   segment at a time and taken in through the store's door, never held whole,
 *   so a new delivery that differs from the last in a few rows shares every
 *   other segment with it, and what a partitioned task carves of it is
 *   unchanged. Any other value is taken in as the object the file is, by a
 *   link, a reflink or one kernel copy.
 * - **An unchanged delivery is not read twice.** The store remembers each
 *   delivery's SHA-256 and the manifest it became, so adopting the same bytes
 *   again costs their hash — and a transfer of them, a round trip.
 * - **The declared type is checked at the door**, by the same
 *   `checkDatasetType` every other door uses, *before* any object is written.
 * - **The delivered file is never modified** — not its bytes, its mode or its
 *   mtime. It is only ever opened for reading.
 *
 * @packageDocumentation
 */

import { stat } from 'node:fs/promises';
import { checkDatasetType, isCollectionRoot, manifestByteSize, manifestElementCount, type CollectionManifest, type TreePath } from '@elaraai/e3-types';
import {
  readBeast2Type,
  type EastTypeValue,
} from '@elaraai/east';
import { DatasetFileTypeMismatchError, readDatasetFileHeader, readDatasetFileType, sha256File } from '@elaraai/e3';
import { DatasetTypeMismatchError, ObjectNotFoundError } from './errors.js';
import { readManifest } from './dataset-open.js';
import { storeCollection } from './store-collection.js';
import { withDatasetWriteLock, workspaceSetDatasetByHash } from './trees.js';
import type { LockHandle, StorageBackend } from './storage/interfaces.js';

/** What an adopt reports back about the file it took. */
export interface DatasetAdoptResult {
  /** The dataset's new content address: the manifest a collection was
   *  stored as, or the object the file is. */
  hash: string;
  /** Bytes the value arrived as: the delivered file's, or — for a delivery
   *  the store already knew as a collection — its stored segments'. */
  size: number;
  /** Segment count, for a collection root; `null` otherwise. */
  segments: number | null;
  /** Element count (pairs for a Dict), for a collection root; `null` otherwise. */
  rows: number | null;
}

/** Options accepted by {@link datasetAdoptFile}. */
export interface DatasetAdoptOptions {
  /**
   * A workspace lock the caller already holds; without one, the adopt takes
   * the workspace lock shared for its own duration.
   */
  lock?: LockHandle;
  /**
   * The digest the caller was promised, checked before anything is written.
   *
   * @remarks
   * The transfer commit's integrity check: the client declared a hash at init,
   * and the staged bytes must be those bytes. Refused BEFORE the object store
   * is touched, so a corrupted upload leaves nothing behind.
   */
  expectHash?: string;
}

/**
 * The manifest the delivery with this SHA-256 was stored as, while the store
 * still holds every object it names; `null` otherwise.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param sourceHash - SHA-256 of the delivered bytes
 * @returns The manifest and its hash, or `null`
 */
async function adoptedManifest(
  storage: StorageBackend,
  repo: string,
  sourceHash: string
): Promise<{ hash: string; manifest: CollectionManifest } | null> {
  const hash = await storage.refs.adoptionRead(repo, sourceHash);
  if (hash === null) return null;
  let manifest: CollectionManifest | null;
  try {
    manifest = await readManifest(storage, repo, hash);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return null;
    throw err;
  }
  // The memo is not a root: a collection gc took is a miss, whichever of its
  // objects went first.
  if (manifest === null) return null;
  for (const object of [manifest.header, ...manifest.entries.map((entry) => entry.hash)]) {
    if (!await storage.objects.exists(repo, object)) return null;
  }
  return { hash, manifest };
}

/**
 * Whether the store knows a delivery by its SHA-256: as the manifest it was
 * split into, or as an object of those bytes.
 *
 * @remarks
 * What a transfer init asks before it plans an upload: a delivery the store
 * knows is adopted with {@link datasetAdoptObject} for the cost of a round
 * trip.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param sourceHash - SHA-256 of the delivered bytes
 * @returns Whether {@link datasetAdoptObject} can adopt it without its bytes
 */
export async function deliveryKnown(storage: StorageBackend, repo: string, sourceHash: string): Promise<boolean> {
  return (await adoptedManifest(storage, repo, sourceHash)) !== null || await storage.objects.exists(repo, sourceHash);
}

/**
 * Take an existing file into the object store as a dataset value.
 *
 * @remarks
 * Repository-level: no workspace, and no lock of its own — the caller holds
 * the tasks lock, since nothing names the segments this stores until the
 * caller's ref does.
 *
 * A collection is split into segment objects through the store's door, and the
 * delivery's SHA-256 is remembered with the manifest it became, so the same
 * bytes adopted again cost their hash and nothing else. Any other value is
 * stored by `ObjectStore.adoptFile` as the object the file is. Objects are
 * content-addressed and immutable, and an adopted object no ref names is gc's
 * to collect.
 *
 * The path is opened more than once — to hash the file, to read its type, to
 * store it — and a delivery replaced in between would pair one file's hash
 * with another's bytes. So the adoption is refused, and nothing recorded,
 * unless the path names the same file, unchanged, from before its hash to
 * after its store; the declared type is checked inside that window, on the
 * file that is stored.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param file - Path to the file to adopt
 * @param options - The digest the caller was promised, checked before anything
 *   is written, and the type the destination declares
 * @returns The dataset object's hash — the manifest, for a collection — and the
 *   file's size
 * @throws {DatasetFileTypeMismatchError} When the file's type is not the
 *   declared one
 * @throws If the file is missing or unreadable, its digest is not
 *   `options.expectHash`, it changed while it was adopted, or the door refuses
 *   the collection it holds
 */
export async function objectAdoptFile(
  storage: StorageBackend,
  repo: string,
  file: string,
  options: { expectHash?: string; declared?: { subject: string; type: EastTypeValue } } = {}
): Promise<{ hash: string; size: number }> {
  const delivered = await stat(file, { bigint: true });
  const sourceHash = await sha256File(file);
  if (options.expectHash !== undefined && options.expectHash !== sourceHash) {
    throw new Error(`hash mismatch: expected ${options.expectHash}, got ${sourceHash}`);
  }
  const type = options.declared === undefined
    ? readDatasetFileType(file)
    : readDatasetFileHeader(file, options.declared.subject, options.declared.type).typeValue;
  const unchanged = async (): Promise<void> => {
    const now = await stat(file, { bigint: true });
    if (now.dev !== delivered.dev || now.ino !== delivered.ino || now.size !== delivered.size || now.mtimeNs !== delivered.mtimeNs) {
      throw new Error(`${file} changed while it was adopted, and nothing was recorded — adopt it again once it is complete`);
    }
  };
  const size = Number(delivered.size);

  if (!isCollectionRoot(type)) {
    await storage.objects.adoptFile(repo, file, sourceHash);
    await unchanged();
    return { hash: sourceHash, size };
  }
  const known = await adoptedManifest(storage, repo, sourceHash);
  const hash = known?.hash ?? await storeCollection(storage, repo, type, [{ file }]);
  await unchanged();
  if (known === null) await storage.refs.adoptionWrite(repo, sourceHash, hash);
  return { hash, size };
}

/**
 * Point a workspace dataset at an existing file.
 *
 * @remarks
 * The file IS the value: adopting it again after it changes gives a new hash,
 * so its consumers re-run, and a task that splits its work over it keeps the
 * pieces that did not move. There is no mtime or size memo and no
 * configuration — the memo is of the bytes' own hash.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param treePath - Path to the dataset
 * @param file - Path to the file to adopt
 * @param options - A lock the caller already holds
 * @returns The dataset's new hash, the file's size and the stored geometry
 * @throws {DatasetTypeMismatchError} When the file's wire type is not the
 *   type the dataset declares
 * @throws {WorkspaceLockError} When the workspace is locked by another process
 * @throws If the dataset is not writable, the file is missing or unreadable,
 *   the door refuses the collection it holds, or a garbage collection is
 *   running
 */
export async function datasetAdoptFile(
  storage: StorageBackend,
  repo: string,
  ws: string,
  treePath: TreePath,
  file: string,
  options: DatasetAdoptOptions = {}
): Promise<DatasetAdoptResult> {
  return withDatasetWriteLock(storage, repo, ws, treePath, options.lock, async (leaf) => {
    // Validated from the header before anything is hashed or stored, and
    // again on the file the adoption stores; a mismatch is re-raised once the
    // workspace and address are known.
    const declared = { subject: `dataset '${leaf.address}'`, type: leaf.type };
    let adopted: { hash: string; size: number };
    try {
      readDatasetFileHeader(file, declared.subject, declared.type);
      adopted = await objectAdoptFile(storage, repo, file, { expectHash: options.expectHash, declared });
    } catch (err) {
      if (err instanceof DatasetFileTypeMismatchError) {
        throw new DatasetTypeMismatchError(ws, leaf.address, err.mismatch);
      }
      throw err;
    }
    const { hash, size } = adopted;

    // The self entry is what makes change detection exact: the ref's version
    // vector names the value's hash, so a new delivery invalidates precisely
    // this input's consumers.
    const selfKeypath = treePath.map(s => `.${s.value}`).join('');
    await workspaceSetDatasetByHash(storage, repo, ws, treePath, hash, new Map([[selfKeypath, hash]]));

    return { hash, size, ...await geometry(storage, repo, hash, leaf.type) };
  });
}

/**
 * Point a workspace dataset at a delivery the store already knows, checking
 * its type first.
 *
 * @remarks
 * The dedup door. A transfer whose delivery the store knows skips the upload
 * entirely: the bytes were split before, and the memo names the manifest they
 * became; or they are an object in the store. Either may have been stored for
 * a different dataset with a different type, so this is the only place that
 * pairing is ever checked. An object that is a collection goes through the
 * store's door first, and is remembered as the manifest it became.
 *
 * It holds the locks {@link datasetAdoptFile} does: a collection the store
 * holds whole is re-cut here, which for a large one takes minutes, and neither
 * a deploy nor a removal may finish inside it, nor a sweep delete its segments
 * before the ref names them.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param treePath - Path to the dataset
 * @param sourceHash - SHA-256 of the delivered bytes
 * @returns The dataset's new hash, the delivery's size and the stored geometry
 * @throws {DatasetTypeMismatchError} When the delivery's wire type is not the
 *   type the dataset declares
 * @throws {WorkspaceLockError} When the workspace is locked by another process
 * @throws If the dataset is not writable, the store does not know the
 *   delivery, or a garbage collection is running
 */
export async function datasetAdoptObject(
  storage: StorageBackend,
  repo: string,
  ws: string,
  treePath: TreePath,
  sourceHash: string
): Promise<DatasetAdoptResult> {
  return withDatasetWriteLock(storage, repo, ws, treePath, undefined, async (leaf) => {
    const subject = `dataset '${leaf.address}'`;
    const known = await adoptedManifest(storage, repo, sourceHash);
    let hash: string;
    let size: number;
    if (known !== null) {
      const mismatch = checkDatasetType(subject, `delivery ${sourceHash.slice(0, 8)}...`, leaf.type, known.manifest.type);
      if (mismatch) throw new DatasetTypeMismatchError(ws, leaf.address, mismatch);
      hash = known.hash;
      size = manifestByteSize(known.manifest);
    } else {
      ({ size } = await storage.objects.stat(repo, sourceHash));
      const mismatch = checkDatasetType(subject, `object ${sourceHash.slice(0, 8)}...`, leaf.type, await objectType(storage, repo, sourceHash, size));
      if (mismatch) throw new DatasetTypeMismatchError(ws, leaf.address, mismatch);
      if (isCollectionRoot(leaf.type)) {
        hash = await storeCollection(storage, repo, leaf.type, [{ stored: sourceHash }]);
        await storage.refs.adoptionWrite(repo, sourceHash, hash);
      } else {
        hash = sourceHash;
      }
    }
    const selfKeypath = treePath.map(s => `.${s.value}`).join('');
    await workspaceSetDatasetByHash(storage, repo, ws, treePath, hash, new Map([[selfKeypath, hash]]));
    return { hash, size, ...await geometry(storage, repo, hash, leaf.type) };
  });
}

/** The head reads {@link objectType} tries, in order — the first covers every
 *  type section anything realistic writes. */
const OBJECT_HEAD_PROBE_BYTES = [64 * 1024, 1024 * 1024, 16 * 1024 * 1024];

/** An object's wire type, from ranged reads of its head. */
async function objectType(storage: StorageBackend, repo: string, hash: string, size: number): Promise<EastTypeValue> {
  let lastError: unknown;
  for (const probe of OBJECT_HEAD_PROBE_BYTES) {
    const length = Math.min(size, probe);
    try {
      return readBeast2Type(await storage.objects.readRange(repo, hash, 0, length));
    } catch (err) {
      if (length >= size) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/** A stored value's segments and elements, from its manifest — `null` for a
 *  value that is not a collection. */
async function geometry(
  storage: StorageBackend,
  repo: string,
  hash: string,
  type: EastTypeValue
): Promise<{ segments: number | null; rows: number | null }> {
  if (!isCollectionRoot(type)) return { segments: null, rows: null };
  const manifest = await readManifest(storage, repo, hash);
  return manifest === null
    ? { segments: null, rows: null }
    : { segments: manifest.entries.length, rows: manifestElementCount(manifest) };
}
