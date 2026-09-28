/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Taking a delivered collection into the store: in pieces, on the runners.
 *
 * Every row of a delivery is read by a runner, through `intake` units a
 * {@link TaskRunner} runs: inflating each segment, walking each row, cutting
 * and framing them again is a runner's work, and e3's own thread does none of
 * it. A delivery with an index is cut into pieces, runs of its segments of
 * about the pieces' middle size ({@link pieceSizes}), each taken in by a unit
 * of its own, as many at once as the runner admits; one without an index is
 * taken in whole, by one unit. The pieces are concatenated through the store's
 * door, which re-cuts the seams between them, so the delivery is stored as the
 * manifest the Writer writes for its rows whichever way it was cut. A Set's
 * elements or a Dict's keys must ascend across each seam too, which no piece
 * sees, so that is checked here: each piece's last key against the next one's
 * first.
 *
 * Each piece taken in is remembered in the adoption memo, under a key made of
 * the delivery's SHA-256 and the piece's segments, so taking the same bytes in
 * again after an intake stopped part way — interrupted, or failed on a later
 * piece — runs only the pieces that had not finished. A memo entry roots
 * nothing: gc collects a piece nothing names, and an entry whose objects are
 * gone is a miss, as is one cut under another rule or header.
 *
 * @packageDocumentation
 */

import { open, type FileHandle } from 'node:fs/promises';
import {
  Beast2ElementWriter,
  compareFor,
  printFor,
  readBeast2ExtentsRanged,
  segmentKeyTypeOf,
  segmentRuleFor,
  type Beast2RangedExtents,
  type EastTypeValue,
} from '@elaraai/east';
import type { CollectionManifest } from '@elaraai/e3-types';
import { eachAtMost } from './concurrency.js';
import { DatasetSegments, readManifest } from './dataset-open.js';
import { DeliveryRefusedError, ObjectNotFoundError } from './errors.js';
import { pieceSizes } from './execution/pieces.js';
import type { IntakeSource, TaskRunner } from './execution/interfaces.js';
import { computeHash } from './objects.js';
import { storeCollection } from './store-collection.js';
import type { StorageBackend } from './storage/interfaces.js';

/**
 * How many pieces of a delivery are asked of the runner at once. The runner
 * admits as many as it has room for — a local one, its budget's cores — and
 * the rest wait: this bounds the waiting, and what a failure leaves to finish.
 */
const PIECES_IN_FLIGHT = 64;

/** How far an intake has got with a delivery. */
export interface DeliveryIntakeProgress {
  /** Bytes of the delivery its finished pieces cover; its size once all are. */
  readonly bytes: number;
  /** The delivery's pieces, and how many have finished. */
  readonly pieces: { readonly done: number; readonly total: number };
}

/** Options for {@link intakeDelivery}. */
export interface DeliveryIntakeOptions {
  /** Hears how far the intake has got: as it starts, and as each piece
   *  finishes. */
  onProgress?: (progress: DeliveryIntakeProgress) => void;
  /** Aborting it stops the pieces. */
  signal?: AbortSignal;
  /**
   * Called after a piece is taken in and before it is remembered: throws when
   * the delivery changed while it was read, so a piece of other bytes is never
   * remembered under this delivery's hash.
   */
  verify?: () => Promise<void>;
}

/** What an intake of a delivery came to. */
export interface DeliveryIntake {
  /** The manifest the delivery was stored as. */
  readonly hash: string;
  /** The runners that took its pieces in, in the order each first did: empty
   *  when every piece was remembered. */
  readonly runners: readonly string[];
  /** Why a piece was not taken in by the runner the backend prefers, when one
   *  was not. */
  readonly fallback?: string;
}

/** A run of a delivery's segments one unit takes in — `null` for the whole
 *  delivery — and the bytes of the delivery it covers. */
interface Piece {
  readonly segments: { readonly from: number; readonly to: number } | null;
  readonly bytes: number;
}

