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
 * - **A collection delivery is split into segment objects, on the runners.**
 *   Intake units take it in, in pieces of its segments, as many at once as the
 *   runner admits (`delivery-intake.ts`), and it is stored as the manifest the
 *   Writer writes for its rows. So a new delivery that differs from the last in
 *   a few rows shares every other segment with it, and a task split over it
 *   re-runs only the pieces around those rows. Nothing but its hash is read
 *   here. Any other value is taken in as the object the file is, by a link, a
 *   reflink or one kernel copy.
 * - **An unchanged delivery is not taken in twice.** The store remembers each
 *   delivery's SHA-256 and the manifest it became, and the hash is taken
 *   first, so adopting the same bytes again costs their hash — and a transfer
 *   of them, a round trip, the client asking before it sends anything. An
 *   intake stopped part way is taken up again from the pieces it finished.
 * - **The declared type is checked at the door**, by the same
 *   `checkDatasetType` every other door uses, *before* any object is written.
 * - **The delivered file is never modified** — not its bytes, its mode or its
 *   mtime. It is only ever opened for reading.
 *
 * A delivery the store holds — an upload committed as an object — is adopted
 * here, wherever e3 runs. A delivered file is adopted on the machine it lies on
 * (`dataset-adopt-file.ts`).
 *
 * @packageDocumentation
 */

import { checkDatasetType, isCollectionRoot, manifestByteSize, manifestElementCount, type IntakeFile, type TreePath } from '@elaraai/e3-types';
import {
  readBeast2Type,
  variant,
  type EastTypeValue,
} from '@elaraai/east';
import { DatasetTypeMismatchError, DeliveryRefusedError, ObjectNotFoundError } from './errors.js';
import { readManifest } from './dataset-open.js';
import { intakeDelivery, rememberDelivery, rememberedManifest, type DeliveryIntake, type DeliveryIntakeOptions } from './delivery-intake.js';
import { readTouched } from './gc-graph.js';
import { withDatasetWriteLock, workspaceSetDatasetByHash, type DatasetLeaf } from './trees.js';
import type { IntakeSource, TaskRunner } from './execution/interfaces.js';
import type { LockHandle, StorageBackend } from './storage/interfaces.js';

/** How an adopt took its file in. */
export type DatasetTaken =
  /** The store already knew the delivery by its hash: nothing was taken in. */
  | 'known'
  /** A value that is not a collection, stored as the object the file is. */
  | 'carried'
  /** A collection, taken in by intake units on the runners. */
  | 'taken';

/** How far an adopt has got with its file. */
export interface DatasetAdoptProgress {
  /** `hash` while the file is read for its SHA-256, which says whether the
   *  store already knows it; `take-in` while intake units take it in. */
  readonly phase: 'hash' | 'take-in';
  /** Bytes of the file the phase has covered: read for the hash, or covered by
   *  the pieces taken in. */
  readonly bytes: number;
  /** The file's size. */
  readonly total: number;
  /** In `take-in`: the delivery's pieces, and how many have been taken in. */
  readonly pieces?: { readonly done: number; readonly total: number };
}

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
  /** How the file was taken in. */
  taken: DatasetTaken;
  /** When `taken`: the runners that took it in, as their commands are named,
   *  in the order each first did — empty when every piece was taken in before,
   *  by an intake that stopped part way. */
  runners?: readonly string[];
  /** When a runner fell back to another: why. */
  fallback?: string;
}

/**
 * Options accepted by {@link datasetAdoptObject}: those of a file's adoption
 * (`datasetAdoptFile`) that apply to a delivery the store holds, whose name is
 * its hash, so there is no digest to check and none to take.
 */
export interface DatasetAdoptObjectOptions {
  /**
   * A workspace lock the caller already holds; without one, the adopt takes
   * the workspace lock shared for its own duration.
   */
  lock?: LockHandle;
  /** Hears how far the adopt has got taking a collection in, as each piece
   *  finishes: always the `take-in` phase. */
  onProgress?: (progress: DatasetAdoptProgress) => void;
  /**
   * Aborting it stops the intake: the pieces it finished are remembered, so
   * the next adopt of the delivery takes in only the rest.
   */
  signal?: AbortSignal;
}

/**
 * How far an adopt has got, as a dataset upload's commit reports it while it
 * runs (`processing`), whichever way the store takes the upload in: hashing a
 * staged file, then its pieces as intake units take them in.
 *
 * @param path - The dataset's path, as the upload names it
 * @param progress - How far the adopt has got
 * @returns The commit's progress, as the transfer protocol carries it
 */
export function adoptProgressToIntakeFile(path: string, progress: DatasetAdoptProgress): IntakeFile {
  return {
    path,
    step: progress.phase === 'hash'
      ? variant('hashing', null)
      : variant('taking_in', { pieces: BigInt(progress.pieces?.total ?? 0), done: BigInt(progress.pieces?.done ?? 0) }),
    bytes: BigInt(progress.bytes),
    total: BigInt(progress.total),
  };
}

