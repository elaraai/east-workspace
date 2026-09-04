// hooks/diagnose-bash.ts
import { resolve as resolve3 } from "node:path";

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

// lib/review.ts
import { readFile as readFile2 } from "node:fs/promises";
import { existsSync as existsSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { createHash as createHash2 } from "node:crypto";
import { tmpdir as tmpdir3 } from "node:os";
import { join as join4, dirname as dirname4, resolve as resolve2 } from "node:path";

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
var PYTHON_SKILL_MAP = [
  [/elaraai-east-py-datascience(?![\w-])/, "east-py-datascience"],
  [/elaraai-east-py-std(?![\w-])/, "east-py-std"],
  [/elaraai-east-py-io(?![\w-])/, "east-py-io"],
  [/elaraai-east-py(?![\w-])/, "east-py"]
];
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
async function findPyProject(startDir) {
  let dir = startDir;
  while (true) {
    const texts = [];
    for (const name of ["pyproject.toml", "uv.lock"]) {
      try {
        texts.push(await readFile(join(dir, name), "utf-8"));
      } catch {
      }
    }
    if (texts.length > 0) return texts.join("\n");
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
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
function detectPythonSkills(pyproject) {
  if (pyproject === null) return [];
  const skills = [];
  for (const [pattern, skill] of PYTHON_SKILL_MAP) {
    if (pattern.test(pyproject)) skills.push(skill);
  }
  return skills;
}
async function getEastProjectInfo(cwd) {
  const pkg = await findPackageJson(cwd);
  const tsSkills = detectEastSkills(pkg);
  const pySkills = detectPythonSkills(await findPyProject(cwd));
  const languages = [];
  if (tsSkills.length > 0) languages.push("typescript");
  if (pySkills.length > 0) languages.push("python");
  const skills = [...tsSkills, ...pySkills.filter((s) => !tsSkills.includes(s))];
  return { isEast: skills.length > 0, skills, languages, pkg };
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

// ../east-diagnostics/dist/src/python-lint.js
import { execFile } from "node:child_process";
import { existsSync as existsSync2, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { basename, dirname as dirname3, join as join3 } from "node:path";
var PYTHON_EAST_IMPORT = /^\s*(?:from\s+east(?:\.[\w.]+)?\s+import\b|import\s+east\b)/m;
function findEastPy(fromDir) {
  const override = process.env["EAST_PY_LINT"];
  if (override !== void 0 && override !== "")
    return override;
  let dir = fromDir;
  for (; ; ) {
    for (const candidate of [join3(dir, ".venv", "bin", "east-py"), join3(dir, ".venv", "Scripts", "east-py.exe")]) {
      if (existsSync2(candidate))
        return candidate;
    }
    const parent = dirname3(dir);
    if (parent === dir)
      return "east-py";
    dir = parent;
  }
}
function runEastPyLint(file, content, budgetMs = 4e3) {
  const command = findEastPy(dirname3(file));
  let target = file;
  let scratch = null;
  if (content !== void 0) {
    scratch = mkdtempSync(join3(tmpdir2(), "east-py-lint-"));
    target = join3(scratch, basename(file));
    writeFileSync(target, content, "utf-8");
  }
  return new Promise((resolveFindings) => {
    execFile(
      command,
      ["lint", "--format", "json", target],
      // UTF-8 stdio: python encodes a piped stdout in the locale's code page on Windows (cp1252), and the findings carry em dashes
      { timeout: budgetMs, encoding: "utf-8", maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
      (error, stdout) => {
        if (scratch !== null)
          rmSync(scratch, { recursive: true, force: true });
        if (error !== null && error.code !== 1) {
          resolveFindings(null);
          return;
        }
        let records;
        try {
          records = JSON.parse(stdout);
        } catch {
          resolveFindings(null);
          return;
        }
        resolveFindings(Array.isArray(records) ? records : null);
      }
    );
  });
}
function renderPythonReview(records) {
  if (records.length === 0)
    return "";
  const lines = records.map((r) => `- [${r.category}] ${r.line}:${r.column} (${r.rule}) ${r.message}`);
  return ["<east-code-review>", "## East issues in this file", "", ...lines, "</east-code-review>"].join("\n");
}

// lib/east-py-lint.ts
async function getPythonDiagnosticsText(file, budgetMs = 4e3) {
  const records = await runEastPyLint(file, void 0, budgetMs);
  return records === null ? null : renderPythonReview(records);
}

// lib/review.ts
var EAST_IMPORT_PATTERN = /@elaraai\/east/;
var SKIP_PATH = /[/\\](node_modules|dist|build|\.venv|\.git)[/\\]/;
function reviewable(filePath) {
  if (SKIP_PATH.test(filePath)) return false;
  return /\.(py|ts|tsx|js)$/.test(filePath);
}
async function reviewFile(sessionId, filePath) {
  if (!reviewable(filePath)) return null;
  const python = filePath.endsWith(".py");
  let content;
  try {
    content = await readFile2(filePath, "utf-8");
  } catch {
    return null;
  }
  if (!(python ? PYTHON_EAST_IMPORT : EAST_IMPORT_PATTERN).test(content)) return null;
  const projectDir = dirname4(resolve2(filePath));
  if (!python) {
    const { isEast } = await getEastProjectInfo(projectDir);
    if (!isEast) return null;
  }
  const key = createHash2("sha1").update(`${sessionId}\0${filePath}\0`).update(content).digest("hex").slice(0, 20);
  const marker = join4(tmpdir3(), `east-diag-seen-${key}`);
  if (existsSync3(marker)) return null;
  const text = python ? await getPythonDiagnosticsText(filePath) : await getDiagnosticsText(projectDir, filePath);
  if (text === null) return null;
  try {
    writeFileSync2(marker, "");
  } catch {
  }
  return text;
}

// lib/bash-writes.ts
function isRealPath(token) {
  if (token === "" || token.startsWith("&")) return false;
  if (/^\d+$/.test(token)) return false;
  return !token.startsWith("/dev/");
}
function unquote(token) {
  const m = /^(['"])(.*)\1$/.exec(token);
  return m?.[2] ?? token;
}
function segments(command) {
  return command.split(/\|\||&&|[;|\n]/);
}
function lastToken(segment) {
  const tokens = segment.trim().split(/\s+/).map(unquote).filter((t) => t !== "" && !t.startsWith("-"));
  const last = tokens.at(-1);
  return last !== void 0 && isRealPath(last) ? last : void 0;
}
function writtenPaths(command) {
  const found = /* @__PURE__ */ new Set();
  for (const match of command.matchAll(/>>?\s*(['"]?)([^\s'";|&<>]+)\1/g)) {
    const path = unquote(match[2] ?? "");
    if (isRealPath(path)) found.add(path);
  }
  for (const segment of segments(command)) {
    const trimmed = segment.trim();
    for (const match of trimmed.matchAll(/\btee\s+(?:-a\s+)?(['"]?)([^\s'";|&<>]+)\1/g)) {
      const path = unquote(match[2] ?? "");
      if (isRealPath(path)) found.add(path);
    }
    if (/^\s*(sed\s+(-[^\s]*\s+)*-i|cp|mv|install)\b/.test(trimmed)) {
      const path = lastToken(trimmed);
      if (path !== void 0) found.add(path);
    }
  }
  return [...found];
}

// hooks/diagnose-bash.ts
async function main() {
  const event = await readHookInput();
  const command = event.tool_input?.command;
  if (typeof command !== "string" || command === "") process.exit(0);
  const candidates = writtenPaths(command).map((p) => resolve3(event.cwd || process.cwd(), p)).filter(reviewable);
  if (candidates.length === 0) process.exit(0);
  const blocks = [];
  for (const path of candidates.slice(0, 10)) {
    const text = await reviewFile(event.session_id, path);
    if (text !== null && text !== "") blocks.push(`### ${path}
${text}`);
  }
  if (blocks.length === 0) process.exit(0);
  writeHookOutput("PostToolUse", blocks.join("\n\n"));
}
main().catch(() => process.exit(0));
