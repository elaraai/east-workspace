import { readHookInput, writeHookOutput } from "../lib/hook-io.js";
import { getEastProjectInfo } from "../lib/east-project.js";
import { warmDaemon } from "../lib/diagnostics-client.js";
import { EAST_RULES_CONTEXT } from "../lib/east-rules-context.js";

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
    "East + e3 solutions are decision-oriented: they exist to improve a business decision and show the evidence behind it (\"decisions, not dashboards\"). The platform is a stack — an economic ontology (the typed model of the business) at the hub, an Integrate / Reason / Compute engine beneath it, and UI / agent / API surfaces above. Design top-down from the decision.",
    "",
    `Available East skills: ${skillList}. Invoke the relevant skill when writing East programs — they provide type-safe API patterns and examples. Each skill ends with a \"Related skills\" list; load those too when a task spans layers.`,
    "Always available regardless of dependencies: /east:east-design (architect a solution before coding), /east:east-ontology (model the business as an economic ontology), /east:east-project (scaffold + run the build/deploy lifecycle).",
    "",
    "Finding East API usage (required):",
    "- Before writing or changing East code, search the tested example index: call `mcp__plugin_east_east__search_east_examples` for each capability you are about to use (language: \"python\" for east-py, \"typescript\" otherwise) — summaries come back first — then `mcp__plugin_east_east__get_east_example` for the one that matches, and pattern your code on it. Nothing is injected for you; the search is the step, and every East skill requires it.",
    "- Do NOT read `node_modules/@elaraai/**` or `*.examples.ts` files wholesale, and do not reason from `.d.ts` signatures: the index holds the same programs, exact and far cheaper, printed in either language from their IR. The signatures omit the runtime rules that make East code correct.",
    "",
    "Preemptive diagnostics:",
    "- After you read or edit an East file, the plugin injects an `<east-code-review>` block listing TypeScript errors and East-specific idiom issues. Treat it as authoritative and fix what it flags — it's preemptive, so resolving it now avoids build-and-retry loops later. The rules it enforces are summarised below; write to them up front.",
    "",
    EAST_RULES_CONTEXT,
  ].join("\n");

  writeHookOutput("SessionStart", context);
}

main().catch(() => process.exit(0));
