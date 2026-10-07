// ../east-plugin/dist/lib/codex-hook.js
import { readFile as readFile2 } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve as resolve3 } from "node:path";

// ../east-plugin/dist/lib/codex-tools.js
import { resolve } from "node:path";
function patchFiles(command, cwd) {
  const files = [];
  let current;
  for (const line of command.split(/\r?\n/)) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (header) {
      const path = resolve(cwd, header[2]);
      current = { path, originalPath: path, code: "", deleted: header[1] === "Delete" };
      files.push(current);
    } else if (line.startsWith("*** Move to: ") && current) {
      current.path = resolve(cwd, line.slice(13));
    } else if (current && (line.startsWith("+") || line.startsWith(" "))) {
      current.code += line.slice(1) + "\n";
    }
  }
  return files;
}
function shellReadPaths(command, cwd) {
  const paths = /* @__PURE__ */ new Set();
  let dir = cwd;
  for (const segment of command.split(/&&|;|\n|\|/)) {
    const tokens = [...segment.matchAll(/"([^"\n]*)"|'([^'\n]*)'|([^\s]+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
    if (tokens[0] === "cd" && tokens[1]) {
      dir = resolve(dir, tokens[1]);
      continue;
    }
    if (!["cat", "head", "tail", "sed", "rg", "grep", "less", "more"].includes(tokens[0] ?? ""))
      continue;
    for (const token of tokens.slice(1)) {
      if (!token.startsWith("-") && !/[*?$`]/.test(token) && /\.(tsx?|js|py)$/.test(token))
        paths.add(resolve(dir, token));
    }
  }
  return [...paths];
}

// ../east-plugin/dist/lib/bash-writes.js
import { resolve as resolve2 } from "node:path";
function isRealPath(token) {
  if (token === "" || token.startsWith("&"))
    return false;
  if (/^\d+$/.test(token))
    return false;
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
function writtenPaths(command, cwd) {
  const found = /* @__PURE__ */ new Set();
  let dir = cwd;
  const add = (path) => {
    if (!isRealPath(path))
      return;
    found.add(dir === void 0 ? path : resolve2(dir, path));
  };
  for (const segment of segments(command)) {
    const trimmed = segment.trim();
    const moved = /^cd\s+(['"]?)([^\s'";|&<>]+)\1\s*$/.exec(trimmed);
    if (moved !== null && dir !== void 0) {
      dir = resolve2(dir, unquote(moved[2] ?? ""));
      continue;
    }
    for (const match of trimmed.matchAll(/>>?\s*(['"]?)([^\s'";|&<>]+)\1/g))
      add(unquote(match[2] ?? ""));
    for (const match of trimmed.matchAll(/\btee\s+(?:-a\s+)?(['"]?)([^\s'";|&<>]+)\1/g))
      add(unquote(match[2] ?? ""));
    if (/^\s*(sed\s+(-[^\s]*\s+)*-i|cp|mv|install)\b/.test(trimmed)) {
      const path = lastToken(trimmed);
      if (path !== void 0)
        add(path);
    }
  }
  return [...found];
}

// ../east-plugin/dist/lib/transcript.js
import { readFile } from "node:fs/promises";
var SEARCH_TOOLS = ["mcp__plugin_east_east__search_east_examples", "mcp__plugin_east_east__get_east_example", "mcp__east__search_east_examples", "mcp__east__get_east_example"];
async function searchedInTranscript(transcriptPath, tools = SEARCH_TOOLS) {
  let raw;
  try {
    raw = await readFile(transcriptPath, "utf-8");
  } catch {
    return false;
  }
  return tools.some((tool) => raw.includes(`"name":"${tool}"`) || raw.includes(`"name": "${tool}"`));
}

// ../east-plugin/dist/lib/search-guidance.js
var EAST_GUIDANCE = {
  searchTool: "mcp__plugin_east_east__search_east_examples",
  getTool: "mcp__plugin_east_east__get_east_example",
  corpus: "East",
  scope: "@elaraai"
};
function bare(tool) {
  const at = tool.lastIndexOf("__");
  return at < 0 ? tool : tool.slice(at + 2);
}
function gateText(g) {
  return [
    `STOP: no ${g.corpus} example search on record in this session, and this is ${g.corpus} code.`,
    `Before writing or changing ${g.corpus} code, search the tested example index \u2014 it is the API reference:`,
    `1. \`${g.searchTool}\` with what you are about to do (language: "python" for east-py, "typescript" otherwise); summaries come back \u2014 id, signature, inputs and result.`,
    `2. \`${g.getTool}\` for the one or two that match, and pattern your code on them.`,
    `Do not read node_modules/${g.scope}/** or *.examples.ts files instead: the index is the same corpus, exact and far cheaper. Every ${g.corpus} skill requires this step.`
  ].join("\n");
}
function readText(g) {
  return [
    `Note: the ${g.corpus} example index is the API reference \u2014 \`${g.searchTool}\` (then \`${bare(g.getTool)}\`) returns the same tested programs as the ${g.corpus} packages' examples and type declarations, exact, printed in TypeScript or python, at a fraction of the tokens.`,
    `Reading \`.d.ts\` signatures or sweeping \`*.examples.ts\` files reliably produces broken ${g.corpus} code that still type-checks: the signatures omit the runtime rules. Search instead, and read a specific file only when the search pointed you at it.`
  ].join("\n");
}
function corpusReadFor(scope) {
  const escaped = scope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const packagePath = new RegExp(`[/\\\\]node_modules[/\\\\]${escaped}[/\\\\]`);
  const packagePattern = new RegExp(`(^|[/\\\\])node_modules[/\\\\]${escaped}([/\\\\]|$)`);
  const examplesFile = /\.examples\.tsx?$/;
  return (tool, input) => {
    const file = typeof input["file_path"] === "string" ? input["file_path"] : "";
    const dir = typeof input["path"] === "string" ? input["path"] : "";
    const pattern = typeof input["pattern"] === "string" ? input["pattern"] : "";
    return tool === "Read" ? packagePath.test(file) || examplesFile.test(file) : packagePath.test(dir) || packagePattern.test(pattern) || /\.examples\.tsx?/.test(pattern);
  };
}
var GATE_TEXT = gateText(EAST_GUIDANCE);
var READ_TEXT = readText(EAST_GUIDANCE);
var isExampleCorpusRead = corpusReadFor(EAST_GUIDANCE.scope);

// ../east-plugin/dist/lib/codex-hook.js
function codexToolCall(event) {
  const cwd = event.cwd || process.cwd();
  const input = event.tool_input ?? {};
  const command = typeof input.command === "string" ? input.command : typeof input["cmd"] === "string" ? input["cmd"] : "";
  const tool = event.tool_name ?? "";
  const patches = tool === "apply_patch" ? patchFiles(command, cwd) : [];
  const shell = ["Bash", "exec_command", "shell_command"].includes(tool);
  const filePath = typeof input.file_path === "string" ? resolve3(cwd, input.file_path) : void 0;
  const paths = [.../* @__PURE__ */ new Set([
    ...patches.filter((p) => !p.deleted).map((p) => p.path),
    ...shell ? [...writtenPaths(command, cwd), ...shellReadPaths(command, cwd)] : [],
    ...filePath ? [filePath] : []
  ])];
  return { tool, command, shell, patches, filePath, paths };
}
var EAST_CODEX_SEARCH_GATE = {
  searchTools: SEARCH_TOOLS,
  searchToolName: /__(?:search_east_examples|get_east_example)$/,
  gateText: GATE_TEXT,
  readText: READ_TEXT,
  isCorpusRead: isExampleCorpusRead,
  shellSweep: /node_modules\/@elaraai(?:\/|\b)|\.examples\.tsx?/,
  corpusCode: /@elaraai\/east|(?:from|import)\s+east\b/,
  markerPrefix: "east-codex-search-",
  requireSearchEnv: "EAST_REQUIRE_SEARCH"
};
async function codexSearchGate(event, options, call = codexToolCall(event)) {
  const input = event.tool_input ?? {};
  const marker = join(tmpdir(), options.markerPrefix + createHash("sha256").update(event.session_id ?? "").digest("hex"));
  if (event.hook_event_name === "PostToolUse") {
    if (call.tool.startsWith("mcp__") && options.searchToolName.test(call.tool)) {
      if (event.tool_response?.["isError"] !== true)
        writeFileSync(marker, "searched");
      return "recorded";
    }
    return null;
  }
  const context = [];
  if (options.isCorpusRead(call.tool, input) || call.shell && options.shellSweep.test(call.command)) {
    context.push(options.readText);
  }
  const writes = call.tool === "apply_patch" ? call.patches.filter((p) => !p.deleted) : call.shell ? writtenPaths(call.command, event.cwd || process.cwd()).map((path) => ({ path, originalPath: path, code: call.command })) : call.filePath && ["Edit", "Write"].includes(call.tool) ? [{ path: call.filePath, originalPath: call.filePath, code: input.content ?? input.new_string ?? "" }] : [];
  let corpusWrite = false;
  for (const file of writes) {
    if (!/\.(tsx?|js|py)$/.test(file.path))
      continue;
    let old = "";
    try {
      old = await readFile2(file.originalPath, "utf8");
    } catch {
    }
    if (options.corpusCode.test(old + "\n" + file.code))
      corpusWrite = true;
  }
  if (corpusWrite && !existsSync(marker) && !(event.transcript_path && await searchedInTranscript(event.transcript_path, options.searchTools))) {
    if (process.env[options.requireSearchEnv] === "deny")
      return { decision: "deny", text: options.gateText };
    context.push(options.gateText);
  }
  return context.length > 0 ? { decision: "context", text: context.join("\n\n") } : null;
}

// ../east-diagnostics/dist/src/python-lint.js
import { execFile } from "node:child_process";
import { existsSync as existsSync2, mkdtempSync, readFileSync, rmSync, writeFileSync as writeFileSync2 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { basename, dirname, join as join2 } from "node:path";
var PYTHON_EAST_IMPORT = /^\s*(?:from\s+east(?:\.[\w.]+)?\s+import\b|import\s+east\b)/m;
function findEastPy(fromDir) {
  const override = process.env["EAST_PY_LINT"];
  if (override !== void 0 && override !== "")
    return override;
  let dir = fromDir;
  for (; ; ) {
    for (const candidate of [join2(dir, ".venv", "bin", "east-py"), join2(dir, ".venv", "Scripts", "east-py.exe")]) {
      if (existsSync2(candidate))
        return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir)
      return "east-py";
    dir = parent;
  }
}
function runEastPyLint(file, content, budgetMs = 4e3, command = findEastPy(dirname(file))) {
  let target = file;
  let scratch = null;
  if (content !== void 0) {
    scratch = mkdtempSync(join2(tmpdir2(), "east-py-lint-"));
    target = join2(scratch, basename(file));
    writeFileSync2(target, content, "utf-8");
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
function runEastPyCheck(file, budgetMs = 8e3, command = findEastPy(dirname(file))) {
  return new Promise((resolveFindings) => {
    execFile(command, ["check", "--format", "json", "--only-if-enabled", file], { timeout: budgetMs, encoding: "utf-8", maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8" } }, (error, stdout) => {
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
    });
  });
}
function renderPythonReview(records) {
  if (records.length === 0)
    return "";
  const lines = records.map((r) => `- [${r.category}] ${r.line}:${r.column} (${r.rule}) ${r.message}`);
  return ["<east-code-review>", "## East issues in this file", "", ...lines, "</east-code-review>"].join("\n");
}

// ../east-plugin/dist/lib/host.js
import { existsSync as existsSync3 } from "node:fs";
import { fileURLToPath } from "node:url";
var isCodex = existsSync3(fileURLToPath(new URL("../../.codex-plugin/plugin.json", import.meta.url)));
function hostText(text) {
  return isCodex ? text.replaceAll("mcp__plugin_east_east__", "").replaceAll("/east:", "$east-codex-plugin:").replaceAll("Claude Code", "Codex") : text;
}

// ../east-plugin/dist/lib/hook-io.js
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
      additionalContext: hostText(additionalContext)
    }
  };
  process.stdout.write(JSON.stringify(output));
}
function writeHookDecision(hookEventName, decision, reason) {
  const output = {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: decision,
      permissionDecisionReason: hostText(reason)
    }
  };
  process.stdout.write(JSON.stringify(output));
}

// ../east-plugin/dist/lib/east-project.js
import { readFile as readFile3 } from "node:fs/promises";
import { join as join3, dirname as dirname2 } from "node:path";
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
      const content = await readFile3(join3(dir, "package.json"), "utf-8");
      return JSON.parse(content);
    } catch {
      const parent = dirname2(dir);
      if (parent === dir)
        return null;
      dir = parent;
    }
  }
}
async function findPyProject(startDir) {
  let dir = startDir;
  let nearest = null;
  while (true) {
    try {
      const text = await readFile3(join3(dir, "pyproject.toml"), "utf-8");
      if (PYTHON_SKILL_MAP.some(([pattern]) => pattern.test(text)))
        return text;
      nearest ??= text;
    } catch {
    }
    const parent = dirname2(dir);
    if (parent === dir)
      return nearest;
    dir = parent;
  }
}
function detectEastSkills(pkg) {
  if (!pkg)
    return [];
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
  if (pyproject === null)
    return [];
  const skills = [];
  for (const [pattern, skill] of PYTHON_SKILL_MAP) {
    if (pattern.test(pyproject))
      skills.push(skill);
  }
  return skills;
}
async function getEastProjectInfo(cwd) {
  const pkg = await findPackageJson(cwd);
  const tsSkills = detectEastSkills(pkg);
  const pySkills = detectPythonSkills(await findPyProject(cwd));
  const languages = [];
  if (tsSkills.length > 0)
    languages.push("typescript");
  if (pySkills.length > 0)
    languages.push("python");
  const skills = [...tsSkills, ...pySkills.filter((s) => !tsSkills.includes(s))];
  return { isEast: skills.length > 0, skills, languages, pkg };
}

