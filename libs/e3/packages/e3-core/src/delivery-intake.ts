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
 * taken in whole, by one unit — or refused, before any unit runs, when it is
 * larger than the runner says it takes in whole
 * ({@link TaskRunner.wholeIntakeLimit}). The pieces are concatenated through
 * the store's door, which re-cuts the seams between them, so the delivery is
 * stored as the manifest the Writer writes for its rows whichever way it was
 * cut. A Set's
 * elements or a Dict's keys must ascend across each seam too, which no piece
 * sees, so that is checked here: each piece's last key against the next one's
 * first.
 *
 * Each piece taken in is remembered in the adoption memo, under a key made of
 * the delivery's SHA-256 and the piece's segments, so taking the same bytes in
 * again after an intake stopped part way — interrupted, or failed on a later
 * piece — runs only the pieces that had not finished. Once the delivery is in,
 * its own entry answers for it and its pieces' are forgotten
 * ({@link rememberDelivery}). A memo entry roots nothing: gc collects a piece
 * nothing names and drops the entry, and an entry whose objects are gone is a
 * miss, as is one cut under another rule or header. An entry that answers is
 * re-referenced whole, since its caller is about to root it.
 *
 * A delivery the store holds is read here, through the store; a delivered file
 * is read on the machine it lies on, by the reader its caller gives
 * (`delivery-intake-file.ts`).
 *
 * @packageDocumentation
 */

import {
  Beast2ElementWriter,
  compareFor,
  printFor,
  readBeast2ExtentsRanged,
  segmentKeyTypeOf,
  segmentRuleFor,
  spliceBeast2Tail,
  type Beast2RangedExtents,
  type EastTypeValue,
} from '@elaraai/east';
import type { CollectionManifest } from '@elaraai/e3-types';
import { OBJECT_CONCURRENCY, eachAtMost } from './concurrency.js';
import { DatasetSegments, readManifest } from './dataset-open.js';
import { DeliveryRefusedError, ObjectNotFoundError } from './errors.js';
import { pieceSizes } from './execution/pieces.js';
import { touchReachable } from './gc-graph.js';
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
  /** The memo keys its pieces are remembered under, which
   *  {@link rememberDelivery} forgets: none for a delivery taken in whole. */
  readonly pieces: readonly string[];
}

/** A run of a delivery's segments one unit takes in — `null` for the whole
 *  delivery — and the bytes of the delivery it covers. */
interface Piece {
  readonly segments: { readonly from: number; readonly to: number } | null;
  readonly bytes: number;
}

/**
 * Reads a delivered file's bytes by ranges while `use` runs: a host's with a
 * filesystem, which an intake of a file source reads the file's index through.
 *
 * @internal
 */
export type DeliveryFileReader = <T>(
  file: string,
  use: (read: (offset: number, length: number) => Promise<Uint8Array>) => Promise<T>,
) => Promise<T>;

/** The pieces a delivery is taken in as. */
interface PiecePlan {
  readonly pieces: Piece[];
  /** Why the delivery cannot be cut into pieces, in a refusal's words, when it
   *  cannot: it is taken in whole, by one unit. `null` when it can be, or is
   *  small enough to be taken in whole anyway. */
  readonly uncut: string | null;
}

/**
 * Takes a delivered collection into the store through intake units, and
 * returns the manifest it became.
 *
 * @remarks
 * A delivery the store holds is taken in here. A delivered file, whose index
 * is read where it lies, is taken in through the root entry's
 * `intakeDelivery`, which reads it on this machine.
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
 * @throws {DeliveryRefusedError} When a runner refuses a piece, a Set's or a
 *   Dict's keys do not ascend where two pieces meet, or the delivery cannot be
 *   cut into pieces and is larger than the runner takes in whole.
 * @throws {Error} When a runner cannot take a piece in, the delivery's tail
 *   cannot be read, `verify` throws, or the delivery is a file, which this
 *   entry does not read.
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
  return intakeDeliveryReading(storage, repo, runner, source, type, sourceHash, size, options, null);
}

/**
 * Takes a delivered collection into the store through intake units, as
 * {@link intakeDelivery} does, reading a delivered file's index through
 * `readFile`: what the root entry's `intakeDelivery` takes a file in through.
 *
 * @param readFile - Reads a delivered file by ranges; `null` where no file is
 *   read, and a file source is refused
 * @internal
 */
