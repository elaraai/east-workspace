/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `equivalentFor` — `equalFor` everywhere except on functions, where it
 * compares the IR and the captured values (#809).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { East } from "./expr/index.js";
import { variant, some } from "./containers/variant.js";
import { equalFor, equivalentFor } from "./comparison.js";
import {
    ArrayType, AsyncFunctionType, DictType, FunctionType, IntegerType, NullType, OptionType,
    RecursiveType, StringType, StructType, VariantType,
} from "./types.js";
import { decodeBeast2For, encodeBeast2For } from "./serialization/beast2/index.js";

const Counter = FunctionType([], IntegerType);

/** A compiled East function that returns a closure over its argument. */
const makeCounter = East.compile(
    East.function([IntegerType], Counter, (_$, n) => East.function([], IntegerType, (_$2) => n)),
    [],
);

describe("equivalentFor — functions", () => {
    const equivalent = equivalentFor(Counter);

    test("a function is equivalent to itself", () => {
        const f = makeCounter(1n);
        assert.equal(equivalent(f, f), true);
    });

    test("closures from one compiled function with equal captures are equivalent", () => {
        const a = makeCounter(1n);
        const b = makeCounter(1n);
        assert.notEqual(a, b);                      // two distinct closure objects
        assert.equal(equivalent(a, b), true);
    });

    test("closures whose captures differ are not", () => {
        assert.equal(equivalent(makeCounter(1n), makeCounter(2n)), false);
        // equalFor never looks inside a function.
        assert.equal(equalFor(Counter)(makeCounter(1n), makeCounter(2n)), true);
    });

    test("functions with different IR are not", () => {
        const plusOne = East.compile(
            East.function([IntegerType], Counter, (_$, n) => East.function([], IntegerType, (_$2) => n.add(1n))),
            [],
        );
        assert.equal(equivalent(makeCounter(1n), plusOne(1n)), false);
    });

    test("structurally equal IR from separate compiles is equivalent", () => {
        const build = () => East.compile(
            East.function([IntegerType], Counter, (_$, n) => East.function([], IntegerType, (_$2) => n)),
            [],
        );
        const a = build()(5n);
        const b = build()(5n);
        assert.equal(equivalent(a, b), true);
        assert.equal(equivalent(a, build()(6n)), false);
    });

    test("a beast2 round trip is equivalent to the original, and still sees a changed capture", () => {
        const Holder = StructType({ run: Counter });
        const encode = encodeBeast2For(Holder);
        const decode = decodeBeast2For(Holder);
        const original = { run: makeCounter(3n) };
        const decoded = decode(encode(original));
        assert.notEqual(decoded.run, original.run);
        assert.equal(equivalentFor(Holder)(original, decoded), true);
        assert.equal(equivalentFor(Holder)({ run: makeCounter(4n) }, decoded), false);
    });

    test("a host function is equivalent only to itself", () => {
        const host = (() => 1n) as unknown as () => bigint;
        const twin = (() => 1n) as unknown as () => bigint;
        assert.equal(equivalent(host, host), true);
        assert.equal(equivalent(host, twin), false);
        assert.equal(equivalent(host, makeCounter(1n)), false);
    });

    test("a captured mutable variable is equivalent only to the same variable", () => {
        // Each call makes a fresh `let` box; the two closures read different
        // variables even though both hold 1 right now.
        const makeBoxed = East.compile(
            East.function([IntegerType], Counter, ($, n) => {
                const box = $.let(n);
                return East.function([], IntegerType, (_$2) => box);
            }),
            [],
        );
        const a = makeBoxed(1n);
        assert.equal(equivalent(a, a), true);
        assert.equal(equivalent(a, makeBoxed(1n)), false);
    });

    test("async functions follow the same rules", () => {
        const AsyncCounter = AsyncFunctionType([], IntegerType);
        const makeAsync = East.compile(
            East.function([IntegerType], AsyncCounter, (_$, n) => East.asyncFunction([], IntegerType, (_$2) => n)),
            [],
        );
        const equivalentAsync = equivalentFor(AsyncCounter);
        assert.equal(equivalentAsync(makeAsync(1n), makeAsync(1n)), true);
        assert.equal(equivalentAsync(makeAsync(1n), makeAsync(2n)), false);
    });
});

describe("equivalentFor — functions inside data", () => {
    test("struct, variant, option, array and dict carriers", () => {
        const Row = StructType({
            name: StringType,
            action: VariantType({ none: NullType, run: Counter }),
            hook: OptionType(Counter),
            steps: ArrayType(Counter),
            byKey: DictType(StringType, Counter),
        });
        const make = (n: bigint) => ({
            name: "r",
            action: variant("run", makeCounter(n)),
            hook: some(makeCounter(n)),
            steps: [makeCounter(n)],
            byKey: new Map([["a", makeCounter(n)]]),
        });
        const equivalent = equivalentFor(Row);
        assert.equal(equivalent(make(1n), make(1n)), true);
        assert.equal(equivalent(make(1n), make(2n)), false);
        // Only the functions differ — equalFor sees them as equal.
        assert.equal(equalFor(Row)(make(1n), make(2n)), true);
    });

    test("a recursive type whose nodes carry functions", () => {
        const Tree = RecursiveType(self => VariantType({
            leaf: Counter,
            node: StructType({ label: StringType, children: ArrayType(self) }),
        }));
        const tree = (n: bigint) => variant("node", {
            label: "root",
            children: [variant("leaf", makeCounter(n)), variant("node", { label: "inner", children: [variant("leaf", makeCounter(n))] })],
        });
        const equivalent = equivalentFor(Tree);
        assert.equal(equivalent(tree(1n), tree(1n)), true);
        assert.equal(equivalent(tree(1n), tree(2n)), false);
    });

    test("non-function values compare exactly as equalFor does", () => {
        const T = StructType({ a: IntegerType, b: ArrayType(StringType) });
        const equivalent = equivalentFor(T);
        const equal = equalFor(T);
        const values = [{ a: 1n, b: ["x"] }, { a: 1n, b: ["x"] }, { a: 2n, b: ["x"] }, { a: 1n, b: ["y", "z"] }];
        for (const x of values) {
            for (const y of values) {
                assert.equal(equivalent(x, y), equal(x, y));
            }
        }
    });
});
