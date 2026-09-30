/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Taking a delivered file into the store: the intake of `delivery-intake.ts`,
 * reading the file's index on the machine it lies on, to cut it into pieces.
 *
 * @packageDocumentation
 */

import { open, type FileHandle } from 'node:fs/promises';
import type { EastTypeValue } from '@elaraai/east';
import {
  intakeDeliveryReading,
  type DeliveryFileReader,
  type DeliveryIntake,
  type DeliveryIntakeOptions,
} from './delivery-intake.js';
import type { IntakeSource, TaskRunner } from './execution/interfaces.js';
import type { StorageBackend } from './storage/interfaces.js';

/**
 * Takes a delivered collection into the store through intake units, and
 * returns the manifest it became: a delivery the store holds, or a delivered
 * file, whose index is read here to cut it into pieces.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param runner - The runner that takes each piece in
 * @param source - The delivery: a file the runner reads, or an object in the
 *   store
 * @param type - The collection type its header names, which the caller checked
 * @param sourceHash - The delivery's SHA-256, which its pieces are remembered
 *   under
 * @param size - The delivery's size in bytes
 * @param options - Progress, cancellation, and the check that the delivery is
 *   unchanged
 * @returns The manifest, and the runners that took it in
 * @throws {DeliveryRefusedError} When a runner refuses a piece, a Set's or a
 *   Dict's keys do not ascend where two pieces meet, or the delivery cannot be
 *   cut into pieces and is larger than the runner takes in whole.
 * @throws {Error} When a runner cannot take a piece in, the delivery's tail
 *   cannot be read, or `verify` throws.
 */
export async function intakeDelivery(
  storage: StorageBackend,
  repo: string,
  runner: TaskRunner,
  source: IntakeSource,
  type: EastTypeValue,
  sourceHash: string,
  size: number,
  options: DeliveryIntakeOptions = {},
): Promise<DeliveryIntake> {
  return intakeDeliveryReading(storage, repo, runner, source, type, sourceHash, size, options, readDeliveredFile);
}

/** Reads a delivered file by ranges while `use` runs, and closes it after. */
const readDeliveredFile: DeliveryFileReader = async (file, use) => {
  const handle = await open(file, 'r');
  try {
    return await use((offset, length) => readRange(handle, offset, length));
  } finally {
    await handle.close();
  }
};

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
