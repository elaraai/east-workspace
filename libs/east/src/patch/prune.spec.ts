/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    NullType, BooleanType, IntegerType, FloatType, StringType, DateTimeType, BlobType,
    ArrayType, SetType, DictType, StructType, VariantType, RefType,
    VectorType, OptionType,
} from "../types.js";
import { variant } from "../containers/variant.js";
import { SortedSet } from "../containers/sortedset.js";
import { SortedMap } from "../containers/sortedmap.js";
import { ref } from "../containers/ref.js";
import { compareFor, equalFor } from "../comparison.js";

import { diffFor } from "./diff.js";
import { applyFor } from "./apply.js";
import { prunePatchFor } from "./prune.js";
import { pathToString } from "./path.js";

// ============================================================================
// Round-trip invariants — keep-all is identity, keep-none is no-op
// ============================================================================

describe("prunePatchFor: invariants", () => {
    test("keep=>true is identity (apply matches unpruned)", () => {
        const T = StructType({ a: IntegerType, b: FloatType });
        const before = { a: 1n, b: 1.0 };
        const after  = { a: 2n, b: 2.0 };
        const p = diffFor(T)(before, after);
        const pruned = prunePatchFor(T)(p, () => true);
        assert.ok(equalFor(T)(applyFor(T)(before, pruned), after));
    });

    test("keep=>false on a non-trivial patch collapses to unchanged", () => {
        const T = StructType({ a: IntegerType, b: FloatType });
        const p = diffFor(T)({ a: 1n, b: 1.0 }, { a: 2n, b: 2.0 });
        const pruned = prunePatchFor(T)(p, () => false);
        assert.equal(pruned.type, "unchanged");
    });

    test("apply(prune(p, () => false)) is the original value", () => {
        const T = StructType({ a: IntegerType, b: FloatType });
        const before = { a: 1n, b: 1.0 };
        const p = diffFor(T)(before, { a: 2n, b: 2.0 });
        const pruned = prunePatchFor(T)(p, () => false);
        assert.ok(equalFor(T)(applyFor(T)(before, pruned), before));
    });

    test("pruning an unchanged patch is still unchanged regardless of predicate", () => {
        const p = diffFor(IntegerType)(5n, 5n);
        assert.equal(prunePatchFor(IntegerType)(p, () => true).type, "unchanged");
        assert.equal(prunePatchFor(IntegerType)(p, () => false).type, "unchanged");
    });
});

// ============================================================================
// Primitives — replace ops are kept or collapsed wholesale
// ============================================================================

describe("prunePatchFor: primitives", () => {
    test("Integer replace kept", () => {
        const p = diffFor(IntegerType)(5n, 10n);
        assert.equal(prunePatchFor(IntegerType)(p, () => true).type, "replace");
    });

    test("Integer replace pruned", () => {
        const p = diffFor(IntegerType)(5n, 10n);
        assert.equal(prunePatchFor(IntegerType)(p, () => false).type, "unchanged");
    });

    test("predicate receives the empty path for primitive replace", () => {
        const p = diffFor(IntegerType)(5n, 10n);
        const seen: string[] = [];
        prunePatchFor(IntegerType)(p, path => { seen.push(pathToString(path)); return true; });
        assert.deepEqual(seen, [""]);
    });

    for (const [name, T, a, b] of [
        ["Null", NullType, null, null],
        ["Boolean", BooleanType, true, false],
        ["Integer", IntegerType, 1n, 2n],
        ["Float", FloatType, 1.0, 2.0],
        ["String", StringType, "a", "b"],
        ["DateTime", DateTimeType, new Date(0), new Date(1000)],
        ["Blob", BlobType, new Uint8Array([1]), new Uint8Array([2])],
    ] as const) {
        test(`${name}: keep=>true round-trips through apply`, () => {
            const p = diffFor(T as any)(a, b);
            const pruned = prunePatchFor(T as any)(p, () => true);
            assert.ok(equalFor(T as any)(applyFor(T as any)(a, pruned), b));
        });
        test(`${name}: keep=>false leaves the value at 'before'`, () => {
            const p = diffFor(T as any)(a, b);
            const pruned = prunePatchFor(T as any)(p, () => false);
            assert.ok(equalFor(T as any)(applyFor(T as any)(a, pruned), a));
        });
    }

    test("Vector: keep=>true round-trips", () => {
        const T = VectorType(FloatType);
        const before = new Float64Array([1.0, 2.0]);
        const after  = new Float64Array([3.0, 4.0]);
        const p = diffFor(T)(before, after);
        const pruned = prunePatchFor(T)(p, () => true);
        assert.ok(equalFor(T)(applyFor(T)(before, pruned), after));
    });

    test("Vector: keep=>false collapses", () => {
        const T = VectorType(FloatType);
        const p = diffFor(T)(new Float64Array([1.0, 2.0]), new Float64Array([3.0, 4.0]));
        assert.equal(prunePatchFor(T)(p, () => false).type, "unchanged");
    });
});

