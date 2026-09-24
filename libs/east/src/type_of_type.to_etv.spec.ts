/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toEastTypeValue, EastTypeValueType, canonicalTypeValue, isTypeValueEqual, type EastTypeValue } from "./type_of_type.js";
import { variant } from "./containers/variant.js";
import { equalFor } from "./comparison.js";
import {
  NullType, BooleanType, IntegerType, FloatType, StringType, DateTimeType, BlobType,
  ArrayType, SetType, DictType, StructType, VariantType, RefType,
  FunctionType, AsyncFunctionType, RecursiveType, VectorType, MatrixType,
} from "./types.js";

const typeEqual = equalFor(EastTypeValueType);

describe("toEastTypeValue", () => {

  // =========================================================================
  // Primitives — correct variant case and caching
  // =========================================================================

  describe("primitives", () => {
    it("Null produces variant('Null', null)", () => {
      const etv = toEastTypeValue(NullType);
      assert.equal(etv.type, "Null");
      assert.equal(etv.value, null);
    });

    it("Integer produces variant('Integer', null)", () => {
      const etv = toEastTypeValue(IntegerType);
      assert.equal(etv.type, "Integer");
    });

    it("primitives are cached — same object on repeated calls", () => {
      assert.equal(toEastTypeValue(NullType), toEastTypeValue(NullType));
      assert.equal(toEastTypeValue(IntegerType), toEastTypeValue(IntegerType));
      assert.equal(toEastTypeValue(StringType), toEastTypeValue(StringType));
      assert.equal(toEastTypeValue(FloatType), toEastTypeValue(FloatType));
      assert.equal(toEastTypeValue(BooleanType), toEastTypeValue(BooleanType));
      assert.equal(toEastTypeValue(DateTimeType), toEastTypeValue(DateTimeType));
      assert.equal(toEastTypeValue(BlobType), toEastTypeValue(BlobType));
    });
  });

  // =========================================================================
  // Containers — structure and sub-type identity sharing
  // =========================================================================

  describe("containers", () => {
    it("Array(Integer) inner shares identity with toEastTypeValue(Integer)", () => {
      const arrETV = toEastTypeValue(ArrayType(IntegerType));
      assert.equal(arrETV.type, "Array");
      assert.equal(arrETV.value, toEastTypeValue(IntegerType),
        "Array element should be same object as cached IntegerType ETV");
    });

    it("Set(String) inner shares identity", () => {
      const setETV = toEastTypeValue(SetType(StringType));
      assert.equal(setETV.value, toEastTypeValue(StringType));
    });

    it("Dict(String, Integer) key and value share identity", () => {
      const dictETV = toEastTypeValue(DictType(StringType, IntegerType));
      assert.equal(dictETV.value.key, toEastTypeValue(StringType));
      assert.equal(dictETV.value.value, toEastTypeValue(IntegerType));
    });

    it("Ref(Boolean) inner shares identity", () => {
      const refETV = toEastTypeValue(RefType(BooleanType));
      assert.equal(refETV.value, toEastTypeValue(BooleanType));
    });

    it("Vector(Float) inner shares identity", () => {
      const vecETV = toEastTypeValue(VectorType(FloatType));
      assert.equal(vecETV.value, toEastTypeValue(FloatType));
    });

    it("Matrix(Integer) inner shares identity", () => {
      const matETV = toEastTypeValue(MatrixType(IntegerType));
      assert.equal(matETV.value, toEastTypeValue(IntegerType));
    });
  });

  // =========================================================================
  // Struct — field order and sub-type identity
  // =========================================================================

  describe("struct", () => {
    it("preserves field definition order", () => {
      const structETV = toEastTypeValue(StructType({ name: StringType, age: IntegerType }));
      assert.equal(structETV.type, "Struct");
      const fields = structETV.value as { name: string; type: any }[];
      assert.equal(fields[0]!.name, "name");
      assert.equal(fields[1]!.name, "age");
    });

    it("field types share identity with cached primitives", () => {
      const structETV = toEastTypeValue(StructType({ name: StringType, age: IntegerType }));
      const fields = structETV.value as { name: string; type: any }[];
      assert.equal(fields[0]!.type, toEastTypeValue(StringType));
      assert.equal(fields[1]!.type, toEastTypeValue(IntegerType));
    });
  });

  // =========================================================================
  // Variant — case order and sub-type identity
  // =========================================================================

  describe("variant", () => {
    it("cases are alphabetically sorted", () => {
      const varETV = toEastTypeValue(VariantType({ zebra: NullType, alpha: IntegerType }));
      const cases = varETV.value as { name: string; type: any }[];
      assert.equal(cases[0]!.name, "alpha");
      assert.equal(cases[1]!.name, "zebra");
    });

    it("case types share identity with cached primitives", () => {
      const varETV = toEastTypeValue(VariantType({ none: NullType, some: IntegerType }));
      const cases = varETV.value as { name: string; type: any }[];
      assert.equal(cases[0]!.type, toEastTypeValue(NullType));
      assert.equal(cases[1]!.type, toEastTypeValue(IntegerType));
    });
  });

  // =========================================================================
  // Function — input/output identity sharing
  // =========================================================================

  describe("function", () => {
    it("Function([Integer], String) has correct structure", () => {
      const fnETV = toEastTypeValue(FunctionType([IntegerType], StringType));
      assert.equal(fnETV.type, "Function");
      assert.equal(fnETV.value.inputs.length, 1);
      assert.equal(fnETV.value.output.type, "String");
    });

    it("Function input types share identity with cached primitives", () => {
      const fnETV = toEastTypeValue(FunctionType([IntegerType, StringType], BooleanType));
      assert.equal(fnETV.value.inputs[0], toEastTypeValue(IntegerType),
        "input[0] should be same object as cached IntegerType ETV");
      assert.equal(fnETV.value.inputs[1], toEastTypeValue(StringType),
        "input[1] should be same object as cached StringType ETV");
      assert.equal(fnETV.value.output, toEastTypeValue(BooleanType),
        "output should be same object as cached BooleanType ETV");
    });

    it("AsyncFunction input types share identity", () => {
      const fnETV = toEastTypeValue(AsyncFunctionType([StringType], IntegerType));
      assert.equal(fnETV.type, "AsyncFunction");
      assert.equal(fnETV.value.inputs[0], toEastTypeValue(StringType));
      assert.equal(fnETV.value.output, toEastTypeValue(IntegerType));
    });
  });

  // =========================================================================
  // Recursive — structure and self-reference depth
  // =========================================================================

  describe("recursive", () => {
    it("linked list produces Recursive wrapper with inner Variant", () => {
      const listType = RecursiveType(self => VariantType({
        nil: NullType,
        cons: StructType({ head: IntegerType, tail: self }),
      }));
      const etv = toEastTypeValue(listType);
      // RecursiveType produces: Recursive(wrapper({ id, inner: Variant }))
      assert.equal(etv.type, "Recursive");
      assert.equal(etv.value.type, "wrapper");
      const inner = etv.value.value.inner;
      assert.equal(inner.type, "Variant");
      const cases = inner.value as { name: string; type: any }[];
      // Cases sorted: cons, nil
      assert.equal(cases[0]!.name, "cons");
      const consFields = cases[0]!.type.value as { name: string; type: any }[];
      const tailField = consFields.find((f: any) => f.name === "tail")!;
      assert.equal(tailField.type.type, "Recursive");
      assert.equal(tailField.type.value.type, "ref");
      // ref value = type_id of the RecursiveType
      assert.equal(tailField.type.value.value, etv.value.value.id);
    });

    it("recursive type primitives share identity with cached singletons", () => {
      const listType = RecursiveType(self => VariantType({
        nil: NullType,
        cons: StructType({ head: IntegerType, tail: self }),
      }));
      const etv = toEastTypeValue(listType);
      const inner = etv.value.value.inner; // unwrap Recursive(wrapper({id, inner}))
      const cases = inner.value as { name: string; type: any }[];
      const nilCase = cases.find((c: any) => c.name === "nil")!;
      assert.equal(nilCase.type, toEastTypeValue(NullType),
        "nil case type should be same object as cached NullType ETV");
      // head field type should be the cached IntegerType ETV
      const consCase = cases.find((c: any) => c.name === "cons")!;
      const headField = (consCase.type.value as any[]).find((f: any) => f.name === "head")!;
      assert.equal(headField.type, toEastTypeValue(IntegerType),
        "head type should be same object as cached IntegerType ETV");
    });

    it("recursive with function returning self", () => {
      const compType = RecursiveType(self => VariantType({
        text: StringType,
        button: StructType({
          label: StringType,
          onClick: FunctionType([], self),
        }),
      }));
      const etv = toEastTypeValue(compType);
      assert.equal(etv.type, "Recursive");
      assert.equal(etv.value.type, "wrapper");
      const inner = etv.value.value.inner;
      assert.equal(inner.type, "Variant");
      // button case → Struct → onClick → Function([], Recursive(ref))
      const cases = inner.value as { name: string; type: any }[];
      const buttonCase = cases.find((c: any) => c.name === "button")!;
      const fields = buttonCase.type.value as { name: string; type: any }[];
      const onClickField = fields.find((f: any) => f.name === "onClick")!;
      assert.equal(onClickField.type.type, "Function");
      assert.equal(onClickField.type.value.output.type, "Recursive");
    });
  });

  // =========================================================================
  // Structural equality — same structure, same result
  // =========================================================================

  describe("structural equality", () => {
    it("toEastTypeValue produces structurally equal results for equal types", () => {
      const a = toEastTypeValue(ArrayType(IntegerType));
      const b = toEastTypeValue(ArrayType(IntegerType));
      assert.ok(typeEqual(a, b), "structurally equal");
    });

    it("recursive types produce structurally equal results", () => {
      const list1 = RecursiveType(self => VariantType({ nil: NullType, cons: StructType({ head: IntegerType, tail: self }) }));
      const list2 = RecursiveType(self => VariantType({ nil: NullType, cons: StructType({ head: IntegerType, tail: self }) }));
      assert.ok(typeEqual(toEastTypeValue(list1), toEastTypeValue(list2)));
    });
  });

  // =========================================================================
  // Alpha-equivalence — wrapper ids are runtime artefacts (type ids here,
  // table indices off the wire), so recursive types compare up to naming
  // =========================================================================

  describe("isTypeValueEqual up to wrapper naming (#770)", () => {
    // A hand-spelled recursive type value, as a decoder produces it: the
    // wrapper's id is whatever the wire said, never this process's type id.
    const list = (id: bigint) => variant("Recursive", variant("wrapper", {
      id,
      inner: variant("Variant", [
        { name: "cons", type: variant("Struct", [
          { name: "head", type: variant("Integer", null) },
          { name: "tail", type: variant("Recursive", variant("ref", id)) },
        ]) },
        { name: "nil", type: variant("Null", null) },
      ]),
    })) as EastTypeValue;

    it("two wrappers of one structure with different ids are equal", () => {
      assert.ok(isTypeValueEqual(list(3n), list(11n)));
      assert.ok(isTypeValueEqual(list(11n), list(3n)));
    });

    it("a decoded wrapper equals the type it was built from", () => {
      const ListType = RecursiveType(self => VariantType({
        nil: NullType,
        cons: StructType({ head: IntegerType, tail: self }),
      }));
      assert.ok(isTypeValueEqual(toEastTypeValue(ListType), list(0n)));
      assert.ok(isTypeValueEqual(list(0n), toEastTypeValue(ListType)));
    });

    it("bodies that differ are not equal, whatever the ids", () => {
      // (One id names one type within a type value — a wrapper's id is only
      // ever compared against another id, never re-derived from its body —
      // so a differing body gets an id of its own here.)
      const other = variant("Recursive", variant("wrapper", {
        id: 7n,
        inner: variant("Variant", [
          { name: "cons", type: variant("Struct", [
            { name: "head", type: variant("String", null) },
            { name: "tail", type: variant("Recursive", variant("ref", 7n)) },
          ]) },
          { name: "nil", type: variant("Null", null) },
        ]),
      })) as EastTypeValue;
      assert.ok(!isTypeValueEqual(list(3n), other), "head types differ");
      assert.ok(!isTypeValueEqual(other, list(11n)));
    });

    it("refs are equal only to their own wrapper's scope", () => {
      const refA = variant("Recursive", variant("ref", 3n)) as EastTypeValue;
      const refB = variant("Recursive", variant("ref", 11n)) as EastTypeValue;
      assert.ok(isTypeValueEqual(refA, variant("Recursive", variant("ref", 3n)) as EastTypeValue));
      assert.ok(!isTypeValueEqual(refA, refB), "unpaired refs of different ids are different scopes");
      assert.ok(isTypeValueEqual(refA, list(3n)), "a ref equals its wrapper");
      assert.ok(!isTypeValueEqual(refB, list(3n)));
    });

    it("nested wrappers pair up scope by scope", () => {
      const tree = (outer: bigint, inner: bigint) => variant("Recursive", variant("wrapper", {
        id: outer,
        inner: variant("Struct", [
          { name: "items", type: list(inner) },
          { name: "kids", type: variant("Array", variant("Recursive", variant("ref", outer))) },
        ]),
      })) as EastTypeValue;
      assert.ok(isTypeValueEqual(tree(1n, 2n), tree(20n, 10n)));
      // Swapping which wrapper a ref names changes the type.
      const crossed = variant("Recursive", variant("wrapper", {
        id: 5n,
        inner: variant("Struct", [
          { name: "items", type: list(2n) },
          { name: "kids", type: variant("Array", variant("Recursive", variant("ref", 2n))) },
        ]),
      })) as EastTypeValue;
      assert.ok(!isTypeValueEqual(tree(1n, 2n), crossed));
    });
  });

  // =========================================================================
  // Cross-context consistency — inner types converted independently must
  // match the inner types extracted from the enclosing RecursiveType wrapper
  // =========================================================================

  describe("cross-context consistency", () => {
    it("inner Variant converted independently matches wrapper's inner", () => {
      const ListType = RecursiveType(self => VariantType({
        nil: NullType,
        cons: StructType({ head: BooleanType, tail: self }),
      }));
      const listETV = toEastTypeValue(ListType);
      const wrapperInner = (listETV.value as any).value.inner; // Variant from wrapper

      // Convert the inner Variant independently (this is what ast_to_ir does)
      const innerETV = toEastTypeValue(ListType.node);

      assert.ok(isTypeValueEqual(wrapperInner, innerETV),
        "inner Variant from wrapper must equal independently converted inner Variant");
    });

    it("inner Struct (grandchild) converted independently matches wrapper's inner struct", () => {
      const ListType = RecursiveType(self => VariantType({
        nil: NullType,
        cons: StructType({ head: BooleanType, tail: self }),
      }));
      const ConsStruct = ListType.node.cases.cons;

      const listETV = toEastTypeValue(ListType);
      const wrapperInner = (listETV.value as any).value.inner; // Variant
      const wrapperConsStruct = wrapperInner.value.find((c: any) => c.name === "cons").type;

      // Convert ConsStruct independently (this is what ast_to_ir does for struct nodes)
      const consETV = toEastTypeValue(ConsStruct);

      assert.ok(isTypeValueEqual(wrapperConsStruct, consETV),
        "ConsStruct from wrapper must equal independently converted ConsStruct");
    });

    it("tail field type matches between wrapper-extracted and independently-converted struct", () => {
      const ListType = RecursiveType(self => VariantType({
        nil: NullType,
        cons: StructType({ head: BooleanType, tail: self }),
      }));
      const ConsStruct = ListType.node.cases.cons;

      // Convert ConsStruct independently
      const consETV = toEastTypeValue(ConsStruct);
      const tailField = consETV.value.find((f: any) => f.name === "tail");

      // The tail field type should be the full Recursive wrapper, not a bare ref
      assert.equal(tailField.type.type, "Recursive");
      assert.equal((tailField.type.value as any).type, "wrapper",
        "tail must be wrapper (not ref) when converted outside the Recursive scope");
    });

    it("WrapRecursive inner type equals value expression type at self-ref positions", () => {
      // This reproduces the exact analyze.ts WrapRecursive check failure
      const ListType = RecursiveType(self => VariantType({
        nil: NullType,
        cons: StructType({ head: BooleanType, tail: self }),
      }));
      const ConsStruct = ListType.node.cases.cons;

      // WrapRecursive node type = toEastTypeValue(ListType) → wrapper({id, inner})
      const wrapETV = toEastTypeValue(ListType);
      const expectedType = (wrapETV.value as any).value.inner; // the inner Variant

      // Value expression type: the Struct converted independently
      const consETV = toEastTypeValue(ConsStruct);
      // The tail field of consETV should match the tail field of expectedType's cons case
      const actualTail = consETV.value.find((f: any) => f.name === "tail").type;
      const expectedCons = expectedType.value.find((c: any) => c.name === "cons");
      const expectedTail = expectedCons.type.value.find((f: any) => f.name === "tail").type;

      assert.ok(isTypeValueEqual(actualTail, expectedTail),
        `tail types must match: actual=${actualTail.type}(${(actualTail.value as any)?.type}) vs expected=${expectedTail.type}(${(expectedTail.value as any)?.type})`);
    });
  });
});

