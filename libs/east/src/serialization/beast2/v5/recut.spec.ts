/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Re-cutting, held to the Writer: whatever pieces a value arrives in — the
 * Writer's segments of parts of it, or elements, split anywhere — the re-cut
 * writes the segments the Writer writes for the whole value, and an edit
 * costs the segments around it.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, BlobType, DictType, IntegerType, SetType, StringType, StructType, type EastType } from "../../../types.js";
import { compareFor } from "../../../comparison.js";
import { SortedMap, SortedSet } from "../../../index.js";
import {
  carveBeast2,
  encodeBeast2FenceFor,
  encodeBeast2PagedFor,
  openBeast2PagesFor,
  readBeast2Extents,
  recutBeast2For,
  segmentKeyTypeOf,
  spliceBeast2,
  spliceBeast2Tail,
  type Beast2RecutOptions,
  type Beast2RecutPiece,
  type Beast2RecutStats,
  type Beast2SegmentRef,
} from "../index.js";

const RowType = StructType({ id: IntegerType, name: StringType });
const TableType = DictType(StringType, RowType);
const NamesType = SetType(StringType);
const RowsType = ArrayType(RowType);
const WideType = DictType(StringType, BlobType);

type Row = { id: bigint; name: string };

/** A segment reference whose `read` is counted, and whose bytes the test's own
 *  sink takes without counting. */
type Ref = Beast2SegmentRef & { carve(): Uint8Array };

/** xorshift32 — a fixed stream, so a failure reproduces exactly. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
}

const row = (i: number): Row => ({ id: BigInt(i), name: `row-${i}` });
const key = (i: number): string => `k${String(i).padStart(7, "0")}`;

/** References to every segment of a blob the Writer wrote. */
function refsOf(type: EastType, blob: Uint8Array, reads: { count: number } = { count: 0 }): Ref[] {
  const extents = readBeast2Extents(blob);
  const keyType = segmentKeyTypeOf(type);
  const pages = openBeast2PagesFor(type)(blob);
  const fenceOf = keyType === null ? null : encodeBeast2FenceFor(keyType);
  const fences = extents.counts.map((_, i) => fenceOf === null ? new Uint8Array(0) : fenceOf(pages.fence(i)));
  return extents.counts.map((count, i) => ({
    count,
    fence: fences[i]!,
    ...(fenceOf !== null && i + 1 < fences.length && { nextFence: fences[i + 1]! }),
    read: () => {
      reads.count++;
      return carveBeast2(blob, i, i + 1, extents);
    },
    carve: () => carveBeast2(blob, i, i + 1, extents),
  }));
}

/** The whole a re-cut writes, spliced into one blob, and what it came to. The
 *  sink awaits, as a store's would. */
async function recut(type: EastType, pieces: Beast2RecutPiece<EastType, Ref>[], options?: Beast2RecutOptions): Promise<{ blob: Uint8Array; stats: Beast2RecutStats }> {
  const parts: Uint8Array[] = [];
  const stats = await recutBeast2For<EastType, Ref>(type, options)(pieces, {
    written: async (segment) => { await Promise.resolve(); parts.push(segment.blob); },
    carried: async (segment) => { await Promise.resolve(); parts.push(segment.carve()); },
  });
  const blob = parts.length > 0
    ? spliceBeast2(parts)
    : new Uint8Array(Buffer.concat([stats.header, spliceBeast2Tail([], stats.header.length)]));
  return { blob, stats };
}

/** One way a value arrives: its elements, and how to build a part of it. */
type Case = {
  name: string;
  type: EastType;
  elements: unknown[];
  valueOf: (part: unknown[]) => unknown;
  options?: Beast2RecutOptions;
};

