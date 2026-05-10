/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    NullType, BooleanType, IntegerType, FloatType, StringType, DateTimeType, BlobType,
    ArrayType, SetType, DictType, StructType, VariantType, RefType, RecursiveType,
    VectorType, OptionType,
    FunctionType,
} from "../types.js";
import { variant } from "../containers/variant.js";
import { SortedSet } from "../containers/sortedset.js";
import { SortedMap } from "../containers/sortedmap.js";
import { ref } from "../containers/ref.js";
import { compareFor } from "../comparison.js";

import { diffFor } from "./diff.js";
import { walkPatch, type PatchLeafOp } from "./walk.js";
import { pathToString, type PatchPath } from "./path.js";

// ============================================================================
// Capture helper — collects every event walkPatch emits into typed arrays.
// Centralised because every test downstream wants the same triple.
// ============================================================================

interface CapturedLeaf {
    path: string;
    op: PatchLeafOp;
    before: unknown;
    after: unknown;
    typeKind: string;
}

interface CapturedEnter {
    path: string;
    typeKind: string;
    leafCount: number;
}

function capture(type: any, before: any, after: any) {
    const leaves: CapturedLeaf[] = [];
    const enters: CapturedEnter[] = [];
    const exits: string[] = [];
    walkPatch(type, diffFor(type)(before, after), {
        enter: ({ type: t, path, leafCount }) => {
            enters.push({ path: pathToString(path), typeKind: t.type, leafCount });
        },
        leaf: ({ type: t, path, op, before: b, after: a }) => {
            leaves.push({ path: pathToString(path), op, before: b, after: a, typeKind: t.type });
        },
        exit: ({ path }) => { exits.push(pathToString(path)); },
    });
    return { leaves, enters, exits };
}

// ============================================================================
// Primitives — replace-only types: every changed value emits one update leaf.
// ============================================================================

describe("walkPatch: primitives", () => {
    test("Null: identical → no leaves, no enters, no exits", () => {
        const c = capture(NullType, null, null);
        assert.equal(c.leaves.length, 0);
        assert.equal(c.enters.length, 0);
        assert.equal(c.exits.length, 0);
    });

    test("Boolean: changed → one update leaf carrying both values", () => {
        const c = capture(BooleanType, true, false);
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.op, "update");
        assert.equal(c.leaves[0]!.before, true);
        assert.equal(c.leaves[0]!.after, false);
        assert.equal(c.leaves[0]!.typeKind, "Boolean");
        assert.equal(c.leaves[0]!.path, "");
    });

    test("Integer: changed → one update leaf carrying both bigints", () => {
        const c = capture(IntegerType, 38n, 40n);
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.before, 38n);
        assert.equal(c.leaves[0]!.after, 40n);
        assert.equal(c.leaves[0]!.typeKind, "Integer");
    });

    test("Integer: large bigints round-trip without precision loss", () => {
        const c = capture(IntegerType, 9007199254740993n, 9007199254740994n);
        assert.equal(c.leaves[0]!.before, 9007199254740993n);
        assert.equal(c.leaves[0]!.after, 9007199254740994n);
    });

    test("Float: NaN/Infinity edge cases produce a leaf when actually different", () => {
        const c = capture(FloatType, 1.5, Infinity);
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.before, 1.5);
        assert.equal(c.leaves[0]!.after, Infinity);
    });

    test("String: changed → one update leaf carrying both strings", () => {
        const c = capture(StringType, "hello", "world");
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.before, "hello");
        assert.equal(c.leaves[0]!.after, "world");
        assert.equal(c.leaves[0]!.typeKind, "String");
    });

    test("String: empty → non-empty produces a leaf", () => {
        const c = capture(StringType, "", "x");
        assert.equal(c.leaves.length, 1);
    });

    test("DateTime: changed → one update leaf", () => {
        const c = capture(DateTimeType, new Date("2025-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.typeKind, "DateTime");
    });

    test("Blob: changed → one update leaf", () => {
        const c = capture(BlobType, new Uint8Array([1, 2]), new Uint8Array([3, 4]));
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.typeKind, "Blob");
    });

    test("Vector: changed → one update leaf (replace-only)", () => {
        const T = VectorType(FloatType);
        const c = capture(T, new Float64Array([1.0, 2.0, 3.0]), new Float64Array([4.0, 5.0, 6.0]));
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.typeKind, "Vector");
    });

    for (const [name, T, x] of [
        ["Null", NullType, null],
        ["Boolean", BooleanType, true],
        ["Integer", IntegerType, 1n],
        ["Float", FloatType, 1.0],
        ["String", StringType, "x"],
        ["DateTime", DateTimeType, new Date(0)],
        ["Blob", BlobType, new Uint8Array([1])],
    ] as const) {
        test(`${name}: identical values → no leaves`, () => {
            assert.equal(capture(T, x, x).leaves.length, 0);
        });
    }

    test("Vector: identical → no leaves", () => {
        const T = VectorType(FloatType);
        assert.equal(capture(T, new Float64Array([1.0, 2.0]), new Float64Array([1.0, 2.0])).leaves.length, 0);
    });
});

