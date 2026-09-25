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
 * one hands its collection here as sources in order: a task's output, a
 * partitioned task's assembly, a record's commit, a delivered file, an upload.
 * The door writes the segment objects and the manifest, and returns the
 * manifest's hash, the dataset's content address.
 *
 * What the door does with a source depends on what it can trust about the
 * source's bytes:
 *
 * - A manifest in the store, cut by the current rule under the canonical
 *   header, is the Writer's already: its segments are carried over by
 *   reference and never read, and only the seams between sources are re-cut.
 * - A stock runner's output was written through the Writer, whose bytes the
 *   conformance corpus pins in every runtime, so its segments are stored as
 *   they stand, never decoded: a manifest directory's segment files are linked
 *   in under the hashes that name them, and a blob's segments are carved out of
 *   the file.
 * - Everything else is foreign: a delivered file, an upload, a custom task's
 *   output, a blob or a manifest written before the current rule. Its elements
 *   are read a segment of the source at a time and written again through the
 *   Writer, so nothing about the source's layout survives into the store.
 * - Elements in memory are written through the Writer.
 *
 * No source is decoded whole: a foreign source is read front to back, and a
 * segment of it larger than the platform's limit is refused before it is read.
 *
 * @packageDocumentation
 */

import { createReadStream } from 'node:fs';
import { open, readFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Beast2ElementWriter,
  EastTypeValueType,
  carveBeast2Ranged,
  decodeBeast2ElementsFor,
  encodeBeast2FenceFor,
  isTypeValueEqual,
  isVariant,
  openBeast2PagesFor,
  printFor,
  readBeast2ExtentsRanged,
  readBeast2SegmentLogicalBytes,
  readBeast2Type,
  segmentKeyTypeOf,
  segmentRuleFor,
  toEastTypeValue,
  type Beast2RangedExtents,
  type EastType,
  type EastTypeValue,
} from '@elaraai/east';
import {
  decodeCollectionManifest,
  isCollectionManifestType,
  isCollectionRoot,
  writeCollectionManifest,
  type CollectionManifest,
  type CollectionPiece,
  type CollectionSegmentRef,
} from '@elaraai/e3-types';
import { readDatasetFileType } from '@elaraai/e3';
import { computeHash } from './objects.js';
import { DatasetSegments, openDatasetObject } from './dataset-open.js';
import type { StorageBackend } from './storage/interfaces.js';

/** Bytes a stored blob or a file is read in when it is read front to back:
 *  what the door holds of a foreign source besides the segment it decodes. */
const READ_CHUNK_BYTES = 1024 * 1024;

/**
 * One source of a collection, in order, as {@link storeCollection} takes it.
 */
export type CollectionSource =
  /** A collection in the store — a manifest, a record state naming one, or a
   *  blob — or its segments `[from, to)`. */
  | { readonly stored: string; readonly from?: number; readonly to?: number }
  /** A beast2 blob in a file. `canonical` when the Writer wrote it — a stock
   *  runner's output — so its segments are stored as they stand; otherwise
   *  its elements are read and written again. */
  | { readonly file: string; readonly canonical?: boolean }
  /** A manifest directory: the manifest in the file `manifest`, and each
   *  object it names in `<manifest>.segments/`, the file named by the
   *  object's SHA-256. `canonical` when the Writer wrote it — a stock
   *  runner's output — so its segments are stored as they stand; otherwise
   *  its elements are read and written again. */
  | { readonly manifest: string; readonly canonical?: boolean }
  /** A beast2 blob arriving as a stream of bytes, from outside. */
  | { readonly chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array> }
  /** Elements in canonical order: an Array's in position, a Set's or a
   *  Dict's (as `[key, value]` pairs) ascending. */
  | { readonly elements: Iterable<unknown> | AsyncIterable<unknown> };

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
 * is the caller's to refuse, as the partitioned splice does. An empty list of
 * sources stores the empty collection.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param type - The collection type (Array / Set / Dict)
 * @param sources - The collection's sources, in order
 * @returns The manifest object's hash
 * @throws {TypeError} When `type` is not a collection type.
 * @throws {Error} When a source holds another type, its elements do not
 *   ascend, a foreign segment is larger than the limit a collection is read in,
 *   or a stored source is missing.
 */