// ============================================================================
// Struct
// ============================================================================

describe("prunePatchFor: Struct", () => {
    test("pruning one field leaves siblings intact", () => {
        const T = StructType({ a: IntegerType, b: IntegerType });
        const before = { a: 1n, b: 1n };
        const p = diffFor(T)(before, { a: 2n, b: 2n });
        const pruned = prunePatchFor(T)(p, path => pathToString(path) !== "a");
        const result = applyFor(T)(before, pruned);
        assert.equal(result.a, 1n);
        assert.equal(result.b, 2n);
    });

    test("pruning every field collapses container to unchanged", () => {
        const T = StructType({ a: IntegerType, b: IntegerType });
        const p = diffFor(T)({ a: 1n, b: 1n }, { a: 2n, b: 2n });
        const pruned = prunePatchFor(T)(p, () => false);
        assert.equal(pruned.type, "unchanged");
    });

    test("nested struct: pruning a nested field leaves outer changes intact", () => {
        const Inner = StructType({ x: IntegerType, y: IntegerType });
        const Outer = StructType({ name: StringType, inner: Inner });
        const before = { name: "a", inner: { x: 1n, y: 1n } };
        const p = diffFor(Outer)(before, { name: "b", inner: { x: 2n, y: 2n } });
        const pruned = prunePatchFor(Outer)(p, path => pathToString(path) !== "inner.y");
        const result = applyFor(Outer)(before, pruned);
        assert.equal(result.name, "b");
        assert.equal(result.inner.x, 2n);
        assert.equal(result.inner.y, 1n);
    });

    test("pruning every nested field collapses outer container too", () => {
        const Inner = StructType({ x: IntegerType, y: IntegerType });
        const Outer = StructType({ inner: Inner });
        const p = diffFor(Outer)({ inner: { x: 1n, y: 1n } }, { inner: { x: 2n, y: 2n } });
        const pruned = prunePatchFor(Outer)(p, () => false);
        assert.equal(pruned.type, "unchanged");
    });

    test("3-deep nesting: predicate sees deeply qualified paths", () => {
        const L3 = StructType({ z: IntegerType });
        const L2 = StructType({ inner: L3 });
        const L1 = StructType({ outer: L2 });
        const seen: string[] = [];
        const p = diffFor(L1)({ outer: { inner: { z: 1n } } }, { outer: { inner: { z: 2n } } });
        prunePatchFor(L1)(p, path => { seen.push(pathToString(path)); return true; });
        assert.ok(seen.includes("outer.inner.z"));
    });

    test("struct with all primitive types: selectively keep one", () => {
        const T = StructType({
            s: StringType, i: IntegerType, f: FloatType, b: BooleanType,
        });
        const before = { s: "a", i: 1n, f: 1.0, b: false };
        const after  = { s: "b", i: 2n, f: 2.0, b: true };
        const p = diffFor(T)(before, after);
        const pruned = prunePatchFor(T)(p, path => pathToString(path) === "i");
        const result = applyFor(T)(before, pruned);
        assert.equal(result.s, "a");
        assert.equal(result.i, 2n);
        assert.equal(result.f, 1.0);
        assert.equal(result.b, false);
    });
});

// ============================================================================
// Array
// ============================================================================