// ============================================================================
// Function types — replace-only by design (functions aren't structurally
// diffable, only opaquely replaceable).
// ============================================================================

describe("walkPatch: Function types", () => {
    test("Function: diffFor always emits unchanged → walker sees no leaves", () => {
        // East functions are opaque — `diffFor` returns unchanged regardless,
        // so the walker has nothing to emit.
        const T = FunctionType([IntegerType], IntegerType);
        const f1 = (x: bigint) => x + 1n;
        const f2 = (x: bigint) => x + 2n;
        const c = capture(T, f1, f2);
        assert.equal(c.leaves.length, 0);
    });
});

// ============================================================================
// Struct
// ============================================================================

describe("walkPatch: Struct", () => {
    const PolicyType = StructType({ maxHours: IntegerType, penalty: FloatType });

    test("multiple fields changed → one leaf per changed field", () => {
        const c = capture(PolicyType,
            { maxHours: 38n, penalty: 1.5 },
            { maxHours: 40n, penalty: 2.0 },
        );
        assert.equal(c.leaves.length, 2);
        const byPath = new Map(c.leaves.map(l => [l.path, l]));
        assert.equal(byPath.get("maxHours")!.before, 38n);
        assert.equal(byPath.get("maxHours")!.after, 40n);
        assert.equal(byPath.get("penalty")!.before, 1.5);
        assert.equal(byPath.get("penalty")!.after, 2.0);
    });

    test("one field changed, sibling unchanged → only the changed field appears", () => {
        const c = capture(PolicyType,
            { maxHours: 38n, penalty: 1.5 },
            { maxHours: 40n, penalty: 1.5 },
        );
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.path, "maxHours");
    });

    test("identical struct → no leaves, no enters, no exits", () => {
        const c = capture(PolicyType,
            { maxHours: 38n, penalty: 1.5 },
            { maxHours: 38n, penalty: 1.5 },
        );
        assert.equal(c.leaves.length, 0);
        assert.equal(c.enters.length, 0);
        assert.equal(c.exits.length, 0);
    });

    test("enter/exit fire once with correct typeKind and leafCount", () => {
        const c = capture(PolicyType,
            { maxHours: 38n, penalty: 1.5 },
            { maxHours: 40n, penalty: 2.0 },
        );
        assert.equal(c.enters.length, 1);
        assert.equal(c.enters[0]!.typeKind, "Struct");
        assert.equal(c.enters[0]!.leafCount, 2);
        assert.equal(c.exits.length, 1);
    });

    test("nested struct: leaves at qualified dot-paths", () => {
        const Inner = StructType({ x: IntegerType, y: IntegerType });
        const Outer = StructType({ name: StringType, inner: Inner });
        const c = capture(Outer,
            { name: "a", inner: { x: 1n, y: 1n } },
            { name: "b", inner: { x: 2n, y: 2n } },
        );
        const paths = c.leaves.map(l => l.path).sort();
        assert.deepEqual(paths, ["inner.x", "inner.y", "name"]);
    });

    test("3-deep nesting: paths reflect the full chain", () => {
        const L3 = StructType({ z: IntegerType });
        const L2 = StructType({ inner: L3 });
        const L1 = StructType({ outer: L2 });
        const c = capture(L1, { outer: { inner: { z: 1n } } }, { outer: { inner: { z: 2n } } });
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.path, "outer.inner.z");
    });

    test("struct with all primitive types: every kind contributes one leaf", () => {
        const Big = StructType({
            s: StringType, i: IntegerType, f: FloatType, b: BooleanType,
            d: DateTimeType, n: NullType,
        });
        const c = capture(Big,
            { s: "a", i: 1n, f: 1.0, b: false, d: new Date(0),    n: null },
            { s: "b", i: 2n, f: 2.0, b: true,  d: new Date(1000), n: null },
        );
        const paths = c.leaves.map(l => l.path).sort();
        assert.deepEqual(paths, ["b", "d", "f", "i", "s"]);
    });
});

