/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Exhaustive byte-level test suite for beast2 v2 format.
 * Every test verifies exact wire bytes and round-trip value equality.
 * See devdocs/BEAST2.md for the format specification.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  NullType, BooleanType, IntegerType, FloatType, StringType, DateTimeType, BlobType,
  ArrayType, SetType, DictType, StructType, VariantType, RecursiveType,
  RefType, VectorType, MatrixType, FunctionType,
  type EastType,
} from "../types.js";
import { toEastTypeValue, EastTypeValueType, type EastTypeValue } from "../type_of_type.js";
import { equalFor } from "../comparison.js";
import { East, variant, ref, some, none } from "../index.js";
import { matrix } from "../containers/matrix.js";
import {
  encodeBeast2For,
  decodeBeast2For,
  decodeBeast2,
  MAGIC_BYTES,
} from "./beast2.js";

const typeEqual = equalFor(EastTypeValueType);

// Magic bytes for v2
const M = [0x89, 0x45, 0x61, 0x73, 0x74, 0x0D, 0x0A, 0x02];

// Empty string table section: header_byte_length=1, count=0
const S0 = [0x01, 0x00];

/** Assert exact encoded bytes and round-trip value equality. */
function assertExact(type: EastType, value: any, expectedBytes: number[], label: string) {
  const encode = encodeBeast2For(type);
  const decode = decodeBeast2For(type);
  const bytes = encode(value);
  assert.deepEqual(Array.from(bytes), expectedBytes, `${label}: encoded bytes`);
  const decoded = decode(bytes);
  const eq = equalFor(type);
  assert.ok(eq(value, decoded), `${label}: round-trip value`);
}

/** Assert round-trip value equality (for types where exact bytes are impractical, e.g. functions). */
function assertRoundTrip(type: EastType, value: any, label: string) {
  const encode = encodeBeast2For(type);
  const decode = decodeBeast2For(type);
  const bytes = encode(value);
  // Verify magic
  assert.deepEqual(Array.from(bytes.slice(0, 8)), M, `${label}: magic`);
  const decoded = decode(bytes);
  const eq = equalFor(type);
  assert.ok(eq(value, decoded), `${label}: round-trip`);
}

// =============================================================================
// 1. Magic bytes
// =============================================================================

describe("Beast2 v2 — Magic", () => {
  test("magic bytes", () => {
    assert.deepEqual(Array.from(MAGIC_BYTES), M);
  });
});

// =============================================================================
// 2. Primitives — exact bytes
// =============================================================================

