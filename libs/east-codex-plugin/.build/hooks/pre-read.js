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
function writeHookDecision(hookEventName, decision, reason) {
  const output = {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: decision,
      permissionDecisionReason: hostText(reason)
    }
  };
  process.stdout.write(JSON.stringify(output));
}

// ../east-plugin/dist/lib/search-guidance.js
var EAST_GUIDANCE = {
  searchTool: "mcp__plugin_east_east__search_east_examples",
  getTool: "mcp__plugin_east_east__get_east_example",
  corpus: "East",
  scope: "@elaraai"
};
function bare(tool) {
  const at = tool.lastIndexOf("__");
  return at < 0 ? tool : tool.slice(at + 2);
}
function gateText(g) {
  return [
    `STOP: no ${g.corpus} example search on record in this session, and this is ${g.corpus} code.`,
    `Before writing or changing ${g.corpus} code, search the tested example index \u2014 it is the API reference:`,
    `1. \`${g.searchTool}\` with what you are about to do (language: "python" for east-py, "typescript" otherwise); summaries come back \u2014 id, signature, inputs and result.`,
    `2. \`${g.getTool}\` for the one or two that match, and pattern your code on them.`,
    `Do not read node_modules/${g.scope}/** or *.examples.ts files instead: the index is the same corpus, exact and far cheaper. Every ${g.corpus} skill requires this step.`
  ].join("\n");
}
function readText(g) {
  return [
    `Note: the ${g.corpus} example index is the API reference \u2014 \`${g.searchTool}\` (then \`${bare(g.getTool)}\`) returns the same tested programs as the ${g.corpus} packages' examples and type declarations, exact, printed in TypeScript or python, at a fraction of the tokens.`,
    `Reading \`.d.ts\` signatures or sweeping \`*.examples.ts\` files reliably produces broken ${g.corpus} code that still type-checks: the signatures omit the runtime rules. Search instead, and read a specific file only when the search pointed you at it.`
  ].join("\n");
}
function corpusReadFor(scope) {
  const escaped = scope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const packagePath = new RegExp(`[/\\\\]node_modules[/\\\\]${escaped}[/\\\\]`);
  const packagePattern = new RegExp(`(^|[/\\\\])node_modules[/\\\\]${escaped}([/\\\\]|$)`);
  const examplesFile = /\.examples\.tsx?$/;
  return (tool, input) => {
    const file = typeof input["file_path"] === "string" ? input["file_path"] : "";
    const dir = typeof input["path"] === "string" ? input["path"] : "";
    const pattern = typeof input["pattern"] === "string" ? input["pattern"] : "";
    return tool === "Read" ? packagePath.test(file) || examplesFile.test(file) : packagePath.test(dir) || packagePattern.test(pattern) || /\.examples\.tsx?/.test(pattern);
  };
}
var GATE_TEXT = gateText(EAST_GUIDANCE);
var READ_TEXT = readText(EAST_GUIDANCE);
var isExampleCorpusRead = corpusReadFor(EAST_GUIDANCE.scope);

// ../east-plugin/dist/lib/search-hooks.js
var EAST_READ_REMINDER = { readText: READ_TEXT, isCorpusRead: isExampleCorpusRead };
function preReadReminder(event, options) {
  return options.isCorpusRead(event.tool_name ?? "", event.tool_input ?? {}) ? { decision: "context", text: options.readText } : null;
}
function writeSearchHookReply(hookEventName, reply) {
  if (reply.decision === "deny")
    writeHookDecision(hookEventName, "deny", reply.text);
  else
    writeHookOutput(hookEventName, reply.text);
}
async function runPreReadReminder(options) {
  const reply = preReadReminder(await readHookInput(), options);
  if (reply !== null)
    writeSearchHookReply("PreToolUse", reply);
}

// ../east-plugin/dist/hooks/pre-read.js
runPreReadReminder(EAST_READ_REMINDER).catch(() => process.exit(0));
export {
  READ_TEXT
};