describe("prunePatchFor: Array", () => {
    test("pruning every leaf inside an element collapses to unchanged", () => {
        const Row = StructType({ id: StringType, n: IntegerType });
        const T = ArrayType(Row);
        const before = [{ id: "a", n: 1n }, { id: "b", n: 2n }];
        const p = diffFor(T)(before, [{ id: "a", n: 1n }, { id: "b", n: 99n }]);
        const pruned = prunePatchFor(T)(p, path => !pathToString(path).startsWith("[1]"));
        assert.equal(pruned.type, "unchanged");
    });

    test("keep one of two element changes (paired updates)", () => {
        const Row = StructType({ rate: FloatType });
        const T = ArrayType(Row);
        const before = [{ rate: 1.0 }, { rate: 2.0 }];
        const p = diffFor(T)(before, [{ rate: 1.5 }, { rate: 2.5 }]);
        const pruned = prunePatchFor(T)(p, path => !pathToString(path).startsWith("[0]"));
        const result = applyFor(T)(before, pruned);
        assert.equal(result[0]!.rate, 1.0);
        assert.equal(result[1]!.rate, 2.5);
    });

    test("pruning a pure insert (no pair) drops it", () => {
        const T = ArrayType(IntegerType);
        const before = [1n, 2n];
        const p = diffFor(T)(before, [1n, 2n, 3n]);
        const pruned = prunePatchFor(T)(p, () => false);
        assert.equal(pruned.type, "unchanged");
        assert.deepEqual(applyFor(T)(before, pruned), [1n, 2n]);
    });

    test("pruning a pure delete (no pair) drops it", () => {
        const T = ArrayType(IntegerType);
        const before = [1n, 2n, 3n];
        const p = diffFor(T)(before, [1n, 3n]);
        const pruned = prunePatchFor(T)(p, () => false);
        assert.equal(pruned.type, "unchanged");
        assert.deepEqual(applyFor(T)(before, pruned), [1n, 2n, 3n]);
    });

    test("clear-all then keep-all → applies the clear", () => {
        const T = ArrayType(IntegerType);
        const before = [1n, 2n, 3n];
        const p = diffFor(T)(before, []);
        const pruned = prunePatchFor(T)(p, () => true);
        assert.deepEqual(applyFor(T)(before, pruned), []);
    });

    test("array of arrays: nested index path lookups", () => {
        const T = ArrayType(ArrayType(IntegerType));
        const before = [[1n, 2n], [3n, 4n]];
        const p = diffFor(T)(before, [[1n, 9n], [3n, 4n]]);
        const pruned = prunePatchFor(T)(p, path => !pathToString(path).startsWith("[0]"));
        assert.equal(pruned.type, "unchanged");
    });

    test("array of structs: prune one inner field per row", () => {
        const Row = StructType({ a: IntegerType, b: IntegerType });
        const T = ArrayType(Row);
        const before = [{ a: 1n, b: 1n }];
        const p = diffFor(T)(before, [{ a: 2n, b: 2n }]);
        const pruned = prunePatchFor(T)(p, path => pathToString(path) !== "[0].a");
        const result = applyFor(T)(before, pruned);
        assert.equal(result[0]!.a, 1n);
        assert.equal(result[0]!.b, 2n);
    });
});

// ============================================================================
// Dict
// ============================================================================

