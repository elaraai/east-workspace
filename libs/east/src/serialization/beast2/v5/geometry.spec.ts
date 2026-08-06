/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v5 byte geometry — carve / splice / rebuild over canonical
 * segments. Byte-identity reconstruction, sub-range decode equivalence,
 * mid-segment splits via rebuild, and the validation errors.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  IntegerType, StringType, ArrayType, SetType, DictType, StructType,
} from "../../../types.js";
import { compareFor, equalFor } from "../../../comparison.js";
import { SortedMap, SortedSet } from "../../../index.js";
import {
  encodeBeast2For,
  decodeBeast2For,
  encodeBeast2PagedFor,
  openBeast2PagesFor,
  readBeast2Extents,
  carveBeast2,
  spliceBeast2,
  rebuildBeast2,
  readBeast2ExtentsRanged,
  carveBeast2Ranged,
  type Beast2RangeReader,
} from "../index.js";

const RowType = StructType({ id: IntegerType, name: StringType });
const TableType = DictType(IntegerType, RowType);

/** A canonical Dict of `n` rows keyed 0..n-1, paged into small segments. */
function makeTable(n: number, offset = 0): SortedMap<bigint, { id: bigint; name: string }> {
  const entries: [bigint, { id: bigint; name: string }][] = [];
  for (let i = 0; i < n; i++) {
    const id = BigInt(i + offset);
    entries.push([id, { id, name: `row-${i + offset}` }]);
  }
  return new SortedMap(entries, compareFor(IntegerType));
}

const PAGED = { batchSize: 100 };

describe("Beast2 v5 — geometry extents", () => {
  test("extents agree with the paging index", () => {
    const value = makeTable(450);
    const blob = encodeBeast2PagedFor(TableType, PAGED)(value);
    const extents = readBeast2Extents(blob);
    const pages = openBeast2PagesFor(TableType)(blob);

    assert.equal(extents.offsets.length, pages.segmentCount);
    assert.deepEqual([...extents.counts], [...pages.counts]);
    assert.equal(extents.elementCount, 450);
    assert.ok(extents.selfContained);
    assert.ok(extents.sourceMapEmpty);
    assert.equal(extents.typeValue.type, "Dict");
    assert.equal(extents.offsets[0], extents.prefixEnd);
    assert.ok(extents.segmentsEnd > extents.prefixEnd);
    assert.equal(extents.indexOffset, extents.segmentsEnd + 4);
  });

  test("rejects v4 blobs, index-less blobs, and non-collection roots", () => {
    const value = makeTable(10);
    const v4 = encodeBeast2For(TableType, { version: 4 })(value);
    assert.throws(() => readBeast2Extents(v4), /v4 container/);

    const noIndex = encodeBeast2For(TableType)(value); // whole-value v5: no index
    assert.throws(() => readBeast2Extents(noIndex), /carries no index/);

    const scalar = encodeBeast2For(IntegerType)(42n);
    assert.throws(() => readBeast2Extents(scalar), /Array, Set or Dict roots/);
  });
});

describe("Beast2 v5 — carve", () => {
  test("carving every segment reconstructs the blob byte-identically", () => {
    const blob = encodeBeast2PagedFor(TableType, PAGED)(makeTable(450));
    const extents = readBeast2Extents(blob);
    const whole = carveBeast2(blob, 0, extents.offsets.length, extents);
    assert.deepEqual(whole, blob);
  });

  test("a carved run decodes to the corresponding key range", () => {
    const value = makeTable(450);
    const blob = encodeBeast2PagedFor(TableType, PAGED)(value);
    const extents = readBeast2Extents(blob);
    assert.ok(extents.offsets.length >= 3, "test needs several segments");

    const carved = carveBeast2(blob, 1, 3, extents);
    const decoded = decodeBeast2For(TableType)(carved);
    const expectedSize = extents.counts[1]! + extents.counts[2]!;
    assert.equal(decoded.size, expectedSize);

    // The carved keys are exactly the contiguous canonical range starting at
    // the second segment's fence.
    const skip = extents.counts[0]!;
    const allKeys = [...value.keys()];
    assert.deepEqual([...decoded.keys()], allKeys.slice(skip, skip + expectedSize));
  });

  test("an empty carve decodes to an empty collection", () => {
    const blob = encodeBeast2PagedFor(TableType, PAGED)(makeTable(300));
    const carved = carveBeast2(blob, 2, 2);
    const decoded = decodeBeast2For(TableType)(carved);
    assert.equal(decoded.size, 0);
  });

  test("rejects invalid ranges", () => {
    const blob = encodeBeast2PagedFor(TableType, PAGED)(makeTable(300));
    const extents = readBeast2Extents(blob);
    const n = extents.offsets.length;
    assert.throws(() => carveBeast2(blob, -1, 1, extents), /carve range/);
    assert.throws(() => carveBeast2(blob, 0, n + 1, extents), /carve range/);
    assert.throws(() => carveBeast2(blob, 2, 1, extents), /carve range/);
  });
});

