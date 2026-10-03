/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Taking an existing file into a workspace as a dataset value, on the machine
 * the file lies on.
 *
 * The adoption is `dataset-adopt.ts`'s, which every backend shares for a
 * delivery the store holds; this takes a delivered file in: hashed, its type
 * read from its header, and its bytes taken in by intake units or linked in as
 * the object the file is, the file never modified.
 *
 * @packageDocumentation
 */

import { stat } from 'node:fs/promises';
import { isCollectionRoot, type TreePath } from '@elaraai/e3-types';
import type { EastTypeValue } from '@elaraai/east';
import { DatasetFileTypeMismatchError, readDatasetFileHeader, readDatasetFileType, sha256File } from '@elaraai/e3';
import { DatasetTypeMismatchError } from './errors.js';
import {
  pointAt,
  takeIn,
  type DatasetAdoptProgress,
  type DatasetAdoptResult,
  type ObjectAdoptResult,
} from './dataset-adopt.js';
import { rememberDelivery, rememberedManifest } from './delivery-intake.js';
import { intakeDelivery } from './delivery-intake-file.js';
import { withDatasetWriteLock } from './trees.js';
import type { TaskRunner } from './execution/interfaces.js';
import type { LockHandle, StorageBackend } from './storage/interfaces.js';

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
  /** The runner that takes a collection in: needed unless the store already
   *  knows the delivery, or it holds another value. */
  runner?: TaskRunner;
  /** Hears how far the adopt has got with the file, as it goes. */
  onProgress?: (progress: DatasetAdoptProgress) => void;
  /** Aborting it stops the intake. */
  signal?: AbortSignal;
}

/**
 * Take an existing file into the object store as a dataset value.
 *
 * @remarks
 * Repository-level: no workspace, and no lock of its own — the caller holds
 * the tasks lock, since nothing names the segments this stores until the
 * caller's ref does.
 *
 * A collection is taken in by intake units on `options.runner`, in pieces of
 * its segments, and the delivery's SHA-256 is remembered with the manifest it
 * became, so the same bytes adopted again cost their hash and nothing else.
 * Any other value is stored by `ObjectStore.adoptFile` as the object the file
 * is. Objects are content-addressed and immutable, and an adopted object no
 * ref names is gc's to collect.
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
 *   is written, the type the destination declares, the runner that takes a
 *   collection in, a listener for how far the adopt has got, and a signal
 * @returns The dataset object's hash — the manifest, for a collection — the
 *   file's size, and how it was taken in
 * @throws {DatasetFileTypeMismatchError} When the file's type is not the
 *   declared one
 * @throws {DeliveryRefusedError} When a runner refuses the collection the file
 *   holds
 * @throws If the file is missing or unreadable, its digest is not
 *   `options.expectHash`, it changed while it was adopted, or it holds a
 *   collection the store does not know and no runner was given
 */
export async function objectAdoptFile(
  storage: StorageBackend,
  repo: string,
  file: string,
  options: {
    expectHash?: string;
    declared?: { subject: string; type: EastTypeValue };
    runner?: TaskRunner;
    onProgress?: (progress: DatasetAdoptProgress) => void;
    signal?: AbortSignal;
  } = {}
): Promise<ObjectAdoptResult> {
  const delivered = await stat(file, { bigint: true });
  const size = Number(delivered.size);
  const onProgress = options.onProgress;
  const sourceHash = await sha256File(file, onProgress === undefined ? undefined : (bytes) => onProgress({ phase: 'hash', bytes, total: size }));
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

  if (!isCollectionRoot(type)) {
    await storage.objects.adoptFile(repo, file, sourceHash);
    await unchanged();
    return { hash: sourceHash, size, taken: 'carried' };
  }
  const known = await rememberedManifest(storage, repo, sourceHash);
  if (known !== null) {
    await unchanged();
    return { hash: known.hash, size, taken: 'known' };
  }
  const taken = await takeIn(storage, repo, options.runner, { file }, type, sourceHash, size, file, {
    ...(onProgress !== undefined && { onProgress: (progress) => onProgress({ phase: 'take-in', total: size, ...progress }) }),
    ...(options.signal !== undefined && { signal: options.signal }),
    verify: unchanged,
  }, intakeDelivery);
  await unchanged();
  await rememberDelivery(storage, repo, sourceHash, taken);
  return { hash: taken.hash, size, taken: 'taken', runners: taken.runners, ...(taken.fallback !== undefined && { fallback: taken.fallback }) };
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
 * @param options - A lock the caller already holds, the digest it was
 *   promised, the runner that takes a collection in, a listener for how far
 *   the adopt has got, and a signal
 * @returns The dataset's new hash, the file's size, the stored geometry and how
 *   it was taken in
 * @throws {DatasetTypeMismatchError} When the file's wire type is not the
 *   type the dataset declares
 * @throws {DeliveryRefusedError} When a runner refuses the collection the file
 *   holds
 * @throws {InvalidNameError} When `ws` is no workspace's name, before any
 *   store is asked
 * @throws {WorkspaceLockError} When the workspace is locked by another process
 * @throws If the dataset is not writable, the file is missing or unreadable,
 *   it holds a collection the store does not know and no runner was given, or
 *   a garbage collection is running
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
    let adopted: ObjectAdoptResult;
    try {
      readDatasetFileHeader(file, declared.subject, declared.type);
      adopted = await objectAdoptFile(storage, repo, file, {
        expectHash: options.expectHash,
        declared,
        runner: options.runner,
        onProgress: options.onProgress,
        signal: options.signal,
      });
    } catch (err) {
      if (err instanceof DatasetFileTypeMismatchError) {
        throw new DatasetTypeMismatchError(ws, leaf.address, err.mismatch);
      }
      throw err;
    }
    return pointAt(storage, repo, ws, treePath, leaf, adopted);
  });
}
