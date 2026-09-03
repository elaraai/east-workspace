import { renderPythonReview, runEastPyLint } from "@elaraai/east-diagnostics";

// The python twin of the daemon's review (#648): a python file that imports
// `east` is reviewed by the east-py rules — `east-py lint --format json`, run
// through the project's own environment (the nearest `.venv` above the file),
// else `east-py` on PATH, `EAST_PY_LINT` naming the command outright. The
// resolver and the JSON reader live in @elaraai/east-diagnostics, where the
// plugin's language server uses the same ones for a `.py` document.

/** The `<east-code-review>` text for a python file: `""` when clean, `null`
 * when no east-py answered (absent, failed, or over `budgetMs`) — callers
 * degrade to a silent no-op, as for the TypeScript daemon. */
export async function getPythonDiagnosticsText(file: string, budgetMs = 4000): Promise<string | null> {
  const records = await runEastPyLint(file, undefined, budgetMs);
  return records === null ? null : renderPythonReview(records);
}
