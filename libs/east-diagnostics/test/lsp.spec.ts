/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { createDiagnosticsService, runEastLsp } from "../src/index.js";

const PROJ = join(process.cwd(), "test-fixtures", "proj");
// A virtual buffer (never on disk) inside the fixture project — exercises the
// overlay path end to end.
const OVERLAY_FILE = join(PROJ, "overlay-only.ts");

const BAD_SOURCE = `import { East, IntegerType, ArrayType, FloatType } from "@elaraai/east";
export const f = East.function([], IntegerType, ($) => {
  const a = $.let([] as number[], ArrayType(FloatType));
  East.value(5n);
  return a.size();
});
`;

const GOOD_SOURCE = `import { East, IntegerType, ArrayType, FloatType } from "@elaraai/east";
export const f = East.function([], IntegerType, ($) => {
  const a = $.let([], ArrayType(FloatType));
  return a.size();
});
`;

interface LspMessage {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

function startServer() {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages: LspMessage[] = [];
  let buffer = Buffer.alloc(0);
  output.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const match = /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString("utf8"));
      if (match === null) return;
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) return;
      messages.push(JSON.parse(buffer.subarray(bodyStart, bodyStart + length).toString("utf8")) as LspMessage);
      buffer = buffer.subarray(bodyStart + length);
    }
  });

  const service = createDiagnosticsService();
  runEastLsp({ service, input, output, exit: () => undefined });

  function send(message: object): void {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    input.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  async function waitFor<T extends LspMessage>(predicate: (m: LspMessage) => boolean, fromIndex = 0, timeoutMs = 60_000): Promise<{ message: T; index: number }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (let i = fromIndex; i < messages.length; i++) {
        if (predicate(messages[i]!)) return { message: messages[i] as T, index: i };
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting; saw: ${JSON.stringify(messages.map((m) => m.method ?? m.id))}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  return { send, waitFor, dispose: () => service.dispose() };
}

test("LSP lifecycle: initialize, overlay diagnostics, clean after change, shutdown", async () => {
  const server = startServer();
  const uri = pathToFileURL(OVERLAY_FILE).href;

  server.send({ id: 1, method: "initialize", params: { rootUri: pathToFileURL(PROJ).href, capabilities: {} } });
  const init = await server.waitFor((m) => m.id === 1);
  assert.ok(init.message.result.capabilities.textDocumentSync.openClose, "advertises open/close sync");

  server.send({ method: "initialized", params: {} });
  server.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "typescript", version: 1, text: BAD_SOURCE } } });

  const bad = await server.waitFor(
    (m) => m.method === "textDocument/publishDiagnostics" && m.params.uri.endsWith("overlay-only.ts") && m.params.diagnostics.length > 0,
  );
  const ruleNames = bad.message.params.diagnostics.map((d: any) => d.code);
  assert.ok(ruleNames.includes("no-redundant-east-cast"), `rule diagnostics over the overlay buffer: ${ruleNames.join(", ")}`);
  assert.ok(ruleNames.includes("no-unexecuted-east-expression"), "unexecuted expression rule");
  const first = bad.message.params.diagnostics[0];
  assert.equal(first.source, "east");
  assert.equal(typeof first.range.start.line, "number");

  server.send({ method: "textDocument/didChange", params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: GOOD_SOURCE }] } });
  await server.waitFor(
    (m) => m.method === "textDocument/publishDiagnostics" && m.params.uri.endsWith("overlay-only.ts") && m.params.diagnostics.length === 0,
    bad.index + 1,
  );

  server.send({ method: "textDocument/didClose", params: { textDocument: { uri } } });
  server.send({ id: 2, method: "shutdown" });
  const shutdown = await server.waitFor((m) => m.id === 2);
  assert.equal(shutdown.message.result, null);
  server.dispose();
});

test("LSP ignores non-East files", async () => {
  const server = startServer();
  const path = join(PROJ, "not-east.ts");
  const uri = pathToFileURL(path).href;

  server.send({ id: 1, method: "initialize", params: { capabilities: {} } });
  await server.waitFor((m) => m.id === 1);
  server.send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "typescript", version: 1, text: "const s: string = 1;\n" } } });

  const publish = await server.waitFor((m) => m.method === "textDocument/publishDiagnostics" && m.params.uri.endsWith("not-east.ts"));
  assert.equal(publish.message.params.diagnostics.length, 0, "non-East file gets no diagnostics from the East server");
  server.dispose();
});

test("unknown requests get MethodNotFound, unknown notifications are ignored", async () => {
  const server = startServer();
  server.send({ id: 1, method: "initialize", params: { capabilities: {} } });
  await server.waitFor((m) => m.id === 1);
  server.send({ method: "$/setTrace", params: { value: "off" } });
  server.send({ id: 9, method: "textDocument/hover", params: {} });
  const err = await server.waitFor((m) => m.id === 9);
  assert.equal(err.message.error.code, -32601);
  server.dispose();
});
