/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { analyze, analyzeProgram } from "./harness.js";

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

test("prefer-some-none: flags an Option's case built as a variant in host code", () => {
  const src = `import { OptionType, IntegerType, variant, type ValueTypeOf } from "@elaraai/east";\nconst MaybeInt = OptionType(IntegerType);\nexport const a: ValueTypeOf<typeof MaybeInt> = variant("some", 1n);\nexport const b: ValueTypeOf<typeof MaybeInt> = variant("none", null);\n`;
  assert.equal(rule(src, "prefer-some-none").length, 2);
});

test("prefer-some-none: silent on a `none` or `some` case of a variant that is not an Option", () => {
  // A text decoration's `none`, a path's `some` step: `none` / `some()` would
  // build the same value but name it an Option it is not.
  const src = `import { VariantType, NullType, StringType, variant, type ValueTypeOf } from "@elaraai/east";\nconst DecorationType = VariantType({ none: NullType, underline: NullType });\nconst StepType = VariantType({ field: StringType, some: NullType });\nexport const d: ValueTypeOf<typeof DecorationType> = variant("none", null);\nexport const path: ValueTypeOf<typeof StepType>[] = [variant("field", "a"), variant("some", null)];\n`;
  assert.equal(rule(src, "prefer-some-none").length, 0);
});

test("prefer-some-none: reads the expected type through an enclosing variant's payload", () => {
  // A plan row's group summary is its own variant, `none` among its cases; typed,
  // the fixture says so, and the rule reads it through `variant("group", …)`.
  const src = `import { VariantType, StructType, NullType, IntegerType, variant, type ValueTypeOf } from "@elaraai/east";\nconst SummaryType = VariantType({ none: NullType, cells: IntegerType });\nconst KindType = VariantType({ group: StructType({ summary: SummaryType }) });\nexport const g: ValueTypeOf<typeof KindType> = variant("group", { summary: variant("none", null) });\nexport const f = (): ValueTypeOf<typeof KindType> => variant("group", { summary: variant("none", null) });\n`;
  assert.equal(rule(src, "prefer-some-none").length, 0);
});

test("prefer-some-none: still flags an untyped payload's `none`, and an Option inside a typed payload", () => {
  const src = `import { VariantType, StructType, IntegerType, OptionType, variant, type ValueTypeOf } from "@elaraai/east";\nconst KindType = VariantType({ span: StructType({ rollup: OptionType(IntegerType) }) });\nexport const untyped = variant("group", { summary: variant("none", null) });\nexport const typed: ValueTypeOf<typeof KindType> = variant("span", { rollup: variant("none", null) });\n`;
  assert.equal(rule(src, "prefer-some-none").length, 2);
});

test("prefer-some-none: silent on an unrelated local `variant` function (non-East)", () => {
  // A file that never imports East defining its own `variant` — not our business.
  const src = `const variant = (tag: string, v: unknown) => ({ tag, v });\nexport const _u = variant("some", 1);\n`;
  assert.equal(rule(src, "prefer-some-none").length, 0);
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

test("no-handrolled-variant: silent on an options object the expected union also admits", () => {
  // A factory taking an Option or its own options object: `{ max }` spells no tag.
  const src = `${PRELUDE}import type { variant } from "@elaraai/east";\ndeclare function take(v: variant<"a", bigint> | { max: number }): void;\ntake({ max: 1 });\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "no-handrolled-variant").length, 0);
});

test("no-handrolled-variant: flags a variant built by hand whatever slot it lands in — a hand-written `{ type; value }` parameter, `unknown`, none at all", () => {
  // None of these slots says "variant", and each object is one all the same: a
  // fixture handed through an untyped parameter never reaches East as one.
  const src = `${PRELUDE}declare function struct(s: { type: string; value: bigint }): void;\ndeclare function opaque(v: unknown): void;\nstruct({ type: "a", value: 1n });\nopaque({ type: "b", value: { label: "x" } });\nexport const loose = { type: "c", value: null };\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "no-handrolled-variant").length, 3);
});

test("no-handrolled-variant: flags a variant spelled out in a test matcher, nested or not", () => {
  // `expect(x).toMatchObject({ value: { type: "some", value: 50 } })` — the
  // expectation is a variant built by hand; `some(50)` is the one East builds.
  const src = `${PRELUDE}declare function match<E extends object>(expected: E): void;\nmatch({ value: { type: "some", value: 50 } });\nmatch({ type: "none", value: null });\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "no-handrolled-variant").length, 2);
});

test("no-handrolled-variant: silent on an object that is more than a tag and a payload, and in a file that does not use East", () => {
  const withMore = `${PRELUDE}export const row = { type: "a", value: 1n, label: "x" };\n`;
  assert.equal(analyze(withMore).filter((d) => d.ruleName === "no-handrolled-variant").length, 0);
  const plain = `export const option = { type: "a", value: 1 };\n`;
  assert.equal(analyze(plain).filter((d) => d.ruleName === "no-handrolled-variant").length, 0);
});

test("no-handrolled-variant: silent where East's own host-side API asks for a `{ type, value }` — a merge `Resolution`", () => {
  // `mergeWithResolutionsFor` takes a plain TypeScript union, not a variant.
  const src = `${PRELUDE}import type { Resolution } from "@elaraai/east";\nexport const r: Resolution = { type: "manual", value: 1n };\n`;
  assert.equal(analyze(src).filter((d) => d.ruleName === "no-handrolled-variant").length, 0);
});

test("no-handrolled-variant: silent where a library's own type declares `type` and `value` — flagged where this project's does", () => {
  // A third-party input's props are a `{ type, value }` of its own, not East's;
  // the same object for a parameter this project typed by hand is a variant.
  const dir = process.cwd();
  const entry = join(dir, "__handrolled_variant_entry__.ts");
  const files = {
    [join(dir, "node_modules/ui-lib-fixture/index.d.ts")]:
      `declare module "ui-lib-fixture" {\n  export interface InputProps { type: string; value: string }\n  export function input(props: InputProps): void;\n}\n`,
    [entry]: `${PRELUDE}import { input } from "ui-lib-fixture";\ndeclare function own(props: { type: string; value: string }): void;\ninput({ type: "text", value: "hello" });\nown({ type: "text", value: "hello" });\n`,
  };
  const hits = analyzeProgram(files, entry, {}).filter((d) => d.ruleName === "no-handrolled-variant");
  assert.equal(hits.length, 1);
  assert.equal(files[entry]!.slice(hits[0]!.start - 4, hits[0]!.start), "own(");
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

test("no-relative-src-import: silent when a package imports its OWN src (./src self-import)", () => {
  // The fixture lives at the package root, so `./src/...` resolves inside the
  // importing file's own package — the one legitimate relative-src import (a
  // package cannot import its own published name). `../src` (escaping the package)
  // still fires, as the test above asserts.
  const src = `import { thing } from "./src/thing.js";\nexport const x = thing;\n`;
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