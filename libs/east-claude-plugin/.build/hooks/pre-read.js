// lib/hook-io.ts
async function readHookInput() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return JSON.parse(input);
}
function writeHookOutput(hookEventName, additionalContext) {
  const output = {
    hookSpecificOutput: {
      hookEventName,
      additionalContext
    }
  };
  process.stdout.write(JSON.stringify(output));
}

// hooks/pre-read.ts
var EAST_PACKAGE_PATH = /[/\\]node_modules[/\\]@elaraai[/\\]/;
var EAST_PACKAGE_PATTERN = /(^|[/\\])node_modules[/\\]@elaraai([/\\]|$)/;
var EXAMPLES_FILE = /\.examples\.tsx?$/;
var READ_TEXT = [
  "Note: the East example index is the API reference \u2014 `mcp__plugin_east_east__search_east_examples` (then `get_east_example`) returns the same tested programs as the East packages' examples and type declarations, exact, printed in TypeScript or python, at a fraction of the tokens.",
  "Reading `.d.ts` signatures or sweeping `*.examples.ts` files reliably produces broken East code that still type-checks: the signatures omit the runtime rules. Search instead, and read a specific file only when the search pointed you at it."
].join("\n");
async function main() {
  const event = await readHookInput();
  const input = event.tool_input ?? {};
  const filePath = typeof input.file_path === "string" ? input.file_path : "";
  const dir = typeof input["path"] === "string" ? input["path"] : "";
  const pattern = typeof input["pattern"] === "string" ? input["pattern"] : "";
  let remind = false;
  if (event.tool_name === "Read") {
    remind = EAST_PACKAGE_PATH.test(filePath) || EXAMPLES_FILE.test(filePath);
  } else {
    remind = EAST_PACKAGE_PATH.test(dir) || EAST_PACKAGE_PATTERN.test(pattern) || /\.examples\.tsx?/.test(pattern);
  }
  if (!remind) process.exit(0);
  writeHookOutput("PreToolUse", READ_TEXT);
}
main().catch(() => process.exit(0));
export {
  READ_TEXT
};
