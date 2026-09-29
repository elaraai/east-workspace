/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canonical skipper, held to the encoder: it steps over exactly what the
 * encoder writes for any value, aliasing among its containers included, and
 * refuses what a decoder reads but the encoder would never write. The lenient
 * one steps over what the decoder reads, too.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ArrayType, BooleanType, DateTimeType, DictType, FloatType, FunctionType, IntegerType, NullType, RefType, SetType, StringType,
  StructType, VariantType, type EastType,
} from "../../../types.js";
import type { EastTypeValue } from "../../../type_of_type.js";
import { ref } from "../../../containers/ref.js";
import { generateFuzzValues } from "../../../fuzz.js";
import { BufferReader, BufferWriter } from "../../binary-utils.js";
import { encodeBeast2FenceFor } from "./boundary.js";
import { Beast2NotCanonicalError, canonicalSkipperFor, canonicalVarint } from "./canonical.js";

/** Where the skipper leaves a reader over `bytes`, or its refusal. */
function skip(type: EastType, bytes: Uint8Array): number {
  const reader = new BufferReader(bytes, 0);
  canonicalSkipperFor(type)(reader, []);
  return reader.offset;
}

/** Bytes written with a writer's own calls. */
function bytesOf(write: (writer: BufferWriter) => void): Uint8Array {
  const writer = new BufferWriter();
  write(writer);
  return writer.toUint8Array().slice();
}