describe("Beast2 v5 — splice", () => {
  test("splicing carved runs reconstructs the blob byte-identically", () => {
    const blob = encodeBeast2PagedFor(TableType, PAGED)(makeTable(450));
    const extents = readBeast2Extents(blob);
    const n = extents.offsets.length;
    const mid = Math.floor(n / 2);
    const spliced = spliceBeast2([
      carveBeast2(blob, 0, mid, extents),
      carveBeast2(blob, mid, n, extents),
    ]);
    assert.deepEqual(spliced, blob);
  });

  test("splices Array runs by row order", () => {
    const Rows = ArrayType(StringType);
    const value = Array.from({ length: 250 }, (_, i) => `row-${i}`);
    const blob = encodeBeast2PagedFor(Rows, PAGED)(value);
    const extents = readBeast2Extents(blob);
    const n = extents.offsets.length;
    const spliced = spliceBeast2([
      carveBeast2(blob, 0, 1, extents),
      carveBeast2(blob, 1, n, extents),
    ]);
    assert.deepEqual(decodeBeast2For(Rows)(spliced), value);
  });

  test("parts with empty segment runs contribute nothing", () => {
    const blob = encodeBeast2PagedFor(TableType, PAGED)(makeTable(200));
    const extents = readBeast2Extents(blob);
    const n = extents.offsets.length;
    const spliced = spliceBeast2([
      carveBeast2(blob, 0, 0, extents),
      carveBeast2(blob, 0, n, extents),
      carveBeast2(blob, n, n, extents),
    ]);
    assert.deepEqual(spliced, blob);
  });

  test("rejects differing header sections", () => {
    const a = encodeBeast2PagedFor(TableType, PAGED)(makeTable(100));
    const other = encodeBeast2PagedFor(DictType(IntegerType, StringType), PAGED)(
      new SortedMap<bigint, string>([[1n, "x"]], compareFor(IntegerType)),
    );
    assert.throws(() => spliceBeast2([a, other]), /differing header sections/);
    assert.throws(() => spliceBeast2([]), /at least one part/);
  });

  test("does not itself validate key order — readers of the result do", () => {
    // Two same-typed blobs spliced in the wrong key order produce a blob the
    // strict readers reject as corrupt: the splice is byte geometry only.
    const high = encodeBeast2PagedFor(TableType, PAGED)(makeTable(100, 1000));
    const low = encodeBeast2PagedFor(TableType, PAGED)(makeTable(100, 0));
    const spliced = spliceBeast2([high, low]);
    assert.throws(() => decodeBeast2For(TableType)(spliced), /strictly ascending/);
  });
});