describe("prunePatchFor: Dict", () => {
    const T = DictType(StringType, FloatType);

    test("pruning one key leaves others intact", () => {
        const before = new SortedMap([["AU", 49.95], ["US", 39.95]], compareFor(StringType));
        const p = diffFor(T)(before, new SortedMap([["AU", 55.00], ["US", 45.00]], compareFor(StringType)));
        const pruned = prunePatchFor(T)(p, path => pathToString(path) !== '{"AU"}');
        const result = applyFor(T)(before, pruned);
        assert.equal(result.get("AU"), 49.95);
        assert.equal(result.get("US"), 45.00);
    });

    test("pruning all dict updates collapses to unchanged", () => {
        const p = diffFor(T)(
            new SortedMap([["AU", 49.95], ["US", 39.95]], compareFor(StringType)),
            new SortedMap([["AU", 55.00], ["US", 45.00]], compareFor(StringType)),
        );
        assert.equal(prunePatchFor(T)(p, () => false).type, "unchanged");
    });

    test("dict insert preserved when keep is true", () => {
        const before = new SortedMap<string, number>([], compareFor(StringType));
        const p = diffFor(T)(before, new SortedMap([["AU", 50.00]], compareFor(StringType)));
        const pruned = prunePatchFor(T)(p, () => true);
        const result = applyFor(T)(before, pruned);
        assert.equal(result.get("AU"), 50.00);
    });

    test("dict insert dropped when keep returns false", () => {
        const before = new SortedMap<string, number>([], compareFor(StringType));
        const p = diffFor(T)(before, new SortedMap([["AU", 50.00]], compareFor(StringType)));
        const pruned = prunePatchFor(T)(p, () => false);
        assert.equal(pruned.type, "unchanged");
    });

    test("dict delete preserved when keep is true", () => {
        const before = new SortedMap([["AU", 50.00]], compareFor(StringType));
        const p = diffFor(T)(before, new SortedMap<string, number>([], compareFor(StringType)));
        const pruned = prunePatchFor(T)(p, () => true);
        const result = applyFor(T)(before, pruned);
        assert.equal(result.size, 0);
    });

    test("dict delete dropped when keep returns false", () => {
        const before = new SortedMap([["AU", 50.00]], compareFor(StringType));
        const p = diffFor(T)(before, new SortedMap<string, number>([], compareFor(StringType)));
        const pruned = prunePatchFor(T)(p, () => false);
        assert.equal(pruned.type, "unchanged");
    });

    test("dict-of-struct: prune one inner field via path", () => {
        const Item = StructType({ price: FloatType, qty: IntegerType });
        const D = DictType(StringType, Item);
        const before = new SortedMap([["A", { price: 1.0, qty: 1n }]], compareFor(StringType));
        const p = diffFor(D)(before, new SortedMap([["A", { price: 1.5, qty: 5n }]], compareFor(StringType)));
        const pruned = prunePatchFor(D)(p, path => pathToString(path) !== '{"A"}.qty');
        const result = applyFor(D)(before, pruned);
        const a = result.get("A")!;
        assert.equal(a.price, 1.5);
        assert.equal(a.qty, 1n);
    });

    test("Integer-keyed dict: predicate sees non-quoted numeric keys", () => {
        const D = DictType(IntegerType, StringType);
        const before = new SortedMap([[1n, "a"]], compareFor(IntegerType));
        const p = diffFor(D)(before, new SortedMap([[1n, "b"]], compareFor(IntegerType)));
        const seen: string[] = [];
        prunePatchFor(D)(p, path => { seen.push(pathToString(path)); return true; });
        assert.ok(seen.includes("{1}"));
    });
});

// ============================================================================
// Set
// ============================================================================

describe("prunePatchFor: Set", () => {
    const T = SetType(StringType);

    test("keep all preserves the patch (applies to a)", () => {
        const before = new SortedSet<string>(["a"], compareFor(StringType));
        const p = diffFor(T)(before, new SortedSet<string>(["a", "b"], compareFor(StringType)));
        const pruned = prunePatchFor(T)(p, () => true);
        assert.ok(equalFor(T)(applyFor(T)(before, pruned),
            new SortedSet<string>(["a", "b"], compareFor(StringType))));
    });

    test("keep none collapses", () => {
        const p = diffFor(T)(
            new SortedSet<string>(["a"], compareFor(StringType)),
            new SortedSet<string>(["a", "b"], compareFor(StringType)),
        );
        assert.equal(prunePatchFor(T)(p, () => false).type, "unchanged");
    });

    test("partial keep — only preserve the insert, drop the delete", () => {
        const before = new SortedSet<string>(["a", "b"], compareFor(StringType));
        const p = diffFor(T)(before, new SortedSet<string>(["b", "c"], compareFor(StringType)));
        const pruned = prunePatchFor(T)(p, path => pathToString(path) === '{"c"}');
        const result = applyFor(T)(before, pruned);
        assert.ok(equalFor(T)(result, new SortedSet<string>(["a", "b", "c"], compareFor(StringType))));
    });

    test("partial keep — drop insert, preserve the delete", () => {
        const before = new SortedSet<string>(["a", "b"], compareFor(StringType));
        const p = diffFor(T)(before, new SortedSet<string>(["b", "c"], compareFor(StringType)));
        const pruned = prunePatchFor(T)(p, path => pathToString(path) === '{"a"}');
        const result = applyFor(T)(before, pruned);
        assert.ok(equalFor(T)(result, new SortedSet<string>(["b"], compareFor(StringType))));
    });

    test("Set of integers: prune by numeric path", () => {
        const Int = SetType(IntegerType);
        const before = new SortedSet<bigint>([1n, 2n], compareFor(IntegerType));
        const p = diffFor(Int)(before, new SortedSet<bigint>([1n, 2n, 3n], compareFor(IntegerType)));
        const pruned = prunePatchFor(Int)(p, path => pathToString(path) !== "{3}");
        assert.equal(pruned.type, "unchanged");
    });
});