/**
 * Takes a delivered collection into the store through intake units, and
 * returns the manifest it became.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param runner - The runner that takes each piece in
 * @param source - The delivery: a file the runner reads, or an object in the
 *   store
 * @param type - The collection type its header names, which the caller checked
 * @param sourceHash - The delivery's SHA-256, which its pieces are remembered
 *   under
 * @param size - The delivery's size in bytes
 * @param options - Progress, cancellation, and the check that the delivery is
 *   unchanged
 * @returns The manifest, and the runners that took it in
 * @throws {DeliveryRefusedError} When a runner refuses a piece, or a Set's or a
 *   Dict's keys do not ascend where two pieces meet.
 * @throws {Error} When a runner cannot take a piece in, or `verify` throws.
 */
export async function intakeDelivery(
  storage: StorageBackend,
  repo: string,
  runner: TaskRunner,
  source: IntakeSource,
  type: EastTypeValue,
  sourceHash: string,
  size: number,
  options: DeliveryIntakeOptions = {},
): Promise<DeliveryIntake> {
  const pieces = await planPieces(storage, repo, source, size);
  const hashes: string[] = new Array(pieces.length);
  const runners: string[] = [];
  let fallback: string | undefined;
  let done = 0;
  let bytes = 0;
  // A piece that fails stops the rest: each waiting one is withdrawn, and each
  // running one stopped.
  const stop = new AbortController();
  const signal = options.signal === undefined ? stop.signal : AbortSignal.any([options.signal, stop.signal]);
  options.onProgress?.({ bytes: 0, pieces: { done: 0, total: pieces.length } });
  await eachAtMost(pieces.map((_, i) => i), PIECES_IN_FLIGHT, async (i) => {
    const piece = pieces[i]!;
    try {
      const key = piece.segments === null ? null : pieceKey(sourceHash, piece.segments);
      let hash = key === null ? null : (await rememberedManifest(storage, repo, key))?.hash ?? null;
      if (hash === null) {
        const taken = await runner.intake(storage, { source, type, ...(piece.segments !== null && { segments: piece.segments }) }, { signal });
        await options.verify?.();
        hash = taken.hash;
        if (!runners.includes(taken.runner)) runners.push(taken.runner);
        fallback ??= taken.fallback;
        if (key !== null) await storage.refs.adoptionWrite(repo, key, hash);
      }
      hashes[i] = hash;
    } catch (err) {
      stop.abort();
      throw err;
    }
    done++;
    bytes += piece.bytes;
    options.onProgress?.({ bytes, pieces: { done, total: pieces.length } });
  });
  if (pieces.length === 1) return { hash: hashes[0]!, runners, ...(fallback !== undefined && { fallback }) };
  await checkSeams(storage, repo, type, hashes);
  const hash = await storeCollection(storage, repo, type, hashes.map((stored) => ({ stored })));
  return { hash, runners, ...(fallback !== undefined && { fallback }) };
}

/**
 * The manifest remembered under an adoption memo key, while it is one the
 * store can use: every object it names is there, and it was cut by the current
 * rule under the Writer's header. `null` otherwise.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param key - The memo key: a delivery's SHA-256, or a piece's key
 * @returns The manifest and its hash, or `null`
 */
export async function rememberedManifest(
  storage: StorageBackend,
  repo: string,
  key: string,
): Promise<{ hash: string; manifest: CollectionManifest } | null> {
  const hash = await storage.refs.adoptionRead(repo, key);
  if (hash === null) return null;
  let manifest: CollectionManifest | null;
  try {
    manifest = await readManifest(storage, repo, hash);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return null;
    throw err;
  }
  if (manifest === null) return null;
  // Another e3 cut it: none of its segments is what the Writer writes now.
  const header = new Beast2ElementWriter(manifest.type, { segment: () => {} }).header;
  if (manifest.rule !== segmentRuleFor(manifest.type) || manifest.header !== computeHash(header)) return null;
  // The memo is not a root: a collection gc took is a miss, whichever of its
  // objects went first.
  for (const object of [manifest.header, ...manifest.entries.map((entry) => entry.hash)]) {
    if (!await storage.objects.exists(repo, object)) return null;
  }
  return { hash, manifest };
}

