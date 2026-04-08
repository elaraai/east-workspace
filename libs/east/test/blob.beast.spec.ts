/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import {
  East,
  Expr,
  NullType,
  BooleanType,
  IntegerType,
  FloatType,
  StringType,
  DateTimeType,
  BlobType,
  ArrayType,
  SetType,
  DictType,
  StructType,
  VariantType,
  variant,
} from "../src/index.js";
import { describeEast as describe, assertEast as assert } from "./platforms.spec.js";
import * as ex from "./blob.examples.js";

await describe("Blob (Beast v1)", (test) => {
  // =========================================================================
  // Beast v1 - Primitive Types
  // =========================================================================

  assert.examples(test, { blobEncodeBeastV1: ex.blobEncodeBeastV1, blobDecodeBeastV1: ex.blobDecodeBeastV1 });

  test("Beast v1 - Null type", $ => {
    const value = $.let(East.value(null, NullType));
    const encoded = $.let(East.Blob.encodeBeast(value, 'v1'));

    // Exact byte verification
    const expected = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      8  // Null type tag
    ]), BlobType));
    $(assert.equal(encoded, expected));

    // Round-trip
    const decoded = $.let(encoded.decodeBeast(NullType, 'v1'));
    $(assert.equal(decoded, value));
  });

  test("Beast v1 - Boolean type", $ => {
    // Test false
    const falseVal = $.let(East.value(false, BooleanType));
    const encodedFalse = $.let(East.Blob.encodeBeast(falseVal, 'v1'));

    // Exact byte verification
    const expectedFalse = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      2,  // Boolean type tag
      0   // false
    ]), BlobType));
    $(assert.equal(encodedFalse, expectedFalse));

    // Round-trip
    const decodedFalse = $.let(encodedFalse.decodeBeast(BooleanType, 'v1'));
    $(assert.equal(decodedFalse, falseVal));

    // Test true
    const trueVal = $.let(East.value(true, BooleanType));
    const encodedTrue = $.let(East.Blob.encodeBeast(trueVal, 'v1'));

    // Exact byte verification
    const expectedTrue = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      2,  // Boolean type tag
      1   // true
    ]), BlobType));
    $(assert.equal(encodedTrue, expectedTrue));

    // Round-trip
    const decodedTrue = $.let(encodedTrue.decodeBeast(BooleanType, 'v1'));
    $(assert.equal(decodedTrue, trueVal));
  });

  test("Beast v1 - Integer type - basic values", $ => {
    // Zero
    const zero = $.let(East.value(0n, IntegerType));
    const encodedZero = $.let(East.Blob.encodeBeast(zero, 'v1'));

    // Exact byte verification
    const expectedZero = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      6, // Integer type tag
      128, 0, 0, 0, 0, 0, 0, 0 // sign-flipped 0
    ]), BlobType));
    $(assert.equal(encodedZero, expectedZero));

    // Round-trip
    const decodedZero = $.let(encodedZero.decodeBeast(IntegerType, 'v1'));
    $(assert.equal(decodedZero, zero));

    // Positive: 42
    const pos42 = $.let(East.value(42n, IntegerType));
    const encodedPos = $.let(East.Blob.encodeBeast(pos42, 'v1'));

    // Exact byte verification
    const expectedPos = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      6, // Integer type tag
      128, 0, 0, 0, 0, 0, 0, 42 // sign-flipped 42
    ]), BlobType));
    $(assert.equal(encodedPos, expectedPos));

    // Round-trip
    const decodedPos = $.let(encodedPos.decodeBeast(IntegerType, 'v1'));
    $(assert.equal(decodedPos, pos42));

    // Negative: -1
    const neg1 = $.let(East.value(-1n, IntegerType));
    const encodedNeg = $.let(East.Blob.encodeBeast(neg1, 'v1'));

    // Exact byte verification
    const expectedNeg = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      6, // Integer type tag
      127, 255, 255, 255, 255, 255, 255, 255 // sign-flipped -1
    ]), BlobType));
    $(assert.equal(encodedNeg, expectedNeg));

    // Round-trip
    const decodedNeg = $.let(encodedNeg.decodeBeast(IntegerType, 'v1'));
    $(assert.equal(decodedNeg, neg1));
  });

  test("Beast v1 - Integer type - boundary values", $ => {
    // Max int64: 9223372036854775807
    const maxInt = $.let(East.value(9223372036854775807n, IntegerType));
    const encodedMax = $.let(East.Blob.encodeBeast(maxInt, 'v1'));

    // Exact byte verification
    const expectedMax = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      6, // Integer type tag
      255, 255, 255, 255, 255, 255, 255, 255 // sign-flipped MAX
    ]), BlobType));
    $(assert.equal(encodedMax, expectedMax));

    // Round-trip
    const decodedMax = $.let(encodedMax.decodeBeast(IntegerType, 'v1'));
    $(assert.equal(decodedMax, maxInt));

    // Min int64: -9223372036854775808
    const minInt = $.let(East.value(-9223372036854775808n, IntegerType));
    const encodedMin = $.let(East.Blob.encodeBeast(minInt, 'v1'));

    // Exact byte verification
    const expectedMin = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      6, // Integer type tag
      0, 0, 0, 0, 0, 0, 0, 0 // sign-flipped MIN
    ]), BlobType));
    $(assert.equal(encodedMin, expectedMin));

    // Round-trip
    const decodedMin = $.let(encodedMin.decodeBeast(IntegerType, 'v1'));
    $(assert.equal(decodedMin, minInt));
  });

  test("Beast v1 - Float type - basic values", $ => {
    // Zero (positive)
    const zero = $.let(East.value(0.0, FloatType));
    const encodedZero = $.let(East.Blob.encodeBeast(zero, 'v1'));

    // Exact byte verification
    const expectedZero = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      5, // Float type tag
      128, 0, 0, 0, 0, 0, 0, 0 // sorted 0.0
    ]), BlobType));
    $(assert.equal(encodedZero, expectedZero));

    // Round-trip
    const decodedZero = $.let(encodedZero.decodeBeast(FloatType, 'v1'));
    $(assert.equal(decodedZero, zero));

    // Common value: 3.14
    const pi = $.let(East.value(3.14, FloatType));
    const encodedPi = $.let(East.Blob.encodeBeast(pi, 'v1'));

    // Exact byte verification
    const expectedPi = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      5, // Float type tag
      192, 9, 30, 184, 81, 235, 133, 31 // sorted 3.14
    ]), BlobType));
    $(assert.equal(encodedPi, expectedPi));

    // Round-trip
    const decodedPi = $.let(encodedPi.decodeBeast(FloatType, 'v1'));
    $(assert.equal(decodedPi, pi));

    // Negative: -1.5
    const negVal = $.let(East.value(-1.5, FloatType));
    const encodedNeg = $.let(East.Blob.encodeBeast(negVal, 'v1'));

    // Exact byte verification
    const expectedNeg = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      5, // Float type tag
      64, 7, 255, 255, 255, 255, 255, 255 // sorted -1.5
    ]), BlobType));
    $(assert.equal(encodedNeg, expectedNeg));

    // Round-trip
    const decodedNeg = $.let(encodedNeg.decodeBeast(FloatType, 'v1'));
    $(assert.equal(decodedNeg, negVal));
  });

  test("Beast v1 - Float type - special values", $ => {
    // Negative infinity
    const negInf = $.let(East.value(-Infinity, FloatType));
    const encodedNegInf = $.let(East.Blob.encodeBeast(negInf, 'v1'));

    // Exact byte verification
    const expectedNegInf = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      5, // Float type tag
      0, 15, 255, 255, 255, 255, 255, 255 // sorted -Infinity
    ]), BlobType));
    $(assert.equal(encodedNegInf, expectedNegInf));

    // Round-trip
    const decodedNegInf = $.let(encodedNegInf.decodeBeast(FloatType, 'v1'));
    $(assert.equal(decodedNegInf, negInf));

    // Positive infinity
    const posInf = $.let(East.value(Infinity, FloatType));
    const encodedPosInf = $.let(East.Blob.encodeBeast(posInf, 'v1'));

    // Exact byte verification
    const expectedPosInf = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      5, // Float type tag
      255, 240, 0, 0, 0, 0, 0, 0 // sorted Infinity
    ]), BlobType));
    $(assert.equal(encodedPosInf, expectedPosInf));

    // Round-trip
    const decodedPosInf = $.let(encodedPosInf.decodeBeast(FloatType, 'v1'));
    $(assert.equal(decodedPosInf, posInf));

    // NaN
    const nanVal = $.let(East.value(NaN, FloatType));
    const encodedNaN = $.let(East.Blob.encodeBeast(nanVal, 'v1'));

    // Exact byte verification
    const expectedNaN = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      5, // Float type tag
      255, 248, 0, 0, 0, 0, 0, 0 // sorted NaN
    ]), BlobType));
    $(assert.equal(encodedNaN, expectedNaN));

    // Round-trip
    const decodedNaN = $.let(encodedNaN.decodeBeast(FloatType, 'v1'));
    $(assert.equal(decodedNaN, nanVal));
  });

  test("Beast v1 - String type", $ => {
    // Empty string
    const empty = $.let(East.value("", StringType));
    const encodedEmpty = $.let(East.Blob.encodeBeast(empty, 'v1'));

    // Exact byte verification
    const expectedEmpty = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      10, // String type tag
      0 // null terminator
    ]), BlobType));
    $(assert.equal(encodedEmpty, expectedEmpty));

    // Round-trip
    const decodedEmpty = $.let(encodedEmpty.decodeBeast(StringType, 'v1'));
    $(assert.equal(decodedEmpty, empty));

    // ASCII string: "hello"
    const hello = $.let(East.value("hello", StringType));
    const encodedHello = $.let(East.Blob.encodeBeast(hello, 'v1'));

    // Exact byte verification
    const expectedHello = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      10, // String type tag
      104, 101, 108, 108, 111, 0 // 'hello' + null terminator
    ]), BlobType));
    $(assert.equal(encodedHello, expectedHello));

    // Round-trip
    const decodedHello = $.let(encodedHello.decodeBeast(StringType, 'v1'));
    $(assert.equal(decodedHello, hello));

    // Unicode string
    const unicode = $.let(East.value("Hello 世界", StringType));
    const encodedUnicode = $.let(East.Blob.encodeBeast(unicode, 'v1'));

    // Exact byte verification
    const expectedUnicode = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      10, // String type tag
      72, 101, 108, 108, 111, 32, 228, 184, 150, 231, 149, 140, 0 // 'Hello 世界' + null
    ]), BlobType));
    $(assert.equal(encodedUnicode, expectedUnicode));

    // Round-trip
    const decodedUnicode = $.let(encodedUnicode.decodeBeast(StringType, 'v1'));
    $(assert.equal(decodedUnicode, unicode));

    // Emoji
    const emoji = $.let(East.value("😀", StringType));
    const encodedEmoji = $.let(East.Blob.encodeBeast(emoji, 'v1'));

    // Exact byte verification
    const expectedEmoji = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      10, // String type tag
      240, 159, 152, 128, 0 // '😀' + null
    ]), BlobType));
    $(assert.equal(encodedEmoji, expectedEmoji));

    // Round-trip
    const decodedEmoji = $.let(encodedEmoji.decodeBeast(StringType, 'v1'));
    $(assert.equal(decodedEmoji, emoji));
  });

  test("Beast v1 - DateTime type", $ => {
    // Unix epoch
    const epoch = $.let(East.value(new Date(0), DateTimeType));
    const encodedEpoch = $.let(East.Blob.encodeBeast(epoch, 'v1'));

    // Exact byte verification
    const expectedEpoch = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      3, // DateTime type tag
      128, 0, 0, 0, 0, 0, 0, 0 // sign-flipped epoch (0 ms)
    ]), BlobType));
    $(assert.equal(encodedEpoch, expectedEpoch));

    // Round-trip
    const decodedEpoch = $.let(encodedEpoch.decodeBeast(DateTimeType, 'v1'));
    $(assert.equal(decodedEpoch, epoch));

    // Specific date with milliseconds: 2024-01-15T10:30:00.123Z
    const specificDate = $.let(East.value(new Date("2024-01-15T10:30:00.123Z"), DateTimeType));
    const encodedDate = $.let(East.Blob.encodeBeast(specificDate, 'v1'));

    // Exact byte verification
    const expectedDate = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      3, // DateTime type tag
      128, 0, 1, 141, 12, 171, 196, 187 // sign-flipped timestamp
    ]), BlobType));
    $(assert.equal(encodedDate, expectedDate));

    // Round-trip
    const decodedDate = $.let(encodedDate.decodeBeast(DateTimeType, 'v1'));
    $(assert.equal(decodedDate, specificDate));
  });

  test("Beast v1 - Blob type", $ => {
    // Empty blob
    const empty = $.let(East.value(new Uint8Array([]), BlobType));
    const encodedEmpty = $.let(East.Blob.encodeBeast(empty, 'v1'));

    // Exact byte verification
    const expectedEmpty = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      1, // Blob type tag
      0, 0, 0, 0, 0, 0, 0, 0 // 8-byte big-endian length (0)
    ]), BlobType));
    $(assert.equal(encodedEmpty, expectedEmpty));

    // Round-trip
    const decodedEmpty = $.let(encodedEmpty.decodeBeast(BlobType, 'v1'));
    $(assert.equal(decodedEmpty, empty));

    // Small blob
    const small = $.let(East.value(new Uint8Array([1, 2, 3, 4, 5]), BlobType));
    const encodedSmall = $.let(East.Blob.encodeBeast(small, 'v1'));

    // Exact byte verification
    const expectedSmall = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      1, // Blob type tag
      0, 0, 0, 0, 0, 0, 0, 5, // 8-byte big-endian length (5)
      1, 2, 3, 4, 5 // blob data
    ]), BlobType));
    $(assert.equal(encodedSmall, expectedSmall));

    // Round-trip
    const decodedSmall = $.let(encodedSmall.decodeBeast(BlobType, 'v1'));
    $(assert.equal(decodedSmall, small));
  });

  // =========================================================================
  // Beast v1 - Collection Types
  // =========================================================================

  test("Beast v1 - Array type", $ => {
    // Empty array
    const emptyArray = $.let(East.value([], ArrayType(IntegerType)));
    const encodedEmpty = $.let(East.Blob.encodeBeast(emptyArray, 'v1'));

    // Exact byte verification
    const expectedEmpty = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      0, // Array type tag
      6, // Integer element type tag
      0  // terminator (empty array)
    ]), BlobType));
    $(assert.equal(encodedEmpty, expectedEmpty));

    // Round-trip
    const decodedEmpty = $.let(encodedEmpty.decodeBeast(ArrayType(IntegerType), 'v1'));
    $(assert.equal(decodedEmpty, emptyArray));

    // Integer array [1, 2, 3]
    const intArray = $.let(East.value([1n, 2n, 3n], ArrayType(IntegerType)));
    const encodedInt = $.let(East.Blob.encodeBeast(intArray, 'v1'));

    // Exact byte verification
    const expectedInt = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      0, // Array type tag
      6, // Integer element type tag
      1, 128, 0, 0, 0, 0, 0, 0, 1, // continuation + first element (1)
      1, 128, 0, 0, 0, 0, 0, 0, 2, // continuation + second element (2)
      1, 128, 0, 0, 0, 0, 0, 0, 3, // continuation + third element (3)
      0  // terminator
    ]), BlobType));
    $(assert.equal(encodedInt, expectedInt));

    // Round-trip
    const decodedInt = $.let(encodedInt.decodeBeast(ArrayType(IntegerType), 'v1'));
    $(assert.equal(decodedInt, intArray));

    // String array ["foo", "bar"]
    const strArray = $.let(East.value(["foo", "bar"], ArrayType(StringType)));
    const encodedStr = $.let(East.Blob.encodeBeast(strArray, 'v1'));

    // Exact byte verification
    const expectedStr = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      0, // Array type tag
      10, // String element type tag
      1, 102, 111, 111, 0, // continuation + 'foo' + null
      1, 98, 97, 114, 0,   // continuation + 'bar' + null
      0  // terminator
    ]), BlobType));
    $(assert.equal(encodedStr, expectedStr));

    // Round-trip
    const decodedStr = $.let(encodedStr.decodeBeast(ArrayType(StringType), 'v1'));
    $(assert.equal(decodedStr, strArray));
  });

  test("Beast v1 - Set type", $ => {
    // Empty set
    const emptySet = $.let(East.value(new Set([]), SetType(IntegerType)));
    const encodedEmpty = $.let(East.Blob.encodeBeast(emptySet, 'v1'));

    // Exact byte verification
    const expectedEmpty = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      9, // Set type tag
      6, // Integer element type tag
      0  // terminator (empty set)
    ]), BlobType));
    $(assert.equal(encodedEmpty, expectedEmpty));

    // Round-trip
    const decodedEmpty = $.let(encodedEmpty.decodeBeast(SetType(IntegerType), 'v1'));
    $(assert.equal(decodedEmpty, emptySet));

    // Integer set {1, 2, 3}
    const intSet = $.let(East.value(new Set([1n, 2n, 3n]), SetType(IntegerType)));
    const encodedInt = $.let(East.Blob.encodeBeast(intSet, 'v1'));

    // Exact byte verification
    const expectedInt = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      9, // Set type tag
      6, // Integer element type tag
      1, 128, 0, 0, 0, 0, 0, 0, 1, // continuation + first element (1)
      1, 128, 0, 0, 0, 0, 0, 0, 2, // continuation + second element (2)
      1, 128, 0, 0, 0, 0, 0, 0, 3, // continuation + third element (3)
      0  // terminator
    ]), BlobType));
    $(assert.equal(encodedInt, expectedInt));

    // Round-trip
    const decodedInt = $.let(encodedInt.decodeBeast(SetType(IntegerType), 'v1'));
    $(assert.equal(decodedInt, intSet));

    // String set {"foo", "bar", "baz"} - sorted as "bar", "baz", "foo"
    const strSet = $.let(East.value(new Set(["foo", "bar", "baz"]), SetType(StringType)));
    const encodedStr = $.let(East.Blob.encodeBeast(strSet, 'v1'));

    // Exact byte verification (sorted order: bar, baz, foo)
    const expectedStr = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      9, // Set type tag
      10, // String element type tag
      1, 98, 97, 114, 0,   // continuation + 'bar' + null (sorted first)
      1, 98, 97, 122, 0,   // continuation + 'baz' + null
      1, 102, 111, 111, 0, // continuation + 'foo' + null (sorted last)
      0  // terminator
    ]), BlobType));
    $(assert.equal(encodedStr, expectedStr));

    // Round-trip
    const decodedStr = $.let(encodedStr.decodeBeast(SetType(StringType), 'v1'));
    $(assert.equal(decodedStr, strSet));
  });

  test("Beast v1 - Dict type", $ => {
    // Empty dict
    const emptyDict = $.let(East.value(new Map(), DictType(StringType, IntegerType)));
    const encodedEmpty = $.let(East.Blob.encodeBeast(emptyDict, 'v1'));

    // Exact byte verification
    const expectedEmpty = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      4, // Dict type tag
      10, // String key type tag
      6, // Integer value type tag
      0  // terminator (empty dict)
    ]), BlobType));
    $(assert.equal(encodedEmpty, expectedEmpty));

    // Round-trip
    const decodedEmpty = $.let(encodedEmpty.decodeBeast(DictType(StringType, IntegerType), 'v1'));
    $(assert.equal(decodedEmpty, emptyDict));

    // String to integer dict {"a": 1, "b": 2}
    const dict = $.let(East.value(
      new Map([["a", 1n], ["b", 2n]]),
      DictType(StringType, IntegerType)
    ));
    const encodedDict = $.let(East.Blob.encodeBeast(dict, 'v1'));

    // Exact byte verification
    const expectedDict = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      4, // Dict type tag
      10, // String key type tag
      6, // Integer value type tag
      1, 97, 0, 128, 0, 0, 0, 0, 0, 0, 1, // continuation + key "a" + value 1
      1, 98, 0, 128, 0, 0, 0, 0, 0, 0, 2, // continuation + key "b" + value 2
      0  // terminator
    ]), BlobType));
    $(assert.equal(encodedDict, expectedDict));

    // Round-trip
    const decodedDict = $.let(encodedDict.decodeBeast(DictType(StringType, IntegerType), 'v1'));
    $(assert.equal(decodedDict, dict));
  });

  // =========================================================================
  // Beast v1 - Compound Types
  // =========================================================================

  test("Beast v1 - Struct type", $ => {
    // Empty struct
    const emptyStruct = $.let(East.value({}, StructType({})));
    const encodedEmpty = $.let(East.Blob.encodeBeast(emptyStruct, 'v1'));

    // Exact byte verification
    const expectedEmpty = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      11, // Struct type tag
      0   // terminator (empty struct)
    ]), BlobType));
    $(assert.equal(encodedEmpty, expectedEmpty));

    // Round-trip
    const decodedEmpty = $.let(encodedEmpty.decodeBeast(StructType({}), 'v1'));
    $(assert.equal(decodedEmpty, emptyStruct));

    // Simple struct with primitives: {name: "Alice", age: 30, active: true}
    const PersonType = StructType({
      name: StringType,
      age: IntegerType,
      active: BooleanType,
    });

    const person = $.let(East.value({
      name: "Alice",
      age: 30n,
      active: true,
    }, PersonType));

    const encoded = $.let(East.Blob.encodeBeast(person, 'v1'));

    // Exact byte verification (fields sorted alphabetically: active, age, name)
    const expectedPerson = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      11, // Struct type tag
      1, 110, 97, 109, 101, 0, 10, // continuation + "name" + String type
      1, 97, 103, 101, 0, 6,       // continuation + "age" + Integer type
      1, 97, 99, 116, 105, 118, 101, 0, 2, // continuation + "active" + Boolean type
      0,  // terminator for field definitions
      65, 108, 105, 99, 101, 0,    // "Alice" + null
      128, 0, 0, 0, 0, 0, 0, 30,   // 30 (sign-flipped)
      1   // true
    ]), BlobType));
    $(assert.equal(encoded, expectedPerson));

    // Round-trip
    const decoded = $.let(encoded.decodeBeast(PersonType, 'v1'));
    $(assert.equal(decoded.name, person.name));
    $(assert.equal(decoded.age, person.age));
    $(assert.equal(decoded.active, person.active));
  });

  test("Beast v1 - Variant type", $ => {
    const OptionType = VariantType({
      none: NullType,
      some: IntegerType,
    });

    // None case
    const noneVal = $.let(variant("none", null), OptionType);
    const encodedNone = $.let(East.Blob.encodeBeast(noneVal, 'v1'));

    // Exact byte verification
    const expectedNone = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      13, // Variant type tag
      1, 110, 111, 110, 101, 0, 8, // continuation + "none" + Null type
      1, 115, 111, 109, 101, 0, 6, // continuation + "some" + Integer type
      0,  // terminator for case definitions
      0   // tag index (0 = "none")
    ]), BlobType));
    $(assert.equal(encodedNone, expectedNone));

    // Round-trip
    const decodedNone = $.let(encodedNone.decodeBeast(OptionType, 'v1'));
    $(assert.equal(decodedNone, noneVal));

    // Some case
    const someVal = $.let(variant("some", 42n), OptionType);
    const encodedSome = $.let(East.Blob.encodeBeast(someVal, 'v1'));

    // Exact byte verification
    const expectedSome = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      13, // Variant type tag
      1, 110, 111, 110, 101, 0, 8, // continuation + "none" + Null type
      1, 115, 111, 109, 101, 0, 6, // continuation + "some" + Integer type
      0,  // terminator for case definitions
      1,  // tag index (1 = "some")
      128, 0, 0, 0, 0, 0, 0, 42 // value: 42 (sign-flipped)
    ]), BlobType));
    $(assert.equal(encodedSome, expectedSome));

    // Round-trip
    const decodedSome = $.let(encodedSome.decodeBeast(OptionType, 'v1'));
    $(assert.equal(decodedSome, someVal));

    // Variant with struct
    const ShapeType = VariantType({
      circle: StructType({ radius: FloatType }),
      rectangle: StructType({ width: FloatType, height: FloatType }),
    });

    const circle = $.let(variant("circle", { radius: 5.0 }), ShapeType);
    const encodedCircle = $.let(East.Blob.encodeBeast(circle, 'v1'));

    // Round-trip
    const decodedCircle = $.let(encodedCircle.decodeBeast(ShapeType, 'v1'));
    $(assert.equal(decodedCircle, circle));
  });

  // =========================================================================
  // Beast v1 - Complex Nested Structures
  // =========================================================================

  test("Beast v1 - Complex production-like struct", $ => {
    const RecordType = StructType({
      id: StringType,
      active: BooleanType,
      timestamp: DateTimeType,
      score: FloatType,
      count: IntegerType,
      tags: ArrayType(StringType),
      metadata: DictType(StringType, StringType),
    });

    const record = $.let(East.value({
      id: "rec-12345",
      active: true,
      timestamp: new Date("2024-01-15T10:30:00.000Z"),
      score: 95.5,
      count: 42n,
      tags: ["important", "verified"],
      metadata: new Map([["source", "api"], ["version", "2.0"]]),
    }, RecordType));

    const encoded = $.let(East.Blob.encodeBeast(record, 'v1'));

    // Exact byte verification
    const expected = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      11, // Struct type tag
      // Field definitions (sorted: active, count, id, metadata, score, tags, timestamp)
      1, 105, 100, 0, 10, // "id" + String type
      1, 97, 99, 116, 105, 118, 101, 0, 2, // "active" + Boolean type
      1, 116, 105, 109, 101, 115, 116, 97, 109, 112, 0, 3, // "timestamp" + DateTime type
      1, 115, 99, 111, 114, 101, 0, 5, // "score" + Float type
      1, 99, 111, 117, 110, 116, 0, 6, // "count" + Integer type
      1, 116, 97, 103, 115, 0, 0, 10, // "tags" + Array<String> type
      1, 109, 101, 116, 97, 100, 97, 116, 97, 0, 4, 10, 10, // "metadata" + Dict<String,String> type
      0, // terminator
      // Field values
      114, 101, 99, 45, 49, 50, 51, 52, 53, 0, // "rec-12345"
      1, // true
      128, 0, 1, 141, 12, 171, 196, 64, // timestamp
      192, 87, 224, 0, 0, 0, 0, 0, // 95.5
      128, 0, 0, 0, 0, 0, 0, 42, // 42
      1, 105, 109, 112, 111, 114, 116, 97, 110, 116, 0, // "important"
      1, 118, 101, 114, 105, 102, 105, 101, 100, 0, // "verified"
      0, // terminator
      1, 115, 111, 117, 114, 99, 101, 0, 97, 112, 105, 0, // "source" -> "api"
      1, 118, 101, 114, 115, 105, 111, 110, 0, 50, 46, 48, 0, // "version" -> "2.0"
      0 // terminator
    ]), BlobType));
    $(assert.equal(encoded, expected));

    // Round-trip
    const decoded = $.let(encoded.decodeBeast(RecordType, 'v1'));
    $(assert.equal(decoded.id, record.id));
    $(assert.equal(decoded.active, record.active));
    $(assert.equal(decoded.timestamp, record.timestamp));
    $(assert.equal(decoded.score, record.score));
    $(assert.equal(decoded.count, record.count));
    $(assert.equal(decoded.tags, record.tags));
    $(assert.equal(decoded.metadata, record.metadata));
  });

  test("Beast v1 - Deeply nested structures", $ => {
    // Array of dicts of arrays
    const deepType = ArrayType(DictType(StringType, ArrayType(IntegerType)));
    const deepValue = $.let(East.value([
      new Map([["a", [1n, 2n]], ["b", [3n]]]),
      new Map([["c", []]]),
    ], deepType));

    const encoded = $.let(East.Blob.encodeBeast(deepValue, 'v1'));

    // Exact byte verification
    const expected = $.let(East.value(new Uint8Array([
      69, 97, 115, 116, 0, 234, 87, 255, // v1 header
      0, // Array type tag
      4, 10, 0, 6, // Dict<String, Array<Integer>> type
      // First dict: {"a": [1, 2], "b": [3]}
      1, // continuation
      1, 97, 0, // key "a"
      1, 128, 0, 0, 0, 0, 0, 0, 1, // value: array element 1
      1, 128, 0, 0, 0, 0, 0, 0, 2, // value: array element 2
      0, // array terminator
      1, 98, 0, // key "b"
      1, 128, 0, 0, 0, 0, 0, 0, 3, // value: array element 3
      0, // array terminator
      0, // dict terminator
      // Second dict: {"c": []}
      1, // continuation
      1, 99, 0, // key "c"
      0, // empty array terminator
      0, // dict terminator
      0  // array terminator
    ]), BlobType));
    $(assert.equal(encoded, expected));

    // Round-trip
    const decoded = $.let(encoded.decodeBeast(deepType, 'v1'));
    $(assert.equal(decoded, deepValue));
  });

  // =========================================================================
  // Beast v1 - Error Handling
  // =========================================================================

  test("Beast v1 - Error handling - wrong type", $ => {
    const value = $.let(East.value(42n, IntegerType));
    const encoded = $.let(East.Blob.encodeBeast(value, 'v1'));

    // Try to decode integer as string
    $(assert.throws(encoded.decodeBeast(StringType, 'v1'), /Failed to decode Beast data/));
  });

  test("Beast v1 - Error handling - invalid continuation byte", $ => {
    // Manually create array with invalid continuation byte (not 0x00 or 0x01)
    const invalidArray = $.let(East.value(new Uint8Array([0x02]), BlobType));

    $(assert.throws(invalidArray.decodeBeast(ArrayType(IntegerType), 'v1'), /Failed to decode Beast data/));
  });

  test("Beast v1 - Error handling - invalid variant tag", $ => {
    const OptionType = VariantType({
      none: NullType,
      some: IntegerType,
    });

    // Create blob with invalid tag (2, but only 0 and 1 are valid)
    const invalidVariant = $.let(East.value(
      new Uint8Array([0x02, 0x00]),
      BlobType
    ));

    $(assert.throws(invalidVariant.decodeBeast(OptionType, 'v1'), /Failed to decode Beast data/));
  });
});