describe("Beast2 v5 — ranged geometry", () => {
  /** A range reader over an in-memory blob that records every read. */
  function rangeReader(blob: Uint8Array): Beast2RangeReader & { reads: { offset: number; length: number }[] } {
    const reads: { offset: number; length: number }[] = [];
    return {
      size: blob.length,
      reads,
      read: (offset, length) => {
        reads.push({ offset, length });
        return Promise.resolve(blob.subarray(offset, offset + length));
      },
    };
  }

  test("ranged extents agree with the whole-blob extents without reading the blob whole", async () => {
    const blob = encodeBeast2PagedFor(TableType, PAGED)(makeTable(450));
    const whole = readBeast2Extents(blob);
    const reader = rangeReader(blob);
    // A probe smaller than the blob, so the tail read is genuinely partial
    // (the default 64 KiB probe would swallow this small test blob whole).
    const ranged = await readBeast2ExtentsRanged(reader, { tailProbeBytes: 512 });

    assert.deepEqual([...ranged.offsets], [...whole.offsets]);
    assert.deepEqual([...ranged.counts], [...whole.counts]);
    assert.equal(ranged.prefixEnd, whole.prefixEnd);
    assert.equal(ranged.segmentsEnd, whole.segmentsEnd);
    assert.equal(ranged.indexOffset, whole.indexOffset);
    assert.equal(ranged.elementCount, whole.elementCount);
    assert.equal(ranged.selfContained, whole.selfContained);
    assert.equal(ranged.sourceMapEmpty, whole.sourceMapEmpty);
    assert.equal(ranged.typeValue.type, whole.typeValue.type);
    assert.equal(ranged.size, blob.length);
    assert.deepEqual(ranged.head, blob.subarray(0, whole.prefixEnd));
    // A tail probe and the head — never the blob whole, and never more than
    // the head plus the probe (which may graze a few trailing frame bytes).
    assert.ok(reader.reads.every((r) => r.length < blob.length), "no whole-blob read");
    const totalRead = reader.reads.reduce((sum, r) => sum + r.length, 0);
    assert.ok(totalRead <= whole.prefixEnd + 512 + (blob.length - whole.segmentsEnd),
      `reads (${totalRead} bytes) must stay at head + tail, not the blob (${blob.length} bytes)`);
    assert.ok(reader.reads.length <= 3, "one tail probe, at most one extension, one head read");
  });

  test("a tiny tail probe extends to cover the index and still agrees", async () => {
    const blob = encodeBeast2PagedFor(TableType, PAGED)(makeTable(450));
    const whole = readBeast2Extents(blob);
    const ranged = await readBeast2ExtentsRanged(rangeReader(blob), { tailProbeBytes: 16 });
    assert.deepEqual([...ranged.offsets], [...whole.offsets]);
    assert.equal(ranged.elementCount, whole.elementCount);
  });

  test("ranged carve is byte-identical to whole-blob carve", async () => {
    const blob = encodeBeast2PagedFor(TableType, PAGED)(makeTable(450));
    const extents = readBeast2Extents(blob);
    const ranged = await readBeast2ExtentsRanged(rangeReader(blob));
    assert.ok(extents.offsets.length >= 3, "test needs several segments");

    const start = ranged.offsets[1]!;
    const end = ranged.offsets[3] ?? ranged.segmentsEnd;
    const frames = blob.subarray(start, end);
    assert.deepEqual(carveBeast2Ranged(ranged, frames, 1, 3), carveBeast2(blob, 1, 3, extents));

    // Empty spans assemble the empty carve, byte-identically too.
    assert.deepEqual(carveBeast2Ranged(ranged, new Uint8Array(0), 2, 2), carveBeast2(blob, 2, 2, extents));
  });

  test("a ranged window pages and decodes like the whole blob's window", async () => {
    const value = makeTable(450);
    const blob = encodeBeast2PagedFor(TableType, PAGED)(value);
    const ranged = await readBeast2ExtentsRanged(rangeReader(blob));
    const wholePages = openBeast2PagesFor(TableType)(blob);

    // The window [180, 230) touches segments 1..3 (100-element batches).
    const frames = blob.subarray(ranged.offsets[1]!, ranged.offsets[3] ?? ranged.segmentsEnd);
    const mini = carveBeast2Ranged(ranged, frames, 1, 3);
    const miniPages = openBeast2PagesFor(TableType)(mini);
    const expected = wholePages.slice(180, 50);
    const got = miniPages.slice(80, 50); // 180 minus segment 0's 100 elements
    assert.ok(equalFor(TableType)(got as never, expected as never), "ranged window equals the whole-blob window");
  });

  test("rejects index-less blobs and mismatched frame spans", async () => {
    const noIndex = encodeBeast2For(TableType)(makeTable(10)); // whole-value v5: no index
    await assert.rejects(() => readBeast2ExtentsRanged(rangeReader(noIndex)), /carries no index/);

    const blob = encodeBeast2PagedFor(TableType, PAGED)(makeTable(300));
    const ranged = await readBeast2ExtentsRanged(rangeReader(blob));
    assert.throws(() => carveBeast2Ranged(ranged, new Uint8Array(3), 0, 1), /is .* bytes, got 3/);
    assert.throws(() => carveBeast2Ranged(ranged, new Uint8Array(0), 2, 1), /carve range/);
  });
});

describe("Beast2 v5 — rebuild", () => {
  test("rebuilt halves of a split segment splice cleanly with byte-copied runs", () => {
    const value = makeTable(450);
    const blob = encodeBeast2PagedFor(TableType, PAGED)(value);
    const extents = readBeast2Extents(blob);
    const pages = openBeast2PagesFor(TableType)(blob);
    assert.ok(extents.offsets.length >= 3, "test needs several segments");

    // Split segment 1 at its midpoint key.
    const segment = pages.segment(1) as SortedMap<bigint, { id: bigint; name: string }> | Map<bigint, { id: bigint; name: string }>;
    const entries = [...segment.entries()];
    const cut = Math.floor(entries.length / 2);
    const left = new Map(entries.slice(0, cut));
    const right = new Map(entries.slice(cut));

    const spliced = spliceBeast2([
      carveBeast2(blob, 0, 1, extents),
      rebuildBeast2(blob, [left], { extents }),
      rebuildBeast2(blob, [right], { extents }),
      carveBeast2(blob, 2, extents.offsets.length, extents),
    ]);

    const eq = equalFor(TableType);
    assert.ok(eq(decodeBeast2For(TableType)(spliced), value), "split-and-splice round-trips the value");

    // The result pages like any canonical blob.
    const splicedPages = openBeast2PagesFor(TableType)(spliced);
    assert.equal(splicedPages.elementCount, 450);
    assert.equal((splicedPages.get(entries[cut]![0] as never) as { name: string }).name, entries[cut]![1].name);
  });

  test("rebuild enforces canonical batch order for Set roots", () => {
    const Tags = SetType(StringType);
    const value = new SortedSet(["a", "b", "c", "d"], compareFor(StringType));
    const blob = encodeBeast2PagedFor(Tags, PAGED)(value);
    assert.throws(
      () => rebuildBeast2(blob, [new Set(["z"]), new Set(["a"])]),
      /strictly ascending/,
    );
  });
});
