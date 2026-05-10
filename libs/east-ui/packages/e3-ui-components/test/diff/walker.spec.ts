/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    StructType, IntegerType, FloatType, StringType,
    ArrayType, DictType, VariantType, NullType,
    diffFor,
} from "@elaraai/east";
import { variant } from "@elaraai/east";

import { walkPatchToTree, collectLeaves, type GroupNode, type LeafNode } from "../../src/diff/walker.js";

// ============================================================================
// subtreeLeafPaths — pre-computed at walk time, the renderer's hot path
// uses it to avoid a per-render collectLeaves traversal.
// ============================================================================

describe("walkPatchToTree: subtreeLeafPaths", () => {
    test("struct with three changed primitives → root has all three paths", () => {
        const T = StructType({ a: IntegerType, b: IntegerType, c: StringType });
        const patch = diffFor(T)({ a: 1n, b: 2n, c: "x" }, { a: 9n, b: 9n, c: "y" });
        const tree = walkPatchToTree(T, patch, "binding") as GroupNode;
        assert.equal(tree.kind, "group");
        assert.deepEqual([...tree.subtreeLeafPaths].sort(), ["a", "b", "c"]);
    });

    test("nested struct: outer.subtreeLeafPaths includes flattened nested paths; inner has only its own", () => {
        const Inner = StructType({ x: IntegerType, y: IntegerType });
        const Outer = StructType({ name: StringType, inner: Inner });
        const patch = diffFor(Outer)(
            { name: "a", inner: { x: 1n, y: 1n } },
            { name: "b", inner: { x: 2n, y: 2n } },
        );
        const tree = walkPatchToTree(Outer, patch, "binding") as GroupNode;
        assert.deepEqual([...tree.subtreeLeafPaths].sort(), ["inner.x", "inner.y", "name"]);

        const innerGroup = tree.children.find(c => c.kind === "group" && c.label === "inner") as GroupNode;
        assert.ok(innerGroup);
        assert.deepEqual([...innerGroup.subtreeLeafPaths].sort(), ["inner.x", "inner.y"]);
    });

    test("array with paired updates → root subtreeLeafPaths covers both indexed paths", () => {
        const Row = StructType({ rate: FloatType });
        const T = ArrayType(Row);
        const patch = diffFor(T)(
            [{ rate: 1.0 }, { rate: 2.0 }],
            [{ rate: 1.5 }, { rate: 2.5 }],
        );
        const tree = walkPatchToTree(T, patch, "binding") as GroupNode;
        assert.deepEqual([...tree.subtreeLeafPaths].sort(), ["[0].rate", "[1].rate"]);
    });

    test("subtreeLeafPaths matches collectLeaves(node).map(l => l.path) for the root", () => {
        const T = StructType({ a: IntegerType, b: ArrayType(IntegerType) });
        const patch = diffFor(T)({ a: 1n, b: [1n, 2n] }, { a: 9n, b: [1n, 9n] });
        const tree = walkPatchToTree(T, patch, "binding") as GroupNode;
        assert.deepEqual(
            [...tree.subtreeLeafPaths].sort(),
            collectLeaves(tree).map(l => l.path).sort(),
        );
    });
});

// ============================================================================
// Stack imbalance — the assertion catches future east regressions
// ============================================================================

describe("walkPatchToTree: structural invariants", () => {
    test("unchanged patch → null tree, no callbacks, stack zeroed", () => {
        const result = walkPatchToTree(IntegerType, variant("unchanged", null), "binding");
        assert.equal(result, null);
    });

    test("primitive replace at root → single leaf, label = rootLabel", () => {
        const patch = diffFor(IntegerType)(1n, 2n);
        const result = walkPatchToTree(IntegerType, patch, "myBinding") as LeafNode;
        assert.equal(result.kind, "leaf");
        assert.equal(result.label, "myBinding");
        assert.equal(result.path, "");
    });

    test("dict patch produces leaves at canonical keys (printFor format)", () => {
        const T = DictType(StringType, IntegerType);
        const patch = diffFor(T)(
            new Map([["AU", 1n]]),
            new Map([["AU", 2n]]),
        );
        const tree = walkPatchToTree(T, patch, "binding") as GroupNode;
        assert.equal(tree.subtreeLeafPaths.length, 1);
        assert.equal(tree.subtreeLeafPaths[0], '{"AU"}');
    });

    test("variant tag change → leaf with op=update", () => {
        const T = VariantType({ on: NullType, off: NullType });
        const patch = diffFor(T)(variant("on", null), variant("off", null));
        const tree = walkPatchToTree(T, patch, "binding") as LeafNode;
        assert.equal(tree.kind, "leaf");
        assert.equal(tree.op, "update");
    });
});
