/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Taking an existing file into a workspace as a dataset value.
 *
 * A large external table — a supplier's delivery of indexed beast2 files —
 * used to reach a dataflow only as a String input naming a directory plus a
 * `FileSystem.openBeast` inside a task body. The file's bytes were then in no
 * inputs hash (a new delivery under the same path invalidated nothing) and a
 * schema change surfaced as `cannot open a blob of type ... as ...` inside the
 * running task. This module is the other half of the answer (#765): the file
 * becomes an ordinary, content-addressed dataset, so change detection is exact
 * and every runner pages it like any other collection.
 *
 * Three properties hold at once, and each one is why a step is shaped the way
 * it is:
 *
 * - **The delivery is never read whole.** The header check is two ranged
 *   reads, the hash is streamed, and the object is a link, a reflink or one
 *   kernel copy (`ObjectStore.adoptFile`). Adopting 2 GB costs about a second
 *   of SHA-256 and nothing else.
 * - **The declared type is checked at the door**, by the same
 *   `checkDatasetType` every other door uses, *before* any object is written.
 * - **The delivered file is never modified** — not its bytes, its mode or its
 *   mtime. It is only ever opened for reading.
 *
 * @packageDocumentation
 */

import { createReadStream } from 'node:fs';
import { checkDatasetType, isCollectionRoot, type TreePath } from '@elaraai/e3-types';
import {
  readBeast2ExtentsRanged,
  readBeast2Type,
  variant,
  type EastTypeValue,
} from '@elaraai/east';
import { DatasetFileTypeMismatchError, readDatasetFileHeader, sha256File } from '@elaraai/e3';
import { DatasetTypeMismatchError, WorkspaceLockError } from './errors.js';
import { workspaceResolveDataset, workspaceSetDatasetByHash } from './trees.js';
import type { LockHandle, StorageBackend } from './storage/interfaces.js';

/** What an adopt reports back about the file it took. */
export interface DatasetAdoptResult {
  /** SHA256 of the file — the dataset's new content address. */
  hash: string;
  /** Size in bytes. */
  size: number;
  /** Segment count, for a collection root; `null` otherwise. */
  segments: number | null;
  /** Element count (pairs for a Dict), for a collection root; `null` otherwise. */
  rows: number | null;
}

/** Options accepted by {@link datasetAdoptFile}. */
export interface DatasetAdoptOptions {
  /**
   * A workspace lock the caller already holds. Deploy holds one across the
   * whole resolution; a standalone `e3 dataset set --from-file` does not and
   * lets this take its own.
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
 * Point a workspace dataset at an existing file, by hash.
 *
 * @remarks
 * The file IS the value: adopting it again after it changes gives a new hash,
 * so its consumers re-run and `partitionTask`'s per-partition memoization keeps
 * the partitions whose slices did not move. There is no mtime or size memo and
 * no configuration.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param treePath - Path to the dataset
 * @param file - Path to the file to adopt
 * @param options - A lock the caller already holds
 * @returns The adopted object's hash, size and geometry
 * @throws {DatasetTypeMismatchError} When the file's wire type is not the
 *   type the dataset declares
 * @throws {WorkspaceLockError} When the workspace is locked by another process
 * @throws If the dataset is not writable, or the file is missing, unreadable,
 *   or a collection with no index
 */
export async function datasetAdoptFile(
  storage: StorageBackend,
  repo: string,
  ws: string,
  treePath: TreePath,
  file: string,
  options: DatasetAdoptOptions = {}
): Promise<DatasetAdoptResult> {
  const externalLock = options.lock;
  let lock: LockHandle | null = externalLock ?? null;
  if (!lock) {
    lock = await storage.locks.acquire(repo, ws, variant('dataset_write', null), { mode: 'shared' });
    if (!lock) {
      const state = await storage.locks.getState(repo, ws);
      throw new WorkspaceLockError(ws, state ? {
        acquiredAt: state.acquiredAt.toISOString(),
        operation: state.operation.type,
      } : undefined);
    }
  }
  try {
    const leaf = await workspaceResolveDataset(storage, repo, ws, treePath);
    if (!leaf.writable) {
      throw new Error(`Dataset at '${treePath.map(s => s.value).join('.')}' is not writable`);
    }

    // Validate from the header before anything is hashed or copied, and
    // re-raise the mismatch once the workspace and address are known.
    let header;
    try {
      header = readDatasetFileHeader(file, `dataset '${leaf.address}'`, leaf.type);
    } catch (err) {
      if (err instanceof DatasetFileTypeMismatchError) {
        throw new DatasetTypeMismatchError(ws, leaf.address, err.mismatch);
      }
      throw err;
    }

    const hash = await sha256File(file);
    if (options.expectHash !== undefined && options.expectHash !== hash) {
      throw new Error(`hash mismatch: expected ${options.expectHash}, got ${hash}`);
    }
    const adopt = storage.objects.adoptFile;
    if (adopt) {
      await adopt.call(storage.objects, repo, file, hash);
    } else {
      // A backend without adoptFile still gets the object, and must land on
      // the same hash: the store is content-addressed either way.
      const written = await storage.objects.writeStream(repo, createReadStream(file));
      if (written !== hash) {
        throw new Error(
          `object store wrote ${file} under ${written} but its SHA256 is ${hash} — the backend's ` +
          `writeStream must be content-addressed on the same digest`
        );
      }
    }

    // The self entry is what makes change detection exact: the ref's version
    // vector names the file's hash, so a new delivery invalidates precisely
    // this input's consumers.
    const selfKeypath = treePath.map(s => `.${s.value}`).join('');
    await workspaceSetDatasetByHash(storage, repo, ws, treePath, hash, new Map([[selfKeypath, hash]]));

    return { hash, size: header.size, segments: header.segments, rows: header.rows };
  } finally {
    if (!externalLock) await lock.release();
  }
}

/**
 * Point a workspace dataset at an object ALREADY in the store, checking its
 * wire type first.
 *
 * @remarks
 * The dedup door. A transfer that finds the hash already stored skips the
 * upload entirely — but the object may have been stored for a different
 * dataset with a different type, so this is the only place that pairing is ever
 * checked. Costs two ranged reads of the object, never a whole read.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param treePath - Path to the dataset
 * @param hash - SHA256 of the object to point at
 * @returns The object's hash, size and geometry
 * @throws {DatasetTypeMismatchError} When the object's wire type is not the
 *   type the dataset declares
 * @throws If the dataset is not writable or the object is not in the store
 */
export async function datasetAdoptObject(
  storage: StorageBackend,
  repo: string,
  ws: string,
  treePath: TreePath,
  hash: string
): Promise<DatasetAdoptResult> {
  const leaf = await workspaceResolveDataset(storage, repo, ws, treePath);
  if (!leaf.writable) {
    throw new Error(`Dataset at '${treePath.map(s => s.value).join('.')}' is not writable`);
  }
  const { size } = await storage.objects.stat(repo, hash);
  const header = await objectHeader(storage, repo, ws, hash, size, leaf);
  const selfKeypath = treePath.map(s => `.${s.value}`).join('');
  await workspaceSetDatasetByHash(storage, repo, ws, treePath, hash, new Map([[selfKeypath, hash]]));
  return { hash, size, segments: header.segments, rows: header.rows };
}

/** The head read {@link objectHeader} starts with — enough for every type
 *  section anything realistic writes. */
const OBJECT_HEAD_PROBE_BYTES = 64 * 1024;

/** An object's wire type and geometry, through ranged reads, checked against
 *  the leaf's declared type. */
async function objectHeader(
  storage: StorageBackend,
  repo: string,
  ws: string,
  hash: string,
  size: number,
  leaf: { type: EastTypeValue; address: string }
): Promise<{ segments: number | null; rows: number | null }> {
  const readRange = storage.objects.readRange;
  const read = readRange
    ? (offset: number, length: number) => readRange.call(storage.objects, repo, hash, offset, length)
    // A backend with no ranged reads has to serve the whole object; this is
    // the dedup path, so the object is already stored and local.
    : async (offset: number, length: number) =>
        (await storage.objects.read(repo, hash)).subarray(offset, offset + length);

  let typeValue: EastTypeValue;
  let segments: number | null = null;
  let rows: number | null = null;

  if (isCollectionRoot(leaf.type)) {
    const extents = await readBeast2ExtentsRanged({ size, read });
    typeValue = extents.typeValue;
    segments = extents.offsets.length;
    rows = extents.elementCount;
  } else {
    let length = Math.min(size, OBJECT_HEAD_PROBE_BYTES);
    for (;;) {
      const head = await read(0, length);
      try {
        typeValue = readBeast2Type(head);
        break;
      } catch (err) {
        if (length >= size) throw err;
        length = Math.min(size, length * 16);
      }
    }
  }

  const mismatch = checkDatasetType(
    `dataset '${leaf.address}'`,
    `object ${hash.slice(0, 8)}...`,
    leaf.type,
    typeValue,
  );
  if (mismatch) throw new DatasetTypeMismatchError(ws, leaf.address, mismatch);
  return { segments, rows };
}
