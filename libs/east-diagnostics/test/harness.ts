/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import * as ts from "typescript";
import { join } from "node:path";
import { runEastRules } from "../src/index.js";
import type { EastDiagnostic, EastRule, EastRulesOptions } from "../src/types.js";

// The fixture is virtual (served from memory) but lives under the package dir
// so `import … from "@elaraai/east"` resolves through the real workspace
// node_modules — i.e. against east's actual built declarations, not a stub.
const FIXTURE_TS = join(process.cwd(), "__east_diagnostics_fixture__.ts");
const FIXTURE_TSX = join(process.cwd(), "__east_diagnostics_fixture__.tsx");

function run(
  fixture: string,
  source: string,
  extraOptions: ts.CompilerOptions,
  options: EastRulesOptions,
  rules?: readonly EastRule[],
): EastDiagnostic[] {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
    lib: ["lib.esnext.d.ts"],
    ...extraOptions,
  };

  const host = ts.createCompilerHost(compilerOptions);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    if (name === fixture) return ts.createSourceFile(name, source, languageVersion, true);
    return getSourceFile(name, languageVersion, onError, shouldCreate);
  };
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (name) => name === fixture || fileExists(name);
  const readFile = host.readFile.bind(host);
  host.readFile = (name) => (name === fixture ? source : readFile(name));

  const program = ts.createProgram([fixture], compilerOptions, host);
  const sourceFile = program.getSourceFile(fixture);
  if (sourceFile === undefined) throw new Error("fixture source file not found");

  return runEastRules(ts, sourceFile, program.getTypeChecker(), options, rules);
}

/** Analyze a `.ts` fixture. */
export function analyze(
  source: string,
  options: EastRulesOptions = {},
  rules?: readonly EastRule[],
): EastDiagnostic[] {
  return run(FIXTURE_TS, source, {}, options, rules);
}

/** Analyze a `.tsx` fixture — JSX is parsed (so the file is a JSX source) and
 * left in place (`jsx: preserve`); no JSX runtime is required for the rules. */
export function analyzeTsx(
  source: string,
  options: EastRulesOptions = {},
  rules?: readonly EastRule[],
): EastDiagnostic[] {
  return run(FIXTURE_TSX, source, { jsx: ts.JsxEmit.Preserve }, options, rules);
}