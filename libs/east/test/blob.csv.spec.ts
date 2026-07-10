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
  StructType,
  VariantType,
} from "../src/index.js";
import { describeEast as describe, assertEast as assert } from "./platforms.spec.js";
import * as ex from "./blob.examples.js";

await describe("Blob (CSV)", (test) => {
  assert.examples(test, { blobDecodeCsv: ex.blobDecodeCsv });

  test("decodeCsv - simple struct with header", $ => {
    const PersonType = StructType({ name: StringType, age: IntegerType });
    const csv = $.let(East.value(
      new TextEncoder().encode("name,age\nAlice,30\nBob,25"),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(PersonType));

    $(assert.equal(result.size(), 2n));
    $(assert.equal(result.get(0n).name, "Alice"));
    $(assert.equal(result.get(0n).age, 30n));
    $(assert.equal(result.get(1n).name, "Bob"));
    $(assert.equal(result.get(1n).age, 25n));
  });

  test("decodeCsv - empty CSV returns empty array", $ => {
    const T = StructType({ name: StringType });
    const csv = $.let(East.value(
      new TextEncoder().encode("name\n"),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T));

    $(assert.equal(result.size(), 0n));
  });

  test("decodeCsv - handles UTF-8 BOM", $ => {
    const T = StructType({ name: StringType });
    const csv = $.let(East.value(
      new Uint8Array([0xEF, 0xBB, 0xBF, ...new TextEncoder().encode("name\nAlice")]),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T));

    $(assert.equal(result.size(), 1n));
    $(assert.equal(result.get(0n).name, "Alice"));
  });

  test("decodeCsv - integer fields", $ => {
    const T = StructType({ value: IntegerType });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\n42\n-123\n0"),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T));

    $(assert.equal(result.size(), 3n));
    $(assert.equal(result.get(0n).value, 42n));
    $(assert.equal(result.get(1n).value, -123n));
    $(assert.equal(result.get(2n).value, 0n));
  });

  test("decodeCsv - float fields", $ => {
    const T = StructType({ value: FloatType });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\n3.14\n-2.5\nInfinity\n-Infinity"),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T));

    $(assert.equal(result.size(), 4n));
    $(assert.equal(result.get(0n).value, 3.14));
    $(assert.equal(result.get(1n).value, -2.5));
    $(assert.equal(result.get(2n).value, East.value(Infinity)));
    $(assert.equal(result.get(3n).value, East.value(-Infinity)));
  });

  test("decodeCsv - boolean fields", $ => {
    const T = StructType({ value: BooleanType });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\ntrue\nfalse"),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T));

    $(assert.equal(result.size(), 2n));
    $(assert.equal(result.get(0n).value, true));
    $(assert.equal(result.get(1n).value, false));
  });

  test("decodeCsv - blob fields as hex", $ => {
    const T = StructType({ value: BlobType });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\n0x48656c6c6f"),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T));
    const expected = $.let(East.value(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]), BlobType));

    $(assert.equal(result.size(), 1n));
    $(assert.equal(result.get(0n).value, expected));
  });

  test("decodeCsv - optional string with value", $ => {
    const T = StructType({ value: VariantType({ none: NullType, some: StringType }) });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\nhello"),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T));

    $(assert.equal(result.size(), 1n));
    $(assert.equal(
      Expr.match(result.get(0n).value, { some: ($, v) => v, none: () => "" }),
      "hello"
    ));
  });

  test("decodeCsv - optional string empty is some empty string by default", $ => {
    const T = StructType({ value: VariantType({ none: NullType, some: StringType }) });
    // Empty string after header creates one data row with empty value.
    // Default nullStrings is [] so the empty field decodes as "".
    const csv = $.let(East.value(
      new TextEncoder().encode("value\n\n"),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T, { skipEmptyLines: false }));

    $(assert.equal(result.size(), 1n));
    $(assert.equal(result.get(0n).value.getTag(), "some"));
    $(assert.equal(
      Expr.match(result.get(0n).value, { some: ($, v) => v, none: () => "missing" }),
      ""
    ));
  });

  test("decodeCsv - optional string empty is none with nullStrings", $ => {
    const T = StructType({ value: VariantType({ none: NullType, some: StringType }) });
    // Opt in to null semantics: empty field decodes as none
    const csv = $.let(East.value(
      new TextEncoder().encode("value\n\n"),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T, { skipEmptyLines: false, nullStrings: [""] }));

    $(assert.equal(result.size(), 1n));
    $(assert.equal(result.get(0n).value.getTag(), "none"));
  });

  test("decodeCsv - missing optional column becomes none", $ => {
    const T = StructType({ name: StringType, nickname: VariantType({ none: NullType, some: StringType }) });
    const csv = $.let(East.value(
      new TextEncoder().encode("name\nAlice"),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T));

    $(assert.equal(result.size(), 1n));
    $(assert.equal(result.get(0n).name, "Alice"));
    $(assert.equal(result.get(0n).nickname.getTag(), "none"));
  });

  test("decodeCsv - quoted fields with comma", $ => {
    const T = StructType({ value: StringType });
    const csv = $.let(East.value(
      new TextEncoder().encode('value\n"hello, world"'),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T));

    $(assert.equal(result.size(), 1n));
    $(assert.equal(result.get(0n).value, "hello, world"));
  });

  test("decodeCsv - escaped quotes", $ => {
    const T = StructType({ value: StringType });
    const csv = $.let(East.value(
      new TextEncoder().encode('value\n"say ""hello"""'),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T));

    $(assert.equal(result.size(), 1n));
    $(assert.equal(result.get(0n).value, 'say "hello"'));
  });

  test("decodeCsv - multiline quoted field", $ => {
    const T = StructType({ value: StringType });
    const csv = $.let(East.value(
      new TextEncoder().encode('value\n"line1\nline2"'),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T));

    $(assert.equal(result.size(), 1n));
    $(assert.equal(result.get(0n).value, "line1\nline2"));
  });

  test("decodeCsv - CRLF line endings", $ => {
    const T = StructType({ value: StringType });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\r\nhello\r\nworld"),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T));

    $(assert.equal(result.size(), 2n));
    $(assert.equal(result.get(0n).value, "hello"));
    $(assert.equal(result.get(1n).value, "world"));
  });

  test("decodeCsv - custom delimiter", $ => {
    const T = StructType({ a: StringType, b: StringType });
    const csv = $.let(East.value(
      new TextEncoder().encode("a;b\nhello;world"),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T, { delimiter: ";" }));

    $(assert.equal(result.size(), 1n));
    $(assert.equal(result.get(0n).a, "hello"));
    $(assert.equal(result.get(0n).b, "world"));
  });

  test("decodeCsv - without header", $ => {
    const T = StructType({ a: StringType, b: StringType });
    const csv = $.let(East.value(
      new TextEncoder().encode("hello,world"),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T, { hasHeader: false }));

    $(assert.equal(result.size(), 1n));
    $(assert.equal(result.get(0n).a, "hello"));
    $(assert.equal(result.get(0n).b, "world"));
  });

  test("decodeCsv - custom null strings", $ => {
    const T = StructType({ value: VariantType({ none: NullType, some: StringType }) });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\nhello\nNULL\nN/A"),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T, { nullStrings: ["", "NULL", "N/A"] }));

    $(assert.equal(result.size(), 3n));
    $(assert.equal(result.get(0n).value.getTag(), "some"));
    $(assert.equal(
      Expr.match(result.get(0n).value, { some: ($, v) => v, none: () => "" }),
      "hello"
    ));
    $(assert.equal(result.get(1n).value.getTag(), "none"));
    $(assert.equal(result.get(2n).value.getTag(), "none"));
  });

  test("decodeCsv - trim fields", $ => {
    const T = StructType({ value: StringType });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\n  hello  "),
      BlobType
    ));

    const result = $.let(csv.decodeCsv(T, { trimFields: true }));

    $(assert.equal(result.size(), 1n));
    $(assert.equal(result.get(0n).value, "hello"));
  });

  // T1: error message for invalid integer
  test("decodeCsv - error message for invalid integer", $ => {
    const T = StructType({ value: IntegerType });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\nabc"),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T), /expected integer, got 'abc'/));
  });

  // T2: error message for invalid boolean
  test("decodeCsv - error message for invalid boolean", $ => {
    const T = StructType({ value: BooleanType });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\nyes"),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T), /expected 'true' or 'false', got 'yes'/));
  });

  // T3: error message for missing required column
  test("decodeCsv - error message for missing required column", $ => {
    const T = StructType({ name: StringType, age: IntegerType });
    const csv = $.let(East.value(
      new TextEncoder().encode("name\nAlice"),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T), /missing required column 'age'/));
  });

  // T4: empty field decodes as empty string for a required String column
  test("decodeCsv - empty field is empty string for required column by default", $ => {
    const T = StructType({ name: StringType });
    const csv = $.let(East.value(
      new TextEncoder().encode("name\n\n"),
      BlobType
    ));
    const result = $.let(csv.decodeCsv(T, { skipEmptyLines: false }));
    $(assert.equal(result.size(), 1n));
    $(assert.equal(result.get(0n).name, ""));
  });

  // T4b: error message for null required field (opt-in null semantics)
  test("decodeCsv - error message for null required field", $ => {
    const T = StructType({ name: StringType });
    const csv = $.let(East.value(
      new TextEncoder().encode("name\n\n"),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T, { skipEmptyLines: false, nullStrings: [""] }), /null value for required field/));
  });

  // T4c: empty field for a required Float column errors by default
  test("decodeCsv - empty field for required float errors by default", $ => {
    const T = StructType({ value: FloatType });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\n\n"),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T, { skipEmptyLines: false }), /expected float/));
  });

  // T5: error message for strict extra column
  test("decodeCsv - error message for strict extra column", $ => {
    const T = StructType({ name: StringType });
    const csv = $.let(East.value(
      new TextEncoder().encode("name,extra\nAlice,foo"),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T, { strict: true }), /unexpected column 'extra' in strict mode/));
  });

  // T6: error on invalid datetime string
  test("decodeCsv - error on invalid datetime string", $ => {
    const T = StructType({ ts: DateTimeType });
    const csv = $.let(East.value(
      new TextEncoder().encode("ts\nhello"),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T), /expected ISO 8601 date, got 'hello'/));
  });

  // T7: valid datetime parses correctly (regression)
  test("decodeCsv - valid datetime parses correctly", $ => {
    const T = StructType({ ts: DateTimeType });
    const csv = $.let(East.value(
      new TextEncoder().encode("ts\n2024-01-15T10:30:00.000"),
      BlobType
    ));
    const result = $.let(csv.decodeCsv(T));
    $(assert.equal(result.size(), 1n));
  });

  // T8: error on invalid null value
  test("decodeCsv - error on invalid null value", $ => {
    const T = StructType({ value: NullType });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\nhello"),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T), /expected null, got 'hello'/));
  });

  // T9: null type accepts 'null' string (regression)
  test("decodeCsv - null type accepts null string", $ => {
    const T = StructType({ value: NullType });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\nnull"),
      BlobType
    ));
    const result = $.let(csv.decodeCsv(T));
    $(assert.equal(result.size(), 1n));
  });

  // T10: error on blob invalid hex chars
  test("decodeCsv - error on blob invalid hex chars", $ => {
    const T = StructType({ data: BlobType });
    const csv = $.let(East.value(
      new TextEncoder().encode("data\n0xGGHH"),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T), /invalid hex string/));
  });

  // T11: error on blob missing 0x prefix
  test("decodeCsv - error on blob missing 0x prefix", $ => {
    const T = StructType({ data: BlobType });
    const csv = $.let(East.value(
      new TextEncoder().encode("data\nabcd"),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T), /expected hex string starting with '0x'/));
  });

  // T12: error on too few fields for required column
  test("decodeCsv - error on too few fields for required column", $ => {
    const T = StructType({ name: StringType, age: IntegerType });
    const csv = $.let(East.value(
      new TextEncoder().encode("name,age\nAlice"),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T), /row has 1 fields, expected at least 2/));
  });

  // T13: unclosed quote error message
  test("decodeCsv - unclosed quote error message", $ => {
    const T = StructType({ value: StringType });
    const csv = $.let(East.value(
      new TextEncoder().encode('value\n"unclosed'),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T), /unclosed quote/));
  });

  // T14: integer with leading whitespace rejects
  test("decodeCsv - integer with leading whitespace rejects", $ => {
    const T = StructType({ value: IntegerType });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\n 42"),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T), /expected integer/));
  });

  // T15: integer with trailing whitespace rejects
  test("decodeCsv - integer with trailing whitespace rejects", $ => {
    const T = StructType({ value: IntegerType });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\n42 "),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T), /expected integer/));
  });

  // T16: float partial parse rejects
  test("decodeCsv - float partial parse rejects", $ => {
    const T = StructType({ value: FloatType });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\n1.5abc"),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T), /expected float/));
  });

  // T17: non-ISO datetime rejects
  test("decodeCsv - non-ISO datetime rejects", $ => {
    const T = StructType({ ts: DateTimeType });
    const csv = $.let(East.value(
      new TextEncoder().encode("ts\nJan 15 2024"),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T), /expected ISO 8601 date/));
  });

  // T18: float with leading whitespace rejects
  test("decodeCsv - float with leading whitespace rejects", $ => {
    const T = StructType({ value: FloatType });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\n 1.5"),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T), /expected float/));
  });

  // T19: float with trailing whitespace rejects
  test("decodeCsv - float with trailing whitespace rejects", $ => {
    const T = StructType({ value: FloatType });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\n1.5 "),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T), /expected float/));
  });

  // T20: error includes row number
  test("decodeCsv - error includes row number", $ => {
    const T = StructType({ name: StringType, age: IntegerType });
    const csv = $.let(East.value(
      new TextEncoder().encode("name,age\nAlice,25\nBob,abc"),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T), /at row 2/));
  });

  // T21: error includes column name
  test("decodeCsv - error includes column name", $ => {
    const T = StructType({ name: StringType, age: IntegerType });
    const csv = $.let(East.value(
      new TextEncoder().encode("name,age\nAlice,abc"),
      BlobType
    ));
    $(assert.throws(csv.decodeCsv(T), /\(age\)/));
  });

  // T22: float NaN parses correctly (regression)
  test("decodeCsv - float NaN parses correctly", $ => {
    const T = StructType({ value: FloatType });
    const csv = $.let(East.value(
      new TextEncoder().encode("value\nNaN"),
      BlobType
    ));
    const result = $.let(csv.decodeCsv(T));
    $(assert.equal(result.size(), 1n));
  });
});
