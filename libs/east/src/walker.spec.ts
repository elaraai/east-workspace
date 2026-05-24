/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tests for {@link walkIR} and {@link literalValueOf}.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    East,
    BooleanType,
    FloatType,
    IntegerType,
    NullType,
    StringType,
    walkIR,
    literalValueOf,
} from "./index.js";
import type { ValueIR, IR } from "./index.js";

function valueIR(jsValue: unknown, type: typeof IntegerType | typeof FloatType | typeof StringType | typeof BooleanType | typeof NullType): ValueIR {
    // Build a Value IR via the public API: a function returning the literal,
    // then pull out its `Return.value` (which is the Value IR).
    const fn = East.function([], type as never, (_$) => East.value(jsValue as never, type as never));
    const ir = fn.toIR().ir;
    // The IR is a Function whose body is a Block whose only statement is a Return.
    // Walk to find the first Value node.
    let found: ValueIR | null = null;
    walkIR(ir, (node) => {
        if (!found && node.type === "Value") found = node as ValueIR;
    });
    if (!found) throw new Error("no Value IR found in test fixture");
    return found;
}

// ============================================================================
// literalValueOf
// ============================================================================

describe("literalValueOf — unwraps Value IR payload", () => {
    test("string", () => {
        const ir = valueIR("hello", StringType);
        assert.equal(literalValueOf(ir), "hello");
    });

    test("integer (bigint)", () => {
        const ir = valueIR(42n, IntegerType);
        assert.equal(literalValueOf(ir), 42n);
    });

    test("float", () => {
        const ir = valueIR(3.14, FloatType);
        assert.equal(literalValueOf(ir), 3.14);
    });

    test("boolean", () => {
        const ir = valueIR(true, BooleanType);
        assert.equal(literalValueOf(ir), true);
    });

    test("null", () => {
        const ir = valueIR(null, NullType);
        assert.equal(literalValueOf(ir), null);
    });
});

// ============================================================================
// walkIR — visits every node, including Value leaves
// ============================================================================

describe("walkIR — coverage", () => {
    test("visits the root node", () => {
        const fn = East.function([], IntegerType, (_$) => East.value(1n, IntegerType));
        const visited: string[] = [];
        walkIR(fn.toIR().ir, (node) => visited.push(node.type));
        assert.ok(visited.length > 0);
        assert.equal(visited[0], "Function");
    });

    test("visits Value leaves", () => {
        const fn = East.function([], IntegerType, (_$) => East.value(7n, IntegerType));
        let saw = false;
        walkIR(fn.toIR().ir, (node) => {
            if (node.type === "Value" && literalValueOf(node as ValueIR) === 7n) saw = true;
        });
        assert.ok(saw);
    });

    test("supplies parent in context", () => {
        const fn = East.function([], IntegerType, (_$) => East.value(1n, IntegerType));
        const seenWithParent: { node: string; parent: string | null }[] = [];
        walkIR(fn.toIR().ir, (node, ctx) => {
            seenWithParent.push({ node: node.type, parent: ctx.parent?.type ?? null });
        });
        // Root has no parent.
        assert.equal(seenWithParent[0]!.parent, null);
        // At least one descendant has a parent.
        assert.ok(seenWithParent.slice(1).some(s => s.parent !== null));
    });

    test("recurses into Call arguments", () => {
        const inner = East.function([IntegerType], IntegerType, (_$, x) => x);
        const fn = East.function([], IntegerType, ($) => $.let(inner.call(7n), IntegerType));
        let valueSeen = false;
        walkIR(fn.toIR().ir, (node) => {
            if (node.type === "Value" && literalValueOf(node as ValueIR) === 7n) valueSeen = true;
        });
        assert.ok(valueSeen);
    });
});

// ============================================================================
// walkIR — IR fixture sanity (catches regressions in the cases that the
// walker needs to recurse through; the body is a `(...args).map(walk)` for
// each variant)
// ============================================================================

describe("walkIR — recursion sanity", () => {
    test("doesn't infinite-loop on a simple let", () => {
        const fn = East.function([], IntegerType, ($) => $.let(East.value(1n, IntegerType), IntegerType));
        let count = 0;
        walkIR(fn.toIR().ir, () => count++);
        // Should be finite — IR has Function/Block/Let/Value/Return-ish nodes.
        assert.ok(count > 0);
        assert.ok(count < 100); // sanity — no runaway
    });
});

// type-level smoke
type _CheckIRType = IR;
