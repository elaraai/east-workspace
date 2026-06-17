/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./harness.js";

const PRELUDE = `import { East, Expr, IntegerType, FloatType, StringType, BooleanType, ArrayType, DictType, StructType, variant, some, none } from "@elaraai/east";\n`;
const RULE = "no-host-in-east-block";

function rule(source: string) {
  return analyze(source).filter((d) => d.ruleName === RULE);
}
const inFn = (body: string, params = "($)") => `${PRELUDE}export const f = East.function([], IntegerType, ${params} => {\n${body}\n});\n`;

// ── FIRES: host constructs inside an East block ─────────────────────────
test("flags a host builtin call (BigInt)", () => {
  assert.equal(rule(inFn(`  const x = BigInt(1);\n  return $.const(1n, IntegerType);`)).length, 1);
});

test("flags a JS Array method on a plain JS array (.indexOf)", () => {
  assert.equal(rule(inFn(`  const i = [1n, 2n, 3n].indexOf(2n);\n  return $.const(1n, IntegerType);`)).length, 1);
});

test("flags an in-block TS closure (definition + call)", () => {
  // Clause E flags the `dbl` declaration; clause A flags the `dbl(2n)` call.
  assert.equal(rule(inFn(`  const dbl = (x: bigint): bigint => x * 2n;\n  return $.const(dbl(2n), IntegerType);`)).length, 2);
});

test("flags an in-block closure that returns East via a JS `?:` (the ratioExpr shape)", () => {
  // The closure body uses a JS string-comparison `?:` over East branches, so
  // clause B stays quiet (condition is not East) — but Clause E flags the
  // closure DECLARATION itself.
  const src = `${PRELUDE}export const f = East.function([IntegerType], IntegerType, ($, n) => {\n  const pick = (key: string): Expr<IntegerType> => key === "a" ? n : n.add(1n);\n  return $.let(pick("a"), IntegerType);\n});\n`;
  // Clause E (pick declaration) + clause A (pick("a") call).
  assert.equal(rule(src).length, 2);
});

test("flags an in-block `function` declaration", () => {
  assert.equal(rule(inFn(`  function dbl(x: bigint): bigint { return x * 2n; }\n  return $.const(1n, IntegerType);`)).length, 1);
});

// ── BUG-1/FP-1: East methods chained off an in-block `any` macro/its params ──
test("does not double-flag East methods chained off an in-block `any` macro or its params", () => {
  // `sdiv` is an in-block TS macro: clause E flags its declaration, clause A flags
  // the `sdiv(x, y)` call. The East methods chained off its `any` params
  // (`b.greater`, `.ifElse`, `a.divide`) and off its `any` result (`.multiply`)
  // must NOT add separate host-call tags — they are East ops, not host calls.
  const src = `${PRELUDE}export const f = East.function([FloatType, FloatType], FloatType, ($, x, y) => {\n  const sdiv = (a: any, b: any): any => b.greater(0.0).ifElse(() => a.divide(b), () => 0.0);\n  return $.const(sdiv(x, y).multiply(100.0), FloatType);\n});\n`;
  assert.equal(rule(src).length, 2); // clause E (decl) + clause A (sdiv call)
});

test("does not flag an East method chained off an in-block macro CALL result (roundI(x).negate())", () => {
  const src = `${PRELUDE}export const f = East.function([FloatType], FloatType, ($, x) => {\n  const roundI = (v: any): any => v.add(0.5);\n  return $.const(roundI(x).negate(), FloatType);\n});\n`;
  assert.equal(rule(src).length, 2); // clause E (decl) + clause A (roundI call); `.negate()` is East
});

test("still flags a genuine host builtin call inside an in-block macro body", () => {
  // A6 exempts East METHODS chained off the macro/its params — never a host call
  // like `BigInt(...)` rooted on a global.
  const src = `${PRELUDE}export const f = East.function([], IntegerType, ($) => {\n  const mk = (v: any): any => BigInt(v);\n  return $.const(mk(1), IntegerType);\n});\n`;
  assert.equal(rule(src).length, 3); // clause E (mk decl) + clause A (BigInt host call) + clause A (mk call)
});

