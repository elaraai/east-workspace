/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local filesystem implementation of object storage.
 *
 * Objects are stored as files in a content-addressed layout:
 * - objects/<hash[0..2]>/<hash[2..]>.beast2
 *
 * Writes are atomic using stage-and-rename pattern:
 * 1. Write to a temporary .partial file
 * 2. Rename to final destination (atomic on POSIX filesystems)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { constants, createWriteStream } from 'fs';
import { sha256File } from '@elaraai/e3';
import { ObjectNotFoundError, isNotFoundError } from '../../errors.js';
import { objectPath } from './localHelpers.js';
import type { ObjectStore } from '../interfaces.js';

/** A staging name beside the final object: same directory, so the closing
 *  rename is atomic and `gc` cleans an orphan by its `.partial` suffix. */
function stagingName(fileName: string): string {
  return `${fileName}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}.partial`;
}

/** Whether `err` is one of the errnos that mean "this file system cannot do
 *  that" rather than "the operation failed". Reflink and hard link both
 *  degrade through this set — to the next strategy, never to an error. */
function isUnsupported(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOTSUP' || code === 'EOPNOTSUPP' || code === 'EXDEV' || code === 'EINVAL' ||
    code === 'EPERM' || code === 'EACCES' || code === 'EMLINK' || code === 'ENOSYS' ||
    code === 'ENOTTY' || code === 'EISDIR';
}

/**
 * Places a file at `dest` without reading it into this process: a reflink,
 * else a hard link when the two are on one volume, else one kernel copy.
 *
 * @param file - The file to place
 * @param dest - Where to place it; a name nothing else uses
 * @param fileDev - The device the file is on
 * @param destDir - The directory `dest` is in
 */
async function placeFile(file: string, dest: string, fileDev: number, destDir: string): Promise<void> {
  // 1. Reflink: zero-copy AND copy-on-write, so the object keeps its bytes
  //    even if the delivery is later overwritten in place. FICLONE_FORCE
  //    (not FICLONE) so a file system without reflinks fails here instead of
  //    silently performing a whole copy and skipping the link below.
  try {
    await fs.copyFile(file, dest, constants.COPYFILE_FICLONE_FORCE);
    return;
  } catch (err) {
    await fs.unlink(dest).catch(() => { /* may not exist */ });
    if (!isUnsupported(err)) throw err;
  }

  // 2. Hard link, when the delivery is on the objects directory's volume.
  try {
    if ((await fs.stat(destDir)).dev === fileDev) {
      await fs.link(file, dest);
      return;
    }
  } catch (err) {
    if (!isUnsupported(err) && !isNotFoundError(err)) throw err;
  }

  // 3. One kernel copy, with a reflink where the platform offers one for free.
  await fs.copyFile(file, dest, constants.COPYFILE_FICLONE);
}

/** Move a staged file onto the content path, tolerating a concurrent writer
 *  that got there first (the store is content-addressed: identical bytes). */
async function commitStaged(stagingPath: string, filePath: string): Promise<void> {
  try {
    await fs.rename(stagingPath, filePath);
  } catch (err) {
    await fs.unlink(stagingPath).catch(() => { /* ignore cleanup errors */ });
    try {
      await fs.access(filePath);
    } catch {
      throw err;
    }
  }
}

// =============================================================================
// Hash Computation
// =============================================================================

/** Adapts a web ReadableStream to an AsyncIterable of chunks. @internal */
async function* readableStreamChunks(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  let done = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        done = true;
        break;
      }
      yield next.value;
    }
  } finally {
    // Early termination (the consumer broke or threw mid-stream): cancel
    // the source so its underlying resource (fd, socket) is released now —
    // releasing only the lock would leak it until GC finalization.
    if (!done) {
      await reader.cancel().catch(() => { /* the source may already be errored */ });
    }
    reader.releaseLock();
  }
}

// =============================================================================
// Standalone Functions (for backwards compatibility)
// =============================================================================

/**
 * Atomically write an object to the repository.
 *
 * @param repoPath - Path to e3 repository
 * @param data - Data to store
 * @returns SHA256 hash of the data
 */
