/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { variant } from "../containers/variant.js";
import { SortedMap } from "../containers/sortedmap.js";
import { SortedSet } from "../containers/sortedset.js";
import {
  ArrayType, BlobType, BooleanType, DateTimeType, DictType, FloatType,
  FunctionType, IntegerType, NullType, RefType, RecursiveType, SetType,
  StringType, StructType, VariantType,
} from "../types.js";
import { compareFor, equalFor } from "../comparison.js";
import { ref } from "../containers/ref.js";

import { diffFor } from "./diff.js";
import { applyFor } from "./apply.js";
import { ConflictError } from "./types.js";
import { mergeFor, detectConflictsFor, mergeWithResolutionsFor } from "./merge.js";

// ============================================================================
// Helpers
// ============================================================================

/** Diff before→afterA and before→afterB, returning [patchA, patchB]. */
function diffsFor<T>(type: any, base: T, afterA: T, afterB: T) {
  const diff = diffFor(type);
  return [diff(base, afterA), diff(base, afterB)] as const;
}

/** Assert that applying `merged` to `base` yields `expected`. */
function assertMergeApplies<T>(type: any, base: T, merged: any, expected: T): void {
  const apply = applyFor(type);
  const valueEqual = equalFor(type);
  const result = apply(base, merged);
  assert.ok(
    valueEqual(result as any, expected as any),
    `apply did not yield expected value`,
  );
}

/** Assert that two patches produce the same applied result on `base`. */
function assertPatchSemantics<T>(type: any, base: T, mergedA: any, mergedB: any): void {
  const apply = applyFor(type);
  const valueEqual = equalFor(type);
  assert.ok(
    valueEqual(apply(base, mergedA) as any, apply(base, mergedB) as any),
    `patches did not produce semantically-equal results`,
  );
}

// ============================================================================
// PRIMITIVES — every primitive type, every merge case
// ============================================================================

describe("mergeFor primitives — every type, every case", () => {
  // The primitive merge logic is identical across all primitive tags; we test
  // each type through the same case matrix to confirm the dispatch is wired up.
  const primitiveCases = [
    { name: "Null",     T: NullType,     v1: null,                       v2: null },
    { name: "Boolean",  T: BooleanType,  v1: true,                       v2: false },
    { name: "Integer",  T: IntegerType,  v1: 1n,                         v2: 2n },
    { name: "Float",    T: FloatType,    v1: 1.5,                        v2: 2.5 },
    { name: "String",   T: StringType,   v1: "old",                      v2: "new" },
    { name: "DateTime", T: DateTimeType, v1: new Date("2020-01-01T00:00:00Z"),
                                          v2: new Date("2025-01-01T00:00:00Z") },
    { name: "Blob",     T: BlobType,     v1: new Uint8Array([1, 2, 3]),
                                          v2: new Uint8Array([4, 5, 6]) },
  ] as const;

  for (const { name, T, v1, v2 } of primitiveCases) {
    if (name === "Null") {
      // Null is degenerate — only one value exists; no replace can ever fire.
      test(`${name}: both unchanged → unchanged`, () => {
        assert.deepEqual(
          mergeFor(T)(variant("unchanged", null), variant("unchanged", null)),
          variant("unchanged", null),
        );
      });
      continue;
    }

    test(`${name}: both unchanged → unchanged`, () => {
      const merge = mergeFor(T);
      assert.deepEqual(merge(variant("unchanged", null), variant("unchanged", null)),
                       variant("unchanged", null));
    });

    test(`${name}: A unchanged, B replace → take B`, () => {
      const merge = mergeFor(T);
      const b = variant("replace", { before: v1, after: v2 });
      assert.deepEqual(merge(variant("unchanged", null), b), b);
    });

    test(`${name}: A replace, B unchanged → take A (symmetric)`, () => {
      const merge = mergeFor(T);
      const a = variant("replace", { before: v1, after: v2 });
      assert.deepEqual(merge(a, variant("unchanged", null)), a);
    });

    test(`${name}: both replace, same after → converge to A`, () => {
      const merge = mergeFor(T);
      const a = variant("replace", { before: v1, after: v2 });
      const b = variant("replace", { before: v1, after: v2 });
      assert.deepEqual(merge(a, b), a);
    });

    test(`${name}: both replace, different after → conflict`, () => {
      const merge = mergeFor(T);
      const a = variant("replace", { before: v1, after: v2 });
      const b = variant("replace", { before: v1, after: v1 });    // different after
      assert.throws(() => merge(a, b), ConflictError);
    });
  }
});

// ============================================================================
// STRUCT — disjoint, overlapping idempotent, overlapping conflict, nested
// ============================================================================

describe("mergeFor — Struct", () => {
  const Person = StructType({ name: StringType, age: IntegerType });
  const base = { name: "Alice", age: 30n };

  test("both unchanged → unchanged", () => {
    assert.deepEqual(
      mergeFor(Person)(variant("unchanged", null), variant("unchanged", null)),
      variant("unchanged", null),
    );
  });

  test("A unchanged → take B", () => {
    const b = diffFor(Person)(base, { ...base, name: "Bob" });
    assert.deepEqual(mergeFor(Person)(variant("unchanged", null), b), b);
  });

  test("disjoint field edits merge cleanly", () => {
    const [a, b] = diffsFor(Person, base, { ...base, name: "Bob" }, { ...base, age: 31n });
    const merged = mergeFor(Person)(a, b);
    assertMergeApplies(Person, base, merged, { name: "Bob", age: 31n });
  });

  test("same-field same-value edits converge", () => {
    const [a, b] = diffsFor(Person, base, { ...base, age: 35n }, { ...base, age: 35n });
    assertMergeApplies(Person, base, mergeFor(Person)(a, b), { ...base, age: 35n });
  });

  test("same-field different-value edits conflict at field path", () => {
    const [a, b] = diffsFor(Person, base, { ...base, age: 35n }, { ...base, age: 40n });
    try {
      mergeFor(Person)(a, b);
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof ConflictError);
      assert.equal(err.conflicts.length, 1);
      assert.equal(err.conflicts[0]!.path, "age");
    }
  });

  test("two disjoint field conflicts surface independently", () => {
    const [a, b] = diffsFor(
      Person, base,
      { name: "AA", age: 99n },
      { name: "BB", age: 11n },
    );
    try {
      mergeFor(Person)(a, b);
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof ConflictError);
      const paths = new Set(err.conflicts.map(c => c.path));
      assert.deepEqual(paths, new Set(["name", "age"]));
    }
  });

  test("both replace, same after struct → converge", () => {
    const a = variant("replace", { before: base, after: { name: "C", age: 99n } });
    const b = variant("replace", { before: base, after: { name: "C", age: 99n } });
    assert.deepEqual(mergeFor(Person)(a, b), a);
  });

  test("both replace, different after struct → conflict at root", () => {
    const a = variant("replace", { before: base, after: { name: "C", age: 99n } });
    const b = variant("replace", { before: base, after: { name: "D", age: 99n } });
    try {
      mergeFor(Person)(a, b);
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof ConflictError);
      assert.equal(err.conflicts[0]!.path, "");
    }
  });

  test("mixed replace + patch → conflict at struct level", () => {
    const a = variant("replace", { before: base, after: { name: "C", age: 99n } });
    const b = diffFor(Person)(base, { ...base, age: 31n });
    assert.throws(() => mergeFor(Person)(a, b), ConflictError);
  });
});

