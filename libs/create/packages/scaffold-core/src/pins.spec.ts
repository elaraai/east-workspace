/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { EAST_PY_DISTRIBUTIONS, readReleasePins, withReleasePins, type ReleasePins } from "./pins.js";
import { PINNED_UV_TABLE, TEMPLATES, readToml, templateWithPins } from "./spec-fixtures.js";

/** Pins files as `scripts/east-py-constraints.py` writes them: a lock, exported. */
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

/** A release's pins, as a template carries them. */
const pinsOf = (release: string): ReleasePins => ({
  release, constraints: [`elaraai-east-py==${release}`, `numpy==${release === "1.0.1" ? "2.3.5" : "2.4.4"}`], overrides: ["shap>=0.51.0"],
});

/** The keys of a pyproject's `[tool.uv]` table, as a TOML reader takes them. */
const uvKeys = (pyproject: string): string[] =>
  Object.keys((readToml(pyproject) as { tool: { uv: Record<string, unknown> } }).tool.uv).sort();

test("reads a template's release pins: the east distributions at its release, then its pins without their hashes or notes, and its overrides", () => {
  for (const eol of ["\n", "\r\n"]) {
    const template = templateWithPins({ constraints: CONSTRAINTS.replaceAll("\n", eol), overrides: OVERRIDES.replaceAll("\n", eol) });
    try {
      assert.deepEqual(readReleasePins(template), {
        release: "1.2.3b1",
        constraints: [
          ...EAST_PY_DISTRIBUTIONS.map((name) => `${name}==1.2.3b1`),
          "numpy==2.3.5 ; platform_machine == 'x86_64' and sys_platform == 'darwin'",
          "numpy==2.4.4 ; platform_machine != 'x86_64' or sys_platform != 'darwin'",
          "torch==2.15.0",
        ],
        overrides: ["shap>=0.51.0"],
      }, `each pin of a name, with its marker, of files written with ${JSON.stringify(eol)}`);
    } finally {
      rmSync(dirname(template), { recursive: true, force: true });
    }
  }
});

test("reads the repository's own release pins: one release, each pin a requirement", () => {
  const template = templateWithPins();
  try {
    const pins = readReleasePins(template);
    assert.ok(pins !== null);
    assert.match(pins.release, /^\d+\.\d+\.\d+((a|b|rc)\d+)?$/, "as python writes the release's version");
    assert.deepEqual(pins.constraints.slice(0, EAST_PY_DISTRIBUTIONS.length), EAST_PY_DISTRIBUTIONS.map((name) => `${name}==${pins.release}`));
    for (const pin of pins.constraints) assert.match(pin, /^[A-Za-z0-9][A-Za-z0-9._-]*==\S+( ; .+)?$/, pin);
    assert.ok(pins.overrides.length > 0);
  } finally {
    rmSync(dirname(template), { recursive: true, force: true });
  }
});

test("reads no pins of a template its build gave none, and refuses one file alone, or files of two releases, or of none", () => {
  assert.equal(readReleasePins(join(TEMPLATES, "e3")), null, "the source tree's template carries none");
  assert.equal(readReleasePins(join(TEMPLATES, "east")), null, "nor does create-east's, which has no python");
  for (const [files, refusal] of [
    [{ constraints: CONSTRAINTS, overrides: OVERRIDES.replace("1.2.3b1", "1.2.4") }, /different releases/],
    [{ constraints: CONSTRAINTS.replace(/^# The pins [^\n]*\n/, ""), overrides: OVERRIDES }, /names no release/],
  ] as const) {
    const template = templateWithPins(files);
    try {
      assert.throws(() => readReleasePins(template), refusal);
    } finally {
      rmSync(dirname(template), { recursive: true, force: true });
    }
  }
  const alone = templateWithPins();
  try {
    rmSync(join(alone, "_pins", "east-py-overrides.txt"));
    assert.throws(() => readReleasePins(alone), /holds east-py-constraints\.txt alone/);
  } finally {
    rmSync(dirname(alone), { recursive: true, force: true });
  }
});

test("writes the pins into a pyproject's [tool.uv] table, or a new one, and replaces an earlier release's in place", () => {
  const project = '[project]\nname = "demo"\ndependencies = ["elaraai-east-py"]\n\n[tool.east-py]\ncheck = false\n';
  const first = withReleasePins(project, pinsOf("1.0.1"));
  assert.ok(first.startsWith(project), "everything the project had stays, ahead of the block");
  assert.match(first, PINNED_UV_TABLE);
  assert.match(first, /# >>> east release pins[^\n]*\n(#[^\n]*\n)+constraint-dependencies = \[\n {2}"elaraai-east-py==1\.0\.1",\n/);
  assert.ok(first.endsWith("override-dependencies = [\n  \"shap>=0.51.0\",\n]\n# <<< east release pins\n"));
  assert.deepEqual(uvKeys(first), ["constraint-dependencies", "override-dependencies"], "a TOML reader takes it");

  const second = withReleasePins(`${first}\n[tool.pytest.ini_options]\naddopts = "-q"\n`, pinsOf("1.0.2"));
  assert.ok(second.includes('"elaraai-east-py==1.0.2"') && !second.includes("1.0.1"), "the later release's pins in place of the earlier's");
  assert.ok(second.startsWith(project) && second.endsWith('[tool.pytest.ini_options]\naddopts = "-q"\n'), "and nothing else moves");
  assert.equal(withReleasePins(second, pinsOf("1.0.2")), second, "the same release's pins again change nothing");

  // A [tool.uv] table of the project's own, however spaced: the block goes in it, after its header
  for (const header of ["[tool.uv]", "[ tool.uv ]  # uv's settings"]) {
    const own = withReleasePins(`[project]\nname = "demo"\n\n${header}\nindex-strategy = "unsafe-best-match"\n`, pinsOf("1.0.1"));
    assert.ok(own.includes(`${header}\n# >>> east release pins`), header);
    assert.ok(own.endsWith('# <<< east release pins\nindex-strategy = "unsafe-best-match"\n'), header);
    assert.equal(own.split("\n").filter((line) => line.includes("tool.uv")).length, 1, "the one table");
    assert.deepEqual(uvKeys(own), ["constraint-dependencies", "index-strategy", "override-dependencies"], header);
  }
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
  assert.deepEqual(uvKeys(pinned), ["constraint-dependencies", "override-dependencies", "sources", "workspace"]);
});

test("refuses a project that sets uv's constraints or overrides itself, outside the block, or whose block lost its last line", () => {
  for (const own of [
    '[tool.uv]\nconstraint-dependencies = ["numpy<3"]\n',
    '[tool.uv]\noverride-dependencies = ["numpy<3"]\n',
    'tool.uv.constraint-dependencies = ["numpy<3"]\n',
    '[tool.uv]\n"override-dependencies" = ["numpy<3"]\n',
  ]) {
    assert.throws(() => withReleasePins(`[project]\nname = "demo"\n\n${own}`, pinsOf("1.0.1")), /sets its own/, own);
  }
  // Within the block they are the release's, and are replaced
  const pinned = withReleasePins('[project]\nname = "demo"\n', pinsOf("1.0.1"));
  assert.doesNotThrow(() => withReleasePins(pinned, pinsOf("1.0.2")));
  assert.throws(() => withReleasePins(pinned.replace("# <<< east release pins\n", ""), pinsOf("1.0.2")), /lost their last line/);
});
