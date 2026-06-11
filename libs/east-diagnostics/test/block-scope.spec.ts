/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./harness.js";

const PRELUDE = `import { East, IntegerType, StringType, ArrayType } from "@elaraai/east";\n`;

// A locally-declared `BlockBuilder` exercises the exact name-based detection the
// rules use (`symbol.name === "BlockBuilder"`), so these tests do not need the
// real east-ui `<Reactive>` tag to prove the East-block scope is recognised
// without an enclosing `East.function`.
const REACTIVE_SHIM = `declare class BlockBuilder { let(v: unknown, t?: unknown): unknown; const(v: unknown, t?: unknown): unknown; }
declare function Reactive(fn: ($: BlockBuilder) => unknown): unknown;
`;

function rule(source: string, ruleName: string) {
  return analyze(source).filter((d) => d.ruleName === ruleName);
}

// ── prefer-let-const-over-east-value inside a BlockBuilder callback ──────
test("prefer-let-const: fires inside a Reactive-style BlockBuilder callback (no East.function)", () => {
  const src = `${PRELUDE}${REACTIVE_SHIM}Reactive(($) => {
  const xs = East.value([1n, 2n], ArrayType(IntegerType));
  return xs;
});\n`;
  assert.equal(rule(src, "prefer-let-const-over-east-value").length, 1);
});

test("prefer-let-const: still fires inside an East.function (regression)", () => {
  const src = `${PRELUDE}export const g = East.function([], ArrayType(IntegerType), ($) => {
  const xs = East.value([1n, 2n], ArrayType(IntegerType));
  return xs;
});\n`;
  assert.equal(rule(src, "prefer-let-const-over-east-value").length, 1);
});

test("prefer-let-const: silent for a top-level East.value with no East block scope", () => {
  const src = `${PRELUDE}export const xs = East.value([1n, 2n], ArrayType(IntegerType));\n`;
  assert.equal(rule(src, "prefer-let-const-over-east-value").length, 0);
});

// ── no-reinlined-east-binding inside a BlockBuilder callback ─────────────
test("no-reinlined: fires inside a Reactive-style BlockBuilder callback (no East.function)", () => {
  const src = `${PRELUDE}${REACTIVE_SHIM}Reactive(($) => {
  const s = East.value("x", StringType);
  return [s, s];
});\n`;
  assert.equal(rule(src, "no-reinlined-east-binding").length, 1);
});

test("no-reinlined: silent for a single use inside a BlockBuilder callback", () => {
  const src = `${PRELUDE}${REACTIVE_SHIM}Reactive(($) => {
  const s = East.value("x", StringType);
  return [s];
});\n`;
  assert.equal(rule(src, "no-reinlined-east-binding").length, 0);
});

test("no-reinlined: a plain (non-BlockBuilder) arrow is not an East block scope", () => {
  // `cb`'s param is a plain string, so the East Expr reused twice inside it is
  // not inside any East block — nothing to re-inline into.
  const src = `${PRELUDE}const cb = (_label: string) => {
  const s = East.value("x", StringType);
  return [s, s];
};\nexport const _c = cb;\n`;
  assert.equal(rule(src, "no-reinlined-east-binding").length, 0);
});