// ../east-plugin/dist/lib/search-hooks.js
function writeSearchHookReply(hookEventName, reply) {
  if (reply.decision === "deny")
    writeHookDecision(hookEventName, "deny", reply.text);
  else
    writeHookOutput(hookEventName, reply.text);
}

// ../east-plugin/dist/lib/review.js
import { readFile as readFile4 } from "node:fs/promises";
import { existsSync as existsSync5, writeFileSync as writeFileSync3 } from "node:fs";
import { createHash as createHash3 } from "node:crypto";
import { tmpdir as tmpdir4 } from "node:os";
import { join as join5, dirname as dirname4, resolve as resolve5 } from "node:path";

// ../east-plugin/dist/lib/diagnostics-client.js
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { createHash as createHash2 } from "node:crypto";
import { tmpdir as tmpdir3 } from "node:os";
import { existsSync as existsSync4, unlinkSync } from "node:fs";
import { dirname as dirname3, join as join4, resolve as resolve4 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
function daemonSocket() {
  const hash = createHash2("sha1").update(daemonEntry()).digest("hex").slice(0, 16);
  return join4(tmpdir3(), `east-diag-${hash}.sock`);
}
function daemonEntry() {
  return resolve4(dirname3(fileURLToPath2(import.meta.url)), "..", "daemon", "server.js");
}
function tryRequest(socketPath, file, timeoutMs) {
  return new Promise((resolveResult) => {
    const conn = createConnection(socketPath);
    let buffer = "";
    let settled = false;
    const settle = (result) => {
      if (settled)
        return;
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
      if (newline < 0)
        return;
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
  if (!existsSync4(entry))
    return;
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
    if (attempt.kind === "text")
      return attempt.text;
    if (attempt.kind === "refused" && !spawned) {
      if (existsSync4(socketPath)) {
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

// ../east-plugin/dist/lib/east-py-lint.js
async function getPythonDiagnosticsText(file, budgetMs = 4e3) {
  const [rules, build] = await Promise.all([runEastPyLint(file, void 0, budgetMs), runEastPyCheck(file, budgetMs)]);
  if (rules === null)
    return null;
  return renderPythonReview([...rules, ...build ?? []]);
}

// ../east-plugin/dist/lib/review.js
var EAST_IMPORT_PATTERN = /@elaraai\/east/;
var SKIP_PATH = /[/\\](node_modules|dist|build|\.venv|\.git)[/\\]/;
function reviewable(filePath) {
  if (SKIP_PATH.test(filePath))
    return false;
  return /\.(py|ts|tsx|js)$/.test(filePath);
}
async function reviewFile(sessionId, filePath) {
  if (!reviewable(filePath))
    return null;
  const python = filePath.endsWith(".py");
  let content;
  try {
    content = await readFile4(filePath, "utf-8");
  } catch {
    return null;
  }
  if (!(python ? PYTHON_EAST_IMPORT : EAST_IMPORT_PATTERN).test(content))
    return null;
  const projectDir = dirname4(resolve5(filePath));
  if (!python) {
    const { isEast } = await getEastProjectInfo(projectDir);
    if (!isEast)
      return null;
  }
  const key = createHash3("sha1").update(`${sessionId}\0${filePath}\0`).update(content).digest("hex").slice(0, 20);
  const marker = join5(tmpdir4(), `east-diag-seen-${key}`);
  if (existsSync5(marker))
    return null;
  const text = python ? await getPythonDiagnosticsText(filePath) : await getDiagnosticsText(projectDir, filePath);
  if (text === null)
    return null;
  try {
    writeFileSync3(marker, "");
  } catch {
  }
  return text;
}

// hooks/codex-tools.ts
async function main() {
  const event = await readHookInput();
  const call = codexToolCall(event);
  const gate = await codexSearchGate(event, EAST_CODEX_SEARCH_GATE, call);
  if (event.hook_event_name === "PostToolUse") {
    if (gate === "recorded") return;
    const reviews = await Promise.all(call.paths.map(async (path) => {
      const text = await reviewFile(event.session_id, path);
      return text ? `### ${path}
${text}` : "";
    }));
    if (reviews.some(Boolean)) writeHookOutput("PostToolUse", reviews.filter(Boolean).join("\n\n"));
    return;
  }
  if (gate !== null && gate !== "recorded") writeSearchHookReply("PreToolUse", gate);
}
main().catch((error) => {
  process.stderr.write(`East hook: ${String(error)}
`);
});