/** What an adoption reports back of the object it took in: a file's
 *  (`objectAdoptFile`), or a delivery's the store holds. */
export interface ObjectAdoptResult {
  /** The object the value is: the manifest, for a collection. */
  hash: string;
  /** The file's size. */
  size: number;
  /** How the file was taken in. */
  taken: DatasetTaken;
  /** When `taken`: the runners that took it in (see
   *  {@link DatasetAdoptResult.runners}). */
  runners?: readonly string[];
  /** When a runner fell back to another: why. */
  fallback?: string;
}

/**
 * Takes a delivery in through intake units on `runner`, naming the delivery in
 * a runner's refusal.
 *
 * @param intake - The intake the delivery is taken in by: this entry's, which
 *   takes in a delivery the store holds, unless the caller gives the root
 *   entry's, which reads a delivered file too
 * @throws {Error} When there is no runner to take it in.
 * @internal
 */
export async function takeIn(
  storage: StorageBackend,
  repo: string,
  runner: TaskRunner | undefined,
  source: IntakeSource,
  type: EastTypeValue,
  sourceHash: string,
  size: number,
  delivery: string,
  options: DeliveryIntakeOptions,
  intake: typeof intakeDelivery = intakeDelivery,
): Promise<DeliveryIntake> {
  if (runner === undefined) {
    throw new Error(`${delivery} holds a collection, which intake units take in, and no runner was given to run them`);
  }
  try {
    return await intake(storage, repo, runner, source, type, sourceHash, size, options);
  } catch (err) {
    if (err instanceof DeliveryRefusedError) throw new DeliveryRefusedError(err.runner, err.refusal, err.stderr, delivery);
    throw err;
  }
}

/**
 * Point a workspace dataset at a delivery the store already knows, checking
 * its type first.
 *
 * @remarks
 * The dedup door. A delivery the store knows skips the upload entirely: the
 * bytes were split before, and the memo names the manifest they became; or
 * they are an object in the store. Either may have been stored for a
 * different dataset with a different type, so this is the only place that
 * pairing is ever checked. An object that is a collection is taken in by
 * intake units on `runner`, in pieces, and remembered as the manifest it
 * became: how far it has got goes to `options.onProgress` as each piece
 * finishes, and aborting `options.signal` stops it with the pieces it finished
 * remembered, so the next adopt of the delivery takes in only the rest.
 *
 * It holds the locks a file's adoption (`datasetAdoptFile`) does, or the
 * workspace lock its caller holds: a collection the store holds whole is split into segments
 * here, which for a large one takes a while, and neither a deploy nor a
 * removal may finish inside it, nor a sweep delete its segments before the ref
 * names them.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param treePath - Path to the dataset
 * @param sourceHash - SHA-256 of the delivered bytes
 * @param runner - The runner that takes in a collection the store holds whole:
 *   needed unless the memo names the delivery's manifest, or it holds another
 *   value
 * @param options - A lock the caller already holds, a listener for how far the
 *   intake has got, and a signal that stops it
 * @returns The dataset's new hash, the delivery's size, the stored geometry and
 *   how the delivery was taken in
 * @throws {DatasetTypeMismatchError} When the delivery's wire type is not the
 *   type the dataset declares
 * @throws {DeliveryRefusedError} When a runner refuses the collection the
 *   store holds whole
 * @throws {WorkspaceLockError} When the workspace is locked by another process
 * @throws If the dataset is not writable, the store does not know the
 *   delivery, the intake was aborted, or a garbage collection is running
 */
export async function datasetAdoptObject(
  storage: StorageBackend,
  repo: string,
  ws: string,
  treePath: TreePath,
  sourceHash: string,
  runner: TaskRunner | undefined,
  options: DatasetAdoptObjectOptions = {},
): Promise<DatasetAdoptResult> {
  return withDatasetWriteLock(storage, repo, ws, treePath, options.lock, async (leaf) => {
    const adopted = await adoptStored(storage, repo, ws, leaf, sourceHash, { runner, onProgress: options.onProgress, signal: options.signal });
    if (adopted === null) throw new ObjectNotFoundError(sourceHash);
    return pointAt(storage, repo, ws, treePath, leaf, adopted);
  });
}

/**
 * Point a workspace dataset at a delivery the store already knows, when that
 * takes nothing in: the manifest the adoption memo names for it, or an object
 * of a value that is not a collection. Its type is checked first.
 *
 * @remarks
 * What a transfer init asks before it plans an upload. An init answers at
 * once, so it never takes a delivery in: a collection the store holds whole,
 * but the memo does not name — one whose intake is still running, or stopped —
 * is left for an upload's commit, which takes it in where commits run.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param treePath - Path to the dataset
 * @param sourceHash - SHA-256 of the delivered bytes
 * @param options - A lock the caller already holds
 * @returns What was adopted; or `null`, with nothing written, when the store
 *   holds no such object, or holds a collection whole that the memo does not
 *   name
 * @throws {DatasetTypeMismatchError} When the delivery's wire type is not the
 *   type the dataset declares
 * @throws {WorkspaceLockError} When the workspace is locked by another process
 * @throws If the dataset is not writable, or a garbage collection is running
 */