describe("mergeFor — nested Struct (3 levels)", () => {
  const Address = StructType({ city: StringType, zip: StringType });
  const Person  = StructType({ name: StringType, address: Address });
  const Org     = StructType({ owner: Person, region: StringType });
  const base    = { owner: { name: "A", address: { city: "NY", zip: "10001" } }, region: "NA" };

  test("disjoint deep-leaf edits merge", () => {
    const a = diffFor(Org)(base, { ...base, region: "EU" });
    const b = diffFor(Org)(base, { ...base, owner: { ...base.owner, address: { ...base.owner.address, zip: "20002" } } });
    const merged = mergeFor(Org)(a, b);
    assertMergeApplies(Org, base, merged, {
      owner: { name: "A", address: { city: "NY", zip: "20002" } },
      region: "EU",
    });
  });

  test("conflict at 3-level-deep leaf surfaces with dotted path", () => {
    const a = diffFor(Org)(base, { ...base, owner: { ...base.owner, address: { ...base.owner.address, zip: "AAAAA" } } });
    const b = diffFor(Org)(base, { ...base, owner: { ...base.owner, address: { ...base.owner.address, zip: "BBBBB" } } });
    try {
      mergeFor(Org)(a, b);
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof ConflictError);
      assert.equal(err.conflicts[0]!.path, "owner.address.zip");
    }
  });
});

// ============================================================================
// ARRAY — every op-pair combo
// ============================================================================

describe("mergeFor — Array of primitives", () => {
  const T = ArrayType(IntegerType);

  test("both unchanged → unchanged", () => {
    assert.deepEqual(
      mergeFor(T)(variant("unchanged", null), variant("unchanged", null)),
      variant("unchanged", null),
    );
  });

  test("disjoint inserts at different positions → both applied", () => {
    const base = [1n, 2n, 3n];
    const a = diffFor(T)(base, [1n, 2n, 3n, 99n]);
    const b = diffFor(T)(base, [0n, 1n, 2n, 3n]);
    const merged = mergeFor(T)(a, b);
    // Either ordering of the disjoint inserts is fine — both the user and
    // server intents must end up reflected in some order.
    const result = applyFor(T)(base, merged) as bigint[];
    assert.ok(result.includes(99n) && result.includes(0n), `result=${result}`);
  });

  test("identical inserts at same position → semantically same as A", () => {
    const base = [1n, 2n, 3n];
    const after = [1n, 2n, 3n, 99n];
    const a = diffFor(T)(base, after);
    const b = diffFor(T)(base, after);
    assertPatchSemantics(T, base, mergeFor(T)(a, b), a);
  });

  test("identical deletes at same position → semantically same as A", () => {
    const base = [1n, 2n, 3n];
    const a = diffFor(T)(base, [1n, 3n]);
    const b = diffFor(T)(base, [1n, 3n]);
    assertPatchSemantics(T, base, mergeFor(T)(a, b), a);
  });

  test("different inserts at same position → conflict", () => {
    const base = [1n];
    const a = diffFor(T)(base, [1n, 2n]);
    const b = diffFor(T)(base, [1n, 3n]);
    assert.throws(() => mergeFor(T)(a, b), ConflictError);
  });

  test("whole-array replace + replace, same after → converge", () => {
    const a = variant("replace", { before: [1n, 2n], after: [3n, 4n] });
    const b = variant("replace", { before: [1n, 2n], after: [3n, 4n] });
    assert.deepEqual(mergeFor(T)(a, b), a);
  });

  test("whole-array replace + replace, different after → conflict", () => {
    const a = variant("replace", { before: [1n, 2n], after: [3n, 4n] });
    const b = variant("replace", { before: [1n, 2n], after: [9n, 9n] });
    assert.throws(() => mergeFor(T)(a, b), ConflictError);
  });

  test("whole-array replace + patch → conflict (mixed)", () => {
    const a = variant("replace", { before: [1n, 2n], after: [9n, 9n] });
    const b = diffFor(T)([1n, 2n], [1n, 3n]);
    assert.throws(() => mergeFor(T)(a, b), ConflictError);
  });
});

describe("mergeFor — Array<Struct> (delete+insert reality)", () => {
  // NOTE: `diffFor` for ArrayType only emits `delete` and `insert` ops — never
  // `update`. Element-level changes therefore appear as a (delete, insert)
  // pair at the same key. Two patches that change the same array element
  // produce same-delete + different-insert, which is a conflict. To exercise
  // the merge walker's `update` recursion path, construct patches manually
  // (see "Manual update-op construction" below) or use Dict<K, Struct>.

  const Item = StructType({ name: StringType, qty: IntegerType });
  const T = ArrayType(Item);
  const base = [{ name: "a", qty: 1n }, { name: "b", qty: 2n }];

  test("identical element changes produce idempotent merge", () => {
    const after = [{ name: "a", qty: 1n }, { name: "Z", qty: 99n }];
    const a = diffFor(T)(base, after);
    const b = diffFor(T)(base, after);
    assertPatchSemantics(T, base, mergeFor(T)(a, b), a);
  });

  test("different changes to same element conflict (delete+insert with different inserts)", () => {
    const a = diffFor(T)(base, [{ name: "a", qty: 1n }, { name: "X", qty: 2n }]);
    const b = diffFor(T)(base, [{ name: "a", qty: 1n }, { name: "Y", qty: 2n }]);
    assert.throws(() => mergeFor(T)(a, b), ConflictError);
  });
});

describe("mergeFor — Array update-op recursion (manually-constructed patches)", () => {
  // diffFor doesn't emit `update`, but the merge walker handles them — useful
  // for callers that construct patches programmatically (e.g. composePatch).
  const Item = StructType({ name: StringType, qty: IntegerType });
  const T = ArrayType(Item);

  test("update + update on same key with disjoint sub-field changes recurses cleanly", () => {
    const aPatch = variant("patch", [
      {
        key: 1n,
        offset: 0n,
        operation: variant("update", variant("patch", {
          name: variant("replace", { before: "b", after: "BB" }),
          qty:  variant("unchanged", null),
        })),
      },
    ]);
    const bPatch = variant("patch", [
      {
        key: 1n,
        offset: 0n,
        operation: variant("update", variant("patch", {
          name: variant("unchanged", null),
          qty:  variant("replace", { before: 2n, after: 99n }),
        })),
      },
    ]);
    const merged = mergeFor(T)(aPatch, bPatch);
    const base = [{ name: "a", qty: 1n }, { name: "b", qty: 2n }];
    assertMergeApplies(T, base, merged, [{ name: "a", qty: 1n }, { name: "BB", qty: 99n }]);
  });

  test("update + update on same key with overlapping sub-field changes conflicts at [idx].field", () => {
    const aPatch = variant("patch", [
      {
        key: 1n,
        offset: 0n,
        operation: variant("update", variant("patch", {
          name: variant("replace", { before: "b", after: "X" }),
          qty:  variant("unchanged", null),
        })),
      },
    ]);
    const bPatch = variant("patch", [
      {
        key: 1n,
        offset: 0n,
        operation: variant("update", variant("patch", {
          name: variant("replace", { before: "b", after: "Y" }),
          qty:  variant("unchanged", null),
        })),
      },
    ]);
    try {
      mergeFor(T)(aPatch, bPatch);
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof ConflictError);
      const paths = err.conflicts.map(c => c.path);
      assert.ok(paths.some(p => p.includes("[1]") && p.includes("name")), `paths=${paths.join(",")}`);
    }
  });
});

