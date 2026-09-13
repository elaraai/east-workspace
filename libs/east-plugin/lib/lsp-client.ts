import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Message = { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };
export interface Publication { uri: string; diagnostics: unknown[]; version?: number }
/** A real stdio LSP connection, kept warm for the MCP process lifetime. */
export class EastLspClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer: Buffer = Buffer.alloc(0);
  private nextId = 0;
  private requests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private publications = new Map<string, Publication>();
  private waiters = new Map<string, Set<(publication: Publication | null) => void>>();
  private versions = new Map<string, number>();
  private failure: Error | undefined;
  private stderr = '';
  private closing = false;
  private queue: Promise<unknown> = Promise.resolve();
  readonly ready: Promise<void>;

  constructor(entry: string, cwd: string) {
    this.child = spawn(process.execPath, [entry], { cwd, stdio: 'pipe' });
    this.child.stderr.on('data', (data: Buffer) => { this.stderr = (this.stderr + data.toString()).slice(-4000); });
    this.child.stdout.on('data', (data: Buffer) => this.receive(data));
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', code => this.fail(new Error(`East LSP exited (${code}): ${this.stderr}`)));
    this.ready = this.request('initialize', { processId: process.pid, rootUri: pathToFileURL(cwd).href, capabilities: {} })
      .then(() => { this.send({ method: 'initialized', params: {} }); });
  }
  private fail(error: Error) {
    this.failure = error;
    for (const request of this.requests.values()) request.reject(error);
    this.requests.clear();
    for (const waiters of this.waiters.values()) for (const notify of waiters) notify(null);
    this.waiters.clear();
  }
  private send(message: Message) {
    if (this.failure) throw this.failure;
    const body = JSON.stringify({ jsonrpc: '2.0', ...message });
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }
  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = ++this.nextId;
    return new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => { this.requests.delete(id); reject(new Error(`LSP ${method} timed out`)); this.close(); }, 15000);
      this.requests.set(id, {
        resolve: value => { clearTimeout(timer); resolveResult(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      try { this.send({ id, method, params }); } catch (error) { this.requests.get(id)?.reject(error as Error); this.requests.delete(id); }
    });
  }
  private receive(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const end = this.buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const match = /Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, end).toString());
      if (!match) { this.fail(new Error('Invalid LSP header')); this.close(); return; }
      const length = Number(match[1]);
      if (this.buffer.length < end + 4 + length) return;
      const body = this.buffer.subarray(end + 4, end + 4 + length);
      this.buffer = this.buffer.subarray(end + 4 + length);
      let message: Message;
      try { message = JSON.parse(body.toString()) as Message; } catch { continue; }
      if (message.id !== undefined && !message.method) {
        const pending = this.requests.get(message.id);
        if (message.error) pending?.reject(new Error(JSON.stringify(message.error)));
        else pending?.resolve(message.result);
        this.requests.delete(message.id);
      } else if (message.method === 'textDocument/publishDiagnostics' && typeof message.params?.['uri'] === 'string') {
        const publication = message.params as unknown as Publication;
        // Some servers publish unescaped file URIs; normalize both sides.
        const uri = pathToFileURL(fileURLToPath(publication.uri)).href;
        this.publications.set(uri, publication);
        for (const notify of this.waiters.get(uri) ?? []) notify(publication);
      } else if (message.id !== undefined) {
        this.send({ id: message.id, result: null });
      }
    }
  }
  /** Serialize document operations so concurrent MCP calls cannot mix publications. */
  diagnostics(file: string, timeoutMs: number, refresh = true): Promise<Publication | null> {
    const operation = this.queue.catch(() => {}).then(async () => {
      await this.ready;
      if (this.failure) throw this.failure;
      const path = resolve(file);
      const uri = pathToFileURL(path).href;
      if (!refresh) return this.publications.get(uri) ?? null;
      const text = await readFile(path, 'utf8');
      const version = (this.versions.get(uri) ?? 0) + 1;
      this.publications.delete(uri);
      const result = new Promise<Publication | null>((done) => {
        const listeners = this.waiters.get(uri) ?? new Set();
        let timer: ReturnType<typeof setTimeout>;
        const notify = (publication: Publication | null) => {
          clearTimeout(timer); listeners.delete(notify);
          if (listeners.size === 0) this.waiters.delete(uri);
          done(publication);
        };
        timer = setTimeout(() => notify(null), timeoutMs);
        listeners.add(notify); this.waiters.set(uri, listeners);
      });
      this.versions.set(uri, version);
      if (version === 1) this.send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: path.endsWith('.py') ? 'python' : path.endsWith('.tsx') ? 'typescriptreact' : 'typescript', version, text } } });
      else {
        this.send({ method: 'textDocument/didChange', params: { textDocument: { uri, version }, contentChanges: [{ text }] } });
        this.send({ method: 'textDocument/didSave', params: { textDocument: { uri }, text } });
      }
      return result;
    });
    this.queue = operation;
    return operation;
  }
  close() {
    if (this.closing) return;
    this.closing = true;
    if (this.failure) { this.child.stdin.end(); this.child.kill(); return; }
    // Let the Python launcher dispose its own child before forcing termination.
    const force = setTimeout(() => this.child.kill(), 1000);
    force.unref();
    this.child.once('exit', () => clearTimeout(force));
    void this.request('shutdown', {}).then(() => {
      this.send({ method: 'exit' });
      this.child.stdin.end();
    }).catch(() => { this.child.stdin.end(); this.child.kill(); });
  }
}

export class EastLspPool {
  private clients = new Map<string, EastLspClient>();
  async diagnostics(file: string, timeoutMs = 15000, refresh = true) {
    file = resolve(file);
    if (!/\.(ts|tsx|py)$/.test(file)) throw new Error('East LSP supports .ts, .tsx and .py files');
    let cwd = dirname(file);
    for (let dir = cwd;; dir = dirname(dir)) {
      if (existsSync(join(dir, file.endsWith('.py') ? 'pyproject.toml' : 'tsconfig.json'))) { cwd = dir; break; }
      if (dirname(dir) === dir) break;
    }
    const entry = file.endsWith('.py') ? 'east-py-lsp.js' : 'lsp.js';
    const key = `${cwd}\0${entry}`;
    let client = this.clients.get(key);
    if (!client) {
      client = new EastLspClient(fileURLToPath(new URL(`../daemon/${entry}`, import.meta.url)), cwd);
      this.clients.set(key, client);
    }
    try { return await client.diagnostics(file, timeoutMs, refresh); }
    catch (error) { client.close(); this.clients.delete(key); throw error; }
  }
  close() { for (const client of this.clients.values()) client.close(); this.clients.clear(); }
}
