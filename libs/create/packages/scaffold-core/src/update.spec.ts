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

function projectDir(pkg: Record<string, unknown>, opts?: { lock?: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), "update-test-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  if (opts?.lock) writeFileSync(join(dir, "package-lock.json"), "{}\n");
  return dir;
}

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
