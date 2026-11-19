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
import { withReleasePins, type ReleasePins } from "./pins.js";

function projectDir(pkg: Record<string, unknown>, opts?: { lock?: boolean; pyproject?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "update-test-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  if (opts?.lock) writeFileSync(join(dir, "package-lock.json"), "{}\n");
  if (opts?.pyproject !== undefined) writeFileSync(join(dir, "pyproject.toml"), opts.pyproject);
  return dir;
}

/** A release's python pins, as create-e3's template carries them. */
const pinsOf = (release: string): ReleasePins => ({ release, constraints: [`elaraai-east-py==${release}`, "numpy==2.4.4"], overrides: ["shap>=0.51.0"] });

const PYPROJECT = '[project]\nname = "demo"\ndependencies = ["elaraai-east-py"]\n';

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

test("gives a python project the release's pins in place of an earlier release's, and a project from before pins a block of them", () => {
  const dir = projectDir({ name: "demo", dependencies: { "@elaraai/e3": "1.0.35" } }, { pyproject: withReleasePins(PYPROJECT, pinsOf("1.0.35")) });
  const before = projectDir({ name: "demo", dependencies: { "@elaraai/e3": "1.0.35" } }, { pyproject: PYPROJECT });
  try {
    const result = updateStack({ cwd: dir, version: "1.0.42", ...silent, pins: pinsOf("1.0.42") });
    const pinned = readFileSync(join(dir, "pyproject.toml"), "utf8");
    assert.ok(pinned.includes('"elaraai-east-py==1.0.42"') && !pinned.includes("1.0.35"), "the release's pins in place of the earlier's");
    assert.equal(result.pythonPinned, true);
    assert.equal(result.pythonLocked, false, "without an install, uv sync is the next step");
    assert.equal(updateStack({ cwd: dir, version: "1.0.42", ...silent, pins: pinsOf("1.0.42") }).pythonPinned, false, "the same release again changes nothing");

    assert.equal(updateStack({ cwd: before, version: "1.0.42", ...silent, pins: pinsOf("1.0.42") }).pythonPinned, true);
    assert.equal(readFileSync(join(before, "pyproject.toml"), "utf8"), withReleasePins(PYPROJECT, pinsOf("1.0.42")), "a block, as a scaffold of the release writes it");
  } finally {
    for (const done of [dir, before]) rmSync(done, { recursive: true, force: true });
  }
});

test("leaves a python project that sets uv's constraints itself as it is, says why, and updates the rest", () => {
  const own = `${PYPROJECT}\n[tool.uv]\nconstraint-dependencies = ["numpy<3"]\n`;
  const dir = projectDir({ name: "demo", dependencies: { "@elaraai/e3": "1.0.35" } }, { pyproject: own });
  try {
    const said: string[] = [];
    const result = updateStack({ cwd: dir, version: "1.0.42", install: false, log: (msg) => said.push(msg), pins: pinsOf("1.0.42") });
    assert.equal(readFileSync(join(dir, "pyproject.toml"), "utf8"), own);
    assert.equal(result.pythonPinned, false);
    assert.ok(said.some((msg) => msg.startsWith("Python pins not written: ") && msg.includes("sets its own")), said.join("\n"));
    assert.equal(readPkg(dir).dependencies["@elaraai/e3"], "1.0.42", "its npm stack is updated all the same");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("leaves python as it is given no pins, and pins nothing of a project with no pyproject", () => {
  const python = projectDir({ name: "demo", dependencies: { "@elaraai/e3": "1.0.35" } }, { pyproject: PYPROJECT });
  const nodeOnly = projectDir({ name: "demo", dependencies: { "@elaraai/e3": "1.0.35" } });
  try {
    assert.equal(updateStack({ cwd: python, version: "1.0.42", ...silent, pins: null }).pythonPinned, false);
    assert.equal(readFileSync(join(python, "pyproject.toml"), "utf8"), PYPROJECT);
    assert.equal(updateStack({ cwd: nodeOnly, version: "1.0.42", ...silent, pins: pinsOf("1.0.42") }).pythonPinned, false);
    assert.ok(!existsSync(join(nodeOnly, "pyproject.toml")));
  } finally {
    for (const done of [python, nodeOnly]) rmSync(done, { recursive: true, force: true });
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
