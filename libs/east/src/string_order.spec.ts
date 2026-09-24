/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * East orders strings by code point, as east-c and east-py do, where
 * JavaScript's `<` orders UTF-16 code units: the comparator, the order a
 * sorted container keeps by default, and the order a Set of strings is written
 * in.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { compareStrings, defaultKeyCompare } from "./string_order.js";
import { compareFor, lessFor } from "./comparison.js";
import { NullType, SetType, StringType, VariantType } from "./types.js";
import { SortedMap, SortedSet, variant } from "./index.js";
import { decodeBeast2For, encodeBeast2PagedFor } from "./serialization/beast2/index.js";

/** Code-point order, computed the slow way. */
function byCodePoint(x: string, y: string): number {
  const a = Array.from(x, (c) => c.codePointAt(0)!);
  const b = Array.from(y, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  }
  return a.length < b.length ? -1 : (a.length > b.length ? 1 : 0);
}

/** A character just below the surrogates, the first and last after them, and
 *  the first and last above U+FFFF. */
const EDGES = ["퟿", "", "￿", "\u{10000}", "\u{10FFFF}"];

describe("string order", () => {
  test("is code-point order", () => {
    const pool = ["", "a", "ab", "é", "～", "\u{1F600}", "a～", "a\u{1F600}", "\u{1F600}a", ...EDGES];
    for (const x of pool) {
      for (const y of pool) {
        assert.equal(compareStrings(x, y), byCodePoint(x, y), `${JSON.stringify(x)} against ${JSON.stringify(y)}`);
      }
    }
  });

  test("is code-point order over random strings of every width", () => {
    const alphabet = ["a", "z", "é", "一", "퟿", "", "～", "￿", "\u{10000}", "\u{1F600}", "\u{10FFFF}"];
    let seed = 0x2545f491;
    const next = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const random = (): string => Array.from({ length: next(5) }, () => alphabet[next(alphabet.length)]).join("");
    for (let i = 0; i < 20_000; i++) {
      const x = random();
      const y = random();
      assert.equal(compareStrings(x, y), byCodePoint(x, y), `${JSON.stringify(x)} against ${JSON.stringify(y)}`);
    }
  });

  test("puts a character above U+FFFF after U+E000–U+FFFF, where UTF-16 puts it before", () => {
    assert.ok("\u{1F600}" < "～", "UTF-16 order");
    assert.equal(compareFor(StringType)("～", "\u{1F600}"), -1);
    assert.equal(lessFor(StringType)("\u{1F600}", "～"), false);
  });

  test("orders variant cases by the code points of their names", () => {
    const type = VariantType({ "～": NullType, "\u{1F600}": NullType });
    assert.equal(compareFor(type)(variant("～", null), variant("\u{1F600}", null)), -1);
  });

  test("is the order a sorted container keeps without a comparator", () => {
    assert.deepEqual([...new SortedSet(["\u{1F600}", "a", "～"])], ["a", "～", "\u{1F600}"]);
    assert.deepEqual([...new SortedMap([["\u{1F600}", 1], ["～", 2]]).keys()], ["～", "\u{1F600}"]);
    // Other keys keep the default order.
    assert.deepEqual([...new SortedSet([3, 1, 2])], [1, 2, 3]);
    assert.ok(defaultKeyCompare(1n, 2n) < 0);
  });

  test("is the order a Set of strings is written in", () => {
    // The bytes are the ones east-c and east-py write; the conformance
    // corpus pins them there.
    const type = SetType(StringType);
    const blob = encodeBeast2PagedFor(type)(new Set(["\u{1F600}", "a", "～"]));
    assert.deepEqual([...decodeBeast2For(type)(blob) as Set<string>], ["a", "～", "\u{1F600}"]);
    assert.deepEqual(encodeBeast2PagedFor(type)(new SortedSet(["～", "\u{1F600}", "a"])), blob);
  });
});