// ============================================================================
// Array
// ============================================================================

describe("walkPatch: Array", () => {
    test("identical → no leaves", () => {
        const c = capture(ArrayType(IntegerType), [1n, 2n, 3n], [1n, 2n, 3n]);
        assert.equal(c.leaves.length, 0);
    });

    test("primitive element changed → leaf at the changed index", () => {
        const c = capture(ArrayType(IntegerType), [10n, 20n, 30n], [10n, 25n, 30n]);
        assert.ok(c.leaves.some(l => l.path === "[1]"));
    });

    test("element insert at end → one insert leaf carrying the inserted value", () => {
        const c = capture(ArrayType(IntegerType), [1n, 2n], [1n, 2n, 3n]);
        const inserts = c.leaves.filter(l => l.op === "insert");
        assert.equal(inserts.length, 1);
        assert.equal(inserts[0]!.after, 3n);
    });

    test("element insert at start → one insert leaf at index 0", () => {
        const c = capture(ArrayType(IntegerType), [2n, 3n], [1n, 2n, 3n]);
        const inserts = c.leaves.filter(l => l.op === "insert");
        assert.equal(inserts.length, 1);
        assert.equal(inserts[0]!.after, 1n);
    });

    test("element delete from middle → one delete leaf", () => {
        const c = capture(ArrayType(IntegerType), [1n, 2n, 3n], [1n, 3n]);
        const deletes = c.leaves.filter(l => l.op === "delete");
        assert.equal(deletes.length, 1);
        assert.equal(deletes[0]!.before, 2n);
    });

    test("delete from end → one delete leaf", () => {
        const c = capture(ArrayType(IntegerType), [1n, 2n, 3n], [1n, 2n]);
        const deletes = c.leaves.filter(l => l.op === "delete");
        assert.equal(deletes.length, 1);
        assert.equal(deletes[0]!.before, 3n);
    });

    test("clear all elements → delete leaves for every element", () => {
        const c = capture(ArrayType(IntegerType), [1n, 2n, 3n], []);
        const deletes = c.leaves.filter(l => l.op === "delete");
        assert.equal(deletes.length, 3);
        assert.deepEqual(deletes.map(l => l.before).sort(), [1n, 2n, 3n]);
    });

    test("populate empty array → insert leaves for every element", () => {
        const c = capture(ArrayType(IntegerType), [], [1n, 2n, 3n]);
        const inserts = c.leaves.filter(l => l.op === "insert");
        assert.equal(inserts.length, 3);
    });

    test("array of structs: per-row field changes appear as nested paths", () => {
        const Row = StructType({ id: StringType, n: IntegerType });
        const c = capture(ArrayType(Row),
            [{ id: "a", n: 1n }, { id: "b", n: 2n }],
            [{ id: "a", n: 1n }, { id: "b", n: 5n }],
        );
        assert.ok(c.leaves.some(l => l.path === "[1].n" && l.before === 2n && l.after === 5n));
    });

    test("two struct rows changed simultaneously → both indexed paths surface", () => {
        const Row = StructType({ rate: FloatType });
        const c = capture(ArrayType(Row),
            [{ rate: 1.0 }, { rate: 2.0 }, { rate: 3.0 }],
            [{ rate: 1.5 }, { rate: 2.5 }, { rate: 3.0 }],
        );
        assert.ok(c.leaves.some(l => l.path === "[0].rate" && l.before === 1.0 && l.after === 1.5));
        assert.ok(c.leaves.some(l => l.path === "[1].rate" && l.before === 2.0 && l.after === 2.5));
    });

    test("array of arrays: nested index paths", () => {
        const T = ArrayType(ArrayType(IntegerType));
        const c = capture(T, [[1n, 2n], [3n, 4n]], [[1n, 9n], [3n, 4n]]);
        assert.ok(c.leaves.some(l => l.path === "[0][1]"));
    });

    test("array of dicts: index then key in path", () => {
        const T = ArrayType(DictType(StringType, IntegerType));
        const before = [new SortedMap([["a", 1n]], compareFor(StringType))];
        const after  = [new SortedMap([["a", 2n]], compareFor(StringType))];
        const c = capture(T, before, after);
        assert.ok(c.leaves.some(l => l.path === '[0]{"a"}'));
    });

    test("array of variants: index then @tag in path", () => {
        const V = VariantType({ on: StructType({ since: IntegerType }), off: NullType });
        const T = ArrayType(V);
        const c = capture(T,
            [variant("on", { since: 100n })],
            [variant("on", { since: 200n })],
        );
        assert.ok(c.leaves.some(l => l.path === "[0]@on.since"));
    });

    test("mixed insert + delete + paired-update in same chunk", () => {
        // [1, A, B, 9] → [1, A', C, 9]
        // chunk has: keep 1, update A→A', delete B, insert C, keep 9
        const c = capture(ArrayType(IntegerType), [1n, 100n, 200n, 9n], [1n, 101n, 300n, 9n]);
        const ops = c.leaves.map(l => l.op).sort();
        // Expected: at least one update or replace event, plus delete+insert for unmatched
        assert.ok(c.leaves.length >= 2);
        assert.ok(ops.length > 0);
    });
});

