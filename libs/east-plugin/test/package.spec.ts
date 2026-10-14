import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assemblePlugin, symlinksUnder } from "../lib/package.js";
import type { SkillNames } from "../lib/codex-skills.js";

// A plugin assembled as a host installs it (#1309): every file real, a
// generated package.json with no dependency, and a tarball npm packs with the
// manifest directory and the bundles in it — the dotfiles a host needs.

const ACME: SkillNames = {
  claudeToolPrefix: "mcp__plugin_acme_acme__",
  claudeSkillPrefix: "/acme:",
  codexSkillPrefix: "$acme-codex-plugin:",
  claudePlugin: "acme-claude-plugin",
  codexPlugin: "acme-codex-plugin",
};

const SKILL = "---\nname: acme\ndescription: \"Acme from Claude Code.\"\n---\n\nCall `mcp__plugin_acme_acme__search_acme_examples`, then /acme:acme.\n";

/** A plugin source as a host package holds it, its skills catalog linking into an owning package. */
function fixture(dir: string, host: "claude" | "codex"): { source: string; skills: string; index: string } {
  const source = join(dir, `acme-${host}-plugin`);
  const manifestDir = host === "claude" ? ".claude-plugin" : ".codex-plugin";
  mkdirSync(join(source, manifestDir), { recursive: true });
  writeFileSync(join(source, manifestDir, "plugin.json"), JSON.stringify({
    name: host === "claude" ? "acme" : "acme-codex-plugin",
    version: "1.2.3",
    description: "Acme's plugin",
    repository: "https://github.com/acme/acme",
    license: "AGPL-3.0",
    keywords: ["acme"],
  }));
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: `@acme/acme-${host}-plugin`, version: "0.0.1", private: true, type: "module", license: "AGPL-3.0-or-later", dependencies: { "@elaraai/east-plugin": "workspace:*" } }));
  mkdirSync(join(source, "hooks"));
  writeFileSync(join(source, "hooks", "hooks.json"), JSON.stringify({ hooks: {} }));
  writeFileSync(join(source, "hooks", "pre-write.ts"), "export {};\n");
  writeFileSync(join(source, ".mcp.json"), JSON.stringify({ mcpServers: {} }));
  writeFileSync(join(source, ".lsp.json"), JSON.stringify({}));
  mkdirSync(join(source, ".build", "hooks"), { recursive: true });
  writeFileSync(join(source, ".build", "hooks", "pre-write.js"), "export {};\n");
  writeFileSync(join(source, "README.md"), "# acme\n");
  writeFileSync(join(source, "LICENSE.md"), "license\n");
  writeFileSync(join(source, ".gitignore"), ".build/\n");
  // the skills catalog: one skill owned elsewhere, reached by a symlink
  const owning = join(dir, "owning-package");
  mkdirSync(owning, { recursive: true });
  writeFileSync(join(owning, "SKILL.md"), SKILL);
  const skills = join(dir, `skills-${host}`);
  mkdirSync(join(skills, "acme"), { recursive: true });
  symlinkSync(join(owning, "SKILL.md"), join(skills, "acme", "SKILL.md"));
  writeFileSync(join(skills, "acme", "data.json"), "{}\n");
  writeFileSync(join(skills, "README.txt"), "not a skill\n");
  const index = join(dir, `index-${host}.json`);
  writeFileSync(index, JSON.stringify({ entries: [] }));
  return { source, skills, index };
}

/** The paths `npm pack` would put in the tarball of `dir`. */
function packed(dir: string): string[] {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: dir, encoding: "utf8", shell: process.platform === "win32" });
  const [report] = JSON.parse(out) as [{ files: { path: string }[] }];
  return report!.files.map((f) => f.path).sort();
}

