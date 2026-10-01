/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Blobs and files in the origin private file system (OPFS).
 *
 * A blob is an OPFS file: its key's parts name the directories it is in and
 * the file itself. A file named by a path is the OPFS file at that path. Both
 * write a file whole in a staging directory and move it into place, so a
 * reader sees a file before its write or after it, never an empty or a torn
 * one, and a write that fails leaves the file as it was.
 *
 * Every name is escaped on its way to OPFS, so any string is a key's part or
 * a path's name, and two that differ only in case never meet: a lowercase
 * letter, a digit, `_`, `-` and a `.` after the first character are kept,
 * and every other character becomes `%` and the hex of each of its UTF-8
 * bytes.
 *
 * @packageDocumentation
 */

import {
  FileNotFoundError,
  checkBlobKey,
  checkBlobPrefix,
  checkRange,
  chunksOf,
  compareKeys,
  type BlobInfo,
  type BlobKey,
  type BlobStat,
  type BlobSweepResult,
  type BlobsAdapter,
  type ByteSource,
  type FileStat,
  type FilesAdapter,
} from './adapters.js';
import { pathNames } from './memory.js';

/** The directory a write stages its file in: no escaped name begins with
 *  `.`, so no key's part or path's name meets it. */
const STAGING = '.staging';

/** What a blob's file name ends with: no escaped name ends with `~`, so a
 *  blob and a directory of blobs under the same key's part keep apart. */
const BLOB_SUFFIX = '~';

/**
 * Escapes a key's part or a path's name as an OPFS name.
 *
 * @param part - The part or name: a non-empty, well-formed string
 * @returns Its OPFS name
 * @throws {TypeError} When it is empty, or holds a lone surrogate
 */
