/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type * as ts from "typescript";
import type { TsModule } from "./types.js";
import type { EastDiagnosticCategory } from "./types.js";
import { runEastRules } from "./run.js";
import { getEastModule } from "./east-module.js";
import { ASSIGNABILITY_CODES, rewriteEastAssignability } from "./type-diff-rewrite.js";

// tsserver plugin: rides inside the editor's existing TypeScript language
// service (no second program in memory). Decorates getSemanticDiagnostics to
// (a) rewrite native East assignability errors as localized type diffs and
// (b) append the east-diagnostics rule set as native-looking squiggles.

/** Structural subset of `ts.server.PluginCreateInfo` — keeps the package free
 * of a tsserverlibrary type dependency. */
export interface TsserverPluginCreateInfo {
  languageService: ts.LanguageService;
  project: { getCurrentDirectory(): string };
  config?: { disabled?: readonly string[] };
}

const CATEGORY: Record<EastDiagnosticCategory, "Error" | "Warning" | "Suggestion"> = {
  error: "Error",
  warning: "Warning",
  suggestion: "Suggestion",
};

// First-party @elaraai/* library src legitimately uses East-construction
// patterns the rules flag (every component factory looks like the
// data-builder antipattern) — same editor policy as the Claude plugin hook.
function isElaraaiPackageSrc(filePath: string): boolean {
  const file = resolve(filePath);
  let dir = dirname(file);
  for (;;) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const name = (JSON.parse(readFileSync(candidate, "utf-8")) as { name?: string }).name;
        return typeof name === "string" && name.startsWith("@elaraai/") && file.startsWith(join(dir, "src") + "/");
      } catch {
        return false;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * tsserver plugin factory. Loaded by the TypeScript server via a
 * `typescriptServerPlugins` contribution (VS Code) or a tsconfig
 * `compilerOptions.plugins` entry; the host's `typescript` is injected.
 */
export function init(modules: { typescript: TsModule }): { create(info: TsserverPluginCreateInfo): ts.LanguageService } {
  const t = modules.typescript;
  return {
    create(info: TsserverPluginCreateInfo): ts.LanguageService {
      const ls = info.languageService;
      const proxy = Object.create(null) as ts.LanguageService;
      for (const key of Object.keys(ls) as (keyof ts.LanguageService)[]) {
        const member = ls[key] as unknown as (...args: unknown[]) => unknown;
        (proxy as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => member.apply(ls, args);
      }

      proxy.getSemanticDiagnostics = (fileName: string): ts.Diagnostic[] => {
        const prior = ls.getSemanticDiagnostics(fileName);
        try {
          const program = ls.getProgram();
          const sourceFile = program?.getSourceFile(fileName);
          if (program === undefined || sourceFile === undefined) return prior;

          const east = getEastModule(info.project.getCurrentDirectory());
          const diagnostics = prior.map((d) => {
            if (east === undefined || !ASSIGNABILITY_CODES.has(d.code)) return d;
            const rewritten = rewriteEastAssignability(t, program, sourceFile, d, east);
            return rewritten === undefined ? d : { ...d, messageText: rewritten };
          });

          if (!isElaraaiPackageSrc(fileName)) {
            const ruleDiagnostics = runEastRules(
              t,
              program,
              sourceFile,
              program.getTypeChecker(),
              info.config?.disabled !== undefined ? { disabled: info.config.disabled } : {},
            );
            for (const d of ruleDiagnostics) {
              diagnostics.push({
                file: sourceFile,
                start: d.start,
                length: d.length,
                messageText: `${d.messageText} (${d.ruleName})`,
                category: t.DiagnosticCategory[CATEGORY[d.category]],
                code: d.code,
                source: "east",
              });
            }
          }
          return diagnostics;
        } catch {
          // Never take down the editor's language service.
          return prior;
        }
      };

      return proxy;
    },
  };
}

export default init;
