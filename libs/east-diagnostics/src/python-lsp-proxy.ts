/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname } from "node:path";
import { findEastPy } from "./python-lint.js";
import { frame, FrameReader, type JsonRpcMessage } from "./jsonrpc-stdio.js";

// One persistent `east-py lsp` child, proxied (#681).
//
// The build check (#653) imports the module, and a process per check pays that
// import every time: measured here, 0.12s for a module whose dependencies
// import lazily and 0.81s for one importing torch at module scope, against
// 0.0003s to re-check in a process that already holds them. So the python
// server stays warm, and this class owns it: started lazily by the first
// document, verified by its `initialize` reply, restarted after a crash once
// the backoff has elapsed with every open document replayed, and killed when
// its owner goes away — on the handshake timeout too, so a child that will not
// answer is never left running.
//
// Every method is safe to call when no child is running: the proxy stays
// silent rather than erroring. A START that fails — no command, no reply, a
// child that dies during the handshake — is reported through `onUnavailable`
// with the reason, so the owner can fall back (the python launcher drops to a
// cold `east-py lint` per change) instead of hiding the cause.

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
  /** Called when a start fails, with the reason — the owner's cue to fall back. */
  onUnavailable?: (reason: string) => void;
  /** Called with each line the child writes to stderr; defaults to this process's stderr. */
  onStderr?: (line: string) => void;
  /** Resolve the `east-py` command for a file's directory; defaults to `findEastPy`. */
  resolveCommand?: (fromDir: string) => string;
  /** Spawn override, for tests. */
  spawnChild?: (command: string, args: string[]) => ChildProcessWithoutNullStreams;
  /** How long to wait for `initialize`; defaults to 15 s. */
  initializeTimeoutMs?: number;
  /** How long to wait after a crash before respawning; defaults to 5 s. */
  restartBackoffMs?: number;
}

interface OpenDocument {
  uri: string;
  text: string;
  version: number;
}

/**
 * Owns one long-lived `east-py lsp` process and forwards `.py` documents to it.
 */
export class PythonLspProxy {
  private child: ChildProcessWithoutNullStreams | undefined;
  private readonly reader = new FrameReader((message) => this.handle(message));
  private nextId = 1;
  private ready = false;
  private starting: Promise<boolean> | undefined;
  private lastExitAt = 0;
  private lastStderr = "";
  private disposed = false;
  /** Documents open on the proxy — what a (re)start replays to the child. */
  private readonly open = new Map<string, OpenDocument>();
  /** path -> the document version the CURRENT child has been sent, by didOpen or didChange. */
  private readonly seenByChild = new Map<string, number>();
  /** id -> settle(answered): true when the child replied, false when it went away. */
  private readonly pending = new Map<number | string, (answered: boolean) => void>();

  constructor(private readonly options: PythonLspProxyOptions) {}

  /** Whether a child is up and initialized. */
  get available(): boolean {
    return this.ready && this.child !== undefined;
  }

  private resolveCommand(fromDir: string): string {
    return (this.options.resolveCommand ?? findEastPy)(fromDir);
  }

  private unavailable(reason: string): void {
    this.options.onUnavailable?.(reason);
  }

  /** Start the child if it is not running. Resolves false when it cannot start. */
  private async ensure(fromDir: string): Promise<boolean> {
    if (this.disposed) return false;
    if (this.available) return true;
    if (this.starting !== undefined) return this.starting;
    if (Date.now() - this.lastExitAt < (this.options.restartBackoffMs ?? RESTART_BACKOFF_MS)) return false;

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
    } catch (error) {
      this.lastExitAt = Date.now();
      this.unavailable(`could not spawn \`${command} lsp\`: ${(error as Error).message}`);
      return false;
    }
    this.child = child;
    this.reader.reset();
    this.seenByChild.clear();
    this.lastStderr = "";

