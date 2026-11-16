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

import { createWriteStream } from 'node:fs';
import { realpath, stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { isNotFoundError } from '../../errors.js';
import { renameWithRetry } from './localHelpers.js';

/**
 * Writes a file its caller named, replacing the file that is there: the bytes
 * are written to a new file beside it, which is renamed over it once it is
 * whole.
 *
 * @remarks
 * A file a store took in may be an object of the store by a hard link
 * (`ObjectStore.adoptFile`), and a write into it would change the bytes kept
 * under its hash. A file replaced is a new one, and the object keeps its
 * bytes: so every command writes its `-o` this way, the path of an earlier
 * delivery among them. A write that fails leaves the file as it was.
 *
 * A path that names a link is written where the link leads, the link left in
 * place, and the file written keeps the mode of the one it replaces. What is
 * no regular file — a terminal, a pipe — cannot be replaced or be a store's
 * object, and is written into.
 *
 * @param file - Where the bytes are written; its directory must exist
 * @param bytes - The bytes: whole, or as they come
 * @throws {Error} When the file cannot be written; nothing is left beside it
 * @example
 * await writeOutputFile('model.beast2', encoded);
 */
export async function writeOutputFile(file: string, bytes: Uint8Array | string | AsyncIterable<Uint8Array>): Promise<void> {
  const source = typeof bytes === 'string' || bytes instanceof Uint8Array ? [bytes] : bytes;
  let target = file;
  let mode: number | undefined;
  try {
    target = await realpath(file);
    const existing = await stat(target);
    if (!existing.isFile()) {
      await pipeline(source, createWriteStream(target));
      return;
    }
    mode = existing.mode & 0o777;
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }
  const staging = `${target}.${Math.random().toString(36).slice(2, 10)}.partial`;
  const staged = createWriteStream(staging, { flags: 'wx', ...(mode !== undefined && { mode }) });
  try {
    await pipeline(source, staged);
    await renameWithRetry(staging, target);
  } catch (err) {
    // The stream may still be opening the file when its bytes fail: it is
    // removed once the stream has closed, or the open would make it again
    if (!staged.closed) {
      await new Promise<void>((resolve) => {
        staged.once('close', resolve);
        staged.destroy();
      });
    }
    await unlink(staging).catch(() => { /* never made, or renamed already */ });
    throw err;
  }
}
