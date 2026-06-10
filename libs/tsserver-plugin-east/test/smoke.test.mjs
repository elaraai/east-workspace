// Copyright (c) 2025 Elara AI Pty Ltd
// Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require_ = createRequire(join(root, "package.json"));
const init = require_(join(root, "dist", "index.cjs"));
const ts = require_("typescript");

// Virtual fixture under the package dir so "@elaraai/east" resolves through
// the workspace node_modules.
const FIXTURE = join(root, "__tsserver_plugin_fixture__.ts");
const SOURCE = `import { East, IntegerType, ArrayType, FloatType } from "@elaraai/east";
import type { SubtypeExprOrValue, StructType, StringType } from "@elaraai/east";
export const f = East.function([], IntegerType, ($) => {
  const a = $.let([] as number[], ArrayType(FloatType));
  return a.size();
});
export const x: SubtypeExprOrValue<StructType<{ a: IntegerType, b: StringType }>> = { a: 1.5, b: "ok" };
`;

function createDecorated() {
  const compilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  };
  const host = {
    getScriptFileNames: () => [FIXTURE],
    getScriptVersion: () => "1",
    getScriptSnapshot: (f) => {
      const path = resolve(f);
      if (path === FIXTURE) return ts.ScriptSnapshot.fromString(SOURCE);
      if (!existsSync(path)) return undefined;
      return ts.ScriptSnapshot.fromString(readFileSync(path, "utf-8"));
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => resolve(f) === FIXTURE || ts.sys.fileExists(f),
    readFile: (f) => (resolve(f) === FIXTURE ? SOURCE : ts.sys.readFile(f)),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const languageService = ts.createLanguageService(host, ts.createDocumentRegistry());
  const plugin = init({ typescript: ts });
  return plugin.create({
    languageService,
    project: { getCurrentDirectory: () => root },
  });
}

test("the published artifact is a require()-able tsserver plugin factory", () => {
  assert.equal(typeof init, "function");
  assert.equal(typeof init({ typescript: ts }).create, "function");
});

test("decorated service appends East rule diagnostics and rewrites East type errors", () => {
  const ls = createDecorated();
  const diags = ls.getSemanticDiagnostics(FIXTURE);
  assert.ok(
    diags.some((d) => d.source === "east" && String(d.messageText).includes("no-redundant-east-cast")),
    `rule diagnostic present: ${diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0, 60)).join(" || ")}`,
  );
  assert.ok(
    diags.some((d) => typeof d.messageText === "string" && d.messageText.startsWith("East type mismatch:")),
    "native assignability error rewritten as an East type diff",
  );
});
