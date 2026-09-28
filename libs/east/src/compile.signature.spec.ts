/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `East.compile` / `East.compileAsync` read a function's input and output
 * types from the expression's East type. These tests are half type-level: the
 * file only compiles (and `make build` only passes) if the inferred signatures
 * are the precise ones asserted below. The type that tripped the old
 * `FunctionExpr<I, O>` inference — east-ui's `UIComponentType`, large enough
 * that TypeScript inferred its unrolled variant — is pinned where it lives
 * (`east-ui/test/component-compile.spec.ts`).
 */
import { describe, test } from "node:test";
import assert from "node:assert";
import { East } from "./expr/index.js";
import { IntegerType, NullType, RecursiveType, StringType, StructType, VariantType, ArrayType, type ValueTypeOf } from "./types.js";
import { variant } from "./containers/variant.js";
import { equalFor } from "./comparison.js";

const ListType = RecursiveType(self => VariantType({
    nil: NullType,
    cons: StructType({ head: IntegerType, tail: self }),
}));

describe("East.compile signature", () => {
    test("a RecursiveType output keeps its type", () => {
        const singleton = East.function([IntegerType], ListType, (_$, x) =>
            variant("cons", { head: x, tail: variant("nil", null) }));
        const compiled = East.compile(singleton, []);
        const list: ValueTypeOf<typeof ListType> = compiled(7n);
        assert.ok(equalFor(ListType)(list, variant("cons", { head: 7n, tail: variant("nil", null) })));
    });

    test("an async RecursiveType output keeps its type", async () => {
        const empty = East.asyncFunction([], ListType, (_$) => variant("nil", null));
        const compiled = East.compileAsync(empty, []);
        const list: ValueTypeOf<typeof ListType> = await compiled();
        assert.ok(equalFor(ListType)(list, variant("nil", null)));
    });

    test("ordinary signatures still infer their inputs and output", () => {
        const Row = StructType({ name: StringType, xs: ArrayType(IntegerType) });
        const make = East.function([StringType, IntegerType], Row, (_$, name, x) => ({ name, xs: [x] }));
        const compiled = East.compile(make, []);
        const row: { name: string; xs: bigint[] } = compiled("a", 2n);
        assert.deepStrictEqual(row, { name: "a", xs: [2n] });
        // @ts-expect-error — the first input is a String, not an Integer
        const _wrong: (name: bigint, x: bigint) => unknown = compiled;
        void _wrong;
    });

    test("an expression that is not a function is refused at run time", () => {
        // The cast bypasses the signature to reach the runtime guard.
        assert.throws(
            () => East.compile(East.value(1n) as never, []),
            /East\.compile expects a function built by East\.function, got an expression of type \.Integer/,
        );
        assert.throws(
            () => East.compileAsync(East.value("x") as never, []),
            /East\.compileAsync expects a function built by East\.asyncFunction, got an expression of type \.String/,
        );
    });
});
