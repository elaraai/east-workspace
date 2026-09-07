/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { frame, FrameReader, type JsonRpcMessage } from "./jsonrpc-stdio.js";
import {
  findEastPy,
  findEastPyProject,
  PYTHON_EAST_IMPORT,
  runEastPyLint,
  type PythonDiagnostic as LintRecord,
} from "./python-lint.js";
import { PythonLspProxy, type PythonDiagnostic } from "./python-lsp-proxy.js";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

// The python language server the Claude Code plugin registers for `.py` files
// (#681): a launcher around the project's own `east-py lsp`.
//
// It is its own server, beside the TypeScript one, rather than a proxy hidden
// inside it, so each language has its own lifecycle: a python-only project
// never starts the TypeScript service, a TypeScript project never spawns
// python, and a crash in one is the other's business no more than a crash in
// pyright would be. It is a launcher rather than `east-py lsp` itself because
// a manifest can only name a command on PATH or under the plugin root, and the
// right `east-py` lives in the project's venv (`findEastPy`).
//
// What it does for a `.py` document, in order:
//
// 1. Nothing, unless the document imports east AND its directory belongs to an
//    east-py PROJECT — a `pyproject.toml` above it declares an east-py
//    distribution, or `EAST_PY_LINT` names the command outright, or a `.venv`
//    above it has `east-py`. The manifest cannot be conditional, so this
//    process starts for any `.py` file anywhere the plugin is enabled; the gate
//    is what keeps it a silent null server everywhere else. It never claims a
//    file is clean: an empty publish means "not mine".
// 2. Starts ONE `east-py lsp` child — the warm two-tier server — verified by its
//    `initialize` reply, restarted after a crash with the open documents
//    replayed, killed when the client goes away.
// 3. Falls back, when that child cannot START, to what the plugin did before
//    the warm server existed: `east-py lint --format json` as a cold subprocess
//    per debounced change. The rules never disappear because pygls is missing;
//    only the build tier does, and stderr says why.

const LINT_DEBOUNCE_MS = 100;

const SEVERITY: Record<string, number> = { error: 1, warning: 2, suggestion: 3 };

function uriToPath(uri: string): string | undefined {
  if (!uri.startsWith("file://")) return undefined;
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

/** A lint record in the shape `east-py lsp` publishes, so both paths look the same to the client. */
function toDiagnostic(record: LintRecord): PythonDiagnostic {
  const endLine = record.end_line ?? record.line;
  const endColumn = record.end_column ?? record.column + 1;
  return {
    range: {
      start: { line: record.line - 1, character: Math.max(record.column - 1, 0) },
      end: { line: endLine - 1, character: Math.max(endColumn - 1, 0) },
    },
    severity: SEVERITY[record.category] ?? 1,
    code: record.code,
    source: "east-py",
    message: `${record.message} [${record.rule}]`,
  };
}

export interface EastPyLspOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** Called on `exit`; defaults to `process.exit`. */
  exit?: (code: number) => void;
  /** Where the launcher explains itself; defaults to this process's stderr. */
  log?: (line: string) => void;
  /** Whether `fromDir` belongs to an east-py project; defaults to the pyproject / venv / override walk. */
  eastPythonProject?: (fromDir: string) => boolean;
  /** Resolve the `east-py` command for a directory; defaults to `findEastPy`. */
  resolveCommand?: (fromDir: string) => string;
  /** Spawn override for the child, for tests. */
  spawnChild?: (command: string, args: string[]) => ChildProcessWithoutNullStreams;
  /** The cold lint used when the child cannot start; defaults to `runEastPyLint`. */
  lint?: (file: string, content: string | undefined) => Promise<LintRecord[] | null>;
  initializeTimeoutMs?: number;
  restartBackoffMs?: number;
}

/** Whether a directory belongs to a project that uses east-py — the default gate. */
export function isEastPythonProject(fromDir: string): boolean {
  const override = process.env["EAST_PY_LINT"];
  if (override !== undefined && override !== "") return true;
  if (findEastPyProject(fromDir) !== undefined) return true;
  // a resolvable venv east-py is evidence enough, pyproject or not
  const command = findEastPy(fromDir);
  return command !== "east-py";
}