    child.on("error", (error: Error) => {
      // A spawn failure surfaces here, asynchronously — ENOENT for a command
      // that is not there. The handshake below is what reports it.
      this.lastStderr = error.message;
      this.handleExit(child);
    });
    // `close` follows `exit` once the stdio pipes have drained, so the child's
    // last words on stderr (why it could not start) are read before the
    // bookkeeping is cleared; `exit` alone would race them. The grace timer is
    // for a child whose pipes never close.
    child.on("exit", () => {
      const grace = setTimeout(() => this.handleExit(child), 250);
      (grace as { unref?: () => void }).unref?.();
    });
    child.on("close", () => this.handleExit(child));
    child.stdout.on("data", (chunk: Buffer) => {
      if (child === this.child) this.reader.push(chunk);
    });
    // The child's stderr is where it says WHY it cannot start (a missing pygls
    // says so there): keep the last line for the failure report and pass every
    // line on, so a log of this process shows the cause.
    let stderrRest = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderrRest += chunk.toString("utf8");
      const lines = stderrRest.split(/\r?\n/);
      stderrRest = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim() === "") continue;
        this.lastStderr = line;
        (this.options.onStderr ?? ((l: string) => process.stderr.write(`[east-py lsp] ${l}\n`)))(line);
      }
    });
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
    // The resolver takes the OUTCOME: `handleExit` settles every pending entry
    // as failure so a dying child never hangs the caller and never leaves
    // `ready` true with no child attached.
    const initialized = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), this.options.initializeTimeoutMs ?? INITIALIZE_TIMEOUT_MS);
      this.pending.set(id, (answered: boolean) => {
        clearTimeout(timer);
        resolve(answered);
      });
    });
    this.write({ jsonrpc: "2.0", id, method: "initialize", params: { processId: process.pid, rootUri: null, capabilities: {} } });
    const ok = await initialized;
    if (!ok) {
      const alive = child === this.child;
      const why = this.lastStderr !== ""
        ? this.lastStderr
        : alive ? `no initialize reply within ${this.options.initializeTimeoutMs ?? INITIALIZE_TIMEOUT_MS} ms` : "exited during the handshake";
      // A child that never answered is still running: kill it, or it lives on
      // beside its replacement.
      this.handleExit(child);
      this.unavailable(`\`${command} lsp\` did not start: ${why}`);
      return false;
    }
    this.write({ jsonrpc: "2.0", method: "initialized", params: {} });
    this.ready = true;
    // Every document open on the proxy is opened on THIS child — a first start
    // and a restart alike, since the child has seen nothing either way. The
    // caller that triggered the start finds its document already open and
    // sends what it meant to send (a change, a save) rather than a second open.
    for (const [path, doc] of this.open) {
      this.write({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: doc.uri, languageId: "python", version: doc.version, text: doc.text } } });
      this.seenByChild.set(path, doc.version);
    }
    return true;
  }

  private handleExit(child: ChildProcessWithoutNullStreams): void {
    // Only the child we currently own: a late `exit` from one already replaced
    // must not clear the fresh one's bookkeeping.
    if (child !== this.child) return;
    this.child = undefined;
    this.ready = false;
    this.seenByChild.clear();
    this.lastExitAt = Date.now();
    child.removeAllListeners();
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
    for (const settle of this.pending.values()) settle(false);
    this.pending.clear();
  }

  private write(message: JsonRpcMessage): void {
    const child = this.child;
    if (child === undefined || child.stdin.destroyed) return;
    try {
      child.stdin.write(frame(message));
    } catch {
      this.handleExit(child);
    }
  }

  private handle(message: JsonRpcMessage): void {
    if (message.id !== undefined && message.id !== null && message.method === undefined) {
      const settle = this.pending.get(message.id);
      if (settle !== undefined) {
        this.pending.delete(message.id);
        settle(true);
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

  /**
   * Bring the child up to `doc`: a didOpen when this child has not seen the
   * document, a didChange when it has an older version, nothing when a start
   * just replayed exactly this version.
   */
  private deliver(path: string, doc: OpenDocument): void {
    const delivered = this.seenByChild.get(path);
    if (delivered === doc.version) return;
    if (delivered === undefined) {
      this.write({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: doc.uri, languageId: "python", version: doc.version, text: doc.text } } });
    } else {
      this.write({ jsonrpc: "2.0", method: "textDocument/didChange", params: { textDocument: { uri: doc.uri, version: doc.version }, contentChanges: [{ text: doc.text }] } });
    }
    this.seenByChild.set(path, doc.version);
  }

  /** Forward an opened document, starting the child if needed. */
  async didOpen(path: string, uri: string, text: string): Promise<void> {
    const doc: OpenDocument = { uri, text, version: 1 };
    this.open.set(path, doc);
    if (!(await this.ensure(dirname(path)))) return;
    this.deliver(path, doc);
  }

  /** Forward a change. */
  async didChange(path: string, uri: string, text: string): Promise<void> {
    const known = this.open.get(path);
    const doc: OpenDocument = { uri, text, version: (known?.version ?? 0) + 1 };
    this.open.set(path, doc);
    if (!(await this.ensure(dirname(path)))) return;
    this.deliver(path, doc);
  }

  /** Forward a save — the moment the build tier runs without waiting. */
  async didSave(path: string, uri: string, text: string): Promise<void> {
    const known = this.open.get(path);
    const doc: OpenDocument = { uri, text, version: known?.version ?? 1 };
    this.open.set(path, doc);
    if (!(await this.ensure(dirname(path)))) return;
    this.deliver(path, doc);
    this.write({ jsonrpc: "2.0", method: "textDocument/didSave", params: { textDocument: { uri }, text } });
  }

  /** Forward a close. */
  didClose(path: string, uri: string): void {
    this.open.delete(path);
    if (!this.available || !this.seenByChild.has(path)) return;
    this.seenByChild.delete(path);
    this.write({ jsonrpc: "2.0", method: "textDocument/didClose", params: { textDocument: { uri } } });
  }

  /** Stop the child. */
  dispose(): void {
    this.disposed = true;
    this.open.clear();
    const child = this.child;
    if (child !== undefined) this.handleExit(child);
  }
}