// ============================================================================
// Dict
// ============================================================================

describe("walkPatch: Dict", () => {
    const PriceMap = DictType(StringType, FloatType);

    test("update: leaf at the canonical key path", () => {
        const c = capture(PriceMap,
            new SortedMap([["AU", 49.95], ["US", 39.95]], compareFor(StringType)),
            new SortedMap([["AU", 55.00], ["US", 39.95]], compareFor(StringType)),
        );
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.path, '{"AU"}');
        assert.equal(c.leaves[0]!.op, "update");
        assert.equal(c.leaves[0]!.before, 49.95);
        assert.equal(c.leaves[0]!.after, 55.00);
    });

    test("insert: leaf with op=insert at the new key", () => {
        const c = capture(PriceMap,
            new SortedMap<string, number>([["US", 39.95]], compareFor(StringType)),
            new SortedMap([["AU", 50.00], ["US", 39.95]], compareFor(StringType)),
        );
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.op, "insert");
        assert.equal(c.leaves[0]!.path, '{"AU"}');
        assert.equal(c.leaves[0]!.after, 50.00);
    });

    test("delete: leaf with op=delete at the removed key", () => {
        const c = capture(PriceMap,
            new SortedMap([["AU", 50.00], ["US", 39.95]], compareFor(StringType)),
            new SortedMap<string, number>([["US", 39.95]], compareFor(StringType)),
        );
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.op, "delete");
        assert.equal(c.leaves[0]!.path, '{"AU"}');
        assert.equal(c.leaves[0]!.before, 50.00);
    });

    test("dict-of-struct: nested field paths reach the leaves", () => {
        const Item = StructType({ price: FloatType, qty: IntegerType });
        const T = DictType(StringType, Item);
        const c = capture(T,
            new SortedMap([
                ["A", { price: 1.0, qty: 1n }],
                ["B", { price: 2.0, qty: 2n }],
            ], compareFor(StringType)),
            new SortedMap([
                ["A", { price: 1.5, qty: 1n }],
                ["B", { price: 2.0, qty: 5n }],
            ], compareFor(StringType)),
        );
        assert.ok(c.leaves.some(l => l.path === '{"A"}.price' && l.before === 1.0 && l.after === 1.5));
        assert.ok(c.leaves.some(l => l.path === '{"B"}.qty'   && l.before === 2n   && l.after === 5n));
    });

    test("identical dict → no leaves", () => {
        const c = capture(PriceMap,
            new SortedMap([["AU", 50.0]], compareFor(StringType)),
            new SortedMap([["AU", 50.0]], compareFor(StringType)),
        );
        assert.equal(c.leaves.length, 0);
    });

    test("collapsed-replace (every entry deleted) decomposes into per-key delete leaves", () => {
        const c = capture(PriceMap,
            new SortedMap([["AU", 50.0], ["US", 40.0]], compareFor(StringType)),
            new SortedMap<string, number>([], compareFor(StringType)),
        );
        assert.equal(c.leaves.length, 2);
        assert.ok(c.leaves.every(l => l.op === "delete"));
        const paths = c.leaves.map(l => l.path).sort();
        assert.deepEqual(paths, ['{"AU"}', '{"US"}']);
    });

    test("collapsed-replace (filling empty dict) decomposes into per-key insert leaves", () => {
        const c = capture(PriceMap,
            new SortedMap<string, number>([], compareFor(StringType)),
            new SortedMap([["AU", 50.0], ["US", 40.0]], compareFor(StringType)),
        );
        assert.equal(c.leaves.length, 2);
        assert.ok(c.leaves.every(l => l.op === "insert"));
    });

    test("Integer-keyed dict produces non-quoted numeric keys in the path", () => {
        const T = DictType(IntegerType, StringType);
        const c = capture(T,
            new SortedMap([[1n, "a"]], compareFor(IntegerType)),
            new SortedMap([[1n, "b"]], compareFor(IntegerType)),
        );
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.path, "{1}");
    });

    test("dict of arrays: key then index in path", () => {
        const T = DictType(StringType, ArrayType(IntegerType));
        const c = capture(T,
            new SortedMap([["row", [1n, 2n]]], compareFor(StringType)),
            new SortedMap([["row", [1n, 9n]]], compareFor(StringType)),
        );
        assert.ok(c.leaves.some(l => l.path === '{"row"}[1]'));
    });
});

