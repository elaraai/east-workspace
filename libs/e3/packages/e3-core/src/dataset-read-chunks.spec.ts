/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { BlobType, DictType, IntegerType, SortedMap, StringType, compareFor, decodeBeast2For, equalFor } from '@elaraai/east';
import { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';
import { datasetWrite } from './trees.js';
import { readDatasetChunks, readManifest } from './dataset-open.js';
import { watchObjects } from './test-helpers.js';

const REPO = 'r';

/** A value's chunks, joined. */
async function joined(chunks: AsyncIterable<Uint8Array>): Promise<{ bytes: Uint8Array; count: number }> {
  const parts: Uint8Array[] = [];
  for await (const chunk of chunks) parts.push(chunk);
  return { bytes: Buffer.concat(parts), count: parts.length };
}

describe('readDatasetChunks', () => {
  let storage: InMemoryStorage;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    await storage.repos.create(REPO);
  });

  it('gives a collection its manifest names as the value itself, a segment at a time, reading its manifest once', async () => {
    const TableType = DictType(IntegerType, StringType);
    const table = new SortedMap(Array.from({ length: 20_000 }, (_, i) => [BigInt(i), `row-${i}`] as [bigint, string]), compareFor(IntegerType));
    const hash = await datasetWrite(storage, REPO, table, TableType);
    const manifest = await readManifest(storage, REPO, hash);
    assert.ok(manifest !== null && manifest.entries.length > 1, 'it is stored as a manifest over several segments');

    const read: string[] = [];
    const watched = watchObjects(storage, (method, asked) => { if (method === 'read' || method === 'readRange') read.push(asked); });
    const value = await joined(readDatasetChunks(watched, REPO, hash));
    assert.ok(equalFor(TableType)(decodeBeast2For(TableType)(value.bytes), table), 'its chunks join into the table');
    assert.ok(value.count > 1, 'it came in more than one chunk');
    assert.equal(read.filter((asked) => asked === hash).length, 1, 'the manifest is read once');
  });

  it('gives any other value as the object it is, a range at a time', async () => {
    // Bytes no encoding makes smaller, so the object is past one range of 8 MiB
    const blob = new Uint8Array(randomBytes(9 * 1024 * 1024));
    const stored = await datasetWrite(storage, REPO, blob, BlobType);
    assert.ok((await storage.objects.stat(REPO, stored)).size > 8 * 1024 * 1024);
    const large = await joined(readDatasetChunks(storage, REPO, stored));
    assert.ok(equalFor(BlobType)(decodeBeast2For(BlobType)(large.bytes), blob), 'its chunks join into the blob');
    assert.equal(large.count, 2, 'a value past one range comes in two');
    const small = await joined(readDatasetChunks(storage, REPO, await datasetWrite(storage, REPO, 42n, IntegerType)));
    assert.equal(decodeBeast2For(IntegerType)(small.bytes), 42n);
    assert.equal(small.count, 1);
  });
});
