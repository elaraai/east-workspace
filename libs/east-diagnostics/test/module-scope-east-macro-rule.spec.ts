/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./harness.js";

const PRELUDE = `import { East, IntegerType, StringType, ArrayType, variant, some, none } from "@elaraai/east";\n`;
const RULE = "no-module-scope-east-macro";

function rule(source: string) {
  return analyze(source).filter((d) => d.ruleName === RULE);
}

// ── FIRES: module-scope macros ──────────────────────────────────────────
test("flags a module-scope composite-string-key builder", () => {
  assert.equal(rule(`${PRELUDE}const buRoleKey = (o: string, l: string): string => \`\${o}|\${l}\`;\nexport const _u = buRoleKey;\n`).length, 1);
});

test("flags a module-scope `${base}#${ti}` key builder", () => {
  assert.equal(rule(`${PRELUDE}const yKey = (base: string, ti: number): string => \`\${base}#\${ti}\`;\nexport const _u = yKey;\n`).length, 1);
});

test("flags a module-scope East value-constructor helper", () => {
  assert.equal(rule(`${PRELUDE}const mkPred = (n: bigint) => variant("x", n);\nexport const _u = mkPred;\n`).length, 1);
});

test("flags a module-scope function declaration returning some(...)", () => {
  assert.equal(rule(`${PRELUDE}function wrap(x: bigint) { return some(x); }\nexport const _u = wrap;\n`).length, 1);
});

// ── SILENT ──────────────────────────────────────────────────────────────
test("silent on an East.function binding", () => {
  assert.equal(rule(`${PRELUDE}export const f = East.function([IntegerType], IntegerType, ($, n) => n.add(1n));\n`).length, 0);
});

test("silent on a plain-JS string helper (no East, no composite key)", () => {
  assert.equal(rule(`${PRELUDE}const upper = (x: string): string => x.toUpperCase();\nexport const _u = upper;\n`).length, 0);
});

test("silent on a module-scope e3 DECLARATION factory (task / input families)", () => {
  // Structural stand-ins for e3's `TaskDef` / `DatasetDef` (the rule keys on the
  // type NAME, exactly as it would against the real @elaraai/e3 declarations —
  // which CI does not build for this suite).
  const src = `${PRELUDE}interface DatasetDef<T> { name: string; type: T }\ninterface TaskDef<O> { name: string; fn: unknown; output: O }\ndeclare function input<T>(name: string, type: T, seed?: unknown): DatasetDef<T>;\ndeclare function task<O>(name: string, inputs: DatasetDef<unknown>[], fn: unknown): TaskDef<O>;\nexport const mkCounter = (name: string) => input(name, IntegerType, 0n);\nexport const mkTask = (name: string) => task(name, [mkCounter(name)], East.function([IntegerType], IntegerType, ($, n) => $.return(n)));\n`;
  assert.equal(rule(src).length, 0);
});

test("silent on a module-scope platform-definition factory", () => {
  const src = `${PRELUDE}export const mkPlatform = (name: string) => East.platform(name, [IntegerType], IntegerType);\n`;
  assert.equal(rule(src).length, 0);
});

test("silent on an in-block closure (that is `no-host-in-east-block`'s job)", () => {
  assert.equal(rule(`${PRELUDE}export const f = East.function([], IntegerType, ($) => {\n  const g = (n: bigint) => variant("x", n);\n  return $.const(1n, IntegerType);\n});\n`).length, 0);
});

// ── self-gating: a composite-key helper in a NON-East file is not our concern ─
test("silent on a composite-string-key builder in a plain (non-East) TypeScript file", () => {
  // No `@elaraai/*` import → ordinary TS, so the composite-key heuristic stays quiet.
  assert.equal(rule(`const buRoleKey = (o: string, l: string): string => \`\${o}|\${l}\`;\nexport const _u = buRoleKey;\n`).length, 0);
});