export function escapeName(part: string): string {
  if (part.length === 0) throw new TypeError('an OPFS name is not empty');
  let escaped = '';
  for (const char of part) {
    if (/^[a-z0-9_-]$/.test(char) || (char === '.' && escaped.length > 0)) {
      escaped += char;
      continue;
    }
    let bytes: string;
    try {
      bytes = encodeURIComponent(char);
    } catch {
      throw new TypeError(`an OPFS name is well-formed UTF-16: ${JSON.stringify(part)} holds a lone surrogate`);
    }
    // encodeURIComponent leaves ASCII letters and !'()*.~ as they are.
    escaped += bytes.startsWith('%') ? bytes : `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return escaped;
}

/**
 * The key's part or path's name an OPFS name escapes.
 *
 * @param name - The OPFS name
 * @returns What it escapes, or `null` for a name {@link escapeName} never
 *   gives
 */
export function unescapeName(name: string): string | null {
  let part: string;
  try {
    part = decodeURIComponent(name);
  } catch {
    return null;
  }
  return part.length > 0 && escapeName(part) === name ? part : null;
}

/** Whether an error is the DOMException of a name. */
function isNamed(err: unknown, ...names: string[]): boolean {
  return typeof err === 'object' && err !== null && names.includes((err as { name?: unknown }).name as string);
}

/** Whether an error says an entry is not there as what it was asked for:
 *  missing, or a file where a directory was asked for, or the reverse. */
function isMissing(err: unknown): boolean {
  return isNamed(err, 'NotFoundError', 'TypeMismatchError');
}

/**
 * The directory the escaped names name under a directory.
 *
 * @param dir - Where the names start
 * @param names - The escaped names, outermost first
 * @param create - Whether to make the directories that are not there
 * @returns The directory, or `null` when one is not there and not made
 */
async function directoryAt(dir: FileSystemDirectoryHandle, names: readonly string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
  let at = dir;
  for (const name of names) {
    try {
      at = await at.getDirectoryHandle(name, { create });
    } catch (err) {
      if (!create && isMissing(err)) return null;
      throw err;
    }
  }
  return at;
}

/** The file of a name in a directory, or `null` when there is none. */
async function fileIn(dir: FileSystemDirectoryHandle | null, name: string): Promise<FileSystemFileHandle | null> {
  if (dir === null) return null;
  try {
    return await dir.getFileHandle(name);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/**
 * Reads a file's contents through `use`, or answers `null` when it is not
 * there — once more when the file was replaced as it was read, since a
 * `File` a replaced file gave no longer reads.
 */
async function readFile<T>(find: () => Promise<FileSystemFileHandle | null>, use: (file: File) => Promise<T>): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    const handle = await find();
    if (handle === null) return null;
    try {
      return await use(await handle.getFile());
    } catch (err) {
      if (isNamed(err, 'NotFoundError')) return null;
      if (isNamed(err, 'NotReadableError') && attempt === 0) continue;
      throw err;
    }
  }
}

/** `FileSystemHandle.move`, which OPFS has and the DOM types do not declare. */
interface Movable {
  move(destination: FileSystemDirectoryHandle, name: string): Promise<void>;
}

/**
 * Writes a file whole in a staging directory, and moves it to a name in a
 * directory, replacing what is there.
 *
 * @param staging - The directory to stage the file in
 * @param place - The directory the file goes to, found once it is written
 * @param name - The file's name there
 * @param data - Its bytes
 * @returns Its size in bytes
 */
async function stageAndMove(
  staging: FileSystemDirectoryHandle,
  place: () => Promise<FileSystemDirectoryHandle>,
  name: string,
  data: ByteSource,
): Promise<number> {
  const stagedName = crypto.randomUUID();
  const staged = await staging.getFileHandle(stagedName, { create: true });
  try {
    let size = 0;
    const writable = await staged.createWritable();
    try {
      for await (const chunk of chunksOf(data)) {
        // A file takes bytes of an ArrayBuffer: a view of shared memory is
        // copied.
        await writable.write(chunk.buffer instanceof ArrayBuffer ? chunk as Uint8Array<ArrayBuffer> : chunk.slice());
        size += chunk.length;
      }
    } catch (err) {
      await writable.abort().catch(() => undefined);
      throw err;
    }
    await writable.close();
    const movable = staged as unknown as Partial<Movable>;
    if (typeof movable.move !== 'function') {
      throw new Error('this browser\'s OPFS cannot move a file (FileSystemHandle.move), which e3-web writes every file by');
    }
    await movable.move(await place(), name);
    return size;
  } catch (err) {
    await staging.removeEntry(stagedName).catch(() => undefined);
    throw err;
  }
}

/**
 * Opens the OPFS directory at a path, making it and every directory above it
 * that is not there.
 *
 * @param path - An absolute `/`-separated path, its names escaped as
 *   {@link OpfsFiles} escapes them
 * @param root - Where the path starts: the origin's OPFS root unless given
 * @returns The directory
 */
export async function opfsDirectory(path: string, root?: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
  const start = root ?? await navigator.storage.getDirectory();
  return (await directoryAt(start, pathNames(path).map(escapeName), true))!;
}

/**
 * Blobs as OPFS files, under a directory of their own.
 *
 * @remarks
 * A write stages its file in the directory's `.staging` and moves it into
 * place once it is whole. A tab closed mid-write leaves its staged file
 * behind, which {@link sweep} removes once it is older than the age gate.
 *
 * @example
 * ```ts
 * const blobs = new OpfsBlobs(await opfsDirectory('/e3/blobs'));
 * await blobs.write(['repo', 'objects', hash], bytes);
 * ```
 */
export class OpfsBlobs implements BlobsAdapter {
  /**
   * @param root - The directory the blobs are kept in, which nothing else
   *   writes to
   */
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  /** The directory a key's blob is in, made when asked. */
  private parentOf(key: BlobKey, create: boolean): Promise<FileSystemDirectoryHandle | null> {
    return directoryAt(this.root, key.slice(0, -1).map(escapeName), create);
  }

  /** The file of a key's blob, or `null` when there is none. */
  private async fileOf(key: BlobKey): Promise<FileSystemFileHandle | null> {
    return fileIn(await this.parentOf(key, false), blobName(key[key.length - 1]!));
  }

  async read(key: BlobKey): Promise<Uint8Array | null> {
    checkBlobKey(key);
    return await readFile(() => this.fileOf(key), async (file) => new Uint8Array(await file.arrayBuffer()));
  }

  async readRange(key: BlobKey, offset: number, length: number): Promise<Uint8Array | null> {
    checkBlobKey(key);
    checkRange(offset, length);
    return await readFile(() => this.fileOf(key), async (file) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()));
  }

  async stat(key: BlobKey): Promise<BlobStat | null> {
    checkBlobKey(key);
    return await readFile(() => this.fileOf(key), (file) => Promise.resolve({ size: file.size, lastModified: file.lastModified }));
  }

  async write(key: BlobKey, data: ByteSource): Promise<number> {
    checkBlobKey(key);
    const staging = await this.root.getDirectoryHandle(STAGING, { create: true });
    return stageAndMove(staging, async () => (await this.parentOf(key, true))!, blobName(key[key.length - 1]!), data);
  }

  async delete(key: BlobKey): Promise<boolean> {
    checkBlobKey(key);
    const parent = await this.parentOf(key, false);
    if (parent === null) return false;
    try {
      await parent.removeEntry(blobName(key[key.length - 1]!));
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  }

  async deletePrefix(prefix: BlobKey): Promise<void> {
    checkBlobPrefix(prefix);
    if (prefix.length === 0) {
      // Listed first: a directory changed as it is iterated may skip entries.
      const names: string[] = [];
      for await (const name of this.root.keys()) if (name !== STAGING) names.push(name);
      for (const name of names) await removeQuietly(this.root, name, true);
      return;
    }
    const parent = await this.parentOf(prefix, false);
    if (parent === null) return;
    const last = escapeName(prefix[prefix.length - 1]!);
    await removeQuietly(parent, `${last}${BLOB_SUFFIX}`, false);
    await removeQuietly(parent, last, true);
  }

  async list(prefix: BlobKey): Promise<BlobInfo[]> {
    checkBlobPrefix(prefix);
    const found: BlobInfo[] = [];
    if (prefix.length === 0) {
      await walk(this.root, [], found, true);
    } else {
      const parent = await this.parentOf(prefix, false);
      if (parent !== null) {
        const last = escapeName(prefix[prefix.length - 1]!);
        const own = await fileIn(parent, `${last}${BLOB_SUFFIX}`);
        if (own !== null) {
          const file = await own.getFile().catch((err: unknown) => (isNamed(err, 'NotFoundError') ? null : Promise.reject(err)));
          if (file !== null) found.push({ key: [...prefix], size: file.size, lastModified: file.lastModified });
        }
        const dir = await directoryAt(parent, [last], false);
        if (dir !== null) await walk(dir, [...prefix], found, false);
      }
    }
    return found.sort((a, b) => compareKeys(a.key, b.key));
  }

  async sweep(options: { readonly minAge: number; readonly dryRun: boolean }): Promise<BlobSweepResult> {
    return sweepStaging(await directoryAt(this.root, [STAGING], false), options);
  }
}

/** A blob's file name. */
function blobName(part: string): string {
  return `${escapeName(part)}${BLOB_SUFFIX}`;
}

/**
 * Lists the blobs under a directory, whose key's parts so far are `parts`.
 *
 * @param skipStaging - Whether the directory is the blobs' root, whose
 *   staging directory holds no blob
 */
async function walk(dir: FileSystemDirectoryHandle, parts: readonly string[], found: BlobInfo[], skipStaging: boolean): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (skipStaging && name === STAGING) continue;
    if (handle.kind === 'file') {
      if (!name.endsWith(BLOB_SUFFIX)) continue;
      const part = unescapeName(name.slice(0, -BLOB_SUFFIX.length));
      if (part === null) continue;
      const file = await (handle as FileSystemFileHandle).getFile().catch((err: unknown) => (isNamed(err, 'NotFoundError') ? null : Promise.reject(err)));
      if (file !== null) found.push({ key: [...parts, part], size: file.size, lastModified: file.lastModified });
    } else {
      const part = unescapeName(name);
      if (part !== null) await walk(handle as FileSystemDirectoryHandle, [...parts, part], found, false);
    }
  }
}

/** Removes an entry of a directory, if it is there. */
async function removeQuietly(dir: FileSystemDirectoryHandle, name: string, recursive: boolean): Promise<void> {
  try {
    await dir.removeEntry(name, { recursive });
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
}

/**
 * Removes the files writes that never finished left in a staging directory,
 * as {@link BlobsAdapter.sweep} does.
 */
async function sweepStaging(
  staging: FileSystemDirectoryHandle | null,
  { minAge, dryRun }: { readonly minAge: number; readonly dryRun: boolean },
): Promise<BlobSweepResult> {
  let deleted = 0;
  let skippedYoung = 0;
  if (staging === null) return { deleted, skippedYoung };
  const now = Date.now();
  // Listed first: a directory changed as it is iterated may skip entries.
  const entries: Array<[string, FileSystemHandle]> = [];
  for await (const entry of staging.entries()) entries.push(entry);
  for (const [name, handle] of entries) {
    if (handle.kind !== 'file') continue;
    let file: File;
    try {
      file = await (handle as FileSystemFileHandle).getFile();
    } catch (err) {
      if (isNamed(err, 'NotFoundError')) continue;
      throw err;
    }
    if (minAge > 0 && now - file.lastModified < minAge) {
      skippedYoung++;
      continue;
    }
    if (!dryRun) {
      try {
        await staging.removeEntry(name);
      } catch (err) {
        if (isNamed(err, 'NotFoundError')) continue;
        // A write still has it open: in flight, whatever its age.
        if (isNamed(err, 'NoModificationAllowedError')) {
          skippedYoung++;
          continue;
        }
        throw err;
      }
    }
    deleted++;
  }
  return { deleted, skippedYoung };
}

/**
 * Files in OPFS, named by absolute `/`-separated paths from a root
 * directory: the origin's OPFS root unless given.
 *
 * @remarks
 * A path's names are escaped as blob keys' parts are. A write stages its file
 * in the root's `.staging`, and moves it into place once it is whole.
 *
 * @example
 * ```ts
 * const files = await OpfsFiles.open();
 * await files.mkdir('/uploads');
 * await files.write('/uploads/delivery.beast2', chunks);
 * ```
 */
export class OpfsFiles implements FilesAdapter {
  /**
   * @param root - The directory paths start at
   */
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  /**
   * Opens files at the origin's OPFS root.
   *
   * @returns The adapter
   */
  static async open(): Promise<OpfsFiles> {
    return new OpfsFiles(await navigator.storage.getDirectory());
  }

  /** The directory a path's file is in, or `null` when it is not there. */
  private parentOf(names: readonly string[]): Promise<FileSystemDirectoryHandle | null> {
    return directoryAt(this.root, names.slice(0, -1).map(escapeName), false);
  }

  /** The file at a path, or `null` when there is none. */
  private async fileAt(path: string): Promise<FileSystemFileHandle | null> {
    const names = pathNames(path);
    if (names.length === 0) return null;
    return fileIn(await this.parentOf(names), escapeName(names[names.length - 1]!));
  }

  async stat(path: string): Promise<FileStat | null> {
    return await readFile(() => this.fileAt(path), (file) => Promise.resolve({ size: file.size, lastModified: file.lastModified }));
  }

  async *read(path: string): AsyncIterable<Uint8Array> {
    const handle = await this.fileAt(path);
    if (handle === null) throw new FileNotFoundError(path);
    let file: File;
    try {
      file = await handle.getFile();
    } catch (err) {
      if (isNamed(err, 'NotFoundError')) throw new FileNotFoundError(path);
      throw err;
    }
    const reader = file.stream().getReader();
    let finished = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          return;
        }
        yield value;
      }
    } finally {
      // A reader that stopped early lets the file go now, not when it is
      // collected.
      if (!finished) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  async write(path: string, data: ByteSource): Promise<number> {
    const names = pathNames(path);
    if (names.length === 0) throw new TypeError('/ is a directory, not a file');
    const parent = await this.parentOf(names);
    if (parent === null) throw new FileNotFoundError(names.length === 1 ? '/' : `/${names.slice(0, -1).join('/')}`);
    const staging = await this.root.getDirectoryHandle(STAGING, { create: true });
    return stageAndMove(staging, () => Promise.resolve(parent), escapeName(names[names.length - 1]!), data);
  }

  async remove(path: string): Promise<boolean> {
    const names = pathNames(path);
    if (names.length === 0) return false;
    const parent = await this.parentOf(names);
    const name = escapeName(names[names.length - 1]!);
    if ((await fileIn(parent, name)) === null) return false;
    try {
      await parent!.removeEntry(name);
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  }

  async mkdir(path: string): Promise<void> {
    await directoryAt(this.root, pathNames(path).map(escapeName), true);
  }

  /**
   * Removes what writes that never finished left in the root's staging
   * directory, as {@link BlobsAdapter.sweep} does for blobs.
   *
   * @param options - The age gate, and whether this is a dry run
   * @returns What it removed, or in a dry run would, and what it left
   */
  async sweep(options: { readonly minAge: number; readonly dryRun: boolean }): Promise<BlobSweepResult> {
    return sweepStaging(await directoryAt(this.root, [STAGING], false), options);
  }
}