// A type value stored as data — a segment manifest's collection type — is
// renamed canonically first, so its bytes are the same whichever runtime, and
// whichever process, built the type. `typeEqual` compares the ids as data.
describe("canonicalTypeValue", () => {
  it("numbers wrappers in preorder from 0 and renames each ref with its wrapper", () => {
    const nested = variant("Recursive", variant("wrapper", {
      id: 20n,
      inner: variant("Struct", [
        { name: "items", type: variant("Recursive", variant("wrapper", {
          id: 10n,
          inner: variant("Array", variant("Recursive", variant("ref", 10n))),
        })) },
        { name: "kids", type: variant("Array", variant("Recursive", variant("ref", 20n))) },
      ]),
    })) as EastTypeValue;
    const canonical = variant("Recursive", variant("wrapper", {
      id: 0n,
      inner: variant("Struct", [
        { name: "items", type: variant("Recursive", variant("wrapper", {
          id: 1n,
          inner: variant("Array", variant("Recursive", variant("ref", 1n))),
        })) },
        { name: "kids", type: variant("Array", variant("Recursive", variant("ref", 0n))) },
      ]),
    })) as EastTypeValue;
    assert.ok(typeEqual(canonicalTypeValue(nested), canonical));
    assert.ok(isTypeValueEqual(canonicalTypeValue(nested), nested), "the type is kept");
  });

  it("renames a ref by the innermost wrapper of its id", () => {
    const shadowed = variant("Recursive", variant("wrapper", {
      id: 5n,
      inner: variant("Struct", [
        { name: "a", type: variant("Recursive", variant("wrapper", { id: 5n, inner: variant("Array", variant("Recursive", variant("ref", 5n))) })) },
        { name: "b", type: variant("Recursive", variant("ref", 5n)) },
      ]),
    })) as EastTypeValue;
    const canonical = variant("Recursive", variant("wrapper", {
      id: 0n,
      inner: variant("Struct", [
        { name: "a", type: variant("Recursive", variant("wrapper", { id: 1n, inner: variant("Array", variant("Recursive", variant("ref", 1n))) })) },
        { name: "b", type: variant("Recursive", variant("ref", 0n)) },
      ]),
    })) as EastTypeValue;
    assert.ok(typeEqual(canonicalTypeValue(shadowed), canonical));
  });

  it("is the same for a type whatever ids it was built with", () => {
    const ListType = RecursiveType(self => VariantType({
      nil: NullType,
      cons: StructType({ head: IntegerType, tail: self }),
    }));
    const decoded = variant("Recursive", variant("wrapper", {
      id: 99n,
      inner: variant("Variant", [
        { name: "cons", type: variant("Struct", [
          { name: "head", type: variant("Integer", null) },
          { name: "tail", type: variant("Recursive", variant("ref", 99n)) },
        ]) },
        { name: "nil", type: variant("Null", null) },
      ]),
    })) as EastTypeValue;
    assert.ok(!typeEqual(toEastTypeValue(ListType), decoded), "the builders' ids differ");
    assert.ok(typeEqual(canonicalTypeValue(toEastTypeValue(ListType)), canonicalTypeValue(decoded)));
  });

  it("leaves a type without recursion as it was", () => {
    const type = toEastTypeValue(DictType(StringType, StructType({ xs: ArrayType(IntegerType), f: FunctionType([FloatType], BooleanType) })));
    assert.ok(typeEqual(canonicalTypeValue(type), type));
  });
});
