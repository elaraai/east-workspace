/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./harness.js";

const PRELUDE = `import { East, IntegerType, FloatType, ArrayType, variant, some, none } from "@elaraai/east";\n`;

function wrap(body: string): string {
  return `${PRELUDE}export const f = East.function([], IntegerType, ($) => {\n${body}\n  return 1n;\n});\n`;
}

function rule(source: string, ruleName: string) {
  return analyze(source).filter((d) => d.ruleName === ruleName);
}

// ── prefer-some-none ────────────────────────────────────────────────
test('prefer-some-none: flags variant("some", x)', () => {
  assert.equal(rule(wrap(`  const v = $.const(variant("some", 1n));`), "prefer-some-none").length, 1);
});

test('prefer-some-none: flags variant("none", null)', () => {
  assert.equal(rule(wrap(`  const v = $.const(variant("none", null));`), "prefer-some-none").length, 1);
});

test("prefer-some-none: silent on a normal variant tag", () => {
  assert.equal(rule(wrap(`  const v = $.const(variant("active", 1n));`), "prefer-some-none").length, 0);
});

// ── no-handrolled-variant ───────────────────────────────────────────
test("no-handrolled-variant: flags an object literal where a variant is expected", () => {
  const src = `${PRELUDE}import type { variant } from "@elaraai/east";\ndeclare function take(v: variant<"a" | "b", bigint>): void;\ntake({ type: "a", value: 1n });\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "no-handrolled-variant").length, 1);
});

test("no-handrolled-variant: silent when using variant()", () => {
  const src = `${PRELUDE}import type { variant } from "@elaraai/east";\ndeclare function take(v: variant<"a" | "b", bigint>): void;\ntake(variant("a", 1n));\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "no-handrolled-variant").length, 0);
});

test("no-handrolled-variant: silent for a plain struct position", () => {
  const src = `${PRELUDE}declare function take(s: { type: string; value: bigint }): void;\ntake({ type: "a", value: 1n });\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "no-handrolled-variant").length, 0);
});

// ── no-east-namespaced-type ─────────────────────────────────────────
test("no-east-namespaced-type: flags East.IntegerType", () => {
  const src = `${PRELUDE}export const t = East.IntegerType;\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "no-east-namespaced-type").length, 1);
});

test("no-east-namespaced-type: silent on East.value / East.function", () => {
  assert.equal(rule(wrap(`  const a = $.let(1n, IntegerType);`), "no-east-namespaced-type").length, 0);
});

// ── prefer-let-const-over-east-value ────────────────────────────────
test("prefer-let-const-over-east-value: flags East.value() declaration inside a block", () => {
  assert.equal(rule(wrap(`  const xs = East.value([1n, 2n]);`), "prefer-let-const-over-east-value").length, 1);
});

test("prefer-let-const-over-east-value: silent at module level", () => {
  const src = `${PRELUDE}export const xs = East.value([1n, 2n]);\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "prefer-let-const-over-east-value").length, 0);
});

test("prefer-let-const-over-east-value: flags `return East.value(...)` inside a block", () => {
  const src = `${PRELUDE}export const g = East.function([], IntegerType, ($) => { return East.value(1n); });\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "prefer-let-const-over-east-value").length, 1);
});

test("prefer-let-const-over-east-value: flags East.value() as a .map callback's concise body", () => {
  const src = `${PRELUDE}export const g = East.function([ArrayType(IntegerType)], ArrayType(IntegerType), ($, xs) => {\n  const ys = $.let(xs.map(($, x) => East.value(x.add(1n), IntegerType)), ArrayType(IntegerType));\n  return ys;\n});\n`;
  const hits = analyze(src).filter((d) => d.ruleName === "prefer-let-const-over-east-value");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.fix?.changes[0]?.newText, "x.add(1n)");
});

