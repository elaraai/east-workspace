/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Paging through a synchronous range reader — the I/O accounting: the open
 * reads only the tail (footer + index) and the head, `size` reads nothing
 * more, keyed reads and index reads fetch exactly the frames they touch,
 * iteration fetches each frame once, and a whole read never happens. The
 * values equal the `Uint8Array` path's on the same blob.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { IntegerType, StringType, ArrayType, SetType, DictType, StructType } from "../../../types.js";
import { compareFor, equalFor } from "../../../comparison.js";
import { SortedMap, SortedSet, isFrozenValue } from "../../../index.js";
import {
  decodeBeast2For,
  encodeBeast2For,
  encodeBeast2PagedFor,
  openBeast2LazyFor,
  openBeast2PagesFor,
  readBeast2Extents,
  readBeast2ExtentsRanged,
  readBeast2ExtentsSync,
  type Beast2SyncRangeReader,
} from "../index.js";

const RowType = StructType({ id: IntegerType, name: StringType });
const TableType = DictType(IntegerType, RowType);
const PAGED = { batchSize: 100 };

/** Rows whose names carry a hash suffix, so the deflated blob outgrows the
 *  64 KiB tail probe: the I/O accounting below only means something when the
 *  open cannot cover the blob with its first read. */
function makeTable(n: number): SortedMap<bigint, { id: bigint; name: string }> {
  const entries: [bigint, { id: bigint; name: string }][] = [];
  for (let i = 0; i < n; i++) {
    const hash = ((Math.imul(i + 1, 2654435761) >>> 0) * 40503).toString(36);
    entries.push([BigInt(i), { id: BigInt(i), name: `row-${i}-${hash}${hash}` }]);
  }
  return new SortedMap(entries, compareFor(IntegerType));
}

/** A reader over an in-memory blob that logs every positioned read. */
class CountingReader implements Beast2SyncRangeReader {
  readonly reads: [number, number][] = [];
  constructor(private readonly data: Uint8Array) {}
  get size(): number { return this.data.length; }
  read(offset: number, length: number): Uint8Array {
    this.reads.push([offset, length]);
    if (offset < 0 || offset + length > this.data.length) throw new Error(`read [${offset}, ${offset + length}) outside the blob`);
    return this.data.slice(offset, offset + length);
  }
  /** Bytes read so far. */
  get bytes(): number { return this.reads.reduce((n, [, l]) => n + l, 0); }
  /** The reads that land on segment frames of `extents` — the frame index of each. */
  frames(offsets: readonly number[]): number[] {
    return this.reads.map(([o]) => offsets.indexOf(o)).filter((i) => i >= 0);
  }
  clear(): void { this.reads.length = 0; }
}

describe("Beast2 v5 — sync range reader: extents", () => {
  test("the sync extents equal the whole-blob and the async ranged reads", async () => {
    const blob = encodeBeast2PagedFor(TableType, PAGED)(makeTable(6000));
    assert.ok(blob.length > 64 * 1024 + 4096, `fixture must outgrow the tail probe (${blob.length} bytes)`);
    const whole = readBeast2Extents(blob);
    const reader = new CountingReader(blob);
    const sync = readBeast2Extents(reader);
    const ranged = await readBeast2ExtentsRanged({ size: blob.length, read: async (o, l) => blob.slice(o, o + l) });

    for (const ext of [sync, ranged]) {
      assert.equal(ext.prefixEnd, whole.prefixEnd);
      assert.equal(ext.segmentsEnd, whole.segmentsEnd);
      assert.equal(ext.indexOffset, whole.indexOffset);
      assert.deepEqual(ext.offsets, whole.offsets);
      assert.deepEqual(ext.counts, whole.counts);
      assert.equal(ext.elementCount, 6000);
      assert.equal(ext.selfContained, true);
      assert.deepEqual(ext.typeValue, whole.typeValue);
      assert.equal(ext.size, blob.length);
      assert.deepEqual(ext.head, blob.subarray(0, whole.prefixEnd));
    }
    // Two reads: the tail probe and the head — never the frames.
    assert.equal(reader.reads.length, 2, `reads: ${JSON.stringify(reader.reads)}`);
    assert.ok(reader.bytes < blob.length, "the extents never read the blob whole");
    assert.deepEqual(readBeast2ExtentsSync(reader), sync);
  });

  test("a tiny tail probe takes the second tail read and still agrees", () => {
    const blob = encodeBeast2PagedFor(TableType, { batchSize: 5 })(makeTable(400));
    const reader = new CountingReader(blob);
    const ext = readBeast2Extents(reader, { tailProbeBytes: 16 });
    assert.equal(ext.offsets.length, 80);
    assert.equal(reader.reads.length, 3, "footer probe, index re-read, head");
    assert.deepEqual(ext.offsets, readBeast2Extents(blob).offsets);
  });

  test("an index-less blob and a too-short blob are refused through the reader", () => {
    const indexless = encodeBeast2For(TableType)(makeTable(10));
    assert.throws(() => readBeast2Extents(new CountingReader(indexless)), /carries no index/);
    const scalar = encodeBeast2For(IntegerType)(1n);
    assert.throws(() => readBeast2Extents(new CountingReader(scalar)), /Data too short/);
  });
});

