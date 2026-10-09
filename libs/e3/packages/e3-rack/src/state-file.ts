/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { chmod, readFile } from 'node:fs/promises';
import { BlobType, IntegerType, StringType, StructType, decodeBeast2For, encodeBeast2For, equalFor, printFor } from '@elaraai/east';
import { atomicWriteFile } from '@elaraai/e3-core';
import { E3_RACK_VERSION } from './version.js';

// Hub state is outside a repository and has its own explicit format. Its
// envelope remains readable before decoding the inner value, so a future
// release can refuse or migrate a form without guessing from corrupt bytes.
const Envelope = StructType({ release: StringType, format: IntegerType, value: BlobType });
const encode = encodeBeast2For(Envelope);
const decode = decodeBeast2For(Envelope);

/** Serializes a store's mutations; failed mutations do not poison the queue. @internal */
export class MutationQueue {
  private tail: Promise<unknown> = Promise.resolve();

  /** Runs the operation after every preceding operation has settled. */
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** Waits for all operations already queued. */
  async idle(): Promise<void> { await this.tail; }
}

/** Reads a hub state payload, refusing an unknown format. @internal */
export async function readStateFile(file: string): Promise<Uint8Array | null> {
  let bytes: Uint8Array;
  try { bytes = await readFile(file); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const envelope = decode(bytes);
  if (!equalFor(IntegerType)(envelope.format, 1n)) throw new Error(`${file} uses rack state format ${printFor(IntegerType)(envelope.format)}, written by e3 ${envelope.release}; update e3`);
  return envelope.value;
}

/** Atomically replaces a hub state value inside its private home. @internal */
export async function writeStateFile(file: string, value: Uint8Array): Promise<void> {
  await atomicWriteFile(file, encode({ release: E3_RACK_VERSION, format: 1n, value }));
  if (process.platform !== 'win32') await chmod(file, 0o600);
}
