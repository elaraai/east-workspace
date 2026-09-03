import { readHookInput, writeHookOutput } from "../lib/hook-io.js";
import { getEastProjectInfo } from "../lib/east-project.js";
import { EAST_RULES_CONTEXT } from "../lib/east-rules-context.js";

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
    "- REQUIRED before writing or modifying East code: call `mcp__plugin_east_east__search_east_examples` for each capability you are about to use (language: \"python\" for east-py, \"typescript\" otherwise), then `mcp__plugin_east_east__get_east_example` for the one that matches. Nothing is injected for you; the search is the step.",
    "- Do NOT read `node_modules/@elaraai/**` or `*.examples.ts` files wholesale, and do not reason from `.d.ts` signatures — the index holds the same programs, exact and cheaper, printed in either language from their IR.",
    "- After you read or edit an East file, the plugin injects an `<east-code-review>` block (TypeScript errors + East idiom issues). Treat it as authoritative and fix what it flags; the rules are summarised below so you can write to them up front.",
    "- East is a statically typed, expression-based language embedded in TypeScript — it has unique patterns that differ from regular TypeScript.",
    `- Available skills: ${skillList}`,
    "",
    EAST_RULES_CONTEXT,
  ].join("\n");

  writeHookOutput("SubagentStart", context);
}

main().catch(() => process.exit(0));
