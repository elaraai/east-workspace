/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, analyzeTsx } from "./harness.js";

const PRELUDE = `import { East, Expr, IntegerType, FloatType, NullType, StringType, BooleanType, ArrayType, StructType, variant, some, none, example } from "@elaraai/east";\n`;

function rule(source: string, ruleName: string) {
  return analyze(source).filter((d) => d.ruleName === ruleName);
}
function ruleTsx(source: string, ruleName: string) {
  return analyzeTsx(source).filter((d) => d.ruleName === ruleName);
}

// ── require-runner-platforms ─────────────────────────────────────────────
test("require-runner-platforms: flags a task calling a project platform fn with no custom platforms entry", () => {
  const src = `import e3 from "@elaraai/e3";\n${PRELUDE}const fetchRows = East.platform("proj.fetch_rows", [IntegerType], ArrayType(IntegerType));\nexport const t = e3.task("rows", [], East.function([IntegerType], ArrayType(IntegerType), ($, n) => $.return(fetchRows(n))), { runner: { runtime: "east-py" } });\n`;
  assert.equal(rule(src, "require-runner-platforms").length, 1);
});

test("require-runner-platforms: silent when the runner declares a custom platform module", () => {
  const src = `import e3 from "@elaraai/e3";\n${PRELUDE}const fetchRows = East.platform("proj.fetch_rows", [IntegerType], ArrayType(IntegerType));\nexport const t = e3.task("rows", [], East.function([IntegerType], ArrayType(IntegerType), ($, n) => $.return(fetchRows(n))), { runner: { runtime: "east-py", platforms: [{ custom: "platform_module" }] } });\n`;
  assert.equal(rule(src, "require-runner-platforms").length, 0);
});

test("require-runner-platforms: silent when the task calls no project platform fns", () => {
  const src = `import e3 from "@elaraai/e3";\n${PRELUDE}export const t = e3.task("rows", [], East.function([IntegerType], IntegerType, ($, n) => $.return(n.add(1n))), { runner: { runtime: "east-c" } });\n`;
  assert.equal(rule(src, "require-runner-platforms").length, 0);
});

// ── no-cross-block-builder ───────────────────────────────────────────────
test("no-cross-block-builder: flags a nested callback emitting via the OUTER $", () => {
  const src = `${PRELUDE}export const f = East.function([ArrayType(IntegerType)], ArrayType(IntegerType), ($, xs) =>\n  $.return(xs.map((_$, x) => {\n    const y = $.let(x.add(1n));\n    return y;\n  })));\n`;
  const hits = rule(src, "no-cross-block-builder");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.category, "error");
});

test("no-cross-block-builder: silent when the callback uses its own $", () => {
  const src = `${PRELUDE}export const f = East.function([ArrayType(IntegerType)], ArrayType(IntegerType), ($, xs) =>\n  $.return(xs.map(($, x) => {\n    const y = $.let(x.add(1n));\n    return y;\n  })));\n`;
  assert.equal(rule(src, "no-cross-block-builder").length, 0);
});

test("no-cross-block-builder: match-arm property labels are not cross-scope references", () => {
  // `.match({ some: (_$, x) => x, none: (_$) => nan })` inside a nested arm —
  // the `some`/`none` labels resolve to PropertyAssignments inside the crossed
  // arm but are labels, not value references (the planner.tsx regression).
  const src = `${PRELUDE}export const f = East.function([ArrayType(FloatType), StringType], ArrayType(FloatType), ($, daily, key) => {\n  const nan = $.const(NaN, FloatType);\n  return daily.filterMap(($, d) => {\n    return d.greater(0.0).ifElse(\n      ($) => {\n        const label = $.let(d.greater(1.0).ifElse(\n          (_$) => East.value("+"),\n          (_$) => {\n            const v = $.let(some(d).match({ some: (_$, x) => x, none: (_$) => nan }), FloatType);\n            return East.value("x");\n          },\n        ), StringType);\n        return some(d);\n      },\n      (_$) => none,\n    );\n  });\n});\n`;
  assert.equal(rule(src, "no-cross-block-builder").length, 0);
});

test("no-cross-block-builder: silent on hoisting a PURE constant via the outer $ (the match-arm idiom)", () => {
  // `none: (_$) => $.const([], ArrayType(T))` — references nothing inner-scoped,
  // so the outer-block emission is a harmless hoisted constant.
  const src = `${PRELUDE}export const f = East.function([ArrayType(IntegerType)], ArrayType(IntegerType), ($, xs) =>\n  $.return(xs.map((_$, x) => {\n    const empty = $.const([], ArrayType(IntegerType));\n    return empty;\n  })));\n`;
  assert.equal(rule(src, "no-cross-block-builder").length, 0);
});