const cases: Case[] = [
  {
    name: "a Dict",
    type: TableType,
    elements: Array.from({ length: 20_000 }, (_, i) => [key(i), row(i)]),
    valueOf: (part) => new SortedMap(part as [string, Row][], compareFor(StringType)),
  },
  {
    name: "a Set",
    type: NamesType,
    elements: Array.from({ length: 20_000 }, (_, i) => key(i)),
    valueOf: (part) => new SortedSet(part as string[], compareFor(StringType)),
  },
  {
    name: "an Array",
    type: RowsType,
    elements: Array.from({ length: 20_000 }, (_, i) => row(i)),
    valueOf: (part) => part,
  },
  {
    name: "a Dict of wide rows",
    type: WideType,
    elements: Array.from({ length: 48 }, (_, i) => [key(i), new Uint8Array(256 * 1024).fill(i)]),
    valueOf: (part) => new SortedMap(part as [string, Uint8Array][], compareFor(StringType)),
    options: { codec: "none" },
  },
];

/** A case's elements cut at `at` into pieces: each the Writer's segments of
 *  its part, or the part's elements. */
function piecesOf(c: Case, at: number[], asSegments: (piece: number) => boolean): Beast2RecutPiece<EastType, Ref>[] {
  const bounds = [0, ...at, c.elements.length];
  const pieces: Beast2RecutPiece<EastType, Ref>[] = [];
  for (let p = 0; p + 1 < bounds.length; p++) {
    const part = c.elements.slice(bounds[p], bounds[p + 1]);
    pieces.push(asSegments(p)
      ? { segments: refsOf(c.type, encodeBeast2PagedFor(c.type, c.options)(c.valueOf(part) as never)) }
      : { elements: part });
  }
  return pieces;
}

