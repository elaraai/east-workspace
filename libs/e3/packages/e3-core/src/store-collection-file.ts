/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The store's door for files on the machine that stores them: a stock runner's
 * output, a blob or a manifest directory, and any beast2 file a task wrote.
 *
 * The door itself is `store-collection.ts`, which every backend shares; this is
 * what it reads a file through, which only a host with a filesystem has. A
 * stock runner's output was written through the Writer, so its segments are
 * stored as they stand, never decoded: a manifest directory's segment files are
 * linked in under the hashes that name them, and a blob's segments are carved
 * out of the file. Any other file is read as foreign bytes, a segment at a time.
 *
 * @packageDocumentation
 */

import { createReadStream } from 'node:fs';
import { open, readFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import {
  carveBeast2Ranged,
  openBeast2PagesFor,
  readBeast2ExtentsRanged,
  readBeast2SegmentLogicalBytes,
  type Beast2RangedExtents,
  type EastType,
  type EastTypeValue,
} from '@elaraai/east';
import {
  decodeCollectionManifest,
  isCollectionManifestType,
  isCollectionRoot,
  type CollectionPiece,
  type CollectionSegmentRef,
} from '@elaraai/e3-types';
import { readDatasetFileType } from '@elaraai/e3';
import { OBJECT_CONCURRENCY, eachAtMost } from './concurrency.js';
import {
  READ_CHUNK_BYTES,
  storeCollectionThrough,
  type CollectionDoor,
  type CollectionSource as StoredCollectionSource,
} from './store-collection.js';
import type { StorageBackend } from './storage/interfaces.js';

/** A source of a collection on this machine's filesystem. */
type FileCollectionSource =
  /** A beast2 blob in a file. `canonical` when the Writer wrote it — a stock
   *  runner's output — so its segments are stored as they stand; otherwise
   *  its elements are read and written again. */
  | { readonly file: string; readonly canonical?: boolean }
  /** A manifest directory: the manifest in the file `manifest`, and each
   *  object it names in `<manifest>.segments/`, the file named by the
   *  object's SHA-256. `canonical` when the Writer wrote it — a stock
   *  runner's output — so its segments are stored as they stand; otherwise
   *  its elements are read and written again. */
  | { readonly manifest: string; readonly canonical?: boolean };

/**
 * One source of a collection, in order, as {@link storeCollection} takes it:
 * one the store's door reads anywhere, or a file on this machine.
 */
export type CollectionSource = StoredCollectionSource | FileCollectionSource;

/**
 * Store a collection, given as sources in order, and return its manifest's
 * hash: the store's door, reading the files it is given on this machine.
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
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param type - The collection type (Array / Set / Dict)
 * @param sources - The collection's sources, in order
 * @returns The manifest object's hash
 * @throws {TypeError} When `type` is not a collection type.
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
  return storeCollectionThrough<FileCollectionSource>(storage, repo, type, sources, (source, door) =>
    'file' in source
      ? filePiece(door, source.file, source.canonical === true)
      : directoryPiece(storage, repo, door, source.manifest, source.canonical === true));
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

/** A stock runner's output: its segments carved out of the file as they
 *  stand. A file that is not the Writer's — no index, segments that alias
 *  one another, another header — is read as foreign bytes instead. */
async function filePiece(door: CollectionDoor, file: string, canonical: boolean): Promise<CollectionPiece> {
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
      door.checkType(file, extents.typeValue);
      if (extents.selfContained && bytesEqual(extents.head, door.header)) return { segments: fileRefs(door, file, extents) };
    }
  }
  return { elements: door.readElements(createReadStream(file, { highWaterMark: READ_CHUNK_BYTES })) };
}

/** A manifest directory. A stock runner's, cut by the current rule under
 *  the canonical header, is the Writer's: each segment file is linked into
 *  the store under the hash that names it and carried by its entry, never
 *  read. The segments are adopted OBJECT_CONCURRENCY at a time — a link each
 *  locally, but a request each on a remote store — and one an Array's
 *  manifest names twice is adopted once. Any other has its elements read a
 *  segment file at a time and written again. */
async function directoryPiece(
  storage: StorageBackend,
  repo: string,
  door: CollectionDoor,
  file: string,
  canonical: boolean,
): Promise<CollectionPiece> {
  const manifest = decodeCollectionManifest(await readFile(file));
  door.checkType(file, manifest.type);
  const segmentFile = (hash: string): string => join(`${file}.segments`, `${hash}.beast2`);
  if (canonical && manifest.rule === door.rule && manifest.header === door.headerHash) {
    await eachAtMost([...new Set(manifest.entries.map((entry) => entry.hash))], OBJECT_CONCURRENCY,
      (hash) => storage.objects.adoptFile(repo, segmentFile(hash), hash));
    return { segments: door.manifestRefs(manifest, 0, manifest.entries.length) };
  }
  async function* elements(): AsyncGenerator<unknown> {
    for (const entry of manifest.entries) yield* door.readElements([await readFile(segmentFile(entry.hash))]);
  }
  return { elements: elements() };
}

/** Each segment of a canonical file, carved as it is reached: its fence is
 *  its first key, and its logical size is in its frame's header. */
async function* fileRefs(door: CollectionDoor, file: string, extents: Beast2RangedExtents): AsyncGenerator<CollectionSegmentRef> {
  const handle = await open(file, 'r');
  try {
    const pages = openBeast2PagesFor(door.typeValue);
    for (let i = 0; i < extents.offsets.length; i++) {
      const start = extents.offsets[i]!;
      const end = i + 1 < extents.offsets.length ? extents.offsets[i + 1]! : extents.segmentsEnd;
      const blob = carveBeast2Ranged(extents, await readRange(handle, start, end - start), i, i + 1);
      yield {
        count: extents.counts[i]!,
        fence: door.fenceOf === null ? new Uint8Array(0) : door.fenceOf(pages(blob).fence(0)),
        logicalBytes: readBeast2SegmentLogicalBytes(blob)[0]!,
        read: () => blob,
      };
    }
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

/** Whether two byte strings are equal. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
