/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A file a command writes where its caller said, on the machine that runs
 * the command: replaced, never written into.
 *
 * @packageDocumentation
 */

import { constants, type Stats } from 'node:fs';
import { access, lstat, open, readlink, realpath, stat, type FileHandle } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isNotFoundError } from '../../errors.js';
import { replaceFileWith } from './localHelpers.js';

/** How {@link writeOutputFile} writes. */
export interface WriteOutputFileOptions {
  /** Stops the write: the file is left as it was, and nothing beside it. */
  readonly signal?: AbortSignal;
}

/** The most links followed from a path nothing is at yet: the kernel's own
 *  count. */
const MAX_LINKS = 40;

/** What `stat` or `lstat` finds at a path, or undefined where nothing is. */
async function found(looked: Promise<Stats>): Promise<Stats | undefined> {
  try {
    return await looked;
  } catch (err) {
    if (isNotFoundError(err)) return undefined;
    throw err;
  }
}

/**
 * Where a path nothing is at yet leads: the path itself, or, through each
 * link that leads nowhere yet, the file the last of them names.
 */
async function leadsTo(file: string): Promise<string> {
  let target = file;
  for (let links = 0; ; links++) {
    const entry = await found(lstat(target));
    if (entry === undefined || !entry.isSymbolicLink()) return target;
    if (links === MAX_LINKS) throw new Error(`${file} leads through more than ${MAX_LINKS} links`);
    target = resolve(dirname(target), await readlink(target));
  }
}

/** Whether a change of owner failed because it is not this process's to
 *  make, or its file system keeps none. */
function ownerNotGiven(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'EPERM' || code === 'EINVAL' || code === 'ENOTSUP' || code === 'ENOSYS';
}

/**
 * Gives a new file the mode of the one it replaces, and its owner and group
 * where this process may give them: the owner is root's to give, the group a
 * member's. What it may not give stays this process's own.
 */
async function takeAfter(handle: FileHandle, existing: Stats): Promise<void> {
  const made = await handle.stat();
  if (made.uid !== existing.uid || made.gid !== existing.gid) {
    try {
      await handle.chown(existing.uid, existing.gid);
    } catch (err) {
      if (!ownerNotGiven(err)) throw err;
      if (made.gid !== existing.gid) {
        await handle.chown(made.uid, existing.gid).catch((again: unknown) => {
          if (!ownerNotGiven(again)) throw again;
        });
      }
    }
  }
  // After the owner, whose change clears a mode's special bits; and by the
  // open file, so the process's mask takes nothing from it
  await handle.chmod(existing.mode & 0o777);
}

/** Whether this user may make a file in a directory, as a replacement is made
 *  beside the file it replaces. */
async function mayMakeIn(dir: string): Promise<boolean> {
  try {
    await access(dir, constants.W_OK | constants.X_OK);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === 'EACCES' || code === 'EPERM') return false;
    throw err;
  }
}

/**
 * Writes bytes to an open file from where it stands, whole or as they come,
 * until its signal stops it.
 */
async function writeBytes(handle: FileHandle, bytes: Uint8Array | string | AsyncIterable<Uint8Array>, signal: AbortSignal | undefined): Promise<void> {
  signal?.throwIfAborted();
  if (typeof bytes === 'string' || bytes instanceof Uint8Array) {
    await handle.writeFile(bytes);
    return;
  }
  for await (const part of bytes) {
    signal?.throwIfAborted();
    await handle.writeFile(part);
  }
}

/** Writes bytes into what a path names, opened for writing as any tool opens
 *  it: a file is emptied first. */
async function writeInto(path: string, bytes: Uint8Array | string | AsyncIterable<Uint8Array>, signal: AbortSignal | undefined): Promise<void> {
  signal?.throwIfAborted();
  const handle = await open(path, 'w');
  try {
    await writeBytes(handle, bytes, signal);
  } finally {
    await handle.close();
  }
}

/**
 * Writes a file its caller named, replacing the file that is there: the bytes
 * are written to a new file beside it, which is renamed over it once it is
 * whole.
 *
 * @remarks
 * A write that fails, or that its signal stops, leaves the file as it was. And
 * a file may be an object of a store by another name: one an earlier e3 took
 * in by a hard link, or an object's own path in a repository. A write into it
 * would change the bytes kept under its hash; a file replaced is a new one,
 * and the object keeps its bytes.
 *
 * What a write into the file would do, replacing it does:
 * - a path that names a link is written where the link leads, the link left
 *   in place, one that leads nowhere yet among them;
 * - the file written keeps the mode of the one it replaces, and its owner and
 *   group where this process may give them, though not its ACLs or extended
 *   attributes;
 * - a file its user may not write is refused, as a write into it is;
 * - what is no regular file — a terminal, a pipe, `/dev/stdout` on either —
 *   cannot be replaced or be a store's object, and is opened by the path
 *   given and written into, as far as its kind can be opened by a path.
 *
 * In a directory its user may not write, where nothing can be made beside the
 * file, a file nothing else links to is written into, as any tool writes it,
 * so a write that fails or is stopped leaves it part written; a file another
 * name links to is refused, and a file that is not there cannot be made.
 *
 * @param file - Where the bytes are written; its directory must exist
 * @param bytes - The bytes: whole, or as they come
 * @param options - The signal that stops the write
 * @throws {Error} When the file cannot be written, naming it; nothing is left
 *   beside it
 * @throws The signal's reason, once it has aborted
 * @example
 * await writeOutputFile('model.beast2', encoded);
 */
export async function writeOutputFile(
  file: string,
  bytes: Uint8Array | string | AsyncIterable<Uint8Array>,
  options: WriteOutputFileOptions = {},
): Promise<void> {
  const { signal } = options;
  // As the kernel leads there: /dev/stdout on a pipe names no path of its own
  const existing = await found(stat(file));
  if (existing !== undefined && !existing.isFile()) {
    await writeInto(file, bytes, signal);
    return;
  }
  const target = existing === undefined ? await leadsTo(file) : await realpath(file);
  if (existing !== undefined) await access(target, constants.W_OK);
  // Named as the file system names it, whether the file is there or not: a
  // directory reached through a link (macOS's /var) by its own path
  const directory = await realpath(dirname(target));
  if (!(await mayMakeIn(directory))) {
    const where = `its directory ${directory} is not this user's to write`;
    if (existing === undefined) throw new Error(`Cannot write ${file}: ${where}`);
    if (existing.nlink > 1) {
      throw new Error(`Cannot write ${file}: ${where}, so it would be written into, and another name links to it, which would change too`);
    }
    await writeInto(target, bytes, signal);
    return;
  }
  await replaceFileWith(target, async (stagingPath) => {
    const handle = await open(stagingPath, 'wx');
    try {
      if (existing !== undefined) await takeAfter(handle, existing);
      await writeBytes(handle, bytes, signal);
    } finally {
      await handle.close();
    }
    // Stopped once its bytes were whole, the file is still left as it was
    signal?.throwIfAborted();
  });
}