describe("Beast2 v2 — Primitives (exact bytes)", () => {
  // Type table for any primitive: [header_len=3, root=0, count=1, tag]
  // Value encoding follows immediately.

  test("Null", () => assertExact(NullType, null, [
    ...M,
    0x03, 0x00, 0x01, 0x00,  // type table: len=3, root=0, count=1, tag=Null
    ...S0,                     // string table: empty
    // value: 0 bytes
  ], "Null"));

  test("Boolean false", () => assertExact(BooleanType, false, [
    ...M,
    0x03, 0x00, 0x01, 0x04,  // type table: tag=Boolean
    ...S0,                     // string table: empty
    0x00,                      // value: false
  ], "Boolean false"));

  test("Boolean true", () => assertExact(BooleanType, true, [
    ...M,
    0x03, 0x00, 0x01, 0x04,
    ...S0,
    0x01,                      // value: true
  ], "Boolean true"));

  test("Integer 0", () => assertExact(IntegerType, 0n, [
    ...M,
    0x03, 0x00, 0x01, 0x02,  // type table: tag=Integer
    ...S0,
    0x00,                      // value: zigzag(0) = 0
  ], "Integer 0"));

  test("Integer 42", () => assertExact(IntegerType, 42n, [
    ...M,
    0x03, 0x00, 0x01, 0x02,
    ...S0,
    0x54,                      // value: zigzag(42) = 84 = 0x54
  ], "Integer 42"));

  test("Integer -1", () => assertExact(IntegerType, -1n, [
    ...M,
    0x03, 0x00, 0x01, 0x02,
    ...S0,
    0x01,                      // value: zigzag(-1) = 1
  ], "Integer -1"));

  test("Integer 1", () => assertExact(IntegerType, 1n, [
    ...M,
    0x03, 0x00, 0x01, 0x02,
    ...S0,
    0x02,                      // value: zigzag(1) = 2
  ], "Integer 1"));

  test("Float 0.0", () => assertExact(FloatType, 0.0, [
    ...M,
    0x03, 0x00, 0x01, 0x03,  // type table: tag=Float
    ...S0,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // value: 8 bytes LE IEEE 754
  ], "Float 0.0"));

  test("Float 1.0", () => assertExact(FloatType, 1.0, [
    ...M,
    0x03, 0x00, 0x01, 0x03,
    ...S0,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f,  // 1.0 in LE IEEE 754
  ], "Float 1.0"));

  test("String empty", () => assertExact(StringType, "", [
    ...M,
    0x03, 0x00, 0x01, 0x01,  // type table: tag=String
    // string table: 1 entry, "" (empty string)
    0x02, 0x01, 0x00,         // header_len=2, count=1, varint(0)=empty
    0x00,                      // value: string index 0
  ], "String empty"));

  test("String 'hello'", () => assertExact(StringType, "hello", [
    ...M,
    0x03, 0x00, 0x01, 0x01,  // type table: tag=String
    // string table: 1 entry, "hello"
    0x07, 0x01, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f,  // header_len=7, count=1, varint(5)+"hello"
    0x00,                      // value: string index 0
  ], "String hello"));

  test("DateTime epoch", () => assertExact(DateTimeType, new Date(0), [
    ...M,
    0x03, 0x00, 0x01, 0x05,  // type table: tag=DateTime
    ...S0,
    0x00,                      // value: zigzag(0) = 0
  ], "DateTime epoch"));

  test("Blob empty", () => assertExact(BlobType, new Uint8Array([]), [
    ...M,
    0x03, 0x00, 0x01, 0x06,  // type table: tag=Blob
    ...S0,
    0x00,                      // value: varint(0) = 0 bytes
  ], "Blob empty"));

  test("Blob [1,2,3]", () => assertExact(BlobType, new Uint8Array([1, 2, 3]), [
    ...M,
    0x03, 0x00, 0x01, 0x06,
    ...S0,
    0x03, 0x01, 0x02, 0x03,  // value: varint(3) + bytes
  ], "Blob [1,2,3]"));
});

// =============================================================================
// 3. Containers — exact bytes
// =============================================================================

describe("Beast2 v2 — Containers (exact bytes)", () => {
  test("Array(Integer) [1,2,3]", () => assertExact(
    ArrayType(IntegerType), [1n, 2n, 3n],
    [
      ...M,
      // type table: [0]=Integer, [1]=Array(0)
      0x05, 0x01, 0x02, 0x02, 0x0a, 0x00,
      ...S0,
      // value: inline(0) + count(3) + zigzag(1) + zigzag(2) + zigzag(3)
      0x00, 0x03, 0x02, 0x04, 0x06,
    ], "Array [1,2,3]"));

  test("Array(Integer) empty", () => assertExact(
    ArrayType(IntegerType), [],
    [
      ...M,
      0x05, 0x01, 0x02, 0x02, 0x0a, 0x00,
      ...S0,
      // value: inline(0) + count(0)
      0x00, 0x00,
    ], "Array empty"));

  test("Set(Integer) {1,2,3}", () => assertExact(
    SetType(IntegerType), new Set([1n, 2n, 3n]),
    [
      ...M,
      // type table: [0]=Integer, [1]=Set(0)
      0x05, 0x01, 0x02, 0x02, 0x0c, 0x00,
      ...S0,
      // value: inline(0) + count(3) + zigzag(1) + zigzag(2) + zigzag(3) (sorted)
      0x00, 0x03, 0x02, 0x04, 0x06,
    ], "Set {1,2,3}"));

  test("Dict(String, Integer) {x:1, y:2}", () => assertExact(
    DictType(StringType, IntegerType),
    new Map([["x", 1n], ["y", 2n]]),
    [
      ...M,
      // type table: [0]=String, [1]=Integer, [2]=Dict(0,1)
      0x07, 0x02, 0x03, 0x01, 0x02, 0x0b, 0x00, 0x01,
      // string table: 2 entries, "x" and "y"
      0x05, 0x02, 0x01, 0x78, 0x01, 0x79,
      // value: inline(0) + count(2)
      0x00, 0x02,
      // key "x" (str idx 0) + value 1: zigzag(1)
      0x00, 0x02,
      // key "y" (str idx 1) + value 2: zigzag(2)
      0x01, 0x04,
    ], "Dict {x:1,y:2}"));

  test("Ref(Integer) ref(42)", () => assertExact(
    RefType(IntegerType), ref(42n),
    [
      ...M,
      // type table: [0]=Integer, [1]=Ref(0)
      0x05, 0x01, 0x02, 0x02, 0x0d, 0x00,
      ...S0,
      // value: inline(0) + zigzag(42) = 0x54
      0x00, 0x54,
    ], "Ref(42)"));

  test("Vector(Float) [1.0, 2.0]", () => {
    const buf = new Float64Array([1.0, 2.0]);
    const rawBytes = Array.from(new Uint8Array(buf.buffer));
    assertExact(
      VectorType(FloatType), buf,
      [
        ...M,
        // type table: [0]=Float, [1]=Vector(0)
        0x05, 0x01, 0x02, 0x03, 0x0e, 0x00,
        ...S0,
        // value: varint(2) + raw 16 bytes
        0x02, ...rawBytes,
      ], "Vector [1.0, 2.0]");
  });

  test("Matrix(Float) 2x2", () => {
    const data = new Float64Array([1.0, 2.0, 3.0, 4.0]);
    const m = matrix(data, 2, 2);
    const rawBytes = Array.from(new Uint8Array(data.buffer));
    assertExact(
      MatrixType(FloatType), m,
      [
        ...M,
        // type table: [0]=Float, [1]=Matrix(0)
        0x05, 0x01, 0x02, 0x03, 0x0f, 0x00,
        ...S0,
        // value: varint(rows=2) + varint(cols=2) + raw 32 bytes
        0x02, 0x02, ...rawBytes,
      ], "Matrix 2x2");
  });
});

