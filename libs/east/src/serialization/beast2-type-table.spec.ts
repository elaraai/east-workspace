/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  NullType, BooleanType, IntegerType, FloatType, StringType, DateTimeType, BlobType,
  ArrayType, SetType, DictType, StructType, VariantType, RecursiveType,
  RefType, VectorType, MatrixType, FunctionType, AsyncFunctionType,
  type EastType,
} from "../types.js";
import { toEastTypeValue, type EastTypeValue, EastTypeValueType, isTypeValueEqual } from "../type_of_type.js";
import { BufferWriter, BufferReader } from "./binary-utils.js";
import { TypeTableBuilder, writeTypeTableSection, readTypeTableSection } from "./beast2-type-table.js";

/** Encode → write → read → decode, verify round-trip AND exact bytes. */
function assertRoundTrip(type: EastType, expectedBytes: number[], label: string) {
  const builder = new TypeTableBuilder();
  const rootIdx = builder.add(type);
  const writer = new BufferWriter();
  writeTypeTableSection(rootIdx, builder.entries, writer);
  const bytes = writer.toUint8Array();

  // Verify exact bytes
  assert.deepEqual(Array.from(bytes), expectedBytes, `${label}: bytes mismatch`);

  // Verify round-trip: decode then re-encode produces identical bytes
  const reader = new BufferReader(bytes);
  const { rootType, typeTable } = readTypeTableSection(reader);
  assert.equal(reader.offset, bytes.length, `${label}: not all bytes consumed`);
  // Re-encode the decoded type table via ETV path and verify bytes match
  const builder2 = new TypeTableBuilder();
  const rootIdx2 = builder2.add(rootType);
  const writer2 = new BufferWriter();
  writeTypeTableSection(rootIdx2, builder2.entries, writer2);
  assert.deepEqual(Array.from(writer2.toUint8Array()), expectedBytes, `${label}: round-trip bytes mismatch`);
}

