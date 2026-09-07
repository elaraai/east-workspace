import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { PythonLspProxy } from "../src/python-lsp-proxy.js";

// A stand-in `east-py lsp`: speaks just enough LSP to answer `initialize` and
// to push diagnostics on demand, so the proxy's lifecycle is testable without
// a python toolchain.
class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly received: any[] = [];
  killed = false;
  private buffer = Buffer.alloc(0);

  constructor(private readonly autoInitialize = true) {
    super();
    this.stdin.on("data", (chunk: Buffer) => this.read(chunk));
  }

  private read(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const length = Number(/Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, end).toString())?.[1]);
      if (this.buffer.length < end + 4 + length) return;
      const body = JSON.parse(this.buffer.subarray(end + 4, end + 4 + length).toString());
      this.buffer = this.buffer.subarray(end + 4 + length);
      this.received.push(body);
      if (body.method === "initialize" && this.autoInitialize) {
        this.send({ jsonrpc: "2.0", id: body.id, result: { capabilities: {} } });
      }
    }
  }

  send(message: object): void {
    const body = JSON.stringify(message);
    this.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  kill(): boolean {
    this.killed = true;
    this.die(0);
    return true;
  }

  /** What a real child does: `exit`, then `close` once the pipes drain. */
  die(code: number): void {
    this.emit("exit", code);
    this.emit("close", code);
  }
}

function proxyWith(child: FakeChild, onDiagnostics = (_u: string, _d: unknown[]) => {}) {
  return new PythonLspProxy({
    onDiagnostics: onDiagnostics as never,
    resolveCommand: () => "east-py",
    spawnChild: () => child as never,
  });
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test("the child is started once and reused across documents", async () => {
  const child = new FakeChild();
  let spawns = 0;
  const proxy = new PythonLspProxy({
    onDiagnostics: () => {},
    resolveCommand: () => "east-py",
    spawnChild: () => { spawns += 1; return child as never; },
  });
  await proxy.didOpen("/p/a.py", "file:///p/a.py", "import east\n");
  await proxy.didChange("/p/a.py", "file:///p/a.py", "import east\nx = 1\n");
  await proxy.didOpen("/p/b.py", "file:///p/b.py", "import east\n");
  assert.equal(spawns, 1, "a warm child is the whole point — one process, not one per document");
  const methods = child.received.map((m) => m.method);
  assert.deepEqual(methods, ["initialize", "initialized", "textDocument/didOpen", "textDocument/didChange", "textDocument/didOpen"]);
  proxy.dispose();
});

test("diagnostics the child publishes reach the client with their uri", async () => {
  const child = new FakeChild();
  const seen: Array<{ uri: string; count: number }> = [];
  const proxy = proxyWith(child, (uri, diagnostics) => seen.push({ uri, count: (diagnostics as unknown[]).length }));
  await proxy.didOpen("/p/a.py", "file:///p/a.py", "import east\n");
  child.send({
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: { uri: "file:///p/a.py", diagnostics: [{ range: {}, message: "x" }, { range: {}, message: "y" }] },
  });
  await settle();
  assert.deepEqual(seen, [{ uri: "file:///p/a.py", count: 2 }]);
  proxy.dispose();
});

test("a save is forwarded as a save, so the build tier runs without the debounce", async () => {
  const child = new FakeChild();
  const proxy = proxyWith(child);
  await proxy.didOpen("/p/a.py", "file:///p/a.py", "import east\n");
  await proxy.didSave("/p/a.py", "file:///p/a.py", "import east\n");
  assert.ok(child.received.some((m) => m.method === "textDocument/didSave"));
  proxy.dispose();
});

test("a child that dies during the handshake is a FAILED start, not a ready one", async () => {
  const child = new FakeChild(false);
  const proxy = proxyWith(child);
  const done = proxy.didOpen("/p/a.py", "file:///p/a.py", "import east\n");
  child.die(1); // dies during startup
  await done;
  assert.ok(!child.received.some((m) => m.method === "textDocument/didOpen"),
    "nothing is forwarded to a child that never became ready");
  // `handleExit` settles the pending handshake so the caller is never hung —
  // but settling it as SUCCESS left the proxy believing it was ready, with no
  // child attached, writing into a destroyed pipe.
  assert.ok(!child.received.some((m) => m.method === "initialized"),
    "a dead child must not be sent `initialized`");
  proxy.dispose();
});

test("a crash is backed off rather than respawned hot", async () => {
  let spawns = 0;
  const proxy = new PythonLspProxy({
    onDiagnostics: () => {},
    resolveCommand: () => "east-py",
    spawnChild: () => { spawns += 1; const c = new FakeChild(); queueMicrotask(() => c.die(1)); return c as never; },
  });
  await proxy.didOpen("/p/a.py", "file:///p/a.py", "import east\n");
  await proxy.didChange("/p/a.py", "file:///p/a.py", "import east\nx=1\n");
  await proxy.didChange("/p/a.py", "file:///p/a.py", "import east\nx=2\n");
  assert.equal(spawns, 1, "a child that dies on startup must not be respawned on every keystroke");
  proxy.dispose();
});

test("a child that never answers initialize is killed, not left running beside its replacement", async () => {
  const child = new FakeChild(false);
  const reasons: string[] = [];
  const proxy = new PythonLspProxy({
    onDiagnostics: () => {},
    onUnavailable: (reason) => reasons.push(reason),
    resolveCommand: () => "east-py",
    spawnChild: () => child as never,
    initializeTimeoutMs: 50,
  });
  await proxy.didOpen("/p/a.py", "file:///p/a.py", "import east\n");
  assert.equal(child.killed, true, "the handshake timed out: the child must not outlive the attempt");
  assert.equal(reasons.length, 1);
  assert.match(reasons[0]!, /did not start/);
  proxy.dispose();
});

test("after a failed first start, the next successful start opens the document before changing it", async () => {
  const dead = new FakeChild(false);
  const live = new FakeChild();
  let spawns = 0;
  const proxy = new PythonLspProxy({
    onDiagnostics: () => {},
    resolveCommand: () => "east-py",
    spawnChild: () => (spawns++ === 0 ? dead : live) as never,
    initializeTimeoutMs: 50,
    restartBackoffMs: 0,
  });
  await proxy.didOpen("/p/a.py", "file:///p/a.py", "import east\n");
  assert.equal(live.received.length, 0);
  await proxy.didChange("/p/a.py", "file:///p/a.py", "import east\nx = 1\n");
  const methods = live.received.map((m) => m.method);
  assert.deepEqual(methods, ["initialize", "initialized", "textDocument/didOpen"],
    "the child that never saw the document gets a didOpen, not a didChange for an unknown uri");
  await proxy.didChange("/p/a.py", "file:///p/a.py", "import east\nx = 2\n");
  const change = live.received.at(-1);
  assert.equal(change.method, "textDocument/didChange");
  assert.equal(change.params.textDocument.version, 3, "versions count up per document");
  proxy.dispose();
});

test("dispose kills the child and stops forwarding", async () => {
  const child = new FakeChild();
  const proxy = proxyWith(child);
  await proxy.didOpen("/p/a.py", "file:///p/a.py", "import east\n");
  proxy.dispose();
  assert.equal(child.killed, true);
  const before = child.received.length;
  await proxy.didChange("/p/a.py", "file:///p/a.py", "import east\nx=1\n");
  assert.equal(child.received.length, before, "a disposed proxy forwards nothing");
});