export async function intakeDeliveryReading(
  storage: StorageBackend,
  repo: string,
  runner: TaskRunner,
  source: IntakeSource,
  type: EastTypeValue,
  sourceHash: string,
  size: number,
  options: DeliveryIntakeOptions,
  readFile: DeliveryFileReader | null,
): Promise<DeliveryIntake> {
  const { pieces, uncut } = await planPieces(storage, repo, source, size, readFile);
  // A runner on compute of a bounded size says how large a delivery it takes
  // in whole: one that cannot be cut, and is larger, is refused before any
  // unit runs, rather than failing on the runner part way through.
  const limit = runner.wholeIntakeLimit;
  if (uncut !== null && typeof limit === 'number' && size > limit) {
    throw new DeliveryRefusedError('e3',
      `intake: ${uncut}, so it is taken in whole, by one unit, and at ${size} bytes it is more than the ${limit} ` +
      'a unit of this runner takes in whole — write it again with a current Writer, which indexes it', '');
  }
  const keys = pieces.map((piece) => (piece.segments === null ? null : pieceKey(sourceHash, piece.segments)));
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
      const key = keys[i]!;
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
  const remembered = keys.filter((key): key is string => key !== null);
  if (pieces.length === 1) return { hash: hashes[0]!, runners, ...(fallback !== undefined && { fallback }), pieces: remembered };
  await checkSeams(storage, repo, type, hashes);
  const hash = await storeCollection(storage, repo, type, hashes.map((stored) => ({ stored })));
  return { hash, runners, ...(fallback !== undefined && { fallback }), pieces: remembered };
}

/**
 * Remembers a delivery taken in, under its SHA-256, as the manifest it became,
 * and then forgets its pieces: the delivery's own entry answers for them from
 * now on. Written first, so an intake stopped between the two leaves entries
 * gc drops, never a delivery it forgot.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param sourceHash - The delivery's SHA-256
 * @param intake - What the intake came to: the manifest, and its pieces' keys
 */
export async function rememberDelivery(storage: StorageBackend, repo: string, sourceHash: string, intake: DeliveryIntake): Promise<void> {
  await storage.refs.adoptionWrite(repo, sourceHash, intake.hash);
  await eachAtMost(intake.pieces, OBJECT_CONCURRENCY, (key) => storage.refs.adoptionDelete(repo, key));
}

/**
 * The manifest remembered under an adoption memo key, while it is one the
 * store can use: every object it names is there, and it was cut by the current
 * rule under the Writer's header. `null` otherwise.
 *
 * @remarks
 * A manifest it answers with is re-referenced, with every object it names
 * (`touchReachable`), as a write of them would be: the caller is about to
 * root it, and gc beside running work leaves it meanwhile, however long
 * nothing named it.
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
  // objects went first. One found whole is re-referenced whole.
  if (!await touchReachable(storage, repo, [hash])) return null;
  return { hash, manifest };
}

/** How many bytes of a stored delivery a piece's blob reads at once. */
const PIECE_READ_BYTES = 8 * 1024 * 1024;

/**
 * A run of a stored delivery's segments, as the blob of its own an intake unit
 * of the run reads.
 */
export interface DeliveryPiece {
  /**
   * The blob's bytes, in order: the delivery's header, the run's frames as
   * they are stored, and a terminator, index and footer for them. The frames
   * are read from the store by ranges as the bytes are taken, so the store
   * serves the piece no byte of the delivery's other segments.
   */
  readonly bytes: AsyncIterable<Uint8Array>;
  /** The run, as the blob numbers its segments: all of them. */
  readonly segments: { readonly from: number; readonly to: number };
  /**
   * A refusal of the blob, naming its segments and offsets as the delivery
   * numbers them.
   *
   * @param refusal - The refusal, in the words every runner uses
   * @returns The refusal of the delivery
   */
  inDelivery(refusal: string): string;
}

/**
 * Segments `[from, to)` of a delivery the store holds, as a blob of their own:
 * the delivery's header, the run's frames as they are stored, and a
 * terminator, index and footer for them.
 *
 * @remarks
 * What an intake of the run reads of the delivery, and all that is read of it,
 * by ranges: its footer and index, its header, and then the run. A host where
 * placing an object is a download stages a piece of a large delivery so,
 * rather than the delivery whole.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param hash - The delivery's object
 * @param segments - The run, by the delivery's index
 * @returns The run's blob; or `null` when the delivery has no index that
 *   parses, the run is not a range of its segments, or they alias one another,
 *   so the runner is given the whole delivery and refuses it in its own words
 * @throws {ObjectNotFoundError} When the store holds no such object.
 * @throws {Error} When the store fails a read of the delivery, as it failed —
 *   a throttle stays a throttle, which a caller that runs the intake in rounds
 *   retries, rather than staging the whole delivery for one piece — and, as
 *   the bytes are taken, when the object ends inside the segments its index
 *   names.
 */
