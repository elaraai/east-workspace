import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSummary, loadIndex, loadIndexes, searchExamples } from "../lib/search.js";
import { ACME_ENTRIES, EAST_ENTRIES, entry, writeIndexes } from "./fixtures.js";

// One search over several corpora (#1234): a plugin that builds on East's
// serves East's index and its own together.

test("one search answers from every index it was given, and its package filter knows each one's packages", async (t) => {
  const [east, acme] = writeIndexes(t, EAST_ENTRIES, ACME_ENTRIES);
  const index = await loadIndexes([east!, acme!]);
  assert.deepEqual(index.packages, ["acme", "east"]);

  const deploy = searchExamples(index, { query: "deploy app cloud", limit: 5 });
  assert.equal(deploy.entries[0]?.id, "acme:deploy.examples.ts:deployApp", JSON.stringify(deploy.entries.map((e) => e.id)));
  const map = searchExamples(index, { query: "map array elements", limit: 5 });
  assert.equal(map.entries[0]?.id, "east:array.examples.ts:arrayMap", JSON.stringify(map.entries.map((e) => e.id)));

  const filtered = searchExamples(index, { query: "app", limit: 5, package: "acme" });
  assert.ok(filtered.entries.length > 0);
  assert.ok(filtered.entries.every((e) => e.package === "acme"));
  const unknown = searchExamples(index, { query: "app", limit: 5, package: "@elaraai/nowhere" });
  assert.equal(unknown.unknownPackage, "@elaraai/nowhere");
  assert.deepEqual(unknown.known, ["acme", "east"]);

  // A package under a scope of the corpus's is its bare name; East's scope is the one unless given.
  const scoped = searchExamples(index, { query: "app", limit: 5, package: "@acme/acme", scopes: ["@acme", "@elaraai"] });
  assert.ok(scoped.entries.length > 0 && scoped.entries.every((e) => e.package === "acme"));
  assert.equal(searchExamples(index, { query: "app", limit: 5, package: "@elaraai/east" }).unknownPackage, undefined);
  assert.equal(searchExamples(index, { query: "app", limit: 5, package: "@acme/acme" }).unknownPackage, "@acme/acme");
});

test("one index file loads as it always has", async (t) => {
  const [east] = writeIndexes(t, EAST_ENTRIES);
  const index = await loadIndex(east!);
  assert.deepEqual(index.packages, ["east"]);
  assert.equal(searchExamples(index, { query: "merge dicts", limit: 3 }).entries[0]?.id, "east:dict.examples.ts:dictMerge");
});

test("an example id in two index files is refused, naming both", async (t) => {
  const [east, again] = writeIndexes(t, EAST_ENTRIES, [entry("east", "array.examples.ts", "arrayMap", "a copy", ["array"])]);
  await assert.rejects(loadIndexes([east!, again!]), (error: Error) => {
    assert.match(error.message, /"east:array\.examples\.ts:arrayMap" is in both/);
    assert.ok(error.message.includes(east!) && error.message.includes(again!), error.message);
    return true;
  });
});

test("a summary names the corpus and its fetch tool as given, East's by default", () => {
  assert.match(formatSummary(ACME_ENTRIES, "typescript", { corpus: "Acme", getTool: "get_acme_example" }), /^## 2 Acme example\(s\) — fetch one in full with get_acme_example\(id, language: "typescript"\)$/m);
  assert.match(formatSummary(EAST_ENTRIES, "python"), /^## 2 East example\(s\) — fetch one in full with get_east_example\(id, language: "python"\)$/m);
});
