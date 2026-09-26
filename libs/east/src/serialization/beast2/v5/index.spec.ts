/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v5 test suite — the segment-terminated record stream (#416).
 * Round-trips through the version-agnostic entry points, streaming writer /
 * segment iterator / pages, aliasing and cycles, source maps, well-known type
 * sections, canonical Set/Dict segment order, cross-runtime byte pins, and
 * hardening.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  NullType, BooleanType, IntegerType, FloatType, StringType, DateTimeType, BlobType,
  ArrayType, SetType, DictType, StructType, VariantType, OptionType,
  RefType, VectorType, MatrixType, FunctionType, AsyncFunctionType, RecursiveType,
  type EastType,
} from "../../../types.js";
import { toEastTypeValue, isTypeValueEqual, EastTypeType, EastTypeValueType, type EastTypeValue } from "../../../type_of_type.js";
import { IRType } from "../../../ir.js";
import { equalFor, compareFor } from "../../../comparison.js";
import { East, variant, ref, some, none, SortedMap, SortedSet } from "../../../index.js";
import { matrix } from "../../../containers/matrix.js";
import { BufferWriter, BufferReader } from "../../binary-utils.js";
import {
  encodeBeast2For,
  decodeBeast2For,
  decodeBeast2ForAsync,
  decodeBeast2,
  encodeEastIR,
  decodeEastIR,
  Beast2Writer,
  encodeBeast2SegmentsFor,
  encodeBeast2PagedFor,
  iterBeast2SegmentsFor,
  openBeast2PagesFor,
  readBeast2Extents,
  readBeast2Type,
  MAGIC_BYTES_V5,
} from "../index.js";
import { writeTypeSection, readTypeSection } from "./type-section.js";
import { writeSourceMapSectionV5, writeIndexAndFooter, FOOTER_MAGIC_V5 } from "./codec.js";
import { writeFrame, inflateRawSync } from "./frames.js";
import { deterministicDeflateRaw } from "./deflate.js";
import { inflateRawPure } from "./inflate.js";
import { deflateRawSync as zlibDeflateRawSync } from "node:zlib";

const V5 = { version: 5 as const };
const V5_PLAIN = { version: 5 as const, codec: "none" as const };
/** v5 is the encoder default, so writing v4 is the explicit request now. */
const V4 = { version: 4 as const };

/** Round-trip a value through the v5 whole-value encoder with both codecs. */
function roundTrip(type: EastType | EastTypeValue, value: any, label: string) {
  const eq = equalFor(type as EastType);
  for (const options of [V5_PLAIN, V5] as { version: 5; codec?: "none" | "deflate" }[]) {
    const bytes = encodeBeast2For(type as EastType, options)(value);
    assert.equal(bytes[7], 0x05, `${label}: v5 magic`);
    const decoded = decodeBeast2For(type as EastType)(bytes);
    assert.ok(eq(value, decoded), `${label}: round-trip (codec ${options.codec ?? "deflate"})`);
  }
}

// =============================================================================
// 1. Whole-value round-trips through the version-agnostic entry points
// =============================================================================

describe("Beast2 v5 — Round-trips", () => {
  test("primitives", () => {
    roundTrip(NullType, null, "null");
    roundTrip(BooleanType, true, "bool");
    roundTrip(IntegerType, -1234567890123n, "integer");
    roundTrip(FloatType, 3.141592653589793, "float");
    roundTrip(FloatType, Number.POSITIVE_INFINITY, "inf");
    roundTrip(StringType, "hello — ünïcode ✓", "string");
    roundTrip(DateTimeType, new Date(1721822400000), "datetime");
    roundTrip(BlobType, new Uint8Array([0, 1, 2, 250, 255]), "blob");
  });

  test("strings are inline (no dedup table) and repeated strings still round-trip", () => {
    const type = ArrayType(StringType);
    const value = ["repeat", "repeat", "repeat", "unique"];
    roundTrip(type, value, "repeated strings");
  });

  test("containers", () => {
    roundTrip(ArrayType(IntegerType), [1n, 2n, 3n], "array");
    roundTrip(ArrayType(IntegerType), [], "empty array");
    roundTrip(SetType(IntegerType), new Set([1n, 2n, 3n]), "set");
    roundTrip(DictType(StringType, IntegerType), new Map([["a", 1n], ["b", 2n]]), "dict");
    roundTrip(RefType(IntegerType), ref(42n), "ref");
    roundTrip(ArrayType(ArrayType(StringType)), [["a"], [], ["b", "c"]], "nested arrays");
  });

  test("struct / variant / option", () => {
    const S = StructType({ name: StringType, score: FloatType, tags: ArrayType(StringType) });
    roundTrip(S, { name: "x", score: 1.5, tags: ["t1", "t2"] }, "struct");
    const V = VariantType({ a: IntegerType, b: StringType });
    roundTrip(V, variant("b", "payload"), "variant");
    roundTrip(OptionType(IntegerType), some(5n), "some");
    roundTrip(OptionType(IntegerType), none, "none");
  });

  test("vector / matrix", () => {
    roundTrip(VectorType(FloatType), new Float64Array([1.5, -2.5, 3.25]), "float vector");
    roundTrip(VectorType(IntegerType), new BigInt64Array([1n, -2n, 3n]), "int vector");
    roundTrip(MatrixType(FloatType), matrix(new Float64Array([1, 2, 3, 4]), 2, 2), "matrix");
  });

  test("type values use the well-known EastTypeValueType section", () => {
    const typeValue = toEastTypeValue(StructType({ a: IntegerType, b: ArrayType(StringType) }));
    const bytes = encodeBeast2For(EastTypeValueType, V5_PLAIN)(typeValue);
    // Type section kind 1 (well-known), id 2 (EastTypeValueType).
    assert.equal(bytes[8], 1, "well-known kind");
    assert.equal(bytes[9], 2, "well-known id");
    const decoded = decodeBeast2For(EastTypeValueType)(bytes);
    assert.ok(equalFor(EastTypeValueType)(typeValue, decoded), "type value round-trip");
    // Self-describing decode resolves the registered schema without parsing.
    const auto = decodeBeast2(bytes);
    assert.ok(equalFor(EastTypeValueType)(auto.value, typeValue), "self-describing type value");
  });

  test("self-describing decode of a structural v5 blob", () => {
    const type = DictType(StringType, ArrayType(IntegerType));
    const value = new Map([["a", [1n, 2n]], ["b", []]]);
    const bytes = encodeBeast2For(type, V5_PLAIN)(value);
    const { type: rootType, value: decoded } = decodeBeast2(bytes);
    assert.ok(equalFor(EastTypeValueType)(rootType, toEastTypeValue(type)), "root type");
    assert.ok(equalFor(type)(decoded, value), "value");
  });

  test("one decoder closure accepts both container versions", () => {
    const type = ArrayType(StringType);
    const decode = decodeBeast2For(type);
    const v4 = encodeBeast2For(type, V4)(["v", "4"]);
    const v5 = encodeBeast2For(type, V5)(["v", "5"]);
    assert.equal(v4[7], 0x04);
    assert.equal(v5[7], 0x05);
    assert.deepEqual(decode(v4), ["v", "4"]);
    assert.deepEqual(decode(v5), ["v", "5"]);
  });

  test("async decoder round-trips deflate blobs", async () => {
    const type = ArrayType(StringType);
    const value = Array.from({ length: 200 }, (_, i) => `row-${i % 7}`);
    const bytes = encodeBeast2For(type, V5)(value);
    const decoded = await decodeBeast2ForAsync(type)(bytes);
    assert.deepEqual(decoded, value);
    // v4 through the async entry point too.
    assert.deepEqual(await decodeBeast2ForAsync(type)(encodeBeast2For(type)(["x"])), ["x"]);
  });
});

// =============================================================================
// 2. Aliasing and cycles
// =============================================================================