export async function storeCollection(
  storage: StorageBackend,
  repo: string,
  type: EastType | EastTypeValue,
  sources: Iterable<CollectionSource> | AsyncIterable<CollectionSource>,
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

  const checkType = (source: string, wire: EastTypeValue): void => {
    if (!isTypeValueEqual(wire, typeValue)) {
      throw new Error(`store: ${source} holds ${printType(wire)}, not ${printType(typeValue)}`);
    }
  };

  /** A current manifest's segments `[from, to)`, by reference: each carries
   *  the entry that names it, and the fence that followed it, which decides a
   *  seam after it without a read when the same key follows again. */
  const manifestRefs = (manifest: CollectionManifest, from: number, to: number): CollectionSegmentRef[] => {
    const entries = manifest.entries;
    const refs: CollectionSegmentRef[] = [];
    for (let i = from; i < to; i++) {
      const entry = entries[i]!;
      refs.push({
        count: Number(entry.count),
        fence: entry.fence,
        ...(i + 1 < entries.length && { nextFence: entries[i + 1]!.fence }),
        read: () => storage.objects.read(repo, entry.hash),
        entry,
      });
    }
    return refs;
  };

  /** Segments `[from, to)` of a stored collection that cannot be carried,
   *  read one segment object at a time. */
  async function* segmentElements(segments: DatasetSegments, from: number, to: number): AsyncGenerator<unknown> {
    for (let i = from; i < to; i++) yield* readElements([await segments.segment(i)]);
  }

  /** A stored blob, read front to back. */
  async function* objectChunks(hash: string): AsyncGenerator<Uint8Array> {
    const { size } = await storage.objects.stat(repo, hash);
    for (let at = 0; at < size; at += READ_CHUNK_BYTES) {
      yield await storage.objects.readRange(repo, hash, at, Math.min(READ_CHUNK_BYTES, size - at));
    }
  }

  const storedPiece = async (source: { stored: string; from?: number; to?: number }): Promise<CollectionPiece> => {
    const opened = await openDatasetObject(storage, repo, source.stored);
    const ranged = source.from !== undefined || source.to !== undefined;
    if (opened.manifest !== null) {
      const manifest = opened.manifest;
      checkType(`manifest ${opened.hash.slice(0, 8)}`, manifest.type);
      const from = source.from ?? 0;
      const to = source.to ?? manifest.entries.length;
      if (manifest.rule === rule && manifest.header === headerHash) return { segments: manifestRefs(manifest, from, to) };
      // Cut under another rule, or under another header: no segment of it is
      // one the Writer writes now, so its elements go through.
      return { elements: segmentElements(await DatasetSegments.open(storage, repo, opened.hash), from, to) };
    }
    if (ranged) {
      const segments = await DatasetSegments.open(storage, repo, opened.hash);
      checkType(`object ${opened.hash.slice(0, 8)}`, segments.typeValue);
      return { elements: segmentElements(segments, source.from ?? 0, source.to ?? segments.segmentCount) };
    }
    return { elements: readElements(objectChunks(opened.hash)) };
  };

  /** A stock runner's output: its segments carved out of the file as they
   *  stand. A file that is not the Writer's — no index, segments that alias
   *  one another, another header — is read as foreign bytes instead. */
  const filePiece = async (file: string, canonical: boolean): Promise<CollectionPiece> => {
    if (canonical) {
      let extents: Beast2RangedExtents | null = null;
      const handle = await open(file, 'r');
      try {
        extents = await readBeast2ExtentsRanged({ size: (await handle.stat()).size, read: (offset, length) => readRange(handle, offset, length) });
      } catch {
        extents = null;
      } finally {
        await handle.close();
      }
      if (extents !== null) {
        checkType(file, extents.typeValue);
        if (extents.selfContained && bytesEqual(extents.head, header)) return { segments: fileRefs(file, extents) };
      }
    }
    return { elements: readElements(createReadStream(file, { highWaterMark: READ_CHUNK_BYTES })) };
  };

  /** A manifest directory. A stock runner's, cut by the current rule under
   *  the canonical header, is the Writer's: each segment file is linked into
   *  the store under the hash that names it and carried by its entry, never
   *  read. Any other has its elements read a segment file at a time and
   *  written again. */
  const directoryPiece = async (file: string, canonical: boolean): Promise<CollectionPiece> => {
    const manifest = decodeCollectionManifest(await readFile(file));
    checkType(file, manifest.type);
    const segmentFile = (hash: string): string => join(`${file}.segments`, `${hash}.beast2`);
    if (canonical && manifest.rule === rule && manifest.header === headerHash) {
      for (const entry of manifest.entries) await storage.objects.adoptFile(repo, segmentFile(entry.hash), entry.hash);
      return { segments: manifestRefs(manifest, 0, manifest.entries.length) };
    }
    async function* elements(): AsyncGenerator<unknown> {
      for (const entry of manifest.entries) yield* readElements([await readFile(segmentFile(entry.hash))]);
    }
    return { elements: elements() };
  };

  /** Each segment of a canonical file, carved as it is reached: its fence is
   *  its first key, and its logical size is in its frame's header. */
  async function* fileRefs(file: string, extents: Beast2RangedExtents): AsyncGenerator<CollectionSegmentRef> {
    const handle = await open(file, 'r');
    try {
      const pages = openBeast2PagesFor(typeValue);
      for (let i = 0; i < extents.offsets.length; i++) {
        const start = extents.offsets[i]!;
        const end = i + 1 < extents.offsets.length ? extents.offsets[i + 1]! : extents.segmentsEnd;
        const blob = carveBeast2Ranged(extents, await readRange(handle, start, end - start), i, i + 1);
        yield {
          count: extents.counts[i]!,
          fence: fenceOf === null ? new Uint8Array(0) : fenceOf(pages(blob).fence(0)),
          logicalBytes: readBeast2SegmentLogicalBytes(blob)[0]!,
          read: () => blob,
        };
      }
    } finally {
      await handle.close();
    }
  }

  async function* pieces(): AsyncGenerator<CollectionPiece> {
    for await (const source of sources) {
      if ('elements' in source) yield { elements: source.elements };
      else if ('chunks' in source) yield { elements: readElements(source.chunks) };
      else if ('file' in source) yield await filePiece(source.file, source.canonical === true);
      else if ('manifest' in source) yield await directoryPiece(source.manifest, source.canonical === true);
      else yield await storedPiece(source);
    }
  }

  const manifest = await writeCollectionManifest(typeValue, pieces(), (bytes) => storage.objects.write(repo, bytes));
  return storage.objects.write(repo, manifest);
}

