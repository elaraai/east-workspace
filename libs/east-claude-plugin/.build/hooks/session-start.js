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

// lib/diagnostics-client.ts
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { existsSync, unlinkSync } from "node:fs";
import { dirname as dirname2, join as join2, resolve } from "node:path";
import { fileURLToPath } from "node:url";
function daemonSocket() {
  const hash = createHash("sha1").update(daemonEntry()).digest("hex").slice(0, 16);
  return join2(tmpdir(), `east-diag-${hash}.sock`);
}
function daemonEntry() {
  return resolve(dirname2(fileURLToPath(import.meta.url)), "..", "daemon", "server.js");
}
function spawnDaemon(socketPath, workspace) {
  const entry = daemonEntry();
  if (!existsSync(entry)) return;
  try {
    spawn(process.execPath, [entry], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, EAST_DIAG_SOCKET: socketPath, EAST_DIAG_CWD: workspace }
    }).unref();
  } catch {
  }
}
function warmDaemon(workspace) {
  const socketPath = daemonSocket();
  const conn = createConnection(socketPath);
  conn.on("connect", () => conn.destroy());
  conn.on("error", (err) => {
    conn.destroy();
    if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
      if (existsSync(socketPath)) {
        try {
          unlinkSync(socketPath);
        } catch {
        }
      }
      spawnDaemon(socketPath, workspace);
    }
  });
}

// hooks/session-start.ts
async function main() {
  const event = await readHookInput();
  const cwd = event.cwd || process.cwd();
  const { isEast, skills } = await getEastProjectInfo(cwd);
  if (!isEast) process.exit(0);
  warmDaemon(cwd);
  const skillList = skills.map((s) => `/east:${s}`).join(", ");
  const context = [
    "This is an East project. East is a statically typed, expression-based language embedded in TypeScript \u2014 its patterns differ from regular TypeScript, so don't assume TS idioms carry over.",
    "",
    'East + e3 solutions are decision-oriented: they exist to improve a business decision and show the evidence behind it ("decisions, not dashboards"). The platform is a stack \u2014 an economic ontology (the typed model of the business) at the hub, an Integrate / Reason / Compute engine beneath it, and UI / agent / API surfaces above. Design top-down from the decision.',
    "",
    `Available East skills: ${skillList}. Invoke the relevant skill when writing East programs \u2014 they provide type-safe API patterns and examples. Each skill ends with a "Related skills" list; load those too when a task spans layers.`,
    "Always available regardless of dependencies: /east:east-design (architect a solution before coding), /east:east-ontology (model the business as an economic ontology), /east:east-project (scaffold + run the build/deploy lifecycle).",
    "",
    "Finding East API usage (important):",
    "- The East example index is the best reference. Relevant examples are auto-injected into each prompt, and you can call the `mcp__plugin_east_east__search_east_examples` MCP tool for targeted lookups.",
    "- Do NOT learn the API by reading or grepping `.d.ts` files in node_modules. The type signatures omit East's idioms and runtime constraints, so reasoning from them reliably produces broken code that still type-checks. Search the examples instead \u2014 that is the correct, grounded path.",
    "",
    "Preemptive diagnostics:",
    "- After you read or edit an East file, the plugin injects an `<east-code-review>` block listing TypeScript errors and East-specific idiom issues (e.g. inline `$.const`, hand-rolled variants, `$.let` used in an expression). Treat it as authoritative and fix what it flags \u2014 it's preemptive, so resolving it now avoids build-and-retry loops later."
  ].join("\n");
  writeHookOutput("SessionStart", context);
}
main().catch(() => process.exit(0));
