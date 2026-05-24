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
const FIXTURE = join(process.cwd(), "__east_diagnostics_fixture__.ts");

export function analyze(
  source: string,
  options: EastRulesOptions = {},
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
  };

  const host = ts.createCompilerHost(compilerOptions);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    if (name === FIXTURE) return ts.createSourceFile(name, source, languageVersion, true);
    return getSourceFile(name, languageVersion, onError, shouldCreate);
  };
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (name) => name === FIXTURE || fileExists(name);
  const readFile = host.readFile.bind(host);
  host.readFile = (name) => (name === FIXTURE ? source : readFile(name));

  const program = ts.createProgram([FIXTURE], compilerOptions, host);
  const sourceFile = program.getSourceFile(FIXTURE);
  if (sourceFile === undefined) throw new Error("fixture source file not found");

  return runEastRules(ts, sourceFile, program.getTypeChecker(), options, rules);
}