describe("Beast2 v5 — sync range reader: pages and lazy values", () => {
  const table = makeTable(6000);
  const blob = encodeBeast2PagedFor(TableType, PAGED)(table);
  const extents = readBeast2Extents(blob);
  const segments = extents.offsets.length;

  test("the open reads the tail and head only; size reads nothing more", () => {
    assert.ok(blob.length > 64 * 1024 + 4096, `fixture must outgrow the tail probe (${blob.length} bytes)`);
    assert.equal(segments, 60);
    const reader = new CountingReader(blob);
    const lazy = openBeast2LazyFor(TableType)(reader);
    assert.equal(reader.reads.length, 2, `open reads: ${JSON.stringify(reader.reads)}`);
    assert.equal(lazy.size, 6000);
    assert.equal(reader.reads.length, 2, "size is answered from the index");
    assert.ok(reader.bytes < blob.length, "the open never buffers the blob");
  });

  test("keyed reads fetch exactly the frames they touch", () => {
    const reader = new CountingReader(blob);
    const lazy = openBeast2LazyFor(TableType)(reader);
    reader.clear();
    // The first keyed read verifies the fences, as east-c does: one bounded
    // probe per segment (each frame read once, one key decoded), then the
    // segment holding the key — never a read spanning the blob.
    assert.equal(lazy.get(42n)?.name, table.get(42n)!.name);
    const fenceReads = reader.frames(extents.offsets);
    const everySegment = Array.from({ length: segments }, (_, i) => i);
    assert.deepEqual(fenceReads, [...everySegment, 0], "fences probe each segment once, then segment 0 is decoded");
    assert.equal(reader.reads.length, fenceReads.length, "every read is one segment frame");
    assert.ok(reader.reads.every(([, l]) => l < blob.length / 8), "no read spans the blob");
    reader.clear();
    assert.equal(lazy.get(1042n)?.name, table.get(1042n)!.name);
    assert.deepEqual(reader.frames(extents.offsets), [10], "the second read fetches only segment 10");
    reader.clear();
    assert.equal(lazy.get(5999n)?.name, table.get(5999n)!.name);
    assert.deepEqual(reader.frames(extents.offsets), [segments - 1]);
    reader.clear();
    assert.equal(lazy.get(9999n), undefined);
    assert.deepEqual(reader.frames(extents.offsets), [], "a miss above the last fence is served from the cached last segment");
    assert.equal((lazy as unknown as { hydrated: boolean }).hydrated, false, "served reads never hydrate");
  });

  test("iteration reads each frame exactly once and never the blob whole", () => {
    const reader = new CountingReader(blob);
    const lazy = openBeast2LazyFor(TableType)(reader);
    reader.clear();
    const collected = new SortedMap([...lazy], compareFor(IntegerType));
    assert.deepEqual(reader.frames(extents.offsets), Array.from({ length: segments }, (_, i) => i));
    assert.ok(reader.reads.every(([, l]) => l < blob.length), "no read spans the blob");
    assert.ok(equalFor(TableType)(collected, table), "iteration yields the whole value");
  });

  test("array index reads and set membership fetch one frame each", () => {
    const Rows = ArrayType(StringType);
    const rows = Array.from({ length: 260 }, (_, i) => `row-${i}`);
    const rowsBlob = encodeBeast2PagedFor(Rows, PAGED)(rows);
    const rowsExt = readBeast2Extents(rowsBlob);
    const rowsReader = new CountingReader(rowsBlob);
    const lazyRows = openBeast2LazyFor(Rows)(rowsReader);
    rowsReader.clear();
    assert.equal(lazyRows.length, 260);
    assert.equal(lazyRows[259], "row-259");
    assert.deepEqual(rowsReader.frames(rowsExt.offsets), [2], "one index read decodes one segment");

    const Tags = SetType(StringType);
    const tags = new SortedSet(Array.from({ length: 300 }, (_, i) => `tag-${String(i).padStart(4, "0")}`), compareFor(StringType));
    const tagsBlob = encodeBeast2PagedFor(Tags, PAGED)(tags);
    const tagsExt = readBeast2Extents(tagsBlob);
    const tagsReader = new CountingReader(tagsBlob);
    const lazyTags = openBeast2LazyFor(Tags)(tagsReader);
    assert.ok(lazyTags.has("tag-0142"));
    assert.ok(!lazyTags.has("missing"));
    tagsReader.clear();
    assert.ok(lazyTags.has("tag-0299"));
    assert.deepEqual(tagsReader.frames(tagsExt.offsets), [2]);
  });

  test("fence probes read a bounded prefix of each frame, never the frame", () => {
    // Wide rows with incompressible names: every frame is far wider than
    // the probe under both codecs, so a probe that read frames whole would
    // show as frame-sized reads. The one frame-sized read is the segment
    // the key lands in.
    const wide = (n: number): SortedMap<bigint, { id: bigint; name: string }> => {
      const entries: [bigint, { id: bigint; name: string }][] = [];
      for (let i = 0; i < n; i++) {
        let name = "";
        for (let k = 0; name.length < 200; k++) name += ((Math.imul(i * 7919 + k + 1, 2654435761) >>> 0) * 40503).toString(36);
        entries.push([BigInt(i), { id: BigInt(i), name }]);
      }
      return new SortedMap(entries, compareFor(IntegerType));
    };
    const table = wide(4000);
    for (const codec of ["none", "deflate"] as const) {
      const blob = encodeBeast2PagedFor(TableType, { batchSize: 500, codec })(table);
      const ext = readBeast2Extents(blob);
      const reader = new CountingReader(blob);
      const lazy = openBeast2LazyFor(TableType)(reader);
      reader.clear();
      assert.equal(lazy.get(2042n)?.name, table.get(2042n)!.name);
      const frameLen = (i: number): number => (i + 1 < ext.offsets.length ? ext.offsets[i + 1]! : ext.segmentsEnd) - ext.offsets[i]!;
      const frameReads = reader.reads.filter(([o]) => ext.offsets.includes(o));
      assert.equal(frameReads.length, reader.reads.length, `${codec}: every read is at a frame offset`);
      const probes = frameReads.filter(([, l]) => l <= 4096);
      const whole = frameReads.filter(([o, l]) => l === frameLen(ext.offsets.indexOf(o)));
      assert.ok(ext.offsets.every((o) => frameLen(ext.offsets.indexOf(o)) > 4096), `${codec}: frames outgrow the probe`);
      assert.equal(probes.length, ext.offsets.length, `${codec}: one bounded probe per segment (${JSON.stringify(reader.reads)})`);
      assert.deepEqual(whole.map(([o]) => ext.offsets.indexOf(o)), [4], `${codec}: exactly the landed segment is read whole`);
    }
  });

  test("the reader-backed value equals the Uint8Array-backed one, frozen alike", () => {
    const fromBytes = openBeast2LazyFor(TableType, { frozen: true })(blob);
    const fromReader = openBeast2LazyFor(TableType, { frozen: true })(new CountingReader(blob));
    assert.ok(isFrozenValue(fromReader));
    assert.ok(equalFor(TableType)(fromReader, fromBytes));
    assert.ok(equalFor(TableType)(fromReader, decodeBeast2For(TableType)(blob)));
    assert.throws(() => fromReader.set(1n, { id: 1n, name: "x" }), /frozen/);

    const pagesBytes = openBeast2PagesFor(TableType)(blob);
    const pagesReader = openBeast2PagesFor(TableType)(new CountingReader(blob));
    assert.equal(pagesReader.segmentCount, pagesBytes.segmentCount);
    assert.equal(pagesReader.elementCount, pagesBytes.elementCount);
    assert.deepEqual(pagesReader.fence(2), pagesBytes.fence(2));
    assert.deepEqual([...(pagesReader.segment(1) as Map<bigint, unknown>).keys()], [...(pagesBytes.segment(1) as Map<bigint, unknown>).keys()]);
    assert.deepEqual(pagesReader.slice(95, 10), pagesBytes.slice(95, 10));
    assert.deepEqual(pagesReader.slice(5990, 20), pagesBytes.slice(5990, 20));
  });

  test("a reader that returns short is blamed, not the blob", () => {
    const short: Beast2SyncRangeReader = { size: blob.length, read: (o, l) => blob.slice(o, o + Math.max(0, l - 1)) };
    assert.throws(() => openBeast2LazyFor(TableType)(short), /reader returned \d+ bytes for a \d+-byte range/);
    // A reader that is exact for the geometry (the tail probe runs past the
    // segments, the head stops before them) but short on a frame read fails
    // at that read, with the same diagnosis.
    const shortFrames: Beast2SyncRangeReader = {
      size: blob.length,
      read: (o, l) => blob.slice(o, o + (o >= extents.prefixEnd && o + l <= extents.segmentsEnd ? l - 1 : l)),
    };
    const lazy = openBeast2LazyFor(TableType)(shortFrames);
    assert.throws(() => lazy.get(42n), /reader returned \d+ bytes for a \d+-byte range/);
  });
});