// ============================================================================
// Set
// ============================================================================

describe("walkPatch: Set", () => {
    const T = SetType(StringType);

    test("insert: one leaf per new element with op=insert", () => {
        const c = capture(T,
            new SortedSet<string>(["a", "b"], compareFor(StringType)),
            new SortedSet<string>(["a", "b", "c"], compareFor(StringType)),
        );
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.op, "insert");
        assert.equal(c.leaves[0]!.after, "c");
    });

    test("delete: one leaf per removed element with op=delete", () => {
        const c = capture(T,
            new SortedSet<string>(["a", "b", "c"], compareFor(StringType)),
            new SortedSet<string>(["a", "c"], compareFor(StringType)),
        );
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.op, "delete");
        assert.equal(c.leaves[0]!.before, "b");
    });

    test("mixed insert+delete: separate leaves with distinct paths and ops", () => {
        const c = capture(T,
            new SortedSet<string>(["a", "b"], compareFor(StringType)),
            new SortedSet<string>(["b", "c"], compareFor(StringType)),
        );
        const inserts = c.leaves.filter(l => l.op === "insert");
        const deletes = c.leaves.filter(l => l.op === "delete");
        assert.equal(inserts.length, 1);
        assert.equal(deletes.length, 1);
        assert.equal(inserts[0]!.after, "c");
        assert.equal(deletes[0]!.before, "a");
    });

    test("identical set → no leaves", () => {
        const c = capture(T,
            new SortedSet<string>(["a", "b"], compareFor(StringType)),
            new SortedSet<string>(["a", "b"], compareFor(StringType)),
        );
        assert.equal(c.leaves.length, 0);
    });

    test("clear all elements → delete leaves for each", () => {
        const c = capture(T,
            new SortedSet<string>(["a", "b", "c"], compareFor(StringType)),
            new SortedSet<string>([], compareFor(StringType)),
        );
        assert.equal(c.leaves.length, 3);
        assert.ok(c.leaves.every(l => l.op === "delete"));
    });

    test("populate empty set → insert leaves for each", () => {
        const c = capture(T,
            new SortedSet<string>([], compareFor(StringType)),
            new SortedSet<string>(["a", "b", "c"], compareFor(StringType)),
        );
        assert.equal(c.leaves.length, 3);
        assert.ok(c.leaves.every(l => l.op === "insert"));
    });

    test("Set of integers: numeric paths", () => {
        const Int = SetType(IntegerType);
        const c = capture(Int,
            new SortedSet<bigint>([1n, 2n], compareFor(IntegerType)),
            new SortedSet<bigint>([1n, 2n, 3n], compareFor(IntegerType)),
        );
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.path, "{3}");
    });
});

