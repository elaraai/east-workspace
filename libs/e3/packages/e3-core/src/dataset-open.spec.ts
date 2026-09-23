/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The segment-object layout end to end: the door writes segment objects plus a
 * manifest, the opener reads any window of it, a splice decodes to the value it
 * was given, equal values produce byte-identical manifests whatever history
 * produced them, and a one-row change costs one segment object.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { dirname } from 'node:path';
import {
  DictType, IntegerType, SetType, StringType, StructType, ArrayType,
  SortedMap, SortedSet, compareFor, decodeBeast2For, openBeast2PagesFor,
  SEGMENT_MAX_COUNT, SEGMENT_MIN_COUNT, SEGMENT_RULE_KEYED, SEGMENT_RULE_POSITIONAL,
  toEastTypeValue,
} from '@elaraai/east';
import { COLLECTION_MANIFEST_KIND, decodeCollectionManifest, manifestElementCount } from '@elaraai/e3-types';
import { DatasetSegments, readDatasetWhole, readManifest, cutDatasetIntoStore } from './dataset-open.js';
import { datasetWrite } from './trees.js';
import { createTestRepo, removeTestRepo } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';

const RowType = StructType({ id: IntegerType, name: StringType });
const TableType = DictType(StringType, RowType);

/** `n` rows keyed `k0000000`… in canonical order, one optionally edited. */
function table(n: number, edit?: { at: string; name: string }): SortedMap<string, { id: bigint; name: string }> {
  const entries: [string, { id: bigint; name: string }][] = [];
  for (let i = 0; i < n; i++) {
    const key = `k${String(i).padStart(7, '0')}`;
    entries.push([key, { id: BigInt(i), name: edit?.at === key ? edit.name : `row-${i}` }]);
  }
  return new SortedMap(entries, compareFor(StringType));
}