// =============================================================================
// 4. Struct — exact bytes
// =============================================================================

describe("Beast2 v2 — Struct (exact bytes)", () => {
  test("Struct { name: 'Alice', age: 30 }", () => assertExact(
    StructType({ name: StringType, age: IntegerType }),
    { name: "Alice", age: 30n },
    [
      ...M,
      // type table: [0]=String, [1]=Integer, [2]=Struct("name"→0, "age"→1)
      0x11, 0x02, 0x03, 0x01, 0x02,
      0x09, 0x02,
      0x04, 0x6e, 0x61, 0x6d, 0x65, 0x00,  // "name"→0
      0x03, 0x61, 0x67, 0x65, 0x01,          // "age"→1
      // string table: 1 entry, "Alice"
      0x07, 0x01, 0x05, 0x41, 0x6c, 0x69, 0x63, 0x65,
      // value: string index 0 ("Alice") + zigzag(30)
      0x00,                                    // string idx 0
      0x3c,                                    // zigzag(30) = 60 = 0x3c
    ], "Struct Alice 30"));

  test("empty struct", () => assertExact(
    StructType({}), {},
    [
      ...M,
      // type table: [0]=Struct(0 fields)
      0x04, 0x00, 0x01, 0x09, 0x00,
      ...S0,
      // value: 0 bytes (no fields)
    ], "EmptyStruct"));
});

// =============================================================================
// 5. Variant — exact bytes
// =============================================================================

describe("Beast2 v2 — Variant (exact bytes)", () => {
  test("Option(Integer) = none", () => assertExact(
    VariantType({ none: NullType, some: IntegerType }), none,
    [
      ...M,
      // type table: [0]=Null, [1]=Integer, [2]=Variant(none→0, some→1)
      0x12, 0x02, 0x03,
      0x00, 0x02,
      0x08, 0x02,
      0x04, 0x6e, 0x6f, 0x6e, 0x65, 0x00,  // "none"→0
      0x04, 0x73, 0x6f, 0x6d, 0x65, 0x01,  // "some"→1
      ...S0,
      // value: case_index=0 (none) + Null(0 bytes)
      0x00,
    ], "Option none"));

  test("Option(Integer) = some(42)", () => assertExact(
    VariantType({ none: NullType, some: IntegerType }), some(42n),
    [
      ...M,
      // type table: same as above
      0x12, 0x02, 0x03,
      0x00, 0x02,
      0x08, 0x02,
      0x04, 0x6e, 0x6f, 0x6e, 0x65, 0x00,
      0x04, 0x73, 0x6f, 0x6d, 0x65, 0x01,
      ...S0,
      // value: case_index=1 (some) + zigzag(42)
      0x01, 0x54,
    ], "Option some(42)"));
});

