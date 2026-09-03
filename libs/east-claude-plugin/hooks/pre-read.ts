import { readHookInput, writeHookOutput } from "../lib/hook-io.js";

// PreToolUse(Read|Grep|Glob): a reminder, never a refusal (#654). Reading the
// East packages' type declarations or sweeping the `*.examples.ts` corpus is
// the expensive way to learn the API the example index already holds, exact
// and printed in either language — so a read under node_modules/@elaraai, or
// a search over the example files, gets pointed at the search tool. A read of
// one specific project file is never touched.

const EAST_PACKAGE_PATH = /[/\\]node_modules[/\\]@elaraai[/\\]/;
const EXAMPLES_FILE = /\.examples\.tsx?$/;

export const READ_TEXT = [
  "Note: the East example index is the API reference — `mcp__plugin_east_east__search_east_examples` (then `get_east_example`) returns the same tested programs as the East packages' examples and type declarations, exact, printed in TypeScript or python, at a fraction of the tokens.",
  "Reading `.d.ts` signatures or sweeping `*.examples.ts` files reliably produces broken East code that still type-checks: the signatures omit the runtime rules. Search instead, and read a specific file only when the search pointed you at it.",
].join("\n");

async function main() {
  const event = await readHookInput();
  const input = event.tool_input ?? {};
  const filePath = typeof input.file_path === "string" ? input.file_path : "";
  const dir = typeof input["path"] === "string" ? (input["path"] as string) : "";
  const pattern = typeof input["pattern"] === "string" ? (input["pattern"] as string) : "";

  let remind = false;
  if (event.tool_name === "Read") {
    remind = EAST_PACKAGE_PATH.test(filePath) || EXAMPLES_FILE.test(filePath);
  } else {
    // Grep / Glob: a sweep of the East packages, or of the example files
    remind = EAST_PACKAGE_PATH.test(dir) || EAST_PACKAGE_PATH.test(pattern) || /examples\.tsx?/.test(pattern) || /@elaraai/.test(pattern);
  }
  if (!remind) process.exit(0);
  writeHookOutput("PreToolUse", READ_TEXT);
}

main().catch(() => process.exit(0));
