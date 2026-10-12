import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookInput } from "../lib/hook-io.js";
import { gateText, readText, corpusReadFor, type SearchGuidance } from "../lib/search-guidance.js";
import { preReadReminder, preWriteGate, type SearchGateOptions } from "../lib/search-hooks.js";
import { codexSearchGate, type CodexSearchGateOptions } from "../lib/codex-hook.js";

// The search-first hooks configured by a plugin that builds on East's
// (#1234): its own tools count as a search, its own code is gated, and its
// own words are given.

const ACME: SearchGuidance = {
  searchTool: "mcp__plugin_acme_acme__search_acme_examples",
  getTool: "mcp__plugin_acme_acme__get_acme_example",
  corpus: "Acme",
  scope: "@acme",
};
const ACME_TOOLS = [ACME.searchTool, ACME.getTool, "mcp__plugin_east_east__search_east_examples"];
const ACME_CODE = "import { deploy } from \"@acme/cloud\";\nexport const app = deploy();\n";

const GATE: SearchGateOptions = {
  searchTools: ACME_TOOLS,
  gateText: gateText(ACME),
  isCorpusCode: (code) => /@acme\/cloud/.test(code),
  markerPrefix: "acme-search-seen",
  requireSearchEnv: "ACME_REQUIRE_SEARCH",
};

function transcript(dir: string, tool: string | null): string {
  const path = join(dir, "transcript.jsonl");
  const content = tool === null
    ? { type: "assistant", message: { content: [{ type: "text", text: "writing it now" }] } }
    : { type: "assistant", message: { content: [{ type: "tool_use", name: tool, input: { query: "deploy" } }] } };
  writeFileSync(path, `${JSON.stringify(content)}\n`);
  return path;
}

function write(dir: string, session: string, path: string, content: string, transcriptPath: string): HookInput {
  return {
    session_id: session, transcript_path: transcriptPath, cwd: dir, permission_mode: "default", hook_event_name: "PreToolUse",
    tool_name: "Write", tool_input: { file_path: join(dir, path), content },
  };
}

test("the gate meets a write of the plugin's code with its own instruction, until one of the tools it names is on record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acme-gate-"));
  // Each write is its own session; the gate's marker of a search seen is in the
  // temporary directory itself, so each is removed once the test ends.
  const sessions: string[] = [];
  const session = (tag: string): string => {
    const id = `acme-${process.pid}-${Date.now()}-${tag}`;
    sessions.push(id);
    return id;
  };
  try {
    const unsearched = await preWriteGate(write(dir, session("a"), "app.ts", ACME_CODE, transcript(dir, null)), GATE);
    assert.equal(unsearched?.decision, "context");
    assert.match(unsearched?.text ?? "", /^STOP: no Acme example search on record/);

    // The plugin's own search counts, and East's does too: the options name both.
    const searched = await preWriteGate(write(dir, session("b"), "app.ts", ACME_CODE, transcript(dir, ACME.searchTool)), GATE);
    assert.equal(searched, null);
    const searchedEast = await preWriteGate(write(dir, session("f"), "app.ts", ACME_CODE, transcript(dir, "mcp__plugin_east_east__search_east_examples")), GATE);
    assert.equal(searchedEast, null);

    process.env["ACME_REQUIRE_SEARCH"] = "deny";
    try {
      const refused = await preWriteGate(write(dir, session("c"), "app.ts", ACME_CODE, transcript(dir, null)), GATE);
      assert.equal(refused?.decision, "deny");
    } finally {
      delete process.env["ACME_REQUIRE_SEARCH"];
    }

    assert.equal(await preWriteGate(write(dir, session("d"), "util.ts", "export const x = 1;\n", transcript(dir, null)), GATE), null, "not the plugin's code");
    assert.equal(await preWriteGate(write(dir, session("e"), "app.ts", ACME_CODE, transcript(dir, null)), { ...GATE, isProject: async () => false }), null, "not one of its projects");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const id of sessions) rmSync(join(tmpdir(), `${GATE.markerPrefix}-${id}`), { force: true });
  }
});

test("the read reminder gives the plugin's words for a read of its corpus only", () => {
  const options = { readText: readText(ACME), isCorpusRead: corpusReadFor(ACME.scope) };
  const event = (tool: string, input: Record<string, unknown>): HookInput => ({
    session_id: "s", transcript_path: "", cwd: "/w", permission_mode: "default", hook_event_name: "PreToolUse", tool_name: tool, tool_input: input,
  });
  assert.match(preReadReminder(event("Read", { file_path: "/w/node_modules/@acme/cloud/dist/index.d.ts" }), options)?.text ?? "", /the Acme example index/);
  assert.equal(preReadReminder(event("Read", { file_path: "/w/src/app.ts" }), options), null);
});

test("the Codex gate records a search by the plugin's own tool, and gates a patch of its code until then", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acme-codex-gate-"));
  const options: CodexSearchGateOptions = {
    searchTools: ACME_TOOLS,
    searchToolName: /__(?:search_acme_examples|get_acme_example)$/,
    gateText: gateText(ACME),
    readText: readText(ACME),
    isCorpusRead: corpusReadFor(ACME.scope),
    shellSweep: /node_modules\/@acme(?:\/|\b)|\.examples\.tsx?/,
    corpusCode: /@acme\/cloud/,
    markerPrefix: "acme-codex-search-",
    requireSearchEnv: "ACME_REQUIRE_SEARCH",
  };
  const base = { session_id: dir, transcript_path: "", cwd: dir, permission_mode: "default" };
  // The marker of a search seen, in the temporary directory itself, named by the session.
  const marker = join(tmpdir(), options.markerPrefix + createHash("sha256").update(dir).digest("hex"));
  const patch: HookInput = {
    ...base, hook_event_name: "PreToolUse", tool_name: "apply_patch",
    tool_input: { command: `*** Begin Patch\n*** Add File: app.ts\n+${ACME_CODE.split("\n")[0]}\n*** End Patch` },
  };
  try {
    const gated = await codexSearchGate(patch, options);
    assert.ok(gated !== null && gated !== "recorded");
    assert.match(gated.text, /^STOP: no Acme example search on record/);

    // East's search is not this gate's: its pattern names the plugin's tools.
    assert.equal(await codexSearchGate({ ...base, hook_event_name: "PostToolUse", tool_name: "mcp__east__search_east_examples", tool_response: {} }, options), null);
    assert.equal(await codexSearchGate({ ...base, hook_event_name: "PostToolUse", tool_name: "mcp__plugin_acme_acme__search_acme_examples", tool_response: {} }, options), "recorded");
    assert.ok(existsSync(marker), "the search is recorded in the session's marker");
    assert.equal(await codexSearchGate(patch, options), null, "the recorded search lets the patch through");

    const sweep = await codexSearchGate({ ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "cat node_modules/@acme/cloud/dist/index.d.ts" } }, options);
    assert.ok(sweep !== null && sweep !== "recorded");
    assert.match(sweep.text, /the Acme example index/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(marker, { force: true });
  }
});
