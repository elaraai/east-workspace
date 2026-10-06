// ../east-plugin/dist/lib/search-hooks.js
import { readFile as readFile3 } from "node:fs/promises";
import { existsSync as existsSync2, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";

// ../east-diagnostics/dist/src/python-lint.js
var PYTHON_EAST_IMPORT = /^\s*(?:from\s+east(?:\.[\w.]+)?\s+import\b|import\s+east\b)/m;

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

// ../east-plugin/dist/lib/east-project.js
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
var PACKAGE_SKILL_MAP = {
  "@elaraai/east": "east",
  "@elaraai/east-node-std": "east-node-std",
  "@elaraai/east-node-io": "east-node-io",
  "@elaraai/east-py-datascience": "east-py-datascience",
  "@elaraai/east-ui": "east-ui",
  "@elaraai/e3": "e3",
  "@elaraai/e3-ui": "e3-ui"
};
var PYTHON_SKILL_MAP = [
  [/elaraai-east-py-datascience(?![\w-])/, "east-py-datascience"],
  [/elaraai-east-py-std(?![\w-])/, "east-py-std"],
  [/elaraai-east-py-io(?![\w-])/, "east-py-io"],
  [/elaraai-east-py(?![\w-])/, "east-py"]
];
async function findPackageJson(startDir) {
  let dir = startDir;
  while (true) {
    try {
      const content = await readFile(join(dir, "package.json"), "utf-8");
      return JSON.parse(content);
    } catch {
      const parent = dirname(dir);
      if (parent === dir)
        return null;
      dir = parent;
    }
  }
}
async function findPyProject(startDir) {
  let dir = startDir;
  let nearest = null;
  while (true) {
    try {
      const text = await readFile(join(dir, "pyproject.toml"), "utf-8");
      if (PYTHON_SKILL_MAP.some(([pattern]) => pattern.test(text)))
        return text;
      nearest ??= text;
    } catch {
    }
    const parent = dirname(dir);
    if (parent === dir)
      return nearest;
    dir = parent;
  }
}
function detectEastSkills(pkg) {
  if (!pkg)
    return [];
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies
  };
  const skills = [];
  for (const [packageName, skillName] of Object.entries(PACKAGE_SKILL_MAP)) {
    if (packageName in allDeps) {
      skills.push(skillName);
    }
  }
  return skills;
}
function detectPythonSkills(pyproject) {
  if (pyproject === null)
    return [];
  const skills = [];
  for (const [pattern, skill] of PYTHON_SKILL_MAP) {
    if (pattern.test(pyproject))
      skills.push(skill);
  }
  return skills;
}
async function getEastProjectInfo(cwd) {
  const pkg = await findPackageJson(cwd);
  const tsSkills = detectEastSkills(pkg);
  const pySkills = detectPythonSkills(await findPyProject(cwd));
  const languages = [];
  if (tsSkills.length > 0)
    languages.push("typescript");
  if (pySkills.length > 0)
    languages.push("python");
  const skills = [...tsSkills, ...pySkills.filter((s) => !tsSkills.includes(s))];
  return { isEast: skills.length > 0, skills, languages, pkg };
}

// ../east-plugin/dist/lib/transcript.js
import { readFile as readFile2 } from "node:fs/promises";
var SEARCH_TOOLS = ["mcp__plugin_east_east__search_east_examples", "mcp__plugin_east_east__get_east_example", "mcp__east__search_east_examples", "mcp__east__get_east_example"];
async function searchedInTranscript(transcriptPath, tools = SEARCH_TOOLS) {
  let raw;
  try {
    raw = await readFile2(transcriptPath, "utf-8");
  } catch {
    return false;
  }
  return tools.some((tool) => raw.includes(`"name":"${tool}"`) || raw.includes(`"name": "${tool}"`));
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
var EAST_SEARCH_GATE = {
  searchTools: SEARCH_TOOLS,
  gateText: GATE_TEXT,
  isCorpusCode: (code, python) => (python ? PYTHON_EAST_IMPORT : /@elaraai\/east/).test(code),
  isProject: async (cwd, python) => python || (await getEastProjectInfo(cwd)).isEast,
  markerPrefix: "east-search-seen",
  requireSearchEnv: "EAST_REQUIRE_SEARCH"
};
async function preWriteGate(event, options) {
  const cwd = event.cwd || process.cwd();
  const filePath = event.tool_input?.file_path;
  if (!filePath)
    return null;
  const python = filePath.endsWith(".py");
  if (!python && !filePath.endsWith(".ts") && !filePath.endsWith(".tsx") && !filePath.endsWith(".js"))
    return null;
  let code = "";
  if (event.tool_name === "Write") {
    code = event.tool_input?.content ?? "";
  } else if (event.tool_name === "Edit") {
    try {
      code = await readFile3(filePath, "utf-8");
    } catch {
      code = event.tool_input?.new_string ?? "";
    }
  }
  if (!options.isCorpusCode(code, python))
    return null;
  if (options.isProject !== void 0 && !await options.isProject(cwd, python))
    return null;
  const marker = join2(tmpdir(), `${options.markerPrefix}-${event.session_id}`);
  if (existsSync2(marker))
    return null;
  if (event.transcript_path && await searchedInTranscript(event.transcript_path, options.searchTools)) {
    try {
      writeFileSync(marker, options.searchTools.join("\n"));
    } catch {
    }
    return null;
  }
  return { decision: process.env[options.requireSearchEnv] === "deny" ? "deny" : "context", text: options.gateText };
}
function writeSearchHookReply(hookEventName, reply) {
  if (reply.decision === "deny")
    writeHookDecision(hookEventName, "deny", reply.text);
  else
    writeHookOutput(hookEventName, reply.text);
}
async function runPreWriteGate(options) {
  const reply = await preWriteGate(await readHookInput(), options);
  if (reply !== null)
    writeSearchHookReply("PreToolUse", reply);
}

// ../east-plugin/dist/hooks/pre-write.js
runPreWriteGate(EAST_SEARCH_GATE).catch(() => process.exit(0));
export {
  GATE_TEXT
};
