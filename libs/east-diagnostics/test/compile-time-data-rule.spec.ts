/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./harness.js";

const RULE = "no-compile-time-data-injection";

function rule(source: string) {
  return analyze(source).filter((d) => d.ruleName === RULE);
}

test("flags a `node:fs` import", () => {
  const src = `import { readFileSync } from "node:fs";\nexport const _u = readFileSync;\n`;
  assert.equal(rule(src).length, 1);
});

test("flags a call that resolves to a node:fs import (import + call)", () => {
  const src = `import { readFileSync } from "node:fs";\nexport const data = readFileSync("x.csv", "utf8");\n`;
  // one for the import, one for the call
  assert.equal(rule(src).length, 2);
});

test("flags an aliased node:fs import call (symbol-grounded, not name-matched)", () => {
  const src = `import { readFileSync as rf } from "node:fs";\nexport const data = rf("x", "utf8");\n`;
  assert.equal(rule(src).length, 2);
});

test("flags `existsSync` from node:fs (any fs call, not a hardcoded name)", () => {
  const src = `import { existsSync } from "node:fs";\nexport const ok = existsSync("x");\n`;
  assert.equal(rule(src).length, 2);
});

test("flags `JSON.parse` at module scope", () => {
  const src = `export const cfg = JSON.parse("{}");\n`;
  assert.equal(rule(src).length, 1);
});

test("flags `process.env` at module scope", () => {
  const src = `export const dir = process.env["DATA_DIR"];\n`;
  assert.equal(rule(src).length, 1);
});

test("silent on a prose `.csv` mention in a string literal", () => {
  const src = `export const note = "values come from tam.csv (BU x year)";\n`;
  assert.equal(rule(src).length, 0);
});

test("silent on an unrelated local function named readFileSync (not the node:fs symbol)", () => {
  const src = `function readFileSync(_x: string): string { return ""; }\nexport const v = readFileSync("x");\n`;
  assert.equal(rule(src).length, 0);
});