/** The repository `plugin.json`'s `repository` string becomes in the assembled manifest. */
async function repositoryFor(dir: string, repository: string): Promise<unknown> {
  const { source, skills } = fixture(mkdtempSync(join(dir, "r-")), "claude");
  const manifestPath = join(source, ".claude-plugin", "plugin.json");
  writeFileSync(manifestPath, JSON.stringify({ ...(JSON.parse(readFileSync(manifestPath, "utf8")) as object), repository }));
  return (await assemblePlugin({ host: "claude", source, skills, out: join(dirname(source), "out") })).repository;
}

test("a Claude Code plugin is assembled with real files, a dependency-free manifest, and a tarball that carries its dotfiles", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acme-plugin-"));
  try {
    const { source, skills, index } = fixture(dir, "claude");
    const out = join(dir, "marketplace", "acme-claude-plugin");
    const manifest = await assemblePlugin({ host: "claude", source, skills, index, out });
    assert.equal(manifest.name, "@acme/acme-claude-plugin");
    assert.equal(manifest.version, "1.2.3");
    assert.equal(manifest.type, "module");
    assert.equal(manifest.license, "AGPL-3.0-or-later");
    assert.deepEqual(manifest.repository, { type: "git", url: "git+https://github.com/acme/acme.git" });
    assert.deepEqual(manifest.files, [".claude-plugin", ".build", "hooks", "skills", ".mcp.json", ".lsp.json", "index.json"]);
    const written = JSON.parse(readFileSync(join(out, "package.json"), "utf8")) as Record<string, unknown>;
    assert.deepEqual(written, manifest);
    assert.equal("dependencies" in written, false);
    assert.equal("private" in written, false);
    assert.deepEqual(await symlinksUnder(out), []);
    assert.equal(lstatSync(join(out, "skills", "acme", "SKILL.md")).isSymbolicLink(), false);
    assert.equal(readFileSync(join(out, "skills", "acme", "SKILL.md"), "utf8"), SKILL, "Claude Code's skills are copied as written");
    assert.equal(readFileSync(join(out, "skills", "acme", "data.json"), "utf8"), "{}\n");
    assert.equal(lstatSync(join(out, "hooks", "hooks.json")).isFile(), true);
    assert.equal(lstatSync(join(out, ".build", "hooks", "pre-write.js")).isFile(), true);
    for (const absent of ["hooks/pre-write.ts", ".gitignore", "skills/README.txt"]) {
      assert.throws(() => lstatSync(join(out, absent)), `${absent} is not shipped`);
    }
    assert.equal(existsSync(`${out}.assembling`), false, "nothing is left staged");
    assert.deepEqual(packed(out), [
      ".build/hooks/pre-write.js", ".claude-plugin/plugin.json", ".lsp.json", ".mcp.json", "LICENSE.md", "README.md",
      "hooks/hooks.json", "index.json", "package.json", "skills/acme/SKILL.md", "skills/acme/data.json",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a Codex plugin is assembled with its skills adapted in the plugin's names and its .lsp.json beside", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acme-plugin-"));
  try {
    const { source, skills, index } = fixture(dir, "codex");
    const out = join(dir, "marketplace", "acme-codex-plugin");
    const manifest = await assemblePlugin({ host: "codex", source, skills, index, out, names: ACME });
    assert.equal(manifest.name, "@acme/acme-codex-plugin");
    assert.deepEqual(manifest.files, [".codex-plugin", ".build", "hooks", "skills", ".mcp.json", ".lsp.json", "index.json"]);
    const skill = readFileSync(join(out, "skills", "acme", "SKILL.md"), "utf8");
    assert.match(skill, /Call `search_acme_examples`, then \$acme-codex-plugin:acme\./);
    assert.match(skill, /Acme from Codex\./);
    assert.deepEqual(await symlinksUnder(out), []);
    const tarball = packed(out);
    assert.ok(tarball.includes(".codex-plugin/plugin.json"));
    assert.ok(tarball.includes(".lsp.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a plugin's optional parts ship when it has them and are not required: no hooks, with commands and agents", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acme-plugin-"));
  try {
    const { source, skills } = fixture(dir, "claude");
    rmSync(join(source, "hooks"), { recursive: true });
    rmSync(join(source, ".lsp.json"));
    mkdirSync(join(source, "commands"));
    writeFileSync(join(source, "commands", "acme.md"), "# /acme\n");
    mkdirSync(join(source, "agents"));
    writeFileSync(join(source, "agents", "reviewer.md"), "# reviewer\n");
    const out = join(dir, "out");
    const manifest = await assemblePlugin({ host: "claude", source, skills, out });
    assert.deepEqual(manifest.files, [".claude-plugin", ".build", "skills", ".mcp.json", "commands", "agents"]);
    assert.equal(existsSync(join(out, "hooks")), false);
    assert.equal(readFileSync(join(out, "commands", "acme.md"), "utf8"), "# /acme\n");
    assert.equal(readFileSync(join(out, "agents", "reviewer.md"), "utf8"), "# reviewer\n");
    assert.ok(packed(out).includes("commands/acme.md"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a skill reached through a linked directory is copied for Claude Code and adapted for Codex", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acme-plugin-"));
  try {
    const { source, skills } = fixture(dir, "claude");
    const owning = join(dir, "owning-skill");
    mkdirSync(join(owning, "reference"), { recursive: true });
    writeFileSync(join(owning, "SKILL.md"), SKILL.replace("name: acme", "name: linked"));
    writeFileSync(join(owning, "reference", "api.md"), "# api\n");
    symlinkSync(owning, join(skills, "linked"), "dir");
    const out = join(dir, "out-claude");
    await assemblePlugin({ host: "claude", source, skills, out });
    assert.equal(lstatSync(join(out, "skills", "linked")).isSymbolicLink(), false);
    assert.match(readFileSync(join(out, "skills", "linked", "SKILL.md"), "utf8"), /name: linked/);
    assert.equal(readFileSync(join(out, "skills", "linked", "reference", "api.md"), "utf8"), "# api\n");
    assert.deepEqual(await symlinksUnder(out), []);
    const codex = fixture(dir, "codex");
    symlinkSync(owning, join(codex.skills, "linked"), "dir");
    const outCodex = join(dir, "out-codex");
    await assemblePlugin({ host: "codex", source: codex.source, skills: codex.skills, out: outCodex, names: ACME });
    assert.match(readFileSync(join(outCodex, "skills", "linked", "SKILL.md"), "utf8"), /Acme from Codex\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a repository is written as npm expects it: GitHub forms normalized, every other form as given", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acme-plugin-"));
  try {
    assert.deepEqual(await repositoryFor(dir, "acme/acme"), { type: "git", url: "git+https://github.com/acme/acme.git" });
    assert.deepEqual(await repositoryFor(dir, "github:acme/acme"), { type: "git", url: "git+https://github.com/acme/acme.git" });
    assert.deepEqual(await repositoryFor(dir, "https://github.com/acme/acme.git"), { type: "git", url: "git+https://github.com/acme/acme.git" });
    assert.deepEqual(await repositoryFor(dir, "git+https://gitlab.com/acme/acme.git"), { type: "git", url: "git+https://gitlab.com/acme/acme.git" });
    assert.deepEqual(await repositoryFor(dir, "git@github.com:acme/acme.git"), { type: "git", url: "git@github.com:acme/acme.git" });
    assert.deepEqual(await repositoryFor(dir, "git+ssh://git@github.com/acme/acme.git"), { type: "git", url: "git+ssh://git@github.com/acme/acme.git" });
    assert.deepEqual(await repositoryFor(dir, "gitlab:acme/acme"), { type: "git", url: "gitlab:acme/acme" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an earlier assembly is replaced; anything else in the way is refused; an unbundled source is refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acme-plugin-"));
  try {
    const { source, skills, index } = fixture(dir, "claude");
    const out = join(dir, "out");
    await assemblePlugin({ host: "claude", source, skills, index, out });
    writeFileSync(join(out, "stale.txt"), "from the earlier assembly\n");
    await assemblePlugin({ host: "claude", source, skills, out });
    assert.throws(() => lstatSync(join(out, "stale.txt")), "the earlier assembly is gone");
    assert.throws(() => lstatSync(join(out, "index.json")), "no index was given this time");
    const other = join(dir, "other");
    mkdirSync(other);
    writeFileSync(join(other, "notes.txt"), "mine\n");
    await assert.rejects(assemblePlugin({ host: "claude", source, skills, out: other }), /not an earlier assembly/);
    assert.equal(readFileSync(join(other, "notes.txt"), "utf8"), "mine\n");
    rmSync(join(source, ".build"), { recursive: true });
    await assert.rejects(assemblePlugin({ host: "claude", source, skills, out: join(dir, "again") }), /no \.build\//);
    assert.equal(existsSync(join(dir, "again")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed assembly leaves the earlier one as it was and nothing staged, and the next one succeeds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acme-plugin-"));
  try {
    const { source, skills, index } = fixture(dir, "codex");
    const out = join(dir, "out");
    await assemblePlugin({ host: "codex", source, skills, index, out, names: ACME });
    const before = readFileSync(join(out, "package.json"), "utf8");
    // A skill with no frontmatter fails the Codex adaptation, after the
    // manifest directory and the bundles were already staged.
    mkdirSync(join(skills, "broken"));
    writeFileSync(join(skills, "broken", "SKILL.md"), "no frontmatter\n");
    await assert.rejects(assemblePlugin({ host: "codex", source, skills, index, out, names: ACME }), /frontmatter/);
    assert.equal(readFileSync(join(out, "package.json"), "utf8"), before, "the earlier assembly is untouched");
    assert.equal(existsSync(join(out, "skills", "acme", "SKILL.md")), true);
    assert.equal(existsSync(`${out}.assembling`), false, "the staging directory is gone");
    rmSync(join(skills, "broken"), { recursive: true });
    await assemblePlugin({ host: "codex", source, skills, index, out, names: ACME });
    assert.equal(existsSync(join(out, "index.json")), true);
    // A missing index fails a Claude Code assembly the same way, into a fresh out.
    const claude = fixture(dir, "claude");
    const fresh = join(dir, "fresh");
    await assert.rejects(assemblePlugin({ host: "claude", source: claude.source, skills: claude.skills, index: join(dir, "missing.json"), out: fresh }), /ENOENT/);
    assert.equal(existsSync(fresh), false);
    assert.equal(existsSync(`${fresh}.assembling`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an out that overlaps the source, the skills or the index is refused before anything is written", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acme-plugin-"));
  try {
    const { source, skills, index } = fixture(dir, "claude");
    for (const out of [source, join(source, "nested"), dirname(source), skills, join(skills, "acme"), dirname(index)]) {
      await assert.rejects(assemblePlugin({ host: "claude", source, skills, index, out }), /overlaps the (source|skills|index)/);
    }
    assert.equal(readFileSync(join(source, "package.json"), "utf8").includes("@acme/acme-claude-plugin"), true, "the source is intact");
    assert.equal(lstatSync(join(skills, "acme", "SKILL.md")).isSymbolicLink(), true, "the skills are intact");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the assembler script refuses a marketplace directory holding anything it did not write, and a flag with no value", () => {
  const script = resolve(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "package.js");
  const dir = mkdtempSync(join(tmpdir(), "acme-plugin-"));
  try {
    writeFileSync(join(dir, "package.json"), "{}\n");
    const foreign = spawnSync(process.execPath, [script, "--out", dir], { encoding: "utf8" });
    assert.equal(foreign.status, 2);
    assert.match(foreign.stderr, /Refusing to write a marketplace into .*: it holds package\.json/);
    assert.equal(readFileSync(join(dir, "package.json"), "utf8"), "{}\n");
    const dangling = spawnSync(process.execPath, [script, "--out"], { encoding: "utf8" });
    assert.notEqual(dangling.status, 0);
    assert.match(dangling.stderr, /--out needs a value/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
