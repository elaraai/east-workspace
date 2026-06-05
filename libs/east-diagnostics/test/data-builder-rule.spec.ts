/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, analyzeTsx } from "./harness.js";

const PRELUDE = `import { East, IntegerType, StringType, ArrayType, variant, some, none } from "@elaraai/east";\n`;
const RULE = "no-east-data-builder-helper";

function rule(source: string, tsx = false) {
  return (tsx ? analyzeTsx(source) : analyze(source)).filter((d) => d.ruleName === RULE);
}

// ── flags TS helpers that return a hand-built East value ────────────────
test("flags an arrow returning variant(...)", () => {
  const src = `${PRELUDE}const mkPred = (field: string, n: bigint) =>
  variant("integer", { fieldId: field, op: variant("gte", n) });\nexport const _u = mkPred;\n`;
  assert.equal(rule(src).length, 1);
});

test("flags an arrow returning some(...)", () => {
  const src = `${PRELUDE}const wrap = (x: bigint) => some(x);\nexport const _u = wrap;\n`;
  assert.equal(rule(src).length, 1);
});

test("flags an arrow returning bare none", () => {
  const src = `${PRELUDE}const empty = () => none;\nexport const _u = empty;\n`;
  assert.equal(rule(src).length, 1);
});

test("flags an arrow returning East.value(...)", () => {
  const src = `${PRELUDE}const make = (n: bigint) => East.value(n, IntegerType);\nexport const _u = make;\n`;
  assert.equal(rule(src).length, 1);
});

test("flags a function declaration whose every return is a value constructor", () => {
  const src = `${PRELUDE}function mk(b: boolean) {
  if (b) return variant("a", 1n);
  return variant("b", 2n);
}\nexport const _u = mk;\n`;
  assert.equal(rule(src).length, 1);
});

// ── stays silent on legitimate shapes ───────────────────────────────────
test("silent on an East.function binding", () => {
  const src = `${PRELUDE}const f = East.function([IntegerType], IntegerType, ($, n) => n.add(1n));\nexport const _u = f;\n`;
  assert.equal(rule(src).length, 0);
});

test("silent on a BlockBuilder callback returning a value constructor (East callback, not a TS helper)", () => {
  const src = `${PRELUDE}declare class BlockBuilder { let(v: unknown): unknown; }
const cb = ($: BlockBuilder, x: bigint) => some(x);\nexport const _u = cb;\n`;
  assert.equal(rule(src).length, 0);
});

test("silent on a helper returning a JSX element (UI composition)", () => {
  const src = `${PRELUDE}const badge = (label: string) => <Badge>{label}</Badge>;\nexport const _u = badge;\n`;
  assert.equal(rule(src, true).length, 0);
});

test("silent when a return mixes constructors with other logic", () => {
  const src = `${PRELUDE}const f = (b: boolean) => {
  if (b) return variant("a", 1n);
  return 0n;
};\nexport const _u = f;\n`;
  assert.equal(rule(src).length, 0);
});

test("silent on an inline $.const(variant(...)) (not a free helper)", () => {
  const src = `${PRELUDE}export const g = East.function([], IntegerType, ($) => {
  const v = $.const(variant("a", 1n));
  return 1n;
});\n`;
  assert.equal(rule(src).length, 0);
});