describe("Beast2 v5 — Aliasing", () => {
  test("shared containers encode once and decode to one shared object", () => {
    const inner = ArrayType(IntegerType);
    const type = ArrayType(inner);
    const shared = [1n, 2n, 3n];
    const value = [shared, shared, shared];
    const bytes = encodeBeast2For(type, V5_PLAIN)(value);
    const decoded = decodeBeast2For(type)(bytes) as bigint[][];
    assert.deepEqual(decoded, value);
    assert.ok(decoded[0] === decoded[1] && decoded[1] === decoded[2], "aliases share identity");
    // The alias must be a REF, not a re-encode: three copies would repeat the
    // element bytes; the blob must stay well below that.
    const unshared = encodeBeast2For(type, V5_PLAIN)([[1n, 2n, 3n], [1n, 2n, 3n], [1n, 2n, 3n]]);
    assert.ok(bytes.length < unshared.length, "aliased encoding is smaller");
  });

  test("a true cycle (root array containing a ref back to itself) round-trips", () => {
    // Ref<Array<Ref<...>>> pointing back at the root array — decode must
    // create-then-fill so the cycle reconnects in a single pass.
    const T = ArrayType(RefType(ArrayType(NullType)));
    const root: any[] = [];
    const cell = ref(root as any);
    root.push(cell);
    const bytes = encodeBeast2For(T, V5_PLAIN)(root as any);
    const decoded = decodeBeast2For(T)(bytes) as any[];
    assert.equal(decoded.length, 1);
    assert.ok(decoded[0].value === decoded, "cycle reconnected to the decoded root");
  });

  test("aliased ref cells decode to one shared cell", () => {
    const T = ArrayType(RefType(IntegerType));
    const a = ref(1n);
    const value = [a, a];
    const decoded = decodeBeast2For(T)(encodeBeast2For(T, V5_PLAIN)(value)) as { value: bigint }[];
    assert.ok(decoded[0] === decoded[1], "ref cells alias");
    decoded[0]!.value = 9n;
    assert.equal(decoded[1]!.value, 9n, "mutation visible through alias");
  });
});

// =============================================================================
// 3. IR + source maps
// =============================================================================

describe("Beast2 v5 — IR and source maps", () => {
  test("encodeEastIR(version 5) round-trips IR and source map", () => {
    const fn = East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b));
    const eastIR = fn.toIR();
    const v5 = encodeEastIR(eastIR, V5_PLAIN);
    assert.equal(v5[7], 0x05, "v5 magic");
    // Type section is the well-known IRType (kind 1, id 1).
    assert.equal(v5[8], 1, "well-known kind");
    assert.equal(v5[9], 1, "well-known id");
    const decoded = decodeEastIR(v5);
    const compiled = decoded.compile([]);
    assert.equal(compiled(2n, 40n), 42n);
    assert.ok(decoded.source_map, "source map decoded");
    assert.ok(decoded.source_map!.size >= 1n, "source map has entries");
    // The IR value (including loc ids) survives exactly — v4 and v5 decodes
    // of the same program must be identical.
    const fromV4 = decodeEastIR(encodeEastIR(eastIR));
    assert.deepEqual(JSON.parse(JSON.stringify(decoded.ir, bigintReplacer)), JSON.parse(JSON.stringify(fromV4.ir, bigintReplacer)), "v4 and v5 decode to identical IR");
  });

  test("function values in data round-trip and execute", () => {
    const T = FunctionType([IntegerType], IntegerType);
    const fn = East.function([IntegerType], IntegerType, ($, x) => x.multiply(3n));
    const compiled = East.compile(fn, []);
    const bytes = encodeBeast2For(T, V5_PLAIN)(compiled);
    const decoded = decodeBeast2For(T)(bytes) as (x: bigint) => bigint;
    assert.equal(decoded(14n), 42n);
  });
});

function bigintReplacer(_k: string, v: any) {
  return typeof v === "bigint" ? `${v}n` : v;
}

// =============================================================================
// 4. Streaming writer + iterator + canonical segment order
// =============================================================================