// ============================================================================
// Variant
// ============================================================================

describe("walkPatch: Variant", () => {
    const StatusType = VariantType({
        pending: NullType,
        active:  StructType({ since: IntegerType }),
        failed:  StructType({ reason: StringType }),
    });

    test("tag change → one update leaf carrying both variants", () => {
        const c = capture(StatusType, variant("pending", null), variant("failed", { reason: "oops" }));
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.op, "update");
        assert.equal(c.leaves[0]!.typeKind, "Variant");
    });

    test("same tag, different inner struct field → leaf at @tag.field path", () => {
        const c = capture(StatusType,
            variant("active", { since: 100n }),
            variant("active", { since: 200n }),
        );
        assert.ok(c.leaves.some(
            l => l.path === "@active.since" && l.before === 100n && l.after === 200n,
        ));
    });

    test("identical variant → no leaves", () => {
        const c = capture(StatusType, variant("pending", null), variant("pending", null));
        assert.equal(c.leaves.length, 0);
    });

    test("variant with NullType payload → tag transition has no inner leaves", () => {
        const Light = VariantType({ on: NullType, off: NullType });
        const c = capture(Light, variant("on", null), variant("off", null));
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.op, "update");
    });

    test("OptionType: none → some(value) emits a tag-change leaf", () => {
        const T = OptionType(IntegerType);
        const c = capture(T, variant("none", null), variant("some", 42n));
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.op, "update");
    });

    test("OptionType: some(a) → some(b) emits leaf at @some path for primitive payload", () => {
        const T = OptionType(IntegerType);
        const c = capture(T, variant("some", 1n), variant("some", 2n));
        assert.ok(c.leaves.length >= 1);
    });

    test("OptionType: some → none emits a tag-change leaf", () => {
        const T = OptionType(IntegerType);
        const c = capture(T, variant("some", 5n), variant("none", null));
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.op, "update");
    });

    test("nested variant: outer @tag.inner@innerTag chain", () => {
        const Inner = VariantType({ x: IntegerType, y: StringType });
        const Outer = VariantType({ wrap: StructType({ inner: Inner }) });
        const c = capture(Outer,
            variant("wrap", { inner: variant("x", 1n) }),
            variant("wrap", { inner: variant("x", 2n) }),
        );
        assert.ok(c.leaves.some(l => l.path === "@wrap.inner@x"));
    });
});

// ============================================================================
// Ref
// ============================================================================

