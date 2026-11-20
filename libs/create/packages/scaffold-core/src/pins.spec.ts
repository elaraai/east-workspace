/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { hasReleasePins, parseReleasePins, readReleasePins, withReleasePins } from "./pins.js";
import { PINNED_UV_TABLE, TEMPLATES, pinsOf, readToml, repositoryPinTexts, templateWithPins } from "./spec-fixtures.js";

/** Pin files as `scripts/east-py-constraints.py` writes them: a lock, exported. */
const CONSTRAINTS = [
  "# The pins the east-py packages of release 1.2.3b1 were tested with: their",
  "# workspace's lock, exported by scripts/east-py-constraints.py. Not edited by hand.",
  "numpy==2.3.5 ; platform_machine == 'x86_64' and sys_platform == 'darwin' \\",
  "    --hash=sha256:aaaa \\",
  "    --hash=sha256:bbbb",
  "    # via",
  "    #   pandas",
  "numpy==2.4.4 ; platform_machine != 'x86_64' or sys_platform != 'darwin' \\",
  "    --hash=sha256:cccc",
  "torch==2.15.0 \\",
  "    --hash=sha256:dddd",
  "    # via elaraai-east-py-datascience",
  "",
].join("\n");
const OVERRIDES = [
  "# The overrides the east-py packages of release 1.2.3b1 were tested with: their",
  "# workspace's override-dependencies. Not edited by hand.",
  "shap>=0.51.0",
  "",
].join("\n");
const OWN = ["elaraai-east-py", "elaraai-east-py-std"];

/** The keys of a pyproject's `[tool.uv]` table, read as TOML. */
const uvKeys = (pyproject: string): string[] =>
  Object.keys((readToml(pyproject) as { tool: { uv: Record<string, unknown> } }).tool.uv).sort();

/** The pins of a pyproject's `[tool.uv]` table, read as TOML. */
const uvPins = (pyproject: string): string[] =>
  (readToml(pyproject) as { tool: { uv: { "constraint-dependencies": string[] } } }).tool.uv["constraint-dependencies"];

test("parses a release's pin files: its own distributions at its release, then its pins without their hashes or notes, and its overrides", () => {
  for (const eol of ["\n", "\r\n"]) {
    assert.deepEqual(parseReleasePins({ constraints: CONSTRAINTS.replaceAll("\n", eol), overrides: OVERRIDES.replaceAll("\n", eol), distributions: OWN }), {
      release: "1.2.3b1",
      constraints: [
        "elaraai-east-py==1.2.3b1",
        "elaraai-east-py-std==1.2.3b1",
        "numpy==2.3.5 ; platform_machine == 'x86_64' and sys_platform == 'darwin'",
        "numpy==2.4.4 ; platform_machine != 'x86_64' or sys_platform != 'darwin'",
        "torch==2.15.0",
      ],
      overrides: ["shap>=0.51.0"],
    }, `each pin of a name, with its marker, of files written with ${JSON.stringify(eol)}`);
  }
});

test("parses the repository's own pin files as create-e3's build does: every distribution of the release's own pinned at it", () => {
  const files = repositoryPinTexts();
  const pins = parseReleasePins(files);
  assert.match(pins.release, /^\d+\.\d+\.\d+((a|b|rc)\d+)?$/, "as python writes the release's version");
  assert.ok(files.distributions.includes("elaraai-east-py-datascience"), "the release's own, read from its pyproject.toml files");
  assert.deepEqual(pins.constraints.slice(0, files.distributions.length), files.distributions.map((name) => `${name}==${pins.release}`));
  assert.ok(pins.constraints.length > 100 && pins.overrides.length > 0);
});

