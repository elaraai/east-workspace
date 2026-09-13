import { readFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { getEastProjectInfo } from "./east-project.js";
import { getDiagnosticsText } from "./diagnostics-client.js";
import { getPythonDiagnosticsText } from "./east-py-lint.js";
import { PYTHON_EAST_IMPORT } from "@elaraai/east-diagnostics";

const EAST_IMPORT_PATTERN = /@elaraai\/east/;
// Vendored / built / generated trees: never review code the agent doesn't own.
const SKIP_PATH = /[/\\](node_modules|dist|build|\.venv|\.git)[/\\]/;

/** Whether the plugin reviews this path at all, by extension and location. */
export function reviewable(filePath: string): boolean {
  if (SKIP_PATH.test(filePath)) return false;
  return /\.(py|ts|tsx|js)$/.test(filePath);
}

/**
 * The `<east-code-review>` text for one file.
 *
 * `""` when the file is clean, `null` when it is not East source, not
 * reviewable, or no reviewer answered within budget — a transient miss must
 * stay silent AND stay un-deduped so a retry can succeed.
 *
 * Reviews each distinct file CONTENT once per session: the marker is keyed by
 * session + path + content hash, so re-reads of unchanged content skip while a
 * real edit re-fires. That is also what keeps a file written by Bash and then
 * read from being reviewed twice.
 */
export async function reviewFile(sessionId: string, filePath: string): Promise<string | null> {
  if (!reviewable(filePath)) return null;
  const python = filePath.endsWith(".py");

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
  if (!(python ? PYTHON_EAST_IMPORT : EAST_IMPORT_PATTERN).test(content)) return null;

  // Resolve the East project from the FILE's location, NOT the session cwd:
  // Claude is frequently launched from elsewhere while editing a project under
  // a sibling directory. A python file's project is wherever its `.venv` is.
  const projectDir = dirname(resolve(filePath));
  if (!python) {
    const { isEast } = await getEastProjectInfo(projectDir);
    if (!isEast) return null;
  }

  const key = createHash("sha1")
    .update(`${sessionId}\0${filePath}\0`)
    .update(content)
    .digest("hex")
    .slice(0, 20);
  const marker = join(tmpdir(), `east-diag-seen-${key}`);
  if (existsSync(marker)) return null;

  const text = python
    ? await getPythonDiagnosticsText(filePath)
    : await getDiagnosticsText(projectDir, filePath);
  if (text === null) return null; // transient — don't mark, allow a retry

  try {
    writeFileSync(marker, "");
  } catch {
    /* best-effort dedupe */
  }
  return text;
}