describe('the segment-object layout', () => {
  let repo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage(dirname(repo));
  });

  afterEach(() => {
    removeTestRepo(repo);
  });

  /** Object hashes in the store, so a write's object count can be counted. */
  async function storedHashes(): Promise<Set<string>> {
    const hashes = new Set<string>();
    let cursor: unknown;
    do {
      const scan = await storage.repos.gcScanObjects(repo, cursor);
      for (const entry of scan.objects) hashes.add(entry.hash);
      cursor = scan.cursor;
    } while (cursor !== undefined);
    return hashes;
  }

  describe('the encoder door', () => {
    it('writes a collection as a manifest over segment objects', async () => {
      const hash = await datasetWrite(storage, repo, table(20_000), TableType);
      const manifest = decodeCollectionManifest(await storage.objects.read(repo, hash));

      assert.equal(manifest.kind, COLLECTION_MANIFEST_KIND);
      assert.equal(manifest.level, 0n);
      assert.equal(manifest.rule, SEGMENT_RULE_KEYED);
      assert.deepEqual(manifest.type, toEastTypeValue(TableType));
      assert.equal(manifestElementCount(manifest), 20_000);
      assert.ok(manifest.entries.length > 1, 'a 20k-row dict must hold more than one segment');

      // Every segment the manifest names is in the store, at the size and
      // count it claims — a reader budgets from the manifest alone.
      for (const entry of manifest.entries) {
        const bytes = await storage.objects.read(repo, entry.hash);
        assert.equal(bytes.byteLength, Number(entry.bytes));
        assert.equal(openBeast2PagesFor(TableType)(bytes).elementCount, Number(entry.count));
        assert.ok(Number(entry.count) <= SEGMENT_MAX_COUNT);
      }
      await storage.objects.read(repo, manifest.header);
    });

    it('keeps a non-collection root whole', async () => {
      const hash = await datasetWrite(storage, repo, { id: 1n, name: 'one' }, RowType);
      assert.equal(await readManifest(storage, repo, hash), null);
      assert.deepEqual(decodeBeast2For(RowType)(await storage.objects.read(repo, hash)), { id: 1n, name: 'one' });
    });

    it('marks an Array root with the positional rule and empty fences', async () => {
      const rows = Array.from({ length: 5_000 }, (_, i) => ({ id: BigInt(i), name: `row-${i}` }));
      const hash = await datasetWrite(storage, repo, rows, ArrayType(RowType));
      const manifest = decodeCollectionManifest(await storage.objects.read(repo, hash));
      assert.equal(manifest.rule, SEGMENT_RULE_POSITIONAL);
      for (const entry of manifest.entries) assert.equal(entry.fence.byteLength, 0);
    });

    it('carries a Set root through unchanged', async () => {
      const type = SetType(StringType);
      const value = new SortedSet(
        Array.from({ length: 10_000 }, (_, i) => `e${String(i).padStart(6, '0')}`),
        compareFor(StringType),
      );
      const hash = await datasetWrite(storage, repo, value, type);
      const decoded = decodeBeast2For(type)(await readDatasetWhole(storage, repo, hash)) as Set<string>;
      assert.equal(decoded.size, 10_000);
      assert.ok(decoded.has('e005000'));
    });

    it('holds an empty collection as a manifest with no entries', async () => {
      const hash = await datasetWrite(storage, repo, new Map(), TableType);
      const manifest = decodeCollectionManifest(await storage.objects.read(repo, hash));
      assert.equal(manifest.entries.length, 0);
      const decoded = decodeBeast2For(TableType)(await readDatasetWhole(storage, repo, hash)) as Map<string, unknown>;
      assert.equal(decoded.size, 0);
    });
  });

  describe('determinism', () => {
    it('gives equal values byte-identical manifests whatever produced them', async () => {
      const ascending = await datasetWrite(storage, repo, table(20_000), TableType);
      // The same value reached by editing a different one, and by insertion in
      // reverse order: segmentation is a function of the value, not of history.
      const shuffled = new Map<string, { id: bigint; name: string }>();
      for (const [k, v] of [...table(20_000)].reverse()) shuffled.set(k, v);
      const rebuilt = await datasetWrite(storage, repo, shuffled, TableType);
      assert.equal(rebuilt, ascending);
    });

    it('writes one segment object for a one-row change', async () => {
      await datasetWrite(storage, repo, table(20_000), TableType);
      const before = await storedHashes();

      const hash = await datasetWrite(storage, repo, table(20_000, { at: 'k0009000', name: 'edited' }), TableType);
      const after = await storedHashes();

      const added = [...after].filter((h) => !before.has(h));
      // One new segment object and one new manifest — the header and every
      // other segment deduplicate by hash against what is already stored.
      assert.equal(added.length, 2, `added ${added.length} objects: ${added.join(', ')}`);
      assert.ok(added.includes(hash));

      const manifest = decodeCollectionManifest(await storage.objects.read(repo, hash));
      assert.equal(manifest.entries.filter((e) => added.includes(e.hash)).length, 1);
    });

    it('costs the same number of objects at ten times the size', async () => {
      const small = decodeCollectionManifest(
        await storage.objects.read(repo, await datasetWrite(storage, repo, table(10_000), TableType)));
      const smallEdited = decodeCollectionManifest(
        await storage.objects.read(repo, await datasetWrite(storage, repo, table(10_000, { at: 'k0005000', name: 'x' }), TableType)));
      const large = decodeCollectionManifest(
        await storage.objects.read(repo, await datasetWrite(storage, repo, table(100_000), TableType)));
      const largeEdited = decodeCollectionManifest(
        await storage.objects.read(repo, await datasetWrite(storage, repo, table(100_000, { at: 'k0050000', name: 'x' }), TableType)));

      const changed = (a: typeof small, b: typeof small): number => {
        const before = new Set(a.entries.map((e) => e.hash));
        return b.entries.filter((e) => !before.has(e.hash)).length;
      };
      assert.equal(changed(small, smallEdited), 1);
      assert.equal(changed(large, largeEdited), 1);
      assert.ok(large.entries.length > small.entries.length * 5,
        'ten times the rows must be roughly ten times the segments');
    });
  });

  describe('the opener', () => {
    it('splices back to the value the door was given', async () => {
      const value = table(20_000);
      const hash = await datasetWrite(storage, repo, value, TableType);
      const decoded = decodeBeast2For(TableType)(await readDatasetWhole(storage, repo, hash)) as Map<string, unknown>;
      assert.equal(decoded.size, value.size);
      assert.deepEqual(decoded.get('k0000000'), value.get('k0000000'));
      assert.deepEqual(decoded.get('k0019999'), value.get('k0019999'));
    });

    it('serves any window from the segments it touches', async () => {
      const value = table(20_000);
      const segments = await DatasetSegments.open(storage, repo, await datasetWrite(storage, repo, value, TableType));
      assert.equal(segments.elementCount, 20_000);

      const window = openBeast2PagesFor(TableType)(await segments.span(1, 3));
      assert.equal(window.elementCount, segments.counts[1]! + segments.counts[2]!);
      const base = segments.cumulative[0]!;
      const expected = [...value.keys()].slice(base, base + window.elementCount);
      assert.deepEqual([...(window.slice(0, window.elementCount) as Map<string, unknown>).keys()], expected);
    });

    it('reads a manifest once, whether or not the store serves ranges', async () => {
      // The head probe already holds a manifest of a few hundred segments,
      // so reading it again whole is a second round trip to the store.
      const hash = await datasetWrite(storage, repo, table(20_000), TableType);
      const objects = storage.objects;
      const read = objects.read.bind(objects);
      const readRange = objects.readRange!.bind(objects);
      let wholeReads = 0;
      objects.read = (r: string, h: string) => {
        if (h === hash) wholeReads++;
        return read(r, h);
      };
      try {
        assert.ok(await readManifest(storage, repo, hash) !== null);
        assert.equal(wholeReads, 0, 'the head was the whole manifest');

        (objects as { readRange?: unknown }).readRange = undefined;
        assert.ok(await readManifest(storage, repo, hash) !== null);
        assert.equal(wholeReads, 1, 'without ranges the one whole read is the head');
      } finally {
        objects.read = read;
        objects.readRange = readRange;
      }
    });

    it('answers fences from the manifest, with no frame probe', async () => {
      const value = table(20_000);
      const segments = await DatasetSegments.open(storage, repo, await datasetWrite(storage, repo, value, TableType));
      const keys = [...value.keys()];
      for (let i = 0; i < segments.segmentCount; i++) {
        const row = i === 0 ? 0 : segments.cumulative[i - 1]!;
        assert.equal(await segments.fence(i), keys[row]);
      }
    });

    it('opens a bare segmented blob through the same shape', async () => {
      // A blob written outside the door — what a runner leaves on its output
      // file, and what a repository written before the layout still holds.
      const blob = openBeast2PagesFor;  // referenced so the intent is explicit
      assert.ok(blob);
      const value = table(5_000);
      const bytes = (await import('@elaraai/east')).encodeBeast2PagedFor(TableType)(value);
      const bare = await storage.objects.write(repo, bytes);
      assert.equal(await readManifest(storage, repo, bare), null);

      const segments = await DatasetSegments.open(storage, repo, bare);
      assert.equal(segments.elementCount, 5_000);
      assert.equal(await segments.fence(0), 'k0000000');
      assert.deepEqual(await readDatasetWhole(storage, repo, bare), bytes);
    });

    it('cuts a bare blob into the layout, byte for byte as the door does', async () => {
      const value = table(20_000);
      const direct = await datasetWrite(storage, repo, value, TableType);
      const bytes = (await import('@elaraai/east')).encodeBeast2PagedFor(TableType)(value);
      const cut = await cutDatasetIntoStore(storage, repo, bytes);
      assert.equal(cut, direct, 'cutting a rule-conforming blob must land on the door’s own manifest');
    });

    it('re-cuts a blob that was not cut by the rule', async () => {
      const value = table(20_000);
      const positional = (await import('@elaraai/east'))
        .encodeBeast2PagedFor(TableType, { batchSize: 1_000 })(value);
      const cut = await cutDatasetIntoStore(storage, repo, positional);
      const manifest = decodeCollectionManifest(await storage.objects.read(repo, cut));
      for (let i = 0; i < manifest.entries.length - 1; i++) {
        assert.ok(Number(manifest.entries[i]!.count) >= SEGMENT_MIN_COUNT);
      }
      assert.equal(cut, await datasetWrite(storage, repo, value, TableType));
    });
  });
});
