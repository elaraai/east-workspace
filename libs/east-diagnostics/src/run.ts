/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastDiagnostic, EastRule, EastRulesOptions, RuleContext, TsModule } from "./types.js";
import { allRules } from "./rules/index.js";
import { unresolvedEastImport } from "./east-source.js";

/** Run a set of East rules over one source file, returning diagnostics. The
 * `typescript` module is injected so rules use the host's compiler version.
 * `rules` defaults to `allRules` (the run-anywhere set). A file whose
 * `@elaraai/east` import does not resolve (a loose file outside a project)
 * gets none: its East types are unknown, and every rule would misfire. */
export function runEastRules(
  tsModule: TsModule,
  program: ts.Program,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  options: EastRulesOptions = {},
  rules: readonly EastRule[] = allRules,
): EastDiagnostic[] {
  if (unresolvedEastImport(sourceFile, checker, tsModule)) return [];
  const diagnostics: EastDiagnostic[] = [];
  const ctx: RuleContext = {
    ts: tsModule,
    sourceFile,
    checker,
    program,
    options,
    report: (d) => diagnostics.push(d),
  };

  const disabled = new Set(options.disabled ?? []);
  const active = rules.filter((rule) => !disabled.has(rule.name));

  const visit = (node: ts.Node): void => {
    for (const rule of active) rule.check(node, ctx);
    tsModule.forEachChild(node, visit);
  };
  visit(sourceFile);

  return diagnostics;
}