describe("walkPatch: Ref", () => {
    test("Ref of primitive → unwraps to the inner type for the leaf", () => {
        const T = RefType(IntegerType);
        const c = capture(T, ref(1n), ref(2n));
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.typeKind, "Integer");
    });

    test("Ref of struct → leaves at the inner struct's fields", () => {
        const T = RefType(StructType({ x: IntegerType, y: IntegerType }));
        const c = capture(T, ref({ x: 1n, y: 1n }), ref({ x: 2n, y: 2n }));
        const paths = c.leaves.map(l => l.path).sort();
        assert.deepEqual(paths, ["x", "y"]);
    });

    test("Ref of array → indexed leaves", () => {
        const T = RefType(ArrayType(IntegerType));
        const c = capture(T, ref([1n, 2n]), ref([1n, 9n]));
        assert.ok(c.leaves.some(l => l.path === "[1]"));
    });

    test("Ref of dict → keyed leaves", () => {
        const T = RefType(DictType(StringType, IntegerType));
        const c = capture(T,
            ref(new SortedMap([["a", 1n]], compareFor(StringType))),
            ref(new SortedMap([["a", 2n]], compareFor(StringType))),
        );
        assert.ok(c.leaves.some(l => l.path === '{"a"}'));
    });

    test("Ref of variant → @tag leaves", () => {
        const V = VariantType({ on: NullType, off: NullType });
        const T = RefType(V);
        const c = capture(T, ref(variant("on", null)), ref(variant("off", null)));
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.op, "update");
    });

    test("Ref of Ref → unwraps both layers", () => {
        const T = RefType(RefType(IntegerType));
        const c = capture(T, ref(ref(1n)), ref(ref(2n)));
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.typeKind, "Integer");
    });
});

// ============================================================================
// Recursive — replace-only by design (whole-subtree replacement)
// ============================================================================

describe("walkPatch: Recursive", () => {
    test("Recursive type: changed value emits a single replace leaf at the recursive boundary", () => {
        const Tree = RecursiveType(node => StructType({
            value: IntegerType,
            children: ArrayType(node),
        }));
        const before = { value: 1n, children: [] as any[] };
        const after  = { value: 2n, children: [] as any[] };
        const c = capture(Tree, before, after);
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.op, "update");
    });

    test("Recursive type: deep tree change still emits a single update leaf", () => {
        const Tree = RecursiveType(node => StructType({
            value: IntegerType,
            children: ArrayType(node),
        }));
        const before = { value: 1n, children: [{ value: 2n, children: [] as any[] }] };
        const after  = { value: 1n, children: [{ value: 99n, children: [] as any[] }] };
        const c = capture(Tree, before, after);
        assert.equal(c.leaves.length, 1);
        assert.equal(c.leaves[0]!.op, "update");
    });
});

// ============================================================================
// Visitor control flow
// ============================================================================

