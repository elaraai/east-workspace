/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A variant's cases in East's order (east-workspace#1574). A plain object
 * lists a name that is an array index — `"50"`, `"100"` — before every other,
 * in numeric order; a variant type's cases object lists its names in East's
 * order instead, so `Object.keys` over it gives what `variantCases` does.
 * Everything TypeScript writes of a variant lists its cases as their names
 * sort, as every runtime does: its type value, and so the beast2 it writes,
 * its printed type, its default, and the arms of a match on it. The
 * compliance suite's "Variant case order" holds the runtimes to it together.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  East, IntegerType, NullType, StringType, VariantType,
  decodeBeastFor, defaultValue, encodeBeastFor, equalFor, printType, printTypeSummary, toEastTypeValue, variant,
  variantCases, walkIR, type IR,
} from "./index.js";

/** east-ui's shades, as its ColorTokenType names them: integer-like cases, and one that is not. */
const Shade = VariantType({ "50": NullType, "100": NullType, "300": NullType, "400": NullType, a: IntegerType });

/** {@link Shade}'s cases, as their names sort. */
const SHADES = ["100", "300", "400", "50", "a"];

/**
 * The cases the arms of each match in an IR are for, a list per match, in the
 * order the IR holds them.
 *
 * @param ir - A function's IR
 * @returns Each match's cases
 */
function matchArms(ir: IR): string[][] {
  const arms: string[][] = [];
  walkIR(ir, (node) => {
    if (node.type === "Match") arms.push(node.value.cases.map((arm) => arm.case));
  });
  return arms;
}

describe("variantCases", () => {
  test("lists a variant's cases as their names sort", () => {
    assert.deepEqual(variantCases(Shade).map(([name]) => name), SHADES);
    assert.equal(variantCases(Shade)[4]![1], IntegerType);
  });

  test("its cases object lists them so too, where a plain object would list the integer-like names first", () => {
    assert.deepEqual(Object.keys({ "50": 0, "100": 0, "300": 0, "400": 0, a: 0 }), ["50", "100", "300", "400", "a"]);
    assert.deepEqual(Object.keys(Shade.cases), SHADES);
    assert.deepEqual(Object.entries(Shade.cases).map(([name]) => name), SHADES);
    const names: string[] = [];
    for (const name in Shade.cases) names.push(name);
    assert.deepEqual(names, SHADES);
    assert.equal(Shade.cases.a, IntegerType);
    assert.equal(Shade.cases["50"], NullType);
  });

  test("sorts names by code point, as east-c and east-py compare strings", () => {
    // By UTF-16 code unit 𝐀 (U+1D400, a surrogate pair) would sort before Ａ (U+FF21).
    const Wide = VariantType({ "\u{1D400}": NullType, "Ａ": NullType, b: NullType });
    assert.deepEqual(variantCases(Wide).map(([name]) => name), ["b", "Ａ", "\u{1D400}"]);
  });
});

describe("a variant's cases where their order shows", () => {
  test("its type value lists them as their names sort", () => {
    const value = toEastTypeValue(Shade);
    assert.ok(value.type === "Variant");
    assert.deepEqual(value.value.map((c) => c.name), SHADES);
  });

  test("its printed type lists them so", () => {
    assert.equal(printType(Shade),
      '.Variant [(name="100", type=.Null), (name="300", type=.Null), (name="400", type=.Null), (name="50", type=.Null), (name="a", type=.Integer)]');
    assert.equal(printTypeSummary(Shade, 0), ".Variant (100 | 300 | 400 | 50 | a)");
  });

  test("its default is its first case as their names sort", () => {
    assert.ok(equalFor(Shade)(defaultValue(Shade), variant("100", null)));
  });

  test("a match on it holds its arms as their names sort", () => {
    const tag = East.function([Shade], StringType, ($, shade) => shade.getTag());
    assert.deepEqual(matchArms(tag.toIR().ir), [SHADES]);
  });

  test("beast v1 reads a header's cases as their names sort, by code point", () => {
    // A name past U+FFFF against one in U+E000–U+FFFF: by UTF-16 code unit
    // the two sort the other way.
    const Wide = VariantType({ "\u{1D400}": NullType, "Ａ": NullType });
    for (const name of ["\u{1D400}", "Ａ"] as const) {
      assert.ok(equalFor(Wide)(decodeBeastFor(Wide)(encodeBeastFor(Wide)(variant(name, null))), variant(name, null)));
    }
  });
});
