import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The search-before-coding gate and the read reminder (#654), through the
// bundled hooks Claude Code runs.
const plugin = process.cwd();
const preWrite = join(plugin, ".build", "hooks", "pre-write.js");
const preRead = join(plugin, ".build", "hooks", "pre-read.js");

const EAST_TS = `import { East, IntegerType } from "@elaraai/east";\nexport const f = East.function([IntegerType], IntegerType, ($, x) => x.add(1n));\n`;

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "east-gate-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "p", dependencies: { "@elaraai/east": "*" } }));
  mkdirSync(join(dir, "src"));
  return dir;
}

/** A transcript: one assistant entry, with or without a search-tool call. */
function transcript(dir: string, searched: boolean): string {
  const path = join(dir, "transcript.jsonl");
  const content = searched
    ? [{ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__plugin_east_east__search_east_examples", input: { query: "array map" } }] } }]
    : [{ type: "assistant", message: { content: [{ type: "text", text: "writing the function now" }] } }];
  writeFileSync(path, content.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return path;
}

function run(hook: string, event: object, env: Record<string, string> = {}): string {
  return execFileSync(process.execPath, [hook], { input: JSON.stringify(event), encoding: "utf-8", timeout: 20000, env: { ...process.env, ...env } });
}

test("pre-write: an East write with no search on record gets the instruction to search first", () => {
  const dir = project();
  try {
    const out = run(preWrite, {
      session_id: `gate-${Date.now()}-a`, cwd: dir, transcript_path: transcript(dir, false),
      tool_name: "Write", tool_input: { file_path: join(dir, "src", "f.ts"), content: EAST_TS },
    });
    assert.match(out, /STOP: no East example search on record/);
    assert.match(out, /search_east_examples/);
    assert.match(out, /"additionalContext"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pre-write: a session that searched is silent, and stays silent on later writes", () => {
  const dir = project();
  try {
    const session = `gate-${Date.now()}-b`;
    const event = {
      session_id: session, cwd: dir, transcript_path: transcript(dir, true),
      tool_name: "Write", tool_input: { file_path: join(dir, "src", "f.ts"), content: EAST_TS },
    };
    assert.equal(run(preWrite, event), "");
    // the marker set by the first write answers the second without re-reading the transcript
    writeFileSync(event.transcript_path, "");
    assert.equal(run(preWrite, event), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pre-write: EAST_REQUIRE_SEARCH=deny refuses the write with the same instruction", () => {
  const dir = project();
  try {
    const out = run(preWrite, {
      session_id: `gate-${Date.now()}-c`, cwd: dir, transcript_path: transcript(dir, false),
      tool_name: "Write", tool_input: { file_path: join(dir, "src", "f.ts"), content: EAST_TS },
    }, { EAST_REQUIRE_SEARCH: "deny" });
    const decision = JSON.parse(out) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
    assert.equal(decision.hookSpecificOutput.permissionDecision, "deny");
    assert.match(decision.hookSpecificOutput.permissionDecisionReason, /search_east_examples/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pre-write: a write that is not East code is never gated", () => {
  const dir = project();
  try {
    const out = run(preWrite, {
      session_id: `gate-${Date.now()}-d`, cwd: dir, transcript_path: transcript(dir, false),
      tool_name: "Write", tool_input: { file_path: join(dir, "src", "util.ts"), content: "export const x = 1;\n" },
    });
    assert.equal(out, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pre-read: reading the East packages' declarations or sweeping the examples gets the reminder; a project file does not", () => {
  const remind = run(preRead, { tool_name: "Read", tool_input: { file_path: "/w/node_modules/@elaraai/east/dist/src/index.d.ts" } });
  assert.match(remind, /search_east_examples/);
  const sweep = run(preRead, { tool_name: "Grep", tool_input: { pattern: "groupReduce", path: "/w/node_modules/@elaraai/east" } });
  assert.match(sweep, /search_east_examples/);
  const glob = run(preRead, { tool_name: "Glob", tool_input: { pattern: "**/*.examples.ts" } });
  assert.match(glob, /search_east_examples/);
  assert.equal(run(preRead, { tool_name: "Read", tool_input: { file_path: "/w/src/app.ts" } }), "");
  assert.equal(run(preRead, { tool_name: "Grep", tool_input: { pattern: "TODO", path: "/w/src" } }), "");
});
