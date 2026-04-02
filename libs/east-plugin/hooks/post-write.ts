import { readFile } from "node:fs/promises";
import { readHookInput, writeHookOutput } from "../lib/hook-io.js";
import { getEastProjectInfo } from "../lib/east-project.js";

const EAST_IMPORT_PATTERN = /@elaraai\/east/;

const MISTAKE_PATTERNS: Array<[RegExp, string]> = [
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
  [/\$\.let\s*\([^)]*\)\s*(?!;)(?=[.+\-*\/])/g, "Do not use `$.let(...)` inside expressions. `$.let` and `$.const` are statements that declare variables — assign to a `const` first, then use the variable in expressions"],
];

interface HeuristicCheck {
  test: (content: string) => boolean;
  message: string;
}

const HEURISTIC_CHECKS: HeuristicCheck[] = [
  {
    test: (content: string) => {
      const hasEastUsage = /East\.(function|asyncFunction|compile|platform)\s*\(/.test(content);
      const hasPlainTsFunctions = /^(?:export\s+)?function\s+\w+\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/m.test(content);
      const hasTsArrowHelpers = /^(?:export\s+)?const\s+\w+\s*=\s*\([^)]*\)\s*(?::\s*\w+)?\s*=>\s*\{/m.test(content);
      return hasEastUsage && (hasPlainTsFunctions || hasTsArrowHelpers);
    },
    message: "Avoid mixing plain TypeScript utility functions with East code. East code must use `East.function()` or inline East expressions — plain TS functions cannot be called from within East function bodies",
  },
  {
    test: (content: string) => {
      const letConstCalls = content.matchAll(/\$\.(let|const)\s*\(([^)]+)\)/g);
      for (const match of letConstCalls) {
        const args = match[2]!;
        if (!args.includes(",")) return true;
      }
      return false;
    },
    message: "Always provide the East type as the second argument to `$.let()` and `$.const()`, e.g. `$.let(0n, IntegerType)` not `$.let(0n)`",
  },
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

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    process.exit(0);
    return; // unreachable, but satisfies TS control flow
  }

  if (!EAST_IMPORT_PATTERN.test(content)) process.exit(0);

  const mistakes: string[] = [];
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
    "</east-code-review>",
  ].join("\n");

  writeHookOutput("PostToolUse", context);
}

main().catch(() => process.exit(0));