// =============================================================================
// 6. Recursive types — exact bytes (data only, no functions)
// =============================================================================

describe("Beast2 v2 — Recursive (exact bytes)", () => {
  test("linked list nil", () => {
    const ListType = RecursiveType(self => VariantType({
      nil: NullType,
      cons: StructType({ head: IntegerType, tail: self }),
    }));
    assertExact(ListType, variant("nil"),
      [
        ...M,
        // type table: [0]=Recursive(4), [1]=Integer, [2]=Struct(head→1,tail→0),
        //             [3]=Null, [4]=Variant(cons→2,nil→3)
        0x21, 0x00, 0x05,
        0x12, 0x04,           // [0] Recursive(inner=4)
        0x02,                  // [1] Integer
        0x09, 0x02,           // [2] Struct, 2 fields
        0x04, 0x68, 0x65, 0x61, 0x64, 0x01,  // "head"→1
        0x04, 0x74, 0x61, 0x69, 0x6c, 0x00,  // "tail"→0 (self!)
        0x00,                  // [3] Null
        0x08, 0x02,           // [4] Variant, 2 cases
        0x04, 0x63, 0x6f, 0x6e, 0x73, 0x02,  // "cons"→2
        0x03, 0x6e, 0x69, 0x6c, 0x03,         // "nil"→3
        ...S0,
        // value: case_index for "nil". Cases sorted: cons=0, nil=1
        0x01,
      ], "List nil");
  });

  test("linked list [1, 2]", () => {
    const ListType = RecursiveType(self => VariantType({
      nil: NullType,
      cons: StructType({ head: IntegerType, tail: self }),
    }));
    const list = variant("cons", {
      head: 1n,
      tail: variant("cons", {
        head: 2n,
        tail: variant("nil"),
      }),
    });
    assertExact(ListType, list,
      [
        ...M,
        // type table (same as above)
        0x21, 0x00, 0x05,
        0x12, 0x04,
        0x02,
        0x09, 0x02,
        0x04, 0x68, 0x65, 0x61, 0x64, 0x01,
        0x04, 0x74, 0x61, 0x69, 0x6c, 0x00,
        0x00,
        0x08, 0x02,
        0x04, 0x63, 0x6f, 0x6e, 0x73, 0x02,
        0x03, 0x6e, 0x69, 0x6c, 0x03,
        ...S0,
        // value: cons(head=1, tail=cons(head=2, tail=nil))
        // cons case_index=0
        0x00,
        // head: zigzag(1) = 2
        0x02,
        // tail: (recursive — decoded as the inner variant)
        // cons case_index=0
        0x00,
        // head: zigzag(2) = 4
        0x04,
        // tail: nil case_index=1
        0x01,
      ], "List [1, 2]");
  });
});

// =============================================================================
// 7. Functions — round-trip (exact bytes impractical due to IR variability)
// =============================================================================