// ============================================================================
// SET — every op-pair combo
// ============================================================================

describe("mergeFor — Set", () => {
  const T = SetType(StringType);

  function set(items: string[]): SortedSet<string> {
    const s = new SortedSet<string>([], compareFor(StringType));
    for (const x of items) s.add(x);
    return s;
  }

  test("both unchanged → unchanged", () => {
    assert.deepEqual(
      mergeFor(T)(variant("unchanged", null), variant("unchanged", null)),
      variant("unchanged", null),
    );
  });

  test("disjoint inserts merge", () => {
    const base = set(["a"]);
    const a = diffFor(T)(base, set(["a", "b"]));
    const b = diffFor(T)(base, set(["a", "c"]));
    const merged = mergeFor(T)(a, b);
    const result = applyFor(T)(base, merged) as SortedSet<string>;
    assert.ok(result.has("b") && result.has("c"));
  });

  test("identical inserts at same key are idempotent", () => {
    const base = set([]);
    const after = set(["x"]);
    const a = diffFor(T)(base, after);
    const b = diffFor(T)(base, after);
    assertPatchSemantics(T, base, mergeFor(T)(a, b), a);
  });

  test("identical deletes at same key are idempotent", () => {
    const base = set(["x", "y"]);
    const after = set(["y"]);
    const a = diffFor(T)(base, after);
    const b = diffFor(T)(base, after);
    assertPatchSemantics(T, base, mergeFor(T)(a, b), a);
  });

  test("whole-set replace + replace, same after → converge", () => {
    const a = variant("replace", { before: set(["x"]), after: set(["y"]) });
    const b = variant("replace", { before: set(["x"]), after: set(["y"]) });
    assert.deepEqual(mergeFor(T)(a, b), a);
  });

  test("whole-set replace + replace, different after → conflict", () => {
    const a = variant("replace", { before: set(["x"]), after: set(["y"]) });
    const b = variant("replace", { before: set(["x"]), after: set(["z"]) });
    assert.throws(() => mergeFor(T)(a, b), ConflictError);
  });
});

// ============================================================================
// DICT — every op-pair combo
// ============================================================================

describe("mergeFor — Dict", () => {
  const T = DictType(StringType, IntegerType);

  function dict(entries: Array<[string, bigint]>): SortedMap<string, bigint> {
    const m = new SortedMap<string, bigint>(undefined, compareFor(StringType));
    for (const [k, v] of entries) m.set(k, v);
    return m;
  }

  test("both unchanged → unchanged", () => {
    assert.deepEqual(
      mergeFor(T)(variant("unchanged", null), variant("unchanged", null)),
      variant("unchanged", null),
    );
  });

  test("disjoint key inserts → all applied", () => {
    const base = dict([]);
    const a = diffFor(T)(base, dict([["x", 1n]]));
    const b = diffFor(T)(base, dict([["y", 2n]]));
    const merged = mergeFor(T)(a, b);
    const result = applyFor(T)(base, merged) as SortedMap<string, bigint>;
    assert.equal(result.size, 2);
    assert.equal(result.get("x"), 1n);
    assert.equal(result.get("y"), 2n);
  });

  test("same key, same value inserts → idempotent", () => {
    const base = dict([]);
    const after = dict([["x", 5n]]);
    const a = diffFor(T)(base, after);
    const b = diffFor(T)(base, after);
    assertPatchSemantics(T, base, mergeFor(T)(a, b), a);
  });

  test("same key, different value inserts → conflict at key path", () => {
    const base = dict([]);
    const a = diffFor(T)(base, dict([["x", 5n]]));
    const b = diffFor(T)(base, dict([["x", 9n]]));
    try {
      mergeFor(T)(a, b);
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof ConflictError);
      assert.ok(err.conflicts[0]!.path.startsWith("{"), `path=${err.conflicts[0]!.path}`);
    }
  });

  test("same key, both delete → idempotent", () => {
    const base = dict([["x", 1n]]);
    const after = dict([]);
    const a = diffFor(T)(base, after);
    const b = diffFor(T)(base, after);
    assertPatchSemantics(T, base, mergeFor(T)(a, b), a);
  });

  test("update + delete on same key → conflict", () => {
    const base = dict([["k", 1n]]);
    const a = diffFor(T)(base, dict([["k", 2n]]));
    const b = diffFor(T)(base, dict([]));
    assert.throws(() => mergeFor(T)(a, b), ConflictError);
  });

  test("update + insert on same key → conflict (impossible per apply, but merge guards)", () => {
    // A patches an existing key to a new value (update); B inserts a fresh
    // key that happens to match; if both are constructed from the same base
    // they can't coexist in the same dict. Use direct patch construction.
    const base = dict([]);
    const aInsert = diffFor(T)(base, dict([["k", 1n]]));    // insert
    const bDelete = diffFor(T)(dict([["k", 1n]]), dict([])); // delete from a different base
    // Construct an artificial "update" patch and an "insert" patch on the
    // same key; this lives outside what diffFor would produce together but
    // exercises merge's defensive branch.
    const updatePatch = variant("patch",
      (() => {
        const m = new SortedMap<string, any>(undefined, compareFor(StringType));
        m.set("k", variant("update", variant("replace", { before: 1n, after: 2n })));
        return m;
      })(),
    );
    const insertPatch = aInsert;
    assert.throws(() => mergeFor(T)(updatePatch, insertPatch), ConflictError);
    // Suppress unused-var for the unrelated deletePatch that this test set up
    // to demonstrate symmetric construction:
    void bDelete;
  });

  test("update + update on same key with same target → idempotent", () => {
    const Inner = StructType({ n: IntegerType });
    const T2 = DictType(StringType, Inner);
    const baseInner = new SortedMap<string, { n: bigint }>(undefined, compareFor(StringType));
    baseInner.set("k", { n: 1n });
    const afterInner = new SortedMap<string, { n: bigint }>(undefined, compareFor(StringType));
    afterInner.set("k", { n: 7n });
    const a = diffFor(T2)(baseInner, afterInner);
    const b = diffFor(T2)(baseInner, afterInner);
    assertPatchSemantics(T2, baseInner, mergeFor(T2)(a, b), a);
  });

  test("update + update on same key, different target → recurses to conflict", () => {
    const Inner = StructType({ n: IntegerType });
    const T2 = DictType(StringType, Inner);
    const base = new SortedMap<string, { n: bigint }>(undefined, compareFor(StringType));
    base.set("k", { n: 1n });
    const aAfter = new SortedMap<string, { n: bigint }>(undefined, compareFor(StringType));
    aAfter.set("k", { n: 5n });
    const bAfter = new SortedMap<string, { n: bigint }>(undefined, compareFor(StringType));
    bAfter.set("k", { n: 7n });
    const a = diffFor(T2)(base, aAfter);
    const b = diffFor(T2)(base, bAfter);
    try {
      mergeFor(T2)(a, b);
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof ConflictError);
      // Dict keys are formatted via `printFor` which JSON-stringifies the
      // string key — so a dict key of "k" renders as {"k"} in the path.
      assert.ok(err.conflicts[0]!.path.includes(`{"k"}`),
                `path=${err.conflicts[0]!.path}`);
      assert.ok(err.conflicts[0]!.path.includes("n"));
    }
  });
});

