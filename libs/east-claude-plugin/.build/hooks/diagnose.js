// hooks/diagnose.ts
import { readFile as readFile2 } from "node:fs/promises";
import { existsSync as existsSync2, writeFileSync } from "node:fs";
import { createHash as createHash2 } from "node:crypto";
import { tmpdir as tmpdir2 } from "node:os";
import { join as join3, dirname as dirname3, resolve as resolve2 } from "node:path";

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
function tryRequest(socketPath, file, timeoutMs) {
  return new Promise((resolveResult) => {
    const conn = createConnection(socketPath);
    let buffer = "";
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.destroy();
      resolveResult(result);
    };
    const timer = setTimeout(() => settle({ kind: "timeout" }), timeoutMs);
    timer.unref();
    conn.on("connect", () => conn.write(`${JSON.stringify({ file })}
`));
    conn.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        settle(response.ok === true ? { kind: "text", text: response.text ?? "" } : { kind: "error" });
      } catch {
        settle({ kind: "error" });
      }
    });
    conn.on("error", (err) => {
      settle(err.code === "ECONNREFUSED" || err.code === "ENOENT" ? { kind: "refused" } : { kind: "error" });
    });
  });
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
async function getDiagnosticsText(workspace, file, budgetMs = 4e3) {
  const socketPath = daemonSocket();
  const deadline = Date.now() + budgetMs;
  let spawned = false;
  while (Date.now() < deadline) {
    const attempt = await tryRequest(socketPath, file, Math.min(1500, deadline - Date.now()));
    if (attempt.kind === "text") return attempt.text;
    if (attempt.kind === "refused" && !spawned) {
      if (existsSync(socketPath)) {
        try {
          unlinkSync(socketPath);
        } catch {
        }
      }
      spawnDaemon(socketPath, workspace);
      spawned = true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

// hooks/diagnose.ts
var EAST_IMPORT_PATTERN = /@elaraai\/east/;
var SKIP_PATH = /[/\\](node_modules|dist|build|\.venv|\.git)[/\\]/;
async function main() {
  const event = await readHookInput();
  const filePath = event.tool_input?.file_path;
  if (filePath === void 0) process.exit(0);
  if (SKIP_PATH.test(filePath)) process.exit(0);
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
  const projectDir = dirname3(resolve2(filePath));
  const { isEast } = await getEastProjectInfo(projectDir);
  if (!isEast) process.exit(0);
  const key = createHash2("sha1").update(`${event.session_id}\0${filePath}\0`).update(content).digest("hex").slice(0, 20);
  const marker = join3(tmpdir2(), `east-diag-seen-${key}`);
  if (existsSync2(marker)) process.exit(0);
  const text = await getDiagnosticsText(projectDir, filePath);
  if (text === null) process.exit(0);
  try {
    writeFileSync(marker, "");
  } catch {
  }
  if (text === "") process.exit(0);
  writeHookOutput("PostToolUse", text);
}
main().catch(() => process.exit(0));