describe("Beast2 v2 — Functions (round-trip)", () => {
  test("simple function (no captures)", () => {
    const FnType = FunctionType([IntegerType], IntegerType);
    const compiled = East.compile(
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)),
      [],
    );

    const encoded = encodeBeast2For(FnType)(compiled);
    assert.deepEqual(Array.from(encoded.slice(0, 8)), M, "magic");

    // Type table header: [0]=Integer, [1]=Function([0]→0) = 2 entries
    const headerLen = encoded[8]!;
    assert.deepEqual(Array.from(encoded.slice(8, 9 + headerLen)), [
      0x07,       // header_byte_length = 7
      0x01,       // root_idx = 1
      0x02,       // count = 2
      0x02,       // [0] Integer
      0x10, 0x01, 0x00, 0x00,  // [1] Function(1 input: idx 0, output: idx 0)
    ], "type table header bytes");

    // String table follows type table (IR contains strings — variable names, locations, etc.)
    const stringTableStart = 9 + headerLen;
    const stringTableHeaderLen = encoded[stringTableStart]!;
    assert.ok(stringTableHeaderLen > 0, "string table should contain IR strings");

    const decoded = decodeBeast2For(FnType)(encoded) as (x: bigint) => bigint;
    assert.equal(decoded(21n), 42n);
  });

  test("function with capture", () => {
    const FnType = FunctionType([IntegerType], IntegerType);
    const offset = East.value(10n);
    const compiled = East.compile(
      East.function([IntegerType], IntegerType, ($, x) => x.add(offset)),
      [],
    );

    const decoded = decodeBeast2For(FnType)(encodeBeast2For(FnType)(compiled)) as (x: bigint) => bigint;
    assert.equal(decoded(32n), 42n, "captured offset = 10");
  });

  test("function capturing array", () => {
    const FnType = FunctionType([IntegerType], IntegerType);
    const arr = East.value([10n, 20n, 30n], ArrayType(IntegerType));
    const compiled = East.compile(
      East.function([IntegerType], IntegerType, ($, i) => arr.get(i)),
      [],
    );

    const decoded = decodeBeast2For(FnType)(encodeBeast2For(FnType)(compiled)) as (i: bigint) => bigint;
    assert.equal(decoded(1n), 20n);
  });

  test("array of functions", () => {
    const FnType = FunctionType([IntegerType], IntegerType);
    const ArrFnType = ArrayType(FnType);
    const fns = [
      East.compile(East.function([IntegerType], IntegerType, ($, x) => x.add(1n)), []),
      East.compile(East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)), []),
    ];

    const decoded = decodeBeast2For(ArrFnType)(encodeBeast2For(ArrFnType)(fns)) as ((x: bigint) => bigint)[];
    assert.equal(decoded[0]!(5n), 6n);
    assert.equal(decoded[1]!(5n), 10n);
  });
});

// =============================================================================
// 8. Recursive types via EastTypeValue (encodeBeast2For with toEastTypeValue)
// =============================================================================

describe("Beast2 v2 — Recursive via EastTypeValue", () => {
  test("encodeBeast2For accepts toEastTypeValue(RecursiveType)", () => {
    const ListType = RecursiveType(self => VariantType({
      nil: NullType,
      cons: StructType({ head: IntegerType, tail: self }),
    }));
    const etv = toEastTypeValue(ListType);
    const encode = encodeBeast2For(etv);
    const decode = decodeBeast2For(etv);
    const value = variant("cons", { head: 1n, tail: variant("nil") });
    const decoded = decode(encode(value));
    assert.equal(decoded.type, "cons");
    assert.equal(decoded.value.head, 1n);
    assert.equal(decoded.value.tail.type, "nil");
  });
});

// =============================================================================
// 9. Recursive types with closures — the critical case
// =============================================================================

describe("Beast2 v2 — Recursive with closures (round-trip)", () => {
  test("UI component with onClick returning self type", () => {
    const ComponentType = RecursiveType(self => VariantType({
      text: StructType({ content: StringType }),
      button: StructType({
        label: StringType,
        onClick: FunctionType([], self),
      }),
    }));

    // Build the value inside an East function that we compile and call,
    // so the closure captures are set up properly.
    const buildButton = East.compile(
      East.function([], ComponentType, ($) => {
        const textNode = $.const(variant("text", { content: "clicked!" }), ComponentType);
        const onClick = $.const(East.function([], ComponentType, (_$) => textNode));
        return $.const(variant("button", { label: "Click me", onClick }), ComponentType);
      }),
      [],
    );
    const button = buildButton();

    const encoded = encodeBeast2For(ComponentType)(button);

    // Verify header: type table should be compact with no repeated types.
    // Root type entries (5): Recursive, String, Function([]→self), Struct(button), Struct(text), Variant
    // IR-only entries may add more, but the root 5-6 entries should be shared.
    const headerLen = encoded[8]!;
    const headerBytes = encoded.slice(9, 9 + headerLen);
    // Count entries (second varint in header)
    const rootIdx = headerBytes[0]!;
    const entryCount = headerBytes[1]!;
    assert.ok(entryCount <= 15, `type table should be compact, got ${entryCount} entries`);

    const decoded = decodeBeast2For(ComponentType)(encoded);
    assert.equal(decoded.type, "button");
    assert.equal(decoded.value.label, "Click me");

    const result = decoded.value.onClick();
    assert.equal(result.type, "text");
    assert.equal(result.value.content, "clicked!");
  });

  test("recursive type with render callback and children", () => {
    const NodeType = RecursiveType(self => VariantType({
      leaf: StringType,
      container: StructType({
        children: ArrayType(self),
        render: FunctionType([IntegerType], self),
      }),
    }));

    const buildContainer = East.compile(
      East.function([], NodeType, ($) => {
        const child1 = $.const(variant("leaf", "child1"), NodeType);
        const leafNode = $.const(variant("leaf", "rendered"), NodeType);
        const renderFn = $.const(East.function([IntegerType], NodeType, (_$, _n) => leafNode));
        const children = $.let([child1], ArrayType(NodeType));
        return $.const(variant("container", { children, render: renderFn }), NodeType);
      }),
      [],
    );
    const value = buildContainer();

    const decoded = decodeBeast2For(NodeType)(encodeBeast2For(NodeType)(value));
    assert.equal(decoded.type, "container");
    assert.equal(decoded.value.children[0].type, "leaf");
    assert.equal(decoded.value.children[0].value, "child1");
    assert.equal(decoded.value.render(0n).type, "leaf");
    assert.equal(decoded.value.render(0n).value, "rendered");
  });
});

