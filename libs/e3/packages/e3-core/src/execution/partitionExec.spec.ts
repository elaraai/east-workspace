/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The byte-level steps of a fan-out, against a real repository: planning an
 * input's partitions, carving each partition's slices, and splicing stored
 * collections back together. Carving a value and splicing its slices is the
 * identity, so every plan here is checked by landing on the value's own
 * manifest — the one the Writer writes for it.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  StringType, IntegerType, NullType, StructType, DictType, ArrayType,
  East, SortedMap, compareFor,
  encodeBeast2For, decodeBeast2For, encodeBeast2SegmentsFor, encodeEastIR, readBeast2Extents,
} from '@elaraai/east';
import { decodeCollectionManifest, type PartitionPlan } from '@elaraai/e3-types';
import { carvePartitionSlices, planPartitions, spliceBlobs } from './partitionExec.js';
import { PartitionBlob, bufferPart, decodedSegmentPeak, prefetchedRangePeak, resetDecodedSegmentPeak, resetPrefetchedRangePeak, spliceChunks } from './partitionIo.js';
import { readDatasetWhole } from '../dataset-open.js';
import { datasetWrite } from '../trees.js';
import { createTestRepo, removeTestRepo, encodeInSegmentsOf } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/interfaces.js';

const RowType = StructType({ id: IntegerType, name: StringType });
const TableType = DictType(IntegerType, RowType);

function makeTable(n: number, offset = 0): SortedMap<bigint, { id: bigint; name: string }> {
  const entries: [bigint, { id: bigint; name: string }][] = [];
  for (let i = 0; i < n; i++) {
    const id = BigInt(i + offset);
    entries.push([id, { id, name: `row-${i + offset}` }]);
  }
  return new SortedMap(entries, compareFor(IntegerType));
}

