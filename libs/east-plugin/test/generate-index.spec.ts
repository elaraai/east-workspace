import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateIndex, type IndexConfig, type IndexEntry } from "../scripts/generate-index.js";

// The index generator over a downstream plugin's own corpus (#1234): its
// sources, its hand-written entries, its output — from code, and as the
// command. Importing the module runs nothing: this test's own import proves it.

const EXAMPLES = `import { example } from "@elaraai/east";

// ---
// Deploys
// ---

export const deployApp = example({
    keywords: ["deploy", "app"],
    description: "deploys an app to the cloud",
    fn: deployTo("cloud"),
    inputs: [],
});
`;

const CLI_ENTRY: IndexEntry = {
  id: "acme:cli:deploy",
  skill: "acme",
  package: "acme",
  file: "cli",
  suite: "CLI",
  test: "acme deploy <app>",
  keywords: ["deploy", "cli"],
  imports: [],
  languages: ["typescript"],
  source: "acme deploy my-app",
};

function corpus(): { dir: string; config: IndexConfig } {
  const dir = mkdtempSync(join(tmpdir(), "acme-index-"));
  mkdirSync(join(dir, "acme", "test"), { recursive: true });
  writeFileSync(join(dir, "acme", "test", "deploy.examples.ts"), EXAMPLES);
  return { dir, config: { sources: [{ package: "acme", skill: "acme", testDir: "acme", pattern: "**/*.examples.ts" }] } };
}

test("generateIndex indexes a plugin's own examples and hand-written entries", async () => {
  const { dir, config } = corpus();
  try {
    const output = await generateIndex({ baseDir: dir, config, staticEntries: [CLI_ENTRY], log: () => undefined });
    assert.deepEqual(output.entries.map((e) => e.id), ["acme:deploy.examples.ts:deployApp", "acme:cli:deploy"]);
    const [deploy] = output.entries;
    assert.equal(deploy?.suite, "Deploys");
    assert.equal(deploy?.test, "deploys an app to the cloud");
    assert.deepEqual(deploy?.keywords, ["deploy", "app"]);
    assert.deepEqual(deploy?.languages, ["typescript"]);
    assert.match(deploy?.source ?? "", /deployTo\("cloud"\)/);
    assert.equal(deploy?.file, "acme/test/deploy.examples.ts");
    assert.deepEqual(output.stats, { totalEntries: 2, totalFiles: 1, packages: { acme: 2 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the command takes the plugin's config, hand-written entries and output path", async () => {
  const { dir, config } = corpus();
  try {
    writeFileSync(join(dir, "index.config.json"), JSON.stringify(config));
    writeFileSync(join(dir, "index.static.json"), JSON.stringify({ entries: [CLI_ENTRY] }));
    const script = fileURLToPath(new URL("../scripts/generate-index.js", import.meta.url));
    const out = join(dir, "index.json");
    const run = spawnSync(process.execPath, [script, "--base-dir", dir, "--config", join(dir, "index.config.json"), "--static", join(dir, "index.static.json"), "--out", out], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const written = JSON.parse(readFileSync(out, "utf8")) as { entries: IndexEntry[] };
    const expected = await generateIndex({ baseDir: dir, config, staticEntries: [CLI_ENTRY], log: () => undefined });
    assert.deepEqual(written, JSON.parse(JSON.stringify(expected)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a config with no sources is refused", async () => {
  await assert.rejects(generateIndex({ baseDir: tmpdir(), config: { sources: [] }, log: () => undefined }), /sources array is empty/);
});