export async function objectWrite(
  repoPath: string,
  data: Uint8Array
): Promise<string> {
  const { computeHash } = await import('../../objects.js');
  const extension = '.beast2';
  const hash = computeHash(data);

  // Split hash: first 2 chars as directory
  const dirName = hash.slice(0, 2);
  const fileName = hash.slice(2) + extension;

  const dirPath = path.join(repoPath, 'objects', dirName);
  const filePath = path.join(dirPath, fileName);

  // Check if already exists
  try {
    await fs.access(filePath);
    return hash; // Already exists
  } catch {
    // Doesn't exist, continue
  }

  // Create directory if needed
  await fs.mkdir(dirPath, { recursive: true });

  // Write atomically: stage in same directory (same filesystem) + rename
  // Staging files use .partial extension; gc can clean up any orphaned ones
  // Use random suffix to avoid collisions with concurrent writes
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  const stagingPath = path.join(dirPath, `${fileName}.${Date.now()}.${randomSuffix}.partial`);
  await fs.writeFile(stagingPath, data);

  try {
    await fs.rename(stagingPath, filePath);
  } catch (err) {
    // If rename fails because target exists (concurrent write won), that's fine
    // Clean up our staging file
    try {
      await fs.unlink(stagingPath);
    } catch {
      // Ignore cleanup errors
    }
    // Verify the file exists (another writer should have created it)
    try {
      await fs.access(filePath);
    } catch {
      // File doesn't exist and rename failed - re-throw original error
      throw err;
    }
  }

  return hash;
}

/**
 * Atomically write a stream of chunks to the repository at bounded memory.
 *
 * Chunks are hashed incrementally while they stream to a staging file under
 * `objects/` (the same filesystem as the final content path, so the closing
 * rename stays atomic) — the content path is only known once the digest
 * names it, so unlike {@link objectWrite} the staging file cannot start in
 * its final directory. Peak memory is one chunk, never the object; this is
 * what lets the partition executor splice larger-than-memory outputs.
 * Orphaned staging files carry the `.partial` suffix gc already cleans.
 *
 * @param repoPath - Path to e3 repository
 * @param stream - Chunks to store
 * @returns SHA256 hash of the data
 */
