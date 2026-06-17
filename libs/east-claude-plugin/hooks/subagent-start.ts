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
    "- The East example index is the best API reference: call the `mcp__plugin_east_east__search_east_examples` MCP tool to find idiomatic examples before writing or modifying East code.",
    "- Do NOT learn the API from `.d.ts` files in node_modules — their signatures omit East's idioms and constraints, so reasoning from them reliably produces broken code. Search the examples instead.",
    "- After you read or edit an East file, the plugin injects an `<east-code-review>` block (TypeScript errors + East idiom issues). Treat it as authoritative and fix what it flags; the rules are summarised below so you can write to them up front.",
    "- East is a statically typed, expression-based language embedded in TypeScript — it has unique patterns that differ from regular TypeScript.",
    `- Available skills: ${skillList}`,
    "",
    EAST_RULES_CONTEXT,
  ].join("\n");

  writeHookOutput("SubagentStart", context);
}

main().catch(() => process.exit(0));
