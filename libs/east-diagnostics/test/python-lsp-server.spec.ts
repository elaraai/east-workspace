/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { runEastPyLsp, type EastPyLspOptions } from "../src/python-lsp-server.js";
import { isEastPythonProject } from "../src/python-lsp-server.js";

// The python language server the plugin registers for `.py` (#681): a launcher
// that gates on the project, runs the project's `east-py lsp`, and falls back
// to a cold `east-py lint` when that server cannot start. The stand-in
// `east-py` is a shell script with both personalities.

const STAND_IN = join(process.cwd(), "test-fixtures", "fake-east-py.sh");
const EAST_SOURCE = "from east import East, IntegerType\n\n@East.function([IntegerType], IntegerType)\ndef halve(b, x):\n    return x // 2\n";

interface LspMessage { id?: number; method?: string; params?: any; result?: any; error?: any }

function startServer(options: EastPyLspOptions = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages: LspMessage[] = [];
  const logged: string[] = [];
  let buffer = Buffer.alloc(0);
  output.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString("utf8"))?.[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) return;
      messages.push(JSON.parse(buffer.subarray(bodyStart, bodyStart + length).toString("utf8")) as LspMessage);
      buffer = buffer.subarray(bodyStart + length);
    }
  });
  runEastPyLsp({ input, output, exit: () => undefined, log: (line) => logged.push(line), ...options });

  function send(message: object): void {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    input.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }
  async function waitFor(predicate: (m: LspMessage) => boolean, fromIndex = 0, timeoutMs = 30_000): Promise<{ message: LspMessage; index: number }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (let i = fromIndex; i < messages.length; i++) {
        if (predicate(messages[i]!)) return { message: messages[i]!, index: i };
      }
      if (Date.now() > deadline) throw new Error(`timed out; saw: ${JSON.stringify(messages.map((m) => m.method ?? m.id))}; log: ${logged.join(" | ")}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  return { send, waitFor, messages, logged, dispose: () => input.end() };
}

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "east-py-lsp-"));
  writeFileSync(join(dir, "pyproject.toml"), '[project]\nname = "demo"\ndependencies = ["elaraai-east-py"]\n');
  return dir;
}

async function initialize(server: ReturnType<typeof startServer>): Promise<void> {
  server.send({ id: 1, method: "initialize", params: { capabilities: {} } });
  const init = await server.waitFor((m) => m.id === 1);
  assert.ok(init.message.result.capabilities.textDocumentSync.openClose);
}

test("a python East document in an east-py project is served by the warm `east-py lsp` child", async () => {
  const dir = project();
  const saved = process.env["FAKE_EAST_PY_MODE"];
  process.env["FAKE_EAST_PY_MODE"] = "lsp-ok";
  const server = startServer({ resolveCommand: () => STAND_IN });
  try {
    await initialize(server);
    const file = join(dir, "mod.py");
    const uri = pathToFileURL(file).href;
    server.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "python", version: 1, text: EAST_SOURCE } } });
    const publish = await server.waitFor((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri && m.params.diagnostics.length > 0);
    const [d] = publish.message.params.diagnostics;
    assert.equal(d.code, "no-operator-fork", "the child's own diagnostic, forwarded");
    assert.equal(d.source, "east-py");
    assert.deepEqual(d.range, { start: { line: 4, character: 11 }, end: { line: 4, character: 17 } });
  } finally {
    server.dispose();
    if (saved === undefined) delete process.env["FAKE_EAST_PY_MODE"]; else process.env["FAKE_EAST_PY_MODE"] = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("when `east-py lsp` cannot start, the rules still arrive through a cold `east-py lint`", async () => {
  const dir = project();
  const saved = process.env["FAKE_EAST_PY_MODE"];
  process.env["FAKE_EAST_PY_MODE"] = "lsp-dead";
  const server = startServer({ resolveCommand: () => STAND_IN, initializeTimeoutMs: 2_000 });
  try {
    await initialize(server);
    const file = join(dir, "mod.py");
    const uri = pathToFileURL(file).href;
    server.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "python", version: 1, text: EAST_SOURCE } } });
    const publish = await server.waitFor((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri && m.params.diagnostics.length > 0);
    const [d] = publish.message.params.diagnostics;
    assert.equal(d.code, "EAS002", "the lint record, in the shape the server would have published");
    assert.match(d.message, /no-operator-fork/);
    assert.deepEqual(d.range, { start: { line: 4, character: 11 }, end: { line: 4, character: 17 } });
    assert.ok(server.logged.some((l) => /did not start/.test(l) && /pygls/.test(l)), `the reason is logged: ${server.logged.join(" | ")}`);
    // a change keeps flowing through the fallback
    server.send({ method: "textDocument/didChange", params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: EAST_SOURCE + "\n" }] } });
    await server.waitFor((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri && m.params.diagnostics.length > 0, publish.index + 1);
  } finally {
    server.dispose();
    if (saved === undefined) delete process.env["FAKE_EAST_PY_MODE"]; else process.env["FAKE_EAST_PY_MODE"] = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("outside an east-py project nothing is spawned and nothing is claimed", async () => {
  let spawns = 0;
  const server = startServer({
    eastPythonProject: () => false,
    spawnChild: () => { spawns += 1; throw new Error("must not spawn"); },
    lint: async () => { spawns += 1; return []; },
  });
  try {
    await initialize(server);
    const uri = pathToFileURL(join(tmpdir(), "elsewhere.py")).href;
    server.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "python", version: 1, text: EAST_SOURCE } } });
    const publish = await server.waitFor((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri);
    assert.deepEqual(publish.message.params.diagnostics, [], "an empty publish: not ours, not a verdict");
    assert.equal(spawns, 0);
    assert.ok(server.logged.some((l) => /not an east-py project/.test(l)));
  } finally {
    server.dispose();
  }
});

test("a python document that does not import east is cleared without reaching the child", async () => {
  const dir = project();
  let spawns = 0;
  const server = startServer({ spawnChild: () => { spawns += 1; throw new Error("must not spawn"); } });
  try {
    await initialize(server);
    const uri = pathToFileURL(join(dir, "plain.py")).href;
    server.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "python", version: 1, text: "def halve(x):\n    return x // 2\n" } } });
    const publish = await server.waitFor((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri);
    assert.deepEqual(publish.message.params.diagnostics, []);
    assert.equal(spawns, 0);
  } finally {
    server.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the project gate: a pyproject above the file that depends on east-py, a venv east-py, or the override", () => {
  const dir = mkdtempSync(join(tmpdir(), "east-py-gate-"));
  const saved = process.env["EAST_PY_LINT"];
  process.env["EAST_PY_LINT"] = "";
  try {
    const member = join(dir, "packages", "member", "src");
    mkdirSync(member, { recursive: true });
    assert.equal(isEastPythonProject(member), false, "nothing declares east-py");
    writeFileSync(join(dir, "packages", "member", "pyproject.toml"), '[project]\nname = "member"\n');
    assert.equal(isEastPythonProject(member), false, "a member pyproject that says nothing is not evidence");
    writeFileSync(join(dir, "pyproject.toml"), '[project]\nname = "root"\ndependencies = ["elaraai-east-py-std>=1"]\n');
    assert.equal(isEastPythonProject(member), true, "the workspace root's declaration counts for every member");
    rmSync(join(dir, "pyproject.toml"));
    mkdirSync(join(dir, ".venv", "bin"), { recursive: true });
    writeFileSync(join(dir, ".venv", "bin", "east-py"), "#!/bin/sh\n");
    assert.equal(isEastPythonProject(member), true, "a resolvable venv east-py is evidence too");
    rmSync(join(dir, ".venv"), { recursive: true, force: true });
    process.env["EAST_PY_LINT"] = "/somewhere/east-py";
    assert.equal(isEastPythonProject(member), true, "the override always is");
  } finally {
    if (saved === undefined) delete process.env["EAST_PY_LINT"]; else process.env["EAST_PY_LINT"] = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
