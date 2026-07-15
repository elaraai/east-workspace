/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./harness.js";

const RULE = "no-compile-time-data-injection";
// The rule only applies to DEPLOYABLE East/e3 source — a file importing
// `@elaraai/*` AND declaring a program (an e3 definition / East factory).
// Plain Node scripts and host-side TOOLING are out of scope.
const EAST =
  `import e3 from "@elaraai/e3";\nimport { IntegerType } from "@elaraai/east";\n` +
  `export const counter = e3.input("counter", IntegerType, 0n);\n`;

function rule(source: string) {
  return analyze(source).filter((d) => d.ruleName === RULE);
}

test("flags a `node:fs` import", () => {
  const src = `${EAST}import { readFileSync } from "node:fs";\nexport const _u = readFileSync;\n`;
  assert.equal(rule(src).length, 1);
});

test("flags a call that resolves to a node:fs import (import + call)", () => {
  const src = `${EAST}import { readFileSync } from "node:fs";\nexport const data = readFileSync("x.csv", "utf8");\n`;
  // one for the import, one for the call
  assert.equal(rule(src).length, 2);
});

test("flags an aliased node:fs import call (symbol-grounded, not name-matched)", () => {
  const src = `${EAST}import { readFileSync as rf } from "node:fs";\nexport const data = rf("x", "utf8");\n`;
  assert.equal(rule(src).length, 2);
});

test("flags `existsSync` from node:fs (any fs call, not a hardcoded name)", () => {
  const src = `${EAST}import { existsSync } from "node:fs";\nexport const ok = existsSync("x");\n`;
  assert.equal(rule(src).length, 2);
});

test("flags `JSON.parse` at module scope", () => {
  const src = `${EAST}export const cfg = JSON.parse("{}");\n`;
  assert.equal(rule(src).length, 1);
});

test("flags `process.env` at module scope", () => {
  const src = `${EAST}export const dir = process.env["DATA_DIR"];\n`;
  assert.equal(rule(src).length, 1);
});

test("silent on a prose `.csv` mention in a string literal", () => {
  const src = `${EAST}export const note = "values come from tam.csv (BU x year)";\n`;
  assert.equal(rule(src).length, 0);
});

test("silent on an unrelated local function named readFileSync (not the node:fs symbol)", () => {
  const src = `${EAST}function readFileSync(_x: string): string { return ""; }\nexport const v = readFileSync("x");\n`;
  assert.equal(rule(src).length, 0);
});

test("silent in host-side TOOLING — imports @elaraai/* but declares no program", () => {
  // The e3-ui-cli shape: East utilities imported for IR work, runtime file I/O
  // is the tool's job. No `East.*` factory / e3 definition / ui() ⇒ not
  // deployable source ⇒ not our business.
  const src =
    `import { readFileSync } from "node:fs";\n` +
    `import { encodeEastIR, type EastIR } from "@elaraai/east";\n` +
    `export const bytes = readFileSync("component.beast2");\n` +
    `export const cfg = JSON.parse("{}");\n` +
    `export const _u = encodeEastIR;\n`;
  assert.equal(rule(src).length, 0);
});

// ── self-gating: not East/e3 source → none of our business ──────────────────
test("silent in a plain (non-East) TypeScript file — fs/JSON.parse/process.env are fine there", () => {
  const src =
    `import { readFileSync } from "node:fs";\n` +
    `export const data = readFileSync("x.csv", "utf8");\n` +
    `export const cfg = JSON.parse("{}");\n` +
    `export const dir = process.env["DATA_DIR"];\n`;
  assert.equal(rule(src).length, 0);
});

test("silent inside a platform `.implement(...)` body — that IS the runtime", () => {
  // The east-node-std shape: `East.platform(...)` declares a program, but the
  // implementation callback executes on the host at runtime — reading
  // `process.env` there is exactly what a platform function is for.
  const src =
    `import { East, StringType } from "@elaraai/east";\n` +
    `export const env_get = East.platform("env_get", [StringType], StringType);\n` +
    `export const impl = env_get.implement((name: string) => process.env[name] ?? "");\n`;
  assert.equal(rule(src).length, 0);
});