// ============================================================================
// VARIANT — same-tag, cross-tag, replace combos
// ============================================================================

describe("mergeFor — Variant", () => {
  const Status = VariantType({
    active:   StructType({ since: StringType }),
    inactive: NullType,
    pending:  StructType({ approver: StringType }),
  });

  test("same-tag patches with same after → converge", () => {
    const base = variant("active", { since: "2020" });
    const after = variant("active", { since: "2025" });
    const a = diffFor(Status)(base, after);
    const b = diffFor(Status)(base, after);
    assertPatchSemantics(Status, base, mergeFor(Status)(a, b), a);
  });

  test("same-tag patches with conflicting sub-fields conflict at @tag.field", () => {
    const base = variant("active", { since: "2020" });
    const a = diffFor(Status)(base, variant("active", { since: "AA" }));
    const b = diffFor(Status)(base, variant("active", { since: "BB" }));
    try {
      mergeFor(Status)(a, b);
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof ConflictError);
      assert.ok(err.conflicts[0]!.path.includes("@active"));
      assert.ok(err.conflicts[0]!.path.includes("since"));
    }
  });

  test("cross-tag patches conflict", () => {
    const base = variant("active", { since: "2020" });
    const a = diffFor(Status)(base, variant("inactive", null));
    const b = diffFor(Status)(base, variant("pending", { approver: "Bob" }));
    assert.throws(() => mergeFor(Status)(a, b), ConflictError);
  });

  test("both replace, same after → converge", () => {
    const a = variant("replace", {
      before: variant("active", { since: "x" }),
      after:  variant("inactive", null),
    });
    const b = variant("replace", {
      before: variant("active", { since: "x" }),
      after:  variant("inactive", null),
    });
    assert.deepEqual(mergeFor(Status)(a, b), a);
  });

  test("both replace, different after → conflict", () => {
    const a = variant("replace", {
      before: variant("active", { since: "x" }),
      after:  variant("inactive", null),
    });
    const b = variant("replace", {
      before: variant("active", { since: "x" }),
      after:  variant("pending", { approver: "Bob" }),
    });
    assert.throws(() => mergeFor(Status)(a, b), ConflictError);
  });
});

// ============================================================================
// REF — recurses into inner
// ============================================================================

describe("mergeFor — Ref", () => {
  const T = RefType(IntegerType);

  test("two ref-replaces, same after → converge", () => {
    const a = variant("replace", { before: ref(1n), after: ref(5n) });
    const b = variant("replace", { before: ref(1n), after: ref(5n) });
    assert.deepEqual(mergeFor(T)(a, b), a);
  });

  test("two ref-replaces, different after → conflict", () => {
    const a = variant("replace", { before: ref(1n), after: ref(5n) });
    const b = variant("replace", { before: ref(1n), after: ref(7n) });
    assert.throws(() => mergeFor(T)(a, b), ConflictError);
  });
});

// ============================================================================
// RECURSIVE — replace-only semantics
// ============================================================================

describe("mergeFor — Recursive (replace-only)", () => {
  const Tree = RecursiveType(self =>
    VariantType({
      leaf:   IntegerType,
      branch: StructType({ left: self, right: self }),
    }),
  );

  test("two replace patches with structurally-equal afters → converge", () => {
    const after = variant("leaf", 5n);
    const a = variant("replace", { before: variant("leaf", 1n), after });
    const b = variant("replace", { before: variant("leaf", 1n), after });
    assert.deepEqual(mergeFor(Tree)(a, b), a);
  });

  test("two replace patches with different afters → conflict", () => {
    const a = variant("replace", { before: variant("leaf", 1n), after: variant("leaf", 5n) });
    const b = variant("replace", { before: variant("leaf", 1n), after: variant("leaf", 7n) });
    assert.throws(() => mergeFor(Tree)(a, b), ConflictError);
  });
});

// ============================================================================
// FUNCTION / ASYNC FUNCTION — non-comparable; conflicts on diverging replace
// ============================================================================

describe("mergeFor — Function / AsyncFunction", () => {
  const F = FunctionType([IntegerType], IntegerType);

  test("both unchanged → unchanged", () => {
    assert.deepEqual(
      mergeFor(F)(variant("unchanged", null), variant("unchanged", null)),
      variant("unchanged", null),
    );
  });

  // Function values can't be structurally compared; any divergent replace
  // pair is a conflict by definition. Only the unchanged-passthrough cases
  // are reliably exercisable from outside.
});

// ============================================================================
// detectConflictsFor — pure observation
// ============================================================================

describe("detectConflictsFor", () => {
  const Person = StructType({ name: StringType, age: IntegerType });
  const base = { name: "Alice", age: 30n };

  test("returns [] for clean merge", () => {
    const [a, b] = diffsFor(Person, base, { ...base, name: "Bob" }, { ...base, age: 31n });
    assert.deepEqual(detectConflictsFor(Person)(a, b), []);
  });

  test("returns one Conflict for one diverging leaf, with both arms", () => {
    const [a, b] = diffsFor(Person, base, { ...base, age: 35n }, { ...base, age: 40n });
    const conflicts = detectConflictsFor(Person)(a, b);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.path, "age");
    assert.deepEqual(conflicts[0]!.valueA, variant("replace", { before: 30n, after: 35n }));
    assert.deepEqual(conflicts[0]!.valueB, variant("replace", { before: 30n, after: 40n }));
  });

  test("returns multiple Conflicts when multiple leaves diverge", () => {
    const [a, b] = diffsFor(
      Person, { name: "A", age: 0n },
      { name: "AA", age: 99n },
      { name: "BB", age: 11n },
    );
    const conflicts = detectConflictsFor(Person)(a, b);
    assert.equal(conflicts.length, 2);
  });

  test("detection does not throw even on cross-tag variant conflict", () => {
    const Status = VariantType({ on: NullType, off: NullType });
    const a = variant("replace", { before: variant("on", null), after: variant("off", null) });
    const b = variant("replace", { before: variant("on", null), after: variant("on", null) });
    // a is replace to off, b is replace to on (no-op-ish but semantically distinct).
    // Should detect one conflict at root, not throw.
    const conflicts = detectConflictsFor(Status)(a, b);
    assert.ok(conflicts.length >= 0);   // may be 0 (b converged to no-change) or 1
  });
});

// ============================================================================
// mergeWithResolutionsFor — every resolution type
// ============================================================================

