/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname } from "node:path";
import { findEastPy } from "./python-lint.js";

// A persistent `east-py lsp` child, proxied (#681).
//
// The python path used to shell out to `east-py lint` once per debounced
// change. That is fine for the rules — they are pure `ast` work — but the
// build check (#653) imports the module, and a process per check pays that
// import every time: measured here, 0.12s for a module whose dependencies
// import lazily and 0.81s for one importing torch at module scope, against
// 0.0003s to re-check in a process that already holds them. On save a
// subprocess would do; debounced on change, it would not.
//
// Keeping the child behind this proxy rather than registering `east-py lsp` as
// a second LSP server means venv resolution stays in `findEastPy`, where it
// already walks up to the nearest `.venv` and honours EAST_PY_LINT, and the
// existing "no east-py answered → say nothing" degradation is preserved: a
// child that will not start is simply absent, never a claim that a file is
// clean.

/** How long to wait for the child's `initialize` reply before giving up. */
const INITIALIZE_TIMEOUT_MS = 15_000;
/** Backoff after a crash, so a child that dies on startup is not respawned hot. */
const RESTART_BACKOFF_MS = 5_000;

export interface PythonDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}

export interface PythonLspProxyOptions {
  /** Called when the child publishes diagnostics for a document. */
  onDiagnostics: (uri: string, diagnostics: PythonDiagnostic[]) => void;
  /** Resolve the `east-py` command for a file's directory; defaults to `findEastPy`. */
  resolveCommand?: (fromDir: string) => string;
  /** Spawn override, for tests. */
  spawnChild?: (command: string, args: string[]) => ChildProcessWithoutNullStreams;
}

interface Message {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: any;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Owns one long-lived `east-py lsp` process and forwards `.py` documents to it.
 *
 * Started lazily by the first document, restarted after a crash (once the
 * backoff has elapsed), and stopped on `dispose`. Every method is safe to call
 * when no child is running: the proxy stays silent rather than erroring, which
 * is what keeps a project without east-py working exactly as before.
 */
export class PythonLspProxy {
  private child: ChildProcessWithoutNullStreams | undefined;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private ready = false;
  private starting: Promise<boolean> | undefined;
  private lastExitAt = 0;
  private disposed = false;
  /** Whether a child has been up before — a FIRST start has nothing to replay. */
  private startedBefore = false;
  /** Documents currently open on the child, so a restart can reopen them. */
  private readonly open = new Map<string, { uri: string; text: string; languageId: string }>();

  constructor(private readonly options: PythonLspProxyOptions) {}

  private resolveCommand(fromDir: string): string {
    return (this.options.resolveCommand ?? findEastPy)(fromDir);
  }

  /** Start the child if it is not running. Resolves false when it cannot start. */
  private async ensure(fromDir: string): Promise<boolean> {
    if (this.disposed) return false;
    if (this.ready && this.child !== undefined) return true;
    if (this.starting !== undefined) return this.starting;
    if (Date.now() - this.lastExitAt < RESTART_BACKOFF_MS) return false;

    this.starting = this.start(fromDir).finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async start(fromDir: string): Promise<boolean> {
    const command = this.resolveCommand(fromDir);
    let child: ChildProcessWithoutNullStreams;
    try {
      const spawnChild = this.options.spawnChild ?? ((c, a) => spawn(c, a, { stdio: "pipe" }));
      child = spawnChild(command, ["lsp"]);
    } catch {
      this.lastExitAt = Date.now();
      return false;
    }
    this.child = child;
    this.buffer = Buffer.alloc(0);

    child.on("error", () => this.handleExit());
    child.on("exit", () => this.handleExit());
    child.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
    // The child's stderr is its own business (a missing pygls says so there);
    // draining it keeps the pipe from filling and wedging the process.
    child.stderr.resume();
    // The child must never be what keeps this process alive: a language server
    // exits when its CLIENT goes away. `dispose` (wired to the input stream
    // closing) is the real cleanup; this is the backstop for a child that
    // somehow outlives it.
    // A stray child must be physically unable to hold this process open. The
    // process handle AND its three stdio pipes are separate libuv handles, and
    // the `data` reader above keeps the loop alive on its own — unref every
    // one. (The pipes are Sockets at runtime, which have `unref`; the Readable
    // and Writable types they are declared as do not, hence the guarded call.
    // A test's spawn override may hand back a stand-in with none of them.)
    for (const handle of [child, child.stdout, child.stderr, child.stdin]) {
      const unref = (handle as { unref?: () => void }).unref;
      if (typeof unref === "function") unref.call(handle);
    }

    const id = this.nextId++;
    const initialized = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), INITIALIZE_TIMEOUT_MS);
      this.pending.set(id, () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    this.write({ jsonrpc: "2.0", id, method: "initialize", params: { processId: process.pid, rootUri: null, capabilities: {} } });
    const ok = await initialized;
    if (!ok) {
      this.handleExit();
      return false;
    }
    this.write({ jsonrpc: "2.0", method: "initialized", params: {} });
    this.ready = true;
    // Reopen what was open before a RESTART, so a crash is invisible to the
    // editor. Not on a first start: the document that triggered it is about to
    // be forwarded by its own caller, and replaying it here would open it twice.
    if (this.startedBefore) {
      for (const doc of this.open.values()) {
        this.write({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { ...doc, version: 1 } } });
      }
    }
    this.startedBefore = true;
    return true;
  }

