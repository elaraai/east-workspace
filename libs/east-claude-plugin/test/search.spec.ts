import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSearchIndex, codeOf, formatResults, getEntry, loadIndex, normalizePackage, searchExamples, speaks, MIN_SCORE, type IndexEntry } from "../lib/search.js";

// The committed index (#654): every program example stored as its IR with the
// TypeScript and python printed from it, UI examples as authored tsx, and the
// search rendering both as summaries and in full.
const INDEX = join(process.cwd(), "index.json");
/** The raw index: the IR itself is not a stored search field, so it is read from the file. */
const RAW = new Map((JSON.parse(readFileSync(INDEX, "utf-8")) as { entries: IndexEntry[] }).entries.map((e) => [e.id, e]));

function hits(index: Awaited<ReturnType<typeof buildSearchIndex>>, query: string, pkg: string): IndexEntry[] {
  return (index.search(query, { limit: 20 } as never) as unknown as IndexEntry[]).filter((e) => e.package === pkg);
}

test("a program example is stored as IR with both printings, its signature, inputs, result and builtins", async () => {
  const index = await buildSearchIndex(INDEX);
  const found = hits(index, "group reduce dict sum", "east");
  assert.ok(found.length > 0, "the core examples are searchable");
  for (const e of found) {
    assert.deepEqual(e.languages, ["typescript", "python"]);
    const raw = RAW.get(e.id)!;
    assert.equal(typeof raw.ir, "string", `${e.id} is stored as IR`);
    assert.equal(raw.source, undefined, "no authored text for a program");
    assert.match(e.ts!, /East\.function\(/);
    assert.match(e.python!, /East\.function\(/);
    assert.equal(typeof e.signature?.output, "string");
    assert.ok(Array.isArray(e.builtins), `builtins of ${e.id} (a pure construction may call none)`);
  }
  const first = found[0]!;
  assert.equal(codeOf(first, "typescript")?.fence, "typescript");
  assert.equal(codeOf(first, "python")?.fence, "python");
  assert.equal(getEntry(index, first.id)?.id, first.id);
});

test("every program example in the corpus has both printings; every JSX example neither", () => {
  const programs = ["east", "east-node-std", "east-node-io", "east-py-datascience"];
  let counted = 0;
  for (const e of RAW.values()) {
    if (programs.includes(e.package)) {
      counted += 1;
      assert.deepEqual(e.languages, ["typescript", "python"], e.id);
      assert.equal(typeof e.ir, "string", `${e.id} has IR`);
      assert.equal(typeof e.ts, "string", `${e.id} has TypeScript`);
      assert.equal(typeof e.python, "string", `${e.id} has python — the index was built without east-py?`);
      assert.equal(e.source, undefined, `${e.id} keeps no authored text`);
    } else if (e.languages.includes("tsx")) {
      assert.equal(e.ir, undefined, `${e.id} is authored JSX, never IR`);
      assert.equal(e.python, undefined, `${e.id} has no python`);
    }
  }
  assert.ok(counted > 700, `program examples in the corpus: ${counted}`);
});

test("a JSX-authored UI example keeps its source, is tsx, and has no python", async () => {
  const index = await buildSearchIndex(INDEX);
  const [ui] = hits(index, "Plan drag drop series", "east-ui");
  assert.ok(ui, "a UI example is searchable");
  assert.deepEqual(ui.languages, ["tsx"]);
  assert.equal(typeof ui.source, "string");
  assert.equal(RAW.get(ui.id)!.ir, undefined);
  assert.equal(speaks(ui, "python"), false);
  assert.equal(speaks(ui, "typescript"), true);
  assert.equal(codeOf(ui, "python"), null);
  assert.equal(codeOf(ui, "typescript")?.fence, "tsx");
});

test("summaries are cheap, full renderings carry the requested language", async () => {
  const index = await buildSearchIndex(INDEX);
  const found = (index.search("array map filter", { limit: 5 } as never) as unknown as IndexEntry[]).filter((e) => (e as unknown as { score: number }).score >= MIN_SCORE).slice(0, 5);
  assert.ok(found.length > 0);
  const summary = formatResults(found, "typescript", "summary");
  assert.ok(summary.length < 3000, `a five-hit summary stays small: ${summary.length} bytes`);
  assert.match(summary, /get_east_example/);
  const python = formatResults(found.filter((e) => e.languages.includes("python")).slice(0, 1), "python", "full");
  assert.match(python, /```python/);
  assert.match(python, /Signature: \(/);
});

test("the package filter takes the scoped or the bare name, applies inside the search, and names an unknown package", async () => {
  const index = await loadIndex(INDEX);
  assert.equal(normalizePackage("@elaraai/east-node-io"), "east-node-io");
  assert.equal(normalizePackage(" East "), "east");

  // The agent's exact calls: a scoped name used to return nothing, silently.
  const scoped = searchExamples(index, { query: "XLSX read workbook sheet rows", limit: 8, package: "@elaraai/east-node-io" });
  assert.equal(scoped.unknownPackage, undefined);
  assert.ok(scoped.entries.length > 0, "scoped east-node-io filter finds the XLSX examples");
  assert.ok(scoped.entries.every((e) => e.package === "east-node-io"));
  const bare = searchExamples(index, { query: "XLSX read workbook sheet rows", limit: 8, package: "east-node-io" });
  assert.deepEqual(bare.entries.map((e) => e.id), scoped.entries.map((e) => e.id));

  // The filter runs inside the search: the limit counts filtered hits, so a
  // query whose top hits sit in another package still fills up.
  const core = searchExamples(index, { query: "match variant with default fallback for unhandled cases", limit: 6, package: "@elaraai/east" });
  assert.equal(core.entries.length, 6);
  assert.ok(core.entries.every((e) => e.package === "east"));

  // An unknown name is reported with the indexed names, never an empty list.
  const unknown = searchExamples(index, { query: "XLSX", limit: 4, package: "@elaraai/east-node-xlsx" });
  assert.equal(unknown.unknownPackage, "@elaraai/east-node-xlsx");
  assert.ok(unknown.known.includes("east-node-io"));
  assert.deepEqual(unknown.entries, []);
});