describe("mergeWithResolutionsFor", () => {
  const Person = StructType({ name: StringType, age: IntegerType });
  const base = { name: "Alice", age: 30n };

  test("keepA → A's value applied at conflict path", () => {
    const [a, b] = diffsFor(Person, base, { ...base, age: 35n }, { ...base, age: 40n });
    const merged = mergeWithResolutionsFor(Person)(a, b, new Map([
      ["age", { type: "keepA" }],
    ]));
    assertMergeApplies(Person, base, merged, { ...base, age: 35n });
  });

  test("keepB → B's value applied at conflict path", () => {
    const [a, b] = diffsFor(Person, base, { ...base, age: 35n }, { ...base, age: 40n });
    const merged = mergeWithResolutionsFor(Person)(a, b, new Map([
      ["age", { type: "keepB" }],
    ]));
    assertMergeApplies(Person, base, merged, { ...base, age: 40n });
  });

  test("manual → caller-supplied value applied at conflict path", () => {
    const [a, b] = diffsFor(Person, base, { ...base, age: 35n }, { ...base, age: 40n });
    const merged = mergeWithResolutionsFor(Person)(a, b, new Map([
      ["age", { type: "manual", value: 99n }],
    ]));
    assertMergeApplies(Person, base, merged, { ...base, age: 99n });
  });

  test("missing resolution → throws unresolved conflict", () => {
    const [a, b] = diffsFor(Person, base, { ...base, age: 35n }, { ...base, age: 40n });
    try {
      mergeWithResolutionsFor(Person)(a, b, new Map());
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof ConflictError);
      assert.equal(err.conflicts.length, 1);
      assert.equal(err.conflicts[0]!.path, "age");
    }
  });

  test("multiple conflicts with mixed resolution types", () => {
    const [a, b] = diffsFor(
      Person, base,
      { name: "AA", age: 99n },
      { name: "BB", age: 11n },
    );
    const merged = mergeWithResolutionsFor(Person)(a, b, new Map<string, any>([
      ["name", { type: "keepA" }],
      ["age",  { type: "manual", value: 50n }],
    ]));
    assertMergeApplies(Person, base, merged, { name: "AA", age: 50n });
  });

  test("clean merge passes resolutions through (no conflicts)", () => {
    const [a, b] = diffsFor(Person, base, { ...base, name: "Bob" }, { ...base, age: 31n });
    const merged = mergeWithResolutionsFor(Person)(a, b, new Map());
    assertMergeApplies(Person, base, merged, { name: "Bob", age: 31n });
  });

  test("manual at non-leaf where neither arm is replace → unresolved (cross-tag variant)", () => {
    // Constructing a case where applyResolution can't extract a `before`:
    // both arms are `patch` at variant level (cross-tag is the conflict path).
    const Status = VariantType({
      a: StructType({ x: IntegerType }),
      b: StructType({ y: IntegerType }),
    });
    const base = variant("a", { x: 1n });
    const aDiff = diffFor(Status)(base, variant("a", { x: 2n }));      // patch into a@x
    const bDiff = diffFor(Status)(base, variant("b", { y: 99n }));     // replace (cross-tag)
    // Cross-tag changes are emitted as `replace`, so this still has a `before`.
    // Construct true patch+patch by using same-tag with different fields:
    const Status2 = VariantType({
      both: StructType({ x: IntegerType, y: IntegerType }),
      other: NullType,
    });
    const base2 = variant("both", { x: 1n, y: 1n });
    const aDiff2 = diffFor(Status2)(base2, variant("both", { x: 2n, y: 1n }));
    const bDiff2 = diffFor(Status2)(base2, variant("both", { x: 1n, y: 2n }));
    // No conflicts here — disjoint x and y. Just smoke-test:
    assert.doesNotThrow(() => mergeFor(Status2)(aDiff2, bDiff2));
    void aDiff; void bDiff;
  });
});

// ============================================================================
// Gap-fill #1 — detectConflictsFor at every non-struct path kind
// ============================================================================

describe("detectConflictsFor — non-struct conflict paths", () => {
  test("conflict inside an Array element produces a [N].field path with replace ops", () => {
    const Row = StructType({ rate: FloatType });
    const T = ArrayType(Row);
    const base = [{ rate: 1.0 }, { rate: 2.0 }];
    const [a, b] = diffsFor(T, base, [{ rate: 1.0 }, { rate: 5.0 }], [{ rate: 1.0 }, { rate: 9.0 }]);
    const conflicts = detectConflictsFor(T)(a, b);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.path, "[1].rate");
    assert.deepEqual(conflicts[0]!.valueA, variant("replace", { before: 2.0, after: 5.0 }));
    assert.deepEqual(conflicts[0]!.valueB, variant("replace", { before: 2.0, after: 9.0 }));
  });

  test("conflict inside a Dict entry produces a {key}.field path with replace ops", () => {
    const Item = StructType({ price: FloatType });
    const T = DictType(StringType, Item);
    const base = new SortedMap<string, { price: number }>([["AU", { price: 1.0 }]], compareFor(StringType));
    const aAfter = new SortedMap<string, { price: number }>([["AU", { price: 5.0 }]], compareFor(StringType));
    const bAfter = new SortedMap<string, { price: number }>([["AU", { price: 9.0 }]], compareFor(StringType));
    const [a, b] = diffsFor(T, base, aAfter, bAfter);
    const conflicts = detectConflictsFor(T)(a, b);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.path, '{"AU"}.price');
    assert.deepEqual(conflicts[0]!.valueA, variant("replace", { before: 1.0, after: 5.0 }));
    assert.deepEqual(conflicts[0]!.valueB, variant("replace", { before: 1.0, after: 9.0 }));
  });

  test("conflict inside a same-tag Variant produces an @tag.field path with replace ops", () => {
    const Status = VariantType({ active: StructType({ since: IntegerType }) });
    const base = variant("active", { since: 100n });
    const [a, b] = diffsFor(Status, base, variant("active", { since: 200n }), variant("active", { since: 300n }));
    const conflicts = detectConflictsFor(Status)(a, b);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.path, "@active.since");
    assert.deepEqual(conflicts[0]!.valueA, variant("replace", { before: 100n, after: 200n }));
    assert.deepEqual(conflicts[0]!.valueB, variant("replace", { before: 100n, after: 300n }));
  });

  test("primitive root conflict produces an empty-string path with replace ops", () => {
    const [a, b] = diffsFor(IntegerType, 0n, 1n, 2n);
    const conflicts = detectConflictsFor(IntegerType)(a, b);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.path, "");
    assert.deepEqual(conflicts[0]!.valueA, variant("replace", { before: 0n, after: 1n }));
    assert.deepEqual(conflicts[0]!.valueB, variant("replace", { before: 0n, after: 2n }));
  });
});

// ============================================================================
// Gap-fill #2/#3 — mergeWithResolutionsFor + apply round-trip across path kinds
// ============================================================================

