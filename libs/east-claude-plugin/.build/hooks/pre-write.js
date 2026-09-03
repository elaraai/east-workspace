// hooks/pre-write.ts
import { readFile as readFile3 } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";

// ../east-diagnostics/dist/src/python-lint.js
var PYTHON_EAST_IMPORT = /^\s*(?:from\s+east(?:\.[\w.]+)?\s+import\b|import\s+east\b)/m;

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
function writeHookDecision(hookEventName, decision, reason) {
  const output = {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: decision,
      permissionDecisionReason: reason
    }
  };
  process.stdout.write(JSON.stringify(output));
}

// lib/east-project.ts
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
async function findPackageJson(startDir) {
  let dir = startDir;
  while (true) {
    try {
      const content = await readFile(join(dir, "package.json"), "utf-8");
      return JSON.parse(content);
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}
function detectEastSkills(pkg) {
  if (!pkg) return [];
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
async function getEastProjectInfo(cwd) {
  const pkg = await findPackageJson(cwd);
  const skills = detectEastSkills(pkg);
  return { isEast: skills.length > 0, skills, pkg };
}

// lib/transcript.ts
import { readFile as readFile2 } from "node:fs/promises";
var SEARCH_TOOLS = ["mcp__plugin_east_east__search_east_examples", "mcp__plugin_east_east__get_east_example"];
async function searchedInTranscript(transcriptPath) {
  let raw;
  try {
    raw = await readFile2(transcriptPath, "utf-8");
  } catch {
    return false;
  }
  return SEARCH_TOOLS.some((tool) => raw.includes(`"name":"${tool}"`) || raw.includes(`"name": "${tool}"`));
}

// hooks/pre-write.ts
var EAST_IMPORT_PATTERN = /@elaraai\/east/;
var GATE_TEXT = [
  "STOP: no East example search on record in this session, and this is East code.",
  "Before writing or changing East code, search the tested example index \u2014 it is the API reference:",
  '1. `mcp__plugin_east_east__search_east_examples` with what you are about to do (language: "python" for east-py, "typescript" otherwise); summaries come back \u2014 id, signature, inputs and result.',
  "2. `mcp__plugin_east_east__get_east_example` for the one or two that match, and pattern your code on them.",
  "Do not read node_modules/@elaraai/** or *.examples.ts files instead: the index is the same corpus, exact and far cheaper. Every East skill requires this step."
].join("\n");
async function main() {
  const event = await readHookInput();
  const cwd = event.cwd || process.cwd();
  const filePath = event.tool_input?.file_path;
  if (!filePath) process.exit(0);
  const python = filePath.endsWith(".py");
  if (!python && !filePath.endsWith(".ts") && !filePath.endsWith(".tsx") && !filePath.endsWith(".js")) process.exit(0);
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
  if (!(python ? PYTHON_EAST_IMPORT : EAST_IMPORT_PATTERN).test(code)) process.exit(0);
  if (!python) {
    const { isEast } = await getEastProjectInfo(cwd);
    if (!isEast) process.exit(0);
  }
  const marker = join2(tmpdir(), `east-search-seen-${event.session_id}`);
  if (existsSync(marker)) process.exit(0);
  if (event.transcript_path && await searchedInTranscript(event.transcript_path)) {
    try {
      writeFileSync(marker, SEARCH_TOOLS.join("\n"));
    } catch {
    }
    process.exit(0);
  }
  if (process.env["EAST_REQUIRE_SEARCH"] === "deny") {
    writeHookDecision("PreToolUse", "deny", GATE_TEXT);
  } else {
    writeHookOutput("PreToolUse", GATE_TEXT);
  }
}
main().catch(() => process.exit(0));
export {
  GATE_TEXT
};
