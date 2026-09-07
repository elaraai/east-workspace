// ../east-diagnostics/dist/src/jsonrpc-stdio.js
function frame(message) {
  const body = JSON.stringify({ jsonrpc: "2.0", ...message });
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r
\r
${body}`;
}
var FrameReader = class {
  onMessage;
  buffer = Buffer.alloc(0);
  constructor(onMessage) {
    this.onMessage = onMessage;
  }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (; ; ) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0)
        return;
      const header = this.buffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (match === null) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length)
        return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      this.onMessage(message);
    }
  }
  reset() {
    this.buffer = Buffer.alloc(0);
  }
};

// ../east-diagnostics/dist/src/python-lint.js
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
var PYTHON_EAST_IMPORT = /^\s*(?:from\s+east(?:\.[\w.]+)?\s+import\b|import\s+east\b)/m;
function findEastPy(fromDir) {
  const override = process.env["EAST_PY_LINT"];
  if (override !== void 0 && override !== "")
    return override;
  let dir = fromDir;
  for (; ; ) {
    for (const candidate of [join(dir, ".venv", "bin", "east-py"), join(dir, ".venv", "Scripts", "east-py.exe")]) {
      if (existsSync(candidate))
        return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir)
      return "east-py";
    dir = parent;
  }
}
var EAST_PY_DEPENDENCY = /elaraai-east-py(?![\w-])|elaraai-east-py-(?:std|io|datascience|cli)(?![\w-])/;
function findEastPyProject(fromDir) {
  let dir = fromDir;
  for (; ; ) {
    const candidate = join(dir, "pyproject.toml");
    if (existsSync(candidate)) {
      try {
        if (EAST_PY_DEPENDENCY.test(readFileSync(candidate, "utf-8")))
          return dir;
      } catch {
      }
    }
    const parent = dirname(dir);
    if (parent === dir)
      return void 0;
    dir = parent;
  }
}
function runEastPyLint(file, content, budgetMs = 4e3) {
  const command = findEastPy(dirname(file));
  let target = file;
  let scratch = null;
  if (content !== void 0) {
    scratch = mkdtempSync(join(tmpdir(), "east-py-lint-"));
    target = join(scratch, basename(file));
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

// ../east-diagnostics/dist/src/python-lsp-proxy.js
import { spawn } from "node:child_process";
import { dirname as dirname2 } from "node:path";
var INITIALIZE_TIMEOUT_MS = 15e3;
var RESTART_BACKOFF_MS = 5e3;
var PythonLspProxy = class {
  options;
  child;
  reader = new FrameReader((message) => this.handle(message));
  nextId = 1;
  ready = false;
  starting;
  lastExitAt = 0;
  lastStderr = "";
  disposed = false;
  /** Documents open on the proxy — what a (re)start replays to the child. */
  open = /* @__PURE__ */ new Map();
  /** path -> the document version the CURRENT child has been sent, by didOpen or didChange. */
  seenByChild = /* @__PURE__ */ new Map();
  /** id -> settle(answered): true when the child replied, false when it went away. */
  pending = /* @__PURE__ */ new Map();
  constructor(options) {
    this.options = options;
  }
  /** Whether a child is up and initialized. */
  get available() {
    return this.ready && this.child !== void 0;
  }
  resolveCommand(fromDir) {
    return (this.options.resolveCommand ?? findEastPy)(fromDir);
  }
  unavailable(reason) {
    this.options.onUnavailable?.(reason);
  }
  /** Start the child if it is not running. Resolves false when it cannot start. */
  async ensure(fromDir) {
    if (this.disposed)
      return false;
    if (this.available)
      return true;
    if (this.starting !== void 0)
      return this.starting;
    if (Date.now() - this.lastExitAt < (this.options.restartBackoffMs ?? RESTART_BACKOFF_MS))
      return false;
    this.starting = this.start(fromDir).finally(() => {
      this.starting = void 0;
    });
    return this.starting;
  }
  async start(fromDir) {
    const command = this.resolveCommand(fromDir);
    let child;
    try {
      const spawnChild = this.options.spawnChild ?? ((c, a) => spawn(c, a, { stdio: "pipe" }));
      child = spawnChild(command, ["lsp"]);
    } catch (error) {
      this.lastExitAt = Date.now();
      this.unavailable(`could not spawn \`${command} lsp\`: ${error.message}`);
      return false;
    }
    this.child = child;
    this.reader.reset();
    this.seenByChild.clear();
    this.lastStderr = "";
    child.on("error", (error) => {
      this.lastStderr = error.message;
      this.handleExit(child);
    });
    child.on("exit", () => {
      const grace = setTimeout(() => this.handleExit(child), 250);
      grace.unref?.();
    });
    child.on("close", () => this.handleExit(child));
    child.stdout.on("data", (chunk) => {
      if (child === this.child)
        this.reader.push(chunk);
    });
    let stderrRest = "";
    child.stderr.on("data", (chunk) => {
      stderrRest += chunk.toString("utf8");
      const lines = stderrRest.split(/\r?\n/);
      stderrRest = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim() === "")
          continue;
        this.lastStderr = line;
        (this.options.onStderr ?? ((l) => process.stderr.write(`[east-py lsp] ${l}
`)))(line);
      }
    });
    for (const handle of [child, child.stdout, child.stderr, child.stdin]) {
      const unref = handle.unref;
      if (typeof unref === "function")
        unref.call(handle);
    }
    const id = this.nextId++;
    const initialized = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), this.options.initializeTimeoutMs ?? INITIALIZE_TIMEOUT_MS);
      this.pending.set(id, (answered) => {
        clearTimeout(timer);
        resolve(answered);
      });
    });
    this.write({ jsonrpc: "2.0", id, method: "initialize", params: { processId: process.pid, rootUri: null, capabilities: {} } });
    const ok = await initialized;
    if (!ok) {
      const alive = child === this.child;
      const why = this.lastStderr !== "" ? this.lastStderr : alive ? `no initialize reply within ${this.options.initializeTimeoutMs ?? INITIALIZE_TIMEOUT_MS} ms` : "exited during the handshake";
      this.handleExit(child);
      this.unavailable(`\`${command} lsp\` did not start: ${why}`);
      return false;
    }
    this.write({ jsonrpc: "2.0", method: "initialized", params: {} });
    this.ready = true;
    for (const [path, doc] of this.open) {
      this.write({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: doc.uri, languageId: "python", version: doc.version, text: doc.text } } });
      this.seenByChild.set(path, doc.version);
    }
    return true;
  }
  handleExit(child) {
    if (child !== this.child)
      return;
    this.child = void 0;
    this.ready = false;
    this.seenByChild.clear();
    this.lastExitAt = Date.now();
    child.removeAllListeners();
    try {
      child.kill();
    } catch {
    }
    for (const stream of [child.stdout, child.stderr, child.stdin]) {
      try {
        stream.destroy();
      } catch {
      }
    }
    for (const settle of this.pending.values())
      settle(false);
    this.pending.clear();
  }
  write(message) {
    const child = this.child;
    if (child === void 0 || child.stdin.destroyed)
      return;
    try {
      child.stdin.write(frame(message));
    } catch {
      this.handleExit(child);
    }
  }
  handle(message) {
    if (message.id !== void 0 && message.id !== null && message.method === void 0) {
      const settle = this.pending.get(message.id);
      if (settle !== void 0) {
        this.pending.delete(message.id);
        settle(true);
      }
      return;
    }
    if (message.method === "textDocument/publishDiagnostics") {
      const uri = message.params?.uri;
      if (typeof uri === "string") {
        this.options.onDiagnostics(uri, message.params?.diagnostics ?? []);
      }
    }
  }
  /**
   * Bring the child up to `doc`: a didOpen when this child has not seen the
   * document, a didChange when it has an older version, nothing when a start
   * just replayed exactly this version.
   */
  deliver(path, doc) {
    const delivered = this.seenByChild.get(path);
    if (delivered === doc.version)
      return;
    if (delivered === void 0) {
      this.write({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: doc.uri, languageId: "python", version: doc.version, text: doc.text } } });
    } else {
      this.write({ jsonrpc: "2.0", method: "textDocument/didChange", params: { textDocument: { uri: doc.uri, version: doc.version }, contentChanges: [{ text: doc.text }] } });
    }
    this.seenByChild.set(path, doc.version);
  }
  /** Forward an opened document, starting the child if needed. */
  async didOpen(path, uri, text) {
    const doc = { uri, text, version: 1 };
    this.open.set(path, doc);
    if (!await this.ensure(dirname2(path)))
      return;
    this.deliver(path, doc);
  }
  /** Forward a change. */
  async didChange(path, uri, text) {
    const known = this.open.get(path);
    const doc = { uri, text, version: (known?.version ?? 0) + 1 };
    this.open.set(path, doc);
    if (!await this.ensure(dirname2(path)))
      return;
    this.deliver(path, doc);
  }
  /** Forward a save — the moment the build tier runs without waiting. */
  async didSave(path, uri, text) {
    const known = this.open.get(path);
    const doc = { uri, text, version: known?.version ?? 1 };
    this.open.set(path, doc);
    if (!await this.ensure(dirname2(path)))
      return;
    this.deliver(path, doc);
    this.write({ jsonrpc: "2.0", method: "textDocument/didSave", params: { textDocument: { uri }, text } });
  }
  /** Forward a close. */
  didClose(path, uri) {
    this.open.delete(path);
    if (!this.available || !this.seenByChild.has(path))
      return;
    this.seenByChild.delete(path);
    this.write({ jsonrpc: "2.0", method: "textDocument/didClose", params: { textDocument: { uri } } });
  }
  /** Stop the child. */
  dispose() {
    this.disposed = true;
    this.open.clear();
    const child = this.child;
    if (child !== void 0)
      this.handleExit(child);
  }
};

