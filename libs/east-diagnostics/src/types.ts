/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";

/** The `typescript` module instance, injected by the host (tsserver plugin,
 * daemon, or test harness) so rules run against the host's compiler version. */
export type TsModule = typeof import("typescript");

export type EastDiagnosticCategory = "error" | "warning" | "suggestion";

/** A file-local text edit, in the same coordinate space as the diagnostic. */
export interface EastTextChange {
  start: number;
  length: number;
  newText: string;
}

export interface EastFix {
  description: string;
  changes: EastTextChange[];
}

export interface EastDiagnostic {
  ruleName: string;
  code: number;
  start: number;
  length: number;
  messageText: string;
  category: EastDiagnosticCategory;
  fix?: EastFix;
}

export interface EastRulesOptions {
  /** Rule names to disable. */
  disabled?: readonly string[];
  preferExplicitEastType?: {
    /** `"under-determined"` (default) flags only values whose East type can't
     * be inferred (empty `[]` / `{}` / `new Map()` / `new Set()`).
     * `"all-raw-values"` also flags any plain JS literal. */
    mode?: "under-determined" | "all-raw-values";
  };
}

export interface RuleContext {
  ts: TsModule;
  sourceFile: ts.SourceFile;
  checker: ts.TypeChecker;
  /** The whole program — needed by rules that resolve cross-module types (e.g.
   * `<source>/jsx-runtime`'s `JSX.Element`). Optional so a checker-only caller
   * still works; rules that need it stay silent when it is absent. */
  program?: ts.Program;
  options: EastRulesOptions;
  report(diagnostic: EastDiagnostic): void;
}

export interface EastRule {
  name: string;
  code: number;
  description: string;
  check(node: ts.Node, ctx: RuleContext): void;
}