describe("Beast2 Type Table", () => {

  // ===========================================================================
  // Primitives — each is 4 bytes: header_len(3) + root(0) + count(1) + tag
  // ===========================================================================

  describe("Primitives", () => {
    // Format: [header_len=3, root=0, count=1, tag]
    test("Null",     () => assertRoundTrip(NullType,     [0x03, 0x00, 0x01, 0x00], "Null"));
    test("String",   () => assertRoundTrip(StringType,   [0x03, 0x00, 0x01, 0x01], "String"));
    test("Integer",  () => assertRoundTrip(IntegerType,  [0x03, 0x00, 0x01, 0x02], "Integer"));
    test("Float",    () => assertRoundTrip(FloatType,    [0x03, 0x00, 0x01, 0x03], "Float"));
    test("Boolean",  () => assertRoundTrip(BooleanType,  [0x03, 0x00, 0x01, 0x04], "Boolean"));
    test("DateTime", () => assertRoundTrip(DateTimeType, [0x03, 0x00, 0x01, 0x05], "DateTime"));
    test("Blob",     () => assertRoundTrip(BlobType,     [0x03, 0x00, 0x01, 0x06], "Blob"));
  });

  // ===========================================================================
  // Single-parameter containers — [header_len, root=1, count=2, elem_tag, container_tag elem_idx=0]
  // ===========================================================================

  describe("Containers", () => {
    test("Array(Integer)", () => assertRoundTrip(ArrayType(IntegerType),
      // [0]=Integer, [1]=Array(0)
      [0x05, 0x01, 0x02, 0x02, 0x0a, 0x00], "Array(Integer)"));

    test("Array(String)", () => assertRoundTrip(ArrayType(StringType),
      [0x05, 0x01, 0x02, 0x01, 0x0a, 0x00], "Array(String)"));

    test("Set(Integer)", () => assertRoundTrip(SetType(IntegerType),
      // [0]=Integer, [1]=Set(0)
      [0x05, 0x01, 0x02, 0x02, 0x0c, 0x00], "Set(Integer)"));

    test("Ref(Boolean)", () => assertRoundTrip(RefType(BooleanType),
      [0x05, 0x01, 0x02, 0x04, 0x0d, 0x00], "Ref(Boolean)"));

    test("Vector(Float)", () => assertRoundTrip(VectorType(FloatType),
      [0x05, 0x01, 0x02, 0x03, 0x0e, 0x00], "Vector(Float)"));

    test("Vector(Integer)", () => assertRoundTrip(VectorType(IntegerType),
      [0x05, 0x01, 0x02, 0x02, 0x0e, 0x00], "Vector(Integer)"));

    test("Vector(Boolean)", () => assertRoundTrip(VectorType(BooleanType),
      [0x05, 0x01, 0x02, 0x04, 0x0e, 0x00], "Vector(Boolean)"));

    test("Matrix(Float)", () => assertRoundTrip(MatrixType(FloatType),
      [0x05, 0x01, 0x02, 0x03, 0x0f, 0x00], "Matrix(Float)"));

    test("Dict(String, Integer)", () => assertRoundTrip(DictType(StringType, IntegerType),
      // [0]=String, [1]=Integer, [2]=Dict(key=0, value=1)
      [0x07, 0x02, 0x03, 0x01, 0x02, 0x0b, 0x00, 0x01], "Dict(String,Integer)"));

    test("Dict(Integer, Array(String))", () => assertRoundTrip(
      DictType(IntegerType, ArrayType(StringType)),
      // [0]=Integer, [1]=String, [2]=Array(1), [3]=Dict(key=0, value=2)
      [0x09, 0x03, 0x04, 0x02, 0x01, 0x0a, 0x01, 0x0b, 0x00, 0x02],
      "Dict(Integer,Array(String))"));

    test("Dict(Struct, Integer)", () => assertRoundTrip(
      DictType(StructType({ x: FloatType, y: FloatType }), IntegerType),
      // [0]=Float, [1]=Struct(x→0, y→0) — Float deduped!, [2]=Integer, [3]=Dict(1,2)
      [0x0f, 0x03, 0x04, 0x03,
       0x09, 0x02, 0x01, 0x78, 0x00, 0x01, 0x79, 0x00,  // Struct: "x"→0, "y"→0
       0x02, 0x0b, 0x01, 0x02],
      "Dict(Struct,Integer)"));

    test("Set(Struct)", () => assertRoundTrip(
      SetType(StructType({ id: IntegerType, name: StringType })),
      // [0]=Integer, [1]=String, [2]=Struct(id→0, name→1), [3]=Set(2)
      [0x12, 0x03, 0x04, 0x02, 0x01,
       0x09, 0x02, 0x02, 0x69, 0x64, 0x00, 0x04, 0x6e, 0x61, 0x6d, 0x65, 0x01,
       0x0c, 0x02],
      "Set(Struct)"));
  });

  // ===========================================================================
  // Struct
  // ===========================================================================

  describe("Struct", () => {
    test("empty struct", () => assertRoundTrip(StructType({}),
      // [0]=Struct(0 fields)
      [0x04, 0x00, 0x01, 0x09, 0x00], "EmptyStruct"));

    test("simple struct", () => assertRoundTrip(
      StructType({ name: StringType, age: IntegerType }),
      // [0]=String, [1]=Integer, [2]=Struct("name"→0, "age"→1)
      [0x11, 0x02, 0x03, 0x01, 0x02,
       0x09, 0x02,
       0x04, 0x6e, 0x61, 0x6d, 0x65, 0x00,  // "name"→0
       0x03, 0x61, 0x67, 0x65, 0x01],         // "age"→1
      "SimpleStruct"));

    test("nested struct", () => assertRoundTrip(
      StructType({ label: StringType, point: StructType({ x: FloatType, y: FloatType }) }),
      // [0]=String, [1]=Float, [2]=Struct(x→1, y→1), [3]=Struct(label→0, point→2)
      [0x1c, 0x03, 0x04,
       0x01,                                                 // [0] String
       0x03,                                                 // [1] Float
       0x09, 0x02, 0x01, 0x78, 0x01, 0x01, 0x79, 0x01,     // [2] Struct: "x"→1, "y"→1
       0x09, 0x02, 0x05, 0x6c, 0x61, 0x62, 0x65, 0x6c, 0x00,  // [3] Struct: "label"→0
       0x05, 0x70, 0x6f, 0x69, 0x6e, 0x74, 0x02],               //           "point"→2
      "NestedStruct"));

    test("shared Option(String) dedup", () => {
      const OptionStr = VariantType({ none: NullType, some: StringType });
      assertRoundTrip(
        StructType({ a: OptionStr, b: OptionStr, c: OptionStr, d: OptionStr, e: OptionStr }),
        // [0]=Null, [1]=String, [2]=Variant(none→0, some→1), [3]=Struct(a→2,b→2,c→2,d→2,e→2)
        // Option variant defined ONCE, referenced 5 times by index 2
        [0x23, 0x03, 0x04,
         0x00,  // [0] Null
         0x01,  // [1] String
         0x08, 0x02, 0x04, 0x6e, 0x6f, 0x6e, 0x65, 0x00, 0x04, 0x73, 0x6f, 0x6d, 0x65, 0x01,  // [2] Variant
         0x09, 0x05,  // [3] Struct, 5 fields
         0x01, 0x61, 0x02,  // "a"→2
         0x01, 0x62, 0x02,  // "b"→2
         0x01, 0x63, 0x02,  // "c"→2
         0x01, 0x64, 0x02,  // "d"→2
         0x01, 0x65, 0x02], // "e"→2
        "SharedOptionDedup");

      // Verify only 4 entries (not 4 + 5 variants)
      const builder = new TypeTableBuilder();
      builder.add(StructType({ a: OptionStr, b: OptionStr, c: OptionStr, d: OptionStr, e: OptionStr }));
      assert.equal(builder.entries.length, 4, "4 unique types (Null, String, Option, Struct)");
    });
  });

  // ===========================================================================
  // Variant
  // ===========================================================================

  describe("Variant", () => {
    test("Option(Integer)", () => assertRoundTrip(
      VariantType({ none: NullType, some: IntegerType }),
      // [0]=Null, [1]=Integer, [2]=Variant("none"→0, "some"→1)
      [0x12, 0x02, 0x03, 0x00, 0x02,
       0x08, 0x02,
       0x04, 0x6e, 0x6f, 0x6e, 0x65, 0x00,  // "none"→0
       0x04, 0x73, 0x6f, 0x6d, 0x65, 0x01],  // "some"→1
      "Option(Integer)"));

    test("multi-case variant", () => assertRoundTrip(
      VariantType({ text: StringType, number: IntegerType, flag: BooleanType, nothing: NullType }),
      // Cases sorted alphabetically: flag, nothing, number, text
      // [0]=Boolean, [1]=Null, [2]=Integer, [3]=String, [4]=Variant
      [0x25, 0x04, 0x05,
       0x04, 0x00, 0x02, 0x01,  // [0]Boolean [1]Null [2]Integer [3]String
       0x08, 0x04,               // [4] Variant, 4 cases
       0x04, 0x66, 0x6c, 0x61, 0x67, 0x00,          // "flag"→0(Boolean)
       0x07, 0x6e, 0x6f, 0x74, 0x68, 0x69, 0x6e, 0x67, 0x01,  // "nothing"→1(Null)
       0x06, 0x6e, 0x75, 0x6d, 0x62, 0x65, 0x72, 0x02,  // "number"→2(Integer)
       0x04, 0x74, 0x65, 0x78, 0x74, 0x03],  // "text"→3(String)
      "MultiVariant"));

    test("nested variant", () => assertRoundTrip(
      VariantType({ leaf: NullType, node: StructType({ value: IntegerType }) }),
      // [0]=Null, [1]=Integer, [2]=Struct(value→1), [3]=Variant(leaf→0, node→2)
      [0x1b, 0x03, 0x04,
       0x00, 0x02,  // [0]Null [1]Integer
       0x09, 0x01, 0x05, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x01,  // [2]Struct: "value"→1
       0x08, 0x02,  // [3] Variant, 2 cases
       0x04, 0x6c, 0x65, 0x61, 0x66, 0x00,  // "leaf"→0
       0x04, 0x6e, 0x6f, 0x64, 0x65, 0x02], // "node"→2
      "NestedVariant"));
  });

  // ===========================================================================
  // Function types
  // ===========================================================================

  describe("Function", () => {
    test("Function([Integer], String)", () => assertRoundTrip(
      FunctionType([IntegerType], StringType),
      // [0]=Integer, [1]=String, [2]=Function(1 input: 0, output: 1)
      [0x08, 0x02, 0x03, 0x02, 0x01, 0x10, 0x01, 0x00, 0x01],
      "SimpleFunction"));

    test("Function([String,Integer,Float], Boolean)", () => assertRoundTrip(
      FunctionType([StringType, IntegerType, FloatType], BooleanType),
      // [0]=String, [1]=Integer, [2]=Float, [3]=Boolean, [4]=Function(3 inputs: 0,1,2, output: 3)
      [0x0c, 0x04, 0x05, 0x01, 0x02, 0x03, 0x04, 0x10, 0x03, 0x00, 0x01, 0x02, 0x03],
      "MultiArgFunction"));

    test("AsyncFunction([String], Integer)", () => assertRoundTrip(
      AsyncFunctionType([StringType], IntegerType),
      // [0]=String, [1]=Integer, [2]=AsyncFunction(1 input: 0, output: 1)
      [0x08, 0x02, 0x03, 0x01, 0x02, 0x11, 0x01, 0x00, 0x01],
      "AsyncFunction"));

    test("Function returning Function", () => assertRoundTrip(
      FunctionType([IntegerType], FunctionType([StringType], BooleanType)),
      // [0]=Integer, [1]=String, [2]=Boolean, [3]=Function([1]→2), [4]=Function([0]→3)
      [0x0d, 0x04, 0x05,
       0x02, 0x01, 0x04,  // [0]Integer [1]String [2]Boolean
       0x10, 0x01, 0x01, 0x02,  // [3] Function([String]→Boolean)
       0x10, 0x01, 0x00, 0x03], // [4] Function([Integer]→[3])
      "FnReturningFn"));
  });

  // ===========================================================================
  // Recursive types
  // ===========================================================================

  describe("Recursive", () => {
    test("linked list", () => assertRoundTrip(
      RecursiveType(self => VariantType({
        nil: NullType,
        cons: StructType({ head: IntegerType, tail: self }),
      })),
      // [0]=Recursive(inner=4), [1]=Integer, [2]=Struct(head→1, tail→0), [3]=Null, [4]=Variant
      [0x21, 0x00, 0x05,
       0x12, 0x04,  // [0] Recursive(inner=4)
       0x02,         // [1] Integer
       0x09, 0x02, 0x04, 0x68, 0x65, 0x61, 0x64, 0x01,  // [2] Struct: "head"→1
                     0x04, 0x74, 0x61, 0x69, 0x6c, 0x00,  //            "tail"→0 (self!)
       0x00,         // [3] Null
       0x08, 0x02, 0x04, 0x63, 0x6f, 0x6e, 0x73, 0x02,  // [4] Variant: "cons"→2
                     0x03, 0x6e, 0x69, 0x6c, 0x03],       //              "nil"→3
      "LinkedList"));

    test("binary tree", () => assertRoundTrip(
      RecursiveType(self => VariantType({
        leaf: IntegerType,
        branch: StructType({ left: self, right: self }),
      })),
      // [0]=Recursive(3), [1]=Struct(left→0, right→0) — both reference self
      // [2]=Integer, [3]=Variant(branch→1, leaf→2)
      [0x24, 0x00, 0x04,
       0x12, 0x03,  // [0] Recursive(inner=3)
       0x09, 0x02, 0x04, 0x6c, 0x65, 0x66, 0x74, 0x00,   // [1] Struct: "left"→0
                     0x05, 0x72, 0x69, 0x67, 0x68, 0x74, 0x00,  //    "right"→0
       0x02,         // [2] Integer
       0x08, 0x02, 0x06, 0x62, 0x72, 0x61, 0x6e, 0x63, 0x68, 0x01,  // [3] Variant: "branch"→1
                     0x04, 0x6c, 0x65, 0x61, 0x66, 0x02],              //              "leaf"→2
      "BinaryTree"));

    test("recursive with array", () => assertRoundTrip(
      RecursiveType(self => StructType({
        value: StringType,
        children: ArrayType(self),
      })),
      // [0]=Recursive(3), [1]=String, [2]=Array(0), [3]=Struct(value→1, children→2)
      [0x1a, 0x00, 0x04,
       0x12, 0x03,  // [0] Recursive(inner=3)
       0x01,         // [1] String
       0x0a, 0x00,   // [2] Array(0) — self ref
       0x09, 0x02, 0x05, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x01,        // [3] Struct: "value"→1
                     0x08, 0x63, 0x68, 0x69, 0x6c, 0x64, 0x72, 0x65, 0x6e, 0x02],  // "children"→2
      "RecursiveArray"));

    test("UI component with closures returning self — no repetition", () => {
      const type = RecursiveType(self => VariantType({
        text: StructType({ content: StringType }),
        button: StructType({
          label: StringType,
          onClick: FunctionType([], self),
        }),
        container: StructType({
          children: ArrayType(self),
          render: FunctionType([IntegerType], self),
        }),
      }));

      // 10 unique entries, String defined once, self-ref is index 0
      assertRoundTrip(type,
        [0x5b, 0x00, 0x0a,
         0x12, 0x09,  // [0] Recursive(inner=9)
         0x01,         // [1] String (shared by text.content and button.label)
         0x10, 0x00, 0x00,  // [2] Function([] → self[0]) — onClick
         0x09, 0x02, 0x05, 0x6c, 0x61, 0x62, 0x65, 0x6c, 0x01,  // [3] Struct: button
                       0x07, 0x6f, 0x6e, 0x43, 0x6c, 0x69, 0x63, 0x6b, 0x02,
         0x0a, 0x00,  // [4] Array(self[0]) — children
         0x02,         // [5] Integer — render input
         0x10, 0x01, 0x05, 0x00,  // [6] Function([Integer] → self[0]) — render
         0x09, 0x02, 0x08, 0x63, 0x68, 0x69, 0x6c, 0x64, 0x72, 0x65, 0x6e, 0x04,  // [7] Struct: container
                       0x06, 0x72, 0x65, 0x6e, 0x64, 0x65, 0x72, 0x06,
         0x09, 0x01, 0x07, 0x63, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74, 0x01,  // [8] Struct: text
         0x08, 0x03, 0x06, 0x62, 0x75, 0x74, 0x74, 0x6f, 0x6e, 0x03,  // [9] Variant: button→3
                       0x09, 0x63, 0x6f, 0x6e, 0x74, 0x61, 0x69, 0x6e, 0x65, 0x72, 0x07,  // container→7
                       0x04, 0x74, 0x65, 0x78, 0x74, 0x08],  // text→8
        "UIComponent");

      // Verify entry count
      const builder = new TypeTableBuilder();
      builder.add(type);
      assert.equal(builder.entries.length, 10, "10 unique types");

      // Verify no duplicate entries
      const seen = new Set<string>();
      for (const e of builder.entries) {
        const key = `${e.tag}:${Array.from(e.params).join(',')}`;
        assert.ok(!seen.has(key), `duplicate: tag=0x${e.tag.toString(16)}`);
        seen.add(key);
      }
    });

    test("JSON type (recursive with dict)", () => assertRoundTrip(
      RecursiveType(self => VariantType({
        null: NullType,
        boolean: BooleanType,
        number: FloatType,
        string: StringType,
        array: ArrayType(self),
        object: DictType(StringType, self),
      })),
      // 8 entries, String used for both "string" case and Dict key
      [0x3d, 0x00, 0x08,
       0x12, 0x07,  // [0] Recursive(inner=7)
       0x0a, 0x00,  // [1] Array(self[0])
       0x04,         // [2] Boolean
       0x00,         // [3] Null
       0x03,         // [4] Float
       0x01,         // [5] String (shared: "string" case type AND Dict key type)
       0x0b, 0x05, 0x00,  // [6] Dict(key=String[5], value=self[0])
       0x08, 0x06,  // [7] Variant, 6 cases (alphabetical)
       0x05, 0x61, 0x72, 0x72, 0x61, 0x79, 0x01,              // "array"→1
       0x07, 0x62, 0x6f, 0x6f, 0x6c, 0x65, 0x61, 0x6e, 0x02,  // "boolean"→2
       0x04, 0x6e, 0x75, 0x6c, 0x6c, 0x03,                     // "null"→3
       0x06, 0x6e, 0x75, 0x6d, 0x62, 0x65, 0x72, 0x04,         // "number"→4
       0x06, 0x6f, 0x62, 0x6a, 0x65, 0x63, 0x74, 0x06,         // "object"→6
       0x06, 0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0x05],        // "string"→5
      "JsonType"));
  });

  // ===========================================================================
  // Dedup verification
  // ===========================================================================

  describe("Dedup", () => {
    test("shared sub-types produce same index", () => {
      const optStr = VariantType({ none: NullType, some: StringType });
      const type = StructType({ a: optStr, b: optStr, c: optStr });
      const builder = new TypeTableBuilder();
      builder.add(type);
      assert.equal(builder.entries.length, 4, "Null, String, Option, Struct");
    });

    test("EastTypeValue dedup via addETV", () => {
      const builder = new TypeTableBuilder();
      builder.add(ArrayType(IntegerType));
      const etv = toEastTypeValue(IntegerType);
      const idx = builder.addETV(etv);
      assert.equal(builder.indexOf(etv), idx);
      assert.equal(builder.entries.length, 2, "Integer + Array(Integer)");
    });

    test("30 optional fields — 5 entries", () => {
      const OptionStr = VariantType({ none: NullType, some: StringType });
      const fields: Record<string, EastType> = {};
      for (let i = 0; i < 30; i++) fields[`f${String(i).padStart(2,'0')}`] = OptionStr;
      const builder = new TypeTableBuilder();
      builder.add(ArrayType(StructType(fields)));
      assert.equal(builder.entries.length, 5, "Null, String, Option, Struct, Array");
    });
  });

  // ===========================================================================
  // Header byte length / skip
  // ===========================================================================

  describe("Header skip", () => {
    test("skip matches full decode offset", () => {
      const type = StructType({ x: IntegerType, y: FloatType, z: ArrayType(StringType) });
      const builder = new TypeTableBuilder();
      const rootIdx = builder.add(type);
      const writer = new BufferWriter();
      writeTypeTableSection(rootIdx, builder.entries, writer);
      const bytes = writer.toUint8Array();

      const r1 = new BufferReader(bytes);
      readTypeTableSection(r1);

      const r2 = new BufferReader(bytes);
      r2.skip(r2.readVarint()); // skip header_byte_length

      assert.equal(r1.offset, r2.offset, "full decode and skip end at same offset");
      assert.equal(r1.offset, bytes.length, "consumed all bytes");
    });
  });
});
