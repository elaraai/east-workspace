import { test } from "node:test";
import assert from "node:assert/strict";
import { EAST_GUIDANCE, GATE_TEXT, READ_TEXT, corpusReadFor, gateText, isExampleCorpusRead, readText, type SearchGuidance } from "../lib/search-guidance.js";

// The search-first guidance in a plugin's own names (#1234), and East's,
// word for word as its hooks have always given it.

const ACME: SearchGuidance = {
  searchTool: "mcp__plugin_acme_acme__search_acme_examples",
  getTool: "mcp__plugin_acme_acme__get_acme_example",
  corpus: "Acme",
  scope: "@acme",
};

test("East's gate and reminder are word for word what East's hooks have always said", () => {
  assert.equal(GATE_TEXT, [
    "STOP: no East example search on record in this session, and this is East code.",
    "Before writing or changing East code, search the tested example index — it is the API reference:",
    "1. `mcp__plugin_east_east__search_east_examples` with what you are about to do (language: \"python\" for east-py, \"typescript\" otherwise); summaries come back — id, signature, inputs and result.",
    "2. `mcp__plugin_east_east__get_east_example` for the one or two that match, and pattern your code on them.",
    "Do not read node_modules/@elaraai/** or *.examples.ts files instead: the index is the same corpus, exact and far cheaper. Every East skill requires this step.",
  ].join("\n"));
  assert.equal(READ_TEXT, [
    "Note: the East example index is the API reference — `mcp__plugin_east_east__search_east_examples` (then `get_east_example`) returns the same tested programs as the East packages' examples and type declarations, exact, printed in TypeScript or python, at a fraction of the tokens.",
    "Reading `.d.ts` signatures or sweeping `*.examples.ts` files reliably produces broken East code that still type-checks: the signatures omit the runtime rules. Search instead, and read a specific file only when the search pointed you at it.",
  ].join("\n"));
  assert.equal(gateText(EAST_GUIDANCE), GATE_TEXT);
});

test("a plugin's guidance speaks its own tools, corpus and scope, and none of East's", () => {
  const gate = gateText(ACME);
  assert.match(gate, /^STOP: no Acme example search on record in this session, and this is Acme code\.$/m);
  assert.match(gate, /`mcp__plugin_acme_acme__search_acme_examples`/);
  assert.match(gate, /`mcp__plugin_acme_acme__get_acme_example`/);
  assert.match(gate, /node_modules\/@acme\/\*\*/);
  assert.match(gate, /Every Acme skill requires this step\.$/);
  const read = readText(ACME);
  assert.match(read, /the Acme example index .* \(then `get_acme_example`\)/);
  for (const text of [gate, read]) assert.doesNotMatch(text, /east_east|East code|@elaraai/);
});

test("a corpus read is a read of the scope's installed packages or of the examples, never a project file", () => {
  const acme = corpusReadFor(ACME.scope);
  assert.equal(acme("Read", { file_path: "/w/node_modules/@acme/cloud/dist/index.d.ts" }), true);
  assert.equal(acme("Grep", { pattern: "deploy", path: "/w/node_modules/@acme/cloud" }), true);
  assert.equal(acme("Glob", { pattern: "node_modules/@acme/**/*.d.ts" }), true);
  assert.equal(acme("Glob", { pattern: "**/*.examples.ts" }), true);
  assert.equal(acme("Read", { file_path: "/w/node_modules/@elaraai/east/dist/index.d.ts" }), false, "another scope is another plugin's corpus");
  assert.equal(acme("Read", { file_path: "/w/src/app.ts" }), false);
  assert.equal(acme("Grep", { pattern: "@acme/cloud", path: "/w/src" }), false, "a project's own grep for its imports");
  assert.equal(isExampleCorpusRead("Read", { file_path: "/w/node_modules/@elaraai/east/dist/index.d.ts" }), true);
  assert.equal(isExampleCorpusRead("Read", { file_path: "/w/node_modules/@acme/cloud/dist/index.d.ts" }), false);
});