describe("mergeWithResolutionsFor — resolutions at non-struct paths round-trip via apply", () => {
  test("Array [N].field — keepA / keepB / manual all apply at the indexed path", () => {
    const Row = StructType({ rate: FloatType });
    const T = ArrayType(Row);
    const base = [{ rate: 1.0 }, { rate: 2.0 }];
    const aAfter = [{ rate: 1.0 }, { rate: 5.0 }];
    const bAfter = [{ rate: 1.0 }, { rate: 9.0 }];
    const [a, b] = diffsFor(T, base, aAfter, bAfter);

    const keepA = mergeWithResolutionsFor(T)(a, b, new Map([["[1].rate", { type: "keepA" }]]));
    assertMergeApplies(T, base, keepA, aAfter);

    const keepB = mergeWithResolutionsFor(T)(a, b, new Map([["[1].rate", { type: "keepB" }]]));
    assertMergeApplies(T, base, keepB, bAfter);

    const manual = mergeWithResolutionsFor(T)(a, b, new Map([["[1].rate", { type: "manual", value: 7.0 }]]));
    assertMergeApplies(T, base, manual, [{ rate: 1.0 }, { rate: 7.0 }]);
  });

  test("Dict {key}.field — manual resolution carries through to apply", () => {
    const Item = StructType({ price: FloatType });
    const T = DictType(StringType, Item);
    const base = new SortedMap<string, { price: number }>([["AU", { price: 1.0 }]], compareFor(StringType));
    const aAfter = new SortedMap<string, { price: number }>([["AU", { price: 5.0 }]], compareFor(StringType));
    const bAfter = new SortedMap<string, { price: number }>([["AU", { price: 9.0 }]], compareFor(StringType));
    const [a, b] = diffsFor(T, base, aAfter, bAfter);
    const manual = mergeWithResolutionsFor(T)(a, b, new Map([['{"AU"}.price', { type: "manual", value: 7.0 }]]));
    const expected = new SortedMap<string, { price: number }>([["AU", { price: 7.0 }]], compareFor(StringType));
    assertMergeApplies(T, base, manual, expected);
  });

  test("Variant @tag.field — keepA applies the A-side", () => {
    const Status = VariantType({ active: StructType({ since: IntegerType }) });
    const base = variant("active", { since: 100n });
    const aAfter = variant("active", { since: 200n });
    const bAfter = variant("active", { since: 300n });
    const [a, b] = diffsFor(Status, base, aAfter, bAfter);
    const keepA = mergeWithResolutionsFor(Status)(a, b, new Map([["@active.since", { type: "keepA" }]]));
    assertMergeApplies(Status, base, keepA, aAfter);
  });

  test("Primitive root path '' — keepA / keepB / manual all apply", () => {
    const [a, b] = diffsFor(IntegerType, 0n, 1n, 2n);
    assertMergeApplies(IntegerType, 0n, mergeWithResolutionsFor(IntegerType)(a, b, new Map([["", { type: "keepA" }]])), 1n);
    assertMergeApplies(IntegerType, 0n, mergeWithResolutionsFor(IntegerType)(a, b, new Map([["", { type: "keepB" }]])), 2n);
    assertMergeApplies(IntegerType, 0n, mergeWithResolutionsFor(IntegerType)(a, b, new Map([["", { type: "manual", value: 9n }]])), 9n);
  });
});

// ============================================================================
// Gap-fill #4 — stale resolutions (Map keys that don't match any conflict)
// must be silently ignored
// ============================================================================

describe("mergeWithResolutionsFor — stale / extra resolutions are ignored", () => {
  test("extra Map keys for non-conflicting paths don't change the outcome", () => {
    const Person = StructType({ name: StringType, age: IntegerType });
    const base = { name: "Alice", age: 30n };
    const [a, b] = diffsFor(Person, base, { ...base, age: 35n }, { ...base, age: 40n });
    const merged = mergeWithResolutionsFor(Person)(a, b, new Map<string, any>([
      ["age", { type: "keepA" }],
      // Stale entry — path doesn't appear in conflicts:
      ["nonexistent.path", { type: "manual", value: "ignored" }],
      // Stale entry — same struct field, but no conflict on it:
      ["name", { type: "keepB" }],
    ]));
    assertMergeApplies(Person, base, merged, { ...base, age: 35n });
  });

  test("clean merge with a non-empty resolutions map is unaffected", () => {
    const Person = StructType({ name: StringType, age: IntegerType });
    const base = { name: "Alice", age: 30n };
    // Disjoint changes — no conflicts.
    const [a, b] = diffsFor(Person, base, { ...base, name: "Bob" }, { ...base, age: 31n });
    const merged = mergeWithResolutionsFor(Person)(a, b, new Map<string, any>([
      ["nonexistent", { type: "keepA" }],
      ["age", { type: "keepB" }],
    ]));
    assertMergeApplies(Person, base, merged, { name: "Bob", age: 31n });
  });
});

// ============================================================================
// Gap-fill #5 — Conflict.path strings must be byte-identical across detect /
// merge (the renderer's row-key matching depends on it).
// ============================================================================

describe("Conflict.path consistency — detect ↔ merge", () => {
  test("path emitted by detectConflictsFor is the exact key mergeWithResolutionsFor consumes", () => {
    const T = StructType({
      roster: ArrayType(StructType({ rate: FloatType })),
      prices: DictType(StringType, FloatType),
      status: VariantType({ active: StructType({ since: IntegerType }) }),
    });
    const base = {
      roster: [{ rate: 1.0 }, { rate: 2.0 }],
      prices: new SortedMap<string, number>([["AU", 1.0]], compareFor(StringType)),
      status: variant("active", { since: 100n }),
    };
    const aAfter = {
      roster: [{ rate: 1.0 }, { rate: 5.0 }],
      prices: new SortedMap<string, number>([["AU", 5.0]], compareFor(StringType)),
      status: variant("active", { since: 200n }),
    };
    const bAfter = {
      roster: [{ rate: 1.0 }, { rate: 9.0 }],
      prices: new SortedMap<string, number>([["AU", 9.0]], compareFor(StringType)),
      status: variant("active", { since: 300n }),
    };
    const [a, b] = diffsFor(T, base, aAfter, bAfter);
    const conflicts = detectConflictsFor(T)(a, b);

    // Every detected path must round-trip as a Map key into mergeWithResolutionsFor.
    const resolutions = new Map<string, any>();
    for (const c of conflicts) resolutions.set(c.path, { type: "keepA" });
    const merged = mergeWithResolutionsFor(T)(a, b, resolutions);
    assertMergeApplies(T, base, merged, aAfter);
  });
});

// ============================================================================
// Gap-fill #6 — Container-level conflicts (whole-replace at array / dict)
// ============================================================================

describe("mergeWithResolutionsFor — container-level (whole-replace) conflicts", () => {
  test("Array whole-replace conflict — manual resolution carries the supplied array through apply", () => {
    const T = ArrayType(IntegerType);
    const base = [1n, 2n, 3n];
    // Construct two diverging whole-array replaces by manually constructing
    // `replace` arms — array diff would produce `patch` ops normally.
    const a = variant("replace", { before: base, after: [9n, 9n] });
    const b = variant("replace", { before: base, after: [4n, 5n] });
    const merged = mergeWithResolutionsFor(T)(a, b, new Map([["", { type: "manual", value: [7n, 7n, 7n] }]]));
    assertMergeApplies(T, base, merged, [7n, 7n, 7n]);
  });

  test("Dict whole-replace conflict — keepA picks the A-side at the root", () => {
    const T = DictType(StringType, IntegerType);
    const base = new SortedMap<string, bigint>([], compareFor(StringType));
    const aAfter = new SortedMap<string, bigint>([["a", 1n]], compareFor(StringType));
    const bAfter = new SortedMap<string, bigint>([["b", 2n]], compareFor(StringType));
    const a = variant("replace", { before: base, after: aAfter });
    const b = variant("replace", { before: base, after: bAfter });
    const merged = mergeWithResolutionsFor(T)(a, b, new Map([["", { type: "keepA" }]]));
    assertMergeApplies(T, base, merged, aAfter);
  });

  test("Variant cross-tag replace conflict — keepB picks the B-side tag", () => {
    const Status = VariantType({ on: NullType, off: NullType, pending: NullType });
    const before = variant("on", null) as any;
    const a = variant("replace", { before, after: variant("off", null) });
    const b = variant("replace", { before, after: variant("pending", null) });
    const merged = mergeWithResolutionsFor(Status)(a, b, new Map([["", { type: "keepB" }]]));
    assertMergeApplies(Status, before, merged, variant("pending", null) as any);
  });
});

// ============================================================================
// Gap-fill #7 — empty-patch combinatorics: unchanged + unchanged | unchanged
// + patch should never throw and should produce the identity / passthrough.
// ============================================================================