export async function datasetAdoptKnown(
  storage: StorageBackend,
  repo: string,
  ws: string,
  treePath: TreePath,
  sourceHash: string,
  options: { lock?: LockHandle } = {},
): Promise<DatasetAdoptResult | null> {
  return withDatasetWriteLock(storage, repo, ws, treePath, options.lock, async (leaf) => {
    const adopted = await adoptStored(storage, repo, ws, leaf, sourceHash, null);
    return adopted === null ? null : pointAt(storage, repo, ws, treePath, leaf, adopted);
  });
}

/**
 * Adopts, for the dataset `leaf` declares, a delivery the store holds — as the
 * manifest the memo names, or as an object — checking its type first, under
 * the dataset's write lock its caller holds.
 *
 * @param intake - How a collection object the memo does not name is taken in;
 *   `null` takes nothing in, and leaves one to its caller
 * @returns What was adopted, or `null` when the store holds no such object, or
 *   holds a collection whole and `intake` is `null`
 * @throws {DatasetTypeMismatchError} When the delivery's wire type is not the
 *   type the dataset declares
 */
async function adoptStored(
  storage: StorageBackend,
  repo: string,
  ws: string,
  leaf: DatasetLeaf,
  sourceHash: string,
  intake: { runner: TaskRunner | undefined; onProgress: ((progress: DatasetAdoptProgress) => void) | undefined; signal: AbortSignal | undefined } | null,
): Promise<ObjectAdoptResult | null> {
  const subject = `dataset '${leaf.address}'`;
  const known = await rememberedManifest(storage, repo, sourceHash);
  if (known !== null) {
    const mismatch = checkDatasetType(subject, `delivery ${sourceHash.slice(0, 8)}...`, leaf.type, known.manifest.type);
    if (mismatch) throw new DatasetTypeMismatchError(ws, leaf.address, mismatch);
    return { hash: known.hash, size: manifestByteSize(known.manifest), taken: 'known' };
  }
  // Re-referenced before it is rooted, as a write of it would be, and read
  // once more should it read as gone: a delete that raced the touch has it
  // aside for a moment
  if ((await storage.objects.touch(repo, [sourceHash]))[0] !== true) return null;
  const stored = await readTouched(() => storedValue(storage, repo, sourceHash), (read) => read === null);
  if (stored === null) return null;
  const { size } = stored;
  const mismatch = checkDatasetType(subject, `object ${sourceHash.slice(0, 8)}...`, leaf.type, stored.type);
  if (mismatch) throw new DatasetTypeMismatchError(ws, leaf.address, mismatch);
  if (!isCollectionRoot(leaf.type)) return { hash: sourceHash, size, taken: 'carried' };
  if (intake === null) return null;
  const { onProgress, signal } = intake;
  const taken = await takeIn(storage, repo, intake.runner, { object: sourceHash }, leaf.type, sourceHash, size, `object ${sourceHash.slice(0, 8)}...`, {
    ...(onProgress !== undefined && { onProgress: (progress) => onProgress({ phase: 'take-in', total: size, ...progress }) }),
    ...(signal !== undefined && { signal }),
  });
  await rememberDelivery(storage, repo, sourceHash, taken);
  return { hash: taken.hash, size, taken: 'taken', runners: taken.runners, ...(taken.fallback !== undefined && { fallback: taken.fallback }) };
}

/** Points a dataset at what an adopt stored, with its version vector's self
 *  entry, and reports it with its stored geometry. @internal */
export async function pointAt(
  storage: StorageBackend,
  repo: string,
  ws: string,
  treePath: TreePath,
  leaf: DatasetLeaf,
  adopted: ObjectAdoptResult,
): Promise<DatasetAdoptResult> {
  // The self entry is what makes change detection exact: the ref's version
  // vector names the value's hash, so a new delivery invalidates precisely
  // this input's consumers.
  const selfKeypath = treePath.map(s => `.${s.value}`).join('');
  await workspaceSetDatasetByHash(storage, repo, ws, treePath, adopted.hash, new Map([[selfKeypath, adopted.hash]]));
  return { ...adopted, ...await geometry(storage, repo, adopted.hash, leaf.type) };
}

/** The head reads {@link objectType} tries, in order — the first covers every
 *  type section anything realistic writes. */
const OBJECT_HEAD_PROBE_BYTES = [64 * 1024, 1024 * 1024, 16 * 1024 * 1024];

/** An object's size, and its wire type from ranged reads of its head: `null`
 *  when the store does not hold it. */
async function storedValue(storage: StorageBackend, repo: string, hash: string): Promise<{ size: number; type: EastTypeValue } | null> {
  try {
    const { size } = await storage.objects.stat(repo, hash);
    return { size, type: await objectType(storage, repo, hash, size) };
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return null;
    throw err;
  }
}

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