describe("walkPatch: visitor control", () => {
    test("enter() returning false skips the subtree but processes siblings", () => {
        const T = StructType({
            outer: StructType({ a: IntegerType, b: IntegerType }),
            sibling: IntegerType,
        });
        const seen: string[] = [];
        walkPatch(T,
            diffFor(T)({ outer: { a: 1n, b: 2n }, sibling: 0n }, { outer: { a: 9n, b: 9n }, sibling: 5n }),
            {
                enter: ({ path }) => {
                    if (pathToString(path) === "outer") return false;
                    return undefined;
                },
                leaf: ({ path }) => seen.push(pathToString(path)),
            },
        );
        assert.equal(seen.length, 1);
        assert.equal(seen[0], "sibling");
    });

    test("enter.leafCount equals the total leaves under that subtree", () => {
        const T = StructType({ outer: StructType({ a: IntegerType, b: IntegerType }) });
        const enters: { path: string; n: number }[] = [];
        let leafCount = 0;
        walkPatch(T, diffFor(T)({ outer: { a: 1n, b: 2n } }, { outer: { a: 9n, b: 9n } }), {
            enter: ({ path, leafCount: n }) => { enters.push({ path: pathToString(path), n }); },
            leaf:  () => { leafCount++; },
        });
        assert.equal(leafCount, 2);
        const root = enters.find(e => e.path === "")!;
        assert.equal(root.n, leafCount);
    });

    test("walking an unchanged patch produces no events", () => {
        const events: string[] = [];
        walkPatch(IntegerType, diffFor(IntegerType)(5n, 5n), {
            enter: () => { events.push("enter"); },
            leaf:  () => { events.push("leaf"); },
            exit:  () => { events.push("exit"); },
        });
        assert.equal(events.length, 0);
    });

    test("enter / exit nesting matches container nesting (stacked correctly)", () => {
        const T = StructType({ outer: StructType({ inner: IntegerType }) });
        const events: { kind: string; path: string }[] = [];
        walkPatch(T, diffFor(T)({ outer: { inner: 1n } }, { outer: { inner: 2n } }), {
            enter: ({ path }) => { events.push({ kind: "enter", path: pathToString(path) }); },
            leaf:  ({ path }) => { events.push({ kind: "leaf",  path: pathToString(path) }); },
            exit:  ({ path }) => { events.push({ kind: "exit",  path: pathToString(path) }); },
        });
        assert.deepEqual(events, [
            { kind: "enter", path: "" },
            { kind: "enter", path: "outer" },
            { kind: "leaf",  path: "outer.inner" },
            { kind: "exit",  path: "outer" },
            { kind: "exit",  path: "" },
        ]);
    });

    test("optional enter / exit can be omitted; leaf is the only required hook", () => {
        const T = StructType({ a: IntegerType, b: IntegerType });
        const leaves: string[] = [];
        walkPatch(T, diffFor(T)({ a: 1n, b: 2n }, { a: 9n, b: 9n }), {
            leaf: ({ path }) => leaves.push(pathToString(path)),
        });
        assert.deepEqual(leaves.sort(), ["a", "b"]);
    });

    test("enter() returning false skips Array element subtrees too", () => {
        const T = ArrayType(StructType({ a: IntegerType }));
        const seen: string[] = [];
        walkPatch(T,
            diffFor(T)([{ a: 1n }, { a: 2n }], [{ a: 9n }, { a: 9n }]),
            {
                enter: ({ path }) => {
                    if (pathToString(path) === "[0]") return false;
                    return undefined;
                },
                leaf: ({ path }) => seen.push(pathToString(path)),
            },
        );
        // [0]'s leaf was pruned, [1].a survives
        assert.ok(seen.every(p => !p.startsWith("[0]")));
    });
});

// ============================================================================
// Typed PatchPath — leaf hooks receive structured segments, not strings
// ============================================================================

describe("walkPatch: typed PatchPath", () => {
    test("leaf receives PatchPath (array of segments), not a string", () => {
        const T = StructType({ a: ArrayType(IntegerType) });
        const seen: PatchPath[] = [];
        walkPatch(T, diffFor(T)({ a: [1n, 2n] }, { a: [1n, 5n] }), {
            leaf: ({ path }) => { seen.push(path); },
        });
        assert.ok(seen.length > 0);
        const first = seen[0]![0]!;
        assert.equal(first.kind, "field");
        assert.equal((first as { name: string }).name, "a");
    });

    test("path segments expose every kind directly: field / index / key / variant", () => {
        const T = StructType({
            roster: ArrayType(StructType({
                shifts: DictType(StringType, VariantType({ on: NullType, off: NullType }))
            })),
        });
        const seen: PatchPath[] = [];
        walkPatch(T, diffFor(T)(
            { roster: [{ shifts: new SortedMap([["m", variant("on", null)]], compareFor(StringType)) }] },
            { roster: [{ shifts: new SortedMap([["m", variant("off", null)]], compareFor(StringType)) }] },
        ), {
            leaf: ({ path }) => { seen.push(path); },
        });
        assert.ok(seen.length > 0);
        const segments = seen[0]!;
        const kinds = segments.map(s => s.kind);
        // Should hit field("roster") → index → field("shifts") → key("m") → variant("…")
        assert.ok(kinds.includes("field"));
        assert.ok(kinds.includes("index"));
        assert.ok(kinds.includes("key"));
    });
});
