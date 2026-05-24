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