export async function objectWriteStreamIterable(
  repoPath: string,
  stream: AsyncIterable<Uint8Array>
): Promise<string> {
  const extension = '.beast2';
  const objectsDir = path.join(repoPath, 'objects');
  await fs.mkdir(objectsDir, { recursive: true });

  const randomSuffix = Math.random().toString(36).slice(2, 10);
  const stagingPath = path.join(objectsDir, `stage.${Date.now()}.${randomSuffix}.partial`);

  const hasher = crypto.createHash('sha256');
  async function* hashChunks(): AsyncIterable<Uint8Array> {
    for await (const chunk of stream) {
      hasher.update(chunk);
      yield chunk;
    }
  }
  try {
    await pipeline(Readable.from(hashChunks()), createWriteStream(stagingPath));
  } catch (err) {
    try {
      await fs.unlink(stagingPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
  const hash = hasher.digest('hex');

  const dirPath = path.join(objectsDir, hash.slice(0, 2));
  const filePath = path.join(dirPath, hash.slice(2) + extension);

  // Deduplicate: the object may already exist (content-addressed store).
  try {
    await fs.access(filePath);
    await fs.unlink(stagingPath);
    return hash;
  } catch {
    // Doesn't exist, continue
  }

  await fs.mkdir(dirPath, { recursive: true });
  try {
    await fs.rename(stagingPath, filePath);
  } catch (err) {
    // If rename fails because target exists (concurrent write won), that's fine
    // Clean up our staging file
    try {
      await fs.unlink(stagingPath);
    } catch {
      // Ignore cleanup errors
    }
    // Verify the file exists (another writer should have created it)
    try {
      await fs.access(filePath);
    } catch {
      // File doesn't exist and rename failed - re-throw original error
      throw err;
    }
  }

  return hash;
}

/**
 * Atomically write a stream to the repository at bounded memory.
 *
 * @param repoPath - Path to e3 repository
 * @param stream - Stream to store
 * @returns SHA256 hash of the data
 */
export async function objectWriteStream(
  repoPath: string,
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  return objectWriteStreamIterable(repoPath, readableStreamChunks(stream));
}

/**
 * Read an object from the repository.
 *
 * @param repoPath - Path to e3 repository
 * @param hash - SHA256 hash of the object
 * @returns Object data
 * @throws {ObjectNotFoundError} If object not found
 */
export async function objectRead(
  repoPath: string,
  hash: string
): Promise<Uint8Array> {
  const filePath = objectPath(repoPath, hash);

  try {
    return await fs.readFile(filePath);
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new ObjectNotFoundError(hash);
    }
    throw err;
  }
}

/**
 * Check if an object exists in the repository.
 *
 * @param repoPath - Path to e3 repository
 * @param hash - SHA256 hash of the object
 * @returns true if object exists
 */
export async function objectExists(
  repoPath: string,
  hash: string
): Promise<boolean> {
  const filePath = objectPath(repoPath, hash);

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// ObjectStore Interface Implementation
// =============================================================================

/**
 * Local filesystem implementation of ObjectStore.
 *
 * The `repo` parameter is the path to the e3 repository directory.
 */
export class LocalObjectStore implements ObjectStore {
  async write(repo: string, data: Uint8Array): Promise<string> {
    return objectWrite(repo, data);
  }

  async writeStream(repo: string, stream: AsyncIterable<Uint8Array>): Promise<string> {
    return objectWriteStreamIterable(repo, stream);
  }

  async read(repo: string, hash: string): Promise<Uint8Array> {
    return objectRead(repo, hash);
  }

  async readRange(repo: string, hash: string, offset: number, length: number): Promise<Uint8Array> {
    const filePath = objectPath(repo, hash);
    let handle;
    try {
      handle = await fs.open(filePath, 'r');
    } catch (err) {
      if (isNotFoundError(err)) {
        throw new ObjectNotFoundError(hash);
      }
      throw err;
    }
    try {
      const buffer = new Uint8Array(length);
      let read = 0;
      // A positional read may return short even mid-file — loop until the
      // range is filled or the file ends.
      while (read < length) {
        const { bytesRead } = await handle.read(buffer, read, length - read, offset + read);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      return read === length ? buffer : buffer.subarray(0, read);
    } finally {
      await handle.close();
    }
  }

  /**
   * Adopt a file into the store by hash — by reflink, hard link, or one
   * kernel copy, never through this process's heap.
   *
   * @remarks
   * The strategies are tried in order of what they cost the delivery: a
   * reflink shares storage copy-on-write, a hard link shares it outright
   * (see the aliasing note on `ObjectStore.adoptFile`), and a `copyFile`
   * falls back to the kernel's own copy. The delivered file is only ever
   * opened for reading.
   *
   * Every strategy places the file under a staging name, and only a staged
   * file that hashes to the object's hash is renamed into place. The path
   * names whatever file is there when it is placed, so a delivery replaced
   * since the caller hashed it is refused rather than stored under the old
   * bytes' hash — at the cost of one read of a file the store did not hold.
   *
   * @param repo - Path to the e3 repository
   * @param file - Path to the file to adopt
   * @param hash - The file's SHA256 when already known; else read here
   * @returns The object's hash and size
   * @throws {Error} When the file placed does not hash to `hash`
   */
  async adoptFile(repo: string, file: string, hash?: string): Promise<{ hash: string; size: number }> {
    const stats = await fs.stat(file);
    if (!stats.isFile()) throw new Error(`Not a file: ${file}`);
    if (hash !== undefined && await objectExists(repo, hash)) return { hash, size: (await this.stat(repo, hash)).size };

    // Staged at the root of objects/, as a streamed write is: the object's
    // directory is known only once the placed file is hashed, and the closing
    // rename stays on one file system.
    const objectsDir = path.join(repo, 'objects');
    await fs.mkdir(objectsDir, { recursive: true });
    const stagingPath = path.join(objectsDir, stagingName('stage'));
    try {
      await placeFile(file, stagingPath, stats.dev, objectsDir);
      const { size } = await fs.stat(stagingPath);
      const digest = await sha256File(stagingPath);
      if (hash !== undefined && digest !== hash) {
        throw new Error(`${file} changed while it was adopted: it holds ${digest}, not the ${hash} it was hashed as`);
      }
      const filePath = objectPath(repo, digest);
      if (await objectExists(repo, digest)) {
        await fs.unlink(stagingPath);
        return { hash: digest, size };
      }
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await commitStaged(stagingPath, filePath);
      return { hash: digest, size };
    } catch (err) {
      await fs.unlink(stagingPath).catch(() => { /* committed, or never created */ });
      throw err;
    }
  }

  /**
   * Place an object's bytes at `destPath` by hard link or kernel copy.
   *
   * @param repo - Path to the e3 repository
   * @param hash - SHA256 hash of the object
   * @param destPath - Where to place the bytes; its directory must exist
   * @param options - `link: false` forbids sharing storage with the object
   * @throws {ObjectNotFoundError} If the object does not exist
   */
  async materialize(repo: string, hash: string, destPath: string, options?: { link?: boolean }): Promise<void> {
    const filePath = objectPath(repo, hash);
    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch (err) {
      if (isNotFoundError(err)) throw new ObjectNotFoundError(hash);
      throw err;
    }

    if (options?.link !== false) {
      try {
        const destStats = await fs.stat(path.dirname(destPath));
        if (destStats.dev === stats.dev) {
          try {
            await fs.link(filePath, destPath);
            return;
          } catch (err) {
            // Windows volumes and some network mounts refuse links; a copy
            // is always available.
            if (!isUnsupported(err)) throw err;
          }
        }
      } catch (err) {
        if (!isUnsupported(err) && !isNotFoundError(err)) throw err;
      }
    }

    await fs.copyFile(filePath, destPath, constants.COPYFILE_FICLONE);
  }

  async exists(repo: string, hash: string): Promise<boolean> {
    return objectExists(repo, hash);
  }

  async stat(repo: string, hash: string): Promise<{ size: number }> {
    const filePath = objectPath(repo, hash);
    try {
      const stats = await fs.stat(filePath);
      return { size: stats.size };
    } catch (err) {
      if (isNotFoundError(err)) {
        throw new ObjectNotFoundError(hash);
      }
      throw err;
    }
  }

  async list(repo: string): Promise<string[]> {
    const objectsDir = path.join(repo, 'objects');
    const hashes: string[] = [];

    try {
      const prefixDirs = await fs.readdir(objectsDir);

      for (const prefix of prefixDirs) {
        if (!/^[a-f0-9]{2}$/.test(prefix)) continue;

        const prefixPath = path.join(objectsDir, prefix);
        const stat = await fs.stat(prefixPath);
        if (!stat.isDirectory()) continue;

        const files = await fs.readdir(prefixPath);
        for (const file of files) {
          if (file.endsWith('.beast2') && !file.includes('.partial')) {
            // Reconstruct full hash: prefix + filename without extension
            const hash = prefix + file.slice(0, -7);
            hashes.push(hash);
          }
        }
      }
    } catch (err) {
      // Only suppress ENOENT - directory may not exist yet
      if (!isNotFoundError(err)) {
        throw err;
      }
    }

    return hashes;
  }

  async count(repo: string): Promise<number> {
    const objectsDir = path.join(repo, 'objects');
    let count = 0;

    try {
      const prefixDirs = await fs.readdir(objectsDir);

      for (const prefix of prefixDirs) {
        if (!/^[a-f0-9]{2}$/.test(prefix)) continue;

        const prefixPath = path.join(objectsDir, prefix);
        const files = await fs.readdir(prefixPath);
        for (const file of files) {
          if (file.endsWith('.beast2') && !file.includes('.partial')) {
            count++;
          }
        }
      }
    } catch (err) {
      if (!isNotFoundError(err)) {
        throw err;
      }
    }

    return count;
  }
}
