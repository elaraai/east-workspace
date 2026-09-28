/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Aliasing in a segmented collection is scoped per root element: an element's
 * bytes depend on that element alone, never on which objects it shares with
 * its neighbours. That is what lets an encoded element be sorted, merged and
 * re-cut by byte copy, and a collection built one way hash the same as one
 * built another.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, DictType, IntegerType, StringType, StructType } from "../../../types.js";
import { compareFor } from "../../../comparison.js";
import { SortedMap } from "../../../index.js";
import { decodeBeast2For, encodeBeast2For, encodeBeast2PagedFor, fnv1a64, readBeast2Extents } from "../index.js";

const Tags = ArrayType(IntegerType);
const TagsByName = DictType(StringType, Tags);
const Grid = ArrayType(Tags);

/** A Dict whose three values are one array object, and the same Dict with a
 *  copy per key. */
function sharedDict(): { shared: SortedMap<string, bigint[]>; copies: SortedMap<string, bigint[]> } {
  const tags = [1n, 2n, 3n];
  const cmp = compareFor(StringType);
  return {
    shared: new SortedMap([["a", tags], ["b", tags], ["c", tags]], cmp),
    copies: new SortedMap([["a", [...tags]], ["b", [...tags]], ["c", [...tags]]], cmp),
  };
}

describe("beast2 v5 aliasing scoped per element", () => {
  test("a Dict whose values share an array encodes as if each held its own", () => {
    const { shared, copies } = sharedDict();
    const encode = encodeBeast2PagedFor(TagsByName);
    assert.deepEqual(encode(shared), encode(copies));
  });

  // A Set element or Dict key is an immutable type, which holds no container,
  // so only Dict values and Array elements can share one.

  test("an Array whose elements are one array encodes as if each were its own", () => {
    const inner = [4n, 5n];
    const encode = encodeBeast2PagedFor(Grid);
    assert.deepEqual(encode([inner, inner, inner]), encode([[...inner], [...inner], [...inner]]));
  });

  test("the indexed whole-value encode scopes the same way", () => {
    const { shared, copies } = sharedDict();
    const encode = encodeBeast2For(TagsByName, { index: true });
    assert.deepEqual(encode(shared), encode(copies));
  });

  test("keeps sharing inside an element", () => {
    const Pair = StructType({ left: Tags, right: Tags });
    const Pairs = ArrayType(Pair);
    const tags = [9n];
    const decoded = decodeBeast2For(Pairs)(encodeBeast2PagedFor(Pairs)([{ left: tags, right: tags }])) as { left: bigint[]; right: bigint[] }[];
    assert.equal(decoded[0]!.left, decoded[0]!.right, "one element's two references stay one container");
  });

  test("decodes sharing between elements to equal values", () => {
    const { shared } = sharedDict();
    const decoded = decodeBeast2For(TagsByName)(encodeBeast2PagedFor(TagsByName)(shared)) as Map<string, bigint[]>;
    assert.deepEqual([...decoded.entries()], [...shared.entries()]);
  });

  test("keeps every segment self-contained", () => {
    const { shared } = sharedDict();
    assert.equal(readBeast2Extents(encodeBeast2PagedFor(TagsByName)(shared)).selfContained, true);
  });

  describe("three-runtime parity", () => {
    // east-c writes these bytes too (east-py binds its writer); the same
    // digest is pinned in east-c's tests/test_beast2_aliasing.c.
    test("writes the shared-value Dict as east-c writes it", () => {
      const { shared } = sharedDict();
      const blob = encodeBeast2PagedFor(TagsByName, { codec: "none" })(shared);
      assert.equal(fnv1a64(blob).toString(16).padStart(16, "0"), "d5a98a7fcc1c03cb");
    });
  });
});
