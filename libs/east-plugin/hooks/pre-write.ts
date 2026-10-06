import { EAST_SEARCH_GATE, runPreWriteGate } from "../lib/search-hooks.js";

// PreToolUse(Edit|Write): the search-before-coding gate (#654). Nothing is
// injected any more — the agent pulls examples through the MCP search tool —
// so the first write of East code in a session with no search on record gets
// the instruction to search first. A reminder by default; `EAST_REQUIRE_SEARCH=deny`
// makes it a refusal of that write (the reason tells the agent what to do).
// Once a search is seen, a per-session marker keeps every later write silent.
// The gate is lib/search-hooks.ts's, configured with East's names.

export { GATE_TEXT } from "../lib/search-guidance.js";

runPreWriteGate(EAST_SEARCH_GATE).catch(() => process.exit(0));
