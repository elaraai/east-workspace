import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { join } from "node:path";

// Exercises the SHIPPED PostToolUse pipeline end-to-end: spawn the bundled
// diagnose hook with a real event, let it spawn the daemon, and assert it
// injects the merged <east-code-review>. Uses the east-diagnostics fixture
// (a real East project with @elaraai/east resolvable + intentional antipatterns).
const pluginDir = process.cwd();
const eastDiagDir = join(pluginDir, "..", "east-diagnostics");
const fixture = join(eastDiagDir, "test-fixtures", "proj", "bad.ts");
const hook = join(pluginDir, ".build", "hooks", "diagnose.js");

function killDaemon(): void {
  try {
    execSync("pkill -f 'east-claude-plugin/.build/daemon/server.js'");
  } catch {
    /* none running */
  }
}

function run(toolName: string): string {
  const input = JSON.stringify({
    cwd: eastDiagDir,
    session_id: `test-${Date.now()}-${Math.random()}`, // unique so the per-session content dedupe doesn't self-skip across runs
    tool_name: toolName,
    tool_input: { file_path: fixture },
  });
  try {
    return execFileSync(process.execPath, [hook], { input, timeout: 20000, encoding: "utf-8" });
  } finally {
    killDaemon();
  }
}

test("diagnose hook injects <east-code-review> for an antipattern East file", () => {
  const out = run("Read");
  assert.match(out, /<east-code-review>/);
  assert.match(out, /no-redundant-east-cast/);
  assert.match(out, /no-unexecuted-east-expression/);
});

test("a TypeScript edit is left to the language server, which reports it natively", () => {
  // Reviewing it here too would double every TS finding: Claude Code injects
  // the plugin LSP's diagnostics after each edit already. Python is the case
  // that needs the hook (#684), because its LSP path degrades to silence when
  // east-py does not resolve.
  assert.equal(run("Write"), "");
  assert.equal(run("Edit"), "");
});
