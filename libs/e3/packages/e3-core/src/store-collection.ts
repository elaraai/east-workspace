/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The store's door: the one way a collection reaches the object store.
 *
 * A collection dataset is a manifest naming segment objects, cut by the current
 * rule and written under the canonical header for its type — the bytes the
 * Writer writes for the value, whichever way the value arrived. Every writer of
 * one hands its collection here as sources in order: a task's output, a split
 * task's assembly, a record's commit, a delivery's intake, an API `PUT` body.
 * The door writes the segment objects and the manifest, and returns the
 * manifest's hash, the dataset's content address.
 *
 * What the door does with a source depends on what it can trust about the
 * source's bytes:
 *
 * - A manifest in the store is the Writer's already: its segments are carried
 *   over by reference and never read, and only the seams between sources are
 *   re-cut. One cut under another rule or another header is an older e3's, and
 *   is refused.
 * - A stock runner's output was written through the Writer, whose bytes the
 *   conformance corpus pins in every runtime, so its segments are stored as
 *   they stand, never decoded: a manifest directory's segment files are linked
 *   in under the hashes that name them, and a blob's segments are carved out of
 *   the file. A delivered file reaches the door so: intake units take it in on
 *   the runners (`delivery-intake.ts`), and each writes a manifest directory.
 *   Files are read on the machine they lie on (`store-collection-file.ts`).
 * - Everything else is foreign: an API `PUT` body, a custom task's output, a
 *   collection stored whole. Its elements are read a segment of the source at
 *   a time and written again through the Writer, so nothing about the source's
 *   layout survives into the store.
 * - Elements in memory are written through the Writer.
 *
 * No source is decoded whole: a foreign source is read front to back, and a
 * segment of it larger than the platform's limit is refused before it is read.
 *
 * @packageDocumentation
 */

import {
  Beast2ElementWriter,
  EastTypeValueType,
  decodeBeast2ElementsFor,
  encodeBeast2FenceFor,
  isTypeValueStructurallyEqual,
  isVariant,
  printFor,
  readBeast2Type,
  segmentKeyTypeOf,
  segmentRuleFor,
  toEastTypeValue,
  type EastType,
  type EastTypeValue,
} from '@elaraai/east';
import {
  isCollectionRoot,
  writeCollectionManifest,
  type CollectionManifest,
  type CollectionPiece,
  type CollectionSegmentRef,
} from '@elaraai/e3-types';
import { computeHash } from './objects.js';
import { OBJECT_CONCURRENCY } from './concurrency.js';
import { openDatasetObject } from './dataset-open.js';
import type { StorageBackend } from './storage/interfaces.js';

/** Bytes a stored blob or a file is read in when it is read front to back:
 *  what the door holds of a foreign source besides the segment it decodes.
 *  @internal */
export const READ_CHUNK_BYTES = 1024 * 1024;

/**
 * How many of a stored run's segments a read reads with it, those after it in
 * the run, once it follows a read of the segment before it: a re-cut reads a
 * carried segment only to look inside it, at a seam or after an edit, where
 * the cut mostly realigns at once; one that has gone on to the next goes on
 * until the cut realigns, a segment or a few later, and on a remote store each
 * would be a round trip after the last (#1573).
 */
const SEAM_READ_AHEAD = 2;

/**
 * One source of a collection, in order, as {@link storeCollection} takes it.
 */
export type CollectionSource =
  /** A collection in the store — a manifest, or a record state naming one —
   *  or its segments `[from, to)`; or a collection stored whole, as the object
   *  it arrived as. `manifest` is the collection's manifest, already decoded,
   *  which the caller vouches is the one `stored` names: the door takes it
   *  rather than read the object again, and checks it as it checks one it
   *  reads. */
  | { readonly stored: string; readonly from?: number; readonly to?: number; readonly manifest?: CollectionManifest }
  /** A beast2 blob arriving as a stream of bytes, from outside. */
  | { readonly chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array> }
  /** Elements in canonical order: an Array's in position, a Set's or a
   *  Dict's (as `[key, value]` pairs) ascending. */
  | { readonly elements: Iterable<unknown> | AsyncIterable<unknown> };

