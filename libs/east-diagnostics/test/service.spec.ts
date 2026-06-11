/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createDiagnosticsService } from "../src/index.js";

const proj = (name: string) => join(process.cwd(), "test-fixtures", "proj", name);

test("DiagnosticsService surfaces native type errors AND rule diagnostics for a file", () => {
  const svc = createDiagnosticsService();
  const diags = svc.diagnose(proj("bad.ts"));
  const rules = new Set(diags.map((d) => d.ruleName));

  assert.ok(rules.has("no-redundant-east-cast"), "redundant cast rule");
  assert.ok(rules.has("no-unexecuted-east-expression"), "unexecuted expression rule");
  assert.ok(rules.has("no-east-namespaced-type"), "East.<X>Type rule");
  assert.ok(
    diags.some((d) => d.ruleName === "tsc" && d.category === "error"),
    "native type error (East.IntegerType)",
  );
  svc.dispose();
});

test("diagnoseText renders an east-code-review block sorted by position", () => {
  const svc = createDiagnosticsService();
  const text = svc.diagnoseText(proj("bad.ts"));
  assert.match(text, /<east-code-review>/);
  assert.match(text, /no-redundant-east-cast/);
  assert.match(text, /TS\d+/); // a native diagnostic code is present too
  svc.dispose();
});

test("diagnoseText is empty for a clean file", () => {
  const svc = createDiagnosticsService();
  assert.equal(svc.diagnoseText(proj("good.ts")), "");
  svc.dispose();
});

test("a warm re-diagnose returns the same result (version bump path)", () => {
  const svc = createDiagnosticsService();
  const first = svc.diagnose(proj("bad.ts")).length;
  const second = svc.diagnose(proj("bad.ts")).length;
  assert.equal(first, second);
  assert.ok(first > 0);
  svc.dispose();
});

test("warm pre-builds the project; a subsequent diagnose still works", () => {
  const svc = createDiagnosticsService();
  assert.equal(svc.warm(join(process.cwd(), "test-fixtures", "proj")), true);
  // diagnosing a file in the warmed project returns its rule diagnostics
  assert.ok(svc.diagnose(proj("bad.ts")).length > 0);
  svc.dispose();
});

test("warm returns false when there is no tsconfig above the directory", () => {
  const svc = createDiagnosticsService();
  assert.equal(svc.warm("/"), false);
  svc.dispose();
});

test("overlay content takes precedence over disk and can be cleared", () => {
  const svc = createDiagnosticsService();
  const path = proj("good.ts");
  // good.ts is clean on disk; overlay it with content that violates a rule.
  svc.setOverlay(path, `import { East, IntegerType, ArrayType, FloatType } from "@elaraai/east";
export const f = East.function([], IntegerType, ($) => {
  const a = $.let([] as number[], ArrayType(FloatType));
  return a.size();
});
`);
  const overlaid = svc.diagnose(path);
  assert.ok(overlaid.some((d) => d.ruleName === "no-redundant-east-cast"), "overlay content is diagnosed");
  svc.clearOverlay(path);
  assert.equal(svc.diagnoseText(path), "", "disk content is clean again after clearing the overlay");
  svc.dispose();
});

test("a file that only exists as an overlay is diagnosed", () => {
  const svc = createDiagnosticsService();
  const path = proj("overlay-virtual.ts");
  svc.setOverlay(path, `import { East, IntegerType } from "@elaraai/east";
export const f = East.function([], IntegerType, ($) => {
  East.value(5n);
  return 1n;
});
`);
  const diags = svc.diagnose(path);
  assert.ok(diags.some((d) => d.ruleName === "no-unexecuted-east-expression"), "virtual file is diagnosed");
  svc.dispose();
});

test("native East assignability errors are rewritten as localized type diffs", () => {
  const svc = createDiagnosticsService();
  const path = proj("overlay-mismatch.ts");
  svc.setOverlay(path, `import type { SubtypeExprOrValue, StructType, IntegerType, StringType } from "@elaraai/east";
export const x: SubtypeExprOrValue<StructType<{ a: IntegerType, b: StringType }>> = { a: 1.5, b: "ok" };
`);
  const diags = svc.diagnose(path);
  const rewritten = diags.find((d) => d.ruleName === "tsc" && d.messageText.startsWith("East type mismatch:"));
  assert.ok(rewritten, `expected a rewritten diagnostic, got: ${diags.map((d) => `${d.ruleName}:${d.messageText.slice(0, 80)}`).join(" || ")}`);
  assert.match(rewritten.messageText, /\.Integer/);
  assert.match(rewritten.messageText, /\.Float/);
  svc.dispose();
});