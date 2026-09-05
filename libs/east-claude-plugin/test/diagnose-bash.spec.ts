import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The PostToolUse(Bash) pipeline (#684): a file written through the shell —
// the way a heredoc or a redirect writes one — reaches the same review as a
// file written with Write. Before this hook nothing saw those at all. The
// `east-py` here is the same stand-in the python hook test uses.
const hook = join(process.cwd(), ".build", "hooks", "diagnose-bash.js");

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "east-bash-hook-"));
  const bin = join(dir, ".venv", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "findings.json"), JSON.stringify([{
    path: join(dir, "mod.py"),
    rule: "no-operator-fork",
    code: "EAS002",
    category: "error",
    line: 5,
    column: 12,
    message: "python `//` floors; East IntegerDivide truncates — spell it .divide(2)",
  }]));
  writeFileSync(join(bin, "east-py"), `#!/bin/sh\ncat "$(dirname "$0")/findings.json"\nexit 1\n`);
  chmodSync(join(bin, "east-py"), 0o755);
  writeFileSync(
    join(dir, "mod.py"),
    "from east import East, IntegerType\n\n@East.function([IntegerType], IntegerType)\ndef halve(b, x):\n    return x // 2\n",
  );
  writeFileSync(join(dir, "plain.py"), "def halve(x):\n    return x // 2\n");
  writeFileSync(join(dir, "notes.txt"), "not code\n");
  return dir;
}

function runHook(command: string, cwd: string): string {
  const input = JSON.stringify({
    cwd,
    session_id: `test-${Date.now()}-${Math.random()}`,
    tool_name: "Bash",
    tool_input: { command },
  });
  return execFileSync(process.execPath, [hook], {
    input,
    timeout: 20000,
    encoding: "utf-8",
    env: { ...process.env, EAST_PY_LINT: "" },
  });
}

test("a python East file written by a heredoc is reviewed", () => {
  const dir = project();
  try {
    const out = runHook("cat > mod.py <<'EOF'\nfrom east import East\nEOF", dir);
    assert.match(out, /<east-code-review>/);
    assert.match(out, /no-operator-fork/);
    assert.match(out, /mod\.py/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a command that writes no East file says nothing", () => {
  const dir = project();
  try {
    assert.equal(runHook("echo hi > plain.py", dir), "");
    assert.equal(runHook("echo hi > notes.txt", dir), "");
    assert.equal(runHook("pytest -q", dir), "");
    assert.equal(runHook("ls > /dev/null 2>&1", dir), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file written and then reviewed again in the same session is reviewed once", () => {
  const dir = project();
  try {
    const session = `test-${Date.now()}`;
    const input = JSON.stringify({
      cwd: dir,
      session_id: session,
      tool_name: "Bash",
      tool_input: { command: "cat > mod.py <<'EOF'\nx\nEOF" },
    });
    const opts = { input, timeout: 20000, encoding: "utf-8" as const, env: { ...process.env, EAST_PY_LINT: "" } };
    assert.match(execFileSync(process.execPath, [hook], opts), /<east-code-review>/);
    assert.equal(execFileSync(process.execPath, [hook], opts), "", "the content-hash marker must suppress the repeat");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
