/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

// The python twin of this package's rules (#638, #648): east-py's
// `east.diagnostics`, reached through `east-py lint --format json` — run from
// the project's own environment (the nearest `.venv` above the file), else
// `east-py` on PATH, `EAST_PY_LINT` naming the command outright. Shared by the
// East language server (a `.py` document) and the Claude plugin's read hook.

/** One finding as `east-py lint --format json` records it. */
export interface PythonDiagnostic {
  path: string;
  rule: string;
  code: string;
  category: "error" | "warning" | "suggestion";
  line: number;
  column: number;
  end_line?: number;
  end_column?: number;
  message: string;
}

/** A python file that imports east: `import east`, `from east import …`, `from east.x import …`. */
export const PYTHON_EAST_IMPORT = /^\s*(?:from\s+east(?:\.[\w.]+)?\s+import\b|import\s+east\b)/m;

/** The `east-py` command for a file: `EAST_PY_LINT` when set, else the
 * nearest `.venv` above `fromDir`, else `east-py` on PATH. */
export function findEastPy(fromDir: string): string {
  const override = process.env["EAST_PY_LINT"];
  if (override !== undefined && override !== "") return override;
  let dir = fromDir;
  for (;;) {
    for (const candidate of [join(dir, ".venv", "bin", "east-py"), join(dir, ".venv", "Scripts", "east-py.exe")]) {
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return "east-py";
    dir = parent;
  }
}

/**
 * The east-py findings for a python file — `""`-free: `[]` when clean,
 * `null` when no east-py answered (absent, failed, or over `budgetMs`), so
 * callers can stay silent. `content` (an unsaved buffer) is linted from a
 * temporary copy under the file's own name; the file itself otherwise.
 */
export function runEastPyLint(file: string, content?: string, budgetMs = 4000): Promise<PythonDiagnostic[] | null> {
  const command = findEastPy(dirname(file));
  let target = file;
  let scratch: string | null = null;
  if (content !== undefined) {
    scratch = mkdtempSync(join(tmpdir(), "east-py-lint-"));
    target = join(scratch, basename(file));
    writeFileSync(target, content, "utf-8");
  }
  return new Promise((resolveFindings) => {
    execFile(
      command,
      ["lint", "--format", "json", target],
      { timeout: budgetMs, encoding: "utf-8", maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
        // exit 1 means findings (they are on stdout); anything else means no answer
        if (error !== null && (error as { code?: number | string }).code !== 1) {
          resolveFindings(null);
          return;
        }
        let records: unknown;
        try {
          records = JSON.parse(stdout);
        } catch {
          resolveFindings(null);
          return;
        }
        resolveFindings(Array.isArray(records) ? (records as PythonDiagnostic[]) : null);
      },
    );
  });
}

/** The findings as the `<east-code-review>` block the plugin injects — `""` when there are none. */
export function renderPythonReview(records: PythonDiagnostic[]): string {
  if (records.length === 0) return "";
  const lines = records.map((r) => `- [${r.category}] ${r.line}:${r.column} (${r.rule}) ${r.message}`);
  return ["<east-code-review>", "## East issues in this file", "", ...lines, "</east-code-review>"].join("\n");
}
