import { EAST_READ_REMINDER, runPreReadReminder } from "../lib/search-hooks.js";

// PreToolUse(Read|Grep|Glob): a reminder, never a refusal (#654). Reading the
// East packages' type declarations or sweeping the `*.examples.ts` corpus is
// the expensive way to learn the API the example index already holds, exact
// and printed in either language — so a read under node_modules/@elaraai, or
// a search over the example files, gets pointed at the search tool. A read of
// one specific project file is never touched. The reminder is
// lib/search-hooks.ts's, configured with East's names.

export { READ_TEXT } from "../lib/search-guidance.js";

runPreReadReminder(EAST_READ_REMINDER).catch(() => process.exit(0));