/**
 * The door as it stores one collection: what a source of a kind the door does
 * not read itself — a file on the machine that stores it — is read under.
 *
 * @internal
 */
export interface CollectionDoor {
  /** The collection's type. */
  readonly typeValue: EastTypeValue;
  /** The current segment rule for it. */
  readonly rule: ReturnType<typeof segmentRuleFor>;
  /** The Writer's own header: a segment is carried over only under it. */
  readonly header: Uint8Array;
  /** The header's hash, which a current manifest names. */
  readonly headerHash: string;
  /** Encodes a key as a segment's fence; `null` for an Array. */
  readonly fenceOf: ReturnType<typeof encodeBeast2FenceFor> | null;
  /** Reads a source's elements, a segment of it at a time. */
  readonly readElements: ReturnType<typeof decodeBeast2ElementsFor>;
  /**
   * Refuses a source that holds another type than the collection's.
   *
   * @param source - The source, as a refusal names it
   * @param wire - The type it holds
   * @throws {Error} When it is not the collection's.
   */
  checkType(source: string, wire: EastTypeValue): void;
  /**
   * A current manifest's segments `[from, to)`, by reference: each carries the
   * entry that names it, and the fence that followed it.
   *
   * @param manifest - The manifest
   * @param from - The first segment
   * @param to - The segment after the last
   * @returns The segments' references
   */
  manifestRefs(manifest: CollectionManifest, from: number, to: number): CollectionSegmentRef[];
}

/**
 * Store a collection, given as sources in order, and return its manifest's
 * hash.
 *
 * @remarks
 * The manifest is the one the Writer writes for the whole value: sources are
 * re-cut into it by `writeCollectionManifest`, so equal values stored through
 * any sources have one manifest, and a source that differs from a stored value
 * in one row shares every segment of it but the few around that row.
 *
 * For a Set or a Dict the sources must ascend together: each source's own
 * elements are checked, and a source that starts before the previous one ends
 * is the caller's to prevent, as a split task's assembly does by merging the
 * parts whose key ranges overlap first. An empty list of sources stores the
 * empty collection.
 *
 * A file on this machine — a stock runner's output, a manifest directory — is
 * stored through the root entry's `storeCollection`, which reads it where it
 * lies.
 *
 * A stored source that carries its manifest is not read again: a caller that
 * stores many runs of one collection's segments, as a split's planning stores
 * its pieces, decodes the manifest once and passes it with each.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param type - The collection type (Array / Set / Dict)
 * @param sources - The collection's sources, in order
 * @returns The manifest object's hash
 * @throws {TypeError} When `type` is not a collection type, or a source is
 *   none of the door's own.
 * @throws {Error} When a source holds another type, its elements do not
 *   ascend, a foreign segment is larger than the limit a collection is read in,
 *   a stored source is missing, or a stored manifest was cut under another rule
 *   or header, which an older e3 wrote.
 */
export async function storeCollection(
  storage: StorageBackend,
  repo: string,
  type: EastType | EastTypeValue,
  sources: Iterable<CollectionSource> | AsyncIterable<CollectionSource>,
): Promise<string> {
  return storeCollectionThrough<never>(storage, repo, type, sources, (source) => {
    throw new TypeError(`store: a source is a stored collection, chunks or elements, and ${JSON.stringify(Object.keys(source))} is none: ` +
      'a file on this machine is stored through the root entry of @elaraai/e3-core');
  });
}

/**
 * Store a collection, given as sources in order, some of a kind the door does
 * not read itself, which `other` reads under the door it is given: what the
 * root entry's `storeCollection` stores a file on this machine through.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param type - The collection type (Array / Set / Dict)
 * @param sources - The collection's sources, in order
 * @param other - Reads a source of another kind as a piece of the collection
 * @returns The manifest object's hash
 * @throws As {@link storeCollection} does, and whatever `other` throws.
 * @internal
 */