// ============================================================================
// Variant
// ============================================================================

describe("prunePatchFor: Variant", () => {
    test("pruning the inner case-patch collapses to unchanged", () => {
        const T = VariantType({
            pending: NullType,
            active:  StructType({ since: IntegerType }),
        });
        const p = diffFor(T)(variant("active", { since: 100n }), variant("active", { since: 200n }));
        const pruned = prunePatchFor(T)(p, () => false);
        assert.equal(pruned.type, "unchanged");
    });

    test("same-tag sub-patch survives if its inner field is kept", () => {
        const T = VariantType({
            active: StructType({ a: IntegerType, b: IntegerType }),
        });
        const before = variant("active", { a: 1n, b: 1n });
        const p = diffFor(T)(before, variant("active", { a: 2n, b: 2n }));
        const pruned = prunePatchFor(T)(p, path => pathToString(path) !== "@active.a");
        const result = applyFor(T)(before, pruned);
        const inner = result.value as { a: bigint; b: bigint };
        assert.equal(inner.a, 1n);
        assert.equal(inner.b, 2n);
    });

    test("tag change kept", () => {
        const T = VariantType({ pending: NullType, complete: NullType });
        const before = variant("pending", null);
        const p = diffFor(T)(before, variant("complete", null));
        const pruned = prunePatchFor(T)(p, () => true);
        const result = applyFor(T)(before, pruned);
        assert.equal(result.type, "complete");
    });

    test("tag change pruned", () => {
        const T = VariantType({ pending: NullType, complete: NullType });
        const before = variant("pending", null);
        const p = diffFor(T)(before, variant("complete", null));
        const pruned = prunePatchFor(T)(p, () => false);
        assert.equal(pruned.type, "unchanged");
    });

    test("OptionType: none → some kept", () => {
        const T = OptionType(IntegerType);
        const before = variant("none", null);
        const p = diffFor(T)(before, variant("some", 42n));
        const pruned = prunePatchFor(T)(p, () => true);
        const result = applyFor(T)(before, pruned);
        assert.equal(result.type, "some");
        assert.equal(result.value, 42n);
    });

    test("OptionType: none → some pruned", () => {
        const T = OptionType(IntegerType);
        const before = variant("none", null);
        const p = diffFor(T)(before, variant("some", 42n));
        const pruned = prunePatchFor(T)(p, () => false);
        assert.equal(pruned.type, "unchanged");
    });

    test("OptionType: some → none kept", () => {
        const T = OptionType(IntegerType);
        const before = variant("some", 5n);
        const p = diffFor(T)(before, variant("none", null));
        const pruned = prunePatchFor(T)(p, () => true);
        const result = applyFor(T)(before, pruned);
        assert.equal(result.type, "none");
    });

    test("OptionType: some(a) → some(b) prune-all collapses", () => {
        const T = OptionType(IntegerType);
        const before = variant("some", 1n);
        const p = diffFor(T)(before, variant("some", 2n));
        const pruned = prunePatchFor(T)(p, () => false);
        assert.equal(pruned.type, "unchanged");
    });
});

// ============================================================================
// Ref
// ============================================================================

