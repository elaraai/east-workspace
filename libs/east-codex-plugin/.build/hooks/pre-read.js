// ../east-plugin/dist/lib/host.js
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
var isCodex = existsSync(fileURLToPath(new URL("../../.codex-plugin/plugin.json", import.meta.url)));
function hostText(text) {
  return isCodex ? text.replaceAll("mcp__plugin_east_east__", "").replaceAll("/east:", "$east-codex-plugin:").replaceAll("Claude Code", "Codex") : text;
}

// ../east-plugin/dist/lib/hook-io.js
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
      additionalContext: hostText(additionalContext)
    }
  };
  process.stdout.write(JSON.stringify(output));
}

// ../east-plugin/dist/lib/search-guidance.js
var GATE_TEXT = [
  "STOP: no East example search on record in this session, and this is East code.",
  "Before writing or changing East code, search the tested example index \u2014 it is the API reference:",
  '1. `mcp__plugin_east_east__search_east_examples` with what you are about to do (language: "python" for east-py, "typescript" otherwise); summaries come back \u2014 id, signature, inputs and result.',
  "2. `mcp__plugin_east_east__get_east_example` for the one or two that match, and pattern your code on them.",
  "Do not read node_modules/@elaraai/** or *.examples.ts files instead: the index is the same corpus, exact and far cheaper. Every East skill requires this step."
].join("\n");
var EAST_PACKAGE_PATH = /[/\\]node_modules[/\\]@elaraai[/\\]/;
var EAST_PACKAGE_PATTERN = /(^|[/\\])node_modules[/\\]@elaraai([/\\]|$)/;
var EXAMPLES_FILE = /\.examples\.tsx?$/;
var READ_TEXT = [
  "Note: the East example index is the API reference \u2014 `mcp__plugin_east_east__search_east_examples` (then `get_east_example`) returns the same tested programs as the East packages' examples and type declarations, exact, printed in TypeScript or python, at a fraction of the tokens.",
  "Reading `.d.ts` signatures or sweeping `*.examples.ts` files reliably produces broken East code that still type-checks: the signatures omit the runtime rules. Search instead, and read a specific file only when the search pointed you at it."
].join("\n");
function isExampleCorpusRead(tool, input) {
  const file = typeof input["file_path"] === "string" ? input["file_path"] : "";
  const dir = typeof input["path"] === "string" ? input["path"] : "";
  const pattern = typeof input["pattern"] === "string" ? input["pattern"] : "";
  return tool === "Read" ? EAST_PACKAGE_PATH.test(file) || EXAMPLES_FILE.test(file) : EAST_PACKAGE_PATH.test(dir) || EAST_PACKAGE_PATTERN.test(pattern) || /\.examples\.tsx?/.test(pattern);
}

// ../east-plugin/dist/hooks/pre-read.js
async function main() {
  const event = await readHookInput();
  if (!isExampleCorpusRead(event.tool_name ?? "", event.tool_input ?? {}))
    process.exit(0);
  writeHookOutput("PreToolUse", READ_TEXT);
}
main().catch(() => process.exit(0));
export {
  READ_TEXT
};
