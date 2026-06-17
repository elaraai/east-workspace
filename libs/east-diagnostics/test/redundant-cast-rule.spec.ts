/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./harness.js";

const PRELUDE = `import { East, IntegerType, FloatType, ArrayType, DictType, StringType } from "@elaraai/east";\n`;
const RULE = "no-redundant-east-cast";

function rule(source: string) {
  return analyze(source).filter((d) => d.ruleName === RULE);
}

// ── existing arm: a TS cast on the value ────────────────────────────────
test("flags an `as` cast on the value when the East type argument is present", () => {
  const src = `${PRELUDE}export const f = East.function([], IntegerType, ($) => $.const(1n as bigint, IntegerType));\n`;
  assert.equal(rule(src).length, 1);
});

// ── Arm A: redundant constructor generics ───────────────────────────────
test("flags redundant `new Map<K, V>()` generics (autofix drops them)", () => {
  const src = `${PRELUDE}export const f = East.function([], DictType(StringType, IntegerType), ($) =>\n  $.let(new Map<string, bigint>(), DictType(StringType, IntegerType)));\n`;
  const hits = rule(src);
  assert.equal(hits.length, 1);
  assert.match(hits[0]!.fix!.changes[0]!.newText, /new Map\(\)/);
});

test("flags redundant `new Set<T>()` generics", () => {
  const src = `${PRELUDE}export const f = East.function([], ArrayType(StringType), ($) =>\n  $.let(new Set<string>(), ArrayType(StringType)));\n`;
  assert.equal(rule(src).length, 1);
});

test("silent on a one-arg `$.let(new Map<…>())` — the generic is load-bearing", () => {
  const src = `${PRELUDE}export const f = East.function([], DictType(StringType, IntegerType), ($) =>\n  $.let(new Map<string, bigint>()));\n`;
  assert.equal(rule(src).length, 0);
});

// ── Arm B: `East.value(x, T)` as the whole first arg of $.let/$.const ────
test("flags `East.value(x)` wrapped in `$.let(…, T)` (autofix lifts the value out)", () => {
  const src = `${PRELUDE}export const f = East.function([], FloatType, ($) => $.let(East.value(1.0), FloatType));\n`;
  const hits = rule(src);
  assert.equal(hits.length, 1);
  assert.match(hits[0]!.fix!.changes[0]!.newText, /\$\.let\(1\.0, FloatType\)/);
});

test("silent when `East.value` is an operand, not the whole first arg", () => {
  const src = `${PRELUDE}export const f = East.function([], FloatType, ($) => $.let(East.value(1.0).add(2.0), FloatType));\n`;
  assert.equal(rule(src).length, 0);
});

// regression: the East.value-in-$.let arm must NOT also trip prefer-let-const (990006)
test("`$.let(East.value(0.0, FloatType), FloatType)` is 990001, not 990006", () => {
  const src = `${PRELUDE}export const f = East.function([], FloatType, ($) => $.let(East.value(0.0, FloatType), FloatType));\n`;
  const all = analyze(src);
  assert.equal(all.filter((d) => d.ruleName === RULE).length, 1);
  assert.equal(all.filter((d) => d.ruleName === "prefer-let-const-over-east-value").length, 0);
});
