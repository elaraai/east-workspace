import { readFile } from "node:fs/promises";
import { readHookInput, writeHookOutput } from "../lib/hook-io.js";
import { getEastProjectInfo } from "../lib/east-project.js";
import { searchAndFormat } from "../lib/lazy-search.js";
import { readRecentEntries, extractRecentContext } from "../lib/transcript.js";

const EAST_IMPORT_PATTERN = /@elaraai\/east/;

async function main() {
  const event = await readHookInput();
  const cwd = event.cwd || process.cwd();

  const { isEast, skills } = await getEastProjectInfo(cwd);
  if (!isEast) process.exit(0);

  const toolName = event.tool_name;
  const filePath = event.tool_input?.file_path;

  // Quick extension check
  if (filePath && !filePath.endsWith(".ts") && !filePath.endsWith(".tsx") && !filePath.endsWith(".js")) {
    process.exit(0);
  }

  // Determine if this is East code
  let codeContent = "";

  if (toolName === "Write") {
    codeContent = event.tool_input?.content || "";
  } else if (toolName === "Edit") {
    // Edit only has the diff — read the file from disk to check imports
    if (filePath) {
      try {
        codeContent = await readFile(filePath, "utf-8");
      } catch {
        codeContent = event.tool_input?.new_string || "";
      }
    }
  }

  if (!EAST_IMPORT_PATTERN.test(codeContent)) process.exit(0);

  // Build search query from code + recent conversation context
  const newCode = toolName === "Edit"
    ? (event.tool_input?.new_string || "")
    : (event.tool_input?.content || "");

  let searchQuery = newCode.slice(0, 1000);

  if (event.transcript_path) {
    const entries = await readRecentEntries(event.transcript_path);
    const context = extractRecentContext(entries);
    if (context) {
      searchQuery = context.slice(0, 1000) + "\n" + searchQuery;
    }
  }

  if (!searchQuery.trim()) process.exit(0);

  const results = await searchAndFormat(searchQuery, skills, 3);
  if (!results) process.exit(0);

  writeHookOutput("PreToolUse", results);
}

main().catch(() => process.exit(0));
