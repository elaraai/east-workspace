import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerExampleTools, type ExampleToolsOptions } from "../mcp/example-tools.js";
import { ACME_ENTRIES, EAST_ENTRIES, writeIndexes } from "./fixtures.js";

// The example search's MCP tools on any server (#1234): a downstream plugin's
// server registers them under its own names over its index and East's.

async function connected(options: ExampleToolsOptions): Promise<Client> {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  await registerExampleTools(server, options);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

function text(result: unknown): string {
  return ((result as { content: Array<{ text?: string }> }).content).map((c) => c.text ?? "").join("\n");
}

test("a downstream server's tools go by its names and answer from both corpora", async (t) => {
  const [east, acme] = writeIndexes(t, EAST_ENTRIES, ACME_ENTRIES);
  const client = await connected({
    index: [east!, acme!],
    searchTool: "search_acme_examples",
    getTool: "get_acme_example",
    corpus: "Acme",
    packages: ["acme", "east"],
    scopes: ["@acme", "@elaraai"],
  });
  try {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((t) => t.name).sort(), ["get_acme_example", "search_acme_examples"]);
    const search = tools.find((t) => t.name === "search_acme_examples")!;
    assert.match(search.description ?? "", /before writing or changing Acme code/);
    assert.match(search.description ?? "", /fetch one with get_acme_example\./);
    assert.match(search.description ?? "", /Do not read node_modules\/@acme or node_modules\/@elaraai or \*\.examples\.ts files instead/);
    const packageArg = (search.inputSchema.properties as Record<string, { description?: string }>)["package"];
    assert.match(packageArg?.description ?? "", /— acme, east — the `@acme\/` and `@elaraai\/` scopes are accepted and ignored;/);
    const unknown = text(await client.callTool({ name: "search_acme_examples", arguments: { query: "app", package: "@acme/nowhere" } }));
    assert.match(unknown, /Indexed packages: acme, east \(bare names: the `@acme\/` and `@elaraai\/` scopes are accepted and ignored\)/);
    const scoped = text(await client.callTool({ name: "search_acme_examples", arguments: { query: "release app", package: "@acme/acme" } }));
    assert.match(scoped, /acme:release\.examples\.ts:releaseApp/);

    const deploy = text(await client.callTool({ name: "search_acme_examples", arguments: { query: "deploy app cloud" } }));
    assert.match(deploy, /Acme example\(s\) — fetch one in full with get_acme_example/);
    assert.match(deploy, /acme:deploy\.examples\.ts:deployApp/);
    const map = text(await client.callTool({ name: "search_acme_examples", arguments: { query: "map array elements" } }));
    assert.match(map, /east:array\.examples\.ts:arrayMap/);

    const one = text(await client.callTool({ name: "get_acme_example", arguments: { id: "acme:release.examples.ts:releaseApp" } }));
    assert.match(one, /^### `acme:release\.examples\.ts:releaseApp`$/m);
    assert.match(one, /^releases an app from staging · Suite: {2}· Package: acme$/m);
    const none = text(await client.callTool({ name: "get_acme_example", arguments: { id: "acme:nowhere" } }));
    assert.equal(none, 'No Acme example with id "acme:nowhere" — ids come from search_acme_examples results.');
  } finally {
    await client.close();
  }
});

test("registered with no names, the tools are East's, worded as East's server has always worded them", async (t) => {
  const [east] = writeIndexes(t, EAST_ENTRIES);
  const client = await connected({ index: [east!] });
  try {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((t) => t.name).sort(), ["get_east_example", "search_east_examples"]);
    const search = tools.find((t) => t.name === "search_east_examples")!;
    assert.equal(search.description, "The mandatory first step before writing or changing East code: search the tested example index for the capability you are about to use. Every East API has an example here, stored as IR and rendered in TypeScript or python. Returns summaries by default (id, description, signature, keywords, the example inputs and result — a few hundred bytes each); pass format: \"full\" for the code, or fetch one with get_east_example. Do not read node_modules/@elaraai or *.examples.ts files instead — this is the same corpus, exact and far cheaper.");
    const packageArg = (search.inputSchema.properties as Record<string, { description?: string }>)["package"];
    assert.equal(packageArg?.description, "Filter results to one package by its bare name — east, east-node-std, east-node-io, east-py-datascience, east-ui, e3-ui, e3, e3-ui-cli, e3-create — the `@elaraai/` scope is accepted and ignored; an unknown name is reported with the indexed names");
    const get = tools.find((t) => t.name === "get_east_example")!;
    assert.equal(get.description, "One East example in full, by the id a search returned: its code printed in the requested language from the example's IR (TypeScript or python), its signature, and the example inputs and expected result. The second step after search_east_examples.");
    const none = text(await client.callTool({ name: "search_east_examples", arguments: { query: "zzzzqqq" } }));
    assert.match(none, /^No East examples found for query: "zzzzqqq"/);
  } finally {
    await client.close();
  }
});
