/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v5 test suite — the segment-terminated record stream (#416).
 * Round-trips through the version-agnostic entry points, streaming writer /
 * segment iterator / pages, aliasing and cycles, source maps, well-known type
 * sections, merge semantics, cross-runtime byte pins, and hardening.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  NullType, BooleanType, IntegerType, FloatType, StringType, DateTimeType, BlobType,
  ArrayType, SetType, DictType, StructType, VariantType, OptionType,
  RefType, VectorType, MatrixType, FunctionType,
  type EastType,
} from "../../../types.js";
import { toEastTypeValue, EastTypeValueType, type EastTypeValue } from "../../../type_of_type.js";
import { equalFor } from "../../../comparison.js";
import { East, variant, ref, some, none } from "../../../index.js";
import { matrix } from "../../../containers/matrix.js";
import { BufferWriter } from "../../binary-utils.js";
import {
  encodeBeast2For,
  decodeBeast2For,
  decodeBeast2ForAsync,
  decodeBeast2,
  encodeEastIR,
  decodeEastIR,
  Beast2Writer,
  encodeBeast2SegmentsFor,
  iterBeast2SegmentsFor,
  openBeast2PagesFor,
  MAGIC_BYTES_V5,
} from "../index.js";
import { writeTypeSection } from "./type-section.js";
import { writeSourceMapSectionV5, FOOTER_MAGIC_V5 } from "./codec.js";
import { writeFrame } from "./frames.js";

const V5 = { version: 5 as const };
const V5_PLAIN = { version: 5 as const, codec: "none" as const };

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
    const v4 = encodeBeast2For(type)(["v", "4"]);
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
// 4. Streaming writer + iterator + merge semantics (salvaged from PR #415)
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

  test("set segments union with structural dedup and dict segments keep the last occurrence", () => {
    const ST = SetType(IntegerType);
    const sBlob = writeAll(ST, [new Set([3n, 1n]), new Set([1n, 2n])], { codec: "none" });
    const merged = decodeBeast2For(ST)(sBlob) as Set<bigint>;
    assert.deepEqual([...merged], [1n, 2n, 3n], "sorted union");

    const DT = DictType(StringType, IntegerType);
    const dBlob = writeAll(DT, [
      new Map([["a", 1n], ["b", 2n]]),
      new Map([["b", 9n]]),
    ], { codec: "none" });
    const mergedD = decodeBeast2For(DT)(dBlob) as Map<string, bigint>;
    assert.equal(mergedD.get("a"), 1n);
    assert.equal(mergedD.get("b"), 9n, "later segment wins");
    assert.equal(mergedD.size, 2);

    // Structs as set elements dedup structurally across segments.
    const SS = SetType(StructType({ k: StringType }));
    const ssBlob = writeAll(SS, [new Set([{ k: "x" }]), new Set([{ k: "x" }, { k: "y" }])], { codec: "none" });
    const mergedS = decodeBeast2For(SS)(ssBlob) as Set<{ k: string }>;
    assert.equal(mergedS.size, 2, "structural dedup across segments");
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
    const v4 = encodeBeast2For(AT)(["x"]);
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

  test("well-known hash drift fails loudly", () => {
    const fn = East.function([IntegerType], IntegerType, ($, x) => x);
    const blob = encodeEastIR(fn.toIR(), V5_PLAIN);
    assert.equal(blob[8], 1, "well-known kind");
    const drifted = Uint8Array.from(blob);
    drifted[10] = drifted[10]! ^ 0xff;  // flip a hash byte
    assert.throws(() => decodeEastIR(drifted), /hash mismatch/);
    const unknownId = Uint8Array.from(blob);
    unknownId[9] = 0x60;  // unregistered well-known id
    assert.throws(() => decodeEastIR(unknownId), /not registered/);
  });
});