export async function storeCollectionThrough<S extends object>(
  storage: StorageBackend,
  repo: string,
  type: EastType | EastTypeValue,
  sources: Iterable<CollectionSource | S> | AsyncIterable<CollectionSource | S>,
  other: (source: S, door: CollectionDoor) => Promise<CollectionPiece>,
): Promise<string> {
  const typeValue = isVariant(type) ? (type as EastTypeValue) : toEastTypeValue(type as EastType);
  if (!isCollectionRoot(typeValue)) {
    throw new TypeError(`store: a collection is an Array, Set or Dict, not ${typeValue.type}`);
  }
  const readElements = decodeBeast2ElementsFor(typeValue);
  const rule = segmentRuleFor(typeValue);
  // The Writer's own header: a segment is carried over only under it.
  const header = new Beast2ElementWriter(typeValue, { segment: () => {} }).header;
  const headerHash = computeHash(header);
  const keyType = segmentKeyTypeOf(typeValue);
  const fenceOf = keyType === null ? null : encodeBeast2FenceFor(keyType);
  const printType = printFor(EastTypeValueType);

  // Read by structure: a source another build wrote can carry a recursive
  // type that differs inside under the id the collection's type gives its
  // own, which isTypeValueEqual takes as one type unread (#1233).
  const checkType = (source: string, wire: EastTypeValue): void => {
    if (!isTypeValueStructurallyEqual(wire, typeValue)) {
      throw new Error(`store: ${source} holds ${printType(wire)}, not ${printType(typeValue)}`);
    }
  };

  /** A current manifest's segments `[from, to)`, by reference: each carries
   *  the entry that names it, and the fence that followed it, which decides a
   *  seam after it without a read when the same key follows again. A read of
   *  one that follows a read of the one before it reads the next
   *  {@link SEAM_READ_AHEAD} of the run with it. */
  const manifestRefs = (manifest: CollectionManifest, from: number, to: number): CollectionSegmentRef[] => {
    const entries = manifest.entries;
    const reads = new Map<number, Promise<Uint8Array>>();
    /** The segment of the run read last. */
    let last: number | undefined;
    /** Segment `i`'s bytes, and the reads of the next of the run begun when
     *  the re-cut is going through it. */
    const readSegment = (i: number): Promise<Uint8Array> => {
      const ahead = last !== undefined && i === last + 1 ? SEAM_READ_AHEAD : 0;
      last = i;
      for (let j = i; j < Math.min(to, i + 1 + ahead); j++) {
        if (reads.has(j)) continue;
        const reading = storage.objects.read(repo, entries[j]!.hash);
        reading.catch(() => { /* raised when its segment is read */ });
        reads.set(j, reading);
      }
      const reading = reads.get(i)!;
      // Read once: the re-cut holds what it read for as long as it needs it
      reads.delete(i);
      return reading;
    };
    const refs: CollectionSegmentRef[] = [];
    for (let i = from; i < to; i++) {
      const entry = entries[i]!;
      refs.push({
        count: Number(entry.count),
        fence: entry.fence,
        ...(i + 1 < entries.length && { nextFence: entries[i + 1]!.fence }),
        read: () => readSegment(i),
        entry,
      });
    }
    return refs;
  };

  /** A collection stored whole, read front to back. */
  async function* objectChunks(hash: string): AsyncGenerator<Uint8Array> {
    const { size } = await storage.objects.stat(repo, hash);
    for (let at = 0; at < size; at += READ_CHUNK_BYTES) {
      yield await storage.objects.readRange(repo, hash, at, Math.min(READ_CHUNK_BYTES, size - at));
    }
  }

  const storedPiece = async (source: { stored: string; from?: number; to?: number; manifest?: CollectionManifest }): Promise<CollectionPiece> => {
    const opened = source.manifest !== undefined
      ? { hash: source.stored, manifest: source.manifest }
      : await openDatasetObject(storage, repo, source.stored);
    const manifest = opened.manifest;
    if (manifest === null) {
      if (source.from !== undefined || source.to !== undefined) {
        throw new Error(`store: object ${opened.hash.slice(0, 8)} is not a manifest, and only a manifest has segments to take a run of`);
      }
      return { elements: readElements(objectChunks(opened.hash)) };
    }
    checkType(`manifest ${opened.hash.slice(0, 8)}`, manifest.type);
    // No segment of a manifest cut under another rule or header is one the
    // Writer writes now.
    if (manifest.rule !== rule || manifest.header !== headerHash) {
      const cut = manifest.rule !== rule ? `under ${manifest.rule}, not the current ${rule}` : 'under another header than the current one';
      throw new Error(`store: manifest ${opened.hash.slice(0, 8)} was cut ${cut}: ` +
        'an older e3 wrote this repository — re-create it: deploy again and import its data again');
    }
    return { segments: manifestRefs(manifest, source.from ?? 0, source.to ?? manifest.entries.length) };
  };

  const door: CollectionDoor = { typeValue, rule, header, headerHash, fenceOf, readElements, checkType, manifestRefs };

  async function* pieces(): AsyncGenerator<CollectionPiece> {
    for await (const source of sources) {
      if (!isDoorSource(source)) yield await other(source, door);
      else if ('elements' in source) yield { elements: source.elements };
      else if ('chunks' in source) yield { elements: readElements(source.chunks) };
      else yield await storedPiece(source);
    }
  }

  // The segments go to the store in batches, and the manifest after every one
  // it names is stored
  const manifest = await writeCollectionManifest(typeValue, pieces(), (objects) => storage.objects.writeMany(repo, objects),
    { batch: OBJECT_CONCURRENCY });
  return storage.objects.write(repo, manifest);
}