describe("Beast2 v5 — Streaming (#414/#416)", () => {
  // The SAME bytes are pinned in east-py's test_beast2_v5.py and east-c's
  // test_beast2_hardening.c: the three runtimes must produce and accept
  // identical v5 streams for this canonical fixture.
  const SHARED_HEX = "89456173740d0a0500050102010a00010000010100000505020161016200030301016300010100010215020801270000000000000089456173740d0af5";

  function writeAll<T extends EastType>(type: T, batches: any[], options?: any): Uint8Array {
    return encodeBeast2SegmentsFor(type, options)(batches);
  }

  test("array batches concatenate; bytes match the cross-runtime fixture", () => {
    const AT = ArrayType(StringType);
    const blob = writeAll(AT, [["a", "b"], ["c"], []], { codec: "none" });
    assert.equal(Buffer.from(blob).toString("hex"), SHARED_HEX, "pinned cross-runtime bytes");
    assert.deepEqual(decodeBeast2For(AT)(blob), ["a", "b", "c"]);
    assert.deepEqual(decodeBeast2For(AT)(Buffer.from(SHARED_HEX, "hex")), ["a", "b", "c"]);
  });

  test("the cross-runtime fixture pages identically in every runtime", () => {
    // Indexed + self-contained, so it is also the shared PAGING fixture:
    // east-c's test_beast2_hardening.c and east-py's test_beast2_v5.py assert
    // these same values against these same bytes, which is what proves the
    // three pagers agree rather than merely each being self-consistent.
    const AT = ArrayType(StringType);
    const pages = openBeast2PagesFor(AT)(Buffer.from(SHARED_HEX, "hex"));
    assert.equal(pages.segmentCount, 2);
    assert.equal(pages.elementCount, 3);
    assert.equal(pages.selfContained, true);
    assert.deepEqual([...pages.counts], [2, 1]);
    assert.deepEqual(pages.segment(0), ["a", "b"]);
    assert.deepEqual(pages.segment(1), ["c"]);
    assert.deepEqual([0, 1, 2].map(i => pages.element(i)), ["a", "b", "c"]);
  });

  test("writer streams through a sink with O(batch) buffering", () => {
    const AT = ArrayType(IntegerType);
    const chunks: Uint8Array[] = [];
    const writer = new Beast2Writer(AT, (b) => chunks.push(b));
    const expected: bigint[] = [];
    for (let batch = 0; batch < 20; batch++) {
      const rows = Array.from({ length: 500 }, (_, i) => BigInt(batch * 500 + i));
      expected.push(...rows);
      writer.write(rows);
    }
    assert.equal(writer.segments, 20);
    writer.finish();
    writer.finish(); // idempotent
    assert.throws(() => writer.write([1n]), /after finish/);
    const blob = Buffer.concat(chunks);
    assert.deepEqual(decodeBeast2For(AT)(blob), expected, "whole decode equals batch concat");
    // Segment iterator sees the original batching.
    const segments = [...iterBeast2SegmentsFor(AT)(blob)];
    assert.equal(segments.length, 20);
    assert.deepEqual(segments[0], expected.slice(0, 500));
    assert.deepEqual(segments[19], expected.slice(9500));
  });

  // The SAME bytes are pinned in east-py's test_beast2_v5.py and east-c's
  // test_beast2_hardening.c — the canonical (sorted, disjoint) Dict sibling
  // of SHARED_HEX, proving all three runtimes produce and accept identical
  // canonical Set/Dict streams.
  const SHARED_DICT_HEX = "89456173740d0a050007020301020b0001010000010100000707020161020162040004040101630600010100010217020a012c0000000000000089456173740d0af5";

  test("sorted set and dict batches concatenate; dict bytes match the cross-runtime fixture", () => {
    const ST = SetType(IntegerType);
    const sBlob = writeAll(ST, [new Set([1n, 2n]), new Set([3n, 5n])], { codec: "none" });
    const s = decodeBeast2For(ST)(sBlob) as Set<bigint>;
    assert.deepEqual([...s], [1n, 2n, 3n, 5n], "disjoint ascending batches concatenate");

    const DT = DictType(StringType, IntegerType);
    const dBlob = writeAll(DT, [new Map([["a", 1n], ["b", 2n]]), new Map([["c", 3n]])], { codec: "none" });
    assert.equal(Buffer.from(dBlob).toString("hex"), SHARED_DICT_HEX, "pinned cross-runtime bytes");
    const d = decodeBeast2For(DT)(Buffer.from(SHARED_DICT_HEX, "hex")) as Map<string, bigint>;
    assert.deepEqual([...d.entries()], [["a", 1n], ["b", 2n], ["c", 3n]]);
    const pages = openBeast2PagesFor(DT)(Buffer.from(SHARED_DICT_HEX, "hex"));
    assert.equal(pages.elementCount, 3);
    assert.deepEqual([...(pages.slice(1, 2) as Map<string, bigint>).entries()], [["b", 2n], ["c", 3n]]);
    assert.equal(pages.get("b"), 2n);
    assert.equal(pages.get("zz"), undefined);
  });

  test("the writer rejects out-of-order, overlapping, and duplicate Set/Dict batches", () => {
    const ST = SetType(IntegerType);
    // In-batch violation: a plain Set iterates insertion order.
    assert.throws(() => writeAll(ST, [new Set([3n, 1n])]), /strictly ascending/);
    // Cross-batch violations: overlapping ranges and repeated keys.
    assert.throws(() => writeAll(ST, [new Set([1n, 2n]), new Set([2n, 3n])]), /strictly ascending/);
    const DT = DictType(StringType, IntegerType);
    assert.throws(() => writeAll(DT, [new Map([["a", 1n], ["b", 2n]]), new Map([["b", 9n]])]), /strictly ascending/);
  });

  test("sequential decode rejects non-canonical Set/Dict wire as corrupt", () => {
    // Hand-assemble v5 blobs the fixed writers can no longer produce.
    function blobOf(type: EastType, build: (logical: BufferWriter) => void): Uint8Array {
      const head = new BufferWriter();
      head.writeBytes(MAGIC_BYTES_V5);
      writeTypeSection(toEastTypeValue(type), head);
      writeSourceMapSectionV5(null, head);
      const logical = new BufferWriter();
      build(logical);
      writeFrame(head, logical.toUint8Array(), "none");
      return head.toUint8Array();
    }

    // Elements out of order inside one segment.
    const unsortedSet = blobOf(SetType(IntegerType), (l) => {
      l.writeUint8(0x00);           // root NEW
      l.writeVarint(2);
      l.writeZigzag(2n);
      l.writeZigzag(1n);
      l.writeVarint(0);
    });
    assert.throws(() => decodeBeast2For(SetType(IntegerType))(unsortedSet), /strictly ascending/);

    // A duplicate key across segments (the old last-wins shape).
    const dupDict = blobOf(DictType(StringType, IntegerType), (l) => {
      l.writeUint8(0x00);
      l.writeVarint(1);
      l.writeStringUtf8Varint("b");
      l.writeZigzag(2n);
      l.writeVarint(1);
      l.writeStringUtf8Varint("b");
      l.writeZigzag(9n);
      l.writeVarint(0);
    });
    assert.throws(() => decodeBeast2For(DictType(StringType, IntegerType))(dupDict), /strictly ascending/);

    // Nested containers are held to the same contract.
    const nested = blobOf(ArrayType(SetType(IntegerType)), (l) => {
      l.writeUint8(0x00);           // root array NEW
      l.writeVarint(1);             // one element
      l.writeUint8(0x00);           // nested set NEW
      l.writeVarint(2);
      l.writeZigzag(5n);
      l.writeZigzag(4n);
      l.writeVarint(0);             // nested terminator
      l.writeVarint(0);             // root terminator
    });
    assert.throws(() => decodeBeast2For(ArrayType(SetType(IntegerType)))(nested), /strictly ascending/);

    // The segment iterator applies the contract across segment boundaries.
    const dupAcross = blobOf(SetType(IntegerType), (l) => {
      l.writeUint8(0x00);
      l.writeVarint(1);
      l.writeZigzag(3n);
      l.writeVarint(1);
      l.writeZigzag(3n);
      l.writeVarint(0);
    });
    assert.throws(() => [...iterBeast2SegmentsFor(SetType(IntegerType))(dupAcross)], /strictly ascending/);
  });

  test("plain and sorted containers encode identical canonical bytes", () => {
    const DT = DictType(StringType, IntegerType);
    const encode = encodeBeast2For(DT, V5_PLAIN);
    const plain = new Map([["b", 2n], ["a", 1n]]);        // insertion order b, a
    const sorted = new SortedMap<string, bigint>([["a", 1n], ["b", 2n]], compareFor(StringType));
    assert.deepEqual(Array.from(encode(plain)), Array.from(encode(sorted as any)), "dict bytes are container-flavor independent");
    const decoded = decodeBeast2For(DT)(encode(plain)) as Map<string, bigint>;
    assert.deepEqual([...decoded.entries()], [["a", 1n], ["b", 2n]], "decode is canonical");

    const ST = SetType(IntegerType);
    const encodeS = encodeBeast2For(ST, V5_PLAIN);
    assert.deepEqual(
      Array.from(encodeS(new Set([3n, 1n, 2n]))),
      Array.from(encodeS(new SortedSet<bigint>([1n, 2n, 3n], compareFor(IntegerType)) as any)),
      "set bytes are container-flavor independent");

    // Nested dict fields canonicalize the same way.
    const S = StructType({ bag: DictType(StringType, IntegerType) });
    const a = encodeBeast2For(S, V5_PLAIN)({ bag: new Map([["y", 2n], ["x", 1n]]) });
    const b = encodeBeast2For(S, V5_PLAIN)({ bag: new Map([["x", 1n], ["y", 2n]]) });
    assert.deepEqual(Array.from(a), Array.from(b), "nested bytes are insertion-order independent");
  });

  test("zero batches decode to the empty collection of each kind", () => {
    assert.deepEqual(decodeBeast2For(ArrayType(StringType))(writeAll(ArrayType(StringType), [])), []);
    assert.equal((decodeBeast2For(SetType(IntegerType))(writeAll(SetType(IntegerType), [])) as Set<bigint>).size, 0);
    assert.equal((decodeBeast2For(DictType(StringType, IntegerType))(writeAll(DictType(StringType, IntegerType), [])) as Map<string, bigint>).size, 0);
  });

  test("non-collection types are refused and v4 blobs are rejected by segment APIs", () => {
    assert.throws(() => encodeBeast2SegmentsFor(StringType as any), /Array, Set or Dict/);
    assert.throws(() => iterBeast2SegmentsFor(StringType as any), /Array, Set or Dict/);
    const AT = ArrayType(StringType);
    const v4 = encodeBeast2For(AT, V4)(["x"]);
    assert.throws(() => [...iterBeast2SegmentsFor(AT)(v4)], /v4 container/);
  });

  test("whole-value v5 encodes are iterable as a single segment", () => {
    const AT = ArrayType(IntegerType);
    const blob = encodeBeast2For(AT, V5_PLAIN)([1n, 2n, 3n]);
    const segments = [...iterBeast2SegmentsFor(AT)(blob)];
    assert.equal(segments.length, 1);
    assert.deepEqual(segments[0], [1n, 2n, 3n]);
  });
});

// =============================================================================
// 5. Paging
// =============================================================================

