// hooks/post-write.ts
import { readFile as readFile2 } from "node:fs/promises";

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

// hooks/post-write.ts
var EAST_IMPORT_PATTERN = /@elaraai\/east/;
var MISTAKE_PATTERNS = [
  [/East\.IntegerType/g, "Use `IntegerType` directly (imported from @elaraai/east), not `East.IntegerType`"],
  [/East\.FloatType/g, "Use `FloatType` directly (imported from @elaraai/east), not `East.FloatType`"],
  [/East\.StringType/g, "Use `StringType` directly (imported from @elaraai/east), not `East.StringType`"],
  [/East\.BooleanType/g, "Use `BooleanType` directly (imported from @elaraai/east), not `East.BooleanType`"],
  [/East\.ArrayType/g, "Use `ArrayType` directly (imported from @elaraai/east), not `East.ArrayType`"],
  [/East\.DictType/g, "Use `DictType` directly (imported from @elaraai/east), not `East.DictType`"],
  [/East\.SetType/g, "Use `SetType` directly (imported from @elaraai/east), not `East.SetType`"],
  [/East\.StructType/g, "Use `StructType` directly (imported from @elaraai/east), not `East.StructType`"],
  [/East\.OptionType/g, "Use `OptionType` directly (imported from @elaraai/east), not `East.OptionType`"],
  [/new\s+East\.(function|asyncFunction)/g, "East functions are not constructed with `new`. Use `East.function(...)` directly"],
  [/\$\.return\s*\(/g, "East functions return the expression directly from the body callback. `$.return()` is not a valid East API"],
  [/\$\.let\s*\([^)]*\)\s*(?!;)(?=[.+\-*\/])/g, "Do not use `$.let(...)` inside expressions. `$.let` and `$.const` are statements that declare variables \u2014 assign to a `const` first, then use the variable in expressions"]
];
var HEURISTIC_CHECKS = [
  {
    test: (content) => {
      const hasEastUsage = /East\.(function|asyncFunction|compile|platform)\s*\(/.test(content);
      const hasPlainTsFunctions = /^(?:export\s+)?function\s+\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/m.test(content);
      const hasTsArrowHelpers = /^(?:export\s+)?const\s+\w+\s*=\s*\([^)]*\)\s*(?::\s*\w+)?\s*=>\s*\{/m.test(content);
      return hasEastUsage && (hasPlainTsFunctions || hasTsArrowHelpers);
    },
    message: "Avoid mixing plain TypeScript utility functions with East code. East code must use `East.function()` or inline East expressions \u2014 plain TS functions cannot be called from within East function bodies"
  },
  {
    test: (content) => {
      const letConstCalls = content.matchAll(/\$\.(let|const)\s*\(([^)]+)\)/g);
      for (const match of letConstCalls) {
        const args = match[2];
        if (!args.includes(",")) return true;
      }
      return false;
    },
    message: "Always provide the East type as the second argument to `$.let()` and `$.const()`, e.g. `$.let(0n, IntegerType)` not `$.let(0n)`"
  }
];
async function main() {
  const event = await readHookInput();
  const cwd = event.cwd || process.cwd();
  const { isEast } = await getEastProjectInfo(cwd);
  if (!isEast) process.exit(0);
  const filePath = event.tool_input?.file_path;
  if (!filePath) process.exit(0);
  if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx") && !filePath.endsWith(".js")) {
    process.exit(0);
  }
  let content;
  try {
    content = await readFile2(filePath, "utf-8");
  } catch {
    process.exit(0);
    return;
  }
  if (!EAST_IMPORT_PATTERN.test(content)) process.exit(0);
  const mistakes = [];
  for (const [pattern, message] of MISTAKE_PATTERNS) {
    if (pattern.test(content)) {
      mistakes.push(message);
    }
    pattern.lastIndex = 0;
  }
  for (const { test, message } of HEURISTIC_CHECKS) {
    if (test(content)) {
      mistakes.push(message);
    }
  }
  if (mistakes.length === 0) process.exit(0);
  const context = [
    "<east-code-review>",
    "## East Code Issues Detected",
    "",
    "The following issues were found in the East code just written:",
    "",
    ...mistakes.map((m) => `- ${m}`),
    "",
    "Please fix these issues.",
    "</east-code-review>"
  ].join("\n");
  writeHookOutput("PostToolUse", context);
}
main().catch(() => process.exit(0));
