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

// lib/east-project.ts
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
var PACKAGE_SKILL_MAP = {
  "@elaraai/east": "east",
  "@elaraai/east-node-std": "east-node-std",
  "@elaraai/east-node-io": "east-node-io",
  "@elaraai/east-py-datascience": "east-py-datascience",
  "@elaraai/east-ui": "east-ui",
  "@elaraai/e3": "e3"
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

// hooks/subagent-start.ts
async function main() {
  const event = await readHookInput();
  const cwd = event.cwd || process.cwd();
  const { isEast, skills } = await getEastProjectInfo(cwd);
  if (!isEast) process.exit(0);
  const skillList = skills.map((s) => `/east:${s}`).join(", ");
  const packageList = skills.map((s) => `@elaraai/${s}`).join(", ");
  const context = [
    `This is an East project using ${packageList}.`,
    "",
    "When working with East code:",
    "- The East example index is the best API reference: call the `mcp__plugin_east_east__search_east_examples` MCP tool to find idiomatic examples before writing or modifying East code.",
    "- Do NOT learn the API from `.d.ts` files in node_modules \u2014 their signatures omit East's idioms and constraints, so reasoning from them reliably produces broken code. Search the examples instead.",
    "- After you read or edit an East file, the plugin injects an `<east-code-review>` block (TypeScript errors + East idiom issues like inline `$.const` or hand-rolled variants). Treat it as authoritative and fix what it flags.",
    "- East is a statically typed, expression-based language embedded in TypeScript \u2014 it has unique patterns that differ from regular TypeScript.",
    `- Available skills: ${skillList}`
  ].join("\n");
  writeHookOutput("SubagentStart", context);
}
main().catch(() => process.exit(0));