/** Whether a source is of a kind the door reads itself: a stored collection,
 *  chunks or elements. */
function isDoorSource<S extends object>(source: CollectionSource | S): source is CollectionSource {
  return 'stored' in source || 'chunks' in source || 'elements' in source;
}

/**
 * How a stored manifest was cut, when it is not as the door cuts one now:
 * under another rule, or under another header than the Writer's. An older e3
 * wrote it, and none of its segments is what the Writer writes now.
 *
 * @param manifest - The manifest
 * @returns How it was cut, in a refusal's words; `null` when the door cuts it
 *   so now
 * @internal
 */
export function manifestCutElsewhere(manifest: CollectionManifest): string | null {
  const rule = segmentRuleFor(manifest.type);
  if (manifest.rule !== rule) return `under ${manifest.rule}, not the current ${rule}`;
  const header = new Beast2ElementWriter(manifest.type, { segment: () => {} }).header;
  return manifest.header === computeHash(header) ? null : 'under another header than the current one';
}

/**
 * Store beast2 bytes a program produced as a dataset value: a collection
 * through the door, any other value as the object the bytes are.
 *
 * @remarks
 * What a mutation's result takes — a new state, or a delta. The bytes are
 * read as foreign: the program that wrote them is the author's to choose.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param bytes - The beast2 bytes
 * @returns The dataset object's hash — the manifest, for a collection
 * @throws {Error} When the door refuses the collection the bytes hold.
 */
export async function storeDatasetBytes(storage: StorageBackend, repo: string, bytes: Uint8Array): Promise<string> {
  let type: EastTypeValue;
  try {
    type = readBeast2Type(bytes);
  } catch {
    return storage.objects.write(repo, bytes);
  }
  if (!isCollectionRoot(type)) return storage.objects.write(repo, bytes);
  return storeCollection(storage, repo, type, [{ chunks: [bytes] }]);
}