describe("Beast2 v5 — Paging", () => {
  test("pages expose O(1) length and per-segment random access", () => {
    const AT = ArrayType(StringType);
    const batches = [["a", "b"], ["c", "d", "e"], ["f"]];
    const blob = encodeBeast2SegmentsFor(AT, { codec: "none" })(batches);
    const pages = openBeast2PagesFor(AT)(blob);
    assert.equal(pages.elementCount, 6);
    assert.equal(pages.segmentCount, 3);
    assert.ok(pages.selfContained);
    assert.deepEqual(pages.segment(1), ["c", "d", "e"]);
    assert.deepEqual(pages.segment(0), ["a", "b"]);
    assert.equal(pages.element(0), "a");
    assert.equal(pages.element(2), "c");
    assert.equal(pages.element(5), "f");
    assert.throws(() => pages.element(6), /out of range/);
    assert.throws(() => pages.segment(3), /out of range/);
  });

  test("whole-value encode with index option is pageable", () => {
    const AT = ArrayType(IntegerType);
    const blob = encodeBeast2For(AT, { version: 5, codec: "none", index: true })([10n, 20n, 30n]);
    const pages = openBeast2PagesFor(AT)(blob);
    assert.equal(pages.elementCount, 3);
    assert.equal(pages.segmentCount, 1);
    assert.equal(pages.element(1), 20n);
    // And the same blob still whole-decodes through the ordinary entry point.
    assert.deepEqual(decodeBeast2For(AT)(blob), [10n, 20n, 30n]);
  });

  test("blobs without an index refuse paging", () => {
    const AT = ArrayType(IntegerType);
    const blob = encodeBeast2For(AT, V5_PLAIN)([1n]);
    assert.throws(() => openBeast2PagesFor(AT)(blob), /no index/);
  });

  test("dict pages count pairs", () => {
    const DT = DictType(StringType, IntegerType);
    const blob = encodeBeast2SegmentsFor(DT, { codec: "none" })([
      new Map([["a", 1n]]),
      new Map([["b", 2n], ["c", 3n]]),
    ]);
    const pages = openBeast2PagesFor(DT)(blob);
    assert.equal(pages.elementCount, 3);
    const seg1 = pages.segment(1) as Map<string, bigint>;
    assert.deepEqual([...seg1.entries()], [["b", 2n], ["c", 3n]]);
    assert.throws(() => pages.element(0), /Array roots/);
  });

  test("slice() reads element windows across segment boundaries", () => {
    const AT = ArrayType(IntegerType);
    const rows = Array.from({ length: 2500 }, (_, i) => BigInt(i));
    const blob = encodeBeast2SegmentsFor(AT)([rows.slice(0, 1000), rows.slice(1000, 2000), rows.slice(2000)]);
    const pages = openBeast2PagesFor(AT)(blob);
    assert.deepEqual([...pages.counts], [1000, 1000, 500]);
    // Window spanning two segments.
    assert.deepEqual(pages.slice(900, 200), rows.slice(900, 1100));
    // Window inside one segment, at the start, and the whole collection.
    assert.deepEqual(pages.slice(0, 10), rows.slice(0, 10));
    assert.deepEqual(pages.slice(1500, 100), rows.slice(1500, 1600));
    assert.deepEqual(pages.slice(0, 2500), rows);
    // Clamping like Array.prototype.slice: short tail, past-the-end, empty.
    assert.deepEqual(pages.slice(2400, 1000), rows.slice(2400));
    assert.deepEqual(pages.slice(9999, 10), []);
    assert.deepEqual(pages.slice(0, 0), []);
    // Invalid windows are refused; keyed get addresses Set/Dict roots only.
    assert.throws(() => pages.slice(-1, 10), /non-negative/);
    assert.throws(() => pages.slice(0, 1.5), /non-negative/);
    assert.throws(() => pages.get(0n as never), /Set and Dict roots/);
  });

  test("slice() and get() address the canonical order of Set and Dict roots", () => {
    const ST = SetType(IntegerType);
    const setRows = Array.from({ length: 250 }, (_, i) => BigInt(i));
    const sp = openBeast2PagesFor(ST)(encodeBeast2SegmentsFor(ST)([0, 100, 200].map((at) => new Set(setRows.slice(at, at + 100)))));
    assert.equal(sp.segmentCount, 3);
    assert.deepEqual([...(sp.slice(95, 10) as Set<bigint>)], Array.from({ length: 10 }, (_, i) => BigInt(95 + i)), "set window crosses a segment boundary in sorted order");
    assert.deepEqual([...(sp.slice(240, 100) as Set<bigint>)], Array.from({ length: 10 }, (_, i) => BigInt(240 + i)), "set window clamps at the tail");
    assert.equal((sp.slice(0, 0) as Set<bigint>).size, 0);
    assert.equal(sp.get(137n), 137n);
    assert.equal(sp.get(999n), undefined);
    assert.equal(sp.get(-1n), undefined, "below the minimum fence");

    const DT = DictType(StringType, IntegerType);
    const dictRows = Array.from({ length: 250 }, (_, i) => [`k${String(i).padStart(3, "0")}`, BigInt(i)] as [string, bigint]);
    const dp = openBeast2PagesFor(DT)(encodeBeast2SegmentsFor(DT)([0, 100, 200].map((at) => new Map(dictRows.slice(at, at + 100)))));
    assert.deepEqual(
      [...(dp.slice(98, 4) as Map<string, bigint>).entries()],
      [["k098", 98n], ["k099", 99n], ["k100", 100n], ["k101", 101n]],
      "dict window crosses the segment boundary in key order");
    assert.equal((dp.slice(9999, 5) as Map<string, bigint>).size, 0);
    assert.equal(dp.get("k042"), 42n);
    assert.equal(dp.get("zzz"), undefined);
  });

  test("paging rejects non-canonical Set segments (fences and overlap)", () => {
    const ST = SetType(IntegerType);
    function indexedSetBlob(segments: bigint[][]): Uint8Array {
      const head = new BufferWriter();
      head.writeBytes(MAGIC_BYTES_V5);
      writeTypeSection(toEastTypeValue(ST), head);
      writeSourceMapSectionV5(null, head);
      writeFrame(head, new Uint8Array([0x00]), "none");   // root NEW tag frame
      const index: { offset: number; count: number }[] = [];
      for (const seg of segments) {
        const logical = new BufferWriter();
        logical.writeVarint(seg.length);
        for (const v of seg) logical.writeZigzag(v);
        index.push({ offset: head.size, count: seg.length });
        writeFrame(head, logical.toUint8Array(), "none");
      }
      writeFrame(head, new Uint8Array([0x00]), "none");   // terminator frame
      writeIndexAndFooter(head, index, true);
      return head.toUint8Array();
    }

    // First keys out of order across segments.
    const badFences = openBeast2PagesFor(ST)(indexedSetBlob([[5n], [3n]]));
    assert.throws(() => badFences.slice(0, 2), /disjoint ascending/);
    assert.throws(() => badFences.get(3n), /disjoint ascending/);
    // Fences ascend, but segment 0's tail overlaps segment 1's range.
    const overlap = openBeast2PagesFor(ST)(indexedSetBlob([[1n, 5n], [3n, 6n]]));
    assert.throws(() => overlap.slice(0, 4), /disjoint ascending/);
    // A canonical hand-assembly pages exactly.
    const good = openBeast2PagesFor(ST)(indexedSetBlob([[1n, 2n], [3n]]));
    assert.deepEqual([...(good.slice(0, 3) as Set<bigint>)], [1n, 2n, 3n]);
    assert.equal(good.get(2n), 2n);
  });

  test("encodeBeast2PagedFor writes indexed blobs that decode to the input", () => {
    const Row = StructType({ id: IntegerType, name: StringType });
    const AT = ArrayType(Row);
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: BigInt(i), name: `row-${i % 97}` }));
    const blob = encodeBeast2PagedFor(AT)(rows);
    const pages = openBeast2PagesFor(AT)(blob);
    assert.equal(pages.elementCount, 2500);
    assert.ok(pages.selfContained);
    assert.ok(equalFor(AT)(decodeBeast2For(AT)(blob), rows), "whole decode equals input");
    // The same segments through the batch API are the same bytes — the paged
    // encode is the same wire form, cut where the rule says.
    const batches: typeof rows[] = [];
    let at = 0;
    for (const count of pages.counts) {
      batches.push(rows.slice(at, at + count));
      at += count;
    }
    assert.deepEqual(Array.from(blob), Array.from(encodeBeast2SegmentsFor(AT)(batches)));
    // A collection below the minimum is a single indexed segment.
    const small = encodeBeast2PagedFor(AT)(rows.slice(0, 10));
    assert.equal(openBeast2PagesFor(AT)(small).segmentCount, 1);
  });

  test("paged Set and Dict encodes round-trip and stay canonical", () => {
    const ST = SetType(IntegerType);
    const setValue = new Set(Array.from({ length: 5000 }, (_, i) => BigInt(i)));
    const sBlob = encodeBeast2PagedFor(ST)(setValue);
    assert.ok(openBeast2PagesFor(ST)(sBlob).segmentCount > 1);
    assert.ok(equalFor(ST)(decodeBeast2For(ST)(sBlob), setValue));

    const DT = DictType(StringType, IntegerType);
    const dictValue = new Map(Array.from({ length: 5000 }, (_, i) => [`k${String(i).padStart(4, "0")}`, BigInt(i)] as [string, bigint]));
    const dBlob = encodeBeast2PagedFor(DT)(dictValue);
    const dPages = openBeast2PagesFor(DT)(dBlob);
    assert.ok(dPages.segmentCount > 1);
    assert.ok(equalFor(DT)(decodeBeast2For(DT)(dBlob), dictValue));
    // Each segment is itself a valid Dict value of the root type.
    const seg = dPages.segment(1) as Map<string, bigint>;
    assert.ok(equalFor(DT)(decodeBeast2For(DT)(encodeBeast2For(DT)(seg)), seg));
    // One source Map cannot repeat a key, so segments partition the pairs.
    assert.equal([...dPages.counts].reduce((a, b) => a + b, 0), 5000);
  });

  test("wide rows cut by bytes, not by count", () => {
    const AT = ArrayType(StringType);
    const rows = Array.from({ length: 40 }, (_, i) => `row-${i}-` + String(i).padStart(4, "0").repeat(25_000));
    const blob = encodeBeast2PagedFor(AT, { codec: "none" })(rows);
    // Forty rows are far below the minimum count, but each is 100 KB: past the
    // minimum bytes after one, and the threshold rises with their width.
    assert.ok(openBeast2PagesFor(AT)(blob).segmentCount > 1);
    assert.ok(equalFor(AT)(decodeBeast2For(AT)(blob), rows));
    // Narrow rows of the same count stay one segment.
    assert.equal(openBeast2PagesFor(AT)(encodeBeast2PagedFor(AT)(rows.map((r) => r.slice(0, 20)))).segmentCount, 1);
    // The cut is a pure function of the value — bytes are deterministic.
    assert.deepEqual(Array.from(encodeBeast2PagedFor(AT, { codec: "none" })(rows)), Array.from(blob));
  });

  test("non-collection types are refused by the paged encoder", () => {
    assert.throws(() => encodeBeast2PagedFor(StringType as any), /Array, Set or Dict/);
  });
});

