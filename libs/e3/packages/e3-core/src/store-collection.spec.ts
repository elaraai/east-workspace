/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The store's door.
 *
 * One property carries the module, and every test asks it a different way:
 * **whichever way a collection arrives — as elements, as a stock runner's
 * output, as foreign bytes, as collections already stored — it is stored as
 * the one manifest the Writer writes for its value**. The second is what the
 * door exists to make cheap: what it can carry over by reference, it does not
 * read.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ArrayType, Beast2ManifestWriter, DictType, IntegerType, SEGMENT_RULE_KEYED, SortedMap, StringType, StructType,
  carveBeast2, compareFor, decodeBeast2For, encodeBeast2For, encodeBeast2PagedFor,
  readBeast2Extents, type ValueTypeOf,
} from '@elaraai/east';
import { DatasetSegments } from './dataset-open.js';
import { storeCollection, storeDatasetBytes, storeDatasetFile } from './store-collection.js';
import { datasetWrite } from './trees.js';
import { createTempDir, createTestRepo, encodeInSegmentsOf, removeTempDir, removeTestRepo, storeSegmentsOf } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';

const RowType = StructType({ id: IntegerType, name: StringType });
const TableType = DictType(StringType, RowType);
type Row = ValueTypeOf<typeof RowType>;

describe("the store's door", () => {
  let repo: string;
  let dir: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    dir = createTempDir();
    storage = new LocalStorage(dirname(repo));
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(dir);
  });

  it('stores elements as the manifest the value path writes', async () => {
    const value = new SortedMap<string, Row>(
      Array.from({ length: 20_000 }, (_, i): [string, Row] => [`k${String(i).padStart(7, '0')}`, { id: BigInt(i), name: `row-${i}` }]),
      compareFor(StringType));
    const stored = await storeCollection(storage, repo, TableType, [{ elements: value.entries() }]);
    assert.equal(stored, await datasetWrite(storage, repo, value, TableType));
    const segments = await DatasetSegments.open(storage, repo, stored);
    assert.notEqual(segments.manifest, null);
    assert.ok(segments.segmentCount > 1, `20,000 rows should span segments, not ${segments.segmentCount}`);
  });

  it("stores a stock runner's output as the segments the file holds, and one it cannot carve as foreign bytes", async () => {
    const value = new SortedMap<string, Row>(
      Array.from({ length: 20_000 }, (_, i): [string, Row] => [`k${String(i).padStart(7, '0')}`, { id: BigInt(i), name: `row-${i}` }]),
      compareFor(StringType));
    const expected = await datasetWrite(storage, repo, value, TableType);

    const output = encodeBeast2PagedFor(TableType)(value);
    const path = join(dir, 'output.beast2');
    writeFileSync(path, output);
    const stored = await storeDatasetFile(storage, repo, path, { canonical: true });
    assert.equal(stored, expected);
    const extents = readBeast2Extents(output);
    const segments = await DatasetSegments.open(storage, repo, stored);
    assert.equal(segments.segmentCount, extents.offsets.length);
    for (let i = 0; i < segments.segmentCount; i++) {
      assert.deepEqual(new Uint8Array(await segments.segment(i)), carveBeast2(output, i, i + 1, extents), `segment ${i} is the file's own`);
    }

    // No index to carve by: the output is read as any other program's is.
    const whole = join(dir, 'whole.beast2');
    writeFileSync(whole, encodeBeast2For(TableType)(value));
    assert.equal(await storeDatasetFile(storage, repo, whole, { canonical: true }), expected);
  });

  it("adopts a runner directory's segments sixteen at a time, and writes the manifest once they have settled", async () => {
    const value = new SortedMap<string, Row>(
      Array.from({ length: 40_000 }, (_, i): [string, Row] => [`k${String(i).padStart(7, '0')}`, { id: BigInt(i), name: `row-${i}` }]),
      compareFor(StringType));
    // The directory a stock runner writes a collection as: the manifest, and
    // each object it names in a sibling directory, named by its SHA-256.
    const manifestFile = join(dir, 'output.beast2');
    mkdirSync(`${manifestFile}.segments`);
    const writer = new Beast2ManifestWriter(TableType, {
      object: (hash, bytes) => writeFileSync(join(`${manifestFile}.segments`, `${hash}.beast2`), bytes),
      manifest: (bytes) => writeFileSync(manifestFile, bytes),
    });
    for (const entry of value.entries()) writer.add(entry);
    writer.finish();
    assert.ok(writer.segments > 16, `more segments than are adopted at once: ${writer.segments}`);

    // Each adoption held a moment, as a remote store's request is.
    const objects = storage.objects;
    const adoptFile = objects.adoptFile.bind(objects);
    const write = objects.write.bind(objects);
    let adopting = 0;
    let peak = 0;
    let writesWhileAdopting = 0;
    objects.adoptFile = async (r: string, file: string, hash?: string) => {
      adopting++;
      peak = Math.max(peak, adopting);
      await new Promise((resolve) => setTimeout(resolve, 2));
      try {
        return await adoptFile(r, file, hash);
      } finally {
        adopting--;
      }
    };
    objects.write = (r: string, bytes: Uint8Array) => {
      if (adopting > 0) writesWhileAdopting++;
      return write(r, bytes);
    };
    const stored = await storeDatasetFile(storage, repo, manifestFile, { canonical: true });
    objects.adoptFile = adoptFile;
    objects.write = write;

    assert.equal(stored, await datasetWrite(storage, repo, value, TableType));
    assert.equal(peak, 16, 'sixteen segments adopted at once, never more');
    assert.equal(writesWhileAdopting, 0, 'the manifest is written once every segment has settled');
  });

  it('re-cuts foreign bytes, whatever layout they came in and however they arrive', async () => {
    const value = new SortedMap<string, Row>(
      Array.from({ length: 20_000 }, (_, i): [string, Row] => [`k${String(i).padStart(7, '0')}`, { id: BigInt(i), name: `row-${i}` }]),
      compareFor(StringType));
    const expected = await datasetWrite(storage, repo, value, TableType);
    const layouts: [string, Uint8Array][] = [
      ['batched by count', encodeInSegmentsOf(TableType, 1_000)(value)],
      ['encoded whole', encodeBeast2For(TableType)(value)],
      ['v4', encodeBeast2For(TableType, { version: 4 })(value)],
    ];
    for (const [layout, bytes] of layouts) {
      const path = join(dir, `${layout}.beast2`);
      writeFileSync(path, bytes);
      assert.equal(await storeDatasetFile(storage, repo, path), expected, `a file, ${layout}`);
      assert.equal(await storeDatasetBytes(storage, repo, bytes), expected, `bytes, ${layout}`);
      assert.equal(
        await storeCollection(storage, repo, TableType, [{ stored: await storage.objects.write(repo, bytes) }]),
        expected, `a blob in the store, ${layout}`);
    }
  });

  it('reads an upload as it arrives, a byte at a time', async () => {
    const value = new SortedMap<string, Row>(
      Array.from({ length: 3_000 }, (_, i): [string, Row] => [`k${String(i).padStart(7, '0')}`, { id: BigInt(i), name: `row-${i}` }]),
      compareFor(StringType));
    const bytes = encodeInSegmentsOf(TableType, 250)(value);
    const chunks = (function* () {
      for (let at = 0; at < bytes.length; at++) yield bytes.subarray(at, at + 1);
    })();
    assert.equal(await storeCollection(storage, repo, TableType, [{ chunks }]), await datasetWrite(storage, repo, value, TableType));
  });

  it('assembles stored collections in order, reading nothing but at the seam', async () => {
    const whole = new SortedMap<string, Row>(
      Array.from({ length: 12_000 }, (_, i): [string, Row] => [`k${String(i).padStart(7, '0')}`, { id: BigInt(i), name: `row-${i}` }]),
      compareFor(StringType));
    const low = await datasetWrite(storage, repo, new SortedMap([...whole].slice(0, 6_000), compareFor(StringType)), TableType);
    const high = await datasetWrite(storage, repo, new SortedMap([...whole].slice(6_000), compareFor(StringType)), TableType);
    const segmentHashes = new Set<string>();
    for (const hash of [low, high]) {
      const segments = await DatasetSegments.open(storage, repo, hash);
      assert.ok(segments.segmentCount > 2, `each half should span segments, not ${segments.segmentCount}`);
      for (const entry of segments.manifest!.entries) segmentHashes.add(entry.hash);
    }

    // The store is a class instance: an own property shadows the method on
    // its prototype for this test's storage, which no other test shares.
    const objects = storage.objects;
    const read = objects.read.bind(objects);
    let segmentReads = 0;
    objects.read = (r: string, hash: string) => {
      if (segmentHashes.has(hash)) segmentReads++;
      return read(r, hash);
    };
    const assembled = await storeCollection(storage, repo, TableType, [{ stored: low }, { stored: high }]);
    objects.read = read;

    assert.equal(assembled, await datasetWrite(storage, repo, whole, TableType));
    assert.ok(segmentReads <= 2, `the one seam reads a segment either side at most, not ${segmentReads}`);
  });

  it('carries segments [from, to) of a stored manifest, and re-cuts where elements join them', async () => {
    const value = new SortedMap<string, Row>(
      Array.from({ length: 20_000 }, (_, i): [string, Row] => [`k${String(i).padStart(7, '0')}`, { id: BigInt(i), name: `row-${i}` }]),
      compareFor(StringType));
    const hash = await datasetWrite(storage, repo, value, TableType);
    const segments = await DatasetSegments.open(storage, repo, hash);
    assert.ok(segments.segmentCount >= 6, `20,000 rows should span segments, not ${segments.segmentCount}`);

    // Segment 3 arrives as its elements, a row inserted, between the runs
    // either side of it.
    const edited = new SortedMap(decodeBeast2For(TableType)(await segments.segment(3)) as Map<string, Row>, compareFor(StringType));
    const key = `${await segments.fence(3) as string}-inserted`;
    edited.set(key, { id: -1n, name: 'inserted' });
    const stored = await storeCollection(storage, repo, TableType, [
      { stored: hash, from: 0, to: 3 },
      { elements: edited.entries() },
      { stored: hash, from: 4 },
    ]);

    const expected = new SortedMap(value, compareFor(StringType));
    expected.set(key, { id: -1n, name: 'inserted' });
    assert.equal(stored, await datasetWrite(storage, repo, expected, TableType));
  });

  it('refuses a manifest cut under another rule, and a run of a blob\'s segments, naming the fix', async () => {
    const value = new SortedMap<string, Row>(
      Array.from({ length: 3_000 }, (_, i): [string, Row] => [`k${String(i).padStart(7, '0')}`, { id: BigInt(i), name: `row-${i}` }]),
      compareFor(StringType));
    const blob = encodeInSegmentsOf(TableType, 700)(value);
    const older = await storeSegmentsOf(storage, repo, blob);
    await assert.rejects(storeCollection(storage, repo, TableType, [{ stored: older, from: 1 }]), {
      message: `store: manifest ${older.slice(0, 8)} was cut under test/as-encoded, not the current ${SEGMENT_RULE_KEYED}: ` +
        'an older e3 wrote this repository — re-create it: deploy again and import its data again',
    });
    // A delivery stored whole is read as it came; only a manifest has segments.
    const bare = await storage.objects.write(repo, blob);
    await assert.rejects(storeCollection(storage, repo, TableType, [{ stored: bare, from: 1 }]), {
      message: `store: object ${bare.slice(0, 8)} is not a manifest, and only a manifest has segments to take a run of`,
    });
  });

  it('stores the empty collection, and an Array in the order it was given', async () => {
    assert.equal(
      await storeCollection(storage, repo, TableType, []),
      await datasetWrite(storage, repo, new SortedMap<string, Row>(undefined, compareFor(StringType)), TableType));

    const type = ArrayType(RowType);
    const rows = Array.from({ length: 5_000 }, (_, i): Row => ({ id: BigInt(4_999 - i), name: `row-${i}` }));
    const halves = [
      await datasetWrite(storage, repo, rows.slice(0, 2_500), type),
      await datasetWrite(storage, repo, rows.slice(2_500), type),
    ];
    assert.equal(
      await storeCollection(storage, repo, type, halves.map((stored) => ({ stored }))),
      await datasetWrite(storage, repo, rows, type));
  });

  it('refuses a source of another type, naming it', async () => {
    const other = await datasetWrite(storage, repo, ['a'], ArrayType(StringType));
    await assert.rejects(
      storeCollection(storage, repo, TableType, [{ stored: other }]),
      new RegExp(`store: manifest ${other.slice(0, 8)} holds .*Array.*, not .*Dict`));
    await assert.rejects(
      storeCollection(storage, repo, TableType, [{ chunks: [encodeBeast2PagedFor(ArrayType(StringType))(['a'])] }]),
      /the bytes hold .*Array.*, not .*Dict/);
    await assert.rejects(storeCollection(storage, repo, IntegerType, []), /a collection is an Array, Set or Dict, not Integer/);
  });

  it('stores any other value as the object it is', async () => {
    const bytes = encodeBeast2For(RowType)({ id: 1n, name: 'one' });
    const path = join(dir, 'row.beast2');
    writeFileSync(path, bytes);
    const object = await storage.objects.write(repo, bytes);
    assert.equal(await storeDatasetBytes(storage, repo, bytes), object);
    assert.equal(await storeDatasetFile(storage, repo, path), object);
  });
});
