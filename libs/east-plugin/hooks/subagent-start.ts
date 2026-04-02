import { readHookInput, writeHookOutput } from "../lib/hook-io.js";
import { getEastProjectInfo } from "../lib/east-project.js";

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
    "- Use the mcp__plugin_east_east-search__search_east_examples tool to look up East API examples before writing or modifying East code",
    "- East is a statically typed, expression-based language embedded in TypeScript — it has unique patterns that differ from regular TypeScript",
    `- Available skills: ${skillList}`,
  ].join("\n");

  writeHookOutput("SubagentStart", context);
}

main().catch(() => process.exit(0));
