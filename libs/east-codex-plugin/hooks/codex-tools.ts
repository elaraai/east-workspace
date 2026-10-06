import { EAST_CODEX_SEARCH_GATE, codexSearchGate, codexToolCall } from "@elaraai/east-plugin/lib/codex-hook";
import { writeSearchHookReply } from "@elaraai/east-plugin/lib/search-hooks";
import { readHookInput, writeHookOutput } from '../lib/hook-io.js';
import { reviewFile } from '../lib/review.js';

// Codex's one hook for every tool: the search-first gate (East's, through the
// shared lib/codex-hook.ts), and after a call, the East review of each file it
// wrote or read.
async function main() {
  const event = await readHookInput();
  // What the call touches is read once: the gate's, and the review's.
  const call = codexToolCall(event);
  const gate = await codexSearchGate(event, EAST_CODEX_SEARCH_GATE, call);
  if (event.hook_event_name === 'PostToolUse') {
    if (gate === 'recorded') return;
    const reviews = await Promise.all(call.paths.map(async path => {
      const text = await reviewFile(event.session_id, path);
      return text ? `### ${path}\n${text}` : '';
    }));
    if (reviews.some(Boolean)) writeHookOutput('PostToolUse', reviews.filter(Boolean).join('\n\n'));
    return;
  }
  if (gate !== null && gate !== 'recorded') writeSearchHookReply('PreToolUse', gate);
}
main().catch(error => { process.stderr.write(`East hook: ${String(error)}\n`); });