/**
 * Store a beast2 file as a dataset value: a collection through the door, any
 * other value as the object the file is.
 *
 * @remarks
 * What a task's output takes. A manifest file is the manifest directory a stock
 * runner writes a collection as, and is stored from its segment files. A
 * collection blob a stock runner wrote is the Writer's, so it is `canonical`
 * and its segments are stored as they stand; one any other program wrote is
 * read and written again. Any other root is adopted as it stands, by link where
 * the store's objects are files — and so is a file whose header does not read,
 * which the reader that needs its type refuses.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param file - Path to the file
 * @param options - Whether the Writer wrote the file
 * @returns The dataset object's hash — the manifest, for a collection
 * @throws {Error} When the file is missing, or the door refuses the collection
 *   it holds.
 */
export async function storeDatasetFile(
  storage: StorageBackend,
  repo: string,
  file: string,
  options: { canonical?: boolean } = {},
): Promise<string> {
  let type: EastTypeValue;
  try {
    type = readDatasetFileType(file);
  } catch {
    return (await storage.objects.adoptFile(repo, file)).hash;
  }
  if (isCollectionManifestType(type)) {
    const { type: manifestType } = decodeCollectionManifest(await readFile(file));
    return storeCollection(storage, repo, manifestType, [{ manifest: file, canonical: options.canonical === true }]);
  }
  if (!isCollectionRoot(type)) return (await storage.objects.adoptFile(repo, file)).hash;
  return storeCollection(storage, repo, type, [{ file, canonical: options.canonical === true }]);
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

/** Whether two byte strings are equal. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
