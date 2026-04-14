/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v2 compliance tests — uses the East builtin interface
 * (East.Blob.encodeBeast / blob.decodeBeast) and verifies exact bytes
 * matching the format spec in devdocs/BEAST2.md.
 *
 * Every test checks:
 *   1. Exact encoded byte array
 *   2. Round-trip decode: decoded value equals original value
 */
import {
  East,
  NullType, BooleanType, IntegerType, FloatType, StringType, DateTimeType, BlobType,
  ArrayType, SetType, DictType, StructType, VariantType, FunctionType,
  variant, some, none,
  RecursiveType,
  ref,
  RefType,
  VectorType,
  MatrixType,
} from "../src/index.js";
import { describeEast as describe, assertEast as assert } from "./platforms.spec.js";
import * as ex from "./blob.examples.js";

await describe("Blob (Beast v2)", (test) => {
  assert.examples(test, { blobEncodeBeastV2: ex.blobEncodeBeastV2, blobDecodeBeastV2: ex.blobDecodeBeastV2 });

  // =========================================================================
  // Magic bytes
  // =========================================================================

  test("Beast v2 - Magic bytes verification", $ => {
    const encoded = $.let(East.Blob.encodeBeast(East.value(42n, IntegerType), 'v2'));
    $(assert.equal(encoded.getUint8(0n), 0x89n));
    $(assert.equal(encoded.getUint8(1n), 0x45n));
    $(assert.equal(encoded.getUint8(2n), 0x61n));
    $(assert.equal(encoded.getUint8(3n), 0x73n));
    $(assert.equal(encoded.getUint8(4n), 0x74n));
    $(assert.equal(encoded.getUint8(5n), 0x0Dn));
    $(assert.equal(encoded.getUint8(6n), 0x0An));
    $(assert.equal(encoded.getUint8(7n), 0x04n)); // format version 4
  });

  // =========================================================================
  // Primitives — exact bytes + round-trip
  // =========================================================================

  test("Beast v2 - Null", $ => {
    const value = $.let(East.value(null, NullType));
    const encoded = $.let(East.Blob.encodeBeast(value, 'v2'));
    $(assert.equal(encoded, East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 0,                         // type table: len=3, root=0, count=1, Null
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
    ]), BlobType)));
    $(assert.equal(encoded.decodeBeast(NullType, 'v2'), value));
  });

  test("Beast v2 - Boolean", $ => {
    const f = $.let(East.value(false, BooleanType));
    $(assert.equal(East.Blob.encodeBeast(f, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 4,                         // type table: len=3, root=0, count=1, Boolean
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      0,                                   // value: false
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(f, 'v2').decodeBeast(BooleanType, 'v2'), f));

    const t = $.let(East.value(true, BooleanType));
    $(assert.equal(East.Blob.encodeBeast(t, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 4,                         // type table
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      1,                                   // value: true
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(t, 'v2').decodeBeast(BooleanType, 'v2'), t));
  });

  test("Beast v2 - Integer zigzag", $ => {
    const zero = $.let(East.value(0n, IntegerType));
    $(assert.equal(East.Blob.encodeBeast(zero, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 2,                         // type table: Integer
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      0,                                   // zigzag(0)
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(zero, 'v2').decodeBeast(IntegerType, 'v2'), zero));

    const neg1 = $.let(East.value(-1n, IntegerType));
    $(assert.equal(East.Blob.encodeBeast(neg1, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 2,                         // type table: Integer
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      1,                                   // zigzag(-1)
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(neg1, 'v2').decodeBeast(IntegerType, 'v2'), neg1));

    const pos1 = $.let(East.value(1n, IntegerType));
    $(assert.equal(East.Blob.encodeBeast(pos1, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 2,                         // type table: Integer
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      2,                                   // zigzag(1)
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(pos1, 'v2').decodeBeast(IntegerType, 'v2'), pos1));

    const pos42 = $.let(East.value(42n, IntegerType));
    $(assert.equal(East.Blob.encodeBeast(pos42, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 2,                         // type table: Integer
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      84,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(pos42, 'v2').decodeBeast(IntegerType, 'v2'), pos42));
  });

  test("Beast v2 - Integer boundary", $ => {
    const maxInt = $.let(East.value(9223372036854775807n, IntegerType));
    $(assert.equal(East.Blob.encodeBeast(maxInt, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 2,                         // type table: Integer
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      254, 255, 255, 255, 255, 255, 255, 255, 255, 1, // zigzag(max_int64)
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(maxInt, 'v2').decodeBeast(IntegerType, 'v2'), maxInt));

    const minInt = $.let(East.value(-9223372036854775808n, IntegerType));
    $(assert.equal(East.Blob.encodeBeast(minInt, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 2,                         // type table: Integer
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      255, 255, 255, 255, 255, 255, 255, 255, 255, 1, // zigzag(min_int64)
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(minInt, 'v2').decodeBeast(IntegerType, 'v2'), minInt));
  });

  test("Beast v2 - Float", $ => {
    const zero = $.let(East.value(0.0, FloatType));
    $(assert.equal(East.Blob.encodeBeast(zero, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 3,                         // type table: Float
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      0, 0, 0, 0, 0, 0, 0, 0,             // float64 0.0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(zero, 'v2').decodeBeast(FloatType, 'v2'), zero));

    const one = $.let(East.value(1.0, FloatType));
    $(assert.equal(East.Blob.encodeBeast(one, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 3,                         // type table: Float
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      0, 0, 0, 0, 0, 0, 240, 63,          // float64 1.0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(one, 'v2').decodeBeast(FloatType, 'v2'), one));

    const pi = $.let(East.value(3.14, FloatType));
    $(assert.equal(East.Blob.encodeBeast(pi, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 3,                         // type table: Float
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      31, 133, 235, 81, 184, 30, 9, 64,   // float64 3.14
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(pi, 'v2').decodeBeast(FloatType, 'v2'), pi));

    const negInf = $.let(East.value(-Infinity, FloatType));
    $(assert.equal(East.Blob.encodeBeast(negInf, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 3,                         // type table: Float
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      0, 0, 0, 0, 0, 0, 240, 255,         // float64 -Infinity
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(negInf, 'v2').decodeBeast(FloatType, 'v2'), negInf));

    const posInf = $.let(East.value(Infinity, FloatType));
    $(assert.equal(East.Blob.encodeBeast(posInf, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 3,                         // type table: Float
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      0, 0, 0, 0, 0, 0, 240, 127,         // float64 +Infinity
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(posInf, 'v2').decodeBeast(FloatType, 'v2'), posInf));

    const nan = $.let(East.value(NaN, FloatType));
    $(assert.equal(East.Blob.encodeBeast(nan, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 3,                         // type table: Float
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      0, 0, 0, 0, 0, 0, 248, 127,         // float64 NaN
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(nan, 'v2').decodeBeast(FloatType, 'v2'), nan));
  });

  test("Beast v2 - String", $ => {
    const empty = $.let(East.value("", StringType));
    $(assert.equal(East.Blob.encodeBeast(empty, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 1,                         // type table: String
      2, 1, 0,                             // string table: 1 entry, ""
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      0,                                   // string index 0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(empty, 'v2').decodeBeast(StringType, 'v2'), empty));

    const hello = $.let(East.value("hello", StringType));
    $(assert.equal(East.Blob.encodeBeast(hello, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 1,                         // type table: String
      7, 1, 5, 104, 101, 108, 108, 111,   // string table: "hello"
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      0,                                   // string index 0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(hello, 'v2').decodeBeast(StringType, 'v2'), hello));

    const utf8 = $.let(East.value("héllo", StringType));
    $(assert.equal(East.Blob.encodeBeast(utf8, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 1,                         // type table: String
      8, 1, 6, 104, 195, 169, 108, 108, 111, // string table: "héllo"
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      0,                                   // string index 0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(utf8, 'v2').decodeBeast(StringType, 'v2'), utf8));
  });

  test("Beast v2 - DateTime", $ => {
    const epoch = $.let(East.value(new Date(0), DateTimeType));
    $(assert.equal(East.Blob.encodeBeast(epoch, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 5,                         // type table: DateTime
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      0,                                   // zigzag(0) = epoch
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(epoch, 'v2').decodeBeast(DateTimeType, 'v2'), epoch));

    const ts = $.let(East.value(new Date("2025-01-15T10:30:00.000Z"), DateTimeType));
    $(assert.equal(East.Blob.encodeBeast(ts, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 5,                         // type table: DateTime
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      128, 177, 154, 152, 141, 101,        // zigzag(timestamp)
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(ts, 'v2').decodeBeast(DateTimeType, 'v2'), ts));
  });

  test("Beast v2 - Blob", $ => {
    const empty = $.let(East.value(new Uint8Array([]), BlobType));
    $(assert.equal(East.Blob.encodeBeast(empty, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 6,                         // type table: Blob
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      0,                                   // blob length 0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(empty, 'v2').decodeBeast(BlobType, 'v2'), empty));

    const data = $.let(East.value(new Uint8Array([1, 2, 3]), BlobType));
    $(assert.equal(East.Blob.encodeBeast(data, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      3, 0, 1, 6,                         // type table: Blob
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      1, 0,                               // value table: empty
      3, 1, 2, 3,                          // blob: length 3, bytes [1,2,3]
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(data, 'v2').decodeBeast(BlobType, 'v2'), data));
  });

  // =========================================================================
  // Containers — exact bytes + round-trip
  // =========================================================================

  test("Beast v2 - Array(Integer)", $ => {
    const empty = $.let(East.value([], ArrayType(IntegerType)));
    $(assert.equal(East.Blob.encodeBeast(empty, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      5, 1, 2, 2, 10, 0,                  // type table: Array(Integer)
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      5, 1, 3, 10, 0, 0,                  // value table: 1 entry, len=3, Array(type0), count=0
      0,                                   // value stream: table ref 0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(empty, 'v2').decodeBeast(ArrayType(IntegerType), 'v2'), empty));

    const arr = $.let(East.value([1n, 2n, 3n], ArrayType(IntegerType)));
    $(assert.equal(East.Blob.encodeBeast(arr, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4, // magic v4
      5, 1, 2, 2, 10, 0,                  // type table: Array(Integer)
      1, 0,                               // string table: empty
      1, 0,                               // source map: empty
      8, 1, 6, 10, 0, 3, 2, 4, 6,         // value table: 1 entry, Array(type0), [1,2,3]
      0,                                   // value stream: table ref 0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(arr, 'v2').decodeBeast(ArrayType(IntegerType), 'v2'), arr));
  });

  test("Beast v2 - Array(String)", $ => {
    const arr = $.let(East.value(["foo", "bar"], ArrayType(StringType)));
    $(assert.equal(East.Blob.encodeBeast(arr, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,           // magic v4
      5, 1, 2, 1, 10, 0,                           // type table: Array(String)
      9, 2, 3, 102, 111, 111, 3, 98, 97, 114,     // string table: "foo","bar"
      1, 0,                                         // source map: empty
      7, 1, 5, 10, 0, 2, 0, 1,                     // value table: 1 entry, Array(String), ["foo","bar"]
      0,                                             // value stream: table ref 0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(arr, 'v2').decodeBeast(ArrayType(StringType), 'v2'), arr));
  });

  test("Beast v2 - Set(Integer)", $ => {
    const s = $.let(East.value(new Set([1n, 2n, 3n]), SetType(IntegerType)));
    $(assert.equal(East.Blob.encodeBeast(s, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,           // magic v4
      5, 1, 2, 2, 12, 0,                           // type table: Set(Integer)
      1, 0,                                         // string table: empty
      1, 0,                                         // source map: empty
      8, 1, 6, 12, 0, 3, 2, 4, 6,                  // value table: 1 entry, Set(Integer), {1,2,3}
      0,                                             // value stream: table ref 0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(s, 'v2').decodeBeast(SetType(IntegerType), 'v2'), s));
  });

  test("Beast v2 - Dict(String, Integer)", $ => {
    const d = $.let(East.value(new Map([["x", 1n], ["y", 2n]]), DictType(StringType, IntegerType)));
    $(assert.equal(East.Blob.encodeBeast(d, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,           // magic v4
      7, 2, 3, 1, 2, 11, 0, 1,                     // type table: Dict(String, Integer)
      5, 2, 1, 120, 1, 121,                         // string table: "x","y"
      1, 0,                                         // source map: empty
      10, 1, 8, 11, 0, 1, 2, 0, 2, 1, 4,           // value table: 1 entry, Dict, {x:1, y:2}
      0,                                             // value stream: table ref 0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(d, 'v2').decodeBeast(DictType(StringType, IntegerType), 'v2'), d));
  });

  test("Beast v2 - Ref(Integer)", $ => {
    const r = $.let(East.value(ref(42n), RefType(IntegerType)));
    $(assert.equal(East.Blob.encodeBeast(r, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,           // magic v4
      5, 1, 2, 2, 13, 0,                           // type table: Ref(Integer)
      1, 0,                                         // string table: empty
      1, 0,                                         // source map: empty
      5, 1, 3, 13, 0, 84,                           // value table: 1 entry, Ref(Integer), 42
      0,                                             // value stream: table ref 0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(r, 'v2').decodeBeast(RefType(IntegerType), 'v2'), r));
  });

  // =========================================================================
  // Struct — exact bytes + round-trip
  // =========================================================================

  test("Beast v2 - Struct", $ => {
    const type = StructType({ name: StringType, age: IntegerType });
    const value = $.let(East.value({ name: "Alice", age: 30n }, type));
    $(assert.equal(East.Blob.encodeBeast(value, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,                         // magic v4
      17, 2, 3, 1, 2, 9, 2, 4, 110, 97, 109, 101, 0, 3, 97, 103, 101, 1, // type table: Struct{name:String, age:Integer}
      7, 1, 5, 65, 108, 105, 99, 101,                           // string table: "Alice"
      1, 0,                                                       // source map: empty
      1, 0,                                                       // value table: empty
      0, 60,                                                      // value: string_idx=0, zigzag(30)=60
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(value, 'v2').decodeBeast(type, 'v2'), value));
  });

  test("Beast v2 - Empty struct", $ => {
    const type = StructType({});
    const value = $.let(East.value({}, type));
    $(assert.equal(East.Blob.encodeBeast(value, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,   // magic v4
      4, 0, 1, 9, 0,                       // type table: Struct{}
      1, 0,                                 // string table: empty
      1, 0,                                 // source map: empty
      1, 0,                                 // value table: empty
                                             // value: (empty struct, no fields)
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(value, 'v2').decodeBeast(type, 'v2'), value));
  });

  // =========================================================================
  // Variant — exact bytes + round-trip
  // =========================================================================

  test("Beast v2 - Variant Option", $ => {
    const OptType = VariantType({ none: NullType, some: IntegerType });

    const noneVal = $.let(East.value(none, OptType));
    $(assert.equal(East.Blob.encodeBeast(noneVal, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,                                     // magic v4
      18, 2, 3, 0, 2, 8, 2, 4, 110, 111, 110, 101, 0, 4, 115, 111, 109, 101, 1, // type table: Variant{none:Null, some:Integer}
      1, 0,                                                                   // string table: empty
      1, 0,                                                                   // source map: empty
      1, 0,                                                                   // value table: empty
      0,                                                                       // value: case 0 (none)
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(noneVal, 'v2').decodeBeast(OptType, 'v2'), noneVal));

    const someVal = $.let(East.value(some(42n), OptType));
    $(assert.equal(East.Blob.encodeBeast(someVal, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,                                     // magic v4
      18, 2, 3, 0, 2, 8, 2, 4, 110, 111, 110, 101, 0, 4, 115, 111, 109, 101, 1, // type table
      1, 0,                                                                   // string table: empty
      1, 0,                                                                   // source map: empty
      1, 0,                                                                   // value table: empty
      1, 84,                                                                   // value: case 1 (some), zigzag(42)=84
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(someVal, 'v2').decodeBeast(OptType, 'v2'), someVal));
  });

  // =========================================================================
  // Recursive — exact bytes + round-trip
  // =========================================================================

  test("Beast v2 - Recursive linked list", $ => {
    const ListType = RecursiveType(self => VariantType({
      nil: NullType,
      cons: StructType({ head: IntegerType, tail: self }),
    }));

    const nilVal = $.let(East.value(variant("nil"), ListType));
    $(assert.equal(East.Blob.encodeBeast(nilVal, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,           // magic v4
      33, 0, 5, 18, 4, 2, 9, 2, 4, 104, 101, 97, 100, 1, 4, 116, 97, 105, 108, 0, 0, 8, 2, 4, 99, 111, 110, 115, 2, 3, 110, 105, 108, 3, // type table: Recursive(Variant{cons:{head:Int,tail:self}, nil:Null})
      1, 0,                                         // string table: empty
      1, 0,                                         // source map: empty
      1, 0,                                         // value table: empty
      1,                                             // value: case 1 (nil)
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(nilVal, 'v2').decodeBeast(ListType, 'v2'), nilVal));

    const listVal = $.let(East.value(
      variant("cons", { head: 1n, tail: variant("cons", { head: 2n, tail: variant("nil") }) }),
      ListType,
    ));
    $(assert.equal(East.Blob.encodeBeast(listVal, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,           // magic v4
      33, 0, 5, 18, 4, 2, 9, 2, 4, 104, 101, 97, 100, 1, 4, 116, 97, 105, 108, 0, 0, 8, 2, 4, 99, 111, 110, 115, 2, 3, 110, 105, 108, 3, // type table
      1, 0,                                         // string table: empty
      1, 0,                                         // source map: empty
      1, 0,                                         // value table: empty
      0, 2, 0, 4, 1,                                // cons{head:1, tail:cons{head:2, tail:nil}}
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(listVal, 'v2').decodeBeast(ListType, 'v2'), listVal));
  });

  // =========================================================================
  // Vectors — exact bytes + round-trip
  // =========================================================================

  test("Beast v2 - Vector<Float>", $ => {
    const v = $.let(East.Vector.fromArray([1.0, 2.5, 3.7]));
    $(assert.equal(East.Blob.encodeBeast(v, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,   // magic v4
      5, 1, 2, 3, 14, 0,                   // type table: Vector(Float)
      1, 0,                                 // string table: empty
      1, 0,                                 // source map: empty
      1, 0,                                 // value table: empty
      3,                                     // vector length: 3
      0, 0, 0, 0, 0, 0, 240, 63,           // float64 1.0
      0, 0, 0, 0, 0, 0, 4, 64,             // float64 2.5
      154, 153, 153, 153, 153, 153, 13, 64, // float64 3.7
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(v, 'v2').decodeBeast(VectorType(FloatType), 'v2'), v));
  });

  test("Beast v2 - Vector<Integer>", $ => {
    const v = $.let(East.Vector.fromArray([10n, 20n, 30n]));
    $(assert.equal(East.Blob.encodeBeast(v, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,   // magic v4
      5, 1, 2, 2, 14, 0,                   // type table: Vector(Integer)
      1, 0,                                 // string table: empty
      1, 0,                                 // source map: empty
      1, 0,                                 // value table: empty
      3,                                     // vector length: 3
      10, 0, 0, 0, 0, 0, 0, 0,             // int64 10
      20, 0, 0, 0, 0, 0, 0, 0,             // int64 20
      30, 0, 0, 0, 0, 0, 0, 0,             // int64 30
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(v, 'v2').decodeBeast(VectorType(IntegerType), 'v2'), v));
  });

  test("Beast v2 - Vector<Boolean>", $ => {
    const v = $.let(East.Vector.fromArray([true, false, true]));
    $(assert.equal(East.Blob.encodeBeast(v, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,   // magic v4
      5, 1, 2, 4, 14, 0,                   // type table: Vector(Boolean)
      1, 0,                                 // string table: empty
      1, 0,                                 // source map: empty
      1, 0,                                 // value table: empty
      3,                                     // vector length: 3
      1, 0, 1,                              // bool: true, false, true
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(v, 'v2').decodeBeast(VectorType(BooleanType), 'v2'), v));
  });

  test("Beast v2 - Vector empty", $ => {
    const v = $.let(East.Vector.zeros(0n));
    $(assert.equal(East.Blob.encodeBeast(v, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,   // magic v4
      5, 1, 2, 3, 14, 0,                   // type table: Vector(Float)
      1, 0,                                 // string table: empty
      1, 0,                                 // source map: empty
      1, 0,                                 // value table: empty
      0,                                     // vector length: 0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(v, 'v2').decodeBeast(VectorType(FloatType), 'v2'), v));
  });

  // =========================================================================
  // Matrices — exact bytes + round-trip
  // =========================================================================

  test("Beast v2 - Matrix<Float> 2x2", $ => {
    const m = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0]]));
    $(assert.equal(East.Blob.encodeBeast(m, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,   // magic v4
      5, 1, 2, 3, 15, 0,                   // type table: Matrix(Float)
      1, 0,                                 // string table: empty
      1, 0,                                 // source map: empty
      1, 0,                                 // value table: empty
      2, 2,                                  // rows=2, cols=2
      0, 0, 0, 0, 0, 0, 240, 63,           // 1.0
      0, 0, 0, 0, 0, 0, 0, 64,             // 2.0
      0, 0, 0, 0, 0, 0, 8, 64,             // 3.0
      0, 0, 0, 0, 0, 0, 16, 64,            // 4.0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(m, 'v2').decodeBeast(MatrixType(FloatType), 'v2'), m));
  });

  test("Beast v2 - Matrix<Integer> 2x2", $ => {
    const m = $.let(East.Matrix.fromArray([[10n, 20n], [30n, 40n]]));
    $(assert.equal(East.Blob.encodeBeast(m, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,   // magic v4
      5, 1, 2, 2, 15, 0,                   // type table: Matrix(Integer)
      1, 0,                                 // string table: empty
      1, 0,                                 // source map: empty
      1, 0,                                 // value table: empty
      2, 2,                                  // rows=2, cols=2
      10, 0, 0, 0, 0, 0, 0, 0,             // int64 10
      20, 0, 0, 0, 0, 0, 0, 0,             // int64 20
      30, 0, 0, 0, 0, 0, 0, 0,             // int64 30
      40, 0, 0, 0, 0, 0, 0, 0,             // int64 40
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(m, 'v2').decodeBeast(MatrixType(IntegerType), 'v2'), m));
  });

  test("Beast v2 - Matrix<Boolean> 2x2", $ => {
    const m = $.let(East.Matrix.fromArray([[true, false], [false, true]]));
    $(assert.equal(East.Blob.encodeBeast(m, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,   // magic v4
      5, 1, 2, 4, 15, 0,                   // type table: Matrix(Boolean)
      1, 0,                                 // string table: empty
      1, 0,                                 // source map: empty
      1, 0,                                 // value table: empty
      2, 2,                                  // rows=2, cols=2
      1, 0, 0, 1,                           // true, false, false, true
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(m, 'v2').decodeBeast(MatrixType(BooleanType), 'v2'), m));
  });

  test("Beast v2 - Matrix empty", $ => {
    const m = $.let(East.Matrix.zeros(0n, 0n));
    $(assert.equal(East.Blob.encodeBeast(m, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 4,   // magic v4
      5, 1, 2, 3, 15, 0,                   // type table: Matrix(Float)
      1, 0,                                 // string table: empty
      1, 0,                                 // source map: empty
      1, 0,                                 // value table: empty
      0, 0,                                  // rows=0, cols=0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(m, 'v2').decodeBeast(MatrixType(FloatType), 'v2'), m));
  });

  // =========================================================================
  // Functions — round-trip
  // =========================================================================

  test("Beast v2 - Simple function (no captures)", $ => {
    const FnType = FunctionType([IntegerType], IntegerType);
    const fn = $.let(East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)));
    const blob = $.let(East.Blob.encodeBeast(fn, 'v2'));

    $(assert.equal(blob, East.value(new Uint8Array([
      137,69,97,115,116,13,10,4,181,12,1,54,2,16,1,0,0,18,53,18,
      13,10,3,9,2,6,105,110,112,117,116,115,4,6,111,117,116,112,117,116,
      3,0,9,2,3,107,101,121,3,5,118,97,108,117,101,3,9,2,2,105,
      100,0,5,105,110,110,101,114,3,8,2,3,114,101,102,0,7,119,114,97,
      112,112,101,114,8,1,9,2,4,110,97,109,101,10,4,116,121,112,101,3,
      10,11,8,19,5,65,114,114,97,121,3,13,65,115,121,110,99,70,117,110,
      99,116,105,111,110,5,4,66,108,111,98,6,7,66,111,111,108,101,97,110,
      6,8,68,97,116,101,84,105,109,101,6,4,68,105,99,116,7,5,70,108,
      111,97,116,6,8,70,117,110,99,116,105,111,110,5,7,73,110,116,101,103,
      101,114,6,6,77,97,116,114,105,120,3,5,78,101,118,101,114,6,4,78,
      117,108,108,6,9,82,101,99,117,114,115,105,118,101,9,3,82,101,102,3,
      3,83,101,116,3,6,83,116,114,105,110,103,6,6,83,116,114,117,99,116,
      12,7,86,97,114,105,97,110,116,12,6,86,101,99,116,111,114,3,9,3,
      4,116,121,112,101,3,6,108,111,99,95,105,100,0,5,118,97,108,117,101,
      2,9,4,4,116,121,112,101,3,6,108,111,99,95,105,100,0,8,118,97,
      114,105,97,98,108,101,2,5,118,97,108,117,101,2,10,2,9,5,4,116,
      121,112,101,3,6,108,111,99,95,105,100,0,8,99,97,112,116,117,114,101,
      115,16,10,112,97,114,97,109,101,116,101,114,115,16,4,98,111,100,121,2,
      9,3,4,116,121,112,101,3,6,108,111,99,95,105,100,0,10,115,116,97,
      116,101,109,101,110,116,115,16,9,2,4,110,97,109,101,10,6,108,111,99,
      95,105,100,0,9,3,4,116,121,112,101,3,6,108,111,99,95,105,100,0,
      5,108,97,98,101,108,19,9,5,4,116,121,112,101,3,6,108,111,99,95,
      105,100,0,7,98,117,105,108,116,105,110,10,15,116,121,112,101,95,112,97,
      114,97,109,101,116,101,114,115,4,9,97,114,103,117,109,101,110,116,115,16,
      9,4,4,116,121,112,101,3,6,108,111,99,95,105,100,0,8,102,117,110,
      99,116,105,111,110,2,9,97,114,103,117,109,101,110,116,115,16,9,3,4,
      116,121,112,101,3,6,108,111,99,95,105,100,0,7,109,101,115,115,97,103,
      101,2,9,7,4,116,121,112,101,3,6,108,111,99,95,105,100,0,5,97,
      114,114,97,121,2,5,108,97,98,101,108,19,3,107,101,121,2,5,118,97,
      108,117,101,2,4,98,111,100,121,2,9,7,4,116,121,112,101,3,6,108,
      111,99,95,105,100,0,4,100,105,99,116,2,5,108,97,98,101,108,19,3,
      107,101,121,2,5,118,97,108,117,101,2,4,98,111,100,121,2,9,6,4,
      116,121,112,101,3,6,108,111,99,95,105,100,0,3,115,101,116,2,5,108,
      97,98,101,108,19,3,107,101,121,2,4,98,111,100,121,2,9,4,4,116,
      121,112,101,3,6,108,111,99,95,105,100,0,5,102,105,101,108,100,10,6,
      115,116,114,117,99,116,2,9,2,9,112,114,101,100,105,99,97,116,101,2,
      4,98,111,100,121,2,10,28,9,4,4,116,121,112,101,3,6,108,111,99,
      95,105,100,0,3,105,102,115,29,9,101,108,115,101,95,98,111,100,121,2,
      9,3,4,99,97,115,101,10,8,118,97,114,105,97,98,108,101,2,4,98,
      111,100,121,2,10,31,9,4,4,116,121,112,101,3,6,108,111,99,95,105,
      100,0,7,118,97,114,105,97,110,116,2,5,99,97,115,101,115,32,9,3,
      4,116,121,112,101,3,6,108,111,99,95,105,100,0,6,118,97,108,117,101,
      115,16,9,2,3,107,101,121,2,5,118,97,108,117,101,2,10,35,9,3,
      4,116,121,112,101,3,6,108,111,99,95,105,100,0,6,118,97,108,117,101,
      115,36,9,5,4,116,121,112,101,3,6,108,111,99,95,105,100,0,6,118,
      97,108,117,101,115,16,4,114,111,119,115,0,4,99,111,108,115,0,4,9,
      7,4,116,121,112,101,3,6,108,111,99,95,105,100,0,4,110,97,109,101,
      10,15,116,121,112,101,95,112,97,114,97,109,101,116,101,114,115,4,9,97,
      114,103,117,109,101,110,116,115,16,5,97,115,121,110,99,39,8,111,112,116,
      105,111,110,97,108,39,9,2,4,110,97,109,101,10,5,118,97,108,117,101,
      2,10,41,9,3,4,116,121,112,101,3,6,108,111,99,95,105,100,0,6,
      102,105,101,108,100,115,42,9,7,4,116,121,112,101,3,6,108,111,99,95,
      105,100,0,8,116,114,121,95,98,111,100,121,2,10,99,97,116,99,104,95,
      98,111,100,121,2,7,109,101,115,115,97,103,101,2,5,115,116,97,99,107,
      2,12,102,105,110,97,108,108,121,95,98,111,100,121,2,6,5,3,8,7,
      4,66,108,111,98,45,7,66,111,111,108,101,97,110,39,8,68,97,116,101,
      84,105,109,101,46,5,70,108,111,97,116,47,7,73,110,116,101,103,101,114,
      0,4,78,117,108,108,6,6,83,116,114,105,110,103,10,9,3,4,116,121,
      112,101,3,6,108,111,99,95,105,100,0,5,118,97,108,117,101,48,9,5,
      4,116,121,112,101,3,6,108,111,99,95,105,100,0,4,110,97,109,101,10,
      7,109,117,116,97,98,108,101,39,8,99,97,112,116,117,114,101,100,39,9,
      4,4,116,121,112,101,3,6,108,111,99,95,105,100,0,4,99,97,115,101,
      10,5,118,97,108,117,101,2,9,5,4,116,121,112,101,3,6,108,111,99,
      95,105,100,0,9,112,114,101,100,105,99,97,116,101,2,5,108,97,98,101,
      108,19,4,98,111,100,121,2,8,34,2,65,115,14,6,65,115,115,105,103,
      110,15,13,65,115,121,110,99,70,117,110,99,116,105,111,110,17,5,66,108,
      111,99,107,18,5,66,114,101,97,107,20,7,66,117,105,108,116,105,110,21,
      4,67,97,108,108,22,9,67,97,108,108,65,115,121,110,99,22,8,67,111,
      110,116,105,110,117,101,20,5,69,114,114,111,114,23,8,70,111,114,65,114,
      114,97,121,24,7,70,111,114,68,105,99,116,25,6,70,111,114,83,101,116,
      26,8,70,117,110,99,116,105,111,110,17,8,71,101,116,70,105,101,108,100,
      27,6,73,102,69,108,115,101,30,3,76,101,116,15,5,77,97,116,99,104,
      33,8,78,101,119,65,114,114,97,121,34,7,78,101,119,68,105,99,116,37,
      9,78,101,119,77,97,116,114,105,120,38,6,78,101,119,82,101,102,14,6,
      78,101,119,83,101,116,34,9,78,101,119,86,101,99,116,111,114,34,8,80,
      108,97,116,102,111,114,109,40,6,82,101,116,117,114,110,14,6,83,116,114,
      117,99,116,43,8,84,114,121,67,97,116,99,104,44,15,85,110,119,114,97,
      112,82,101,99,117,114,115,105,118,101,14,5,86,97,108,117,101,49,8,86,
      97,114,105,97,98,108,101,50,7,86,97,114,105,97,110,116,51,5,87,104,
      105,108,101,52,13,87,114,97,112,82,101,99,117,114,115,105,118,101,14,22,
      2,4,95,54,49,51,15,73,110,116,101,103,101,114,77,117,108,116,105,112,
      108,121,1,0,42,5,4,10,3,1,8,3,10,2,0,10,10,2,1,30,
      8,218,51,0,0,0,3,10,3,0,16,10,2,2,30,8,218,51,0,0,
      0,29,8,220,51,4,4,13,7,0,8,226,51,1,2,5,8,222,51,1,
      3,4,0,
    ]), BlobType)));
    const decoded = $.let(blob.decodeBeast(FnType, 'v2'));
    $(assert.equal(decoded(21n), 42n));
  });

  test("Beast v2 - Function with capture", $ => {
    const FnType = FunctionType([IntegerType], IntegerType);
    const offset = $.const(10n, IntegerType);
    const fn = $.let(East.function([IntegerType], IntegerType, ($, x) => x.add(offset)));
    const blob = $.let(East.Blob.encodeBeast(fn, 'v2'));

    $(assert.equal(blob, East.value(new Uint8Array([
      137,69,97,115,116,13,10,4,181,12,1,54,2,16,1,0,0,18,53,18,
      13,10,3,9,2,6,105,110,112,117,116,115,4,6,111,117,116,112,117,116,
      3,0,9,2,3,107,101,121,3,5,118,97,108,117,101,3,9,2,2,105,
      100,0,5,105,110,110,101,114,3,8,2,3,114,101,102,0,7,119,114,97,
      112,112,101,114,8,1,9,2,4,110,97,109,101,10,4,116,121,112,101,3,
      10,11,8,19,5,65,114,114,97,121,3,13,65,115,121,110,99,70,117,110,
      99,116,105,111,110,5,4,66,108,111,98,6,7,66,111,111,108,101,97,110,
      6,8,68,97,116,101,84,105,109,101,6,4,68,105,99,116,7,5,70,108,
      111,97,116,6,8,70,117,110,99,116,105,111,110,5,7,73,110,116,101,103,
      101,114,6,6,77,97,116,114,105,120,3,5,78,101,118,101,114,6,4,78,
      117,108,108,6,9,82,101,99,117,114,115,105,118,101,9,3,82,101,102,3,
      3,83,101,116,3,6,83,116,114,105,110,103,6,6,83,116,114,117,99,116,
      12,7,86,97,114,105,97,110,116,12,6,86,101,99,116,111,114,3,9,3,
      4,116,121,112,101,3,6,108,111,99,95,105,100,0,5,118,97,108,117,101,
      2,9,4,4,116,121,112,101,3,6,108,111,99,95,105,100,0,8,118,97,
      114,105,97,98,108,101,2,5,118,97,108,117,101,2,10,2,9,5,4,116,
      121,112,101,3,6,108,111,99,95,105,100,0,8,99,97,112,116,117,114,101,
      115,16,10,112,97,114,97,109,101,116,101,114,115,16,4,98,111,100,121,2,
      9,3,4,116,121,112,101,3,6,108,111,99,95,105,100,0,10,115,116,97,
      116,101,109,101,110,116,115,16,9,2,4,110,97,109,101,10,6,108,111,99,
      95,105,100,0,9,3,4,116,121,112,101,3,6,108,111,99,95,105,100,0,
      5,108,97,98,101,108,19,9,5,4,116,121,112,101,3,6,108,111,99,95,
      105,100,0,7,98,117,105,108,116,105,110,10,15,116,121,112,101,95,112,97,
      114,97,109,101,116,101,114,115,4,9,97,114,103,117,109,101,110,116,115,16,
      9,4,4,116,121,112,101,3,6,108,111,99,95,105,100,0,8,102,117,110,
      99,116,105,111,110,2,9,97,114,103,117,109,101,110,116,115,16,9,3,4,
      116,121,112,101,3,6,108,111,99,95,105,100,0,7,109,101,115,115,97,103,
      101,2,9,7,4,116,121,112,101,3,6,108,111,99,95,105,100,0,5,97,
      114,114,97,121,2,5,108,97,98,101,108,19,3,107,101,121,2,5,118,97,
      108,117,101,2,4,98,111,100,121,2,9,7,4,116,121,112,101,3,6,108,
      111,99,95,105,100,0,4,100,105,99,116,2,5,108,97,98,101,108,19,3,
      107,101,121,2,5,118,97,108,117,101,2,4,98,111,100,121,2,9,6,4,
      116,121,112,101,3,6,108,111,99,95,105,100,0,3,115,101,116,2,5,108,
      97,98,101,108,19,3,107,101,121,2,4,98,111,100,121,2,9,4,4,116,
      121,112,101,3,6,108,111,99,95,105,100,0,5,102,105,101,108,100,10,6,
      115,116,114,117,99,116,2,9,2,9,112,114,101,100,105,99,97,116,101,2,
      4,98,111,100,121,2,10,28,9,4,4,116,121,112,101,3,6,108,111,99,
      95,105,100,0,3,105,102,115,29,9,101,108,115,101,95,98,111,100,121,2,
      9,3,4,99,97,115,101,10,8,118,97,114,105,97,98,108,101,2,4,98,
      111,100,121,2,10,31,9,4,4,116,121,112,101,3,6,108,111,99,95,105,
      100,0,7,118,97,114,105,97,110,116,2,5,99,97,115,101,115,32,9,3,
      4,116,121,112,101,3,6,108,111,99,95,105,100,0,6,118,97,108,117,101,
      115,16,9,2,3,107,101,121,2,5,118,97,108,117,101,2,10,35,9,3,
      4,116,121,112,101,3,6,108,111,99,95,105,100,0,6,118,97,108,117,101,
      115,36,9,5,4,116,121,112,101,3,6,108,111,99,95,105,100,0,6,118,
      97,108,117,101,115,16,4,114,111,119,115,0,4,99,111,108,115,0,4,9,
      7,4,116,121,112,101,3,6,108,111,99,95,105,100,0,4,110,97,109,101,
      10,15,116,121,112,101,95,112,97,114,97,109,101,116,101,114,115,4,9,97,
      114,103,117,109,101,110,116,115,16,5,97,115,121,110,99,39,8,111,112,116,
      105,111,110,97,108,39,9,2,4,110,97,109,101,10,5,118,97,108,117,101,
      2,10,41,9,3,4,116,121,112,101,3,6,108,111,99,95,105,100,0,6,
      102,105,101,108,100,115,42,9,7,4,116,121,112,101,3,6,108,111,99,95,
      105,100,0,8,116,114,121,95,98,111,100,121,2,10,99,97,116,99,104,95,
      98,111,100,121,2,7,109,101,115,115,97,103,101,2,5,115,116,97,99,107,
      2,12,102,105,110,97,108,108,121,95,98,111,100,121,2,6,5,3,8,7,
      4,66,108,111,98,45,7,66,111,111,108,101,97,110,39,8,68,97,116,101,
      84,105,109,101,46,5,70,108,111,97,116,47,7,73,110,116,101,103,101,114,
      0,4,78,117,108,108,6,6,83,116,114,105,110,103,10,9,3,4,116,121,
      112,101,3,6,108,111,99,95,105,100,0,5,118,97,108,117,101,48,9,5,
      4,116,121,112,101,3,6,108,111,99,95,105,100,0,4,110,97,109,101,10,
      7,109,117,116,97,98,108,101,39,8,99,97,112,116,117,114,101,100,39,9,
      4,4,116,121,112,101,3,6,108,111,99,95,105,100,0,4,99,97,115,101,
      10,5,118,97,108,117,101,2,9,5,4,116,121,112,101,3,6,108,111,99,
      95,105,100,0,9,112,114,101,100,105,99,97,116,101,2,5,108,97,98,101,
      108,19,4,98,111,100,121,2,8,34,2,65,115,14,6,65,115,115,105,103,
      110,15,13,65,115,121,110,99,70,117,110,99,116,105,111,110,17,5,66,108,
      111,99,107,18,5,66,114,101,97,107,20,7,66,117,105,108,116,105,110,21,
      4,67,97,108,108,22,9,67,97,108,108,65,115,121,110,99,22,8,67,111,
      110,116,105,110,117,101,20,5,69,114,114,111,114,23,8,70,111,114,65,114,
      114,97,121,24,7,70,111,114,68,105,99,116,25,6,70,111,114,83,101,116,
      26,8,70,117,110,99,116,105,111,110,17,8,71,101,116,70,105,101,108,100,
      27,6,73,102,69,108,115,101,30,3,76,101,116,15,5,77,97,116,99,104,
      33,8,78,101,119,65,114,114,97,121,34,7,78,101,119,68,105,99,116,37,
      9,78,101,119,77,97,116,114,105,120,38,6,78,101,119,82,101,102,14,6,
      78,101,119,83,101,116,34,9,78,101,119,86,101,99,116,111,114,34,8,80,
      108,97,116,102,111,114,109,40,6,82,101,116,117,114,110,14,6,83,116,114,
      117,99,116,43,8,84,114,121,67,97,116,99,104,44,15,85,110,119,114,97,
      112,82,101,99,117,114,115,105,118,101,14,5,86,97,108,117,101,49,8,86,
      97,114,105,97,98,108,101,50,7,86,97,114,105,97,110,116,51,5,87,104,
      105,108,101,52,13,87,114,97,112,82,101,99,117,114,115,105,118,101,14,22,
      3,4,95,54,50,57,4,95,54,51,48,10,73,110,116,101,103,101,114,65,
      100,100,1,0,50,5,4,10,3,1,8,10,10,2,1,30,8,252,52,0,
      0,1,10,10,2,1,30,8,128,53,1,0,0,3,10,3,0,17,10,2,
      2,30,8,128,53,1,0,0,30,8,252,52,0,0,1,13,7,0,8,134,
      53,1,2,5,8,130,53,2,3,4,1,20,
    ]), BlobType)));
    const decoded = $.let(blob.decodeBeast(FnType, 'v2'));
    $(assert.equal(decoded(32n), 42n));
  });

  test("Beast v2 - Function capturing array", $ => {
    const FnType = FunctionType([IntegerType], IntegerType);
    const arr = $.const([10n, 20n, 30n], ArrayType(IntegerType));
    const fn = $.let(East.function([IntegerType], IntegerType, ($, i) => arr.get(i)));
    const blob = $.let(East.Blob.encodeBeast(fn, 'v2'));

    $(assert.equal(blob, East.value(new Uint8Array([
      137,69,97,115,116,13,10,4,181,12,1,54,2,16,1,0,0,18,53,18,
      13,10,3,9,2,6,105,110,112,117,116,115,4,6,111,117,116,112,117,116,
      3,0,9,2,3,107,101,121,3,5,118,97,108,117,101,3,9,2,2,105,
      100,0,5,105,110,110,101,114,3,8,2,3,114,101,102,0,7,119,114,97,
      112,112,101,114,8,1,9,2,4,110,97,109,101,10,4,116,121,112,101,3,
      10,11,8,19,5,65,114,114,97,121,3,13,65,115,121,110,99,70,117,110,
      99,116,105,111,110,5,4,66,108,111,98,6,7,66,111,111,108,101,97,110,
      6,8,68,97,116,101,84,105,109,101,6,4,68,105,99,116,7,5,70,108,
      111,97,116,6,8,70,117,110,99,116,105,111,110,5,7,73,110,116,101,103,
      101,114,6,6,77,97,116,114,105,120,3,5,78,101,118,101,114,6,4,78,
      117,108,108,6,9,82,101,99,117,114,115,105,118,101,9,3,82,101,102,3,
      3,83,101,116,3,6,83,116,114,105,110,103,6,6,83,116,114,117,99,116,
      12,7,86,97,114,105,97,110,116,12,6,86,101,99,116,111,114,3,9,3,
      4,116,121,112,101,3,6,108,111,99,95,105,100,0,5,118,97,108,117,101,
      2,9,4,4,116,121,112,101,3,6,108,111,99,95,105,100,0,8,118,97,
      114,105,97,98,108,101,2,5,118,97,108,117,101,2,10,2,9,5,4,116,
      121,112,101,3,6,108,111,99,95,105,100,0,8,99,97,112,116,117,114,101,
      115,16,10,112,97,114,97,109,101,116,101,114,115,16,4,98,111,100,121,2,
      9,3,4,116,121,112,101,3,6,108,111,99,95,105,100,0,10,115,116,97,
      116,101,109,101,110,116,115,16,9,2,4,110,97,109,101,10,6,108,111,99,
      95,105,100,0,9,3,4,116,121,112,101,3,6,108,111,99,95,105,100,0,
      5,108,97,98,101,108,19,9,5,4,116,121,112,101,3,6,108,111,99,95,
      105,100,0,7,98,117,105,108,116,105,110,10,15,116,121,112,101,95,112,97,
      114,97,109,101,116,101,114,115,4,9,97,114,103,117,109,101,110,116,115,16,
      9,4,4,116,121,112,101,3,6,108,111,99,95,105,100,0,8,102,117,110,
      99,116,105,111,110,2,9,97,114,103,117,109,101,110,116,115,16,9,3,4,
      116,121,112,101,3,6,108,111,99,95,105,100,0,7,109,101,115,115,97,103,
      101,2,9,7,4,116,121,112,101,3,6,108,111,99,95,105,100,0,5,97,
      114,114,97,121,2,5,108,97,98,101,108,19,3,107,101,121,2,5,118,97,
      108,117,101,2,4,98,111,100,121,2,9,7,4,116,121,112,101,3,6,108,
      111,99,95,105,100,0,4,100,105,99,116,2,5,108,97,98,101,108,19,3,
      107,101,121,2,5,118,97,108,117,101,2,4,98,111,100,121,2,9,6,4,
      116,121,112,101,3,6,108,111,99,95,105,100,0,3,115,101,116,2,5,108,
      97,98,101,108,19,3,107,101,121,2,4,98,111,100,121,2,9,4,4,116,
      121,112,101,3,6,108,111,99,95,105,100,0,5,102,105,101,108,100,10,6,
      115,116,114,117,99,116,2,9,2,9,112,114,101,100,105,99,97,116,101,2,
      4,98,111,100,121,2,10,28,9,4,4,116,121,112,101,3,6,108,111,99,
      95,105,100,0,3,105,102,115,29,9,101,108,115,101,95,98,111,100,121,2,
      9,3,4,99,97,115,101,10,8,118,97,114,105,97,98,108,101,2,4,98,
      111,100,121,2,10,31,9,4,4,116,121,112,101,3,6,108,111,99,95,105,
      100,0,7,118,97,114,105,97,110,116,2,5,99,97,115,101,115,32,9,3,
      4,116,121,112,101,3,6,108,111,99,95,105,100,0,6,118,97,108,117,101,
      115,16,9,2,3,107,101,121,2,5,118,97,108,117,101,2,10,35,9,3,
      4,116,121,112,101,3,6,108,111,99,95,105,100,0,6,118,97,108,117,101,
      115,36,9,5,4,116,121,112,101,3,6,108,111,99,95,105,100,0,6,118,
      97,108,117,101,115,16,4,114,111,119,115,0,4,99,111,108,115,0,4,9,
      7,4,116,121,112,101,3,6,108,111,99,95,105,100,0,4,110,97,109,101,
      10,15,116,121,112,101,95,112,97,114,97,109,101,116,101,114,115,4,9,97,
      114,103,117,109,101,110,116,115,16,5,97,115,121,110,99,39,8,111,112,116,
      105,111,110,97,108,39,9,2,4,110,97,109,101,10,5,118,97,108,117,101,
      2,10,41,9,3,4,116,121,112,101,3,6,108,111,99,95,105,100,0,6,
      102,105,101,108,100,115,42,9,7,4,116,121,112,101,3,6,108,111,99,95,
      105,100,0,8,116,114,121,95,98,111,100,121,2,10,99,97,116,99,104,95,
      98,111,100,121,2,7,109,101,115,115,97,103,101,2,5,115,116,97,99,107,
      2,12,102,105,110,97,108,108,121,95,98,111,100,121,2,6,5,3,8,7,
      4,66,108,111,98,45,7,66,111,111,108,101,97,110,39,8,68,97,116,101,
      84,105,109,101,46,5,70,108,111,97,116,47,7,73,110,116,101,103,101,114,
      0,4,78,117,108,108,6,6,83,116,114,105,110,103,10,9,3,4,116,121,
      112,101,3,6,108,111,99,95,105,100,0,5,118,97,108,117,101,48,9,5,
      4,116,121,112,101,3,6,108,111,99,95,105,100,0,4,110,97,109,101,10,
      7,109,117,116,97,98,108,101,39,8,99,97,112,116,117,114,101,100,39,9,
      4,4,116,121,112,101,3,6,108,111,99,95,105,100,0,4,99,97,115,101,
      10,5,118,97,108,117,101,2,9,5,4,116,121,112,101,3,6,108,111,99,
      95,105,100,0,9,112,114,101,100,105,99,97,116,101,2,5,108,97,98,101,
      108,19,4,98,111,100,121,2,8,34,2,65,115,14,6,65,115,115,105,103,
      110,15,13,65,115,121,110,99,70,117,110,99,116,105,111,110,17,5,66,108,
      111,99,107,18,5,66,114,101,97,107,20,7,66,117,105,108,116,105,110,21,
      4,67,97,108,108,22,9,67,97,108,108,65,115,121,110,99,22,8,67,111,
      110,116,105,110,117,101,20,5,69,114,114,111,114,23,8,70,111,114,65,114,
      114,97,121,24,7,70,111,114,68,105,99,116,25,6,70,111,114,83,101,116,
      26,8,70,117,110,99,116,105,111,110,17,8,71,101,116,70,105,101,108,100,
      27,6,73,102,69,108,115,101,30,3,76,101,116,15,5,77,97,116,99,104,
      33,8,78,101,119,65,114,114,97,121,34,7,78,101,119,68,105,99,116,37,
      9,78,101,119,77,97,116,114,105,120,38,6,78,101,119,82,101,102,14,6,
      78,101,119,83,101,116,34,9,78,101,119,86,101,99,116,111,114,34,8,80,
      108,97,116,102,111,114,109,40,6,82,101,116,117,114,110,14,6,83,116,114,
      117,99,116,43,8,84,114,121,67,97,116,99,104,44,15,85,110,119,114,97,
      112,82,101,99,117,114,115,105,118,101,14,5,86,97,108,117,101,49,8,86,
      97,114,105,97,98,108,101,50,7,86,97,114,105,97,110,116,51,5,87,104,
      105,108,101,52,13,87,114,97,112,82,101,99,117,114,115,105,118,101,14,20,
      3,4,95,54,52,54,4,95,54,52,55,8,65,114,114,97,121,71,101,116,
      1,0,60,6,4,10,3,1,8,11,10,2,1,30,0,8,160,54,0,0,
      1,10,10,2,1,30,8,164,54,1,0,0,4,10,3,1,8,18,10,2,
      2,30,0,8,160,54,0,0,1,30,8,164,54,1,0,0,6,10,0,3,
      20,40,60,13,7,0,8,172,54,1,2,5,8,168,54,2,3,4,1,5,
    ]), BlobType)));
    const decoded = $.let(blob.decodeBeast(FnType, 'v2'));
    $(assert.equal(decoded(1n), 20n));
  });

  test("Beast v2 - Array of functions", $ => {
    const FnType = FunctionType([IntegerType], IntegerType);
    const ArrFnType = ArrayType(FnType);
    const fns = $.const([
      East.function([IntegerType], IntegerType, ($, x) => x.add(1n)),
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)),
    ], ArrFnType);
    const blob = $.let(East.Blob.encodeBeast(fns, 'v2'));

    $(assert.equal(blob, East.value(new Uint8Array([
      137,69,97,115,116,13,10,4,183,12,2,55,2,16,1,0,0,10,1,18,
      54,18,14,10,4,9,2,6,105,110,112,117,116,115,5,6,111,117,116,112,
      117,116,4,0,9,2,3,107,101,121,4,5,118,97,108,117,101,4,9,2,
      2,105,100,0,5,105,110,110,101,114,4,8,2,3,114,101,102,0,7,119,
      114,97,112,112,101,114,9,1,9,2,4,110,97,109,101,11,4,116,121,112,
      101,4,10,12,8,19,5,65,114,114,97,121,4,13,65,115,121,110,99,70,
      117,110,99,116,105,111,110,6,4,66,108,111,98,7,7,66,111,111,108,101,
      97,110,7,8,68,97,116,101,84,105,109,101,7,4,68,105,99,116,8,5,
      70,108,111,97,116,7,8,70,117,110,99,116,105,111,110,6,7,73,110,116,
      101,103,101,114,7,6,77,97,116,114,105,120,4,5,78,101,118,101,114,7,
      4,78,117,108,108,7,9,82,101,99,117,114,115,105,118,101,10,3,82,101,
      102,4,3,83,101,116,4,6,83,116,114,105,110,103,7,6,83,116,114,117,
      99,116,13,7,86,97,114,105,97,110,116,13,6,86,101,99,116,111,114,4,
      9,3,4,116,121,112,101,4,6,108,111,99,95,105,100,0,5,118,97,108,
      117,101,3,9,4,4,116,121,112,101,4,6,108,111,99,95,105,100,0,8,
      118,97,114,105,97,98,108,101,3,5,118,97,108,117,101,3,10,3,9,5,
      4,116,121,112,101,4,6,108,111,99,95,105,100,0,8,99,97,112,116,117,
      114,101,115,17,10,112,97,114,97,109,101,116,101,114,115,17,4,98,111,100,
      121,3,9,3,4,116,121,112,101,4,6,108,111,99,95,105,100,0,10,115,
      116,97,116,101,109,101,110,116,115,17,9,2,4,110,97,109,101,11,6,108,
      111,99,95,105,100,0,9,3,4,116,121,112,101,4,6,108,111,99,95,105,
      100,0,5,108,97,98,101,108,20,9,5,4,116,121,112,101,4,6,108,111,
      99,95,105,100,0,7,98,117,105,108,116,105,110,11,15,116,121,112,101,95,
      112,97,114,97,109,101,116,101,114,115,5,9,97,114,103,117,109,101,110,116,
      115,17,9,4,4,116,121,112,101,4,6,108,111,99,95,105,100,0,8,102,
      117,110,99,116,105,111,110,3,9,97,114,103,117,109,101,110,116,115,17,9,
      3,4,116,121,112,101,4,6,108,111,99,95,105,100,0,7,109,101,115,115,
      97,103,101,3,9,7,4,116,121,112,101,4,6,108,111,99,95,105,100,0,
      5,97,114,114,97,121,3,5,108,97,98,101,108,20,3,107,101,121,3,5,
      118,97,108,117,101,3,4,98,111,100,121,3,9,7,4,116,121,112,101,4,
      6,108,111,99,95,105,100,0,4,100,105,99,116,3,5,108,97,98,101,108,
      20,3,107,101,121,3,5,118,97,108,117,101,3,4,98,111,100,121,3,9,
      6,4,116,121,112,101,4,6,108,111,99,95,105,100,0,3,115,101,116,3,
      5,108,97,98,101,108,20,3,107,101,121,3,4,98,111,100,121,3,9,4,
      4,116,121,112,101,4,6,108,111,99,95,105,100,0,5,102,105,101,108,100,
      11,6,115,116,114,117,99,116,3,9,2,9,112,114,101,100,105,99,97,116,
      101,3,4,98,111,100,121,3,10,29,9,4,4,116,121,112,101,4,6,108,
      111,99,95,105,100,0,3,105,102,115,30,9,101,108,115,101,95,98,111,100,
      121,3,9,3,4,99,97,115,101,11,8,118,97,114,105,97,98,108,101,3,
      4,98,111,100,121,3,10,32,9,4,4,116,121,112,101,4,6,108,111,99,
      95,105,100,0,7,118,97,114,105,97,110,116,3,5,99,97,115,101,115,33,
      9,3,4,116,121,112,101,4,6,108,111,99,95,105,100,0,6,118,97,108,
      117,101,115,17,9,2,3,107,101,121,3,5,118,97,108,117,101,3,10,36,
      9,3,4,116,121,112,101,4,6,108,111,99,95,105,100,0,6,118,97,108,
      117,101,115,37,9,5,4,116,121,112,101,4,6,108,111,99,95,105,100,0,
      6,118,97,108,117,101,115,17,4,114,111,119,115,0,4,99,111,108,115,0,
      4,9,7,4,116,121,112,101,4,6,108,111,99,95,105,100,0,4,110,97,
      109,101,11,15,116,121,112,101,95,112,97,114,97,109,101,116,101,114,115,5,
      9,97,114,103,117,109,101,110,116,115,17,5,97,115,121,110,99,40,8,111,
      112,116,105,111,110,97,108,40,9,2,4,110,97,109,101,11,5,118,97,108,
      117,101,3,10,42,9,3,4,116,121,112,101,4,6,108,111,99,95,105,100,
      0,6,102,105,101,108,100,115,43,9,7,4,116,121,112,101,4,6,108,111,
      99,95,105,100,0,8,116,114,121,95,98,111,100,121,3,10,99,97,116,99,
      104,95,98,111,100,121,3,7,109,101,115,115,97,103,101,3,5,115,116,97,
      99,107,3,12,102,105,110,97,108,108,121,95,98,111,100,121,3,6,5,3,
      8,7,4,66,108,111,98,46,7,66,111,111,108,101,97,110,40,8,68,97,
      116,101,84,105,109,101,47,5,70,108,111,97,116,48,7,73,110,116,101,103,
      101,114,0,4,78,117,108,108,7,6,83,116,114,105,110,103,11,9,3,4,
      116,121,112,101,4,6,108,111,99,95,105,100,0,5,118,97,108,117,101,49,
      9,5,4,116,121,112,101,4,6,108,111,99,95,105,100,0,4,110,97,109,
      101,11,7,109,117,116,97,98,108,101,40,8,99,97,112,116,117,114,101,100,
      40,9,4,4,116,121,112,101,4,6,108,111,99,95,105,100,0,4,99,97,
      115,101,11,5,118,97,108,117,101,3,9,5,4,116,121,112,101,4,6,108,
      111,99,95,105,100,0,9,112,114,101,100,105,99,97,116,101,3,5,108,97,
      98,101,108,20,4,98,111,100,121,3,8,34,2,65,115,15,6,65,115,115,
      105,103,110,16,13,65,115,121,110,99,70,117,110,99,116,105,111,110,18,5,
      66,108,111,99,107,19,5,66,114,101,97,107,21,7,66,117,105,108,116,105,
      110,22,4,67,97,108,108,23,9,67,97,108,108,65,115,121,110,99,23,8,
      67,111,110,116,105,110,117,101,21,5,69,114,114,111,114,24,8,70,111,114,
      65,114,114,97,121,25,7,70,111,114,68,105,99,116,26,6,70,111,114,83,
      101,116,27,8,70,117,110,99,116,105,111,110,18,8,71,101,116,70,105,101,
      108,100,28,6,73,102,69,108,115,101,31,3,76,101,116,16,5,77,97,116,
      99,104,34,8,78,101,119,65,114,114,97,121,35,7,78,101,119,68,105,99,
      116,38,9,78,101,119,77,97,116,114,105,120,39,6,78,101,119,82,101,102,
      15,6,78,101,119,83,101,116,35,9,78,101,119,86,101,99,116,111,114,35,
      8,80,108,97,116,102,111,114,109,41,6,82,101,116,117,114,110,15,6,83,
      116,114,117,99,116,44,8,84,114,121,67,97,116,99,104,45,15,85,110,119,
      114,97,112,82,101,99,117,114,115,105,118,101,15,5,86,97,108,117,101,50,
      8,86,97,114,105,97,98,108,101,51,7,86,97,114,105,97,110,116,52,5,
      87,104,105,108,101,53,13,87,114,97,112,82,101,99,117,114,115,105,118,101,
      15,38,4,10,73,110,116,101,103,101,114,65,100,100,15,73,110,116,101,103,
      101,114,77,117,108,116,105,112,108,121,4,95,54,54,51,4,95,54,54,52,
      1,0,114,10,35,10,1,2,13,7,1,8,204,55,2,3,5,8,200,55,
      0,4,5,0,13,7,1,8,214,55,6,7,5,8,210,55,1,8,9,0,
      4,10,4,1,8,3,10,3,0,10,10,3,1,30,8,196,55,2,0,0,
      3,10,4,0,16,10,3,2,30,8,196,55,2,0,0,29,8,198,55,4,
      2,3,10,3,0,10,10,3,1,30,8,206,55,3,0,0,3,10,4,0,
      16,10,3,2,30,8,206,55,3,0,0,29,8,208,55,4,4,0,
    ]), BlobType)));
    const decoded = $.let(blob.decodeBeast(ArrFnType, 'v2'));
    $(assert.equal(decoded.get(0n)(5n), 6n));
    $(assert.equal(decoded.get(1n)(5n), 10n));
  });

  test("Beast v2 - Function with multiple captures", $ => {
    const FnType = FunctionType([], IntegerType);
    const a = $.const(10n, IntegerType);
    const b = $.const(20n, IntegerType);
    const c = $.const(12n, IntegerType);
    const fn = $.let(East.function([], IntegerType, (_$) => a.add(b).add(c)));
    const blob = $.let(East.Blob.encodeBeast(fn, 'v2'));

    $(assert.equal(blob, East.value(new Uint8Array([
      137,69,97,115,116,13,10,4,180,12,1,54,2,16,0,0,18,53,18,13,
      10,3,9,2,6,105,110,112,117,116,115,4,6,111,117,116,112,117,116,3,
      0,9,2,3,107,101,121,3,5,118,97,108,117,101,3,9,2,2,105,100,
      0,5,105,110,110,101,114,3,8,2,3,114,101,102,0,7,119,114,97,112,
      112,101,114,8,1,9,2,4,110,97,109,101,10,4,116,121,112,101,3,10,
      11,8,19,5,65,114,114,97,121,3,13,65,115,121,110,99,70,117,110,99,
      116,105,111,110,5,4,66,108,111,98,6,7,66,111,111,108,101,97,110,6,
      8,68,97,116,101,84,105,109,101,6,4,68,105,99,116,7,5,70,108,111,
      97,116,6,8,70,117,110,99,116,105,111,110,5,7,73,110,116,101,103,101,
      114,6,6,77,97,116,114,105,120,3,5,78,101,118,101,114,6,4,78,117,
      108,108,6,9,82,101,99,117,114,115,105,118,101,9,3,82,101,102,3,3,
      83,101,116,3,6,83,116,114,105,110,103,6,6,83,116,114,117,99,116,12,
      7,86,97,114,105,97,110,116,12,6,86,101,99,116,111,114,3,9,3,4,
      116,121,112,101,3,6,108,111,99,95,105,100,0,5,118,97,108,117,101,2,
      9,4,4,116,121,112,101,3,6,108,111,99,95,105,100,0,8,118,97,114,
      105,97,98,108,101,2,5,118,97,108,117,101,2,10,2,9,5,4,116,121,
      112,101,3,6,108,111,99,95,105,100,0,8,99,97,112,116,117,114,101,115,
      16,10,112,97,114,97,109,101,116,101,114,115,16,4,98,111,100,121,2,9,
      3,4,116,121,112,101,3,6,108,111,99,95,105,100,0,10,115,116,97,116,
      101,109,101,110,116,115,16,9,2,4,110,97,109,101,10,6,108,111,99,95,
      105,100,0,9,3,4,116,121,112,101,3,6,108,111,99,95,105,100,0,5,
      108,97,98,101,108,19,9,5,4,116,121,112,101,3,6,108,111,99,95,105,
      100,0,7,98,117,105,108,116,105,110,10,15,116,121,112,101,95,112,97,114,
      97,109,101,116,101,114,115,4,9,97,114,103,117,109,101,110,116,115,16,9,
      4,4,116,121,112,101,3,6,108,111,99,95,105,100,0,8,102,117,110,99,
      116,105,111,110,2,9,97,114,103,117,109,101,110,116,115,16,9,3,4,116,
      121,112,101,3,6,108,111,99,95,105,100,0,7,109,101,115,115,97,103,101,
      2,9,7,4,116,121,112,101,3,6,108,111,99,95,105,100,0,5,97,114,
      114,97,121,2,5,108,97,98,101,108,19,3,107,101,121,2,5,118,97,108,
      117,101,2,4,98,111,100,121,2,9,7,4,116,121,112,101,3,6,108,111,
      99,95,105,100,0,4,100,105,99,116,2,5,108,97,98,101,108,19,3,107,
      101,121,2,5,118,97,108,117,101,2,4,98,111,100,121,2,9,6,4,116,
      121,112,101,3,6,108,111,99,95,105,100,0,3,115,101,116,2,5,108,97,
      98,101,108,19,3,107,101,121,2,4,98,111,100,121,2,9,4,4,116,121,
      112,101,3,6,108,111,99,95,105,100,0,5,102,105,101,108,100,10,6,115,
      116,114,117,99,116,2,9,2,9,112,114,101,100,105,99,97,116,101,2,4,
      98,111,100,121,2,10,28,9,4,4,116,121,112,101,3,6,108,111,99,95,
      105,100,0,3,105,102,115,29,9,101,108,115,101,95,98,111,100,121,2,9,
      3,4,99,97,115,101,10,8,118,97,114,105,97,98,108,101,2,4,98,111,
      100,121,2,10,31,9,4,4,116,121,112,101,3,6,108,111,99,95,105,100,
      0,7,118,97,114,105,97,110,116,2,5,99,97,115,101,115,32,9,3,4,
      116,121,112,101,3,6,108,111,99,95,105,100,0,6,118,97,108,117,101,115,
      16,9,2,3,107,101,121,2,5,118,97,108,117,101,2,10,35,9,3,4,
      116,121,112,101,3,6,108,111,99,95,105,100,0,6,118,97,108,117,101,115,
      36,9,5,4,116,121,112,101,3,6,108,111,99,95,105,100,0,6,118,97,
      108,117,101,115,16,4,114,111,119,115,0,4,99,111,108,115,0,4,9,7,
      4,116,121,112,101,3,6,108,111,99,95,105,100,0,4,110,97,109,101,10,
      15,116,121,112,101,95,112,97,114,97,109,101,116,101,114,115,4,9,97,114,
      103,117,109,101,110,116,115,16,5,97,115,121,110,99,39,8,111,112,116,105,
      111,110,97,108,39,9,2,4,110,97,109,101,10,5,118,97,108,117,101,2,
      10,41,9,3,4,116,121,112,101,3,6,108,111,99,95,105,100,0,6,102,
      105,101,108,100,115,42,9,7,4,116,121,112,101,3,6,108,111,99,95,105,
      100,0,8,116,114,121,95,98,111,100,121,2,10,99,97,116,99,104,95,98,
      111,100,121,2,7,109,101,115,115,97,103,101,2,5,115,116,97,99,107,2,
      12,102,105,110,97,108,108,121,95,98,111,100,121,2,6,5,3,8,7,4,
      66,108,111,98,45,7,66,111,111,108,101,97,110,39,8,68,97,116,101,84,
      105,109,101,46,5,70,108,111,97,116,47,7,73,110,116,101,103,101,114,0,
      4,78,117,108,108,6,6,83,116,114,105,110,103,10,9,3,4,116,121,112,
      101,3,6,108,111,99,95,105,100,0,5,118,97,108,117,101,48,9,5,4,
      116,121,112,101,3,6,108,111,99,95,105,100,0,4,110,97,109,101,10,7,
      109,117,116,97,98,108,101,39,8,99,97,112,116,117,114,101,100,39,9,4,
      4,116,121,112,101,3,6,108,111,99,95,105,100,0,4,99,97,115,101,10,
      5,118,97,108,117,101,2,9,5,4,116,121,112,101,3,6,108,111,99,95,
      105,100,0,9,112,114,101,100,105,99,97,116,101,2,5,108,97,98,101,108,
      19,4,98,111,100,121,2,8,34,2,65,115,14,6,65,115,115,105,103,110,
      15,13,65,115,121,110,99,70,117,110,99,116,105,111,110,17,5,66,108,111,
      99,107,18,5,66,114,101,97,107,20,7,66,117,105,108,116,105,110,21,4,
      67,97,108,108,22,9,67,97,108,108,65,115,121,110,99,22,8,67,111,110,
      116,105,110,117,101,20,5,69,114,114,111,114,23,8,70,111,114,65,114,114,
      97,121,24,7,70,111,114,68,105,99,116,25,6,70,111,114,83,101,116,26,
      8,70,117,110,99,116,105,111,110,17,8,71,101,116,70,105,101,108,100,27,
      6,73,102,69,108,115,101,30,3,76,101,116,15,5,77,97,116,99,104,33,
      8,78,101,119,65,114,114,97,121,34,7,78,101,119,68,105,99,116,37,9,
      78,101,119,77,97,116,114,105,120,38,6,78,101,119,82,101,102,14,6,78,
      101,119,83,101,116,34,9,78,101,119,86,101,99,116,111,114,34,8,80,108,
      97,116,102,111,114,109,40,6,82,101,116,117,114,110,14,6,83,116,114,117,
      99,116,43,8,84,114,121,67,97,116,99,104,44,15,85,110,119,114,97,112,
      82,101,99,117,114,115,105,118,101,14,5,86,97,108,117,101,49,8,86,97,
      114,105,97,98,108,101,50,7,86,97,114,105,97,110,116,51,5,87,104,105,
      108,101,52,13,87,114,97,112,82,101,99,117,114,115,105,118,101,14,27,4,
      4,95,54,56,54,4,95,54,56,55,4,95,54,56,56,10,73,110,116,101,
      103,101,114,65,100,100,1,0,78,7,3,10,3,0,24,10,2,3,30,8,
      190,57,0,0,1,30,8,196,57,1,0,1,30,8,202,57,2,0,1,3,
      10,2,0,3,10,3,0,17,10,2,2,5,8,206,57,3,5,6,30,8,
      202,57,2,0,1,3,10,3,0,17,10,2,2,30,8,190,57,0,0,1,
      30,8,196,57,1,0,1,13,7,0,8,212,57,1,2,5,8,208,57,3,
      3,4,3,20,40,24,
    ]), BlobType)));
    const decoded = $.let(blob.decodeBeast(FnType, 'v2'));
    $(assert.equal(decoded(), 42n));
  });

  // =========================================================================
  // Recursive types with closures — the critical case
  // =========================================================================

  test("Beast v2 - UI component with onClick returning self type", $ => {
    const ComponentType = RecursiveType(self => VariantType({
      text: StructType({ content: StringType }),
      button: StructType({
        label: StringType,
        onClick: FunctionType([], self),
      }),
    }));

    const textNode = $.const(variant("text", { content: "clicked!" }), ComponentType);
    const onClick = $.const(East.function([], ComponentType, (_$) => textNode));
    const buttonVal = $.let(variant("button", { label: "Click me", onClick }), ComponentType);

    const blob = $.let(East.Blob.encodeBeast(buttonVal, 'v2'));

    $(assert.equal(blob, East.value(new Uint8Array([
      137,69,97,115,116,13,10,4,227,12,0,58,18,5,1,16,0,0,9,2,
      5,108,97,98,101,108,1,7,111,110,67,108,105,99,107,2,9,1,7,99,
      111,110,116,101,110,116,1,8,2,6,98,117,116,116,111,110,3,4,116,101,
      120,116,4,18,57,18,17,10,7,9,2,6,105,110,112,117,116,115,8,6,
      111,117,116,112,117,116,7,0,9,2,3,107,101,121,7,5,118,97,108,117,
      101,7,2,9,2,2,105,100,12,5,105,110,110,101,114,7,8,2,3,114,
      101,102,12,7,119,114,97,112,112,101,114,13,9,2,4,110,97,109,101,1,
      4,116,121,112,101,7,10,15,8,19,5,65,114,114,97,121,7,13,65,115,
      121,110,99,70,117,110,99,116,105,111,110,9,4,66,108,111,98,10,7,66,
      111,111,108,101,97,110,10,8,68,97,116,101,84,105,109,101,10,4,68,105,
      99,116,11,5,70,108,111,97,116,10,8,70,117,110,99,116,105,111,110,9,
      7,73,110,116,101,103,101,114,10,6,77,97,116,114,105,120,7,5,78,101,
      118,101,114,10,4,78,117,108,108,10,9,82,101,99,117,114,115,105,118,101,
      14,3,82,101,102,7,3,83,101,116,7,6,83,116,114,105,110,103,10,6,
      83,116,114,117,99,116,16,7,86,97,114,105,97,110,116,16,6,86,101,99,
      116,111,114,7,9,3,4,116,121,112,101,7,6,108,111,99,95,105,100,12,
      5,118,97,108,117,101,6,9,4,4,116,121,112,101,7,6,108,111,99,95,
      105,100,12,8,118,97,114,105,97,98,108,101,6,5,118,97,108,117,101,6,
      10,6,9,5,4,116,121,112,101,7,6,108,111,99,95,105,100,12,8,99,
      97,112,116,117,114,101,115,20,10,112,97,114,97,109,101,116,101,114,115,20,
      4,98,111,100,121,6,9,3,4,116,121,112,101,7,6,108,111,99,95,105,
      100,12,10,115,116,97,116,101,109,101,110,116,115,20,9,2,4,110,97,109,
      101,1,6,108,111,99,95,105,100,12,9,3,4,116,121,112,101,7,6,108,
      111,99,95,105,100,12,5,108,97,98,101,108,23,9,5,4,116,121,112,101,
      7,6,108,111,99,95,105,100,12,7,98,117,105,108,116,105,110,1,15,116,
      121,112,101,95,112,97,114,97,109,101,116,101,114,115,8,9,97,114,103,117,
      109,101,110,116,115,20,9,4,4,116,121,112,101,7,6,108,111,99,95,105,
      100,12,8,102,117,110,99,116,105,111,110,6,9,97,114,103,117,109,101,110,
      116,115,20,9,3,4,116,121,112,101,7,6,108,111,99,95,105,100,12,7,
      109,101,115,115,97,103,101,6,9,7,4,116,121,112,101,7,6,108,111,99,
      95,105,100,12,5,97,114,114,97,121,6,5,108,97,98,101,108,23,3,107,
      101,121,6,5,118,97,108,117,101,6,4,98,111,100,121,6,9,7,4,116,
      121,112,101,7,6,108,111,99,95,105,100,12,4,100,105,99,116,6,5,108,
      97,98,101,108,23,3,107,101,121,6,5,118,97,108,117,101,6,4,98,111,
      100,121,6,9,6,4,116,121,112,101,7,6,108,111,99,95,105,100,12,3,
      115,101,116,6,5,108,97,98,101,108,23,3,107,101,121,6,4,98,111,100,
      121,6,9,4,4,116,121,112,101,7,6,108,111,99,95,105,100,12,5,102,
      105,101,108,100,1,6,115,116,114,117,99,116,6,9,2,9,112,114,101,100,
      105,99,97,116,101,6,4,98,111,100,121,6,10,32,9,4,4,116,121,112,
      101,7,6,108,111,99,95,105,100,12,3,105,102,115,33,9,101,108,115,101,
      95,98,111,100,121,6,9,3,4,99,97,115,101,1,8,118,97,114,105,97,
      98,108,101,6,4,98,111,100,121,6,10,35,9,4,4,116,121,112,101,7,
      6,108,111,99,95,105,100,12,7,118,97,114,105,97,110,116,6,5,99,97,
      115,101,115,36,9,3,4,116,121,112,101,7,6,108,111,99,95,105,100,12,
      6,118,97,108,117,101,115,20,9,2,3,107,101,121,6,5,118,97,108,117,
      101,6,10,39,9,3,4,116,121,112,101,7,6,108,111,99,95,105,100,12,
      6,118,97,108,117,101,115,40,9,5,4,116,121,112,101,7,6,108,111,99,
      95,105,100,12,6,118,97,108,117,101,115,20,4,114,111,119,115,12,4,99,
      111,108,115,12,4,9,7,4,116,121,112,101,7,6,108,111,99,95,105,100,
      12,4,110,97,109,101,1,15,116,121,112,101,95,112,97,114,97,109,101,116,
      101,114,115,8,9,97,114,103,117,109,101,110,116,115,20,5,97,115,121,110,
      99,43,8,111,112,116,105,111,110,97,108,43,9,2,4,110,97,109,101,1,
      5,118,97,108,117,101,6,10,45,9,3,4,116,121,112,101,7,6,108,111,
      99,95,105,100,12,6,102,105,101,108,100,115,46,9,7,4,116,121,112,101,
      7,6,108,111,99,95,105,100,12,8,116,114,121,95,98,111,100,121,6,10,
      99,97,116,99,104,95,98,111,100,121,6,7,109,101,115,115,97,103,101,6,
      5,115,116,97,99,107,6,12,102,105,110,97,108,108,121,95,98,111,100,121,
      6,6,5,3,8,7,4,66,108,111,98,49,7,66,111,111,108,101,97,110,
      43,8,68,97,116,101,84,105,109,101,50,5,70,108,111,97,116,51,7,73,
      110,116,101,103,101,114,12,4,78,117,108,108,10,6,83,116,114,105,110,103,
      1,9,3,4,116,121,112,101,7,6,108,111,99,95,105,100,12,5,118,97,
      108,117,101,52,9,5,4,116,121,112,101,7,6,108,111,99,95,105,100,12,
      4,110,97,109,101,1,7,109,117,116,97,98,108,101,43,8,99,97,112,116,
      117,114,101,100,43,9,4,4,116,121,112,101,7,6,108,111,99,95,105,100,
      12,4,99,97,115,101,1,5,118,97,108,117,101,6,9,5,4,116,121,112,
      101,7,6,108,111,99,95,105,100,12,9,112,114,101,100,105,99,97,116,101,
      6,5,108,97,98,101,108,23,4,98,111,100,121,6,8,34,2,65,115,18,
      6,65,115,115,105,103,110,19,13,65,115,121,110,99,70,117,110,99,116,105,
      111,110,21,5,66,108,111,99,107,22,5,66,114,101,97,107,24,7,66,117,
      105,108,116,105,110,25,4,67,97,108,108,26,9,67,97,108,108,65,115,121,
      110,99,26,8,67,111,110,116,105,110,117,101,24,5,69,114,114,111,114,27,
      8,70,111,114,65,114,114,97,121,28,7,70,111,114,68,105,99,116,29,6,
      70,111,114,83,101,116,30,8,70,117,110,99,116,105,111,110,21,8,71,101,
      116,70,105,101,108,100,31,6,73,102,69,108,115,101,34,3,76,101,116,19,
      5,77,97,116,99,104,37,8,78,101,119,65,114,114,97,121,38,7,78,101,
      119,68,105,99,116,41,9,78,101,119,77,97,116,114,105,120,42,6,78,101,
      119,82,101,102,18,6,78,101,119,83,101,116,38,9,78,101,119,86,101,99,
      116,111,114,38,8,80,108,97,116,102,111,114,109,44,6,82,101,116,117,114,
      110,18,6,83,116,114,117,99,116,47,8,84,114,121,67,97,116,99,104,48,
      15,85,110,119,114,97,112,82,101,99,117,114,115,105,118,101,18,5,86,97,
      108,117,101,53,8,86,97,114,105,97,98,108,101,54,7,86,97,114,105,97,
      110,116,55,5,87,104,105,108,101,56,13,87,114,97,112,82,101,99,117,114,
      115,105,118,101,18,58,8,6,98,117,116,116,111,110,4,116,101,120,116,5,
      108,97,98,101,108,7,111,110,67,108,105,99,107,7,99,111,110,116,101,110,
      116,4,95,55,48,52,8,67,108,105,99,107,32,109,101,8,99,108,105,99,
      107,101,100,33,1,0,58,7,3,10,7,0,9,10,15,2,0,16,2,1,
      16,4,12,10,15,2,2,15,3,7,3,12,0,222,2,3,10,7,0,5,
      10,15,1,4,15,15,10,6,1,30,12,1,222,2,17,1,236,58,5,0,
      1,3,10,6,0,0,6,13,7,0,12,1,222,2,17,1,242,58,5,6,
      30,12,1,222,2,17,1,236,58,5,0,1,1,1,7,
    ]), BlobType)));
    const decoded = $.let(blob.decodeBeast(ComponentType, 'v2'));
    $(assert.equal(decoded, buttonVal));
  });

  test("Beast v2 - Recursive type with render callback and children", $ => {
    const NodeType = RecursiveType(self => VariantType({
      leaf: StringType,
      container: StructType({
        children: ArrayType(self),
        render: FunctionType([IntegerType], self),
      }),
    }));

    const child1 = $.const(variant("leaf", "child1"), NodeType);
    const leafNode = $.const(variant("leaf", "rendered"), NodeType);
    const renderFn = $.const(East.function([IntegerType], NodeType, (_$, _n) => leafNode));
    const children = $.let([child1], ArrayType(NodeType));
    const containerVal = $.let(variant("container", { children, render: renderFn }), NodeType);

    const blob = $.let(East.Blob.encodeBeast(containerVal, 'v2'));

    $(assert.equal(blob, East.value(new Uint8Array([
      137,69,97,115,116,13,10,4,224,12,0,58,18,6,10,0,2,16,1,2,
      0,9,2,8,99,104,105,108,100,114,101,110,1,6,114,101,110,100,101,114,
      3,1,8,2,9,99,111,110,116,97,105,110,101,114,4,4,108,101,97,102,
      5,18,57,18,17,10,8,9,2,6,105,110,112,117,116,115,9,6,111,117,
      116,112,117,116,8,0,9,2,3,107,101,121,8,5,118,97,108,117,101,8,
      9,2,2,105,100,2,5,105,110,110,101,114,8,8,2,3,114,101,102,2,
      7,119,114,97,112,112,101,114,13,9,2,4,110,97,109,101,5,4,116,121,
      112,101,8,10,15,8,19,5,65,114,114,97,121,8,13,65,115,121,110,99,
      70,117,110,99,116,105,111,110,10,4,66,108,111,98,11,7,66,111,111,108,
      101,97,110,11,8,68,97,116,101,84,105,109,101,11,4,68,105,99,116,12,
      5,70,108,111,97,116,11,8,70,117,110,99,116,105,111,110,10,7,73,110,
      116,101,103,101,114,11,6,77,97,116,114,105,120,8,5,78,101,118,101,114,
      11,4,78,117,108,108,11,9,82,101,99,117,114,115,105,118,101,14,3,82,
      101,102,8,3,83,101,116,8,6,83,116,114,105,110,103,11,6,83,116,114,
      117,99,116,16,7,86,97,114,105,97,110,116,16,6,86,101,99,116,111,114,
      8,9,3,4,116,121,112,101,8,6,108,111,99,95,105,100,2,5,118,97,
      108,117,101,7,9,4,4,116,121,112,101,8,6,108,111,99,95,105,100,2,
      8,118,97,114,105,97,98,108,101,7,5,118,97,108,117,101,7,10,7,9,
      5,4,116,121,112,101,8,6,108,111,99,95,105,100,2,8,99,97,112,116,
      117,114,101,115,20,10,112,97,114,97,109,101,116,101,114,115,20,4,98,111,
      100,121,7,9,3,4,116,121,112,101,8,6,108,111,99,95,105,100,2,10,
      115,116,97,116,101,109,101,110,116,115,20,9,2,4,110,97,109,101,5,6,
      108,111,99,95,105,100,2,9,3,4,116,121,112,101,8,6,108,111,99,95,
      105,100,2,5,108,97,98,101,108,23,9,5,4,116,121,112,101,8,6,108,
      111,99,95,105,100,2,7,98,117,105,108,116,105,110,5,15,116,121,112,101,
      95,112,97,114,97,109,101,116,101,114,115,9,9,97,114,103,117,109,101,110,
      116,115,20,9,4,4,116,121,112,101,8,6,108,111,99,95,105,100,2,8,
      102,117,110,99,116,105,111,110,7,9,97,114,103,117,109,101,110,116,115,20,
      9,3,4,116,121,112,101,8,6,108,111,99,95,105,100,2,7,109,101,115,
      115,97,103,101,7,9,7,4,116,121,112,101,8,6,108,111,99,95,105,100,
      2,5,97,114,114,97,121,7,5,108,97,98,101,108,23,3,107,101,121,7,
      5,118,97,108,117,101,7,4,98,111,100,121,7,9,7,4,116,121,112,101,
      8,6,108,111,99,95,105,100,2,4,100,105,99,116,7,5,108,97,98,101,
      108,23,3,107,101,121,7,5,118,97,108,117,101,7,4,98,111,100,121,7,
      9,6,4,116,121,112,101,8,6,108,111,99,95,105,100,2,3,115,101,116,
      7,5,108,97,98,101,108,23,3,107,101,121,7,4,98,111,100,121,7,9,
      4,4,116,121,112,101,8,6,108,111,99,95,105,100,2,5,102,105,101,108,
      100,5,6,115,116,114,117,99,116,7,9,2,9,112,114,101,100,105,99,97,
      116,101,7,4,98,111,100,121,7,10,32,9,4,4,116,121,112,101,8,6,
      108,111,99,95,105,100,2,3,105,102,115,33,9,101,108,115,101,95,98,111,
      100,121,7,9,3,4,99,97,115,101,5,8,118,97,114,105,97,98,108,101,
      7,4,98,111,100,121,7,10,35,9,4,4,116,121,112,101,8,6,108,111,
      99,95,105,100,2,7,118,97,114,105,97,110,116,7,5,99,97,115,101,115,
      36,9,3,4,116,121,112,101,8,6,108,111,99,95,105,100,2,6,118,97,
      108,117,101,115,20,9,2,3,107,101,121,7,5,118,97,108,117,101,7,10,
      39,9,3,4,116,121,112,101,8,6,108,111,99,95,105,100,2,6,118,97,
      108,117,101,115,40,9,5,4,116,121,112,101,8,6,108,111,99,95,105,100,
      2,6,118,97,108,117,101,115,20,4,114,111,119,115,2,4,99,111,108,115,
      2,4,9,7,4,116,121,112,101,8,6,108,111,99,95,105,100,2,4,110,
      97,109,101,5,15,116,121,112,101,95,112,97,114,97,109,101,116,101,114,115,
      9,9,97,114,103,117,109,101,110,116,115,20,5,97,115,121,110,99,43,8,
      111,112,116,105,111,110,97,108,43,9,2,4,110,97,109,101,5,5,118,97,
      108,117,101,7,10,45,9,3,4,116,121,112,101,8,6,108,111,99,95,105,
      100,2,6,102,105,101,108,100,115,46,9,7,4,116,121,112,101,8,6,108,
      111,99,95,105,100,2,8,116,114,121,95,98,111,100,121,7,10,99,97,116,
      99,104,95,98,111,100,121,7,7,109,101,115,115,97,103,101,7,5,115,116,
      97,99,107,7,12,102,105,110,97,108,108,121,95,98,111,100,121,7,6,5,
      3,8,7,4,66,108,111,98,49,7,66,111,111,108,101,97,110,43,8,68,
      97,116,101,84,105,109,101,50,5,70,108,111,97,116,51,7,73,110,116,101,
      103,101,114,2,4,78,117,108,108,11,6,83,116,114,105,110,103,5,9,3,
      4,116,121,112,101,8,6,108,111,99,95,105,100,2,5,118,97,108,117,101,
      52,9,5,4,116,121,112,101,8,6,108,111,99,95,105,100,2,4,110,97,
      109,101,5,7,109,117,116,97,98,108,101,43,8,99,97,112,116,117,114,101,
      100,43,9,4,4,116,121,112,101,8,6,108,111,99,95,105,100,2,4,99,
      97,115,101,5,5,118,97,108,117,101,7,9,5,4,116,121,112,101,8,6,
      108,111,99,95,105,100,2,9,112,114,101,100,105,99,97,116,101,7,5,108,
      97,98,101,108,23,4,98,111,100,121,7,8,34,2,65,115,18,6,65,115,
      115,105,103,110,19,13,65,115,121,110,99,70,117,110,99,116,105,111,110,21,
      5,66,108,111,99,107,22,5,66,114,101,97,107,24,7,66,117,105,108,116,
      105,110,25,4,67,97,108,108,26,9,67,97,108,108,65,115,121,110,99,26,
      8,67,111,110,116,105,110,117,101,24,5,69,114,114,111,114,27,8,70,111,
      114,65,114,114,97,121,28,7,70,111,114,68,105,99,116,29,6,70,111,114,
      83,101,116,30,8,70,117,110,99,116,105,111,110,21,8,71,101,116,70,105,
      101,108,100,31,6,73,102,69,108,115,101,34,3,76,101,116,19,5,77,97,
      116,99,104,37,8,78,101,119,65,114,114,97,121,38,7,78,101,119,68,105,
      99,116,41,9,78,101,119,77,97,116,114,105,120,42,6,78,101,119,82,101,
      102,18,6,78,101,119,83,101,116,38,9,78,101,119,86,101,99,116,111,114,
      38,8,80,108,97,116,102,111,114,109,44,6,82,101,116,117,114,110,18,6,
      83,116,114,117,99,116,47,8,84,114,121,67,97,116,99,104,48,15,85,110,
      119,114,97,112,82,101,99,117,114,115,105,118,101,18,5,86,97,108,117,101,
      53,8,86,97,114,105,97,98,108,101,54,7,86,97,114,105,97,110,116,55,
      5,87,104,105,108,101,56,13,87,114,97,112,82,101,99,117,114,115,105,118,
      101,18,58,8,6,99,104,105,108,100,49,9,99,111,110,116,97,105,110,101,
      114,4,108,101,97,102,8,99,104,105,108,100,114,101,110,6,114,101,110,100,
      101,114,4,95,55,50,50,4,95,55,50,51,8,114,101,110,100,101,114,101,
      100,1,0,70,7,5,10,0,1,1,0,4,10,8,1,8,8,10,15,2,
      1,16,3,2,15,16,10,15,2,3,0,12,0,232,2,4,7,4,12,0,
      232,2,4,10,8,1,8,15,10,7,1,30,12,1,232,2,17,2,148,60,
      5,0,1,10,10,7,1,30,8,152,60,6,0,0,0,0,13,7,1,12,
      1,232,2,17,2,156,60,5,6,30,12,1,232,2,17,2,148,60,5,0,
      1,1,1,7,
    ]), BlobType)));
    const decoded = $.let(blob.decodeBeast(NodeType, 'v2'));
    $(assert.equal(decoded, containerVal));
  });

  // =========================================================================
  // Backreferences — round-trip + identity
  // =========================================================================

  test("Beast v2 - Backreference - arrays", $ => {
    const shared = $.let(East.value([1n, 2n, 3n], ArrayType(IntegerType)));
    const type = StructType({ a: ArrayType(IntegerType), b: ArrayType(IntegerType) });
    const value = $.let({ a: shared, b: shared }, type);
    const decoded = $.let(East.Blob.encodeBeast(value, 'v2').decodeBeast(type, 'v2'));
    $(assert.equal(decoded, value));
    $(assert.is(decoded.a, decoded.b));
  });

  test("Beast v2 - Backreference - sets", $ => {
    const shared = $.let(East.value(new Set(["a", "b"]), SetType(StringType)));
    const type = StructType({ a: SetType(StringType), b: SetType(StringType) });
    const value = $.let({ a: shared, b: shared }, type);
    const decoded = $.let(East.Blob.encodeBeast(value, 'v2').decodeBeast(type, 'v2'));
    $(assert.equal(decoded, value));
    $(assert.is(decoded.a, decoded.b));
  });

  test("Beast v2 - Backreference - dicts", $ => {
    const shared = $.let(East.value(new Map([["k", 1n]]), DictType(StringType, IntegerType)));
    const type = StructType({ a: DictType(StringType, IntegerType), b: DictType(StringType, IntegerType) });
    const value = $.let({ a: shared, b: shared }, type);
    const decoded = $.let(East.Blob.encodeBeast(value, 'v2').decodeBeast(type, 'v2'));
    $(assert.equal(decoded, value));
    $(assert.is(decoded.a, decoded.b));
  });

  test("Beast v2 - Backreference - refs", $ => {
    const shared = $.let(East.value(ref(42n), RefType(IntegerType)));
    const type = StructType({ a: RefType(IntegerType), b: RefType(IntegerType) });
    const value = $.let({ a: shared, b: shared }, type);
    const decoded = $.let(East.Blob.encodeBeast(value, 'v2').decodeBeast(type, 'v2'));
    $(assert.equal(decoded, value));
    $(assert.is(decoded.a, decoded.b));
  });

  test("Beast v2 - Backreference - mutation propagates", $ => {
    const shared = $.let(East.value(ref(10n), RefType(IntegerType)));
    const type = StructType({ a: RefType(IntegerType), b: RefType(IntegerType) });
    const value = $.let({ a: shared, b: shared }, type);
    const decoded = $.let(East.Blob.encodeBeast(value, 'v2').decodeBeast(type, 'v2'));
    $(decoded.a.update(East.value(99n)));
    $(assert.equal(decoded.b.get(), 99n));
  });

  // =========================================================================
  // Format overhead
  // =========================================================================

  test("Beast v2 - Format overhead", $ => {
    // Null: 8 magic + 4 type table + 2 string table + 2 source map + 2 value table = 18
    $(assert.equal(East.Blob.encodeBeast(East.value(null, NullType), 'v2').size(), 18n));
    // Boolean: 18 + 1 = 19
    $(assert.equal(East.Blob.encodeBeast(East.value(true, BooleanType), 'v2').size(), 19n));
    // Empty array: 8 magic + 6 type table + 2 string table + 2 source map + 6 value table + 1 value stream = 25
    $(assert.equal(East.Blob.encodeBeast(East.value([], ArrayType(IntegerType)), 'v2').size(), 25n));
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  test("Beast v2 - Error handling - wrong type", $ => {
    const value = $.let(East.value(42n, IntegerType));
    const encoded = $.let(East.Blob.encodeBeast(value, 'v2'));

    // Try to decode integer as string
    $(assert.throws(encoded.decodeBeast(StringType, 'v2'), /Failed to decode Beast2 data/));
  });

  test("Beast v2 - Error handling - invalid magic bytes", $ => {
    const invalidMagic = $.let(East.value(
      new Uint8Array([0x00, 0x45, 0x61, 0x73, 0x74, 0x0D, 0x0A, 0x02, 0x00, 0x02, 0x00]),
      BlobType
    ));

    $(assert.throws(invalidMagic.decodeBeast(IntegerType, 'v2'), /Failed to decode Beast2 data/));
  });

  test("Beast v2 - Error handling - wrong version", $ => {
    const wrongVersion = $.let(East.value(
      new Uint8Array([0x89, 0x45, 0x61, 0x73, 0x74, 0x0D, 0x0A, 0x03, 0x02, 0x00]),
      BlobType
    ));

    $(assert.throws(wrongVersion.decodeBeast(IntegerType, 'v2'), /Failed to decode Beast2 data/));
  });

  test("Beast v2 - Error handling - invalid variant tag", $ => {
    const OptType = VariantType({ none: NullType, some: IntegerType });

    // Blob with valid v2 header but invalid variant case index
    const invalidVariant = $.let(East.value(
      new Uint8Array([
        0x89, 0x45, 0x61, 0x73, 0x74, 0x0D, 0x0A, 0x02, // Magic v2
        // type table: [0]=Null, [1]=Integer, [2]=Variant(none→0, some→1)
        18, 2, 3, 0, 2, 8, 2,
        4, 110, 111, 110, 101, 0,
        4, 115, 111, 109, 101, 1,
        1, 0,  // string table: empty
        0x02,  // Invalid tag (only 0 and 1 are valid)
        0x00,
      ]),
      BlobType
    ));

    $(assert.throws(invalidVariant.decodeBeast(OptType, 'v2'), /Failed to decode Beast2 data/));
  });

  // =========================================================================
  // Cross-version compatibility
  // =========================================================================

  test("Beast v1 vs v2 are not compatible", $ => {
    const PersonType = StructType({ name: StringType, age: IntegerType, active: BooleanType });
    const person = $.let(East.value({ name: "Charlie", age: 35n, active: true }, PersonType));

    // Encode with v1, try to decode with v2 (should fail)
    const v1_encoded = $.let(East.Blob.encodeBeast(person, 'v1'));
    $(assert.throws(v1_encoded.decodeBeast(PersonType, 'v2'), /Failed to decode Beast2 data/));

    // Encode with v2, try to decode with v1 (should fail)
    const v2_encoded = $.let(East.Blob.encodeBeast(person, 'v2'));
    $(assert.throws(v2_encoded.decodeBeast(PersonType, 'v1'), /Failed to decode Beast data/));
  });
});