describe("canonicalSkipperFor", () => {
  test("steps over exactly what the encoder writes, for every random type", () => {
    const cases = generateFuzzValues({ numTypes: 120, numSamples: 6, seed: 0xca70, includeFunctions: false, nestedRecursive: true, includeTypeValues: true });
    assert.ok(cases.length >= 100, `the fuzz made ${cases.length} types`);
    for (const c of cases) {
      const encode = encodeBeast2FenceFor(c.type);
      for (const value of c.values) {
        const bytes = encode(value);
        assert.equal(skip(c.type, bytes), bytes.length, `${c.typeName}: every byte of the value, and no more`);
      }
    }
  });

  test("steps over a value whose containers alias one another, as the encoder writes them", () => {
    const Pair = StructType({ left: ArrayType(IntegerType), right: ArrayType(IntegerType) });
    const shared = [1n, 2n];
    const pair = encodeBeast2FenceFor(Pair)({ left: shared, right: shared });
    assert.equal(skip(Pair, pair), pair.length);

    const Cells = StructType({ x: RefType(IntegerType), y: RefType(IntegerType) });
    const cell = ref(7n);
    const cells = encodeBeast2FenceFor(Cells)({ x: cell, y: cell });
    assert.equal(skip(Cells, cells), cells.length);
  });

  test("refuses what a decoder reads but the encoder would never write", () => {
    const refused = (type: EastType, bytes: Uint8Array, message: RegExp): void => {
      assert.throws(() => skip(type, bytes), (err: unknown) => err instanceof Beast2NotCanonicalError && message.test(err.message));
    };
    // 5 is zigzag 10: one byte, 0x0A — not 0x8A 0x00.
    refused(IntegerType, new Uint8Array([0x8a, 0x00]), /an Integer is not a minimal varint/);
    refused(IntegerType, new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x02]), /an Integer is larger than 64 bits/);
    refused(BooleanType, new Uint8Array([0x02]), /a Boolean is neither 0 nor 1/);
    // U+0000 as two bytes, a surrogate, a code point past U+10FFFF, a lone continuation.
    refused(StringType, new Uint8Array([0x02, 0xc0, 0x80]), /a String is not well-formed UTF-8/);
    refused(StringType, new Uint8Array([0x03, 0xed, 0xa0, 0x80]), /a String is not well-formed UTF-8/);
    refused(StringType, new Uint8Array([0x04, 0xf4, 0x90, 0x80, 0x80]), /a String is not well-formed UTF-8/);
    refused(StringType, new Uint8Array([0x01, 0x80]), /a String is not well-formed UTF-8/);
    // The encoder writes 0x7FF8000000000000 for every NaN.
    refused(FloatType, new Uint8Array([0, 0, 0, 0, 0, 0, 0xf8, 0xff]), /a NaN other than the one the Writer writes/);
    refused(FloatType, new Uint8Array([1, 0, 0, 0, 0, 0, 0xf0, 0x7f]), /a NaN other than the one the Writer writes/);
    // 8.64e15 ms is the last date a Date holds.
    refused(DateTimeType, bytesOf((w) => w.writeZigzag(8_640_000_000_000_001n)), /a DateTime is outside the dates a Date holds/);
    // [1, 2] as two runs, where the encoder writes one.
    refused(ArrayType(IntegerType), new Uint8Array([0x00, 0x01, 0x02, 0x01, 0x04, 0x00]), /an Array's elements are not written in one run/);
    refused(SetType(StringType), bytesOf((w) => { w.writeUint8(0); w.writeVarint(2); w.writeStringUtf8Varint("b"); w.writeStringUtf8Varint("a"); w.writeVarint(0); }),
      /a Set's elements do not strictly ascend/);
    refused(DictType(StringType, IntegerType), bytesOf((w) => { w.writeUint8(0); w.writeVarint(2); w.writeStringUtf8Varint("a"); w.writeZigzag(1n); w.writeStringUtf8Varint("a"); w.writeZigzag(2n); w.writeVarint(0); }),
      /a Dict's keys do not strictly ascend/);
    // `right` aliases `left`, an Array of another type.
    refused(StructType({ left: ArrayType(IntegerType), right: ArrayType(StringType) }), new Uint8Array([0x00, 0x01, 0x02, 0x00, 0x01, 0x01]),
      /a container alias names a container of another type/);
    // An alias to a container before the value's own.
    refused(ArrayType(IntegerType), new Uint8Array([0x01, 0x01]), /a container alias reaches outside its root element/);
    refused(ArrayType(IntegerType), new Uint8Array([0x02]), /a container's tag is 0x2, neither NEW nor REF/);
    // Nulls cost no bytes, so their count is bounded as every decoder bounds it.
    refused(ArrayType(NullType), bytesOf((w) => { w.writeUint8(0); w.writeVarint(2 ** 28 + 1); w.writeVarint(0); }), /an Array holds more elements than a reader takes/);
    refused(VariantType({ a: IntegerType, b: StringType }), new Uint8Array([0x02]), /a Variant's case 2 is not one of its 2/);
    refused(FunctionType([], IntegerType), new Uint8Array([0x00]), /a function value/);
  });

  test("a lenient skipper reads what the decoder reads, and refuses the rest as the strict one does", () => {
    const lenient = (type: EastType, bytes: Uint8Array, defs: EastTypeValue[] = []): number => {
      const reader = new BufferReader(bytes, 0);
      canonicalSkipperFor(type, { lenient: true })(reader, defs);
      return reader.offset;
    };
    const refused = (type: EastType, bytes: Uint8Array, message: RegExp): void => {
      assert.throws(() => lenient(type, bytes), (err: unknown) => err instanceof Beast2NotCanonicalError && message.test(err.message));
    };
    // Varints that are not minimal, padded to ten bytes for an Integer.
    assert.equal(lenient(IntegerType, new Uint8Array([0x8a, 0x00])), 2);
    assert.equal(lenient(IntegerType, new Uint8Array([0x8a, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00])), 10);
    assert.equal(lenient(StringType, new Uint8Array([0x81, 0x00, 0x61])), 3);
    // A DateTime padded past eight bytes is measured, not refused by length.
    assert.equal(lenient(DateTimeType, new Uint8Array([0x82, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00])), 9);
    // The negative NaN, which the decoder reads as NaN.
    assert.equal(lenient(FloatType, new Uint8Array([0, 0, 0, 0, 0, 0, 0xf8, 0xff])), 8);
    // [1, 2] as two runs.
    assert.equal(lenient(ArrayType(IntegerType), new Uint8Array([0x00, 0x01, 0x02, 0x01, 0x04, 0x00])), 6);
    // An alias into an earlier row, when the rows share their definitions.
    const shared: EastTypeValue[] = [];
    assert.equal(lenient(ArrayType(IntegerType), new Uint8Array([0x00, 0x01, 0x02, 0x00]), shared), 4);
    assert.equal(lenient(ArrayType(IntegerType), new Uint8Array([0x01, 0x01]), shared), 2);

    refused(ArrayType(IntegerType), new Uint8Array([0x01, 0x01]), /a container alias reaches outside its segment/);
    refused(FloatType, new Uint8Array([1, 0, 0, 0, 0, 0, 0xf0, 0x7f]), /a NaN other than the one the Writer writes/);
    refused(BooleanType, new Uint8Array([0x02]), /a Boolean is neither 0 nor 1/);
    refused(StringType, new Uint8Array([0x01, 0x80]), /a String is not well-formed UTF-8/);
    refused(IntegerType, new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x02]), /an Integer is larger than 64 bits/);
    refused(DateTimeType, bytesOf((w) => w.writeZigzag(8_640_000_000_000_001n)), /a DateTime is outside the dates a Date holds/);
    refused(SetType(StringType), bytesOf((w) => { w.writeUint8(0); w.writeVarint(1); w.writeStringUtf8Varint("b"); w.writeVarint(1); w.writeStringUtf8Varint("a"); w.writeVarint(0); }),
      /a Set's elements do not strictly ascend/);
  });

  test("reads a varint only as the encoder writes it", () => {
    assert.equal(canonicalVarint(new BufferReader(new Uint8Array([0x7f]), 0), "a length"), 127);
    assert.equal(canonicalVarint(new BufferReader(bytesOf((w) => w.writeVarint(Number.MAX_SAFE_INTEGER)), 0), "a length"), Number.MAX_SAFE_INTEGER);
    assert.throws(() => canonicalVarint(new BufferReader(new Uint8Array([0xff, 0x00]), 0), "a length"), /a length is not a minimal varint/);
    assert.throws(() => canonicalVarint(new BufferReader(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01]), 0), "a length"), /larger than a safe integer/);
    assert.throws(() => canonicalVarint(new BufferReader(new Uint8Array([0x80]), 0), "a length"), /a length runs past the end of its bytes/);
  });
});
