/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A struct's fields in the order its type gives them, whatever their names
 * (east-workspace#1574). A plain object lists a name that is an array index —
 * `"10"`, `"2"` — before every other, in numeric order, so a struct with such
 * a field cannot be declared as an object without losing its order: it is
 * declared as a list, `StructType([[name, type], …])`, and its fields object
 * lists the names in that order. east-py and east-c keep a struct's fields in
 * a list; the compliance suite's "Variant case order" holds the runtimes to
 * one order together. A type value, which lists a struct's fields and a
 * variant's cases in order, is read as a type here too: a struct as listed,
 * and a variant refused when its cases are not in East's order.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  East, EastTypeOf, IntegerType, NeverType, NullType, PatchType, StringType, StructType, TypeUnion, TypeWiden,
  decodeBeast2For, encodeBeast2For, fromEastTypeValue, isTypeEqual, isValueOf, parseFor, parseInferred, printFor,
  printType, toEastTypeValue, variant, walkIR, type IR,
} from "./index.js";

/** A struct whose field names are integer-like, and one that is not, listed in that order. */
const Counts = StructType([["b", IntegerType], ["10", IntegerType], ["2", IntegerType]]);

/** {@link Counts}' fields, in its order. */
const COUNTS = ["b", "10", "2"];

/**
 * The fields of each struct literal in an IR, a list per literal, in the order
 * the IR holds them.
 *
 * @param ir - A function's IR
 * @returns Each literal's fields
 */
function literalFields(ir: IR): string[][] {
  const fields: string[][] = [];
  walkIR(ir, (node) => {
    if (node.type === "Struct") fields.push(node.value.fields.map((field) => field.name));
  });
  return fields;
}

describe("StructType's fields", () => {
  test("are listed in the order given, whatever their names", () => {
    assert.deepEqual(Object.keys(Counts.fields), COUNTS);
    assert.deepEqual(Object.entries(Counts.fields).map(([name]) => name), COUNTS);
    const names: string[] = [];
    for (const name in Counts.fields) names.push(name);
    assert.deepEqual(names, COUNTS);
    assert.equal(Counts.fields["10"], IntegerType);
  });

  test("are listed so by its type value and its printed type", () => {
    const value = toEastTypeValue(Counts);
    assert.ok(value.type === "Struct");
    assert.deepEqual(value.value.map((field) => field.name), COUNTS);
    assert.equal(printType(Counts), '.Struct [(name="b", type=.Integer), (name="10", type=.Integer), (name="2", type=.Integer)]');
  });

  test("make one type of one list, another of another order, and the object form's type of names an object keeps", () => {
    assert.equal(StructType([["b", IntegerType], ["10", IntegerType], ["2", IntegerType]]), Counts);
    const Other = StructType([["10", IntegerType], ["b", IntegerType], ["2", IntegerType]]);
    assert.notEqual(Other, Counts);
    assert.equal(isTypeEqual(Other, Counts), false);
    assert.equal(StructType([["a", IntegerType], ["b", StringType]]), StructType({ a: IntegerType, b: StringType }));
  });

  test("given as an object, refuse a field named like an array index, whose order the object loses", () => {
    assert.throws(() => StructType({ b: IntegerType, "10": IntegerType }),
      /StructType cannot take its fields as an object when one is named like an array index \("10"\)/);
    // Names that only look like one are kept in the order written.
    assert.deepEqual(Object.keys(StructType({ b: IntegerType, "007": IntegerType, "-1": IntegerType, "1.5": IntegerType, "4294967295": IntegerType }).fields),
      ["b", "007", "-1", "1.5", "4294967295"]);
  });

  test("as a list, refuse a field listed twice", () => {
    assert.throws(() => StructType([["a", IntegerType], ["a", StringType]]), /StructType lists the field "a" twice/);
  });

  test("keep their order through a union and a widening", () => {
    const Narrow = StructType([["b", IntegerType], ["10", NeverType], ["2", IntegerType]]);
    assert.equal(TypeUnion(Narrow, Counts), Counts);
    assert.equal(TypeWiden(Counts, Counts), Counts);
  });

  test("hold a value of it by name, and its codecs read and write it in the struct's order", () => {
    const value = { b: 1n, "10": 2n, "2": 3n };
    assert.ok(isValueOf(value, Counts));
    assert.equal(isValueOf({ b: 1n, "10": 2n }, Counts), false);
    assert.deepEqual(decodeBeast2For(Counts)(encodeBeast2For(Counts)(value)), value);
    assert.equal(printFor(Counts)(value), "(b=1, `10`=2, `2`=3)");
    assert.deepEqual(parseFor(Counts)("(b=1, `10`=2, `2`=3)"), { success: true, value, position: 20 });
  });

  test("are a struct literal's, in the struct's order, in East code", () => {
    const bump = East.function([Counts], Counts, ($, counts) => East.value({ b: counts.b, "10": counts["10"].add(1n), "2": counts["2"] }, Counts));
    assert.deepEqual(literalFields(bump.toIR().ir), [COUNTS]);
    assert.deepEqual(East.compile(bump, [])({ b: 1n, "10": 2n, "2": 3n }), { b: 1n, "10": 3n, "2": 3n });
  });

  test("are its patch type's, in the struct's order", () => {
    assert.match(printType(PatchType(Counts)),
      /\(name="patch", type=\.Struct \[\(name="b", .*\), \(name="10", .*\), \(name="2", .*\)\]\)/);
  });

  test("are inferred from East text in the order the text gives them", () => {
    const [type, value] = parseInferred("(b=1, `10`=2, `2`=3)");
    assert.equal(type, Counts);
    assert.deepEqual(value, { b: 1n, "10": 2n, "2": 3n });
  });

  test("are not inferred from a value with a field named like an array index", () => {
    assert.throws(() => EastTypeOf({ b: 1n, "10": 2n }),
      /Cannot infer the East type of a struct value with a field named like an array index \("10"\)/);
  });
});

describe("a type value read as a type", () => {
  test("keeps a struct's fields in the order listed", () => {
    assert.equal(fromEastTypeValue(toEastTypeValue(Counts)), Counts);
  });

  test("refuses a variant whose cases are not in East's order, as a TypeScript East before #1574 wrote one", () => {
    const old = variant("Variant", [{ name: "50", type: variant("Null", null) }, { name: "100", type: variant("Null", null) }]);
    assert.throws(() => fromEastTypeValue(old), /the variant type lists its case "100" after "50", out of East's order/);
    const twice = variant("Variant", [{ name: "a", type: variant("Null", null) }, { name: "a", type: variant("Null", null) }]);
    assert.throws(() => fromEastTypeValue(twice), /the variant type lists its case "a" twice/);
  });

  test("reads a variant whose cases are in East's order as the type that writes it", () => {
    const value = variant("Variant", [{ name: "100", type: variant("Null", null) }, { name: "50", type: variant("Null", null) }]);
    const type = fromEastTypeValue(value);
    assert.ok(type.type === "Variant");
    assert.deepEqual(Object.keys(type.cases), ["100", "50"]);
    assert.equal(type.cases["50"], NullType);
  });
});