describe('partition planning, carving and splicing', () => {
  let repo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(repo);
  });

  /** Every partition's slices of a plan: `slices[input][partition]`. */
  async function carveAll(plan: PartitionPlan, partitions: number): Promise<string[][]> {
    const slices: string[][] = plan.partitions.map(() => []);
    for (let p = 0; p < partitions; p++) {
      const carved = await carvePartitionSlices(storage, repo, plan, p);
      carved.forEach((slice, input) => slices[input]!.push(slice));
    }
    return slices;
  }

  it('cuts at every segment for a one-byte target, and the slices splice back into the value\'s manifest', async () => {
    const table = makeTable(1000);
    const tableHash = await storage.objects.write(repo, encodeInSegmentsOf(TableType, 100)(table));

    const { plan, partitions } = await planPartitions(storage, repo, { primary: tableHash, secondaries: [], by: null, targetBytes: 1 });
    assert.equal(partitions, 10);
    assert.deepEqual(plan.boundaries, Array.from({ length: 10 }, (_, i) => BigInt(i)));
    assert.deepEqual(plan.splits, []);

    const [slices] = await carveAll(plan, partitions);
    // Carving is a pure function of the plan.
    assert.deepEqual(await carvePartitionSlices(storage, repo, plan, 3), [slices![3]]);
    assert.equal(await spliceBlobs(storage, repo, slices!), await datasetWrite(storage, repo, table, TableType));
  });

  it('plans one partition when the target covers every segment', async () => {
    const tableHash = await storage.objects.write(repo, encodeInSegmentsOf(TableType, 100)(makeTable(1000)));
    const { plan, partitions } = await planPartitions(storage, repo, { primary: tableHash, secondaries: [], by: null, targetBytes: 1 << 30 });
    assert.equal(partitions, 1);
    assert.deepEqual(plan.boundaries, [0n]);
  });

  it('co-partitions a secondary at the primary boundaries, re-encoding only split edges', async () => {
    const primaryHash = await storage.objects.write(repo, encodeInSegmentsOf(TableType, 100)(makeTable(1000)));
    // The secondary covers a sub-range with segment boundaries that do NOT
    // line up with the primary's fences, so most partition boundaries land
    // inside its segments and exercise the edge rebuild.
    const secondary = makeTable(500, 250);
    const secondaryHash = await storage.objects.write(repo, encodeInSegmentsOf(TableType, 100)(secondary));

    const { plan, partitions } = await planPartitions(storage, repo, { primary: primaryHash, secondaries: [secondaryHash], by: null, targetBytes: 1 });
    const [, secondarySlices] = await carveAll(plan, partitions);
    // Splicing the secondary slices gives exactly the secondary value — every
    // key once, in canonical order — as its own manifest.
    assert.equal(await spliceBlobs(storage, repo, secondarySlices!), await datasetWrite(storage, repo, secondary, TableType));
  });

  it('plans and carves at bounded memory: the input is never read whole', async () => {
    // Semi-random row content defeats deflate enough that the blob dwarfs
    // every legitimate single read — the read bound below is then real, not
    // vacuously satisfied by a tiny fixture.
    const entries: [bigint, { id: bigint; name: string }][] = [];
    for (let i = 0; i < 30_000; i++) {
      const id = BigInt(i);
      const salt = ((i * 2654435761) >>> 0).toString(36) + ((i * 1103515245 + 12345) >>> 0).toString(36);
      entries.push([id, { id, name: `row-${i}-${salt}` }]);
    }
    const table = new SortedMap(entries, compareFor(IntegerType));
    const tableBlob = encodeInSegmentsOf(TableType, 2000)(table);
    const tableHash = await storage.objects.write(repo, tableBlob);

    // The largest legitimate single read on the ranged path: one segment
    // frame (boundary probes, single-segment spans) or the 64 KiB tail
    // probe. Anything approaching the whole blob is a regression.
    const extents = readBeast2Extents(tableBlob);
    const segmentBytes = extents.offsets.map((o, i) =>
      (i + 1 < extents.offsets.length ? extents.offsets[i + 1]! : extents.segmentsEnd) - o);
    const readBound = Math.max(...segmentBytes, 64 * 1024);
    assert.ok(tableBlob.length > 2 * readBound,
      `precondition: the blob (${tableBlob.length} B) must dwarf the largest legitimate read (${readBound} B), or the bound cannot fail`);

    const objects = storage.objects;
    let wholeInputReads = 0;
    let maxRangeLength = 0;
    const origRead = objects.read.bind(objects);
    const origRange = objects.readRange.bind(objects);
    objects.read = (r: string, h: string) => {
      if (h === tableHash) wholeInputReads++;
      return origRead(r, h);
    };
    objects.readRange = (r: string, h: string, offset: number, length: number) => {
      if (h === tableHash) maxRangeLength = Math.max(maxRangeLength, length);
      return origRange(r, h, offset, length);
    };
    const { plan, partitions } = await planPartitions(storage, repo, { primary: tableHash, secondaries: [], by: null, targetBytes: 1 });
    const [slices] = await carveAll(plan, partitions);
    objects.read = origRead;
    objects.readRange = origRange;

    assert.equal(wholeInputReads, 0, 'the input must never be read whole');
    assert.ok(maxRangeLength <= readBound,
      `every ranged read of the input (max ${maxRangeLength} B) must stay within one segment frame / tail probe (${readBound} B)`);
    assert.equal(await spliceBlobs(storage, repo, slices!), await datasetWrite(storage, repo, table, TableType));
  });

  it('addresses a manifest-stored input through its segment objects, and splices its slices back into that manifest', async () => {
    // A collection dataset is stored as a manifest over segment objects, and
    // the partition machinery addresses the blob those segments splice to by
    // ranged reads of the segment objects: the value is never materialised,
    // to plan or for any carve.
    const entries: [bigint, { id: bigint; name: string }][] = [];
    for (let i = 0; i < 30_000; i++) {
      const id = BigInt(i);
      const salt = ((i * 2654435761) >>> 0).toString(36) + ((i * 1103515245 + 12345) >>> 0).toString(36);
      entries.push([id, { id, name: `row-${i}-${salt}` }]);
    }
    const table = new SortedMap(entries, compareFor(IntegerType));
    const manifestHash = await datasetWrite(storage, repo, table, TableType);
    const manifest = decodeCollectionManifest(await storage.objects.read(repo, manifestHash));
    assert.ok(manifest.entries.length > 4, `the input spans segment objects, got ${manifest.entries.length}`);
    const segmentObjects = new Set(manifest.entries.map((entry) => entry.hash));

    const objects = storage.objects;
    const wholeSegmentReads: string[] = [];
    const origRead = objects.read.bind(objects);
    objects.read = (r: string, h: string) => {
      if (segmentObjects.has(h)) wholeSegmentReads.push(h);
      return origRead(r, h);
    };
    const { plan, partitions } = await planPartitions(storage, repo, { primary: manifestHash, secondaries: [], by: null, targetBytes: 1 });
    const [slices] = await carveAll(plan, partitions);
    const spliced = await spliceBlobs(storage, repo, slices!);
    objects.read = origRead;

    // Carving reads no segment object whole; splicing re-cuts each seam
    // between the slices, which reads at most a segment either side.
    const seams = partitions - 1;
    assert.ok(wholeSegmentReads.length <= 2 * seams, `${wholeSegmentReads.length} segment objects read whole over ${seams} seams`);
    assert.equal(spliced, manifestHash, 'the carved slices splice back into the manifest');
  });

  it('partitions an Array input whose elements are in no order at all', async () => {
    // An Array root has no canonical order — its elements sit where the value
    // put them — so its boundaries are never checked for an order it does not
    // have.
    const PairType = StructType({ key: IntegerType, name: StringType });
    const scrambled = Array.from({ length: 400 }, (_, i) => {
      const at = Number((BigInt(i) * 97n) % 400n);
      return { key: BigInt(at), name: `row-${at}` };
    });
    const arrayHash = await storage.objects.write(repo, encodeInSegmentsOf(ArrayType(PairType), 40)(scrambled));

    const { plan, partitions } = await planPartitions(storage, repo, { primary: arrayHash, secondaries: [], by: null, targetBytes: 1 });
    assert.equal(partitions, 10);
    const [slices] = await carveAll(plan, partitions);
    assert.equal(await spliceBlobs(storage, repo, slices!), await datasetWrite(storage, repo, scrambled, ArrayType(PairType)),
      'the slices splice back into the scrambled array, in its order');
  });

  it('aligns boundaries on a `by` field read without compiling the projection', async () => {
    const GroupKeyType = StructType({ group: IntegerType, id: IntegerType });
    // 1000 rows in 100-row segments, 150 rows per group: a group straddles
    // every fence except where one starts (rows 300, 600 and 900).
    const table = new SortedMap<{ group: bigint; id: bigint }, string>(
      Array.from({ length: 1000 }, (_, i) =>
        [{ group: BigInt(Math.floor(i / 150)), id: BigInt(i) }, `row-${i}`] as [{ group: bigint; id: bigint }, string]),
      compareFor(GroupKeyType),
    );
    const tableHash = await storage.objects.write(repo, encodeInSegmentsOf(DictType(GroupKeyType, StringType), 100)(table));
    // The projection reads `key.group` after calling a platform function no
    // runtime provides: compiling it would fail, so planning succeeding pins
    // that it only reads the projection's shape.
    const unprovided = East.platform('e3_core_test_unprovided', [], NullType);
    const byFn = East.function([GroupKeyType], IntegerType, ($, key) => {
      $(unprovided());
      return key.group;
    });

    const { plan, partitions } = await planPartitions(storage, repo, { primary: tableHash, secondaries: [], by: encodeEastIR(byFn.toIR()), targetBytes: 1 });
    // A cut at every fence, kept only where a group starts.
    assert.equal(partitions, 4);
    assert.deepEqual(plan.boundaries, [0n, 3n, 6n, 9n]);
    const [slices] = await carveAll(plan, partitions);
    assert.equal(await spliceBlobs(storage, repo, slices!), await datasetWrite(storage, repo, table, DictType(GroupKeyType, StringType)));
  });

  it('refuses a `by` projection that is not a leading-prefix key read', async () => {
    const GroupKeyType = StructType({ group: IntegerType, id: IntegerType });
    const table = new SortedMap<{ group: bigint; id: bigint }, string>(
      Array.from({ length: 200 }, (_, i) => [{ group: BigInt(i >> 4), id: BigInt(i) }, `row-${i}`] as [{ group: bigint; id: bigint }, string]),
      compareFor(GroupKeyType),
    );
    const tableHash = await storage.objects.write(repo, encodeInSegmentsOf(DictType(GroupKeyType, StringType), 50)(table));
    const byFn = East.function([GroupKeyType], IntegerType, (_$, key) => key.group.add(1n));

    await assert.rejects(
      planPartitions(storage, repo, { primary: tableHash, secondaries: [], by: encodeEastIR(byFn.toIR()), targetBytes: 1 }),
      { message: 'partition by projection is not a leading-prefix key projection — re-export the package with the current SDK' },
    );
  });

  it('aligns an identity `by` over co-partitioned keys on the shared fields, not the primary key', async () => {
    const WideKeyType = StructType({ sku: StringType, period: IntegerType, line: IntegerType });
    const SharedKeyType = StructType({ sku: StringType, period: IntegerType });
    type Shared = { sku: string; period: bigint };
    // The primary holds three lines per (sku, period) in 4-row segments, so
    // groups straddle fences; the secondary holds one row per (sku, period).
    const groups: Shared[] = ['a', 'b', 'c'].flatMap((sku) => [0n, 1n, 2n, 3n].map((period) => ({ sku, period })));
    const primary = new SortedMap<Shared & { line: bigint }, bigint>(
      groups.flatMap((g) => [0n, 1n, 2n].map((line) => [{ ...g, line }, line] as [Shared & { line: bigint }, bigint])),
      compareFor(WideKeyType),
    );
    const secondary = new SortedMap<Shared, bigint>(groups.map((g) => [g, g.period] as [Shared, bigint]), compareFor(SharedKeyType));
    const primaryHash = await storage.objects.write(repo, encodeInSegmentsOf(DictType(WideKeyType, IntegerType), 4)(primary));
    const secondaryHash = await storage.objects.write(repo, encodeInSegmentsOf(DictType(SharedKeyType, IntegerType), 5)(secondary));
    const byFn = East.function([SharedKeyType], SharedKeyType, (_$, key) => key);

    const { plan, partitions } = await planPartitions(storage, repo, {
      primary: primaryHash, secondaries: [secondaryHash], by: encodeEastIR(byFn.toIR()), targetBytes: 1,
    });
    assert.ok(partitions > 1, 'the primary carves into several partitions');

    // Every partition's primary slice holds exactly the (sku, period) groups of
    // its secondary slice: no group is split from its counterpart.
    const decodePrimary = decodeBeast2For(DictType(WideKeyType, IntegerType));
    const decodeSecondary = decodeBeast2For(DictType(SharedKeyType, IntegerType));
    const groupsOf = (keys: Iterable<Shared>): Set<string> => new Set([...keys].map((k) => `${k.sku}/${k.period}`));
    const [primarySlices, secondarySlices] = await carveAll(plan, partitions);
    for (let p = 0; p < partitions; p++) {
      assert.deepEqual(
        groupsOf(decodePrimary(await storage.objects.read(repo, primarySlices![p]!)).keys()),
        groupsOf(decodeSecondary(await storage.objects.read(repo, secondarySlices![p]!)).keys()),
      );
    }
  });

  it('refuses a co-partitioned secondary that does not follow the boundary projection order', async () => {
    // The secondary's canonical order is b-major while the implicit boundary
    // projection compares under the primary's a-major key: its projected
    // fences descend, which must fail loudly instead of mis-assigning rows.
    const AB = StructType({ a: IntegerType, b: IntegerType });
    const BA = StructType({ b: IntegerType, a: IntegerType });
    const primary = new SortedMap(
      Array.from({ length: 12 }, (_, i) => [{ a: BigInt(i), b: 0n }, `p-${i}`] as [{ a: bigint; b: bigint }, string]),
      compareFor(AB));
    const primaryHash = await storage.objects.write(repo, encodeInSegmentsOf(DictType(AB, StringType), 2)(primary));
    // b-major canonical order with `a` values that DESCEND across fences.
    const secondary = new SortedMap(
      Array.from({ length: 12 }, (_, i) => [{ b: BigInt(i), a: BigInt(11 - i) }, `s-${i}`] as [{ b: bigint; a: bigint }, string]),
      compareFor(BA));
    const secondaryHash = await storage.objects.write(repo, encodeInSegmentsOf(DictType(BA, StringType), 2)(secondary));

    await assert.rejects(
      planPartitions(storage, repo, { primary: primaryHash, secondaries: [secondaryHash], by: null, targetBytes: 1 }),
      /projected segment fences are not monotone/,
    );
  });

  it('refuses a primary whose own projected partition boundaries descend', async () => {
    // A `by` reading a field that is not the key's leading one passes the
    // shape check, but its projection runs against the primary's canonical
    // order, so the boundary values descend — and the secondaries' split
    // searches resume forward from the previous bound and cannot go back.
    const BA = StructType({ b: IntegerType, a: IntegerType });
    const rows = (n: number): [{ b: bigint; a: bigint }, string][] =>
      Array.from({ length: n }, (_, i) => [{ b: BigInt(i), a: BigInt(n - 1 - i) }, `p-${i}`]);
    const write = (n: number, batchSize: number): Promise<string> => storage.objects.write(
      repo, encodeInSegmentsOf(DictType(BA, StringType), batchSize)(new SortedMap(rows(n), compareFor(BA))));
    const primaryHash = await write(12, 2);
    const secondaryHash = await write(12, 3);
    const byFn = East.function([BA], IntegerType, (_$, key) => key.a);

    await assert.rejects(
      planPartitions(storage, repo, { primary: primaryHash, secondaries: [secondaryHash], by: encodeEastIR(byFn.toIR()), targetBytes: 1 }),
      /projected partition boundaries are not monotone/,
    );
  });

  it('refuses an input that carries no segment index', async () => {
    // Whole-value v5 encode: no index, so the input cannot be carved.
    const tableHash = await storage.objects.write(repo, encodeBeast2For(TableType)(makeTable(50)));
    await assert.rejects(
      planPartitions(storage, repo, { primary: tableHash, secondaries: [], by: null, targetBytes: 1 }),
      /segment index/,
    );
  });

  it('spliceBlobs assembles stored collections in order, and refuses keys that do not ascend', async () => {
    const encode = encodeInSegmentsOf(TableType, 100);
    const lowHash = await storage.objects.write(repo, encode(makeTable(250)));
    const highHash = await storage.objects.write(repo, encode(makeTable(250, 250)));

    const spliced = await spliceBlobs(storage, repo, [lowHash, highHash]);
    assert.equal(decodeBeast2For(TableType)(await readDatasetWhole(storage, repo, spliced)).size, 500);
    assert.equal(spliced, await datasetWrite(storage, repo, makeTable(500), TableType), 'the whole value\'s own manifest');

    await assert.rejects(
      spliceBlobs(storage, repo, [highHash, lowHash]),
      /blobs 1 and 2 of 2 do not ascend disjointly in key order/,
    );
  });

  it('probing every fence of a many-segment blob keeps a bounded prefix cache', async () => {
    // Planning walks every fence of each co-partitioned secondary. The prober
    // used to retain the frame prefix of every segment it probed and scan
    // them all on each read — O(segments) memory and O(segments²)
    // comparisons, in the module whose claim is one segment at a time.
    const segments = 200;
    // Rows wide enough that one DEFLATED segment outgrows a fence probe, so
    // each probe needs its own range — with narrow or compressible rows a
    // single probe covers dozens of segments and nothing accumulates.
    let seed = 1;
    const noise = (n: number): string => {
      let out = '';
      for (let i = 0; i < n; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        out += String.fromCharCode(33 + (seed % 90));
      }
      return out;
    };
    const wide = new SortedMap(
      Array.from({ length: segments * 5 }, (_, i) =>
        [BigInt(i), { id: BigInt(i), name: noise(4096) }] as [bigint, { id: bigint; name: string }]),
      compareFor(IntegerType));
    const hash = await storage.objects.write(repo, encodeInSegmentsOf(TableType, 5)(wide));
    const blob = await PartitionBlob.open(storage, repo, hash);
    resetPrefetchedRangePeak();
    resetDecodedSegmentPeak();
    try {
      assert.equal(blob.extents.offsets.length, segments);
      for (let i = 0; i < segments; i++) {
        assert.equal(await blob.fence(i), BigInt(i * 5), `fence ${i} survives eviction`);
      }
      // Unbounded this peaked at 196 of the 200 segments; the head plus a
      // small FIFO of frame prefixes is all a sequential walk needs.
      assert.ok(prefetchedRangePeak() <= 9, `prefix cache stayed bounded, peaked at ${prefetchedRangePeak()}`);
      assert.equal(decodedSegmentPeak(), 0, 'no fence fell back to a whole-segment decode');
    } finally {
      blob.release();
    }
  });

  it('spliceChunks refuses non-self-contained parts', async () => {
    // A cross-segment-aliasing shard would splice into a blob whose REFs
    // resolve into the PREVIOUS shard's containers — in range, silently
    // wrong — so the streaming splice must refuse it like spliceBeast2 does.
    const blob = encodeBeast2SegmentsFor(TableType, { selfContained: false })([makeTable(10)]);
    const part = bufferPart(blob);
    assert.equal(part.selfContained, false);
    const chunks = spliceChunks(blob.subarray(0, readBeast2Extents(blob).prefixEnd), [part]);
    await assert.rejects(
      (async () => { for await (const _ of chunks) { /* drain */ } })(),
      /splice part 0 has cross-segment aliasing — splice needs self-contained segments/,
    );
  });
});
