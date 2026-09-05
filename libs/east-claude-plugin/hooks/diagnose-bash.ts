import { resolve } from "node:path";
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
// afterwards is reviewed once, not twice.
async function main() {
  const event = await readHookInput();
  const command = event.tool_input?.command;
  if (typeof command !== "string" || command === "") process.exit(0);

  const candidates = writtenPaths(command).map((p) => resolve(event.cwd || process.cwd(), p)).filter(reviewable);
  if (candidates.length === 0) process.exit(0);

  const blocks: string[] = [];
  for (const path of candidates.slice(0, 10)) {
    const text = await reviewFile(event.session_id, path);
    if (text !== null && text !== "") blocks.push(`### ${path}\n${text}`);
  }
  if (blocks.length === 0) process.exit(0);
  writeHookOutput("PostToolUse", blocks.join("\n\n"));
}

main().catch(() => process.exit(0));