/** The memo key a piece of a delivery is remembered under: a SHA-256, as the
 *  memo keys every entry, of the delivery's and the piece's segments. */
function pieceKey(sourceHash: string, segments: { from: number; to: number }): string {
  return computeHash(new TextEncoder().encode(`e3 intake piece\n${sourceHash}\n${segments.from}\n${segments.to}`));
}

/**
 * The pieces a delivery is taken in as: runs of the segments its index names,
 * each closed once it holds the pieces' middle size, so the same delivery is
 * always cut the same way. A delivery with no index, one whose segments alias
 * one another, or one small enough for one piece is taken in whole, by one
 * unit, which refuses it when it must.
 */
async function planPieces(storage: StorageBackend, repo: string, source: IntakeSource, size: number): Promise<Piece[]> {
  const whole: Piece[] = [{ segments: null, bytes: size }];
  let extents: Beast2RangedExtents;
  try {
    extents = await readExtents(storage, repo, source, size);
  } catch {
    return whole;
  }
  const { offsets, segmentsEnd } = extents;
  if (!extents.selfContained || offsets.length < 2) return whole;
  const target = pieceSizes().target;
  const pieces: Piece[] = [];
  let from = 0;
  let covered = 0;
  for (let i = 0; i < offsets.length; i++) {
    const last = i + 1 === offsets.length;
    const end = last ? segmentsEnd : offsets[i + 1]!;
    if (!last && end - offsets[from]! < target) continue;
    // The first piece covers the header, and the last the index.
    const to = last ? size : end;
    pieces.push({ segments: { from, to: i + 1 }, bytes: to - covered });
    covered = to;
    from = i + 1;
  }
  return pieces.length === 1 ? whole : pieces;
}

/** A delivery's extents, by ranged reads of its tail and its head. */
async function readExtents(storage: StorageBackend, repo: string, source: IntakeSource, size: number): Promise<Beast2RangedExtents> {
  if ('object' in source) {
    return readBeast2ExtentsRanged({ size, read: (offset, length) => storage.objects.readRange(repo, source.object, offset, length) });
  }
  const handle = await open(source.file, 'r');
  try {
    return await readBeast2ExtentsRanged({ size, read: (offset, length) => readRange(handle, offset, length) });
  } finally {
    await handle.close();
  }
}

/** Exactly `length` bytes of a file at `offset`, or fewer at its end. */
async function readRange(handle: FileHandle, offset: number, length: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  let read = 0;
  while (read < length) {
    const { bytesRead } = await handle.read(buffer, read, length - read, offset + read);
    if (bytesRead === 0) break;
    read += bytesRead;
  }
  return read === length ? buffer : buffer.subarray(0, read);
}

/**
 * Holds a Set's elements or a Dict's keys to strict ascent where two pieces
 * meet: each piece's last key against the next one's first. A piece checked
 * its own.
 *
 * @throws {DeliveryRefusedError} When a piece's first key does not follow the
 *   last before it, in the words a runner uses.
 */
async function checkSeams(storage: StorageBackend, repo: string, type: EastTypeValue, hashes: readonly string[]): Promise<void> {
  const keyType = segmentKeyTypeOf(type);
  if (keyType === null) return;
  const compare = compareFor(keyType) as (a: unknown, b: unknown) => number;
  const print = printFor(keyType);
  const noun = type.type === 'Set' ? 'Set elements' : 'Dict keys';
  let previous: DatasetSegments | null = null;
  for (const hash of hashes) {
    const next = await DatasetSegments.open(storage, repo, hash);
    if (next.segmentCount === 0) continue;
    if (previous !== null) {
      const last = await previous.lastKey(previous.segmentCount - 1);
      const first = await next.fence(0);
      if (compare(last, first) >= 0) {
        throw new DeliveryRefusedError('e3', `intake: the delivery's ${noun} must ascend strictly in East order, and ${print(first)} follows ${print(last)}`, '');
      }
    }
    previous = next;
  }
}