// =============================================================================
// 6. Hardening — malformed inputs fail loudly
// =============================================================================

describe("Beast2 v5 — Hardening", () => {
  const AT = ArrayType(StringType);
  const goodBlob = () => encodeBeast2SegmentsFor(AT, { codec: "none" })([["a", "b"], ["c"]]);

  test("every strict prefix that loses value bytes fails to decode", () => {
    const blob = goodBlob();
    const decode = decodeBeast2For(AT);
    // The index + footer are redundant metadata: truncating exactly at the
    // index boundary yields a complete, index-less stream (all data intact).
    // Every other prefix must fail.
    const footerStart = blob.length - 16;
    let indexOffset = 0n;
    for (let i = 7; i >= 0; i--) indexOffset = (indexOffset << 8n) | BigInt(blob[footerStart + i]!);
    const valueStreamEnd = Number(indexOffset);
    for (let len = 0; len < blob.length; len++) {
      if (len === valueStreamEnd) {
        assert.deepEqual(decode(blob.subarray(0, len)), ["a", "b", "c"], "index-less prefix is a complete stream");
      } else {
        assert.throws(() => decode(blob.subarray(0, len)), `prefix of ${len} bytes must not decode`);
      }
    }
  });

  test("bad magic and unknown versions are distinct errors", () => {
    const blob = goodBlob();
    const decode = decodeBeast2For(AT);
    const wrongPrefix = Uint8Array.from(blob);
    wrongPrefix[0] = 0x00;
    assert.throws(() => decode(wrongPrefix), /Invalid Beast2 magic/);
    const wrongVersion = Uint8Array.from(blob);
    wrongVersion[7] = 0x77;
    assert.throws(() => decode(wrongVersion), /Unknown Beast2 version/);
  });

  test("unknown frame codec and oversize declarations are refused", () => {
    // Hand-assemble: magic + structural type section + empty source map +
    // one frame with a bogus codec id.
    const head = new BufferWriter();
    head.writeBytes(MAGIC_BYTES_V5);
    writeTypeSection(toEastTypeValue(AT), head);
    writeSourceMapSectionV5(null, head);
    const base = head.toUint8Array();

    const badCodec = new BufferWriter();
    badCodec.writeBytes(base);
    badCodec.writeVarint(7);  // codec id
    badCodec.writeVarint(1);
    badCodec.writeVarint(1);
    badCodec.writeUint8(0);
    assert.throws(() => decodeBeast2For(AT)(badCodec.toUint8Array()), /unknown frame codec/);

    const zstd = new BufferWriter();
    zstd.writeBytes(base);
    zstd.writeVarint(2);
    zstd.writeVarint(1);
    zstd.writeVarint(1);
    zstd.writeUint8(0);
    assert.throws(() => decodeBeast2For(AT)(zstd.toUint8Array()), /zstd/);

    const bomb = new BufferWriter();
    bomb.writeBytes(base);
    bomb.writeVarint(0);
    bomb.writeVarint(2 ** 31);  // uncompressed_len over the 1 GiB cap
    bomb.writeVarint(2 ** 31);
    assert.throws(() => decodeBeast2For(AT)(bomb.toUint8Array()), /limit/);
  });

  test("container backref deltas out of range are refused", () => {
    const T = ArrayType(ArrayType(IntegerType));
    const head = new BufferWriter();
    head.writeBytes(MAGIC_BYTES_V5);
    writeTypeSection(toEastTypeValue(T), head);
    writeSourceMapSectionV5(null, head);
    const logical = new BufferWriter();
    logical.writeUint8(0x00);  // root NEW
    logical.writeVarint(1);    // one element
    logical.writeUint8(0x01);  // REF
    logical.writeVarint(9);    // delta way out of range
    logical.writeVarint(0);    // terminator
    writeFrame(head, logical.toUint8Array(), "none");
    assert.throws(() => decodeBeast2For(T)(head.toUint8Array()), /backref delta/);
  });

  test("trailing bytes and corrupted footers are refused", () => {
    const blob = goodBlob();
    const decode = decodeBeast2For(AT);
    const trailing = new Uint8Array([...blob, 0x00]);
    assert.throws(() => decode(trailing), /trailing|footer|magic/i);
    // Corrupt the index count of segment 0 (index sits between the value
    // stream and the footer).
    const corrupt = Uint8Array.from(blob);
    // Find the footer, then walk: flags varint, count varint, delta varint, count varint.
    const footerStart = corrupt.length - 16;
    let indexOffset = 0n;
    for (let i = 7; i >= 0; i--) indexOffset = (indexOffset << 8n) | BigInt(corrupt[footerStart + i]!);
    const idx = Number(indexOffset);
    // flags at idx, segment_count at idx+1, first delta at idx+2, first count at idx+3
    corrupt[idx + 3] = 99;
    assert.throws(() => decode(corrupt), /disagrees|count/);
    assert.deepEqual(Array.from(FOOTER_MAGIC_V5.subarray(0, 7)), Array.from(MAGIC_BYTES_V5.subarray(0, 7)), "footer magic family");
  });

  test("an unknown well-known id decodes via the structural fallback (forward compat)", () => {
    // Kind 2 is decode-only in this release: nothing emits it. It exists so a
    // LATER release can add a well-known id and decoders shipped now fall
    // back to the structural bytes instead of hard-failing on an id they have
    // never heard of.
    const T = ArrayType(StringType);
    const structural = new BufferWriter();
    writeTypeSection(toEastTypeValue(T), structural);
    // writeTypeSection emitted kind 0 (T is not well-known); re-frame those
    // same structural bytes as kind 2 under an id nobody registers.
    const structuralBytes = structural.toUint8Array().subarray(1);
    const head = new BufferWriter();
    head.writeBytes(MAGIC_BYTES_V5);
    head.writeVarint(2);        // kind: well-known + fallback
    head.writeVarint(9999);     // an id no runtime registers
    for (let i = 0; i < 8; i++) head.writeUint8(0xAB);  // a hash that matches nothing
    head.writeBytes(structuralBytes);
    writeSourceMapSectionV5(null, head);
    const logical = new BufferWriter();
    logical.writeUint8(0x00);   // NEW
    logical.writeVarint(1);
    logical.writeStringUtf8Varint("x");
    logical.writeVarint(0);
    writeFrame(head, logical.toUint8Array(), "none");

    assert.deepEqual(decodeBeast2For(T)(head.toUint8Array()), ["x"]);
  });

  test("the well-known registry is a format constant, so encodes are deterministic", () => {
    // Only ids 1 and 2 exist, and only for schemas every runtime has. A
    // custom type — however large or recursive — always encodes structurally,
    // so the bytes never depend on which packages a process imported. e3
    // content-addresses these bytes, so this is what keeps one value from
    // landing under two hashes.
    const Custom = StructType({ tag: StringType, n: IntegerType });
    const a = encodeBeast2For(Custom, V5_PLAIN)({ tag: "a", n: 1n });
    const b = encodeBeast2For(StructType({ tag: StringType, n: IntegerType }), V5_PLAIN)({ tag: "a", n: 1n });
    assert.equal(a[8], 0, "custom types are always structural");
    assert.deepEqual(Array.from(b), Array.from(a), "identical value ⇒ identical bytes");
  });

  test("headerPrefix must carry the writer's own wire type", () => {
    const DT = DictType(StringType, IntegerType);
    const arrayBlob = goodBlob();
    const prefix = arrayBlob.subarray(0, readBeast2Extents(arrayBlob).prefixEnd);

    // A same-type prefix is the splice-tooling contract — accepted verbatim.
    const chunks: Uint8Array[] = [];
    const writer = new Beast2Writer(AT, (b) => chunks.push(b), { headerPrefix: prefix });
    writer.write(["x"]);
    writer.finish();
    assert.deepEqual(decodeBeast2For(AT)(Buffer.concat(chunks)), ["x"]);

    // A prefix from a blob of a different wire type would write a header that
    // lies about the contents — refused at construction.
    assert.throws(() => new Beast2Writer(DT, () => { }, { headerPrefix: prefix }), /headerPrefix declares wire type/);
    assert.throws(() => new Beast2Writer(ArrayType(IntegerType), () => { }, { headerPrefix: prefix }), /headerPrefix declares wire type/);
    // Bytes that are not a v5 header at all are refused by the magic check.
    assert.throws(() => new Beast2Writer(AT, () => { }, { headerPrefix: new Uint8Array([1, 2, 3]) }), /too short|magic/i);
  });

  test("well-known hash drift fails loudly", () => {
    const fn = East.function([IntegerType], IntegerType, ($, x) => x);
    const blob = encodeEastIR(fn.toIR(), V5_PLAIN);
    assert.equal(blob[8], 1, "well-known kind");
    const drifted = Uint8Array.from(blob);
    drifted[10] = drifted[10]! ^ 0xff;  // flip a hash byte
    assert.throws(() => decodeEastIR(drifted), /hash mismatch/);
    const unknownId = Uint8Array.from(blob);
    unknownId[9] = 0x60;  // an id not in this runtime's format registry
    assert.throws(() => decodeEastIR(unknownId), /unknown well-known type id/);
  });
});

