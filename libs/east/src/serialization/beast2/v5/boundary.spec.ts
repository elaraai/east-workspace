/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The content-defined segment boundary: the hash and its pinned vectors, the
 * bounds, and the three properties the segment-object layout stands on —
 * segmentation is a pure function of the value, a one-row edit re-cuts one
 * segment, and a standalone segment encode is byte-identical to carving that
 * segment out of the whole blob.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { IntegerType, StringType, ArrayType, SetType, DictType, StructType } from "../../../types.js";
import { compareFor } from "../../../comparison.js";
import { SortedMap, SortedSet } from "../../../index.js";
import {
  encodeBeast2PagedFor,
  encodeBeast2SegmentsFor,
  openBeast2PagesFor,
  decodeBeast2For,
  readBeast2Extents,
  carveBeast2,
  spliceBeast2,
  fnv1a64,
  isSegmentBoundaryKey,
  isContentCut,
  segmentRuleFor,
  segmentKeyTypeOf,
  encodeBeast2FenceFor,
  decodeBeast2FenceFor,
  usesContentBoundary,
  SegmentCutter,
  SEGMENT_MIN_COUNT,
  SEGMENT_MAX_COUNT,
  SEGMENT_RULE_KEYED,
  SEGMENT_RULE_POSITIONAL,
} from "../index.js";
import { toEastTypeValue } from "../../../type_of_type.js";

const RowType = StructType({ id: IntegerType, name: StringType });
const TableType = DictType(StringType, RowType);

/** The cross-runtime parity fixture: 50,000 `k0000000`-style keys to their
 *  index. Kept narrow (a scalar value) so the C twin builds the same value
 *  with no struct layout to agree on. */
const TableKeyedType = DictType(StringType, IntegerType);
function parityTable(): SortedMap<string, bigint> {
  return new SortedMap(
    Array.from({ length: 50_000 }, (_, i) => [`k${String(i).padStart(7, "0")}`, BigInt(i)] as [string, bigint]),
    compareFor(StringType),
  );
}

/** `n` rows keyed `k0000000`… in canonical order. */
function table(n: number, mark?: { at: string; name: string }): SortedMap<string, { id: bigint; name: string }> {
  const entries: [string, { id: bigint; name: string }][] = [];
  for (let i = 0; i < n; i++) {
    const key = `k${String(i).padStart(7, "0")}`;
    entries.push([key, { id: BigInt(i), name: mark?.at === key ? mark.name : `row-${i}` }]);
  }
  return new SortedMap(entries, compareFor(StringType));
}

/** Every segment's fence bytes and element count, from a stored blob. */
function geometry(blob: Uint8Array, type: typeof TableType): { fences: Uint8Array[]; counts: number[] } {
  const pages = openBeast2PagesFor(type)(blob);
  const fence = encodeBeast2FenceFor(segmentKeyTypeOf(type)!);
  const fences: Uint8Array[] = [];
  for (let i = 0; i < pages.segmentCount; i++) fences.push(fence(pages.fence(i)));
  return { fences, counts: [...pages.counts] };
}

