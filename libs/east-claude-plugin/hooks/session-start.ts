import { readHookInput, writeHookOutput } from "../lib/hook-io.js";
import { getEastProjectInfo } from "../lib/east-project.js";
import { warmDaemon } from "../lib/diagnostics-client.js";

async function main() {
  const event = await readHookInput();
  const cwd = event.cwd || process.cwd();

  const { isEast, skills } = await getEastProjectInfo(cwd);
  if (!isEast) process.exit(0);

  // Start the diagnostics daemon early so the first edit isn't cold.
  warmDaemon(cwd);

  const skillList = skills.map((s) => `/east:${s}`).join(", ");
  const context = [
    "This is an East project. East is a statically typed, expression-based language embedded in TypeScript — its patterns differ from regular TypeScript, so don't assume TS idioms carry over.",
    "",
    `Available East skills: ${skillList}. Invoke the relevant skill when writing East programs — they provide type-safe API patterns and examples.`,
    "",
    "Finding East API usage (important):",
    "- The East example index is the best reference. Relevant examples are auto-injected into each prompt, and you can call the `mcp__plugin_east_east__search_east_examples` MCP tool for targeted lookups.",
    "- Do NOT learn the API by reading or grepping `.d.ts` files in node_modules. The type signatures omit East's idioms and runtime constraints, so reasoning from them reliably produces broken code that still type-checks. Search the examples instead — that is the correct, grounded path.",
    "",
    "Preemptive diagnostics:",
    "- After you read or edit an East file, the plugin injects an `<east-code-review>` block listing TypeScript errors and East-specific idiom issues (e.g. inline `$.const`, hand-rolled variants, `$.let` used in an expression). Treat it as authoritative and fix what it flags — it's preemptive, so resolving it now avoids build-and-retry loops later.",
  ].join("\n");

  writeHookOutput("SessionStart", context);
}

main().catch(() => process.exit(0));