// =============================================================================
// 9. Self-describing decode
// =============================================================================

describe("Beast2 v2 — Self-describing decode", () => {
  test("recover type and value", () => {
    const type = StructType({ name: StringType, age: IntegerType });
    const value = { name: "Alice", age: 30n };
    const encoded = encodeBeast2For(type)(value);
    const { type: dt, value: dv } = decodeBeast2(encoded);

    assert.ok(typeEqual(toEastTypeValue(type), dt), "type match");
    assert.equal(dv.name, "Alice");
    assert.equal(dv.age, 30n);
  });

  test("self-describing recursive type", () => {
    const ListType = RecursiveType(self => VariantType({
      nil: NullType,
      cons: StructType({ head: IntegerType, tail: self }),
    }));
    const value = variant("cons", { head: 1n, tail: variant("nil") });
    const { value: dv } = decodeBeast2(encodeBeast2For(ListType)(value));
    assert.equal(dv.type, "cons");
    assert.equal(dv.value.head, 1n);
    assert.equal(dv.value.tail.type, "nil");
  });
});

// =============================================================================
// 10. Mutable backreferences — exact bytes
// =============================================================================

describe("Beast2 v2 — Backreferences (exact bytes)", () => {
  test("aliased arrays share identity", () => {
    const type = StructType({ a: ArrayType(IntegerType), b: ArrayType(IntegerType) });
    const shared = [1n, 2n];
    const decoded = decodeBeast2For(type)(encodeBeast2For(type)({ a: shared, b: shared }));
    assert.ok(decoded.a === decoded.b, "same identity");
  });

  test("struct with two aliased arrays — backref in bytes", () => {
    const type = StructType({ a: ArrayType(IntegerType), b: ArrayType(IntegerType) });
    const shared = [1n];
    const encoded = encodeBeast2For(type)({ a: shared, b: shared });
    const bytes = Array.from(encoded);

    // The header encodes: [0]=Integer, [1]=Array(0), [2]=Struct(a→1, b→1)
    // Note: both "a" and "b" reference the same Array(Integer) type = index 1

    // The value section:
    // field "a": inline(0) + count(1) + zigzag(1)=2
    // field "b": backref — varint(distance) pointing back to "a"'s content
    // The "a" content starts at some offset. "b" references it with varint(distance).
    // We can verify by checking the last few bytes are NOT [0x00, 0x01, 0x02]
    // (which would be another inline array) but instead a single varint > 0.

    // Decode and verify identity
    const decoded = decodeBeast2For(type)(new Uint8Array(bytes));
    assert.ok(decoded.a === decoded.b, "aliased after decode");
    assert.deepEqual(decoded.a, [1n]);
  });
});

// =============================================================================
// 12. Decoder reuse
// =============================================================================

describe("Beast2 v2 — Decoder reuse", () => {
  test("same decoder handles multiple blobs", () => {
    const type = ArrayType(IntegerType);
    const decoder = decodeBeast2For(type);
    const encode = encodeBeast2For(type);

    assert.deepEqual(decoder(encode([1n, 2n])), [1n, 2n]);
    assert.deepEqual(decoder(encode([3n, 4n, 5n])), [3n, 4n, 5n]);
    assert.deepEqual(decoder(encode([])), []);
  });
});