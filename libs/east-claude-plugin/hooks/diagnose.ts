import { readFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { readHookInput, writeHookOutput } from "../lib/hook-io.js";
import { getEastProjectInfo, isElaraaiPackageSrc } from "../lib/east-project.js";
import { getDiagnosticsText } from "../lib/diagnostics-client.js";

const EAST_IMPORT_PATTERN = /@elaraai\/east/;
// Vendored / built / generated trees: never review code the agent doesn't own.
const SKIP_PATH = /[/\\](node_modules|dist|build|\.venv|\.git)[/\\]/;

// PostToolUse(Read): preemptive East diagnostics via the warm daemon (native
// type errors + the east-diagnostics rule set) when an agent READS an East
// file, so code review is covered. The agent's own edits are covered by the
// plugin LSP server (daemon/lsp.ts) — Claude Code injects its diagnostics
// after every Edit/Write natively, which is why this hook no longer matches
// those tools. Silent unless the file is a TS/JS file that imports
// @elaraai/east, sits in an East project, and the daemon answers within budget.
// Deduped by content per session so re-reads review each distinct version
// once, not on every read.
async function main() {
  const event = await readHookInput();

  const filePath = event.tool_input?.file_path;
  if (filePath === undefined) process.exit(0);
  if (SKIP_PATH.test(filePath)) process.exit(0);
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx") && !filePath.endsWith(".js")) {
    process.exit(0);
  }
  // Don't review first-party @elaraai/* library src — its factories legitimately
  // use East-construction patterns the rules flag. End-user solutions and the
  // monorepo's examples (under test/, not src/) are still reviewed.
  if (await isElaraaiPackageSrc(filePath)) process.exit(0);

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    process.exit(0);
    return;
  }
  if (!EAST_IMPORT_PATTERN.test(content)) process.exit(0);

  // Resolve the East project from the FILE's location, NOT the session cwd:
  // Claude is frequently launched from elsewhere (e.g. ~) while editing a
  // project under /tmp or a sibling directory. Gating on cwd silently skipped
  // every such file. The daemon's service resolves the file's own tsconfig, so
  // passing the file's project dir keys the socket + warm to the right project.
  const projectDir = dirname(resolve(filePath));
  const { isEast } = await getEastProjectInfo(projectDir);
  if (!isEast) process.exit(0);

  // Review each distinct file-content once per session: a marker file keyed by
  // session + path + content-hash. Re-reads of unchanged content skip; a real
  // edit changes the hash and re-fires.
  const key = createHash("sha1")
    .update(`${event.session_id}\0${filePath}\0`)
    .update(content)
    .digest("hex")
    .slice(0, 20);
  const marker = join(tmpdir(), `east-diag-seen-${key}`);
  if (existsSync(marker)) process.exit(0);

  const text = await getDiagnosticsText(projectDir, filePath);
  if (text === null) process.exit(0); // transient (daemon warming) — don't mark, allow a retry
  try {
    writeFileSync(marker, "");
  } catch {
    /* best-effort dedupe */
  }
  if (text === "") process.exit(0); // definitively clean
  writeHookOutput("PostToolUse", text);
}

main().catch(() => process.exit(0));
