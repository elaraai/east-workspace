/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BlobType, DictType, IntegerType, SortedMap, StringType, compareFor, decodeBeast2For, equalFor } from '@elaraai/east';
import { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';
import { datasetWrite } from './trees.js';
import { readManifest } from './dataset-open.js';
import { createTempDir, removeTempDir } from './test-helpers.js';
import { datasetWriteFile } from './dataset-write-file.js';

const REPO = 'r';

describe('datasetWriteFile', () => {
  let dir: string;
  let storage: InMemoryStorage;

  beforeEach(async () => {
    dir = createTempDir();
    storage = new InMemoryStorage();
    await storage.repos.create(REPO);
  });

  afterEach(() => removeTempDir(dir));

  it('writes a collection its manifest names as the value itself, from its segments', async () => {
    const TableType = DictType(IntegerType, StringType);
    const table = new SortedMap(Array.from({ length: 20_000 }, (_, i) => [BigInt(i), `row-${i}`] as [bigint, string]), compareFor(IntegerType));
    const hash = await datasetWrite(storage, REPO, table, TableType);
    const manifest = await readManifest(storage, REPO, hash);
    assert.ok(manifest !== null && manifest.entries.length > 1, 'it is stored as a manifest over several segments');

    const file = join(dir, 'table.beast2');
    const bytes = await datasetWriteFile(storage, REPO, hash, file);
    const written = await readFile(file);
    assert.equal(bytes, written.length);
    assert.ok(equalFor(TableType)(decodeBeast2For(TableType)(written), table), 'the file is the table');
  });

  it('writes any other value as the object it is, in ranges past the copy size, replacing the file', async () => {
    const blob = new Uint8Array(9 * 1024 * 1024).map((_, i) => i % 251);
    const file = join(dir, 'value.beast2');
    await datasetWriteFile(storage, REPO, await datasetWrite(storage, REPO, blob, BlobType), file);
    assert.ok(equalFor(BlobType)(decodeBeast2For(BlobType)(await readFile(file)), blob), 'the file is the blob');

    await datasetWriteFile(storage, REPO, await datasetWrite(storage, REPO, 42n, IntegerType), file);
    assert.equal(decodeBeast2For(IntegerType)(await readFile(file)), 42n);
  });
});
