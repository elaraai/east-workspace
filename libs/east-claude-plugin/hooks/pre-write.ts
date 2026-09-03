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

export const GATE_TEXT = [
  "STOP: no East example search on record in this session, and this is East code.",
  "Before writing or changing East code, search the tested example index — it is the API reference:",
  "1. `mcp__plugin_east_east__search_east_examples` with what you are about to do (language: \"python\" for east-py, \"typescript\" otherwise); summaries come back — id, signature, inputs and result.",
  "2. `mcp__plugin_east_east__get_east_example` for the one or two that match, and pattern your code on them.",
  "Do not read node_modules/@elaraai/** or *.examples.ts files instead: the index is the same corpus, exact and far cheaper. Every East skill requires this step.",
].join("\n");

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
