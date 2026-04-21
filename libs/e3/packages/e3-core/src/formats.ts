/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  encodeBeast2For,
  decodeBeast2For,
  parseFor,
  printFor,
  fromJSONFor,
  encodeEastIR,
  decodeEastIR,
  decodeAsyncEastIR,
  EastIR,
  AsyncEastIR,
  IRType,
  type IR,
} from '@elaraai/east';

/**
 * Load IR from a file (.json, .east, or .beast2)
 */
export async function loadIR(filePath: string): Promise<IR> {
  const ext = filePath.slice(filePath.lastIndexOf('.'));

  if (ext === '.json') {
    // JSON format
    const content = await fs.readFile(filePath, 'utf-8');
    const jsonValue = JSON.parse(content);
    const fromJSON = fromJSONFor(IRType);
    return fromJSON(jsonValue) as IR;
  } else if (ext === '.east') {
    // .east format
    const content = await fs.readFile(filePath, 'utf-8');
    const parser = parseFor(IRType);
    const result = parser(content);

    if (!result.success) {
      throw new Error(`Failed to parse .east file: ${result.error}`);
    }

    return result.value as IR;
  } else if (ext === '.beast2') {
    // .beast2 format
    const data = await fs.readFile(filePath);
    const decoder = decodeBeast2For(IRType);
    return decoder(data) as IR;
  } else {
    throw new Error(`Unsupported file format: ${ext} (expected .json, .east, or .beast2)`);
  }
}

/**
 * Encode IR to Beast2 format.
 *
 * NOTE: this is a "raw IR" path and does NOT include a source map in the
 * blob. For program serialization use `eastIRToBeast2` or `encodeEastIR`
 * which preserve the source map end-to-end.
 */
export function irToBeast2(ir: IR): Uint8Array {
  const encoder = encodeBeast2For(IRType);
  return encoder(ir);
}

/**
 * Encode an EastIR bundle (IR + source map) to Beast2 format.
 *
 * Use this when serializing a program so that downstream CLIs can resolve
 * loc_ids back to source locations on error.
 */
export function eastIRToBeast2(eastIR: EastIR<any, any> | AsyncEastIR<any, any>): Uint8Array {
  return encodeEastIR(eastIR);
}

/**
 * Load an EastIR bundle from a .beast2 file, returning the appropriate
 * sync/async wrapper based on the IR root variant.
 */
export async function loadEastIR(filePath: string): Promise<EastIR<any, any> | AsyncEastIR<any, any>> {
  const data = await fs.readFile(filePath);
  // Peek at the IR root to decide which decoder to use. Both decoders would
  // work except they throw on the wrong root variant.
  try {
    return decodeEastIR(data);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('AsyncFunction')) {
      return decodeAsyncEastIR(data);
    }
    throw err;
  }
}

/**
 * Write a ReadableStream to a file
 */
export async function writeStreamToFile(
  stream: ReadableStream<Uint8Array>,
  filePath: string
): Promise<void> {
  // Convert Web ReadableStream to Node.js Readable
  const nodeStream = Readable.fromWeb(stream as any);
  const writeStream = createWriteStream(filePath);

  await pipeline(nodeStream, writeStream);
}

/**
 * Load a value from Beast2 file
 */
export async function loadBeast2(filePath: string, type: any): Promise<any> {
  const data = await fs.readFile(filePath);
  const decoder = decodeBeast2For(type);
  return decoder(data);
}

/**
 * Format a value as .east format
 */
export function formatEast(value: any, type: any): string {
  const printer = printFor(type);
  return printer(value);
}

/**
 * Parse a value from .east format
 */
export function parseEast(text: string, type: any): any {
  const parser = parseFor(type);
  const result = parser(text);

  if (!result.success) {
    throw new Error(`Failed to parse .east: ${result.error}`);
  }

  return result.value;
}

/**
 * Load a value from any format (.json, .east, or .beast2)
 */
export async function loadValue(filePath: string, type: any): Promise<any> {
  const ext = filePath.slice(filePath.lastIndexOf('.'));

  if (ext === '.json') {
    const content = await fs.readFile(filePath, 'utf-8');
    const jsonValue = JSON.parse(content);
    const fromJSON = fromJSONFor(type);
    return fromJSON(jsonValue);
  } else if (ext === '.east') {
    const content = await fs.readFile(filePath, 'utf-8');
    return parseEast(content, type);
  } else if (ext === '.beast2') {
    const data = await fs.readFile(filePath);
    const decoder = decodeBeast2For(type);
    return decoder(data);
  } else {
    throw new Error(`Unsupported file format: ${ext} (expected .json, .east, or .beast2)`);
  }
}

/**
 * Encode a value to Beast2 format
 */
export function valueToBeast2(value: any, type: any): Uint8Array {
  const encoder = encodeBeast2For(type);
  return encoder(value);
}
