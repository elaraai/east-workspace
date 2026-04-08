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
  Expr,
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
    $(assert.equal(encoded.getUint8(7n), 0x02n)); // format version 2
  });

  // =========================================================================
  // Primitives — exact bytes + round-trip
  // =========================================================================

  test("Beast v2 - Null", $ => {
    const value = $.let(East.value(null, NullType));
    const encoded = $.let(East.Blob.encodeBeast(value, 'v2'));
    $(assert.equal(encoded, East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, // magic
      3, 0, 1, 0,                         // type table: len=3, root=0, count=1, Null
      1, 0,                               // string table: empty
    ]), BlobType)));
    $(assert.equal(encoded.decodeBeast(NullType, 'v2'), value));
  });

  test("Beast v2 - Boolean", $ => {
    const f = $.let(East.value(false, BooleanType));
    $(assert.equal(East.Blob.encodeBeast(f, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 4, 1, 0, 0,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(f, 'v2').decodeBeast(BooleanType, 'v2'), f));

    const t = $.let(East.value(true, BooleanType));
    $(assert.equal(East.Blob.encodeBeast(t, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 4, 1, 0, 1,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(t, 'v2').decodeBeast(BooleanType, 'v2'), t));
  });

  test("Beast v2 - Integer zigzag", $ => {
    const zero = $.let(East.value(0n, IntegerType));
    $(assert.equal(East.Blob.encodeBeast(zero, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 2, 1, 0, 0,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(zero, 'v2').decodeBeast(IntegerType, 'v2'), zero));

    const neg1 = $.let(East.value(-1n, IntegerType));
    $(assert.equal(East.Blob.encodeBeast(neg1, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 2, 1, 0, 1,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(neg1, 'v2').decodeBeast(IntegerType, 'v2'), neg1));

    const pos1 = $.let(East.value(1n, IntegerType));
    $(assert.equal(East.Blob.encodeBeast(pos1, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 2, 1, 0, 2,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(pos1, 'v2').decodeBeast(IntegerType, 'v2'), pos1));

    const pos42 = $.let(East.value(42n, IntegerType));
    $(assert.equal(East.Blob.encodeBeast(pos42, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 2, 1, 0, 84,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(pos42, 'v2').decodeBeast(IntegerType, 'v2'), pos42));
  });

  test("Beast v2 - Integer boundary", $ => {
    const maxInt = $.let(East.value(9223372036854775807n, IntegerType));
    $(assert.equal(East.Blob.encodeBeast(maxInt, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 2, 1, 0,
      254, 255, 255, 255, 255, 255, 255, 255, 255, 1,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(maxInt, 'v2').decodeBeast(IntegerType, 'v2'), maxInt));

    const minInt = $.let(East.value(-9223372036854775808n, IntegerType));
    $(assert.equal(East.Blob.encodeBeast(minInt, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 2, 1, 0,
      255, 255, 255, 255, 255, 255, 255, 255, 255, 1,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(minInt, 'v2').decodeBeast(IntegerType, 'v2'), minInt));
  });

  test("Beast v2 - Float", $ => {
    const zero = $.let(East.value(0.0, FloatType));
    $(assert.equal(East.Blob.encodeBeast(zero, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 3, 1, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(zero, 'v2').decodeBeast(FloatType, 'v2'), zero));

    const one = $.let(East.value(1.0, FloatType));
    $(assert.equal(East.Blob.encodeBeast(one, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 3, 1, 0,
      0, 0, 0, 0, 0, 0, 240, 63,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(one, 'v2').decodeBeast(FloatType, 'v2'), one));

    const pi = $.let(East.value(3.14, FloatType));
    $(assert.equal(East.Blob.encodeBeast(pi, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 3, 1, 0,
      31, 133, 235, 81, 184, 30, 9, 64,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(pi, 'v2').decodeBeast(FloatType, 'v2'), pi));

    const negInf = $.let(East.value(-Infinity, FloatType));
    $(assert.equal(East.Blob.encodeBeast(negInf, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 3, 1, 0,
      0, 0, 0, 0, 0, 0, 240, 255,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(negInf, 'v2').decodeBeast(FloatType, 'v2'), negInf));

    const posInf = $.let(East.value(Infinity, FloatType));
    $(assert.equal(East.Blob.encodeBeast(posInf, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 3, 1, 0,
      0, 0, 0, 0, 0, 0, 240, 127,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(posInf, 'v2').decodeBeast(FloatType, 'v2'), posInf));

    const nan = $.let(East.value(NaN, FloatType));
    $(assert.equal(East.Blob.encodeBeast(nan, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 3, 1, 0,
      0, 0, 0, 0, 0, 0, 248, 127,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(nan, 'v2').decodeBeast(FloatType, 'v2'), nan));
  });

  test("Beast v2 - String", $ => {
    const empty = $.let(East.value("", StringType));
    $(assert.equal(East.Blob.encodeBeast(empty, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 1,
      2, 1, 0,  // string table: 1 entry, ""
      0,        // string index 0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(empty, 'v2').decodeBeast(StringType, 'v2'), empty));

    const hello = $.let(East.value("hello", StringType));
    $(assert.equal(East.Blob.encodeBeast(hello, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 1,
      7, 1, 5, 104, 101, 108, 108, 111,  // string table: "hello"
      0,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(hello, 'v2').decodeBeast(StringType, 'v2'), hello));

    const utf8 = $.let(East.value("héllo", StringType));
    $(assert.equal(East.Blob.encodeBeast(utf8, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 1,
      8, 1, 6, 104, 195, 169, 108, 108, 111,
      0,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(utf8, 'v2').decodeBeast(StringType, 'v2'), utf8));
  });

  test("Beast v2 - DateTime", $ => {
    const epoch = $.let(East.value(new Date(0), DateTimeType));
    $(assert.equal(East.Blob.encodeBeast(epoch, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 5, 1, 0, 0,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(epoch, 'v2').decodeBeast(DateTimeType, 'v2'), epoch));

    const ts = $.let(East.value(new Date("2025-01-15T10:30:00.000Z"), DateTimeType));
    $(assert.equal(East.Blob.encodeBeast(ts, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 5, 1, 0,
      128, 177, 154, 152, 141, 101,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(ts, 'v2').decodeBeast(DateTimeType, 'v2'), ts));
  });

  test("Beast v2 - Blob", $ => {
    const empty = $.let(East.value(new Uint8Array([]), BlobType));
    $(assert.equal(East.Blob.encodeBeast(empty, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 6, 1, 0, 0,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(empty, 'v2').decodeBeast(BlobType, 'v2'), empty));

    const data = $.let(East.value(new Uint8Array([1, 2, 3]), BlobType));
    $(assert.equal(East.Blob.encodeBeast(data, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 3, 0, 1, 6, 1, 0, 3, 1, 2, 3,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(data, 'v2').decodeBeast(BlobType, 'v2'), data));
  });

  // =========================================================================
  // Containers — exact bytes + round-trip
  // =========================================================================

  test("Beast v2 - Array(Integer)", $ => {
    const empty = $.let(East.value([], ArrayType(IntegerType)));
    $(assert.equal(East.Blob.encodeBeast(empty, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 5, 1, 2, 2, 10, 0, 1, 0, 0, 0,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(empty, 'v2').decodeBeast(ArrayType(IntegerType), 'v2'), empty));

    const arr = $.let(East.value([1n, 2n, 3n], ArrayType(IntegerType)));
    $(assert.equal(East.Blob.encodeBeast(arr, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 5, 1, 2, 2, 10, 0, 1, 0, 0, 3, 2, 4, 6,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(arr, 'v2').decodeBeast(ArrayType(IntegerType), 'v2'), arr));
  });

  test("Beast v2 - Array(String)", $ => {
    const arr = $.let(East.value(["foo", "bar"], ArrayType(StringType)));
    $(assert.equal(East.Blob.encodeBeast(arr, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 5, 1, 2, 1, 10, 0,
      9, 2, 3, 102, 111, 111, 3, 98, 97, 114,  // string table: "foo","bar"
      0, 2, 0, 1,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(arr, 'v2').decodeBeast(ArrayType(StringType), 'v2'), arr));
  });

  test("Beast v2 - Set(Integer)", $ => {
    const s = $.let(East.value(new Set([1n, 2n, 3n]), SetType(IntegerType)));
    $(assert.equal(East.Blob.encodeBeast(s, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 5, 1, 2, 2, 12, 0, 1, 0, 0, 3, 2, 4, 6,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(s, 'v2').decodeBeast(SetType(IntegerType), 'v2'), s));
  });

  test("Beast v2 - Dict(String, Integer)", $ => {
    const d = $.let(East.value(new Map([["x", 1n], ["y", 2n]]), DictType(StringType, IntegerType)));
    $(assert.equal(East.Blob.encodeBeast(d, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 7, 2, 3, 1, 2, 11, 0, 1,
      5, 2, 1, 120, 1, 121,  // string table: "x","y"
      0, 2, 0, 2, 1, 4,     // inline + count(2) + key0,val0 + key1,val1
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(d, 'v2').decodeBeast(DictType(StringType, IntegerType), 'v2'), d));
  });

  test("Beast v2 - Ref(Integer)", $ => {
    const r = $.let(East.value(ref(42n), RefType(IntegerType)));
    $(assert.equal(East.Blob.encodeBeast(r, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 5, 1, 2, 2, 13, 0, 1, 0, 0, 84,
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
      137, 69, 97, 115, 116, 13, 10, 2,
      17, 2, 3, 1, 2, 9, 2,
      4, 110, 97, 109, 101, 0,  // "name"→0
      3, 97, 103, 101, 1,       // "age"→1
      7, 1, 5, 65, 108, 105, 99, 101,  // string table: "Alice"
      0, 60,  // string idx 0, zigzag(30)=60
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(value, 'v2').decodeBeast(type, 'v2'), value));
  });

  test("Beast v2 - Empty struct", $ => {
    const type = StructType({});
    const value = $.let(East.value({}, type));
    $(assert.equal(East.Blob.encodeBeast(value, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2, 4, 0, 1, 9, 0, 1, 0,
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
      137, 69, 97, 115, 116, 13, 10, 2,
      18, 2, 3, 0, 2, 8, 2,
      4, 110, 111, 110, 101, 0,
      4, 115, 111, 109, 101, 1,
      1, 0, 0,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(noneVal, 'v2').decodeBeast(OptType, 'v2'), noneVal));

    const someVal = $.let(East.value(some(42n), OptType));
    $(assert.equal(East.Blob.encodeBeast(someVal, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2,
      18, 2, 3, 0, 2, 8, 2,
      4, 110, 111, 110, 101, 0,
      4, 115, 111, 109, 101, 1,
      1, 0, 1, 84,
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
      137, 69, 97, 115, 116, 13, 10, 2,
      // type table: root=0, count=5
      33, 0, 5,
      18, 4,                                          // [0] Recursive(inner=4)
      2,                                              // [1] Integer
      9, 2, 4, 104, 101, 97, 100, 1, 4, 116, 97, 105, 108, 0,  // [2] Struct(head→1, tail→0)
      0,                                              // [3] Null
      8, 2, 4, 99, 111, 110, 115, 2, 3, 110, 105, 108, 3,      // [4] Variant
      1, 0,  // string table: empty
      1,     // value: nil (case 1)
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(nilVal, 'v2').decodeBeast(ListType, 'v2'), nilVal));

    const listVal = $.let(East.value(
      variant("cons", { head: 1n, tail: variant("cons", { head: 2n, tail: variant("nil") }) }),
      ListType,
    ));
    $(assert.equal(East.Blob.encodeBeast(listVal, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2,
      33, 0, 5,
      18, 4, 2,
      9, 2, 4, 104, 101, 97, 100, 1, 4, 116, 97, 105, 108, 0,
      0, 8, 2, 4, 99, 111, 110, 115, 2, 3, 110, 105, 108, 3,
      1, 0,
      0, 2, 0, 4, 1,
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(listVal, 'v2').decodeBeast(ListType, 'v2'), listVal));
  });

  // =========================================================================
  // Vectors — exact bytes + round-trip
  // =========================================================================

  test("Beast v2 - Vector<Float>", $ => {
    const v = $.let(East.Vector.fromArray([1.0, 2.5, 3.7]));
    $(assert.equal(East.Blob.encodeBeast(v, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2,           // magic
      5, 1, 2, 3, 14, 0,                           // type table: [0]=Float, [1]=Vector(0)
      1, 0,                                         // string table: empty
      3,                                            // length=3
      0, 0, 0, 0, 0, 0, 240, 63,                   // 1.0
      0, 0, 0, 0, 0, 0, 4, 64,                     // 2.5
      154, 153, 153, 153, 153, 153, 13, 64,         // 3.7
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(v, 'v2').decodeBeast(VectorType(FloatType), 'v2'), v));
  });

  test("Beast v2 - Vector<Integer>", $ => {
    const v = $.let(East.Vector.fromArray([10n, 20n, 30n]));
    $(assert.equal(East.Blob.encodeBeast(v, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2,
      5, 1, 2, 2, 14, 0,                           // [0]=Integer, [1]=Vector(0)
      1, 0,
      3,                                            // length=3
      10, 0, 0, 0, 0, 0, 0, 0,                     // 10 (LE int64)
      20, 0, 0, 0, 0, 0, 0, 0,                     // 20
      30, 0, 0, 0, 0, 0, 0, 0,                     // 30
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(v, 'v2').decodeBeast(VectorType(IntegerType), 'v2'), v));
  });

  test("Beast v2 - Vector<Boolean>", $ => {
    const v = $.let(East.Vector.fromArray([true, false, true]));
    $(assert.equal(East.Blob.encodeBeast(v, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2,
      5, 1, 2, 4, 14, 0,                           // [0]=Boolean, [1]=Vector(0)
      1, 0,
      3, 1, 0, 1,                                  // length=3, true, false, true
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(v, 'v2').decodeBeast(VectorType(BooleanType), 'v2'), v));
  });

  test("Beast v2 - Vector empty", $ => {
    const v = $.let(East.Vector.zeros(0n));
    $(assert.equal(East.Blob.encodeBeast(v, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2,
      5, 1, 2, 3, 14, 0,                           // [0]=Float, [1]=Vector(0)
      1, 0,
      0,                                            // length=0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(v, 'v2').decodeBeast(VectorType(FloatType), 'v2'), v));
  });

  // =========================================================================
  // Matrices — exact bytes + round-trip
  // =========================================================================

  test("Beast v2 - Matrix<Float> 2x2", $ => {
    const m = $.let(East.Matrix.fromArray([[1.0, 2.0], [3.0, 4.0]]));
    $(assert.equal(East.Blob.encodeBeast(m, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2,
      5, 1, 2, 3, 15, 0,                           // [0]=Float, [1]=Matrix(0)
      1, 0,
      2, 2,                                         // rows=2, cols=2
      0, 0, 0, 0, 0, 0, 240, 63,                   // 1.0
      0, 0, 0, 0, 0, 0, 0, 64,                     // 2.0
      0, 0, 0, 0, 0, 0, 8, 64,                     // 3.0
      0, 0, 0, 0, 0, 0, 16, 64,                    // 4.0
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(m, 'v2').decodeBeast(MatrixType(FloatType), 'v2'), m));
  });

  test("Beast v2 - Matrix<Integer> 2x2", $ => {
    const m = $.let(East.Matrix.fromArray([[10n, 20n], [30n, 40n]]));
    $(assert.equal(East.Blob.encodeBeast(m, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2,
      5, 1, 2, 2, 15, 0,                           // [0]=Integer, [1]=Matrix(0)
      1, 0,
      2, 2,                                         // rows=2, cols=2
      10, 0, 0, 0, 0, 0, 0, 0,                     // 10
      20, 0, 0, 0, 0, 0, 0, 0,                     // 20
      30, 0, 0, 0, 0, 0, 0, 0,                     // 30
      40, 0, 0, 0, 0, 0, 0, 0,                     // 40
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(m, 'v2').decodeBeast(MatrixType(IntegerType), 'v2'), m));
  });

  test("Beast v2 - Matrix<Boolean> 2x2", $ => {
    const m = $.let(East.Matrix.fromArray([[true, false], [false, true]]));
    $(assert.equal(East.Blob.encodeBeast(m, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2,
      5, 1, 2, 4, 15, 0,                           // [0]=Boolean, [1]=Matrix(0)
      1, 0,
      2, 2, 1, 0, 0, 1,                            // rows=2, cols=2, true,false,false,true
    ]), BlobType)));
    $(assert.equal(East.Blob.encodeBeast(m, 'v2').decodeBeast(MatrixType(BooleanType), 'v2'), m));
  });

  test("Beast v2 - Matrix empty", $ => {
    const m = $.let(East.Matrix.zeros(0n, 0n));
    $(assert.equal(East.Blob.encodeBeast(m, 'v2'), East.value(new Uint8Array([
      137, 69, 97, 115, 116, 13, 10, 2,
      5, 1, 2, 3, 15, 0,                           // [0]=Float, [1]=Matrix(0)
      1, 0,
      0, 0,                                         // rows=0, cols=0
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
      137,69,97,115,116,13,10,2,7,1,2,2,16,1,0,0,203,3,8,71,
      60,108,111,99,97,116,105,111,110,62,58,60,66,108,111,98,32,40,66,101,
      97,115,116,32,118,50,41,62,58,60,66,101,97,115,116,32,118,50,32,45,
      32,83,105,109,112,108,101,32,102,117,110,99,116,105,111,110,32,40,110,111,
      32,99,97,112,116,117,114,101,115,41,62,68,60,98,108,111,99,107,62,58,
      60,66,108,111,98,32,40,66,101,97,115,116,32,118,50,41,62,58,60,66,
      101,97,115,116,32,118,50,32,45,32,83,105,109,112,108,101,32,102,117,110,
      99,116,105,111,110,32,40,110,111,32,99,97,112,116,117,114,101,115,41,62,
      79,60,98,108,111,98,46,98,101,97,115,116,50,46,115,112,101,99,62,58,
      60,66,108,111,98,32,40,66,101,97,115,116,32,118,50,41,62,58,60,66,
      101,97,115,116,32,118,50,32,45,32,83,105,109,112,108,101,32,102,117,110,
      99,116,105,111,110,32,40,110,111,32,99,97,112,116,117,114,101,115,41,62,
      77,60,112,108,97,116,102,111,114,109,115,46,115,112,101,99,62,58,60,66,
      108,111,98,32,40,66,101,97,115,116,32,118,50,41,62,58,60,66,101,97,
      115,116,32,118,50,32,45,32,83,105,109,112,108,101,32,102,117,110,99,116,
      105,111,110,32,40,110,111,32,99,97,112,116,117,114,101,115,41,62,4,95,
      54,49,51,70,60,105,110,116,101,103,101,114,62,58,60,66,108,111,98,32,
      40,66,101,97,115,116,32,118,50,41,62,58,60,66,101,97,115,116,32,118,
      50,32,45,32,83,105,109,112,108,101,32,102,117,110,99,116,105,111,110,32,
      40,110,111,32,99,97,112,116,117,114,101,115,41,62,15,73,110,116,101,103,
      101,114,77,117,108,116,105,112,108,121,66,60,97,115,116,62,58,60,66,108,
      111,98,32,40,66,101,97,115,116,32,118,50,41,62,58,60,66,101,97,115,
      116,32,118,50,32,45,32,83,105,109,112,108,101,32,102,117,110,99,116,105,
      111,110,32,40,110,111,32,99,97,112,116,117,114,101,115,41,62,13,1,0,
      10,0,0,0,1,0,0,2,0,0,1,0,0,3,0,0,1,0,0,3,
      0,0,1,0,0,3,0,0,2,0,0,0,0,0,1,30,0,0,11,0,
      0,0,1,0,0,1,0,0,2,0,0,1,0,0,3,0,0,1,0,0,
      3,0,0,1,0,0,3,0,0,2,0,0,4,0,0,5,0,0,12,0,
      0,0,5,0,0,2,0,0,1,0,0,2,0,0,1,0,0,3,0,0,
      1,0,0,3,0,0,1,0,0,3,0,0,2,0,0,6,0,0,0,2,
      30,0,84,4,0,0,29,0,0,13,0,0,0,7,0,0,5,0,0,2,
      0,0,1,0,0,2,0,0,1,0,0,3,0,0,1,0,0,3,0,0,
      1,0,0,3,0,0,2,0,0,4,4,0,
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
      137,69,97,115,116,13,10,2,7,1,2,2,16,1,0,0,224,2,8,63,
      60,108,111,99,97,116,105,111,110,62,58,60,66,108,111,98,32,40,66,101,
      97,115,116,32,118,50,41,62,58,60,66,101,97,115,116,32,118,50,32,45,
      32,70,117,110,99,116,105,111,110,32,119,105,116,104,32,99,97,112,116,117,
      114,101,62,60,60,98,108,111,99,107,62,58,60,66,108,111,98,32,40,66,
      101,97,115,116,32,118,50,41,62,58,60,66,101,97,115,116,32,118,50,32,
      45,32,70,117,110,99,116,105,111,110,32,119,105,116,104,32,99,97,112,116,
      117,114,101,62,71,60,98,108,111,98,46,98,101,97,115,116,50,46,115,112,
      101,99,62,58,60,66,108,111,98,32,40,66,101,97,115,116,32,118,50,41,
      62,58,60,66,101,97,115,116,32,118,50,32,45,32,70,117,110,99,116,105,
      111,110,32,119,105,116,104,32,99,97,112,116,117,114,101,62,69,60,112,108,
      97,116,102,111,114,109,115,46,115,112,101,99,62,58,60,66,108,111,98,32,
      40,66,101,97,115,116,32,118,50,41,62,58,60,66,101,97,115,116,32,118,
      50,32,45,32,70,117,110,99,116,105,111,110,32,119,105,116,104,32,99,97,
      112,116,117,114,101,62,4,95,54,50,57,4,95,54,51,48,62,60,105,110,
      116,101,103,101,114,62,58,60,66,108,111,98,32,40,66,101,97,115,116,32,
      118,50,41,62,58,60,66,101,97,115,116,32,118,50,32,45,32,70,117,110,
      99,116,105,111,110,32,119,105,116,104,32,99,97,112,116,117,114,101,62,10,
      73,110,116,101,103,101,114,65,100,100,13,1,0,10,0,0,0,1,0,0,
      2,0,0,1,0,0,3,0,0,1,0,0,3,0,0,1,0,0,3,0,
      0,2,0,0,0,1,30,0,0,10,0,0,0,1,0,0,2,0,0,1,
      0,0,3,0,0,1,0,0,3,0,0,1,0,0,3,0,0,2,0,0,
      4,0,1,0,1,30,0,0,11,0,0,0,1,0,0,1,0,0,2,0,
      0,1,0,0,3,0,0,1,0,0,3,0,0,1,0,0,3,0,0,2,
      0,0,5,0,0,5,0,0,12,0,0,0,6,0,0,2,0,0,1,0,
      0,2,0,0,1,0,0,3,0,0,1,0,0,3,0,0,1,0,0,3,
      0,0,2,0,0,7,0,0,0,2,30,0,84,5,0,0,30,0,129,1,
      4,0,1,1,20,
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
      137,69,97,115,116,13,10,2,9,1,3,2,16,1,0,0,10,0,235,2,
      8,66,60,108,111,99,97,116,105,111,110,62,58,60,66,108,111,98,32,40,
      66,101,97,115,116,32,118,50,41,62,58,60,66,101,97,115,116,32,118,50,
      32,45,32,70,117,110,99,116,105,111,110,32,99,97,112,116,117,114,105,110,
      103,32,97,114,114,97,121,62,63,60,98,108,111,99,107,62,58,60,66,108,
      111,98,32,40,66,101,97,115,116,32,118,50,41,62,58,60,66,101,97,115,
      116,32,118,50,32,45,32,70,117,110,99,116,105,111,110,32,99,97,112,116,
      117,114,105,110,103,32,97,114,114,97,121,62,74,60,98,108,111,98,46,98,
      101,97,115,116,50,46,115,112,101,99,62,58,60,66,108,111,98,32,40,66,
      101,97,115,116,32,118,50,41,62,58,60,66,101,97,115,116,32,118,50,32,
      45,32,70,117,110,99,116,105,111,110,32,99,97,112,116,117,114,105,110,103,
      32,97,114,114,97,121,62,72,60,112,108,97,116,102,111,114,109,115,46,115,
      112,101,99,62,58,60,66,108,111,98,32,40,66,101,97,115,116,32,118,50,
      41,62,58,60,66,101,97,115,116,32,118,50,32,45,32,70,117,110,99,116,
      105,111,110,32,99,97,112,116,117,114,105,110,103,32,97,114,114,97,121,62,
      4,95,54,52,54,4,95,54,52,55,63,60,97,114,114,97,121,62,58,60,
      66,108,111,98,32,40,66,101,97,115,116,32,118,50,41,62,58,60,66,101,
      97,115,116,32,118,50,32,45,32,70,117,110,99,116,105,111,110,32,99,97,
      112,116,117,114,105,110,103,32,97,114,114,97,121,62,8,65,114,114,97,121,
      71,101,116,13,1,0,10,0,0,0,1,0,0,2,0,0,1,0,0,3,
      0,0,1,0,0,3,0,0,1,0,0,3,0,0,2,0,0,0,1,30,
      2,0,10,0,0,0,1,0,0,2,0,0,1,0,0,3,0,0,1,0,
      0,3,0,0,1,0,0,3,0,0,2,0,0,4,0,1,0,1,30,0,
      0,11,0,0,0,1,0,0,1,0,0,2,0,0,1,0,0,3,0,0,
      1,0,0,3,0,0,1,0,0,3,0,0,2,0,0,5,0,0,5,0,
      0,12,0,0,0,6,0,0,2,0,0,1,0,0,2,0,0,1,0,0,
      3,0,0,1,0,0,3,0,0,1,0,0,3,0,0,2,0,0,7,0,
      1,0,0,2,30,2,124,4,0,1,30,0,91,5,0,0,1,0,3,20,
      40,60,
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
      137,69,97,115,116,13,10,2,9,2,3,2,16,1,0,0,10,1,153,3,
      10,60,60,108,111,99,97,116,105,111,110,62,58,60,66,108,111,98,32,40,
      66,101,97,115,116,32,118,50,41,62,58,60,66,101,97,115,116,32,118,50,
      32,45,32,65,114,114,97,121,32,111,102,32,102,117,110,99,116,105,111,110,
      115,62,57,60,98,108,111,99,107,62,58,60,66,108,111,98,32,40,66,101,
      97,115,116,32,118,50,41,62,58,60,66,101,97,115,116,32,118,50,32,45,
      32,65,114,114,97,121,32,111,102,32,102,117,110,99,116,105,111,110,115,62,
      68,60,98,108,111,98,46,98,101,97,115,116,50,46,115,112,101,99,62,58,
      60,66,108,111,98,32,40,66,101,97,115,116,32,118,50,41,62,58,60,66,
      101,97,115,116,32,118,50,32,45,32,65,114,114,97,121,32,111,102,32,102,
      117,110,99,116,105,111,110,115,62,66,60,112,108,97,116,102,111,114,109,115,
      46,115,112,101,99,62,58,60,66,108,111,98,32,40,66,101,97,115,116,32,
      118,50,41,62,58,60,66,101,97,115,116,32,118,50,32,45,32,65,114,114,
      97,121,32,111,102,32,102,117,110,99,116,105,111,110,115,62,4,95,54,54,
      51,59,60,105,110,116,101,103,101,114,62,58,60,66,108,111,98,32,40,66,
      101,97,115,116,32,118,50,41,62,58,60,66,101,97,115,116,32,118,50,32,
      45,32,65,114,114,97,121,32,111,102,32,102,117,110,99,116,105,111,110,115,
      62,10,73,110,116,101,103,101,114,65,100,100,55,60,97,115,116,62,58,60,
      66,108,111,98,32,40,66,101,97,115,116,32,118,50,41,62,58,60,66,101,
      97,115,116,32,118,50,32,45,32,65,114,114,97,121,32,111,102,32,102,117,
      110,99,116,105,111,110,115,62,4,95,54,54,52,15,73,110,116,101,103,101,
      114,77,117,108,116,105,112,108,121,0,2,13,1,0,10,0,0,0,1,0,
      0,2,0,0,1,0,0,3,0,0,1,0,0,3,0,0,1,0,0,3,
      0,0,2,0,0,0,0,0,1,30,0,0,11,0,0,0,1,0,0,1,
      0,0,2,0,0,1,0,0,3,0,0,1,0,0,3,0,0,1,0,0,
      3,0,0,2,0,0,4,0,0,5,0,0,12,0,0,0,5,0,0,2,
      0,0,1,0,0,2,0,0,1,0,0,3,0,0,1,0,0,3,0,0,
      1,0,0,3,0,0,2,0,0,6,0,0,0,2,30,0,84,4,0,0,
      29,0,0,13,0,0,0,7,0,0,5,0,0,2,0,0,1,0,0,2,
      0,0,1,0,0,3,0,0,1,0,0,3,0,0,1,0,0,3,0,0,
      2,0,0,4,2,0,13,1,0,10,0,0,0,1,0,0,2,0,0,1,
      0,0,3,0,0,1,0,0,3,0,0,1,0,0,3,0,0,2,0,0,
      0,0,0,1,30,0,0,11,0,0,0,1,0,0,1,0,0,2,0,0,
      1,0,0,3,0,0,1,0,0,3,0,0,1,0,0,3,0,0,2,0,
      0,8,0,0,5,0,0,12,0,0,0,5,0,0,2,0,0,1,0,0,
      2,0,0,1,0,0,3,0,0,1,0,0,3,0,0,1,0,0,3,0,
      0,2,0,0,9,0,0,0,2,30,0,84,8,0,0,29,0,0,13,0,
      0,0,7,0,0,5,0,0,2,0,0,1,0,0,2,0,0,1,0,0,
      3,0,0,1,0,0,3,0,0,1,0,0,3,0,0,2,0,0,4,4,
      0,
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
      137,69,97,115,116,13,10,2,6,1,2,2,16,0,0,151,3,9,73,60,
      108,111,99,97,116,105,111,110,62,58,60,66,108,111,98,32,40,66,101,97,
      115,116,32,118,50,41,62,58,60,66,101,97,115,116,32,118,50,32,45,32,
      70,117,110,99,116,105,111,110,32,119,105,116,104,32,109,117,108,116,105,112,
      108,101,32,99,97,112,116,117,114,101,115,62,70,60,98,108,111,99,107,62,
      58,60,66,108,111,98,32,40,66,101,97,115,116,32,118,50,41,62,58,60,
      66,101,97,115,116,32,118,50,32,45,32,70,117,110,99,116,105,111,110,32,
      119,105,116,104,32,109,117,108,116,105,112,108,101,32,99,97,112,116,117,114,
      101,115,62,81,60,98,108,111,98,46,98,101,97,115,116,50,46,115,112,101,
      99,62,58,60,66,108,111,98,32,40,66,101,97,115,116,32,118,50,41,62,
      58,60,66,101,97,115,116,32,118,50,32,45,32,70,117,110,99,116,105,111,
      110,32,119,105,116,104,32,109,117,108,116,105,112,108,101,32,99,97,112,116,
      117,114,101,115,62,79,60,112,108,97,116,102,111,114,109,115,46,115,112,101,
      99,62,58,60,66,108,111,98,32,40,66,101,97,115,116,32,118,50,41,62,
      58,60,66,101,97,115,116,32,118,50,32,45,32,70,117,110,99,116,105,111,
      110,32,119,105,116,104,32,109,117,108,116,105,112,108,101,32,99,97,112,116,
      117,114,101,115,62,4,95,54,56,54,4,95,54,56,55,4,95,54,56,56,
      72,60,105,110,116,101,103,101,114,62,58,60,66,108,111,98,32,40,66,101,
      97,115,116,32,118,50,41,62,58,60,66,101,97,115,116,32,118,50,32,45,
      32,70,117,110,99,116,105,111,110,32,119,105,116,104,32,109,117,108,116,105,
      112,108,101,32,99,97,112,116,117,114,101,115,62,10,73,110,116,101,103,101,
      114,65,100,100,13,1,0,10,0,0,0,1,0,0,2,0,0,1,0,0,
      3,0,0,1,0,0,3,0,0,1,0,0,3,0,0,2,0,0,0,3,
      30,0,0,10,0,0,0,1,0,0,2,0,0,1,0,0,3,0,0,1,
      0,0,3,0,0,1,0,0,3,0,0,2,0,0,4,0,1,30,0,0,
      10,0,0,0,1,0,0,2,0,0,1,0,0,3,0,0,1,0,0,3,
      0,0,1,0,0,3,0,0,2,0,0,5,0,1,30,0,0,10,0,0,
      0,1,0,0,2,0,0,1,0,0,3,0,0,1,0,0,3,0,0,1,
      0,0,3,0,0,2,0,0,6,0,1,0,0,5,0,0,12,0,0,0,
      7,0,0,2,0,0,1,0,0,2,0,0,1,0,0,3,0,0,1,0,
      0,3,0,0,1,0,0,3,0,0,2,0,0,8,0,0,0,2,5,0,
      0,12,0,0,0,7,0,0,2,0,0,1,0,0,2,0,0,1,0,0,
      3,0,0,1,0,0,3,0,0,1,0,0,3,0,0,2,0,0,8,0,
      0,0,2,30,0,202,1,4,0,1,30,0,172,1,5,0,1,30,0,142,
      1,6,0,1,3,20,40,24,
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
      137,69,97,115,116,13,10,2,53,0,6,18,5,1,16,0,0,9,2,5,
      108,97,98,101,108,1,7,111,110,67,108,105,99,107,2,9,1,7,99,111,
      110,116,101,110,116,1,8,2,6,98,117,116,116,111,110,3,4,116,101,120,
      116,4,131,3,7,8,67,108,105,99,107,32,109,101,87,60,108,111,99,97,
      116,105,111,110,62,58,60,66,108,111,98,32,40,66,101,97,115,116,32,118,
      50,41,62,58,60,66,101,97,115,116,32,118,50,32,45,32,85,73,32,99,
      111,109,112,111,110,101,110,116,32,119,105,116,104,32,111,110,67,108,105,99,
      107,32,114,101,116,117,114,110,105,110,103,32,115,101,108,102,32,116,121,112,
      101,62,84,60,98,108,111,99,107,62,58,60,66,108,111,98,32,40,66,101,
      97,115,116,32,118,50,41,62,58,60,66,101,97,115,116,32,118,50,32,45,
      32,85,73,32,99,111,109,112,111,110,101,110,116,32,119,105,116,104,32,111,
      110,67,108,105,99,107,32,114,101,116,117,114,110,105,110,103,32,115,101,108,
      102,32,116,121,112,101,62,95,60,98,108,111,98,46,98,101,97,115,116,50,
      46,115,112,101,99,62,58,60,66,108,111,98,32,40,66,101,97,115,116,32,
      118,50,41,62,58,60,66,101,97,115,116,32,118,50,32,45,32,85,73,32,
      99,111,109,112,111,110,101,110,116,32,119,105,116,104,32,111,110,67,108,105,
      99,107,32,114,101,116,117,114,110,105,110,103,32,115,101,108,102,32,116,121,
      112,101,62,93,60,112,108,97,116,102,111,114,109,115,46,115,112,101,99,62,
      58,60,66,108,111,98,32,40,66,101,97,115,116,32,118,50,41,62,58,60,
      66,101,97,115,116,32,118,50,32,45,32,85,73,32,99,111,109,112,111,110,
      101,110,116,32,119,105,116,104,32,111,110,67,108,105,99,107,32,114,101,116,
      117,114,110,105,110,103,32,115,101,108,102,32,116,121,112,101,62,4,95,55,
      48,52,8,99,108,105,99,107,101,100,33,0,0,13,2,0,10,1,0,0,
      2,0,0,3,0,0,2,0,0,4,0,0,2,0,0,4,0,0,2,0,
      0,4,0,0,3,0,0,0,1,30,0,0,10,1,0,0,2,0,0,3,
      0,0,2,0,0,4,0,0,2,0,0,4,0,0,2,0,0,4,0,0,
      3,0,0,5,0,1,0,0,30,0,38,5,0,1,1,1,6,
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
      137,69,97,115,116,13,10,2,51,0,7,18,6,10,0,2,16,1,2,0,
      9,2,8,99,104,105,108,100,114,101,110,1,6,114,101,110,100,101,114,3,
      1,8,2,9,99,111,110,116,97,105,110,101,114,4,4,108,101,97,102,5,
      146,3,8,6,99,104,105,108,100,49,90,60,108,111,99,97,116,105,111,110,
      62,58,60,66,108,111,98,32,40,66,101,97,115,116,32,118,50,41,62,58,
      60,66,101,97,115,116,32,118,50,32,45,32,82,101,99,117,114,115,105,118,
      101,32,116,121,112,101,32,119,105,116,104,32,114,101,110,100,101,114,32,99,
      97,108,108,98,97,99,107,32,97,110,100,32,99,104,105,108,100,114,101,110,
      62,87,60,98,108,111,99,107,62,58,60,66,108,111,98,32,40,66,101,97,
      115,116,32,118,50,41,62,58,60,66,101,97,115,116,32,118,50,32,45,32,
      82,101,99,117,114,115,105,118,101,32,116,121,112,101,32,119,105,116,104,32,
      114,101,110,100,101,114,32,99,97,108,108,98,97,99,107,32,97,110,100,32,
      99,104,105,108,100,114,101,110,62,98,60,98,108,111,98,46,98,101,97,115,
      116,50,46,115,112,101,99,62,58,60,66,108,111,98,32,40,66,101,97,115,
      116,32,118,50,41,62,58,60,66,101,97,115,116,32,118,50,32,45,32,82,
      101,99,117,114,115,105,118,101,32,116,121,112,101,32,119,105,116,104,32,114,
      101,110,100,101,114,32,99,97,108,108,98,97,99,107,32,97,110,100,32,99,
      104,105,108,100,114,101,110,62,96,60,112,108,97,116,102,111,114,109,115,46,
      115,112,101,99,62,58,60,66,108,111,98,32,40,66,101,97,115,116,32,118,
      50,41,62,58,60,66,101,97,115,116,32,118,50,32,45,32,82,101,99,117,
      114,115,105,118,101,32,116,121,112,101,32,119,105,116,104,32,114,101,110,100,
      101,114,32,99,97,108,108,98,97,99,107,32,97,110,100,32,99,104,105,108,
      100,114,101,110,62,4,95,55,50,50,4,95,55,50,51,8,114,101,110,100,
      101,114,101,100,0,0,1,1,0,13,3,0,10,1,0,0,2,0,0,3,
      0,0,2,0,0,4,0,0,2,0,0,4,0,0,2,0,0,4,0,0,
      3,0,0,0,1,30,0,0,10,1,0,0,2,0,0,3,0,0,2,0,
      0,4,0,0,2,0,0,4,0,0,2,0,0,4,0,0,3,0,0,5,
      0,1,0,1,30,2,0,11,1,0,0,2,0,0,2,0,0,3,0,0,
      2,0,0,4,0,0,2,0,0,4,0,0,2,0,0,4,0,0,3,0,
      0,6,0,0,30,0,78,5,0,1,1,1,7,
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
    // Null: 8 magic + 4 type table + 2 string table = 14
    $(assert.equal(East.Blob.encodeBeast(East.value(null, NullType), 'v2').size(), 14n));
    // Boolean: 14 + 1 = 15
    $(assert.equal(East.Blob.encodeBeast(East.value(true, BooleanType), 'v2').size(), 15n));
    // Empty array: 8 magic + 6 type table + 2 string table + 2 value = 18
    $(assert.equal(East.Blob.encodeBeast(East.value([], ArrayType(IntegerType)), 'v2').size(), 18n));
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
