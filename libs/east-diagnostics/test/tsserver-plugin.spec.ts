/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { init } from "../src/tsserver-plugin.js";

const PROJ = join(process.cwd(), "test-fixtures", "proj");
const MISMATCH_FILE = join(PROJ, "virtual-mismatch.ts");
const MISMATCH_SOURCE = `import type { SubtypeExprOrValue, StructType, IntegerType, StringType } from "@elaraai/east";
export const x: SubtypeExprOrValue<StructType<{ a: IntegerType, b: StringType }>> = { a: 1.5, b: "ok" };
`;

// A real LanguageService over the on-disk fixture project plus one virtual
// file, decorated by the plugin exactly as tsserver would.
function createDecorated(): ts.LanguageService {
  const configFile = ts.readConfigFile(join(PROJ, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config ?? {}, ts.sys, PROJ);
  const rootFiles = [...parsed.fileNames.map((f) => resolve(f)), MISMATCH_FILE];

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => rootFiles,
    getScriptVersion: () => "1",
    getScriptSnapshot: (f) => {
      const path = resolve(f);
      if (path === MISMATCH_FILE) return ts.ScriptSnapshot.fromString(MISMATCH_SOURCE);
      if (!existsSync(path)) return undefined;
      return ts.ScriptSnapshot.fromString(readFileSync(path, "utf-8"));
    },
    getCurrentDirectory: () => PROJ,
    getCompilationSettings: () => parsed.options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => resolve(f) === MISMATCH_FILE || ts.sys.fileExists(f),
    readFile: (f) => (resolve(f) === MISMATCH_FILE ? MISMATCH_SOURCE : ts.sys.readFile(f)),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const languageService = ts.createLanguageService(host, ts.createDocumentRegistry());
  const plugin = init({ typescript: ts });
  return plugin.create({
    languageService,
    project: { getCurrentDirectory: () => PROJ },
  });
}

test("tsserver plugin appends East rule diagnostics to the native ones", () => {
  const ls = createDecorated();
  const diags = ls.getSemanticDiagnostics(join(PROJ, "bad.ts"));
  const east = diags.filter((d) => d.source === "east");
  assert.ok(east.some((d) => String(d.messageText).includes("no-redundant-east-cast")), "rule diagnostic present");
  assert.ok(diags.some((d) => d.source !== "east" && d.category === ts.DiagnosticCategory.Error), "native error preserved");
});

test("tsserver plugin rewrites native East assignability errors", () => {
  const ls = createDecorated();
  const diags = ls.getSemanticDiagnostics(MISMATCH_FILE);
  const rewritten = diags.find((d) => typeof d.messageText === "string" && d.messageText.startsWith("East type mismatch:"));
  assert.ok(rewritten, `expected a rewritten diagnostic, got: ${diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0, 80)).join(" || ")}`);
  assert.match(rewritten.messageText as string, /\.Integer/);
  assert.match(rewritten.messageText as string, /\.Float/);
});

test("tsserver plugin leaves clean files clean", () => {
  const ls = createDecorated();
  const diags = ls.getSemanticDiagnostics(join(PROJ, "good.ts"));
  assert.equal(diags.length, 0);
});

test("other language service methods pass through the proxy", () => {
  const ls = createDecorated();
  const file = join(PROJ, "good.ts");
  const quickInfo = ls.getQuickInfoAtPosition(file, readFileSync(file, "utf-8").indexOf("f ="));
  assert.ok(quickInfo !== undefined, "quick info proxied");
});