// ../east-diagnostics/dist/src/python-lsp-server.js
import { readFileSync as readFileSync2 } from "node:fs";
import { dirname as dirname3 } from "node:path";
import { fileURLToPath } from "node:url";
var LINT_DEBOUNCE_MS = 100;
var SEVERITY = { error: 1, warning: 2, suggestion: 3 };
function uriToPath(uri) {
  if (!uri.startsWith("file://"))
    return void 0;
  try {
    return fileURLToPath(uri);
  } catch {
    return void 0;
  }
}
function toDiagnostic(record) {
  const endLine = record.end_line ?? record.line;
  const endColumn = record.end_column ?? record.column + 1;
  return {
    range: {
      start: { line: record.line - 1, character: Math.max(record.column - 1, 0) },
      end: { line: endLine - 1, character: Math.max(endColumn - 1, 0) }
    },
    severity: SEVERITY[record.category] ?? 1,
    code: record.code,
    source: "east-py",
    message: `${record.message} [${record.rule}]`
  };
}
function isEastPythonProject(fromDir) {
  const override = process.env["EAST_PY_LINT"];
  if (override !== void 0 && override !== "")
    return true;
  if (findEastPyProject(fromDir) !== void 0)
    return true;
  const command = findEastPy(fromDir);
  return command !== "east-py";
}
function runEastPyLsp(options = {}) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const exit = options.exit ?? ((code) => process.exit(code));
  const log = options.log ?? ((line) => process.stderr.write(`[east-py] ${line}
`));
  const inProject = options.eastPythonProject ?? isEastPythonProject;
  const lint = options.lint ?? runEastPyLint;
  const open = /* @__PURE__ */ new Map();
  const pendingLint = /* @__PURE__ */ new Map();
  const gated = /* @__PURE__ */ new Map();
  let mode = "child";
  let shuttingDown = false;
  let disposed = false;
  function send(message) {
    output.write(frame(message));
  }
  function publish(uri, diagnostics) {
    send({ method: "textDocument/publishDiagnostics", params: { uri, diagnostics } });
  }
  const python = new PythonLspProxy({
    onDiagnostics: publish,
    onStderr: (line) => log(`east-py lsp: ${line}`),
    onUnavailable: (reason) => {
      if (mode === "lint")
        return;
      mode = "lint";
      log(`${reason} \u2014 falling back to \`east-py lint\` per change; the build tier is off until it starts (east-py lsp --probe says why)`);
      for (const [path, doc] of open)
        lintLater(path, doc.uri);
    },
    ...options.resolveCommand !== void 0 ? { resolveCommand: options.resolveCommand } : {},
    ...options.spawnChild !== void 0 ? { spawnChild: options.spawnChild } : {},
    ...options.initializeTimeoutMs !== void 0 ? { initializeTimeoutMs: options.initializeTimeoutMs } : {},
    ...options.restartBackoffMs !== void 0 ? { restartBackoffMs: options.restartBackoffMs } : {}
  });
  function lintLater(path, uri) {
    const existing = pendingLint.get(path);
    if (existing !== void 0)
      clearTimeout(existing);
    pendingLint.set(path, setTimeout(() => {
      pendingLint.delete(path);
      const doc = open.get(path);
      if (doc === void 0)
        return;
      void lint(path, doc.text).then((records) => {
        if (records === null || open.get(path) !== doc)
          return;
        publish(uri, records.map(toDiagnostic));
      });
    }, LINT_DEBOUNCE_MS));
  }
  function ours(path, text) {
    if (!path.endsWith(".py") || !PYTHON_EAST_IMPORT.test(text))
      return false;
    const dir = dirname3(path);
    let verdict = gated.get(dir);
    if (verdict === void 0) {
      verdict = inProject(dir);
      gated.set(dir, verdict);
      if (!verdict)
        log(`${dir} is not an east-py project (no pyproject.toml above it depends on elaraai-east-py, no .venv east-py, no EAST_PY_LINT): python diagnostics stay idle there`);
    }
    return verdict;
  }
  function forward(kind, path, uri, text) {
    if (!ours(path, text)) {
      const was = open.get(path);
      open.delete(path);
      if (was !== void 0 && mode === "child")
        python.didClose(path, uri);
      publish(uri, []);
      return;
    }
    open.set(path, { uri, text });
    if (mode === "lint") {
      lintLater(path, uri);
      return;
    }
    void (kind === "open" ? python.didOpen(path, uri, text) : kind === "save" ? python.didSave(path, uri, text) : python.didChange(path, uri, text));
  }
  function readSource(path) {
    try {
      return readFileSync2(path, "utf-8");
    } catch {
      return void 0;
    }
  }
  function handle(message) {
    const { method, id, params } = message;
    if (method === void 0)
      return;
    switch (method) {
      case "initialize":
        send({
          id,
          result: {
            capabilities: {
              textDocumentSync: { openClose: true, change: 1, save: { includeText: true } }
            },
            serverInfo: { name: "east-py-diagnostics" }
          }
        });
        return;
      case "initialized":
        return;
      case "shutdown":
        shuttingDown = true;
        send({ id, result: null });
        return;
      case "exit":
        shutdown(shuttingDown ? 0 : 1);
        return;
      case "textDocument/didOpen": {
        const path = uriToPath(params?.textDocument?.uri ?? "");
        const text = params?.textDocument?.text;
        if (path === void 0 || typeof text !== "string")
          return;
        forward("open", path, params.textDocument.uri, text);
        return;
      }
      case "textDocument/didChange": {
        const path = uriToPath(params?.textDocument?.uri ?? "");
        const text = params?.contentChanges?.at?.(-1)?.text;
        if (path === void 0 || typeof text !== "string")
          return;
        forward("change", path, params.textDocument.uri, text);
        return;
      }
      case "textDocument/didSave": {
        const path = uriToPath(params?.textDocument?.uri ?? "");
        if (path === void 0)
          return;
        const text = typeof params?.text === "string" ? params.text : open.get(path)?.text ?? readSource(path);
        if (text === void 0)
          return;
        forward("save", path, params.textDocument.uri, text);
        return;
      }
      case "textDocument/didClose": {
        const uri = params?.textDocument?.uri ?? "";
        const path = uriToPath(uri);
        if (path === void 0)
          return;
        const timer = pendingLint.get(path);
        if (timer !== void 0)
          clearTimeout(timer);
        pendingLint.delete(path);
        if (open.delete(path) && mode === "child")
          python.didClose(path, uri);
        publish(uri, []);
        return;
      }
      default:
        if (id !== void 0) {
          send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
        }
        return;
    }
  }
  const reader = new FrameReader(handle);
  input.on("data", (chunk) => reader.push(chunk));
  const shutdown = (code) => {
    if (disposed)
      return;
    disposed = true;
    for (const timer of pendingLint.values())
      clearTimeout(timer);
    pendingLint.clear();
    python.dispose();
    exit(code);
  };
  input.on("close", () => shutdown(0));
  input.on("end", () => shutdown(0));
}

// daemon/east-py-lsp.ts
runEastPyLsp();