describe("prunePatchFor: Ref", () => {
    test("Ref of struct: prune inner field leaves siblings intact", () => {
        const T = RefType(StructType({ x: IntegerType, y: IntegerType }));
        const before = ref({ x: 1n, y: 1n });
        const p = diffFor(T)(before, ref({ x: 2n, y: 2n }));
        const pruned = prunePatchFor(T)(p, path => pathToString(path) !== "y");
        const result = applyFor(T)(before, pruned);
        const v = result.value as { x: bigint; y: bigint };
        assert.equal(v.x, 2n);
        assert.equal(v.y, 1n);
    });

    test("Ref of primitive: prune-all collapses", () => {
        const T = RefType(IntegerType);
        const p = diffFor(T)(ref(1n), ref(2n));
        const pruned = prunePatchFor(T)(p, () => false);
        assert.equal(pruned.type, "unchanged");
    });

    test("Ref of array: inner index paths reach the leaves", () => {
        const T = RefType(ArrayType(IntegerType));
        const before = ref([1n, 2n]);
        const p = diffFor(T)(before, ref([1n, 9n]));
        const pruned = prunePatchFor(T)(p, path => pathToString(path) !== "[1]");
        const result = applyFor(T)(before, pruned);
        const arr = result.value as bigint[];
        assert.deepEqual(arr, [1n, 2n]);
    });

    test("Ref of dict: inner key paths reach the leaves", () => {
        const T = RefType(DictType(StringType, IntegerType));
        const before = ref(new SortedMap([["a", 1n]], compareFor(StringType)));
        const p = diffFor(T)(before, ref(new SortedMap([["a", 2n]], compareFor(StringType))));
        const pruned = prunePatchFor(T)(p, path => pathToString(path) !== '{"a"}');
        const result = applyFor(T)(before, pruned);
        const d = result.value as SortedMap<string, bigint>;
        assert.equal(d.get("a"), 1n);
    });

    test("Ref of Ref: both layers unwrap and prune correctly", () => {
        const T = RefType(RefType(IntegerType));
        const p = diffFor(T)(ref(ref(1n)), ref(ref(2n)));
        const pruned = prunePatchFor(T)(p, () => false);
        assert.equal(pruned.type, "unchanged");
    });
});

// ============================================================================
// Apply round-trip across all container types — the big invariant
// ============================================================================

describe("prunePatchFor: round-trip across types", () => {
    const cases: Array<[string, any, any, any]> = [
        ["Integer",     IntegerType,                          1n,                                    2n],
        ["Float",       FloatType,                            1.0,                                   2.0],
        ["String",      StringType,                           "a",                                   "b"],
        ["Boolean",     BooleanType,                          false,                                 true],
        ["Struct",      StructType({ a: IntegerType }),       { a: 1n },                             { a: 2n }],
        ["Array<Int>",  ArrayType(IntegerType),               [1n, 2n],                              [1n, 9n]],
        ["Dict",        DictType(StringType, IntegerType),    new SortedMap([["k", 1n]], compareFor(StringType)),
                                                              new SortedMap([["k", 2n]], compareFor(StringType))],
        ["Set",         SetType(StringType),                  new SortedSet<string>(["a"], compareFor(StringType)),
                                                              new SortedSet<string>(["a", "b"], compareFor(StringType))],
        ["Variant",     VariantType({ x: IntegerType }),      variant("x", 1n),                      variant("x", 2n)],
        ["Option",      OptionType(IntegerType),              variant("none", null),                 variant("some", 1n)],
        ["Ref<Int>",    RefType(IntegerType),                 ref(1n),                               ref(2n)],
    ];

    for (const [name, T, a, b] of cases) {
        test(`${name}: keep=>true ∘ apply == apply (∘ unpruned)`, () => {
            const p = diffFor(T)(a, b);
            const pruned = prunePatchFor(T)(p, () => true);
            assert.ok(equalFor(T)(applyFor(T)(a, pruned), b));
        });
        test(`${name}: keep=>false ∘ apply == before`, () => {
            const p = diffFor(T)(a, b);
            const pruned = prunePatchFor(T)(p, () => false);
            assert.ok(equalFor(T)(applyFor(T)(a, pruned), a));
        });
    }
});
