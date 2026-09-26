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

// `node:fs`'s promised API (the same `fs.promises` singleton object), so a call
// like `fs.rename` resolves the property at call time — this is the seam tests
// stub to simulate Windows sharing-violation errnos against the shared
// renameWithRetry. (Behaviourally identical to `fs/promises`.)
import { promises as fs } from 'node:fs';
import * as path from 'path';
import { isUuidv7 } from '../../uuid.js';

/** A SHA-256 in lowercase hex, as every object is named. */
export const HASH = /^[0-9a-f]{64}$/;

/**
 * The directory of an execution's attempts, `executions/<taskHash>/<inputsHash>`,
 * or of one attempt, `…/<executionId>`.
 *
 * @remarks
 * A package being imported, or a client, names these, so each is checked for
 * the form e3 writes before it becomes a path: a hash is a SHA-256 in
 * lowercase hex, and an attempt's id is a UUIDv7.
 *
 * @param repoPath - Path to the e3 repository
 * @param taskHash - Hash of the task object
 * @param inputsHash - Combined hash of the inputs
 * @param executionId - The attempt's id, for one attempt's directory
 * @returns The directory's path
 * @throws {Error} When a hash or the id is not of its form
 */
export function executionPath(repoPath: string, taskHash: string, inputsHash: string, executionId?: string): string {
  if (!HASH.test(taskHash)) throw new Error(`'${taskHash}' is not a task hash`);
  if (!HASH.test(inputsHash)) throw new Error(`'${inputsHash}' is not an inputs hash`);
  const inputsDir = path.join(repoPath, 'executions', taskHash, inputsHash);
  if (executionId === undefined) return inputsDir;
  if (!isUuidv7(executionId)) throw new Error(`'${executionId}' is not an execution id`);
  return path.join(inputsDir, executionId);
}

/**
 * Get the filesystem path for an object.
 *
 * @remarks
 * A client names objects by hash — a transfer's delivery, say — and so does a
 * package being imported, so the hash is checked for the form e3 writes before
 * it becomes a path.
 *
 * @param repoPath - Path to e3 repository
 * @param hash - SHA256 hash of the object
 * @returns Filesystem path: objects/<hash[0..2]>/<hash[2..]>.beast2
 * @throws {Error} When the hash is not a SHA-256 in lowercase hex
 */
export function objectPath(repoPath: string, hash: string): string {
  if (!HASH.test(hash)) throw new Error(`'${hash}' is not an object hash`);
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

/**
 * The directory transfers are staged in: dataset uploads before they become
 * objects, and package zips — an import's upload until it is imported, an
 * export's zip until it is downloaded.
 *
 * @remarks
 * Under the REPOSITORY, not `os.tmpdir()`. A staged dataset becomes an object
 * by link or rename (`ObjectStore.adoptFile`), and both are same-device
 * operations — from a temp directory on another filesystem every commit would
 * silently degrade to a whole-file copy, which for a multi-gigabyte delivery is
 * the cost the transfer exists to avoid.
 *
 * Nothing clears this directory the way the OS clears its temp directory, so
 * `repoGc` sweeps it: a `.partial` file older than gc's `minAge` is a transfer
 * that was never finished — a client that disconnected mid-upload or never
 * downloaded its export, or a server that crashed.
 *
 * @param repoPath - Path to the e3 repository
 * @returns The absolute staging directory: `<repo>/tmp/transfers`
 */
export function transferStagingDir(repoPath: string): string {
  return path.join(repoPath, 'tmp', 'transfers');
}

/**
 * The staging path for one dataset upload, in {@link transferStagingDir}.
 *
 * @param repoPath - Path to the e3 repository
 * @param id - The transfer's id
 * @returns The absolute staging path: `<repo>/tmp/transfers/<id>.beast2.partial`
 */
export function transferStagingPath(repoPath: string, id: string): string {
  return path.join(transferStagingDir(repoPath), `${id}.beast2.partial`);
}

/**
 * The staging path for one package zip, imported or exported, in
 * {@link transferStagingDir}.
 *
 * @param repoPath - Path to the e3 repository
 * @param id - The transfer's id
 * @returns The absolute staging path: `<repo>/tmp/transfers/<id>.zip.partial`
 */
export function packageStagingPath(repoPath: string, id: string): string {
  return path.join(transferStagingDir(repoPath), `${id}.zip.partial`);
}

/**
 * Errno codes Windows raises when an operation targets a path another handle has
 * open (a sharing violation), or when a just-deleted name briefly resists
 * re-creation. POSIX never raises these on rename-over-existing, so retrying is a
 * no-op there.
 *
 * The single source of truth for the transient-error policy, shared by every
 * local atomic write/rename ({@link renameWithRetry}), the dataset-ref
 * compare-and-swap, the lock service, and the dataflow state store — so the set
 * can never drift between copies (it historically had two divergent definitions).
 */
export const TRANSIENT_FS_ERROR_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST']);

/**
 * Whether a thrown error is a transient filesystem sharing-violation worth
 * retrying (or, where a retry budget is already spent, treating as a benign
 * conflict rather than a hard failure). See {@link TRANSIENT_FS_ERROR_CODES}.
 *
 * @param err - The value thrown by an `fs` operation.
 * @returns `true` if the error carries a transient errno code.
 */
export function isTransientFsError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code !== undefined && TRANSIENT_FS_ERROR_CODES.has(code);
}

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
      if (attempt >= maxAttempts - 1 || !TRANSIENT_FS_ERROR_CODES.has(code)) throw err;
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