// =============================================================================
// 7. Pure inflate — the browser synchronous decode path
// =============================================================================

describe("Beast2 v5 — Pure inflate (browser sync path)", () => {
  // Deterministic pseudo-random bytes so fixtures are reproducible.
  function randomBytes(n: number, seed: number): Uint8Array {
    let s = seed >>> 0;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      out[i] = s >>> 24;
    }
    return out;
  }
  function repetitiveBytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = i % 7 === 0 ? 0x41 : i % 13;
    return out;
  }

  test("inflates our own deterministic encoder (fixed-Huffman blocks)", () => {
    for (const data of [
      new Uint8Array(0),
      new Uint8Array([1, 2, 3]),
      repetitiveBytes(1000),
      repetitiveBytes(100_000),   // matches span beyond the 32 KiB window
      randomBytes(5000, 42),      // incompressible: mostly literals
    ]) {
      const compressed = deterministicDeflateRaw(data);
      assert.deepEqual(inflateRawPure(compressed, data.length), data, `size ${data.length}`);
    }
  });

  test("inflates foreign zlib streams (stored and dynamic-Huffman blocks)", () => {
    // Level 0 emits stored blocks (multiple, above the 64 KiB block cap);
    // higher levels emit fixed/dynamic blocks as zlib sees fit. A correct
    // inflate must accept them all — the format pins the encoder only.
    for (const level of [0, 1, 6, 9]) {
      for (const data of [repetitiveBytes(200_000), randomBytes(70_000, 7)]) {
        const compressed = new Uint8Array(zlibDeflateRawSync(data, { level }));
        assert.deepEqual(inflateRawPure(compressed, data.length), data, `level ${level}, size ${data.length}`);
      }
    }
  });

  test("agrees with the zlib-backed sync inflate", () => {
    const data = repetitiveBytes(50_000);
    const compressed = deterministicDeflateRaw(data);
    // zlib returns a Buffer (a Uint8Array subclass) — normalize for deepEqual.
    assert.deepEqual(inflateRawPure(compressed, data.length), new Uint8Array(inflateRawSync(compressed, data.length)));
  });

  test("corrupt streams fail loudly", () => {
    const data = repetitiveBytes(1000);
    const compressed = deterministicDeflateRaw(data);
    // Truncated input.
    assert.throws(() => inflateRawPure(compressed.subarray(0, compressed.length - 5), data.length), /truncated/i);
    // Declared length disagrees with the stream in both directions.
    assert.throws(() => inflateRawPure(compressed, data.length - 1), /past the declared/);
    assert.throws(() => inflateRawPure(compressed, data.length + 1), /inflated to/);
    // A match whose distance reaches before the start of output: a fixed
    // block whose first symbol is a length/distance pair (len 3, dist 1).
    assert.throws(() => inflateRawPure(new Uint8Array([0x03, 0x02]), 3), /distance/);
    // Reserved block type 3.
    assert.throws(() => inflateRawPure(new Uint8Array([0x07]), 1), /block type/);
  });
});

// =============================================================================
// 8. Canonical type sections — one type, one section, everywhere (#770)
// =============================================================================

