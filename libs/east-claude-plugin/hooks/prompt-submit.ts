import { readHookInput, writeHookOutput } from "../lib/hook-io.js";
import { getEastProjectInfo } from "../lib/east-project.js";
import { searchAndFormat } from "../lib/lazy-search.js";
import { readRecentEntries, extractRecentContext } from "../lib/transcript.js";

async function main() {
  const event = await readHookInput();
  const prompt = event.prompt;
  if (!prompt) process.exit(0);

  const cwd = event.cwd || process.cwd();
  const { isEast, skills } = await getEastProjectInfo(cwd);

  // Build search query: user prompt + recent conversation context
  let searchQuery = prompt;

  if (event.transcript_path) {
    const entries = await readRecentEntries(event.transcript_path);
    const context = extractRecentContext(entries);
    if (context) {
      searchQuery = prompt + "\n" + context.slice(0, 1000);
    }
  }

  const filterSkills = isEast ? skills : null;
  const results = await searchAndFormat(searchQuery, filterSkills, 5);
  if (!results) process.exit(0);

  writeHookOutput("UserPromptSubmit", results);
}

main().catch(() => process.exit(0));
