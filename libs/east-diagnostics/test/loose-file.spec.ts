/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, analyzeProgram } from "./harness.js";

// A file with two sure diagnostics inside a project: a redundant cast under
// `$.let` and a bare East expression statement.
const SOURCE = [
  `import { East, IntegerType, FloatType, ArrayType } from "@elaraai/east";`,
  `export const f = East.function([], IntegerType, ($) => {`,
  `  const a = $.let([] as number[], ArrayType(FloatType));`,
  `  a.size();`,
  `  return 1n;`,
  `});`,
  ``,
].join("\n");

test("#647: a loose file whose @elaraai/east import does not resolve gets no diagnostics at all", () => {
  // `/loose` has no node_modules above it, so the import resolves to nothing
  const hits = analyzeProgram({ "/loose/file.ts": SOURCE }, "/loose/file.ts", {});
  assert.deepEqual(hits, []);
});

test("#647: the same file inside the project keeps every diagnostic", () => {
  const rules = analyze(SOURCE).map((d) => d.ruleName);
  assert.ok(rules.includes("no-redundant-east-cast"), rules.join(", "));
  assert.ok(rules.includes("no-unexecuted-east-expression"), rules.join(", "));
});