describe("beast2 v5 content-defined boundaries", () => {
  describe("fnv1a64", () => {
    test("matches the reference vectors", () => {
      const of = (s: string): bigint => fnv1a64(new TextEncoder().encode(s));
      assert.equal(of(""), 0xcbf29ce484222325n);
      assert.equal(of("a"), 0xaf63dc4c8601ec8cn);
      assert.equal(of("foobar"), 0x85944171f73967e8n);
    });

    test("stays inside 64 bits over a long input", () => {
      const hash = fnv1a64(new Uint8Array(4096).fill(0xff));
      assert.ok(hash >= 0n && hash <= 0xffffffffffffffffn);
    });

    test("agrees with the byte-by-byte 64-bit hash, and the boundary test with its low bits", () => {
      // The hash runs in 32-bit words and the boundary test in the low word
      // alone; both must be the plain 64-bit recurrence, or every runtime's
      // cuts move.
      const reference = (bytes: Uint8Array): bigint => {
        let hash = 0xcbf29ce484222325n;
        for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
        return hash;
      };
      let seed = 0x9e3779b9;
      let boundaries = 0;
      for (let n = 0; n < 20_000; n++) {
        const bytes = new Uint8Array(1 + (n % 40));
        for (let i = 0; i < bytes.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          bytes[i] = seed >>> 24;
        }
        const hash = reference(bytes);
        assert.equal(fnv1a64(bytes), hash);
        const boundary = (hash & 1023n) === 0n;
        assert.equal(isSegmentBoundaryKey(bytes), boundary);
        if (boundary) boundaries++;
      }
      assert.ok(boundaries > 5, `the corpus must hold boundary keys to agree on, got ${boundaries}`);
    });
  });

  describe("the rule id", () => {
    test("is keyed for Set and Dict roots and positional for Array roots", () => {
      assert.equal(segmentRuleFor(TableType), SEGMENT_RULE_KEYED);
      assert.equal(segmentRuleFor(SetType(StringType)), SEGMENT_RULE_KEYED);
      assert.equal(segmentRuleFor(ArrayType(RowType)), SEGMENT_RULE_POSITIONAL);
    });

    test("refuses a non-collection root", () => {
      assert.throws(() => segmentRuleFor(IntegerType), /Array, Set or Dict roots/);
    });

    test("names the key type a fence holds", () => {
      assert.deepEqual(segmentKeyTypeOf(TableType), toEastTypeValue(StringType));
      assert.deepEqual(segmentKeyTypeOf(SetType(RowType)), toEastTypeValue(RowType));
      assert.equal(segmentKeyTypeOf(ArrayType(RowType)), null);
    });
  });

  describe("fence bytes", () => {
    test("round-trip and depend on the key alone", () => {
      const encode = encodeBeast2FenceFor(RowType);
      const decode = decodeBeast2FenceFor(RowType);
      const row = { id: 7n, name: "seven" };
      assert.deepEqual(decode(encode(row)), row);
      // A second encode through the same closure must not carry state from the
      // first — a container REF would make a key's bytes depend on its position.
      assert.deepEqual(encode(row), encode(row));
    });

    test("are the key's own bytes, which the next encode leaves alone", () => {
      // The encoder reuses one writer across keys; what it hands back is kept
      // — in a manifest, a cache of fences — so it must be a copy of the key's
      // bytes and nothing more.
      const encode = encodeBeast2FenceFor(StringType);
      const first = encode("first");
      const kept = first.slice();
      encode("a much longer second key, long enough to overwrite a shared buffer");
      assert.deepEqual(first, kept);
      assert.equal(first.buffer.byteLength, first.byteLength, "a fence holds only its own bytes");
    });

    test("refuse trailing bytes", () => {
      const bytes = encodeBeast2FenceFor(StringType)("abc");
      const padded = new Uint8Array(bytes.length + 1);
      padded.set(bytes);
      assert.throws(() => decodeBeast2FenceFor(StringType)(padded), /bytes after the encoded key/);
    });
  });

  describe("the cutter", () => {
    test("never starts a segment at the first element", () => {
      const cutter = new SegmentCutter(StringType);
      assert.equal(cutter.startsSegment("k0000000"), false);
      assert.equal(cutter.openCount, 1);
    });

    test("forces a cut at the maximum", () => {
      const cutter = new SegmentCutter(IntegerType);
      let cuts = 0;
      for (let i = 0n; i < BigInt(SEGMENT_MAX_COUNT) * 2n; i++) {
        if (cutter.startsSegment(i)) cuts++;
      }
      assert.ok(cuts >= 1, "a run twice the maximum must cut at least once");
      assert.ok(cutter.openCount <= SEGMENT_MAX_COUNT);
    });

    test("ignores boundary keys below the minimum", () => {
      const fence = encodeBeast2FenceFor(StringType);
      // Find a boundary key, then feed it as the second element: too early.
      let boundary = "";
      for (let i = 0; boundary === ""; i++) {
        const key = `k${String(i).padStart(7, "0")}`;
        if (isSegmentBoundaryKey(fence(key))) boundary = key;
      }
      const cutter = new SegmentCutter(StringType);
      cutter.startsSegment("a");
      assert.equal(cutter.startsSegment(boundary), false);
    });
  });

  describe("the paged encoder", () => {
    test("cuts Set/Dict roots by content and Array roots positionally", () => {
      const dictType = toEastTypeValue(TableType);
      assert.equal(usesContentBoundary(dictType), true);
      assert.equal(usesContentBoundary(dictType, { batchSize: 10 }), false);
      assert.equal(usesContentBoundary(dictType, { targetSegmentBytes: 1024 }), false);
      assert.equal(usesContentBoundary(dictType, { batchSize: 10, boundary: "content" }), true);
      assert.equal(usesContentBoundary(toEastTypeValue(ArrayType(RowType))), false);
    });

    test("segments inside the pinned bounds", () => {
      const blob = encodeBeast2PagedFor(TableType)(table(50_000));
      const { counts } = geometry(blob, TableType);
      assert.ok(counts.length > 1, "50k rows must not be one segment");
      for (let i = 0; i < counts.length - 1; i++) {
        assert.ok(counts[i]! >= SEGMENT_MIN_COUNT, `segment ${i} holds ${counts[i]}`);
        assert.ok(counts[i]! <= SEGMENT_MAX_COUNT, `segment ${i} holds ${counts[i]}`);
      }
    });

    test("is a pure function of the value, not of insertion order", () => {
      const ascending = encodeBeast2PagedFor(TableType)(table(20_000));
      const shuffled = new Map<string, { id: bigint; name: string }>();
      for (const [k, v] of [...table(20_000)].reverse()) shuffled.set(k, v);
      assert.deepEqual(encodeBeast2PagedFor(TableType)(shuffled), ascending);
    });

    test("re-cuts exactly one segment for a one-row edit", () => {
      const before = encodeBeast2PagedFor(TableType)(table(20_000));
      const after = encodeBeast2PagedFor(TableType)(table(20_000, { at: "k0009000", name: "edited" }));
      const a = openBeast2PagesFor(TableType)(before);
      const b = openBeast2PagesFor(TableType)(after);
      assert.equal(a.segmentCount, b.segmentCount);
      const extentsA = readBeast2Extents(before);
      const extentsB = readBeast2Extents(after);
      let differing = 0;
      for (let i = 0; i < a.segmentCount; i++) {
        if (Buffer.compare(
          Buffer.from(carveBeast2(before, i, i + 1, extentsA)),
          Buffer.from(carveBeast2(after, i, i + 1, extentsB)),
        ) !== 0) differing++;
      }
      assert.equal(differing, 1);
    });

    test("holds a short collection in one segment", () => {
      const blob = encodeBeast2PagedFor(TableType)(table(SEGMENT_MIN_COUNT - 1));
      assert.equal(openBeast2PagesFor(TableType)(blob).segmentCount, 1);
    });

    test("decodes to the value it was given", () => {
      const value = table(5_000);
      const decoded = decodeBeast2For(TableType)(encodeBeast2PagedFor(TableType)(value)) as Map<string, unknown>;
      assert.equal(decoded.size, value.size);
      assert.deepEqual(decoded.get("k0004999"), value.get("k0004999"));
    });

    test("cuts a Set root by its elements", () => {
      const elements = new SortedSet(
        Array.from({ length: 10_000 }, (_, i) => `e${String(i).padStart(6, "0")}`),
        compareFor(StringType),
      );
      const type = SetType(StringType);
      const blob = encodeBeast2PagedFor(type)(elements);
      const { fences, counts } = geometry(blob as Uint8Array, type as never);
      assert.ok(counts.length > 1);
      assert.ok(isContentCut(fences, counts));
    });
  });

  describe("isContentCut", () => {
    test("accepts what the encoder writes", () => {
      const { fences, counts } = geometry(encodeBeast2PagedFor(TableType)(table(50_000)), TableType);
      assert.ok(isContentCut(fences, counts));
    });

    test("accepts a single segment", () => {
      const { fences, counts } = geometry(encodeBeast2PagedFor(TableType)(table(100)), TableType);
      assert.deepEqual(counts.length, 1);
      assert.ok(isContentCut(fences, counts));
    });

    test("rejects a positionally batched blob", () => {
      const { fences, counts } = geometry(
        encodeBeast2PagedFor(TableType, { batchSize: 1_000 })(table(50_000)), TableType);
      assert.ok(counts.length > 1);
      assert.equal(isContentCut(fences, counts), false);
    });

    test("rejects a segment below the minimum and one above the maximum", () => {
      const { fences, counts } = geometry(encodeBeast2PagedFor(TableType)(table(50_000)), TableType);
      const short = [...counts];
      short[0] = SEGMENT_MIN_COUNT - 1;
      assert.equal(isContentCut(fences, short), false);
      const long = [...counts];
      long[0] = SEGMENT_MAX_COUNT + 1;
      assert.equal(isContentCut(fences, long), false);
    });

    test("accepts a segment forced out at the maximum, whose fence is not a boundary key", () => {
      // A long run of keys with no boundary among them: the cut is the maximum,
      // and the next segment's fence hashes to nothing in particular.
      const fence = encodeBeast2FenceFor(StringType);
      const plain = ["a", "b"].map(fence);
      assert.equal(isSegmentBoundaryKey(plain[1]!), false);
      assert.ok(isContentCut(plain, [SEGMENT_MAX_COUNT, 10]));
      assert.equal(isContentCut(plain, [SEGMENT_MAX_COUNT - 1, 10]), false);
    });
  });

  describe("three-runtime parity", () => {
    // The claim the segment-object layout rests on: east, east-c and east-py
    // (which binds east-c's encoder) cut the same value at the same keys, so
    // a state shares every segment a write did not touch and a manifest one
    // runtime maintains equals the one another rebuilds.
    //
    // The same fixtures and the same digests are pinned in east-c's
    // `tests/test_beast2_boundary.c`. A change on either side fails both.
    const digestOf = (counts: readonly number[]): string =>
      fnv1a64(new TextEncoder().encode(counts.join(","))).toString(16).padStart(16, "0");

    test("cuts the 50,000-key Dict where east-c cuts it", () => {
      const blob = encodeBeast2PagedFor(TableKeyedType)(parityTable());
      const pages = openBeast2PagesFor(TableKeyedType)(blob);
      assert.equal(pages.segmentCount, 53);
      assert.equal(digestOf(pages.counts), "20251373dc14fe4e");
    });

    test("cuts the 50,000-element Set where east-c cuts it", () => {
      const type = SetType(StringType);
      const elements = new SortedSet(
        Array.from({ length: 50_000 }, (_, i) => `e${String(i).padStart(7, "0")}`),
        compareFor(StringType),
      );
      const pages = openBeast2PagesFor(type)(encodeBeast2PagedFor(type)(elements));
      assert.equal(pages.segmentCount, 41);
      assert.equal(digestOf(pages.counts), "cb54163306a3a43d");
    });
  });

  describe("a standalone segment", () => {
    test("is byte-identical to carving that segment out of the whole blob", () => {
      const value = table(20_000);
      const blob = encodeBeast2PagedFor(TableType)(value);
      const extents = readBeast2Extents(blob);
      const pages = openBeast2PagesFor(TableType)(blob);
      const encodeSegments = encodeBeast2SegmentsFor(TableType);
      assert.ok(pages.segmentCount > 2);
      for (let i = 0; i < pages.segmentCount; i++) {
        assert.deepEqual(
          encodeSegments([pages.segment(i)]),
          carveBeast2(blob, i, i + 1, extents),
          `segment ${i}`,
        );
      }
    });

    test("splices back into the whole blob", () => {
      const blob = encodeBeast2PagedFor(TableType)(table(20_000));
      const extents = readBeast2Extents(blob);
      const segments = Array.from(
        { length: extents.offsets.length },
        (_, i) => carveBeast2(blob, i, i + 1, extents),
      );
      assert.deepEqual(spliceBeast2(segments), blob);
    });
  });
});