test("flags a host for-of loop emitting East IR", () => {
  assert.equal(rule(inFn(`  const acc = $.let(0n, IntegerType);\n  for (const x of [1n, 2n]) { $.assign(acc, acc.add(x)); }\n  return acc;`)).length, 1);
});

test("flags a host `?:` selecting East values (autofix to ifElse)", () => {
  const hits = rule(`${PRELUDE}export const f = East.function([IntegerType], IntegerType, ($, n) => {\n  const cond = $.let(n.greater(0n), BooleanType);\n  return cond ? n : n.add(1n);\n});\n`);
  assert.equal(hits.length, 1);
  assert.match(hits[0]!.fix!.changes[0]!.newText, /\.ifElse\(/);
});

test("flags host `&&` on East booleans", () => {
  const hits = rule(`${PRELUDE}export const f = East.function([IntegerType], BooleanType, ($, n) => {\n  const a = $.let(n.greater(0n), BooleanType);\n  const b = $.let(n.less(10n), BooleanType);\n  return a && b;\n});\n`);
  assert.equal(hits.length, 1);
});

test("flags host string interpolation", () => {
  assert.equal(rule(`${PRELUDE}export const f = East.function([StringType], StringType, ($, s) => {\n  return $.const(\`p\${s}\`, StringType);\n});\n`).length, 1);
});

test("flags host index access on a JS array (`adopt[ti]`)", () => {
  // The `disc` JS array's `$.let` elements are no-let-const-in-expression's job;
  // this asserts the no-host-in-east-block index-access fire on `disc[0]`.
  const src = inFn(`  const disc = [$.let(1.0, FloatType), $.let(2.0, FloatType)];\n  const ti = 0;\n  return $.const(BigInt(0), IntegerType);\n  void disc[ti];`);
  assert.ok(rule(src).some((d) => /index access/.test(d.messageText)));
});

// ── SILENT: idiomatic East inside the block ─────────────────────────────
test("silent on $.const / $.let bindings of East values", () => {
  assert.equal(rule(inFn(`  const a = $.const(42n, IntegerType);\n  const m = $.let(new Map(), DictType(StringType, IntegerType));\n  return a;`)).length, 0);
});

test("silent on East Expr method chains", () => {
  assert.equal(rule(`${PRELUDE}export const f = East.function([IntegerType], IntegerType, ($, n) => {\n  return n.add(1n).multiply(2n);\n});\n`).length, 0);
});

test("silent on East collection ops with `$`-callbacks", () => {
  assert.equal(rule(inFn(`  const data = $.const([1n, 2n, 3n], ArrayType(IntegerType));\n  const doubled = $.let(data.map(($, x) => x.add(1n)));\n  return doubled.get(0n);`)).length, 0);
});

test("silent on East.value / variant / some / none / Expr.match", () => {
  assert.equal(rule(inFn(`  const v = $.const(East.value(1.0), FloatType);\n  const o = $.let(some(1n));\n  const r = $.let(Expr.match(o, { some: (_$, x) => x, none: (_$) => 0n }));\n  return r;`)).length, 0);
});

test("silent on East type constructors used in a block (@elaraai imports)", () => {
  assert.equal(rule(inFn(`  const xs = $.let([], ArrayType(StructType({ a: IntegerType })));\n  return $.const(1n, IntegerType);`)).length, 0);
});

test("silent on calling a bound East function (A0)", () => {
  assert.equal(rule(inFn(`  const inc = $.const(East.function([IntegerType], IntegerType, ($, x) => x.add(1n)));\n  return inc(2n);`)).length, 0);
});

test("silent on a JS-condition ternary over host values", () => {
  assert.equal(rule(`${PRELUDE}export const f = East.function([IntegerType], IntegerType, ($, n) => {\n  const ti = 0;\n  return ti === 0 ? n : n.add(1n);\n});\n`).length, 0);
});

test("silent outside any East block", () => {
  assert.equal(rule(`${PRELUDE}const i = [1n, 2n].indexOf(1n);\nexport const _u = i;\n`).length, 0);
});
