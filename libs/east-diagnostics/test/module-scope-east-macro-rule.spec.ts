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

test("silent on an in-block closure (that is `no-host-in-east-block`'s job)", () => {
  assert.equal(rule(`${PRELUDE}export const f = East.function([], IntegerType, ($) => {\n  const g = (n: bigint) => variant("x", n);\n  return $.const(1n, IntegerType);\n});\n`).length, 0);
});