test("refuses pin files of two releases, of none, with a pin that is not name==version, or with no distribution of the release's own", () => {
  for (const [files, refusal] of [
    [{ constraints: CONSTRAINTS, overrides: OVERRIDES.replace("1.2.3b1", "1.2.4"), distributions: OWN }, /different releases/],
    [{ constraints: CONSTRAINTS.replace(/^# The pins [^\n]*\n/, ""), overrides: OVERRIDES, distributions: OWN }, /constraints name no release/],
    [{ constraints: `${CONSTRAINTS}torch @ https://example.org/torch.whl\n`, overrides: OVERRIDES, distributions: OWN }, /not name==version.*torch @/],
    [{ constraints: CONSTRAINTS, overrides: OVERRIDES, distributions: [] }, /own distributions/],
  ] as const) {
    assert.throws(() => parseReleasePins(files), refusal);
  }
});

test("reads the pins a template carries, none of one its build gave none, and refuses a file that is not a release's pins", () => {
  assert.equal(readReleasePins(join(TEMPLATES, "e3")), null, "the source tree's template carries none");
  assert.equal(readReleasePins(join(TEMPLATES, "east")), null, "nor does create-east's, which has no python");
  for (const [pins, expected] of [[pinsOf("1.0.1"), pinsOf("1.0.1")], ['{"release":"1.0.1"}', null], ["[]", null]] as const) {
    const template = templateWithPins(pins);
    try {
      if (expected === null) assert.throws(() => readReleasePins(template), /not a release's pins/);
      else assert.deepEqual(readReleasePins(template), expected);
    } finally {
      rmSync(dirname(template), { recursive: true, force: true });
    }
  }
});

test("writes the pins into a pyproject's [tool.uv] table, or a new one, and replaces an earlier release's in place", () => {
  const project = '[project]\nname = "demo"\ndependencies = ["elaraai-east-py"]\n\n[tool.east-py]\ncheck = false\n';
  const first = withReleasePins(project, pinsOf("1.0.1"));
  assert.ok(first.startsWith(project), "everything the project had stays, ahead of the block");
  assert.match(first, PINNED_UV_TABLE);
  assert.match(first, /# >>> east release pins[^\n]*\n(#[^\n]*\n)+constraint-dependencies = \[\n {2}"elaraai-east-py==1\.0\.1",\n/);
  assert.ok(first.endsWith("override-dependencies = [\n  \"shap>=0.51.0\",\n]\n# <<< east release pins\n"));
  assert.deepEqual(uvKeys(first), ["constraint-dependencies", "override-dependencies"]);
  assert.ok(hasReleasePins(first) && !hasReleasePins(project));

  const second = withReleasePins(`${first}\n[tool.pytest.ini_options]\naddopts = "-q"\n`, pinsOf("1.0.2"));
  assert.ok(second.includes('"elaraai-east-py==1.0.2"') && !second.includes("1.0.1"), "the later release's pins in place of the earlier's");
  assert.ok(second.startsWith(project) && second.endsWith('[tool.pytest.ini_options]\naddopts = "-q"\n'), "and nothing else moves");
  assert.equal(withReleasePins(second, pinsOf("1.0.2")), second, "the same release's pins again change nothing");

  // A [tool.uv] table of the project's own, however spaced or quoted: the block goes in it, after its header
  for (const header of ["[tool.uv]", "[ tool.uv ]  # uv's settings", "[tool.\"uv\"]"]) {
    const own = withReleasePins(`[project]\nname = "demo"\n\n${header}\nindex-strategy = "unsafe-best-match"\n`, pinsOf("1.0.1"));
    assert.ok(own.includes(`${header}\n# >>> east release pins`), header);
    assert.ok(own.endsWith('# <<< east release pins\nindex-strategy = "unsafe-best-match"\n'), header);
    assert.deepEqual(uvKeys(own), ["constraint-dependencies", "index-strategy", "override-dependencies"], header);
  }
});

test("leaves out a pin of a package the project is: its own name, a package it takes from a source of its own, and a member named", () => {
  const pins = { release: "1.0.1", constraints: ["elaraai-east-py==1.0.1", "rich==13.9.4", "Optuna==4.0.0", "pricing==1.0", "numpy==2.4.4"], overrides: [] };
  const named = withReleasePins('[project]\nname = "rich"\n', pins);
  assert.deepEqual(uvPins(named), ["elaraai-east-py==1.0.1", "Optuna==4.0.0", "pricing==1.0", "numpy==2.4.4"], "uv refuses a pin of the project itself");
  const workspace = '[project]\nname = "shop"\n\n[tool.uv.workspace]\nmembers = ["packages/python/*"]\n\n[tool.uv.sources]\npricing = { workspace = true }\n';
  assert.deepEqual(uvPins(withReleasePins(workspace, pins, ["optuna"])), ["elaraai-east-py==1.0.1", "rich==13.9.4", "numpy==2.4.4"],
    "a source of its own, and a member named, by the name as PEP 503 compares names");
  assert.equal(withReleasePins(named, pins), named, "the same pins again change nothing");
});

test("writes the pins after a workspace's sub-tables, which TOML allows, and keeps a CRLF file's line endings", () => {
  const workspace = '[project]\nname = "shop"\n\n[tool.uv.workspace]\nmembers = ["packages/python/*"]\n\n[tool.uv.sources]\npricing = { workspace = true }\n';
  assert.deepEqual(uvKeys(withReleasePins(workspace, pinsOf("1.0.1"))), ["constraint-dependencies", "override-dependencies", "sources", "workspace"]);

  const crlf = workspace.replaceAll("\n", "\r\n");
  const pinned = withReleasePins(crlf, pinsOf("1.0.1"));
  assert.ok(pinned.startsWith(crlf), "the file as it was, ahead of the block");
  assert.ok(!pinned.replaceAll("\r\n", "").includes("\n"), "every line ends as the file's do");
  assert.equal(withReleasePins(pinned, pinsOf("1.0.1")), pinned, "and the same pins again change nothing");
  assert.equal(withReleasePins(pinned, pinsOf("1.0.2")), withReleasePins(crlf, pinsOf("1.0.2")), "a later release's replace them in place");
  assert.ok(hasReleasePins(pinned));
});

test("keeps each line's own ending in a file of mixed endings: the same pins again give back its bytes", () => {
  const crlf = withReleasePins('[project]\r\nname = "demo"\r\n', pinsOf("1.0.1"));
  const mixed = `${crlf}\n[tool.ruff]\nline-length = 100\n`;
  assert.equal(withReleasePins(mixed, pinsOf("1.0.1")), mixed, "no line's ending moves on a run that changes nothing");
  const moved = withReleasePins(mixed, pinsOf("1.0.2"));
  assert.ok(moved.includes('"elaraai-east-py==1.0.2",\r\n') && moved.endsWith("\n[tool.ruff]\nline-length = 100\n"), "the block's lines keep theirs, the rest theirs");
});

test("finds the block a formatter indented, and replaces it in place", () => {
  const pinned = withReleasePins('[project]\nname = "demo"\n', pinsOf("1.0.1"));
  const indented = pinned.replace(/^(# |constraint-|override-|\]|  ")/gm, (line) => `  ${line}`);
  assert.ok(indented.includes("  # >>> east release pins") && indented.includes("  # <<< east release pins"));
  const again = withReleasePins(indented, pinsOf("1.0.2"));
  assert.ok(again.includes('"elaraai-east-py==1.0.2"') && !again.includes("1.0.1"), "the indented block is the release's, not the project's own");
  assert.equal(again.match(/# >>> east release pins/g)?.length, 1, "replaced, not given a second");
});

test("refuses a project that sets uv's constraints or overrides itself, in any form TOML allows, outside the block", () => {
  const project = '[project]\nname = "demo"\n';
  for (const own of [
    `${project}\n[tool.uv]\nconstraint-dependencies = ["numpy<3"]\n`,
    `${project}\n[tool.uv]\noverride-dependencies = ["numpy<3"]\n`,
    `tool.uv.constraint-dependencies = ["numpy<3"]\n\n${project}`,
    `${project}\n[tool]\nuv.constraint-dependencies = ["numpy<3"]\n`,
    `${project}\n[tool]\nuv = { override-dependencies = ["numpy<3"] }\n`,
    `${project}\n[tool.uv]\n"override-dependencies" = ["numpy<3"]\n`,
  ]) {
    assert.throws(() => withReleasePins(own, pinsOf("1.0.1")), /sets its own/, own);
  }
  // A key of that name in another table is not uv's: [project]'s own `tool.uv…`
  const elsewhere = `${project}tool.uv.constraint-dependencies = ["numpy<3"]\n`;
  assert.deepEqual(uvKeys(withReleasePins(elsewhere, pinsOf("1.0.1"))), ["constraint-dependencies", "override-dependencies"]);
});

test("refuses a [tool.uv] it cannot add the block to, a file that is not TOML, and a block that lost its last line", () => {
  for (const form of ['[tool]\nuv.package = false\n', 'tool.uv.index-url = "https://example.org"\n', '[tool]\nuv = { package = false }\n']) {
    assert.throws(() => withReleasePins(`${form}\n[project]\nname = "demo"\n`, pinsOf("1.0.1")), /cannot be added to/, form);
  }
  assert.throws(() => withReleasePins('[project\nname = "demo"\n', pinsOf("1.0.1")), /not TOML/);
  const pinned = withReleasePins('[project]\nname = "demo"\n', pinsOf("1.0.1"));
  assert.throws(() => withReleasePins(pinned.replace("# <<< east release pins\n", ""), pinsOf("1.0.2")), /lost their last line/);
  assert.throws(() => hasReleasePins(pinned.replace("# <<< east release pins\n", "")), /lost their last line/);
});

test("takes a [tool.uv] line inside a multi-line string for what it is: the block goes in the real table, or a table of its own", () => {
  const description = '[project]\nname = "demo"\ndescription = """\n[tool.uv]\n"""\n';
  const own = withReleasePins(description, pinsOf("1.0.1"));
  assert.equal((readToml(own) as { project: { description: string } }).project.description, "[tool.uv]\n", "the string as it was");
  assert.deepEqual(uvKeys(own), ["constraint-dependencies", "override-dependencies"]);
  // A real [tool.uv] table below the string's line takes it
  const both = withReleasePins(`${description}\n[tool.uv]\nindex-strategy = "unsafe-best-match"\n`, pinsOf("1.0.1"));
  assert.deepEqual(uvKeys(both), ["constraint-dependencies", "index-strategy", "override-dependencies"]);
  assert.equal((readToml(both) as { project: { description: string } }).project.description, "[tool.uv]\n");
});
