import { readHookInput, writeHookOutput } from "../lib/hook-io.js";

// PreToolUse(Read|Grep|Glob): a reminder, never a refusal (#654). Reading the
// East packages' type declarations or sweeping the `*.examples.ts` corpus is
// the expensive way to learn the API the example index already holds, exact
// and printed in either language — so a read under node_modules/@elaraai, or
// a search over the example files, gets pointed at the search tool. A read of
// one specific project file is never touched.

import { READ_TEXT, isExampleCorpusRead } from "../lib/search-guidance.js";
export { READ_TEXT } from "../lib/search-guidance.js";

async function main() {
  const event = await readHookInput();
  if (!isExampleCorpusRead(event.tool_name ?? "", event.tool_input ?? {})) process.exit(0);
  writeHookOutput("PreToolUse", READ_TEXT);
}

main().catch(() => process.exit(0));
