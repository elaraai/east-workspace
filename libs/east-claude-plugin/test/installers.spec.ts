import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The installer entry points the README hands to `curl … | bash` forward to
// the shared scripts in east-plugin: the one beside them in a checkout, the
// published one otherwise. Piped, bash has no BASH_SOURCE, which `set -u`
// must not turn into an exit before anything runs.
const SCRIPTS = ["install.sh", "install-dev.sh", "update.sh", "update-dev.sh"];
const SHARED = "https://raw.githubusercontent.com/elaraai/east-workspace/main/libs/east-plugin/scripts";

test("piped into bash, each installer fetches the shared script and passes its arguments on", () => {
  const dir = mkdtempSync(join(tmpdir(), "east-installer-"));
  try {
    // a stand-in curl: answers with a script that reports the URL it was asked for
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "curl"), `#!/bin/sh\nfor arg in "$@"; do url="$arg"; done\nprintf 'echo "ran %s with: $*"\\n' "$url"\n`);
    chmodSync(join(bin, "curl"), 0o755);
    for (const script of SCRIPTS) {
      const out = execFileSync("bash", ["-s", "--", "-y"], {
        cwd: dir,
        input: readFileSync(join(process.cwd(), "scripts", script), "utf-8"),
        encoding: "utf-8",
        env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` },
      });
      assert.equal(out, `ran ${SHARED}/${script} with: -y\n`, script);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run from a checkout, each installer runs the shared script beside it", () => {
  const dir = mkdtempSync(join(tmpdir(), "east-installer-"));
  try {
    mkdirSync(join(dir, "east-claude-plugin", "scripts"), { recursive: true });
    mkdirSync(join(dir, "east-plugin", "scripts"), { recursive: true });
    for (const script of SCRIPTS) {
      copyFileSync(join(process.cwd(), "scripts", script), join(dir, "east-claude-plugin", "scripts", script));
      writeFileSync(join(dir, "east-plugin", "scripts", script), `echo "shared ${script} with: $*"\n`);
      const out = execFileSync("bash", [join(dir, "east-claude-plugin", "scripts", script), "-y"], { encoding: "utf-8" });
      assert.equal(out, `shared ${script} with: -y\n`, script);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
