import { readHookInput, writeHookOutput } from "../lib/hook-io.js";
import { reviewFile, reviewable } from "../lib/review.js";
import { writtenPaths } from "../lib/bash-writes.js";

// PostToolUse(Bash): review East files the command WROTE (#684).
//
// Until this hook existed, a file created through the shell — a `cat > f.py
// <<'EOF'` heredoc, a `>` redirect, `tee`, `sed -i` — passed through no gate
// and got no review, because every other hook matches Edit|Write or Read.
// Silent unless the command wrote East source; deduped by content per session
// through the same marker as the file hooks, so a file written here and read
// afterwards is reviewed once, not twice. The reviews run together: each has
// its own budget, and the hook has one of its own to fit inside.
async function main() {
  const event = await readHookInput();
  const command = event.tool_input?.command;
  if (typeof command !== "string" || command === "") process.exit(0);

  const candidates = writtenPaths(command, event.cwd || process.cwd()).filter(reviewable);
  if (candidates.length === 0) process.exit(0);

  const reviews = await Promise.all(candidates.slice(0, 10).map(async (path) => ({ path, text: await reviewFile(event.session_id, path) })));
  const blocks = reviews.filter((r) => r.text !== null && r.text !== "").map((r) => `### ${r.path}\n${r.text}`);
  if (blocks.length === 0) process.exit(0);
  writeHookOutput("PostToolUse", blocks.join("\n\n"));
}

main().catch(() => process.exit(0));
