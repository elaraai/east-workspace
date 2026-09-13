import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";

// The SHIPPED MCP server, spoken to over stdio the way Claude Code does. A
// client that closes the server's stdin has gone, so the server exits — also
// once east_lsp_diagnostics has started a language server, whose pipes would
// otherwise hold it open (the stdio transport never reports end of input).
// Uses the east-diagnostics fixture, as the diagnose hook test does.
const server = join(process.cwd(), ".build", "mcp", "server.js");
const fixture = join(process.cwd(), "..", "east-diagnostics", "test-fixtures", "proj", "bad.ts");

interface Reply {
  id?: number;
  result?: { content?: Array<{ text?: string }> };
}

test("the MCP server exits when its stdin closes, after east_lsp_diagnostics started a language server", async () => {
  const child = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "ignore"] });
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  const waiting = new Map<number, (reply: Reply) => void>();
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
      const reply = JSON.parse(buffer.slice(0, newline)) as Reply;
      buffer = buffer.slice(newline + 1);
      if (reply.id !== undefined) waiting.get(reply.id)?.(reply);
    }
  });
  let nextId = 0;
  const request = (method: string, params: object): Promise<Reply> => new Promise((resolve) => {
    nextId += 1;
    waiting.set(nextId, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: nextId, method, params })}\n`);
  });
  try {
    await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    const reply = await request("tools/call", { name: "east_lsp_diagnostics", arguments: { file: fixture } });
    assert.match(reply.result?.content?.[0]?.text ?? "", /no-redundant-east-cast/, "the language server answered, so it is running");

    child.stdin.end();
    const outcome = await Promise.race([exited, new Promise<"running">((resolve) => setTimeout(() => resolve("running"), 20000).unref())]);
    assert.equal(outcome, 0, "the server must exit once its stdin has closed");
  } finally {
    child.kill();
  }
});