// ── no-state-outside-reactive ────────────────────────────────────────────
test("no-state-outside-reactive: flags State.bind at a ui() surface root with no <Reactive>", () => {
  const src = `import { State } from "@elaraai/east-ui";\nimport { ui } from "@elaraai/e3-ui";\n${PRELUDE}export const t = ui("surface", [], East.function([], IntegerType, ($) => {\n  const s = State.bind([IntegerType], "count", 0n);\n  return $.const(1n, IntegerType);\n}));\n`;
  assert.equal(rule(src, "no-state-outside-reactive").length, 1);
});

test("no-state-outside-reactive: silent inside a <Reactive> builder at the surface root", () => {
  const src = `import { State, Reactive } from "@elaraai/east-ui";\nimport { ui } from "@elaraai/e3-ui";\n${PRELUDE}export const t = ui("surface", [], East.function([], IntegerType, (_$) => {\n  const el = <Reactive>{($: any) => {\n    const s = State.bind([IntegerType], "count", 0n);\n    return s;\n  }}</Reactive>;\n  return _$.const(1n, IntegerType);\n}));\n`;
  assert.equal(ruleTsx(src, "no-state-outside-reactive").length, 0);
});

test("no-state-outside-reactive: silent in a composition helper (may be mounted inside the caller's Reactive)", () => {
  // The modify.tsx shape: a helper East.function using State.bind — the caller
  // mounts its subtree inside a <Reactive>, which a lexical check cannot see.
  const src = `import { State } from "@elaraai/east-ui";\n${PRELUDE}export const f = East.function([], IntegerType, ($) => {\n  const s = State.bind([IntegerType], "count", 0n);\n  return $.const(1n, IntegerType);\n});\n`;
  assert.equal(rule(src, "no-state-outside-reactive").length, 0);
});

// ── prefer-const-ui-callbacks ────────────────────────────────────────────
test("prefer-const-ui-callbacks: flags an East.function inline in a JSX prop inside <Reactive>", () => {
  const src = `${PRELUDE}declare const Reactive: any;\nexport const f = East.function([], IntegerType, ($) => {\n  const el = <Reactive>{<panel onClick={East.function([], NullType, (_$) => null)} />}</Reactive>;\n  return $.const(1n, IntegerType);\n});\n`;
  assert.equal(ruleTsx(src, "prefer-const-ui-callbacks").length, 1);
});

test("prefer-const-ui-callbacks: silent when the handler is $.const-bound and passed as a handle", () => {
  const src = `${PRELUDE}declare const Reactive: any;\nexport const f = East.function([], IntegerType, ($) => {\n  const onClick = $.const(East.function([], NullType, (_$) => null));\n  const el = <Reactive>{<panel onClick={onClick} />}</Reactive>;\n  return $.const(1n, IntegerType);\n});\n`;
  assert.equal(ruleTsx(src, "prefer-const-ui-callbacks").length, 0);
});

test("prefer-const-ui-callbacks: silent in a STATIC (non-Reactive) tree — no re-render, no identity hazard", () => {
  const src = `${PRELUDE}export const f = East.function([], IntegerType, ($) => {\n  const el = <panel onClick={East.function([], NullType, (_$) => null)} />;\n  return $.const(1n, IntegerType);\n});\n`;
  assert.equal(ruleTsx(src, "prefer-const-ui-callbacks").length, 0);
});

// ── no-dynamic-bind-path ─────────────────────────────────────────────────
test("no-dynamic-bind-path: flags an Expr-typed Data.bind key", () => {
  const src = `import { Data } from "@elaraai/e3-ui";\n${PRELUDE}export const f = East.function([], IntegerType, ($) => {\n  const b = Data.bind(East.value("k"));\n  return $.const(1n, IntegerType);\n});\n`;
  assert.equal(rule(src, "no-dynamic-bind-path").length, 1);
});

test("no-dynamic-bind-path: flags an Expr-typed State.bind key (2nd arg)", () => {
  const src = `import { State } from "@elaraai/east-ui";\n${PRELUDE}export const f = East.function([], IntegerType, ($) => {\n  const s = State.bind([IntegerType], East.value("k"), 0n);\n  return $.const(1n, IntegerType);\n});\n`;
  assert.equal(rule(src, "no-dynamic-bind-path").length, 1);
});

test("no-dynamic-bind-path: silent on constant keys and dataset defs", () => {
  const src = `import { Data, State } from "@elaraai/e3-ui";\n${PRELUDE}const ds = { kind: "dataset" };\nexport const f = East.function([], IntegerType, ($) => {\n  const a = Data.bind(ds);\n  const s = State.bind([IntegerType], "count", 0n);\n  return $.const(1n, IntegerType);\n});\n`;
  assert.equal(rule(src, "no-dynamic-bind-path").length, 0);
});

