import { renderPythonReview, runEastPyCheck, runEastPyLint } from "@elaraai/east-diagnostics";

// The python twin of the daemon's review (#648): a python file that imports
// `east` is reviewed by the east-py rules — `east-py lint --format json`, run
// through the project's own environment (the nearest `.venv` above the file),
// else `east-py` on PATH, `EAST_PY_LINT` naming the command outright — and,
// where the project has opted into the build tier (`[tool.east-py] check =
// true`), by `east-py check` too, so the hook shows what the language server
// shows (#653). The resolver and the JSON readers live in
// @elaraai/east-diagnostics, where the plugin's python language server uses
// the same ones.

/** The `<east-code-review>` text for a python file: `""` when clean, `null`
 * when no east-py answered (absent, failed, or over `budgetMs`) — callers
 * degrade to a silent no-op, as for the TypeScript daemon. The build tier's
 * absence is never a failure: its records are merged when the project asked
 * for them and the check answered in time. */
export async function getPythonDiagnosticsText(file: string, budgetMs = 4000): Promise<string | null> {
  const [rules, build] = await Promise.all([runEastPyLint(file, undefined, budgetMs), runEastPyCheck(file, budgetMs)]);
  if (rules === null) return null;
  return renderPythonReview([...rules, ...(build ?? [])]);
}