  private readonly pending = new Map<number | string, () => void>();

  private handleExit(): void {
    if (this.child !== undefined) {
      this.child.removeAllListeners();
      this.child = undefined;
    }
    this.ready = false;
    this.lastExitAt = Date.now();
    for (const resolve of this.pending.values()) resolve();
    this.pending.clear();
  }

  private write(message: Message): void {
    const child = this.child;
    if (child === undefined || child.stdin.destroyed) return;
    const body = JSON.stringify(message);
    try {
      child.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
    } catch {
      this.handleExit();
    }
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (match === null) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        this.handle(JSON.parse(body) as Message);
      } catch {
        // A malformed frame from the child is skipped, not fatal.
      }
    }
  }

  private handle(message: Message): void {
    if (message.id !== undefined && message.id !== null && message.method === undefined) {
      const resolve = this.pending.get(message.id);
      if (resolve !== undefined) {
        this.pending.delete(message.id);
        resolve();
      }
      return;
    }
    if (message.method === "textDocument/publishDiagnostics") {
      const uri = message.params?.uri;
      if (typeof uri === "string") {
        this.options.onDiagnostics(uri, (message.params?.diagnostics ?? []) as PythonDiagnostic[]);
      }
    }
  }

  /** Forward an opened document, starting the child if needed. */
  async didOpen(path: string, uri: string, text: string): Promise<void> {
    this.open.set(path, { uri, text, languageId: "python" });
    if (!(await this.ensure(dirname(path)))) return;
    this.write({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "python", version: 1, text } } });
  }

  /** Forward a change. */
  async didChange(path: string, uri: string, text: string): Promise<void> {
    const known = this.open.get(path);
    this.open.set(path, { uri, text, languageId: "python" });
    if (!(await this.ensure(dirname(path)))) return;
    if (known === undefined) {
      this.write({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "python", version: 1, text } } });
      return;
    }
    this.write({ jsonrpc: "2.0", method: "textDocument/didChange", params: { textDocument: { uri, version: 2 }, contentChanges: [{ text }] } });
  }

  /** Forward a save — the moment the build tier runs without waiting. */
  async didSave(path: string, uri: string, text: string): Promise<void> {
    this.open.set(path, { uri, text, languageId: "python" });
    if (!(await this.ensure(dirname(path)))) return;
    this.write({ jsonrpc: "2.0", method: "textDocument/didSave", params: { textDocument: { uri }, text } });
  }

  /** Forward a close. */
  didClose(path: string, uri: string): void {
    this.open.delete(path);
    if (!this.ready) return;
    this.write({ jsonrpc: "2.0", method: "textDocument/didClose", params: { textDocument: { uri } } });
  }

  /** Stop the child. */
  dispose(): void {
    this.disposed = true;
    const child = this.child;
    this.handleExit();
    this.open.clear();
    if (child !== undefined) {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      // Killing the process is not enough to let this one exit: its stdio pipes
      // are their own libuv handles, and the `data` reader on stdout keeps the
      // event loop alive after the child is gone. Destroy them explicitly.
      for (const stream of [child.stdout, child.stderr, child.stdin]) {
        try {
          stream.destroy();
        } catch {
          /* already closed */
        }
      }
    }
  }
}
