import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// The python twin of the daemon's review (#648): a python file that imports
// `east` is reviewed by the east-py rules — `east-py lint --format json` —
// run from the project's own environment (the nearest `.venv` above the
// file), else `east-py` on PATH; `EAST_PY_LINT` names the command outright.

/** One finding as `east-py lint --format json` records it. */
interface LintRecord {
  path: string;
  rule: string;
  code: string;
  category: string;
  line: number;
  column: number;
  message: string;
}

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

/** The `<east-code-review>` text for a python file: `""` when clean, `null`
 * when no east-py answered (absent, failed, or over `budgetMs`) — callers
 * degrade to a silent no-op, as for the TypeScript daemon. */
export function getPythonDiagnosticsText(fromDir: string, file: string, budgetMs = 4000): Promise<string | null> {
  const command = findEastPy(fromDir);
  return new Promise((resolveText) => {
    execFile(
      command,
      ["lint", "--format", "json", file],
      { timeout: budgetMs, encoding: "utf-8", maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        // exit 1 means findings (they are on stdout); anything else means no answer
        if (error !== null && (error as { code?: number | string }).code !== 1) {
          resolveText(null);
          return;
        }
        let records: unknown;
        try {
          records = JSON.parse(stdout);
        } catch {
          resolveText(null);
          return;
        }
        if (!Array.isArray(records)) {
          resolveText(null);
          return;
        }
        if (records.length === 0) {
          resolveText("");
          return;
        }
        const lines = (records as LintRecord[]).map((r) => `- [${r.category}] ${r.line}:${r.column} (${r.rule}) ${r.message}`);
        resolveText(["<east-code-review>", "## East issues in this file", "", ...lines, "</east-code-review>"].join("\n"));
      },
    );
  });
}
