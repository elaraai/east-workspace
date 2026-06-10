/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDiagnosticsService, type DiagnosticsService } from "./service.js";
import type { EastDiagnosticCategory } from "./types.js";

// Minimal LSP server over stdio: full-document sync in, publishDiagnostics
// out, everything backed by the shared DiagnosticsService. Hand-rolled
// JSON-RPC framing keeps the package dependency-free.

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: any;
  result?: unknown;
  error?: { code: number; message: string };
}

const EAST_IMPORT_PATTERN = /@elaraai\//;
// Vendored / built / generated trees: never diagnose code the user doesn't own.
const SKIP_PATH = /[/\\](node_modules|dist|build|\.venv|\.git)[/\\]/;
const DEBOUNCE_MS = 100;

const SEVERITY: Record<EastDiagnosticCategory, number> = {
  error: 1,
  warning: 2,
  suggestion: 3,
};

function lineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function offsetToPosition(starts: number[], offset: number): { line: number; character: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low, character: offset - starts[low]! };
}

function uriToPath(uri: string): string | undefined {
  if (!uri.startsWith("file://")) return undefined;
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

export interface EastLspOptions {
  service?: DiagnosticsService;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** Called on `exit`; defaults to `process.exit`. */
  exit?: (code: number) => void;
}

/** Run the East LSP server until the client disconnects. */
export function runEastLsp(options: EastLspOptions = {}): void {
  const service = options.service ?? createDiagnosticsService();
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  // path -> current buffer content (mirrors the service overlay).
  const open = new Map<string, string>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  let shuttingDown = false;

  function send(message: object): void {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    output.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  function publish(path: string): void {
    const content = open.get(path) ?? (() => {
      try {
        return readFileSync(path, "utf-8");
      } catch {
        return undefined;
      }
    })();
    let diagnostics: object[] = [];
    if (content !== undefined && !SKIP_PATH.test(path) && EAST_IMPORT_PATTERN.test(content)) {
      const starts = lineStarts(content);
      diagnostics = service.diagnose(path).map((d) => ({
        range: {
          start: offsetToPosition(starts, d.start),
          end: offsetToPosition(starts, d.start + d.length),
        },
        severity: SEVERITY[d.category],
        code: d.ruleName === "tsc" ? `TS${d.code}` : d.ruleName,
        source: "east",
        message: d.messageText,
      }));
    }
    send({ method: "textDocument/publishDiagnostics", params: { uri: `file://${path}`, diagnostics } });
  }

  function schedule(path: string): void {
    const existing = pending.get(path);
    if (existing !== undefined) clearTimeout(existing);
    pending.set(path, setTimeout(() => {
      pending.delete(path);
      try {
        publish(path);
      } catch {
        // Never let a diagnose failure kill the server.
      }
    }, DEBOUNCE_MS));
  }

  function handle(message: JsonRpcMessage): void {
    const { method, id, params } = message;
    if (method === undefined) return; // a response — we send no requests

    switch (method) {
      case "initialize": {
        const folders: string[] = [];
        const root = params?.rootUri ?? params?.rootPath;
        if (typeof root === "string") {
          const p = root.startsWith("file://") ? uriToPath(root) : root;
          if (p !== undefined) folders.push(p);
        }
        for (const f of params?.workspaceFolders ?? []) {
          const p = uriToPath(f?.uri ?? "");
          if (p !== undefined) folders.push(p);
        }
        send({
          id,
          result: {
            capabilities: {
              textDocumentSync: { openClose: true, change: 1, save: { includeText: true } },
            },
            serverInfo: { name: "east-diagnostics" },
          },
        });
        // Warm off the request path so initialize returns immediately.
        setImmediate(() => {
          for (const folder of folders) {
            try {
              service.warm(folder);
            } catch {
              /* best-effort warm */
            }
          }
        });
        return;
      }
      case "initialized":
        return;
      case "shutdown":
        shuttingDown = true;
        send({ id, result: null });
        return;
      case "exit":
        exit(shuttingDown ? 0 : 1);
        return;
      case "textDocument/didOpen": {
        const path = uriToPath(params?.textDocument?.uri ?? "");
        const text = params?.textDocument?.text;
        if (path === undefined || typeof text !== "string") return;
        open.set(path, text);
        service.setOverlay(path, text);
        schedule(path);
        return;
      }
      case "textDocument/didChange": {
        const path = uriToPath(params?.textDocument?.uri ?? "");
        const text = params?.contentChanges?.at?.(-1)?.text;
        if (path === undefined || typeof text !== "string") return;
        open.set(path, text);
        service.setOverlay(path, text);
        schedule(path);
        return;
      }
      case "textDocument/didSave": {
        const path = uriToPath(params?.textDocument?.uri ?? "");
        if (path === undefined) return;
        const text = params?.text;
        if (typeof text === "string") {
          open.set(path, text);
          service.setOverlay(path, text);
        } else {
          open.delete(path);
          service.clearOverlay(path);
        }
        schedule(path);
        return;
      }
      case "textDocument/didClose": {
        const path = uriToPath(params?.textDocument?.uri ?? "");
        if (path === undefined) return;
        open.delete(path);
        service.clearOverlay(path);
        const timer = pending.get(path);
        if (timer !== undefined) clearTimeout(timer);
        pending.delete(path);
        send({ method: "textDocument/publishDiagnostics", params: { uri: `file://${path}`, diagnostics: [] } });
        return;
      }
      default:
        if (id !== undefined) {
          send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
        }
        return;
    }
  }

  // Content-Length framed reader.
  let buffer = Buffer.alloc(0);
  input.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (match === null) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) return;
      const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      buffer = buffer.subarray(bodyStart + length);
      try {
        handle(JSON.parse(body) as JsonRpcMessage);
      } catch {
        // Malformed frame — skip it rather than dying mid-session.
      }
    }
  });
  input.on("close", () => exit(0));
  input.on("end", () => exit(0));
}