// ── no-build-time-clock ──────────────────────────────────────────────────
test("no-build-time-clock: flags module-scope Date.now() and argless new Date()", () => {
  const src = `${PRELUDE}export const stamp = Date.now();\nexport const when = new Date();\nexport const inside = new Date(Date.now() - 3_600_000);\n`;
  assert.equal(rule(src, "no-build-time-clock").length, 3);
});

test("no-build-time-clock: silent inside functions and on authored constants", () => {
  const src = `${PRELUDE}export const at = new Date("2026-06-30T07:00:00Z");\nexport const f = () => Date.now();\n`;
  assert.equal(rule(src, "no-build-time-clock").length, 0);
});

test("no-build-time-clock: silent in a non-East file", () => {
  assert.equal(rule(`export const stamp = Date.now();\n`, "no-build-time-clock").length, 0);
});

// ── no-handrolled-value-type-mirror ──────────────────────────────────────
test("no-handrolled-value-type-mirror: flags an interface mirroring an in-scope East type", () => {
  const src = `${PRELUDE}export const FooType = StructType({ a: IntegerType });\nexport interface Foo { a: bigint }\n`;
  assert.equal(rule(src, "no-handrolled-value-type-mirror").length, 1);
});

test("no-handrolled-value-type-mirror: flags the Value-suffixed mirror too", () => {
  const src = `${PRELUDE}export const FooType = StructType({ a: IntegerType });\nexport type FooValue = { a: bigint };\n`;
  assert.equal(rule(src, "no-handrolled-value-type-mirror").length, 1);
});

test("no-handrolled-value-type-mirror: silent without a matching East type value", () => {
  const src = `${PRELUDE}export interface Foo { a: bigint }\n`;
  assert.equal(rule(src, "no-handrolled-value-type-mirror").length, 0);
});

// ── no-host-comparison-on-east-values ────────────────────────────────────
test("no-host-comparison-on-east-values: flags === on decoded variants", () => {
  const src = `${PRELUDE}import type { variant as VariantValue } from "@elaraai/east";\ndeclare const a: VariantValue<"x", bigint>;\ndeclare const b: VariantValue<"x", bigint>;\nexport const eq = a === b;\n`;
  assert.equal(rule(src, "no-host-comparison-on-east-values").length, 1);
});

test("no-host-comparison-on-east-values: silent on null presence checks and primitives", () => {
  const src = `${PRELUDE}import type { variant as VariantValue } from "@elaraai/east";\ndeclare const a: VariantValue<"x", bigint> | null;\nexport const isSet = a !== null;\nexport const n = 1n === 2n;\n`;
  assert.equal(rule(src, "no-host-comparison-on-east-values").length, 0);
});

// ── require-example-returns ──────────────────────────────────────────────
test("require-example-returns: flags example() without returns for a value output", () => {
  const src = `${PRELUDE}export const ex = example({\n  keywords: ["k"], description: "d",\n  fn: East.function([], IntegerType, ($) => $.const(1n, IntegerType)),\n  inputs: [],\n});\n`;
  assert.equal(rule(src, "require-example-returns").length, 1);
});

test("require-example-returns: silent with returns, and for NullType/UIComponentType outputs", () => {
  const src = `${PRELUDE}declare const UIComponentType: any;\nexport const a = example({ keywords: ["k"], description: "d", fn: East.function([], IntegerType, ($) => $.const(1n, IntegerType)), inputs: [], returns: 1n });\nexport const b = example({ keywords: ["k"], description: "d", fn: East.function([], NullType, (_$) => null), inputs: [] });\nexport const c = example({ keywords: ["k"], description: "d", fn: East.function([], UIComponentType, (_$) => null as any), inputs: [] });\n`;
  assert.equal(rule(src, "require-example-returns").length, 0);
});

// ── no-duplicate-definition-name ─────────────────────────────────────────
test("no-duplicate-definition-name: flags two same-kind definitions with one name", () => {
  const src = `import e3 from "@elaraai/e3";\n${PRELUDE}export const a = e3.task("frame", [], East.function([], IntegerType, ($) => $.return(1n)));\nexport const b = e3.task("frame", [], East.function([], IntegerType, ($) => $.return(2n)));\n`;
  const hits = rule(src, "no-duplicate-definition-name");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.category, "error");
});

test("no-duplicate-definition-name: silent across kinds and for unique names", () => {
  const src = `import e3 from "@elaraai/e3";\n${PRELUDE}export const a = e3.task("frame", [], East.function([], IntegerType, ($) => $.return(1n)));\nexport const b = e3.input("frame", IntegerType);\nexport const c = e3.task("other", [], East.function([], IntegerType, ($) => $.return(2n)));\n`;
  assert.equal(rule(src, "no-duplicate-definition-name").length, 0);
});
