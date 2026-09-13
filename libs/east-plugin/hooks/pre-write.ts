import { readFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PYTHON_EAST_IMPORT } from "@elaraai/east-diagnostics";
import { readHookInput, writeHookDecision, writeHookOutput } from "../lib/hook-io.js";
import { getEastProjectInfo } from "../lib/east-project.js";
import { SEARCH_TOOLS, searchedInTranscript } from "../lib/transcript.js";

// PreToolUse(Edit|Write): the search-before-coding gate (#654). Nothing is
// injected any more — the agent pulls examples through the MCP search tool —
// so the first write of East code in a session with no search on record gets
// the instruction to search first. A reminder by default; `EAST_REQUIRE_SEARCH=deny`
// makes it a refusal of that write (the reason tells the agent what to do).
// Once a search is seen, a per-session marker keeps every later write silent.

const EAST_IMPORT_PATTERN = /@elaraai\/east/;

import { GATE_TEXT } from "../lib/search-guidance.js";
export { GATE_TEXT } from "../lib/search-guidance.js";

async function main() {
  const event = await readHookInput();
  const cwd = event.cwd || process.cwd();
  const filePath = event.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const python = filePath.endsWith(".py");
  if (!python && !filePath.endsWith(".ts") && !filePath.endsWith(".tsx") && !filePath.endsWith(".js")) process.exit(0);

  // Is this East code? A Write carries its content; an Edit only its diff, so
  // the file on disk (or the new text) says whether it is East.
  let code = "";
  if (event.tool_name === "Write") {
    code = event.tool_input?.content ?? "";
  } else if (event.tool_name === "Edit") {
    try {
      code = await readFile(filePath, "utf-8");
    } catch {
      code = event.tool_input?.new_string ?? "";
    }
  }
  if (!(python ? PYTHON_EAST_IMPORT : EAST_IMPORT_PATTERN).test(code)) process.exit(0);
  if (!python) {
    const { isEast } = await getEastProjectInfo(cwd);
    if (!isEast) process.exit(0);
  }

  // Searched already this session? The marker is set once a search is seen,
  // so a long transcript is read at most once.
  const marker = join(tmpdir(), `east-search-seen-${event.session_id}`);
  if (existsSync(marker)) process.exit(0);
  if (event.transcript_path && (await searchedInTranscript(event.transcript_path))) {
    try {
      writeFileSync(marker, SEARCH_TOOLS.join("\n"));
    } catch {
      /* best-effort */
    }
    process.exit(0);
  }

  if (process.env["EAST_REQUIRE_SEARCH"] === "deny") {
    writeHookDecision("PreToolUse", "deny", GATE_TEXT);
  } else {
    writeHookOutput("PreToolUse", GATE_TEXT);
  }
}

main().catch(() => process.exit(0));
