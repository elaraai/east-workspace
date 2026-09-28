/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `East.compile` over a function returning `UIComponentType`. Typed as
 * `FunctionExpr<I, O>`, the old signature inferred `O` member by member, and for
 * a type this large TypeScript settled on the unrolled variant — refusing the
 * very function it was inferred from, so every UI program had to be compiled
 * through a type-erasing helper. This file only compiles if the signature reads
 * `I` and `O` from the expression's East type.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { East, equalFor, type ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Text } from "@elaraai/east-ui/internal";

test("East.compile keeps a UIComponentType output's type", () => {
    const program = East.function([], UIComponentType, (_$) => Text.Root("hello"));
    const compiled = East.compile(program, []);
    const value: ValueTypeOf<typeof UIComponentType> = compiled();
    assert.equal(value.type, "Text");
    const again = East.compile(East.function([], UIComponentType, (_$) => Text.Root("hello")), [])();
    assert.ok(equalFor(UIComponentType)(value, again));
});
