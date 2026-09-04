import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The SHIPPED PostToolUse pipeline for a python file (#648): the bundled
// diagnose hook finds the project's own `east-py` (the nearest `.venv` above
// the file), runs `east-py lint --format json`, and injects the findings as
// the <east-code-review> block. The `east-py` here is a stand-in that prints
// what the real one prints for one finding and exits 1 as it does — so the
// test pins the hook's resolution and rendering without a python toolchain.
const hook = join(process.cwd(), ".build", "hooks", "diagnose.js");

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "east-py-hook-"));
  const bin = join(dir, ".venv", "bin");
  mkdirSync(bin, { recursive: true });
  const record = {
    path: join(dir, "mod.py"),
    rule: "no-operator-fork",
    code: "EAS002",
    category: "error",
    line: 5,
    column: 12,
    message: "python `//` floors; East IntegerDivide truncates — spell it .divide(2)",
  };
  writeFileSync(join(bin, "findings.json"), JSON.stringify([record]));
  writeFileSync(join(bin, "east-py"), `#!/bin/sh\ncat "$(dirname "$0")/findings.json"\nexit 1\n`);
  chmodSync(join(bin, "east-py"), 0o755);
  writeFileSync(
    join(dir, "mod.py"),
    "from east import East, IntegerType\n\n@East.function([IntegerType], IntegerType)\ndef halve(b, x):\n    return x // 2\n",
  );
  writeFileSync(join(dir, "plain.py"), "def halve(x):\n    return x // 2\n");
  return dir;
}

function runHook(file: string, toolName = "Read"): string {
  const input = JSON.stringify({
    cwd: "/",
    session_id: `test-${Date.now()}-${Math.random()}`, // unique so the per-session content dedupe doesn't self-skip across runs
    tool_name: toolName,
    tool_input: { file_path: file },
  });
  return execFileSync(process.execPath, [hook], {
    input,
    timeout: 20000,
    encoding: "utf-8",
    env: { ...process.env, EAST_PY_LINT: "" },
  });
}

test("diagnose hook reviews a python file that imports east through the project's own east-py", () => {
  const dir = project();
  try {
    const out = runHook(join(dir, "mod.py"));
    assert.match(out, /<east-code-review>/);
    assert.match(out, /- \[error\] 5:12 \(no-operator-fork\) python `\/\/` floors/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("diagnose hook leaves a python file that does not import east alone", () => {
  const dir = project();
  try {
    assert.equal(runHook(join(dir, "plain.py")), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a python EDIT is reviewed here, not left to the language server (#684)", () => {
  // The python path through the LSP needs east-py to resolve from the file's
  // directory and says nothing at all when it does not — reported as "the
  // python hooks don't fire". The hook covers Edit/Write for python so a
  // missing server is not silent.
  const dir = project();
  try {
    for (const tool of ["Edit", "Write"]) {
      const out = runHook(join(dir, "mod.py"), tool);
      assert.match(out, /<east-code-review>/, `${tool} on a python file must be reviewed`);
      assert.match(out, /no-operator-fork/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