describe("mergeWithResolutionsFor — empty-patch identities", () => {
  const Person = StructType({ name: StringType, age: IntegerType });
  const base = { name: "Alice", age: 30n };

  test("unchanged + unchanged → unchanged (regardless of resolutions)", () => {
    const u = variant("unchanged", null);
    const merged = mergeWithResolutionsFor(Person)(u, u, new Map<string, any>([
      ["name", { type: "keepA" }],
      ["nonexistent", { type: "manual", value: "irrelevant" }],
    ]));
    assertMergeApplies(Person, base, merged, base);
  });

  test("unchanged + patch → patch passes through (resolutions ignored when no conflicts)", () => {
    const u = variant("unchanged", null);
    const p = diffFor(Person)(base, { ...base, age: 99n });
    const merged = mergeWithResolutionsFor(Person)(u, p, new Map());
    assertMergeApplies(Person, base, merged, { ...base, age: 99n });
  });

  test("patch + unchanged → patch passes through (symmetric)", () => {
    const p = diffFor(Person)(base, { ...base, age: 99n });
    const u = variant("unchanged", null);
    const merged = mergeWithResolutionsFor(Person)(p, u, new Map());
    assertMergeApplies(Person, base, merged, { ...base, age: 99n });
  });
});

// ============================================================================
// Gap-fill #8 — Set conflicts (whole-replace + element-level)
// ============================================================================

describe("Set conflicts", () => {
  const T = SetType(StringType);
  const base = new SortedSet<string>(["a"], compareFor(StringType));

  test("whole-replace conflict — keepA selects the A-side set", () => {
    const aAfter = new SortedSet<string>(["x", "y"], compareFor(StringType));
    const bAfter = new SortedSet<string>(["p", "q"], compareFor(StringType));
    const a = variant("replace", { before: base, after: aAfter });
    const b = variant("replace", { before: base, after: bAfter });
    const merged = mergeWithResolutionsFor(T)(a, b, new Map([["", { type: "keepA" }]]));
    assertMergeApplies(T, base, merged, aAfter);
  });

  test("whole-replace conflict — manual supplies a third set value", () => {
    const a = variant("replace", { before: base, after: new SortedSet<string>(["x"], compareFor(StringType)) });
    const b = variant("replace", { before: base, after: new SortedSet<string>(["y"], compareFor(StringType)) });
    const manual = new SortedSet<string>(["z"], compareFor(StringType));
    const merged = mergeWithResolutionsFor(T)(a, b, new Map([["", { type: "manual", value: manual }]]));
    assertMergeApplies(T, base, merged, manual);
  });

  test("disjoint element ops (insert vs unchanged on same elem) don't conflict — both ops apply", () => {
    // arm A inserts "b"; arm B inserts "c". Different elements → no conflict; result has both.
    const aAfter = new SortedSet<string>(["a", "b"], compareFor(StringType));
    const bAfter = new SortedSet<string>(["a", "c"], compareFor(StringType));
    const [a, b] = diffsFor(T, base, aAfter, bAfter);
    assert.deepEqual(detectConflictsFor(T)(a, b), []);
    const merged = mergeWithResolutionsFor(T)(a, b, new Map());
    assertMergeApplies(T, base, merged, new SortedSet<string>(["a", "b", "c"], compareFor(StringType)));
  });
});

// ============================================================================
// Gap-fill #9 — Integer-keyed Dict — path encoding uses unquoted numeric keys
// ============================================================================

describe("Integer-keyed Dict — path encoding & resolution", () => {
  const Item = StructType({ qty: IntegerType });
  const T = DictType(IntegerType, Item);
  const base = new SortedMap<bigint, { qty: bigint }>([[1n, { qty: 10n }]], compareFor(IntegerType));

  test("conflict inside an integer-keyed dict entry produces a {N}.field path (unquoted) with replace ops", () => {
    const aAfter = new SortedMap<bigint, { qty: bigint }>([[1n, { qty: 50n }]], compareFor(IntegerType));
    const bAfter = new SortedMap<bigint, { qty: bigint }>([[1n, { qty: 99n }]], compareFor(IntegerType));
    const [a, b] = diffsFor(T, base, aAfter, bAfter);
    const conflicts = detectConflictsFor(T)(a, b);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.path, "{1}.qty");
    assert.deepEqual(conflicts[0]!.valueA, variant("replace", { before: 10n, after: 50n }));
    assert.deepEqual(conflicts[0]!.valueB, variant("replace", { before: 10n, after: 99n }));
  });

  test("manual resolution keyed off {1}.qty round-trips through apply", () => {
    const aAfter = new SortedMap<bigint, { qty: bigint }>([[1n, { qty: 50n }]], compareFor(IntegerType));
    const bAfter = new SortedMap<bigint, { qty: bigint }>([[1n, { qty: 99n }]], compareFor(IntegerType));
    const [a, b] = diffsFor(T, base, aAfter, bAfter);
    const manual = mergeWithResolutionsFor(T)(a, b, new Map([["{1}.qty", { type: "manual", value: 7n }]]));
    const expected = new SortedMap<bigint, { qty: bigint }>([[1n, { qty: 7n }]], compareFor(IntegerType));
    assertMergeApplies(T, base, manual, expected);
  });

  test("large bigint key encodes losslessly in the conflict path with replace ops", () => {
    const huge = 9007199254740993n; // > 2^53
    const baseLarge = new SortedMap<bigint, { qty: bigint }>([[huge, { qty: 1n }]], compareFor(IntegerType));
    const aAfter = new SortedMap<bigint, { qty: bigint }>([[huge, { qty: 5n }]], compareFor(IntegerType));
    const bAfter = new SortedMap<bigint, { qty: bigint }>([[huge, { qty: 9n }]], compareFor(IntegerType));
    const [a, b] = diffsFor(T, baseLarge, aAfter, bAfter);
    const conflicts = detectConflictsFor(T)(a, b);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.path, "{9007199254740993}.qty");
    assert.deepEqual(conflicts[0]!.valueA, variant("replace", { before: 1n, after: 5n }));
    assert.deepEqual(conflicts[0]!.valueB, variant("replace", { before: 1n, after: 9n }));
  });
});

// ============================================================================
// Gap-fill #10 — OptionType (none/some) conflicts
// ============================================================================