/** Run the python East language server until the client disconnects. */
export function runEastPyLsp(options: EastPyLspOptions = {}): void {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const log = options.log ?? ((line: string) => process.stderr.write(`[east-py] ${line}\n`));
  const inProject = options.eastPythonProject ?? isEastPythonProject;
  const lint = options.lint ?? runEastPyLint;

  // path -> the client's uri and the current buffer
  const open = new Map<string, { uri: string; text: string }>();
  const pendingLint = new Map<string, ReturnType<typeof setTimeout>>();
  const gated = new Map<string, boolean>();
  let mode: "child" | "lint" = "child";
  let shuttingDown = false;
  let disposed = false;

  function send(message: object): void {
    output.write(frame(message));
  }

  function publish(uri: string, diagnostics: PythonDiagnostic[]): void {
    send({ method: "textDocument/publishDiagnostics", params: { uri, diagnostics } });
  }

  const python = new PythonLspProxy({
    onDiagnostics: publish,
    onStderr: (line) => log(`east-py lsp: ${line}`),
    onUnavailable: (reason) => {
      if (mode === "lint") return;
      mode = "lint";
      log(`${reason} — falling back to \`east-py lint\` per change; the build tier is off until it starts (east-py lsp --probe says why)`);
      for (const [path, doc] of open) lintLater(path, doc.uri);
    },
    ...(options.resolveCommand !== undefined ? { resolveCommand: options.resolveCommand } : {}),
    ...(options.spawnChild !== undefined ? { spawnChild: options.spawnChild } : {}),
    ...(options.initializeTimeoutMs !== undefined ? { initializeTimeoutMs: options.initializeTimeoutMs } : {}),
    ...(options.restartBackoffMs !== undefined ? { restartBackoffMs: options.restartBackoffMs } : {}),
  });

  function lintLater(path: string, uri: string): void {
    const existing = pendingLint.get(path);
    if (existing !== undefined) clearTimeout(existing);
    pendingLint.set(path, setTimeout(() => {
      pendingLint.delete(path);
      const doc = open.get(path);
      if (doc === undefined) return;
      void lint(path, doc.text).then((records) => {
        // no east-py answered: say nothing rather than "clean"
        if (records === null || open.get(path) !== doc) return;
        publish(uri, records.map(toDiagnostic));
      });
    }, LINT_DEBOUNCE_MS));
  }

  /** Whether this document is ours: a `.py` that imports east, in an east-py project. */
  function ours(path: string, text: string): boolean {
    if (!path.endsWith(".py") || !PYTHON_EAST_IMPORT.test(text)) return false;
    const dir = dirname(path);
    let verdict = gated.get(dir);
    if (verdict === undefined) {
      verdict = inProject(dir);
      gated.set(dir, verdict);
      if (!verdict) log(`${dir} is not an east-py project (no pyproject.toml above it depends on elaraai-east-py, no .venv east-py, no EAST_PY_LINT): python diagnostics stay idle there`);
    }
    return verdict;
  }

  function forward(kind: "open" | "change" | "save", path: string, uri: string, text: string): void {
    if (!ours(path, text)) {
      const was = open.get(path);
      open.delete(path);
      if (was !== undefined && mode === "child") python.didClose(path, uri);
      publish(uri, []);
      return;
    }
    open.set(path, { uri, text });
    if (mode === "lint") {
      lintLater(path, uri);
      return;
    }
    void (kind === "open" ? python.didOpen(path, uri, text)
      : kind === "save" ? python.didSave(path, uri, text)
        : python.didChange(path, uri, text));
  }

  function readSource(path: string): string | undefined {
    try {
      return readFileSync(path, "utf-8");
    } catch {
      return undefined;
    }
  }

  function handle(message: JsonRpcMessage): void {
    const { method, id, params } = message;
    if (method === undefined) return; // a response — we send no requests to the client

    switch (method) {
      case "initialize":
        send({
          id,
          result: {
            capabilities: {
              textDocumentSync: { openClose: true, change: 1, save: { includeText: true } },
            },
            serverInfo: { name: "east-py-diagnostics" },
          },
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
        if (path === undefined || typeof text !== "string") return;
        forward("open", path, params.textDocument.uri, text);
        return;
      }
      case "textDocument/didChange": {
        const path = uriToPath(params?.textDocument?.uri ?? "");
        const text = params?.contentChanges?.at?.(-1)?.text;
        if (path === undefined || typeof text !== "string") return;
        forward("change", path, params.textDocument.uri, text);
        return;
      }
      case "textDocument/didSave": {
        const path = uriToPath(params?.textDocument?.uri ?? "");
        if (path === undefined) return;
        const text = typeof params?.text === "string" ? params.text : (open.get(path)?.text ?? readSource(path));
        if (text === undefined) return;
        forward("save", path, params.textDocument.uri, text);
        return;
      }
      case "textDocument/didClose": {
        const uri: string = params?.textDocument?.uri ?? "";
        const path = uriToPath(uri);
        if (path === undefined) return;
        const timer = pendingLint.get(path);
        if (timer !== undefined) clearTimeout(timer);
        pendingLint.delete(path);
        if (open.delete(path) && mode === "child") python.didClose(path, uri);
        publish(uri, []);
        return;
      }
      default:
        if (id !== undefined) {
          send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
        }
        return;
    }
  }

  const reader = new FrameReader(handle);
  input.on("data", (chunk: Buffer) => reader.push(chunk));

  // The client going away ends the session, and the python child must go with
  // it. Wiring this only to the `exit` MESSAGE is not enough: a disconnecting
  // client may never send one.
  const shutdown = (code: number): void => {
    if (disposed) return;
    disposed = true;
    for (const timer of pendingLint.values()) clearTimeout(timer);
    pendingLint.clear();
    python.dispose();
    exit(code);
  };
  input.on("close", () => shutdown(0));
  input.on("end", () => shutdown(0));
}
