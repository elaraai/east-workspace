/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A recursive type's equality is built once in a handler build: a container's
 * equality, built before its children's handlers, registers the recursive
 * types it holds, and its element's equality and the recursive type's own
 * handler reuse that comparer rather than build the type's whole equality
 * again. Counted by the comparers a build registers, as `equalFor` registers a
 * recursive type each time it builds one, so no clock is read.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { variant } from "../containers/variant.js";
import { equalFor } from "../comparison.js";
import { toEastTypeValue, type EastTypeValue } from "../type_of_type.js";
import { ArrayType, DictType, IntegerType, RecursiveType, StringType, StructType, VariantType } from "../types.js";
import { applyFor } from "./apply.js";
import { mergeFor } from "./merge.js";
import { ConflictError, equalWithin } from "./types.js";

/** A tree of numbers: the recursive type held. */
const Tree = RecursiveType(self => VariantType({ leaf: IntegerType, branch: StructType({ left: self, right: self }) }));

/** The tree's type value: a recursive wrapper. */
const TREE: EastTypeValue = toEastTypeValue(Tree);

/** The id the tree's comparer is registered under. */
const TREE_ID = TREE.type === "Recursive" && TREE.value.type === "wrapper" ? TREE.value.value.id : undefined;

/** A build's registry that counts the comparers registered under each id. */
class Counting extends Map<bigint, (a: any, b: any) => boolean> {
  readonly registered = new Map<bigint, number>();
  override set(id: bigint, equal: (a: any, b: any) => boolean): this {
    this.registered.set(id, (this.registered.get(id) ?? 0) + 1);
    return super.set(id, equal);
  }
}

const leaf = (n: bigint) => variant("leaf", n);
const branch = (left: unknown, right: unknown) => variant("branch", { left, right });

/** The tree held in each kind of container a handler builds an equality for before its children's. */
const HELD = [
  ["a struct's field", StructType({ name: StringType, tree: Tree })],
  ["an array's element", ArrayType(Tree)],
  ["a dict's value", DictType(StringType, Tree)],
] as const;

describe("equalWithin: a recursive type's comparer built once in a handler build", () => {
  test("a recursive type's comparer registered in the build is the one given back; with none, one is built and registered", () => {
    assert.notEqual(TREE_ID, undefined);
    const registry = new Map<bigint, (a: any, b: any) => boolean>();
    const built = equalWithin(TREE, registry);
    assert.equal(registry.get(TREE_ID!), built);
    assert.equal(equalWithin(TREE, registry), built);
    assert.equal(built(branch(leaf(1n), leaf(2n)), branch(leaf(1n), leaf(2n))), true);
    assert.equal(built(branch(leaf(1n), leaf(2n)), branch(leaf(1n), leaf(3n))), false);
  });

  for (const [held, type] of HELD) {
    test(`applyFor registers the tree's comparer once, the tree ${held}`, () => {
      const equal = new Counting();
      applyFor(toEastTypeValue(type), { apply: [], types: [], equal, print: new Map() });
      assert.equal(equal.registered.get(TREE_ID!), 1);
    });

    test(`mergeFor registers the tree's comparer once, the tree ${held}`, () => {
      const equal = new Counting();
      mergeFor(toEastTypeValue(type), { merge: [], types: [], equal });
      assert.equal(equal.registered.get(TREE_ID!), 1);
    });
  }

  test("a tree a struct holds is compared by the comparer reused: a stale replace conflicts, and the one made from it writes", () => {
    const type = StructType({ name: StringType, tree: Tree });
    const apply = applyFor(type);
    const base = { name: "a", tree: branch(leaf(1n), leaf(2n)) };
    const unchanged = variant("unchanged", null);
    const stale = variant("patch", { name: unchanged, tree: variant("replace", { before: leaf(9n), after: leaf(3n) }) });
    assert.throws(() => apply(base, stale as never), ConflictError);
    const made = variant("patch", { name: unchanged, tree: variant("replace", { before: branch(leaf(1n), leaf(2n)), after: leaf(3n) }) });
    assert.equal(equalFor(type)(apply(base, made as never), { name: "a", tree: leaf(3n) }), true);
  });
});
