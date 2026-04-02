import { readHookInput, writeHookOutput } from "../lib/hook-io.js";
import { getEastProjectInfo } from "../lib/east-project.js";
import { searchAndFormat } from "../lib/lazy-search.js";
import { readRecentEntries, extractRecentContext } from "../lib/transcript.js";

async function main() {
  const event = await readHookInput();
  const cwd = event.cwd || process.cwd();

  const { isEast, skills } = await getEastProjectInfo(cwd);
  if (!isEast) process.exit(0);

  const prompt = event.tool_input?.prompt;
  if (!prompt) process.exit(0);

  // Build search query: subagent prompt + recent conversation context
  let searchQuery = prompt;

  if (event.transcript_path) {
    const entries = await readRecentEntries(event.transcript_path);
    const context = extractRecentContext(entries);
    if (context) {
      searchQuery = prompt + "\n" + context.slice(0, 1000);
    }
  }

  const results = await searchAndFormat(searchQuery, skills, 5);
  if (!results) process.exit(0);

  writeHookOutput("PreToolUse", results);
}

main().catch(() => process.exit(0));
