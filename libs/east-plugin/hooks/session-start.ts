import { readHookInput, writeHookOutput } from "../lib/hook-io.js";
import { getEastProjectInfo } from "../lib/east-project.js";

async function main() {
  const event = await readHookInput();
  const cwd = event.cwd || process.cwd();

  const { isEast, skills } = await getEastProjectInfo(cwd);
  if (!isEast) process.exit(0);

  const skillList = skills.map((s) => `- ${s}`).join("\n");
  const context = [
    "This is an East project. The following East skills are available and should be used when working with East code:",
    "",
    skillList,
    "",
    "Use /east (or the relevant skill) when writing East programs. The skills provide type-safe API patterns and examples.",
  ].join("\n");

  writeHookOutput("SessionStart", context);
}

main().catch(() => process.exit(0));