describe("beast2 v5 recut", () => {
  for (const c of cases) {
    test(`writes what the Writer writes for ${c.name}, from pieces cut anywhere`, async () => {
      const expected = encodeBeast2PagedFor(c.type, c.options)(c.valueOf(c.elements) as never);
      const next = rng(0x7ec0 + c.elements.length);
      for (let round = 0; round < 8; round++) {
        const at = Array.from({ length: next() % 6 }, () => next() % (c.elements.length + 1)).sort((a, b) => a - b);
        const flags = Array.from({ length: at.length + 1 }, () => next() % 3 !== 0);
        const { blob } = await recut(c.type, piecesOf(c, at, (p) => flags[p]!), c.options);
        assert.deepEqual(blob, expected, `round ${round}: cut at [${at.join(", ")}], segments [${flags.join(", ")}]`);
      }
    });
  }

  test("carries every segment when the pieces are runs of the whole's own segments, reading none", async () => {
    const blob = encodeBeast2PagedFor(TableType)(cases[0]!.valueOf(cases[0]!.elements) as never);
    const reads = { count: 0 };
    const refs = refsOf(TableType, blob, reads);
    assert.ok(refs.length > 7, `${refs.length} segments`);
    const { blob: out, stats } = await recut(TableType, [
      { segments: refs.slice(0, 3) },
      { elements: [] },
      { segments: refs.slice(3, 7) },
      { segments: refs.slice(7) },
    ]);
    assert.deepEqual(out, blob);
    assert.equal(stats.carried, refs.length);
    assert.equal(stats.written, 0);
    assert.equal(reads.count, 0);
  });

  test("re-cuts one segment for a one-row Dict edit, deciding the seams from fences alone", async () => {
    const before = new SortedMap(Array.from({ length: 20_000 }, (_, i) => [key(i), row(i)] as [string, Row]), compareFor(StringType));
    const blob = encodeBeast2PagedFor(TableType)(before);
    const pages = openBeast2PagesFor(TableType)(blob);
    const reads = { count: 0 };
    const refs = refsOf(TableType, blob, reads);
    const edited = { id: 9_000n, name: "edited" };
    const i = pages.segmentFor(key(9_000));
    const elements = [...(pages.segment(i) as Map<string, Row>)].map(([k, v]) => [k, k === key(9_000) ? edited : v]);

    const { blob: out, stats } = await recut(TableType, [
      { segments: refs.slice(0, i) },
      { elements },
      { segments: refs.slice(i + 1) },
    ]);
    const after = new SortedMap(before, compareFor(StringType));
    after.set(key(9_000), edited);
    assert.deepEqual(out, encodeBeast2PagedFor(TableType)(after));
    assert.equal(stats.written, 1);
    assert.equal(stats.carried, refs.length - 1);
    assert.equal(reads.count, 0);
  });

  test("re-cuts O(1) segments for an Array edit, reading only the segments at its seams", async () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => row(i));
    const blob = encodeBeast2PagedFor(RowsType)(rows);
    const pages = openBeast2PagesFor(RowsType)(blob);
    const reads = { count: 0 };
    const refs = refsOf(RowsType, blob, reads);
    let i = 0;
    let start = 0;
    while (start + pages.counts[i]! <= 9_000) start += pages.counts[i++]!;
    const elements = [...(pages.segment(i) as Row[])];
    elements[9_000 - start] = { id: 9_000n, name: "edited" };

    const { blob: out, stats } = await recut(RowsType, [
      { segments: refs.slice(0, i) },
      { elements },
      { segments: refs.slice(i + 1) },
    ]);
    const after = rows.slice();
    after[9_000] = { id: 9_000n, name: "edited" };
    assert.deepEqual(out, encodeBeast2PagedFor(RowsType)(after));
    assert.ok(stats.written <= 2, `${stats.written} segments written`);
    assert.ok(reads.count <= 2, `${reads.count} segments read`);
  });

  test("writes no segment for an empty whole, under the Writer's header", async () => {
    const { blob, stats } = await recut(TableType, [{ elements: [] }, { segments: [] }]);
    assert.deepEqual(blob, encodeBeast2PagedFor(TableType)(new SortedMap<string, Row>(undefined, compareFor(StringType))));
    assert.equal(stats.carried + stats.written, 0);
  });

  test("keeps the whole's order while written segments are framed on the pool", async () => {
    const next = rng(0x9a11);
    const items = Array.from({ length: 24_000 }, () => {
      let s = "";
      for (let k = 8 + (next() % 1400); k > 0; k--) s += String.fromCharCode(97 + (next() % 26));
      return s;
    });
    const type = ArrayType(StringType);
    const tail = encodeBeast2PagedFor(type)(items.slice(12_000));
    const { blob } = await recut(type, [{ elements: items.slice(0, 12_000) }, { segments: refsOf(type, tail) }], { parallel: true });
    assert.deepEqual(blob, encodeBeast2PagedFor(type)(items));
  });

  test("refuses a piece whose keys do not ascend", async () => {
    await assert.rejects(recut(TableType, [{ elements: [[key(2), row(2)], [key(1), row(1)]] }]), /must ascend strictly in East order/);
    await assert.rejects(recut(NamesType, [{ elements: [key(1), key(1)] }]), /must ascend strictly in East order/);
  });

  test("refuses a segment that is not the one its reference describes", async () => {
    const blob = encodeBeast2PagedFor(TableType)(cases[0]!.valueOf(cases[0]!.elements.slice(0, 5_000)) as never);
    const refs = refsOf(TableType, blob);
    const opening = { elements: [[key(0), row(0)]] };
    await assert.rejects(recut(TableType, [opening, { segments: [{ ...refs[1]!, count: refs[1]!.count + 1 }] }]), /reference says/);
    await assert.rejects(recut(TableType, [opening, { segments: [{ ...refs[1]!, count: 0 }] }]), /at least one element/);

    const names = encodeBeast2PagedFor(NamesType)(new SortedSet([key(1)], compareFor(StringType)));
    await assert.rejects(recut(TableType, [opening, { segments: refsOf(NamesType, names) }]), /recut: a segment holds/);
  });

  test("refuses a type that is not a collection", () => {
    assert.throws(() => recutBeast2For(IntegerType), /Array, Set or Dict/);
  });
});
