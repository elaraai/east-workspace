import { readHookInput, writeHookOutput } from "../lib/hook-io.js";
import { reviewFile } from "../lib/review.js";

// PostToolUse(Read|Edit|Write): preemptive East diagnostics.
//
// A TS/JS file that imports @elaraai/east goes through the warm daemon (native
// type errors + the east-diagnostics rule set); a python file that imports east
// goes through the project's own `east-py lint` (#648).
//
// On Read, both languages. On Edit/Write, PYTHON ONLY (#684): the agent's own
// TypeScript edits are covered by the plugin's language server, which Claude
// Code injects after every edit, but the python path through that server
// depends on `east-py` resolving from the file's directory and degrades to
// silence when it does not — which is what "the python hooks don't fire" was.
// Reviewing python here too costs nothing when the server already answered,
// because both share the per-session content-hash marker.
//
// Silent unless the file is East source in an East project and the reviewer
// answers within budget. All of the gating, resolution and dedupe lives in
// lib/review.ts, shared with the Bash hook.
async function main() {
  const event = await readHookInput();
  const filePath = event.tool_input?.file_path;
  if (filePath === undefined) process.exit(0);
  if (event.tool_name !== "Read" && !filePath.endsWith(".py")) process.exit(0);

  const text = await reviewFile(event.session_id, filePath);
  if (text === null || text === "") process.exit(0);
  writeHookOutput("PostToolUse", text);
}

main().catch(() => process.exit(0));
