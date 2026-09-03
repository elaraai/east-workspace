/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./harness.js";

const PRELUDE = `import { East, IntegerType, FloatType, ArrayType } from "@elaraai/east";\n`;

function wrap(body: string): string {
  return `${PRELUDE}export const f = East.function([], IntegerType, ($) => {\n${body}\n  return 1n;\n});\n`;
}

function rule(source: string, ruleName: string) {
  return analyze(source).filter((d) => d.ruleName === ruleName);
}

test("no-redundant-east-cast: flags `as` cast on the value of a 2-arg $.let", () => {
  const hits = rule(wrap(`  const a = $.let([] as number[], ArrayType(FloatType));`), "no-redundant-east-cast");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.fix?.changes[0]?.newText, "[]");
});

test("no-redundant-east-cast: flags angle-bracket cast too", () => {
  const hits = rule(wrap(`  const a = $.const(<number[]>[], ArrayType(FloatType));`), "no-redundant-east-cast");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.fix?.changes[0]?.newText, "[]");
});

test("no-redundant-east-cast: silent when there is no cast", () => {
  const hits = rule(wrap(`  const a = $.let([], ArrayType(FloatType));`), "no-redundant-east-cast");
  assert.equal(hits.length, 0);
});

test("no-redundant-east-cast: silent in the 1-arg form (cast is load-bearing there)", () => {
  const hits = rule(wrap(`  const a = $.let([1n, 2n] as bigint[]);`), "no-redundant-east-cast");
  assert.equal(hits.length, 0);
});

test("no-redundant-east-cast: ignores a non-BlockBuilder `.let`", () => {
  const src = `${PRELUDE}declare const fake: { let(a: unknown, b: unknown): unknown };\nexport const z = fake.let([] as number[], 1);\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "no-redundant-east-cast").length, 0);
});

test("prefer-let-const-over-east-value: flags a callback returning East.value of a value that types itself", () => {
  const src = `${PRELUDE}import { StructType } from "@elaraai/east";\nexport const f = East.function([ArrayType(IntegerType)], IntegerType, ($, xs) => {\n  const rows = $.const(xs.map(($, x) => East.value({ a: x }, StructType({ a: IntegerType }))));\n  return rows.size();\n});\n`;
  const hits = rule(src, "prefer-let-const-over-east-value");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.fix?.changes[0]?.newText, "{ a: x }");
});

test("prefer-let-const-over-east-value: silent where the type on a returned East.value is load-bearing (none, some, an empty collection, a variant)", () => {
  const src = `${PRELUDE}import { OptionType, DictType, StringType, VariantType, Expr, none, some, variant } from "@elaraai/east";\n`
    + `export const f = East.function([ArrayType(IntegerType)], IntegerType, ($, xs) => {\n`
    + `  const a = $.const(xs.map(($, _x) => East.value(none, OptionType(IntegerType))));\n`
    + `  const s = $.const(xs.map(($, x) => East.value(some(x), OptionType(IntegerType))));\n`
    + `  const b = $.const(xs.map(($, _x) => East.value([], ArrayType(IntegerType))));\n`
    + `  const c = $.const(xs.map(($, _x) => East.value(new Map(), DictType(StringType, IntegerType))));\n`
    + `  const d = $.const(xs.map(($, x) => East.value(variant("a", x), VariantType({ a: IntegerType, b: StringType }))));\n`
    + `  const e = $.const(xs.map(($, x) => Expr.block(($) => {\n    return East.value([], ArrayType(IntegerType));\n  })));\n`
    + `  return a.size().add(s.size()).add(b.size()).add(c.size()).add(d.size()).add(e.size());\n});\n`;
  assert.equal(rule(src, "prefer-let-const-over-east-value").length, 0);
});

test("prefer-explicit-east-type: flags one-arg $.let on an empty array", () => {
  const hits = rule(wrap(`  const c = $.let([]);`), "prefer-explicit-east-type");
  assert.equal(hits.length, 1);
});

test("prefer-explicit-east-type: flags one-arg $.let on new Map()", () => {
  const hits = rule(wrap(`  const c = $.let(new Map());`), "prefer-explicit-east-type");
  assert.equal(hits.length, 1);
});

test("prefer-explicit-east-type: silent on an East expression", () => {
  const hits = rule(wrap(`  const d = $.let(East.value(1n));`), "prefer-explicit-east-type");
  assert.equal(hits.length, 0);
});

test("prefer-explicit-east-type: silent on a scalar literal by default", () => {
  const hits = rule(wrap(`  const g = $.let(42n);`), "prefer-explicit-east-type");
  assert.equal(hits.length, 0);
});

test("prefer-explicit-east-type: all-raw-values mode flags a scalar literal", () => {
  const src = wrap(`  const g = $.let(42n);`);
  const hits = analyze(src, { preferExplicitEastType: { mode: "all-raw-values" } }).filter(
    (d) => d.ruleName === "prefer-explicit-east-type",
  );
  assert.equal(hits.length, 1);
});