test("prefer-let-const-over-east-value: silent for a plain-value .map callback", () => {
  const src = `${PRELUDE}export const g = East.function([ArrayType(IntegerType)], ArrayType(IntegerType), ($, xs) => {\n  const ys = $.let(xs.map(($, x) => x.add(1n)), ArrayType(IntegerType));\n  return ys;\n});\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "prefer-let-const-over-east-value").length, 0);
});

test("prefer-let-const-over-east-value: silent for a free factory arrow (type is load-bearing)", () => {
  const src = `${PRELUDE}export const g = East.function([], IntegerType, ($) => {\n  const make = (n: bigint) => East.value(n, IntegerType);\n  return $.const(make(1n));\n});\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "prefer-let-const-over-east-value").length, 0);
});

// ── no-relative-src-import ──────────────────────────────────────────
test("no-relative-src-import: flags a relative ../src import", () => {
  const src = `import { Console } from "../src/console.js";\nexport const x = Console;\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "no-relative-src-import").length, 1);
});

test("no-relative-src-import: flags a deep @elaraai/.../src import", () => {
  const src = `import { East } from "@elaraai/east/src/index.js";\nexport const x = East;\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "no-relative-src-import").length, 1);
});

test("no-relative-src-import: silent on the published package name", () => {
  const src = `${PRELUDE}export const x = East;\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "no-relative-src-import").length, 0);
});

// ── no-let-const-in-expression ──────────────────────────────────────
test("no-let-const-in-expression: flags $.let as a struct-field value (`field: $.let(...)`)", () => {
  const src = `import { East, IntegerType, StructType } from "@elaraai/east";\nexport const f = East.function([IntegerType], StructType({ x: IntegerType }), ($, n) => {\n  return { x: $.let(n.add(1n), IntegerType) };\n});\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "no-let-const-in-expression").length, 1);
});

test("no-let-const-in-expression: flags $.let as an array element", () => {
  assert.equal(rule(wrap(`  const xs = [$.let(1n, IntegerType)];`), "no-let-const-in-expression").length, 1);
});

test("no-let-const-in-expression: flags $.let passed as an argument ($.if($.let(...)))", () => {
  const src = wrap(`  $.if($.let(true, IntegerType), ($) => {});`);
  assert.equal(rule(src, "no-let-const-in-expression").length, 1);
});

test("no-let-const-in-expression: flags chaining off $.let", () => {
  assert.equal(rule(wrap(`  const y = $.let(0n, IntegerType).add(1n);`), "no-let-const-in-expression").length, 1);
});

test("no-let-const-in-expression: flags $.const buried as a call argument inside $.let's value", () => {
  // Reported miss: `$.let(East.max(preds.get(i), $.const(0.0)))` — the inner
  // $.const is an argument to a call nested in $.let's value (same AST shape as
  // `n.add($.const(2n))`), so it must still fire even though the outer $.let is
  // a valid const initializer.
  const src = `${PRELUDE}export const g = East.function([IntegerType], IntegerType, ($, n) => {
  const y = $.let(n.add($.const(2n)), IntegerType);
  return y;
});\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "no-let-const-in-expression").length, 1);
});

test("no-let-const-in-expression: silent for a plain const declaration", () => {
  assert.equal(rule(wrap(`  const a = $.let(0n, IntegerType);`), "no-let-const-in-expression").length, 0);
});

test("no-let-const-in-expression: silent when parenthesized then assigned", () => {
  assert.equal(rule(wrap(`  const a = ($.let(0n, IntegerType));`), "no-let-const-in-expression").length, 0);
});

test("no-let-const-in-expression: silent on `return $.const(...)` (canonical)", () => {
  const src = `${PRELUDE}export const g = East.function([], IntegerType, ($) => { return $.const(42n, IntegerType); });\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "no-let-const-in-expression").length, 0);
});

test("no-let-const-in-expression: silent on a concise arrow body `($) => $.const(...)`", () => {
  const src = `${PRELUDE}export const g = East.function([], IntegerType, ($) => $.const(42n, IntegerType));\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "no-let-const-in-expression").length, 0);
});