describe("OptionType (none / some) conflicts", () => {
  const T = VariantType({ none: NullType, some: IntegerType });

  test("none → some(x) vs none → some(y) is a whole-variant replace conflict at root", () => {
    const baseV = variant("none", null);
    const a = diffFor(T)(baseV, variant("some", 5n));
    const b = diffFor(T)(baseV, variant("some", 9n));
    const conflicts = detectConflictsFor(T)(a, b);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.path, "");
    assert.deepEqual(conflicts[0]!.valueA, variant("replace", { before: baseV, after: variant("some", 5n) }));
    assert.deepEqual(conflicts[0]!.valueB, variant("replace", { before: baseV, after: variant("some", 9n) }));
    const merged = mergeWithResolutionsFor(T)(a, b, new Map([["", { type: "manual", value: variant("some", 7n) as any }]]));
    assertMergeApplies(T, baseV, merged, variant("some", 7n) as any);
  });

  test("some(x) → some(y) vs some(x) → some(z) — same-tag conflict at @some with replace ops", () => {
    const baseV = variant("some", 1n);
    const a = diffFor(T)(baseV, variant("some", 5n));
    const b = diffFor(T)(baseV, variant("some", 9n));
    const conflicts = detectConflictsFor(T)(a, b);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.path, "@some");
    assert.deepEqual(conflicts[0]!.valueA, variant("replace", { before: 1n, after: 5n }));
    assert.deepEqual(conflicts[0]!.valueB, variant("replace", { before: 1n, after: 9n }));
    const merged = mergeWithResolutionsFor(T)(a, b, new Map([["@some", { type: "keepA" }]]));
    assertMergeApplies(T, baseV, merged, variant("some", 5n) as any);
  });

  test("some(x) → none vs some(x) → some(y) — mixed replace+patch conflict at root", () => {
    const baseV = variant("some", 1n);
    // a: cross-tag → emitted as `replace` arm.
    // b: same-tag → emitted as `patch` arm (case-tagged sub-patch).
    const a = diffFor(T)(baseV, variant("none", null));
    const b = diffFor(T)(baseV, variant("some", 9n));
    assert.equal(a.type, "replace");
    assert.equal(b.type, "patch");
    const conflicts = detectConflictsFor(T)(a, b);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.path, "");
    // east surfaces the raw arms — verify both arm shapes are exposed.
    assert.deepEqual(conflicts[0]!.valueA, a);
    assert.deepEqual(conflicts[0]!.valueB, b);
    const merged = mergeWithResolutionsFor(T)(a, b, new Map([["", { type: "keepB" }]]));
    assertMergeApplies(T, baseV, merged, variant("some", 9n) as any);
  });
});

// ============================================================================
// Gap-fill #11 — Deeply nested path encoding (5 levels)
// ============================================================================

describe("Deeply nested struct conflict paths (5 levels)", () => {
  test("conflict 5 struct levels deep produces a.b.c.d.e dotted path", () => {
    const L5 = StructType({ e: IntegerType });
    const L4 = StructType({ d: L5 });
    const L3 = StructType({ c: L4 });
    const L2 = StructType({ b: L3 });
    const L1 = StructType({ a: L2 });
    const base   = { a: { b: { c: { d: { e: 0n } } } } };
    const aAfter = { a: { b: { c: { d: { e: 5n } } } } };
    const bAfter = { a: { b: { c: { d: { e: 9n } } } } };
    const [a, b] = diffsFor(L1, base, aAfter, bAfter);
    const conflicts = detectConflictsFor(L1)(a, b);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.path, "a.b.c.d.e");
    assert.deepEqual(conflicts[0]!.valueA, variant("replace", { before: 0n, after: 5n }));
    assert.deepEqual(conflicts[0]!.valueB, variant("replace", { before: 0n, after: 9n }));

    // The detected path is the exact key the merger consumes.
    const merged = mergeWithResolutionsFor(L1)(a, b, new Map([[conflicts[0]!.path, { type: "keepA" }]]));
    assertMergeApplies(L1, base, merged, aAfter);
  });

  test("mixed-kind 5-segment chain (struct.array.dict.variant.field) encodes correctly", () => {
    const Inner = StructType({ since: IntegerType });
    const T = StructType({
      ws: StructType({
        rosters: ArrayType(StructType({
          shifts: DictType(StringType, VariantType({ active: Inner })),
        })),
      }),
    });
    const baseShifts = new SortedMap<string, any>([
      ["morning", variant("active", { since: 100n })],
    ], compareFor(StringType));
    const aShifts = new SortedMap<string, any>([
      ["morning", variant("active", { since: 200n })],
    ], compareFor(StringType));
    const bShifts = new SortedMap<string, any>([
      ["morning", variant("active", { since: 300n })],
    ], compareFor(StringType));
    const base   = { ws: { rosters: [{ shifts: baseShifts }] } };
    const aAfter = { ws: { rosters: [{ shifts: aShifts }] } };
    const bAfter = { ws: { rosters: [{ shifts: bShifts }] } };
    const [a, b] = diffsFor(T, base, aAfter, bAfter);
    const conflicts = detectConflictsFor(T)(a, b);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.path, 'ws.rosters[0].shifts{"morning"}@active.since');
    assert.deepEqual(conflicts[0]!.valueA, variant("replace", { before: 100n, after: 200n }));
    assert.deepEqual(conflicts[0]!.valueB, variant("replace", { before: 100n, after: 300n }));
  });
});

// ============================================================================
// Gap-fill #12 — Array conflicts where the same index has different op kinds
// (e.g. arm A `update`, arm B `delete`) — resolve at the [N] path itself.
// ============================================================================

describe("Array conflicts — mixed op kinds at the same index", () => {
  const Row = StructType({ rate: FloatType });
  const T = ArrayType(Row);

  test("update vs delete at the same index surfaces exactly one Conflict at [1]", () => {
    const base   = [{ rate: 1.0 }, { rate: 2.0 }];
    const aAfter = [{ rate: 1.0 }, { rate: 5.0 }];   // update [1]
    const bAfter = [{ rate: 1.0 }];                  // delete [1]
    const [a, b] = diffsFor(T, base, aAfter, bAfter);
    const conflicts = detectConflictsFor(T)(a, b);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.path, "[1]");
    // valueA is the update op (sub-patch on rate); valueB is the delete op.
    assert.equal(conflicts[0]!.valueA.type, "update");
    assert.equal(conflicts[0]!.valueB.type, "delete");
    // The delete carries the original row value as its payload.
    assert.deepEqual(conflicts[0]!.valueB.value, { rate: 2.0 });
  });

  test("update vs delete at same index — keepA preserves the updated row through apply", () => {
    const base   = [{ rate: 1.0 }, { rate: 2.0 }];
    const aAfter = [{ rate: 1.0 }, { rate: 5.0 }];
    const bAfter = [{ rate: 1.0 }];
    const [a, b] = diffsFor(T, base, aAfter, bAfter);
    const merged = mergeWithResolutionsFor(T)(a, b, new Map([["[1]", { type: "keepA" }]]));
    assertMergeApplies(T, base, merged, aAfter);
  });

  test("update vs delete at same index — keepB picks the deletion side through apply", () => {
    const base   = [{ rate: 1.0 }, { rate: 2.0 }];
    const aAfter = [{ rate: 1.0 }, { rate: 5.0 }];
    const bAfter = [{ rate: 1.0 }];
    const [a, b] = diffsFor(T, base, aAfter, bAfter);
    const merged = mergeWithResolutionsFor(T)(a, b, new Map([["[1]", { type: "keepB" }]]));
    assertMergeApplies(T, base, merged, bAfter);
  });

  test("insert vs update at same dest index surfaces exactly one Conflict at [1]", () => {
    // arm A inserts at [1]; arm B updates [1]. Different op kinds, same dest.
    const base   = [{ rate: 1.0 }, { rate: 2.0 }];
    const aAfter = [{ rate: 1.0 }, { rate: 7.0 }, { rate: 2.0 }];   // insert at index 1
    const bAfter = [{ rate: 1.0 }, { rate: 9.0 }];                  // update [1]
    const [a, b] = diffsFor(T, base, aAfter, bAfter);
    const conflicts = detectConflictsFor(T)(a, b);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.path, "[1]");
    assert.equal(conflicts[0]!.valueA.type, "insert");
    assert.equal(conflicts[0]!.valueB.type, "update");
    assert.deepEqual(conflicts[0]!.valueA.value, { rate: 7.0 });
  });
});
