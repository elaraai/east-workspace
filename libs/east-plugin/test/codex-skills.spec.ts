import { test } from "node:test";
import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EAST_SKILL_NAMES, adaptSkill, materializeSkills, type SkillNames } from "../lib/codex-skills.js";

// A Codex plugin's skills adapted in a plugin's own names (#1234): East's
// Codex plugin adapts East's, and a plugin that builds on East's adapts its own.

const ACME: SkillNames = {
  claudeToolPrefix: "mcp__plugin_acme_acme__",
  claudeSkillPrefix: "/acme:",
  codexSkillPrefix: "$acme-codex-plugin:",
  claudePlugin: "acme-claude-plugin",
  codexPlugin: "acme-codex-plugin",
};

const SKILL = [
  "---",
  "name: acme",
  `description: ${JSON.stringify("Deploy apps with <Deploy> from Claude Code.")}`,
  "---",
  "",
  "Call `mcp__plugin_acme_acme__search_acme_examples`, then load /acme:acme-cli.",
  "The acme-claude-plugin hooks run from ${CLAUDE_PLUGIN_ROOT}.",
  "",
].join("\n");

test("a skill is adapted in the plugin's names: its tools, its skills, its plugin, the host, and a description Codex takes", () => {
  const adapted = adaptSkill(SKILL, ACME);
  assert.match(adapted, /^description: "Deploy apps with \(Deploy\) from Codex\."$/m);
  assert.match(adapted, /^## Detailed skill scope\n\nDeploy apps with <Deploy> from Codex\.$/m);
  assert.match(adapted, /Call `search_acme_examples`, then load \$acme-codex-plugin:acme-cli\./);
  assert.match(adapted, /The acme-codex-plugin hooks run from \$\{PLUGIN_ROOT\}\./);
  assert.doesNotMatch(adapted, /mcp__plugin_acme_acme__|\/acme:|acme-claude-plugin|CLAUDE_PLUGIN_ROOT|Claude Code/);
});

test("East's names adapt East's skills, as its Codex plugin always has", () => {
  const adapted = adaptSkill("---\nname: east\ndescription: \"East.\"\n---\nUse `mcp__plugin_east_east__search_east_examples` and /east:east.\n", EAST_SKILL_NAMES);
  assert.match(adapted, /Use `search_east_examples` and \$east-codex-plugin:east\./);
  assert.equal(adaptSkill("---\nname: east\ndescription: \"East.\"\n---\nbody\n"), adaptSkill("---\nname: east\ndescription: \"East.\"\n---\nbody\n", EAST_SKILL_NAMES));
});

test("the skills are written as real files, the Markdown adapted and every other file copied", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acme-skills-"));
  try {
    const sources = join(dir, "sources");
    mkdirSync(join(sources, "acme"), { recursive: true });
    writeFileSync(join(sources, "acme", "SKILL.md"), SKILL);
    writeFileSync(join(sources, "acme", "data.json"), "{}\n");
    writeFileSync(join(sources, "README.txt"), "not a skill\n");
    const target = join(dir, "skills");
    assert.deepEqual(await materializeSkills(sources, target, ACME), ["acme"]);
    assert.equal(lstatSync(join(target, "acme", "SKILL.md")).isSymbolicLink(), false);
    assert.equal(readFileSync(join(target, "acme", "SKILL.md"), "utf8"), adaptSkill(SKILL, ACME));
    assert.equal(readFileSync(join(target, "acme", "data.json"), "utf8"), "{}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a skill with no frontmatter is refused", () => {
  assert.throws(() => adaptSkill("no frontmatter here\n", ACME), /Missing skill frontmatter/);
});
