/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local filesystem helpers for e3 object storage.
 *
 * These functions are local-specific utilities for working with
 * the filesystem-based object store. They are used by LocalObjectStore
 * and other local storage components.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Get the filesystem path for an object.
 *
 * @param repoPath - Path to e3 repository
 * @param hash - SHA256 hash of the object
 * @returns Filesystem path: objects/<hash[0..2]>/<hash[2..]>.beast2
 */
export function objectPath(repoPath: string, hash: string): string {
  const dirName = hash.slice(0, 2);
  const fileName = hash.slice(2) + '.beast2';
  return path.join(repoPath, 'objects', dirName, fileName);
}

/**
 * Get the minimum unambiguous prefix length for an object hash.
 *
 * Scans the object store to find the shortest prefix of the given hash
 * that uniquely identifies it among all stored objects.
 *
 * @param repoPath - Path to e3 repository
 * @param hash - Full SHA256 hash of the object
 * @param minLength - Minimum prefix length to return (default: 4)
 * @returns Minimum unambiguous prefix length
 */
export async function objectAbbrev(
  repoPath: string,
  hash: string,
  minLength: number = 4
): Promise<number> {
  const objectsDir = path.join(repoPath, 'objects');
  const targetPrefix = hash.slice(0, 2);

  // Collect all hashes that share the same 2-char prefix directory
  const hashes: string[] = [];

  try {
    const dirPath = path.join(objectsDir, targetPrefix);
    const entries = await fs.readdir(dirPath);

    for (const entry of entries) {
      if (entry.endsWith('.beast2') && !entry.includes('.partial')) {
        // Reconstruct full hash: dir prefix + filename without extension
        const fullHash = targetPrefix + entry.slice(0, -7); // remove '.beast2'
        hashes.push(fullHash);
      }
    }
  } catch {
    // Directory doesn't exist - hash is unique at minimum length
    return minLength;
  }

  // Find minimum length that disambiguates from all other hashes
  let length = minLength;

  while (length < hash.length) {
    const prefix = hash.slice(0, length);
    const conflicts = hashes.filter(
      (h) => h !== hash && h.startsWith(prefix)
    );

    if (conflicts.length === 0) {
      return length;
    }

    length++;
  }

  return hash.length;
}

// Transient Windows errors raised when renaming over a file another handle
// currently has open (sharing violation), or when the destination briefly
// resists replacement. POSIX never raises these on rename-over-existing.
const WIN_RENAME_RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST']);

/**
 * Rename `from` over `to`, retrying on Windows sharing-violation errors.
 *
 * POSIX rename-over-existing is atomic even while another process holds the
 * destination open for read, so the first attempt always succeeds there.
 * Windows refuses the rename (EPERM/EACCES/EBUSY) while a reader holds the
 * destination open — Node/libuv never opens files with FILE_SHARE_DELETE and
 * exposes no way to set the share mode — so, like graceful-fs / npm, we retry
 * with a bounded exponential backoff. A realistic reader holds the handle only
 * for the brief duration of its read, so the lock clears almost immediately
 * (usually the first or second attempt); the attempt count is generous so that
 * even bursty concurrent reads on a loaded Windows host clear well before the
 * bound, while a genuine permission error still surfaces promptly. A no-op on
 * POSIX, where the first attempt always succeeds.
 *
 * @param from - Staging path to rename from
 * @param to - Destination path to atomically replace
 * @param maxAttempts - Upper bound on retries (≈1.9s total over the default 25)
 */
export async function renameWithRetry(from: string, to: string, maxAttempts = 25): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (attempt >= maxAttempts - 1 || !WIN_RENAME_RETRYABLE.has(code)) throw err;
      // 1, 2, 4, … ms, capped at 100ms (≈1.9s total over 25 attempts).
      await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt, 100)));
    }
  }
}

/**
 * Atomically (over)write a file: stage the bytes in a unique sibling
 * `.partial` file, then rename it over the destination.
 *
 * A bare `fs.writeFile` to an existing path opens it `O_TRUNC` — the file is
 * momentarily 0 bytes, so a concurrent reader can observe an empty/truncated
 * file and fail to decode it (e.g. "Data too short for Beast2 format: 0 bytes").
 * The stage-and-rename makes the replacement atomic: a reader sees either the
 * old complete file or the new complete file, never a partial one. Use this for
 * every mutable ref/state file a reader may read while a writer overwrites it
 * (execution status, dataflow runs, workspace state, dataset refs).
 *
 * Staging files use a `.partial` extension so the directory-listing helpers
 * (which filter `.partial`) never mistake them for real entries, and orphaned
 * stages from a crashed writer are swept by `gc` (see cleanupPartials).
 *
 * @param filePath - Destination path to atomically (over)write
 * @param data - Bytes (or string) to write
 */
export async function atomicWriteFile(filePath: string, data: Uint8Array | string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // A short random suffix so concurrent writers to the same destination never
  // collide on the staging path. Kept short (no timestamp) to minimise the
  // extra length added over the destination — the staging path is always
  // longer than the final path, which matters near the Windows MAX_PATH limit.
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  const stagingPath = `${filePath}.${randomSuffix}.partial`;
  await fs.writeFile(stagingPath, data);
  try {
    await renameWithRetry(stagingPath, filePath);
  } catch (err) {
    try { await fs.unlink(stagingPath); } catch { /* ignore cleanup failure */ }
    throw err;
  }
}
