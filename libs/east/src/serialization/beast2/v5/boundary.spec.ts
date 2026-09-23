/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The content-defined segment boundary: the hash and its pinned vectors, the
 * size-aware threshold and the bounds, and the properties the segment-object
 * layout stands on — segmentation is a pure function of the value, a one-row
 * edit re-cuts one segment (for an Array as much as a Dict), wide rows cut near
 * the byte target, and a standalone segment encode is byte-identical to carving
 * that segment out of the whole blob.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { IntegerType, StringType, ArrayType, SetType, DictType, StructType, BlobType } from "../../../types.js";
import { compareFor } from "../../../comparison.js";
import { SortedMap, SortedSet } from "../../../index.js";
import {
  Beast2ElementWriter,
  encodeBeast2PagedFor,
  encodeBeast2SegmentsFor,
  openBeast2PagesFor,
  decodeBeast2For,
  readBeast2Extents,
  readBeast2SegmentLogicalBytes,
  carveBeast2,
  spliceBeast2,
  fnv1a64,
  segmentBoundaryHash,
  isSegmentBoundary,
  isContentCut,
  segmentRuleFor,
  segmentKeyTypeOf,
  encodeBeast2FenceFor,
  decodeBeast2FenceFor,
  SegmentCutter,
  SEGMENT_MIN_COUNT,
  SEGMENT_TARGET_COUNT,
  SEGMENT_MAX_COUNT,
  SEGMENT_MIN_BYTES,
  SEGMENT_TARGET_BYTES,
  SEGMENT_MAX_BYTES,
  SEGMENT_RULE_KEYED,
  SEGMENT_RULE_ARRAY,
  type Beast2Segment,
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

/** Every segment's fence bytes, element count and logical size, from a
 *  stored blob. */
function geometry(blob: Uint8Array, type: typeof TableType): { fences: Uint8Array[]; counts: number[]; sizes: number[] } {
  const pages = openBeast2PagesFor(type)(blob);
  const fence = encodeBeast2FenceFor(segmentKeyTypeOf(type)!);
  const fences: Uint8Array[] = [];
  for (let i = 0; i < pages.segmentCount; i++) fences.push(fence(pages.fence(i)));
  return { fences, counts: [...pages.counts], sizes: readBeast2SegmentLogicalBytes(blob) };
}

/** Each segment's frame bytes, which is what a segment object stores. */
function segmentFrames(blob: Uint8Array): string[] {
  const extents = readBeast2Extents(blob);
  return extents.offsets.map((offset, i) =>
    Buffer.from(blob.subarray(offset, i + 1 < extents.offsets.length ? extents.offsets[i + 1] : extents.segmentsEnd)).toString("hex"));
}

/** How many of `after`'s segments `before` does not hold. */
function newSegments(before: Uint8Array, after: Uint8Array): number {
  const held = new Set(segmentFrames(before));
  return segmentFrames(after).filter((frame) => !held.has(frame)).length;
}

/** The first `k0000000`-style key whose boundary hash falls under the narrow
 *  threshold. */
function narrowBoundaryKey(): string {
  const fence = encodeBeast2FenceFor(StringType);
  for (let i = 0; ; i++) {
    const key = `k${String(i).padStart(7, "0")}`;
    if (isSegmentBoundary(segmentBoundaryHash(fence(key)), 1, 1)) return key;
  }
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

    test("agrees with the byte-by-byte 64-bit hash", () => {
      // The hash runs in 32-bit words; it must be the plain 64-bit recurrence,
      // or every type-section hash moves.
      const reference = (bytes: Uint8Array): bigint => {
        let hash = 0xcbf29ce484222325n;
        for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
        return hash;
      };
      let seed = 0x9e3779b9;
      for (let n = 0; n < 20_000; n++) {
        const bytes = new Uint8Array(1 + (n % 40));
        for (let i = 0; i < bytes.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          bytes[i] = seed >>> 24;
        }
        assert.equal(fnv1a64(bytes), reference(bytes));
      }
    });
  });

  describe("the boundary hash", () => {
    test("matches the pinned vectors", () => {
      // Pinned in east-c's tests/test_beast2_boundary.c as well.
      const of = (s: string): number => segmentBoundaryHash(new TextEncoder().encode(s));
      assert.equal(of(""), 0x2c773e2c);
      assert.equal(of("a"), 0xa3eabd3f);
      assert.equal(of("foobar"), 0x1f341994);
      assert.equal(of("k0000000"), 0xc8ca7941);
    });

    test("is murmur3's finalizer over the FNV-1a hash's low word", () => {
      const finalize = (h: number): number => {
        h ^= h >>> 16;
        h = Math.imul(h, 0x85ebca6b);
        h ^= h >>> 13;
        h = Math.imul(h, 0xc2b2ae35);
        h ^= h >>> 16;
        return h >>> 0;
      };
      let seed = 0x2545f491;
      for (let n = 0; n < 5_000; n++) {
        const bytes = new Uint8Array(n % 64);
        for (let i = 0; i < bytes.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          bytes[i] = seed >>> 24;
        }
        assert.equal(segmentBoundaryHash(bytes), finalize(Number(fnv1a64(bytes) & 0xffffffffn)));
      }
    });
  });

  describe("the threshold", () => {
    test("admits one narrow element in the target count", () => {
      const threshold = 2 ** 32 / SEGMENT_TARGET_COUNT;
      assert.equal(isSegmentBoundary(threshold - 1, SEGMENT_MIN_COUNT, 16 * SEGMENT_MIN_COUNT), true);
      assert.equal(isSegmentBoundary(threshold, SEGMENT_MIN_COUNT, 16 * SEGMENT_MIN_COUNT), false);
    });

    test("rises with the open segment's average element size", () => {
      // An average of 64 KiB is one sixteenth of the byte target, so one
      // element in sixteen starts a segment.
      const threshold = 2 ** 32 / 16;
      assert.equal(isSegmentBoundary(threshold - 1, 2, 2 * 64 * 1024), true);
      assert.equal(isSegmentBoundary(threshold, 2, 2 * 64 * 1024), false);
    });

    test("makes every element a boundary at an average of the byte target", () => {
      assert.equal(isSegmentBoundary(0xffffffff, 1, SEGMENT_TARGET_BYTES), true);
      assert.equal(isSegmentBoundary(0xffffffff, 1, SEGMENT_TARGET_BYTES - 1), false);
    });
  });

  describe("the rule id", () => {
    test("is keyed for Set and Dict roots and element-hashed for Array roots", () => {
      assert.equal(segmentRuleFor(TableType), SEGMENT_RULE_KEYED);
      assert.equal(segmentRuleFor(SetType(StringType)), SEGMENT_RULE_KEYED);
      assert.equal(segmentRuleFor(ArrayType(RowType)), SEGMENT_RULE_ARRAY);
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
    const narrow = new Uint8Array([0x61]);

    test("never starts a segment at the first element", () => {
      const cutter = new SegmentCutter();
      const fence = encodeBeast2FenceFor(StringType);
      assert.equal(cutter.startsSegment(8, fence(narrowBoundaryKey())), false);
      assert.equal(cutter.openCount, 1);
      assert.equal(cutter.openBytes, 8);
    });

    test("forces a cut at the maximum count", () => {
      // A hash no threshold admits: only the bound can cut.
      const cutter = new SegmentCutter();
      const never = new Uint8Array(0);
      assert.ok(!isSegmentBoundary(segmentBoundaryHash(never), SEGMENT_MAX_COUNT, SEGMENT_MAX_COUNT));
      let cuts = 0;
      for (let i = 0; i < SEGMENT_MAX_COUNT * 2; i++) {
        if (cutter.startsSegment(1, never)) {
          cuts++;
          assert.equal(i % SEGMENT_MAX_COUNT, 0, `cut at element ${i}`);
        }
      }
      assert.equal(cuts, 1);
      assert.equal(cutter.openCount, SEGMENT_MAX_COUNT);
    });

    test("forces a cut at the maximum bytes, and never splits an element", () => {
      const cutter = new SegmentCutter();
      const never = new Uint8Array(0);
      assert.equal(cutter.startsSegment(SEGMENT_MAX_BYTES + 1, never), false);
      assert.equal(cutter.startsSegment(1, never), true, "an element wider than the maximum is a segment of its own");
      assert.equal(cutter.openBytes, 1);
    });

    test("ignores a boundary hash below the minimum", () => {
      const fence = encodeBeast2FenceFor(StringType);
      const cutter = new SegmentCutter();
      cutter.startsSegment(1, narrow);
      assert.equal(cutter.startsSegment(1, fence(narrowBoundaryKey())), false);
    });

    test("consults the hash once the open segment holds the minimum bytes", () => {
      const fence = encodeBeast2FenceFor(StringType);
      const cutter = new SegmentCutter();
      cutter.startsSegment(SEGMENT_MIN_BYTES, narrow);
      assert.equal(cutter.startsSegment(1, fence(narrowBoundaryKey())), true);
    });
  });

  describe("the element writer", () => {
    test("segments inside the pinned bounds", () => {
      const blob = encodeBeast2PagedFor(TableType)(table(50_000));
      const { counts, sizes } = geometry(blob, TableType);
      assert.ok(counts.length > 1, "50k rows must not be one segment");
      for (let i = 0; i < counts.length - 1; i++) {
        assert.ok(counts[i]! >= SEGMENT_MIN_COUNT || sizes[i]! >= SEGMENT_MIN_BYTES, `segment ${i} holds ${counts[i]}`);
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
      assert.equal(readBeast2Extents(before).offsets.length, readBeast2Extents(after).offsets.length);
      assert.equal(newSegments(before, after), 1);
    });

    test("re-cuts O(1) Array segments for an edit, and for an insert at the front", () => {
      const type = ArrayType(RowType);
      const rows = Array.from({ length: 20_000 }, (_, i) => ({ id: BigInt(i), name: `row-${i}` }));
      const before = encodeBeast2PagedFor(type)(rows);
      const edited = rows.slice();
      edited[9_000] = { id: 9_000n, name: "edited" };
      assert.equal(newSegments(before, encodeBeast2PagedFor(type)(edited)), 1);
      // An insert shifts every element after it, but a cut the hash placed
      // stays at its element: only the segments before the first such cut
      // change. Here the first segment is forced out at the maximum count, a
      // cut that moves with the insert, so the one after it changes too.
      assert.ok(openBeast2PagesFor(type)(before).counts[0] === SEGMENT_MAX_COUNT);
      assert.equal(newSegments(before, encodeBeast2PagedFor(type)([{ id: -1n, name: "first" }, ...rows])), 2);
    });

    test("cuts wide rows near the byte target rather than at a count", () => {
      const type = DictType(StringType, BlobType);
      const rows = new Map<string, Uint8Array>();
      for (let i = 0; i < 64; i++) rows.set(`r${String(i).padStart(3, "0")}`, new Uint8Array(256 * 1024).fill(i));
      const blob = encodeBeast2PagedFor(type, { codec: "none" })(rows);
      const sizes = readBeast2SegmentLogicalBytes(blob);
      assert.ok(sizes.length > 4, `16 MiB of rows must not be ${sizes.length} segments`);
      for (let i = 0; i < sizes.length - 1; i++) {
        assert.ok(sizes[i]! <= SEGMENT_MAX_BYTES + 256 * 1024 + 16, `segment ${i} is ${sizes[i]} bytes`);
      }
      assert.ok(isContentCut(geometry(blob, type as never).fences, [...readBeast2Extents(blob).counts], sizes));
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
      const { fences, counts, sizes } = geometry(blob as Uint8Array, type as never);
      assert.ok(counts.length > 1);
      assert.ok(isContentCut(fences, counts, sizes));
    });

    test("writes encoded elements to the same bytes as decoded ones", () => {
      const type = TableKeyedType;
      const key = encodeBeast2FenceFor(StringType);
      const value = encodeBeast2FenceFor(IntegerType);
      const fromValues: Uint8Array[] = [];
      const fromBytes: Uint8Array[] = [];
      const a = new Beast2ElementWriter(type, (b) => fromValues.push(b.slice()));
      const b = new Beast2ElementWriter(type, (bytes) => fromBytes.push(bytes.slice()));
      for (const [k, v] of parityTable()) {
        a.add([k, v]);
        const keyBytes = key(k);
        const element = new Uint8Array(keyBytes.length + 10);
        element.set(keyBytes);
        const valueBytes = value(v);
        element.set(valueBytes, keyBytes.length);
        b.addEncoded(element.subarray(0, keyBytes.length + valueBytes.length), keyBytes.length);
      }
      a.finish();
      b.finish();
      assert.deepEqual(Buffer.concat(fromBytes), Buffer.concat(fromValues));
    });

    test("refuses a key that does not ascend", () => {
      const writer = new Beast2ElementWriter(TableKeyedType, () => {});
      writer.add(["b", 1n]);
      assert.throws(() => writer.add(["a", 2n]), /strictly ascending/);
      assert.throws(() => writer.add(["b", 2n]), /strictly ascending/);
    });

    test("is left as it was by an element that fails to encode", () => {
      const chunks: Uint8Array[] = [];
      const writer = new Beast2ElementWriter(TableKeyedType, (b) => chunks.push(b.slice()));
      writer.add(["a", 1n]);
      assert.throws(() => writer.add(["b", "not an integer" as never]));
      writer.add(["b", 2n]);
      writer.finish();
      assert.deepEqual([...decodeBeast2For(TableKeyedType)(Buffer.concat(chunks))], [["a", 1n], ["b", 2n]]);
    });

    test("hands each segment over as the blob carving it out of the whole gives", () => {
      const value = table(20_000);
      const blob = encodeBeast2PagedFor(TableType)(value);
      const extents = readBeast2Extents(blob);
      const { fences, counts, sizes } = geometry(blob, TableType);
      const segments: Beast2Segment[] = [];
      const writer = new Beast2ElementWriter(TableType, { segment: (segment) => { segments.push(segment); } });
      for (const entry of value) writer.add(entry);
      writer.finish();
      assert.deepEqual(writer.header, blob.subarray(0, extents.prefixEnd));
      assert.equal(writer.segments, counts.length);
      assert.equal(segments.length, counts.length);
      for (let i = 0; i < segments.length; i++) {
        assert.deepEqual(segments[i]!.blob, carveBeast2(blob, i, i + 1, extents), `segment ${i}`);
        assert.equal(segments[i]!.count, counts[i]);
        assert.deepEqual(segments[i]!.fence, fences[i]);
        assert.equal(segments[i]!.logicalBytes, sizes[i]);
      }
    });

    test("hands an Array's segments over with empty fences, and an empty collection's none", () => {
      const type = ArrayType(RowType);
      const rows = Array.from({ length: 5_000 }, (_, i) => ({ id: BigInt(i), name: `row-${i}` }));
      const segments: Beast2Segment[] = [];
      const writer = new Beast2ElementWriter(type, { segment: (segment) => { segments.push(segment); } });
      for (const row of rows) writer.add(row);
      writer.finish();
      assert.ok(segments.length > 1);
      assert.ok(segments.every((segment) => segment.fence.length === 0));
      assert.deepEqual(spliceBeast2(segments.map((segment) => segment.blob)), encodeBeast2PagedFor(type)(rows));

      const none: Beast2Segment[] = [];
      const empty = new Beast2ElementWriter(type, { segment: (segment) => { none.push(segment); } });
      empty.finish();
      assert.equal(none.length, 0);
      const blob = encodeBeast2PagedFor(type)([]);
      assert.deepEqual(empty.header, blob.subarray(0, readBeast2Extents(blob).prefixEnd));
    });
  });

  describe("isContentCut", () => {
    test("accepts what the writer writes", () => {
      const { fences, counts, sizes } = geometry(encodeBeast2PagedFor(TableType)(table(50_000)), TableType);
      assert.ok(isContentCut(fences, counts, sizes));
    });

    test("accepts a single segment", () => {
      const { fences, counts, sizes } = geometry(encodeBeast2PagedFor(TableType)(table(100)), TableType);
      assert.deepEqual(counts.length, 1);
      assert.ok(isContentCut(fences, counts, sizes));
    });

    test("rejects a blob batched by count", () => {
      const rows = [...table(50_000)];
      const batches: SortedMap<string, { id: bigint; name: string }>[] = [];
      for (let i = 0; i < rows.length; i += 1_000) batches.push(new SortedMap(rows.slice(i, i + 1_000), compareFor(StringType)));
      const { fences, counts, sizes } = geometry(encodeBeast2SegmentsFor(TableType)(batches), TableType);
      assert.ok(counts.length > 1);
      assert.equal(isContentCut(fences, counts, sizes), false);
    });

    test("rejects a segment below both minimums and one above the maximum count", () => {
      const { fences, counts, sizes } = geometry(encodeBeast2PagedFor(TableType)(table(50_000)), TableType);
      const short = [...counts];
      short[0] = SEGMENT_MIN_COUNT - 1;
      const narrowSizes = [...sizes];
      narrowSizes[0] = SEGMENT_MIN_BYTES - 1;
      assert.equal(isContentCut(fences, short, narrowSizes), false);
      const long = [...counts];
      long[0] = SEGMENT_MAX_COUNT + 1;
      assert.equal(isContentCut(fences, long, sizes), false);
    });

    test("accepts a segment forced out at a maximum, whose next fence is not a boundary", () => {
      const fence = encodeBeast2FenceFor(StringType);
      const plain = ["a", "b"].map(fence);
      assert.equal(isSegmentBoundary(segmentBoundaryHash(plain[1]!), SEGMENT_MAX_COUNT - 1, SEGMENT_MAX_COUNT - 1), false);
      assert.ok(isContentCut(plain, [SEGMENT_MAX_COUNT, 10], [SEGMENT_MAX_COUNT, 10]));
      assert.ok(isContentCut(plain, [3, 10], [SEGMENT_MAX_BYTES, 10]));
      assert.equal(isContentCut(plain, [SEGMENT_MAX_COUNT - 1, 10], [SEGMENT_MAX_COUNT - 1, 10]), false);
    });

    test("refuses mismatched lengths", () => {
      const fence = encodeBeast2FenceFor(StringType);
      assert.equal(isContentCut([fence("a")], [1], []), false);
    });
  });

  describe("three-runtime parity", () => {
    // The claim the segment-object layout rests on: east, east-c and east-py
    // (which binds east-c's writer) cut the same value at the same elements,
    // so a state shares every segment a write did not touch and a manifest
    // one runtime maintains equals the one another rebuilds.
    //
    // The same fixtures and the same digests are pinned in east-c's
    // `tests/test_beast2_boundary.c`. A change on either side fails both.
    const digestOf = (counts: readonly number[]): string =>
      fnv1a64(new TextEncoder().encode(counts.join(","))).toString(16).padStart(16, "0");

    test("cuts the 50,000-key Dict where east-c cuts it", () => {
      const blob = encodeBeast2PagedFor(TableKeyedType)(parityTable());
      const pages = openBeast2PagesFor(TableKeyedType)(blob);
      assert.equal(pages.segmentCount, 34);
      assert.equal(digestOf(pages.counts), "16ef9c38c923c55f");
    });

    test("cuts the 50,000-element Set where east-c cuts it", () => {
      const type = SetType(StringType);
      const elements = new SortedSet(
        Array.from({ length: 50_000 }, (_, i) => `e${String(i).padStart(7, "0")}`),
        compareFor(StringType),
      );
      const pages = openBeast2PagesFor(type)(encodeBeast2PagedFor(type)(elements));
      assert.equal(pages.segmentCount, 49);
      assert.equal(digestOf(pages.counts), "d9cfbd0cb241b783");
    });

    test("cuts the 50,000-element Array where east-c cuts it", () => {
      const type = ArrayType(StringType);
      const elements = Array.from({ length: 50_000 }, (_, i) => `a${String(i).padStart(7, "0")}`);
      const pages = openBeast2PagesFor(type)(encodeBeast2PagedFor(type)(elements));
      assert.equal(pages.segmentCount, 44);
      assert.equal(digestOf(pages.counts), "b3f3e8599f56443d");
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

    test("reports its logical size from the frame header", () => {
      // With codec none a frame's payload IS its logical bytes: the count's
      // varint, then the elements back to back.
      const type = SetType(StringType);
      const elements = Array.from({ length: 3_000 }, (_, i) => `e${String(i).padStart(6, "0")}`);
      const fence = encodeBeast2FenceFor(StringType);
      const chunks: Uint8Array[] = [];
      const writer = new Beast2ElementWriter(type, (b) => chunks.push(b.slice()), { codec: "none" });
      for (const e of elements) writer.add(e);
      writer.finish();
      const blob = new Uint8Array(Buffer.concat(chunks));
      const counts = readBeast2Extents(blob).counts;
      const sizes = readBeast2SegmentLogicalBytes(blob);
      let at = 0;
      for (let i = 0; i < counts.length; i++) {
        let expected = 0;
        for (let j = 0; j < counts[i]!; j++) expected += fence(elements[at++]!).length;
        assert.equal(sizes[i], expected, `segment ${i}`);
      }
      const reader = { size: blob.length, read: (offset: number, length: number) => blob.subarray(offset, offset + length) };
      assert.deepEqual(readBeast2SegmentLogicalBytes(reader), sizes);
    });
  });
});