describe("Beast2 v5 — Canonical type sections (#770)", () => {
  // The SAME sections are pinned in east-c's test_beast2_hardening.c and
  // east-py's test_beast2_v5.py: the type section is a pure function of the
  // type, so every runtime writes these bytes, and so does TypeScript for the
  // type carried as an EastTypeValue (what a runner reads from IR) — which
  // used to write duplicate entries (a second `Integer`, a second wrapper)
  // and, for the three-field case, an entry east-c wrote once.
  const Tree = RecursiveType((self) => StructType({ value: IntegerType, children: ArrayType(self) }));
  // Inner is reached as `nodes: Array<Inner>` inside Outer's body while its
  // own body recurses through `children: Array<self>`: one entry inside and
  // outside the wrapper, under an enclosing wrapper — east-ui's
  // `TreeView.nodes` under `UIComponentType` (#773).
  const Inner = RecursiveType((self) => StructType({ children: ArrayType(self) }));
  const Outer = RecursiveType((self) => StructType({ nodes: ArrayType(Inner), next: ArrayType(self) }));
  const I = variant("Integer", null);
  const CASES: { name: string; type: EastType; value: any; hex: string }[] = [
    {
      name: "Dict<Integer, Struct{count: Integer, text: String}>",
      type: DictType(IntegerType, StructType({ count: IntegerType, text: StringType })),
      value: new Map([[1n, { count: 2n, text: "x" }]]),
      hex: "001603040201090205636f756e74000474657874010b0002",
    },
    {
      name: "Dict<String, String>",
      type: DictType(StringType, StringType),
      value: new Map([["a", "b"]]),
      hex: "00060102010b0000",
    },
    {
      name: "Struct{left: Tree, right: Tree}",
      type: StructType({ left: Tree, right: Tree }),
      value: { left: { value: 1n, children: [] }, right: { value: 2n, children: [] } },
      hex: "002904051203020a0009020576616c756501086368696c6472656e020902046c6566740005726967687400",
    },
    {
      // Entry 1 (Array<entry 0>) is EastTypeType's `inputs` inside its own
      // body AND field `a` outside it — one entry, read in two scopes.
      name: "Struct{b: EastTypeType, a: Array<EastTypeType>}",
      type: StructType({ b: EastTypeType, a: ArrayType(EastTypeType) }),
      value: { b: I, a: [I] },
      hex: "00fa010c0d120b0a00090206696e7075747301066f757470757400000902036b6579000576616c7565000209020269640505696e6e65720008020372656605077772617070657206010902046e616d65080474797065000a090813054172726179000d4173796e6346756e6374696f6e0204426c6f620307426f6f6c65616e03084461746554696d650304446963740405466c6f6174030846756e6374696f6e0207496e746567657203064d617472697800054e6576657203044e756c6c0309526563757273697665070352656600035365740006537472696e6703065374727563740a0756617269616e740a06566563746f72000902016200016101",
    },
    {
      // Field `a` is reached before EastTypeType's body: every runtime used
      // to write Array<EastTypeType> twice (14 entries), naming `c` by one
      // entry in TypeScript and the other in east-c. It is 13 entries now.
      name: "Struct{a: Array<EastTypeType>, b: EastTypeType, c: Array<EastTypeType>}",
      type: StructType({ a: ArrayType(EastTypeType), b: EastTypeType, c: ArrayType(EastTypeType) }),
      value: { a: [I], b: I, c: [I] },
      hex: "00fd010c0d120b0a00090206696e7075747301066f757470757400000902036b6579000576616c7565000209020269640505696e6e65720008020372656605077772617070657206010902046e616d65080474797065000a090813054172726179000d4173796e6346756e6374696f6e0204426c6f620307426f6f6c65616e03084461746554696d650304446963740405466c6f6174030846756e6374696f6e0207496e746567657203064d617472697800054e6576657203044e756c6c0309526563757273697665070352656600035365740006537472696e6703065374727563740a0756617269616e740a06566563746f72000903016101016200016301",
    },
    {
      // Entry 2 (Array<entry 1>) is Inner's `children` inside its body and
      // Outer's `nodes` outside it. Walking Outer's body top-down the reader
      // starts building entry 2, opens Inner, meets entry 2 again, and used
      // to call that a cycle (#773). The bytes are the writer's before and
      // after: the reader alone changed.
      name: "Recursive(Struct{nodes: Array<Inner>, next: Array<self>})",
      type: Outer,
      value: { nodes: [{ children: [{ children: [] }] }], next: [{ nodes: [], next: [] }] },
      hex: "00250006120512030a010901086368696c6472656e020a000902056e6f64657302046e65787404",
    },
  ];

  /** The type section of a v5 blob, as hex. */
  function section(blob: Uint8Array): string {
    let offset = 8;
    const varint = () => {
      let value = 0, shift = 0, byte: number;
      do { byte = blob[offset++]!; value |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
      return value;
    };
    const kind = varint();
    if (kind === 0) {
      const length = varint();
      offset += length;
    } else {
      varint();  // the well-known id
      offset += 8;
    }
    return Buffer.from(blob.subarray(8, offset)).toString("hex");
  }

  /** The type as a value that crossed the wire — what a runner holds. */
  const carried = (type: EastType): EastTypeValue =>
    decodeBeast2For(EastTypeValueType)(encodeBeast2For(EastTypeValueType, V5_PLAIN)(toEastTypeValue(type)));

  /** The `Recursive` refs in a type value that no enclosing wrapper binds. */
  function dangling(t: any, bound: bigint[] = []): bigint[] {
    switch (t.type) {
      case "Recursive":
        return t.value.type === "ref"
          ? (bound.includes(t.value.value) ? [] : [t.value.value])
          : dangling(t.value.value.inner, [...bound, t.value.value.id]);
      case "Struct": case "Variant": return t.value.flatMap((f: any) => dangling(f.type, bound));
      case "Dict": return [...dangling(t.value.key, bound), ...dangling(t.value.value, bound)];
      case "Function": case "AsyncFunction": return [...t.value.inputs.flatMap((i: any) => dangling(i, bound)), ...dangling(t.value.output, bound)];
      case "Array": case "Set": case "Ref": case "Vector": case "Matrix": return dangling(t.value, bound);
      default: return [];
    }
  }

  test("a type built in code and the same type carried as a value write the pinned section", () => {
    for (const c of CASES) {
      const built = encodeBeast2For(c.type, V5_PLAIN)(c.value);
      assert.equal(section(built), c.hex, `${c.name}: built`);
      const viaCarried = encodeBeast2For(carried(c.type), V5_PLAIN)(c.value);
      assert.equal(section(viaCarried), c.hex, `${c.name}: carried`);
      assert.deepEqual(Array.from(viaCarried), Array.from(built), `${c.name}: whole blob`);
    }
  });

  test("the bytes depend on the type alone, not on the objects that spell it", () => {
    // Two builds of one type from separate objects; the same type value
    // decoded twice (distinct objects, no type ids); and a type value spelled
    // by hand with wrapper ids of its own.
    for (const c of CASES) {
      assert.equal(section(encodeBeast2For(carried(c.type), V5_PLAIN)(c.value)), section(encodeBeast2For(carried(c.type), V5_PLAIN)(c.value)), c.name);
    }
    const spelled = variant("Struct", [
      { name: "left", type: variant("Recursive", variant("wrapper", { id: 900n, inner: variant("Struct", [
        { name: "value", type: variant("Integer", null) },
        { name: "children", type: variant("Array", variant("Recursive", variant("ref", 900n))) },
      ]) })) },
      { name: "right", type: variant("Recursive", variant("wrapper", { id: 901n, inner: variant("Struct", [
        { name: "value", type: variant("Integer", null) },
        { name: "children", type: variant("Array", variant("Recursive", variant("ref", 901n))) },
      ]) })) },
    ]) as EastTypeValue;
    assert.equal(section(encodeBeast2For(spelled, V5_PLAIN)(CASES[2]!.value)), CASES[2]!.hex, "wrappers of different ids and one structure are one entry");
  });

  test("a carried well-known schema is written as its well-known section", () => {
    const ir = East.function([IntegerType], IntegerType, ($, x) => x).toIR().ir;
    assert.equal(section(encodeBeast2For(carried(IRType), V5_PLAIN)(ir)), "010145cf4e0706d397df", "IRType");
    const tv = toEastTypeValue(StructType({ a: IntegerType, b: ArrayType(StringType) }));
    assert.equal(section(encodeBeast2For(carried(EastTypeType), V5_PLAIN)(tv)), "01020947b0dde16f8641", "EastTypeValueType");
  });

  test("every section decodes to the type it names, self-describing decodes included", () => {
    for (const c of CASES) {
      const blob = encodeBeast2For(c.type, V5_PLAIN)(c.value);
      const { type, value } = decodeBeast2(blob);
      assert.deepEqual(dangling(type), [], `${c.name}: no dangling Recursive refs`);
      assert.ok(isTypeValueEqual(type, toEastTypeValue(c.type)), `${c.name}: the decoded type is the type, up to wrapper naming`);
      assert.ok(isTypeValueEqual(readBeast2Type(blob), toEastTypeValue(c.type)), `${c.name}: readBeast2Type`);
      assert.ok(equalFor(c.type)(value, c.value), `${c.name}: value`);
      // ...and the decoded type writes the section again.
      assert.equal(section(encodeBeast2For(type, V5_PLAIN)(value)), c.hex, `${c.name}: re-encode from the wire type`);
    }
  });

  test("an entry shared by a wrapper's body and its outside reads closed outside", () => {
    // Struct{b: EastTypeType, a: Array<EastTypeType>}: inside EastTypeType's
    // body, entry 1's element is a self-reference; as field `a` it is the
    // whole recursive type — the same object field `b` decodes to.
    const c = CASES[3]!;
    const { type } = decodeBeast2(encodeBeast2For(c.type, V5_PLAIN)(c.value));
    const fields = (type as any).value as { name: string; type: any }[];
    const a = fields.find((f) => f.name === "a")!.type;
    const b = fields.find((f) => f.name === "b")!.type;
    assert.equal(a.type, "Array");
    assert.equal(a.value.type, "Recursive");
    assert.equal(a.value.value.type, "wrapper", "outside its wrapper the element is the wrapper, not a ref");
    assert.ok(a.value === b, "one closed object serves both references");
    // The wrapper's own body still refers to itself by ref.
    const inputs = b.value.value.inner.value.find((k: any) => k.name === "Function")!.type.value.find((f: any) => f.name === "inputs")!.type;
    assert.equal(inputs.value.value.type, "ref");
  });

  test("a UIComponentType-scale section reads back through every entry point (#773)", () => {
    // east cannot import east-ui, so this is UIComponentType's shape at
    // east's scale: a deep variant over shared sub-types (Style, Icon, one
    // review struct used twice), children under Array, Option, Dict, Ref,
    // struct rows and function results, a type-value leaf, and four nested
    // recursive types — Chart reached bare, Tree's nodes, Outline's sections
    // and Steps' first through the container their own bodies recurse
    // through. The section is pinned to what the writer produced before the
    // fix; TypeScript refused to read it back at entry 44.
    const Style = StructType({ tone: OptionType(StringType), density: OptionType(IntegerType) });
    const Icon = VariantType({ named: StringType, glyph: StructType({ code: IntegerType, label: StringType }) });
    const Chain = RecursiveType((next) => StructType({ value: IntegerType, next: OptionType(next) }));
    const Section = RecursiveType((section) => StructType({ title: StringType, children: DictType(StringType, section) }));
    const Spec = RecursiveType((spec) => VariantType({
      mark: StructType({ kind: StringType, style: OptionType(Style) }),
      layer: StructType({ children: ArrayType(spec) }),
      facet: StructType({ by: StringType, inner: OptionType(spec) }),
    }));
    const Panel = RecursiveType((node) => {
      const review = StructType({ summary: OptionType(node), onApprove: OptionType(FunctionType([IntegerType], NullType)) });
      return VariantType({
        Text: StructType({ text: StringType, style: OptionType(Style) }),
        Icon: Icon,
        Button: StructType({ label: node, icon: OptionType(Icon), onClick: OptionType(FunctionType([], NullType)), style: OptionType(Style) }),
        Stack: StructType({ children: ArrayType(node), style: OptionType(Style) }),
        Grid: StructType({ items: ArrayType(StructType({ content: node, span: OptionType(IntegerType) })), style: OptionType(Style) }),
        Card: StructType({ header: OptionType(node), body: ArrayType(node), footer: OptionType(node), style: OptionType(Style) }),
        Tree: StructType({
          nodes: ArrayType(RecursiveType((inner) => VariantType({
            Item: StructType({ value: StringType, icon: OptionType(Icon) }),
            Branch: StructType({ value: StringType, children: ArrayType(inner), style: OptionType(Style) }),
          }))),
          onSelect: OptionType(FunctionType([ArrayType(StringType)], NullType)),
        }),
        Outline: StructType({ sections: DictType(StringType, Section), style: OptionType(Style) }),
        Steps: StructType({ first: OptionType(Chain), labels: ArrayType(node) }),
        Chart: Spec,
        Table: StructType({
          columns: ArrayType(StructType({ key: StringType, dataType: EastTypeType, header: OptionType(StringType), render: FunctionType([IntegerType], node) })),
          footer: OptionType(DictType(StringType, StructType({ content: node, span: OptionType(IntegerType) }))),
          review: OptionType(review),
          style: OptionType(Style),
        }),
        Plan: StructType({ rows: ArrayType(StructType({ key: StringType, values: VectorType(FloatType) })), popover: OptionType(FunctionType([StringType], OptionType(node))), review: OptionType(review) }),
        Pages: StructType({ render: FunctionType([], node), key: StringType }),
        Match: StructType({ render: FunctionType([], node), tag: FunctionType([], StringType) }),
        Slot: StructType({ content: RefType(node) }),
        Menu: StructType({ trigger: node, items: ArrayType(StructType({ label: StringType, icon: OptionType(Icon), submenu: OptionType(ArrayType(node)) })) }),
        Deck: StructType({ items: ArrayType(StructType({ key: StringType, face: OptionType(node), detail: OptionType(node), groups: DictType(StringType, StringType) })), statuses: DictType(StringType, Style) }),
        Loader: StructType({ load: AsyncFunctionType([StringType], node) }),
        Extension: StructType({ kind: StringType, payload: BlobType }),
      });
    });
    const PANEL_HEX = "00a50a005c125b000201090204636f646502056c6162656c03080205676c79706804056e616d6564030802046e6f6e650104736f6d65051000010802046e6f6e650104736f6d65070802046e6f6e650104736f6d65030802046e6f6e650104736f6d6502090204746f6e65090764656e736974790a0802046e6f6e650104736f6d650b0904056c6162656c000469636f6e06076f6e436c69636b08057374796c650c0802046e6f6e650104736f6d65000a000904066865616465720e04626f64790f06666f6f7465720e057374796c650c12170802046e6f6e650104736f6d651109020262790305696e6e6572120a110901086368696c6472656e140902046b696e6403057374796c650c080305666163657413056c6179657215046d61726b160b03030904036b65790304666163650e0664657461696c0e0667726f757073180a190b030b0902056974656d731a0873746174757365731b060902046b696e6403077061796c6f61641d090207636f6e74656e7400047370616e0a0a1f0902056974656d7320057374796c650c110103000901046c6f61642210000010000309020672656e6465722403746167250802046e6f6e650104736f6d650f0903056c6162656c030469636f6e06077375626d656e75270a280902077472696767657200056974656d7329122d0b032b0902057469746c6503086368696c6472656e2c09020873656374696f6e732c057374796c650c09020672656e64657224036b657903030e300902036b6579030676616c756573310a321001030e0802046e6f6e650104736f6d6534100102010802046e6f6e650104736f6d653609020773756d6d6172790e096f6e417070726f7665370802046e6f6e650104736f6d6538090304726f77733307706f706f7665723506726576696577390d00090107636f6e74656e743b0902086368696c6472656e0f057374796c650c12400802046e6f6e650104736f6d653e09020576616c756502046e6578743f09020566697273743f066c6162656c730f124a0a42090206696e7075747343066f7574707574420902036b6579420576616c75654209020269640205696e6e657242080203726566020777726170706572460902046e616d65030474797065420a480813054172726179420d4173796e6346756e6374696f6e4404426c6f620107426f6f6c65616e01084461746554696d650104446963744505466c6f6174010846756e6374696f6e4407496e746567657201064d617472697842054e6576657201044e756c6c0109526563757273697665470352656642035365744206537472696e670106537472756374490756617269616e744906566563746f7242100102000904036b6579030864617461547970654206686561646572090672656e6465724b0a4c0b031f0802046e6f6e650104736f6d654e090407636f6c756d6e734d06666f6f7465724f0672657669657739057374796c650c0902047465787403057374796c650c12560a5209030576616c756503086368696c6472656e53057374796c650c09020576616c7565030469636f6e060802064272616e636854044974656d550a03100157010802046e6f6e650104736f6d65580902056e6f64657353086f6e53656c65637459081306427574746f6e0d04436172641005436861727411044465636b1c09457874656e73696f6e1e0447726964210449636f6e05064c6f6164657223054d6174636826044d656e752a074f75746c696e652e0550616765732f04506c616e3a04536c6f743c05537461636b3d05537465707341055461626c655004546578745104547265655a";

    const writer = new BufferWriter();
    writeTypeSection(toEastTypeValue(Panel), writer);
    const bytes = writer.toUint8Array();
    assert.equal(Buffer.from(bytes).toString("hex"), PANEL_HEX, "the section is the pinned one");
    const { rootType } = readTypeSection(new BufferReader(bytes));
    assert.ok(isTypeValueEqual(rootType, toEastTypeValue(Panel)), "readTypeSection returns the type");
    assert.deepEqual(dangling(rootType), [], "no dangling Recursive refs");

    const value = variant("Card", {
      header: some(variant("Text", { text: "t", style: none })),
      body: [
        variant("Tree", { nodes: [variant("Branch", { value: "a", children: [variant("Item", { value: "b", icon: some(variant("named", "leaf")) })], style: none })], onSelect: none }),
        variant("Chart", variant("layer", { children: [variant("mark", { kind: "bar", style: some({ tone: none, density: some(1n) }) })] })),
        variant("Outline", { sections: new Map([["s", { title: "S", children: new Map([["t", { title: "T", children: new Map() }]]) }]]), style: none }),
        variant("Steps", { first: some({ value: 1n, next: some({ value: 2n, next: none }) }), labels: [variant("Icon", variant("glyph", { code: 7n, label: "g" }))] }),
        variant("Slot", { content: ref(variant("Extension", { kind: "k", payload: new Uint8Array([9]) })) }),
      ],
      footer: none,
      style: some({ tone: some("calm"), density: none }),
    });
    const blob = encodeBeast2For(Panel, V5_PLAIN)(value as any);
    assert.equal(section(blob), PANEL_HEX, "the blob carries the pinned section");
    assert.ok(equalFor(Panel)(decodeBeast2For(Panel)(blob), value as any), "decodeBeast2For");
    const auto = decodeBeast2(blob);
    assert.ok(isTypeValueEqual(auto.type, toEastTypeValue(Panel)), "decodeBeast2: the wire type");
    assert.ok(equalFor(Panel)(auto.value, value as any), "decodeBeast2: the value");
    assert.ok(isTypeValueEqual(readBeast2Type(blob), toEastTypeValue(Panel)), "readBeast2Type");
    assert.equal(section(encodeBeast2For(auto.type, V5_PLAIN)(auto.value)), PANEL_HEX, "re-encode from the wire type");
  });

  test("a table an earlier TypeScript wrote with duplicate wrappers decodes and re-encodes canonically", () => {
    // What TypeScript wrote for the carried Struct{left: Tree, right: Tree}:
    // two wrapper entries (0 and 4) for one type, the second unfolding into
    // the first. Readers accept every released container, and the decoded
    // type writes the one canonical section.
    const c = CASES[2]!;
    const OLD_HEX = "003e06071203020a0009020576616c756501086368696c6472656e02120509020576616c756501086368696c6472656e020902046c6566740005726967687404";
    const head = new BufferWriter();
    head.writeBytes(MAGIC_BYTES_V5);
    head.writeBytes(Buffer.from(OLD_HEX, "hex"));
    writeSourceMapSectionV5(null, head);
    const logical = new BufferWriter();
    logical.writeZigzag(1n); logical.writeUint8(0x00); logical.writeVarint(0);   // left: value, children NEW + terminator
    logical.writeZigzag(2n); logical.writeUint8(0x00); logical.writeVarint(0);   // right
    writeFrame(head, logical.toUint8Array(), "none");
    const blob = head.toUint8Array();
    assert.notEqual(section(blob), c.hex, "the old section is not the canonical one");
    const { type, value } = decodeBeast2(blob);
    assert.deepEqual(dangling(type), []);
    assert.ok(equalFor(c.type)(value, c.value));
    const fields = (type as any).value as { name: string; type: any }[];
    assert.ok(isTypeValueEqual(fields[0]!.type, fields[1]!.type), "both wrappers are one type");
    assert.equal(section(encodeBeast2For(type, V5_PLAIN)(value)), c.hex, "re-encoded canonically");
    assert.ok(equalFor(c.type)(decodeBeast2For(c.type)(blob), c.value), "typed decode of the old blob");
  });
});