export async function deliveryPiece(
  storage: StorageBackend,
  repo: string,
  hash: string,
  segments: { readonly from: number; readonly to: number },
): Promise<DeliveryPiece | null> {
  const { size } = await storage.objects.stat(repo, hash);
  const store: { failure: { err: unknown } | null } = { failure: null };
  let extents: Beast2RangedExtents;
  try {
    // A probe of the footer alone, so the read that follows is the index: a
    // run that does not hold the last segments reads none of their bytes.
    extents = await readBeast2ExtentsRanged(
      {
        size,
        read: async (offset, length) => {
          try {
            return await storage.objects.readRange(repo, hash, offset, length);
          } catch (err) {
            store.failure = { err };
            throw err;
          }
        },
      },
      { tailProbeBytes: 16 },
    );
  } catch {
    // The store's failure is its own; extents that do not parse are the
    // delivery's, which the runner refuses in its own words, given it whole.
    if (store.failure !== null) throw store.failure.err;
    return null;
  }
  const count = extents.offsets.length;
  const { from, to } = segments;
  if (!extents.selfContained || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > count) return null;
  const start = extents.offsets[from]!;
  const end = to < count ? extents.offsets[to]! : extents.segmentsEnd;
  // The run moves back to follow the header directly.
  const shift = start - extents.prefixEnd;
  const table = extents.offsets.slice(from, to).map((offset, i) => ({ offset: offset - shift, count: extents.counts[from + i]! }));
  async function* bytes(): AsyncGenerator<Uint8Array> {
    yield extents.head;
    for (let at = start; at < end; at += PIECE_READ_BYTES) {
      const length = Math.min(PIECE_READ_BYTES, end - at);
      const read = await storage.objects.readRange(repo, hash, at, length);
      if (read.length !== length) throw new Error(`object ${hash} ends at ${at + read.length}, inside the segments its index names`);
      yield read;
    }
    yield spliceBeast2Tail(table, extents.prefixEnd + end - start);
  }
  return {
    bytes: bytes(),
    segments: { from: 0, to: to - from },
    inDelivery: (refusal) => refusal.replace(
      /\bsegment (\d+) of the delivery(?:, at offset (\d+))?/g,
      (_match, n: string, offset: string | undefined) =>
        `segment ${Number(n) + from} of the delivery${offset === undefined ? '' : `, at offset ${Number(offset) + shift}`}`,
    ),
  };
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
 * unit, which refuses it when it must; the plan says why one that cannot be
 * cut is not.
 *
 * @throws {Error} When the delivery's tail or head cannot be read.
 */
async function planPieces(
  storage: StorageBackend,
  repo: string,
  source: IntakeSource,
  size: number,
  readFile: DeliveryFileReader | null,
): Promise<PiecePlan> {
  const whole = (uncut: string | null): PiecePlan => ({ pieces: [{ segments: null, bytes: size }], uncut });
  const extents = await readExtents(storage, repo, source, size, readFile);
  if (extents === null) return whole('the delivery has no index that reads');
  const { offsets, segmentsEnd } = extents;
  if (offsets.length < 2) return whole(null);
  if (!extents.selfContained) return whole("the delivery's segments alias one another");
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
  return pieces.length === 1 ? whole(null) : { pieces, uncut: null };
}

/**
 * A delivery's extents, by ranged reads of its tail and its head; `null` when
 * it has none that read: no index, or not a collection of beast2 version 5.
 *
 * @throws {Error} When the store or the filesystem fails a read: that is not a
 *   delivery without an index; or the delivery is a file, and no reader of
 *   files was given.
 */
async function readExtents(
  storage: StorageBackend,
  repo: string,
  source: IntakeSource,
  size: number,
  readFile: DeliveryFileReader | null,
): Promise<Beast2RangedExtents | null> {
  let failed: { err: unknown } | null = null;
  const reading = (read: (offset: number, length: number) => Promise<Uint8Array>) => async (offset: number, length: number): Promise<Uint8Array> => {
    try {
      return await read(offset, length);
    } catch (err) {
      failed = { err };
      throw err;
    }
  };
  const extentsOf = async (read: (offset: number, length: number) => Promise<Uint8Array>): Promise<Beast2RangedExtents | null> => {
    try {
      return await readBeast2ExtentsRanged({ size, read: reading(read) });
    } catch {
      if (failed !== null) throw failed.err;
      return null;
    }
  };
  if ('object' in source) return extentsOf((offset, length) => storage.objects.readRange(repo, source.object, offset, length));
  if (readFile === null) {
    throw new Error(`intake: the delivery is the file ${source.file}, which is read on the machine it lies on: ` +
      'take it in through the root entry of @elaraai/e3-core');
  }
  return readFile(source.file, extentsOf);
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
