/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type * as ts from "typescript";
import type { EastDiagnostic, EastDiagnosticCategory, EastRule, EastRulesOptions, TsModule } from "./types.js";
import { runEastRules } from "./run.js";

const MAX_MESSAGE_LENGTH = 300;

export interface DiagnosticsServiceOptions {
  rules?: readonly EastRule[];
  rulesOptions?: EastRulesOptions;
}

export interface DiagnosticsService {
  /** Native (semantic + syntactic) diagnostics for the file plus East rule
   * diagnostics, sorted by position. Returns `[]` if the file has no project. */
  diagnose(filePath: string): EastDiagnostic[];
  /** `diagnose`, rendered as an `<east-code-review>` block, or `""` if clean. */
  diagnoseText(filePath: string): string;
  /** Pre-build the LanguageService for the project nearest `fromDir` so the
   * first real `diagnose` doesn't pay the cold program+checker build. Returns
   * `false` when there is no tsconfig above `fromDir`. */
  warm(fromDir: string): boolean;
  dispose(): void;
}

interface Project {
  ts: TsModule;
  service: ts.LanguageService;
  rootFileNames: Set<string>;
  adHoc: Set<string>;
  versions: Map<string, number>;
}

function findNearestTsconfig(fromPath: string): string | undefined {
  let dir = dirname(resolve(fromPath));
  for (;;) {
    const candidate = join(dir, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function loadTypeScript(projectDir: string): TsModule {
  try {
    return createRequire(join(projectDir, "_.js"))("typescript") as TsModule;
  } catch {
    return createRequire(import.meta.url)("typescript") as TsModule;
  }
}

function toCategory(t: TsModule, category: ts.DiagnosticCategory): EastDiagnosticCategory {
  if (category === t.DiagnosticCategory.Error) return "error";
  if (category === t.DiagnosticCategory.Warning) return "warning";
  return "suggestion";
}

export function createDiagnosticsService(options: DiagnosticsServiceOptions = {}): DiagnosticsService {
  const projects = new Map<string, Project>();

  function getProject(tsconfigPath: string): Project {
    const existing = projects.get(tsconfigPath);
    if (existing !== undefined) return existing;

    const projectDir = dirname(tsconfigPath);
    const t = loadTypeScript(projectDir);
    const configFile = t.readConfigFile(tsconfigPath, t.sys.readFile);
    const parsed = t.parseJsonConfigFileContent(configFile.config ?? {}, t.sys, projectDir);

    const project: Project = {
      ts: t,
      service: undefined as unknown as ts.LanguageService,
      rootFileNames: new Set(parsed.fileNames.map((f) => resolve(f))),
      adHoc: new Set(),
      versions: new Map(),
    };

    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => [...project.rootFileNames, ...project.adHoc],
      getScriptVersion: (f) => String(project.versions.get(resolve(f)) ?? 0),
      getScriptSnapshot: (f) => {
        const path = resolve(f);
        if (!existsSync(path)) return undefined;
        return t.ScriptSnapshot.fromString(readFileSync(path, "utf-8"));
      },
      getCurrentDirectory: () => projectDir,
      getCompilationSettings: () => parsed.options,
      getDefaultLibFileName: (o) => t.getDefaultLibFilePath(o),
      fileExists: t.sys.fileExists,
      readFile: t.sys.readFile,
      readDirectory: t.sys.readDirectory,
      directoryExists: t.sys.directoryExists,
      getDirectories: t.sys.getDirectories,
    };
    if (t.sys.realpath !== undefined) host.realpath = t.sys.realpath;

    project.service = t.createLanguageService(host, t.createDocumentRegistry());
    projects.set(tsconfigPath, project);
    return project;
  }

  function analyze(filePath: string): { diagnostics: EastDiagnostic[]; sourceFile: ts.SourceFile } | undefined {
    const file = resolve(filePath);
    const tsconfigPath = findNearestTsconfig(file);
    if (tsconfigPath === undefined) return undefined;

    const project = getProject(tsconfigPath);
    const t = project.ts;

    if (!project.rootFileNames.has(file)) project.adHoc.add(file);
    project.versions.set(file, (project.versions.get(file) ?? 0) + 1);

    const program = project.service.getProgram();
    const sourceFile = program?.getSourceFile(file);
    if (program === undefined || sourceFile === undefined) return undefined;

    const native = [
      ...project.service.getSemanticDiagnostics(file),
      ...project.service.getSyntacticDiagnostics(file),
    ];
    const nativeDiagnostics: EastDiagnostic[] = native.flatMap((d) => {
      if (d.start === undefined || d.length === undefined) return [];
      const message = t.flattenDiagnosticMessageText(d.messageText, " ");
      return [{
        ruleName: "tsc",
        code: d.code,
        start: d.start,
        length: d.length,
        messageText: message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…` : message,
        category: toCategory(t, d.category),
      }];
    });

    const ruleDiagnostics = runEastRules(
      t,
      sourceFile,
      program.getTypeChecker(),
      options.rulesOptions ?? {},
      options.rules,
    );

    const diagnostics = [...nativeDiagnostics, ...ruleDiagnostics].sort((a, b) => a.start - b.start);
    return { diagnostics, sourceFile };
  }

  return {
    diagnose(filePath) {
      return analyze(filePath)?.diagnostics ?? [];
    },
    diagnoseText(filePath) {
      const result = analyze(filePath);
      if (result === undefined || result.diagnostics.length === 0) return "";
      const { diagnostics, sourceFile } = result;
      const lines = diagnostics.map((d) => {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(d.start);
        const label = d.ruleName === "tsc" ? `TS${d.code}` : d.ruleName;
        return `- [${d.category}] ${line + 1}:${character + 1} (${label}) ${d.messageText}`;
      });
      return ["<east-code-review>", "## East issues in this file", "", ...lines, "</east-code-review>"].join("\n");
    },
    warm(fromDir) {
      const tsconfigPath = findNearestTsconfig(join(resolve(fromDir), "_.ts"));
      if (tsconfigPath === undefined) return false;
      const project = getProject(tsconfigPath);
      // Force the program + global checker to build now (the cold cost) with one
      // semantic pass; the global type-check warms the whole program, so the
      // first real diagnose is fast instead of blowing the client's budget.
      const [firstRoot] = project.rootFileNames;
      if (firstRoot !== undefined) project.service.getSemanticDiagnostics(firstRoot);
      else project.service.getProgram();
      return true;
    },
    dispose() {
      projects.clear();
    },
  };
}