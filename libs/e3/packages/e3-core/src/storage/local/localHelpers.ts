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
import { promises as fs, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import * as path from 'path';
import { checkHash, checkId, isNotFoundError } from '../../errors.js';
import { isUuidv7 } from '../../uuid.js';

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
 * @throws {InvalidNameError} When a hash or the id is not of its form
 */
export function executionPath(repoPath: string, taskHash: string, inputsHash: string, executionId?: string): string {
  checkHash('task hash', taskHash);
  checkHash('inputs hash', inputsHash);
  const inputsDir = path.join(repoPath, 'executions', taskHash, inputsHash);
  if (executionId === undefined) return inputsDir;
  checkId('execution id', executionId);
  return path.join(inputsDir, executionId);
}

/**
 * The index of a task's attempts recorded running, `running/<taskHash>`, or an
 * attempt's place in it, `…/<inputsHash>.<executionId>.beast2`: an East
 * `null`, there while the attempt is recorded running.
 *
 * @remarks
 * A task's places are files of one directory, never one per inputs, so the
 * index costs a listing of what runs. The directory is left once it is empty:
 * a split task's units come and go in it side by side, and removing it could
 * race one's write into it.
 *
 * @param repoPath - Path to the e3 repository
 * @param taskHash - Hash of the task object
 * @param inputsHash - Combined hash of the attempt's inputs, for its place
 * @param executionId - The attempt's id, for its place
 * @returns The path
 * @throws {InvalidNameError} When a hash or the id is not of its form
 */
export function runningPath(repoPath: string, taskHash: string, inputsHash?: string, executionId?: string): string {
  checkHash('task hash', taskHash);
  const taskDir = path.join(repoPath, 'running', taskHash);
  if (inputsHash === undefined || executionId === undefined) return taskDir;
  checkHash('inputs hash', inputsHash);
  checkId('execution id', executionId);
  return path.join(taskDir, `${inputsHash}.${executionId}.beast2`);
}

/**
 * The attempt a file of a task's index of running attempts is the place of,
 * by its name ({@link runningPath}), or null for a file that is none: a write
 * in flight's staging file, say.
 *
 * @param name - The file's name
 * @returns The attempt's inputs and id, or null
 */
export function runningAttemptOf(name: string): { inputsHash: string; executionId: string } | null {
  const place = /^([0-9a-f]{64})\.([0-9a-f-]{36})\.beast2$/.exec(name);
  if (place === null || !isUuidv7(place[2]!)) return null;
  return { inputsHash: place[1]!, executionId: place[2]! };
}

/**
 * The index of a task's runs — its own attempts, never a split task's units —
 * `runs/<taskHash>`, or a run's place in it, `…/<executionId>.<inputsHash>.beast2`:
 * an East `null`, named by the attempt's id first, so the index lists in the
 * order the runs began.
 *
 * @remarks
 * The directory is left once it is empty, as the index of running attempts'
 * is: removing it could race a run's write into it.
 *
 * @param repoPath - Path to the e3 repository
 * @param taskHash - Hash of the task object
 * @param executionId - The run's id, for its place
 * @param inputsHash - Combined hash of the run's inputs, for its place
 * @returns The path
 * @throws {InvalidNameError} When a hash or the id is not of its form
 */
export function runsPath(repoPath: string, taskHash: string, executionId?: string, inputsHash?: string): string {
  checkHash('task hash', taskHash);
  const taskDir = path.join(repoPath, 'runs', taskHash);
  if (executionId === undefined || inputsHash === undefined) return taskDir;
  checkId('execution id', executionId);
  checkHash('inputs hash', inputsHash);
  return path.join(taskDir, `${executionId}.${inputsHash}.beast2`);
}

/**
 * The run a file of a task's index of runs is the place of, by its name
 * ({@link runsPath}), or null for a file that is none: a write in flight's
 * staging file, say.
 *
 * @param name - The file's name
 * @returns The run's id and inputs, or null
 */
export function runOf(name: string): { executionId: string; inputsHash: string } | null {
  const place = /^([0-9a-f-]{36})\.([0-9a-f]{64})\.beast2$/.exec(name);
  if (place === null || !isUuidv7(place[1]!)) return null;
  return { executionId: place[1]!, inputsHash: place[2]! };
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
 * @throws {InvalidNameError} When the hash is not a SHA-256 in lowercase hex
 */
export function objectPath(repoPath: string, hash: string): string {
  checkHash('object hash', hash);
  const dirName = hash.slice(0, 2);
  const fileName = hash.slice(2) + '.beast2';
  return path.join(repoPath, 'objects', dirName, fileName);
}

/**
 * The directory gc keeps its own records in: `<repo>/gc`, beside the record
 * trees. It holds the unreachable notes of a sweep beside running work, and
 * the parts of a gc run in steps.
 *
 * @param repoPath - Path to the e3 repository
 * @returns The directory's path
 */
export function gcDir(repoPath: string): string {
  return path.join(repoPath, 'gc');
}

/**
 * The file that notes when a sweep beside running work first saw an object
 * unreachable: `<repo>/gc/unreachable/<hash[0..2]>/<hash[2..]>`, an empty
 * file whose modification time is the note's.
 *
 * @remarks
 * A note is a file of its own, never the object's: a write or a touch of the
 * object removes it, and the object file — which an adopted delivery may
 * share by a hard link — is never modified.
 *
 * @param repoPath - Path to the e3 repository
 * @param hash - SHA256 hash of the object
 * @returns The note's path
 * @throws {InvalidNameError} When the hash is not a SHA-256 in lowercase hex
 */
export function unreachableNotePath(repoPath: string, hash: string): string {
  checkHash('object hash', hash);
  return path.join(gcDir(repoPath), 'unreachable', hash.slice(0, 2), hash.slice(2));
}

/**
 * The directory of a gc run in steps, `<repo>/gc/runs/<run>`, or of one of
 * its parts, `…/<name>.beast2`.
 *
 * @param repoPath - Path to the e3 repository
 * @param run - The run's id, a UUIDv7
 * @param name - The part's name: lowercase letters, digits and dots
 * @returns The path
 * @throws {InvalidNameError} When the run is no UUIDv7
 * @throws {Error} When the part's name is not of its form
 */
export function gcRunPath(repoPath: string, run: string, name?: string): string {
  checkId('gc run id', run);
  const runDir = path.join(gcDir(repoPath), 'runs', run);
  if (name === undefined) return runDir;
  if (!/^[a-z0-9][a-z0-9.]*$/.test(name)) throw new Error(`'${name}' is not the name of a gc run's part`);
  return path.join(runDir, `${name}.beast2`);
}

/**
 * The time an object's unreachable note stands at, to the millisecond.
 *
 * @param repoPath - Path to the e3 repository
 * @param hash - SHA256 hash of the object
 * @returns The note's time (epoch ms), or null when no note stands
 */
export async function unreachableNoteTime(repoPath: string, hash: string): Promise<number | null> {
  try {
    return Math.round((await fs.stat(unreachableNotePath(repoPath, hash))).mtimeMs);
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

/**
 * Notes that a sweep saw an object unreachable at `at`, unless a note stands
 * already, whose time is kept.
 *
 * @param repoPath - Path to the e3 repository
 * @param hash - SHA256 hash of the object
 * @param at - When the sweep saw it (epoch ms)
 * @returns The time the note stands at
 */
export async function noteUnreachable(repoPath: string, hash: string, at: number): Promise<number> {
  const standing = await unreachableNoteTime(repoPath, hash);
  if (standing !== null) return standing;
  const note = unreachableNotePath(repoPath, hash);
  await fs.mkdir(path.dirname(note), { recursive: true });
  try {
    // Created only where none stands, so the first sweep's time is kept
    await (await fs.open(note, 'wx')).close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    return (await unreachableNoteTime(repoPath, hash)) ?? at;
  }
  const time = new Date(at);
  try {
    await fs.utimes(note, time, time);
  } catch (err) {
    // A write or a touch of the object has cleared it already
    if (isNotFoundError(err)) return at;
    throw err;
  }
  return (await unreachableNoteTime(repoPath, hash)) ?? at;
}

/**
 * Clears an object's unreachable note, if one stands: what every write and
 * touch of the object does before it looks for the object, so a sweep beside
 * running work never deletes an object this process is about to root.
 *
 * @param repoPath - Path to the e3 repository
 * @param hash - SHA256 hash of the object
 */
export async function clearUnreachableNote(repoPath: string, hash: string): Promise<void> {
  try {
    await fs.unlink(unreachableNotePath(repoPath, hash));
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }
}

/**
 * The suffix of an object a sweep beside running work has moved aside to
 * delete it: `objects/<hash[0..2]>/<hash[2..]>.beast2.<time>.<random>.gc.partial`.
 */
export const GC_ASIDE_SUFFIX = '.gc.partial';

/**
 * Puts an object a sweep moved aside back in its place: a delete a
 * re-reference raced, or one a crash cut short. A copy written to the place
 * since holds the same bytes, and is kept.
 *
 * @param aside - Where the sweep moved the object
 * @param file - The object's path
 * @throws When the object can be put back in neither way
 */
export async function restoreAside(aside: string, file: string): Promise<void> {
  try {
    await renameWithRetry(aside, file);
  } catch (err) {
    try {
      await fs.access(file);
    } catch {
      throw err;
    }
    await fs.unlink(aside).catch(() => { /* swept with the staging files */ });
  }
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
 * stages from a crashed writer are swept by gc, in the local `RepoStore`'s
 * sweep (`sweep.ts`).
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

/**
 * {@link atomicWriteFile} for a caller that cannot wait on a promise: the
 * bytes are staged in a unique sibling `.partial` file and renamed over the
 * destination, a Windows sharing violation retried as {@link renameWithRetry}
 * retries it, the thread sleeping between attempts.
 *
 * @param filePath - Destination path to atomically (over)write, in a
 *   directory that exists
 * @param data - Bytes to write
 */
export function atomicWriteFileSync(filePath: string, data: Uint8Array): void {
  const stagingPath = `${filePath}.${Math.random().toString(36).slice(2, 10)}.partial`;
  writeFileSync(stagingPath, data);
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(stagingPath, filePath);
        return;
      } catch (err) {
        if (attempt >= 24 || !isTransientFsError(err)) throw err;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(2 ** attempt, 100));
      }
    }
  } catch (err) {
    try { unlinkSync(stagingPath); } catch { /* ignore cleanup failure */ }
    throw err;
  }
}
