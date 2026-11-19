/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { updateStack } from "./update.js";
import { withReleasePins } from "./pins.js";
import { pinsOf } from "./spec-fixtures.js";

function projectDir(pkg: Record<string, unknown>, opts?: { lock?: boolean; pyproject?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "update-test-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  if (opts?.lock) writeFileSync(join(dir, "package-lock.json"), "{}\n");
  if (opts?.pyproject !== undefined) writeFileSync(join(dir, "pyproject.toml"), opts.pyproject);
  return dir;
}

const PYPROJECT = '[project]\nname = "demo"\ndependencies = ["elaraai-east-py"]\n';

/** A project of release 1.0.35, with a pyproject.toml as given. */
const e3Project = (pyproject?: string): string =>
  projectDir({ name: "demo", dependencies: { "@elaraai/e3": "1.0.35" } }, pyproject === undefined ? undefined : { pyproject });

function readPkg(dir: string): Record<string, Record<string, string>> {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

const silent = { install: false, log: () => {} } as const;

test("rewrites every @elaraai/* pin across all buckets and leaves others alone", () => {
  const dir = projectDir({
    name: "demo",
    dependencies: { "@elaraai/e3": "1.0.35", "@elaraai/east": "1.0.35", "smol-toml": "^1.3.1" },
    devDependencies: { "@elaraai/e3-cli": "1.0.35", typescript: "^5" },
    peerDependencies: { "@elaraai/east": "1.0.35" },
    optionalDependencies: { "@elaraai/east-c-cli": "1.0.35" },
  });
  try {
    const result = updateStack({ cwd: dir, version: "1.0.42", ...silent });
    const pkg = readPkg(dir);
    assert.equal(pkg.dependencies["@elaraai/e3"], "1.0.42");
    assert.equal(pkg.dependencies["@elaraai/east"], "1.0.42");
    assert.equal(pkg.dependencies["smol-toml"], "^1.3.1"); // untouched
    assert.equal(pkg.devDependencies["@elaraai/e3-cli"], "1.0.42");
    assert.equal(pkg.devDependencies["typescript"], "^5"); // untouched
    assert.equal(pkg.peerDependencies["@elaraai/east"], "1.0.42");
    assert.equal(pkg.optionalDependencies["@elaraai/east-c-cli"], "1.0.42");
    assert.equal(result.found, 5);
    assert.equal(result.changed.length, 5);
    assert.equal(result.installed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("drops the stale lockfile when pins change", () => {
  const dir = projectDir({ name: "demo", dependencies: { "@elaraai/e3": "1.0.35" } }, { lock: true });
  try {
    assert.ok(existsSync(join(dir, "package-lock.json")));
    updateStack({ cwd: dir, version: "1.0.42", ...silent });
    assert.ok(!existsSync(join(dir, "package-lock.json")), "stale lock should be removed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("is idempotent — a second run reports no changes and keeps the lock", () => {
  const dir = projectDir({ name: "demo", dependencies: { "@elaraai/e3": "1.0.42" } }, { lock: true });
  try {
    const result = updateStack({ cwd: dir, version: "1.0.42", ...silent });
    assert.equal(result.changed.length, 0);
    assert.equal(result.found, 1);
    assert.ok(existsSync(join(dir, "package-lock.json")), "no change -> lock left untouched");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("throws when there is no package.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "update-test-"));
  try {
    assert.throws(() => updateStack({ cwd: dir, version: "1.0.42", ...silent }), /no package\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("throws when the project has no @elaraai/* dependencies", () => {
  const dir = projectDir({ name: "demo", dependencies: { "smol-toml": "^1.3.1" } });
  try {
    assert.throws(() => updateStack({ cwd: dir, version: "1.0.42", ...silent }), /no @elaraai/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gives a project's block of an earlier release's python pins this release's, and keeps uv sync the next step while it carries them", () => {
  const dir = e3Project(withReleasePins(PYPROJECT, pinsOf("1.0.35")));
  try {
    const result = updateStack({ cwd: dir, version: "1.0.42", ...silent, pins: () => pinsOf("1.0.42") });
    assert.equal(readFileSync(join(dir, "pyproject.toml"), "utf8"), withReleasePins(PYPROJECT, pinsOf("1.0.42")), "the release's pins in place of the earlier's");
    assert.equal(result.pythonPinned, true);
    assert.equal(result.pythonLocked, false, "without an install, uv sync is the next step");
    // Run again with the block current: it still carries the pins, so uv sync
    // stays the next step until a sync locks under them
    const again = updateStack({ cwd: dir, version: "1.0.42", ...silent, pins: () => pinsOf("1.0.42") });
    assert.equal(again.pythonPinned, true);
    assert.equal(again.pythonLocked, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("leaves a project without the block as it is: one from before pins, one whose author removed them, one with constraints of its own", () => {
  for (const pyproject of [PYPROJECT, `${PYPROJECT}\n[tool.ruff]\nline-length = 100\n`, `${PYPROJECT}\n[tool.uv]\nconstraint-dependencies = ["numpy<3"]\n`]) {
    const dir = e3Project(pyproject);
    try {
      const said: string[] = [];
      const result = updateStack({ cwd: dir, version: "1.0.42", install: false, log: (msg) => said.push(msg), pins: () => pinsOf("1.0.42") });
      assert.equal(readFileSync(join(dir, "pyproject.toml"), "utf8"), pyproject);
      assert.equal(result.pythonPinned, false);
      assert.ok(said.some((msg) => msg.startsWith("pyproject.toml carries no east release pins")), said.join("\n"));
      assert.equal(readPkg(dir).dependencies["@elaraai/e3"], "1.0.42", "its npm stack is updated all the same");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("reads the release's pins only for a project that carries a block of them", () => {
  const unread = (): never => { throw new Error("the pins were read"); };
  for (const pyproject of [undefined, PYPROJECT]) {
    const dir = e3Project(pyproject);
    try {
      assert.equal(updateStack({ cwd: dir, version: "1.0.42", ...silent, pins: unread }).pythonPinned, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("an initializer that carries no pins (create-east's) leaves the block, and says how to move it", () => {
  const pinned = withReleasePins(PYPROJECT, pinsOf("1.0.35"));
  const dir = e3Project(pinned);
  try {
    const said: string[] = [];
    const result = updateStack({ cwd: dir, version: "1.0.42", install: false, log: (msg) => said.push(msg), pins: () => null });
    assert.equal(readFileSync(join(dir, "pyproject.toml"), "utf8"), pinned);
    assert.equal(result.pythonPinned, false);
    assert.ok(said.some((msg) => msg.includes("npm create @elaraai/e3@1.0.42 -- --update")), said.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a block that cannot take the pins is left as it is, and the log says why", () => {
  const lost = withReleasePins(PYPROJECT, pinsOf("1.0.35")).replace("# <<< east release pins\n", "");
  const dir = e3Project(lost);
  try {
    const said: string[] = [];
    const result = updateStack({ cwd: dir, version: "1.0.42", install: false, log: (msg) => said.push(msg), pins: () => pinsOf("1.0.42") });
    assert.equal(readFileSync(join(dir, "pyproject.toml"), "utf8"), lost);
    assert.equal(result.pythonPinned, false);
    assert.ok(said.some((msg) => msg.startsWith("Python pins not written: ") && msg.includes("lost their last line")), said.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("preserves 2-space indent and the trailing newline", () => {
  const dir = projectDir({ name: "demo", dependencies: { "@elaraai/e3": "1.0.35" } });
  try {
    updateStack({ cwd: dir, version: "1.0.42", ...silent });
    const raw = readFileSync(join(dir, "package.json"), "utf8");
    assert.ok(raw.startsWith('{\n  "name"'), "2-space indent preserved");
    assert.ok(raw.endsWith("}\n"), "trailing newline preserved");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
