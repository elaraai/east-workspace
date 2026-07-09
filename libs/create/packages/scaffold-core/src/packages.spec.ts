/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { scaffold } from "./scaffold.js";
import type { PackageSpec } from "./packages.js";
import { deriveNames } from "./names.js";

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "templates");

/** Scaffold an e3 project with workspace packages into a fresh tmpdir. */
function scaffoldPackages(name: string, packages: PackageSpec): string {
  const cwd = mkdtempSync(join(tmpdir(), "create-pkg-test-"));
  scaffold({
    kind: "e3", name, cwd, templateDir: join(TEMPLATES, "e3"), version: "9.9.9", log: () => {},
    features: {
      "platform": false, "tests": false, "ui": false, "eslint": false, "editor-diagnostics": false,
      "runner:east-py": Boolean(packages.python?.length),
      "runner:east-node": Boolean(packages.node?.length),
      "runner:east-c": Boolean(packages.c?.length),
    },
    packages,
  });
  return join(cwd, deriveNames(name, cwd).projectName);
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), "utf8");

test("python packages: generates each member with an __init__ and example platform fn", () => {
  const dir = scaffoldPackages("shop", { python: ["pricing", "common"] });
  for (const name of ["pricing", "common"]) {
    const base = join("packages", "python", name);
    assert.ok(existsSync(join(dir, base, "pyproject.toml")), `${name} pyproject`);
    assert.ok(existsSync(join(dir, base, "src", name, "__init__.py")), `${name} __init__.py must survive (dunder is a member file, not a companion)`);
    const example = read(dir, join(base, "src", name, "example.py"));
    assert.ok(example.includes(`name="${name}.example"`), `${name}.example dotted name`);
    // Hatchling keeps the sdist byte-reproducible → stable env hash.
    assert.ok(read(dir, join(base, "pyproject.toml")).includes("hatchling"), `${name} must use hatchling`);
  }
  rmSync(dirname(dir), { recursive: true, force: true });
});

test("python packages: root pyproject becomes a uv workspace root over the members", () => {
  const dir = scaffoldPackages("shop", { python: ["pricing", "common"] });
  const pyproject = read(dir, "pyproject.toml");
  assert.ok(pyproject.includes('members = ["packages/python/*"]'), "uv workspace members glob");
  assert.ok(pyproject.includes("pricing = { workspace = true }"), "pricing workspace source");
  assert.ok(pyproject.includes("common = { workspace = true }"), "common workspace source");
  assert.ok(!/^\[build-system\]/m.test(pyproject), "workspace root is not itself a package (no [build-system] section)");
  rmSync(dirname(dir), { recursive: true, force: true });
});

test("python packages: app wiring references the platform but declares NO environment (auto-derived)", () => {
  const dir = scaffoldPackages("shop", { python: ["pricing"] });
  const wiring = read(dir, join("src", "packages", "pricing.ts"));
  assert.ok(wiring.includes('platforms: [{ custom: "pricing" }'), "must reference the package as a custom platform");
  assert.ok(!/\n\s*environment:\s*\{/.test(wiring), "no explicit environment field — e3 derives it from the platform reference");
  // The barrel + app index collect the member tasks.
  assert.ok(read(dir, join("src", "packages", "index.ts")).includes("pricing_task"), "barrel collects the task");
  assert.ok(read(dir, join("src", "index.ts")).includes("...packageTasks"), "app spreads the package tasks");
  rmSync(dirname(dir), { recursive: true, force: true });
});

test("package names: reject invalid python names, and duplicates across runtimes", () => {
  assert.throws(() => scaffoldPackages("shop", { python: ["Bad-Name"] }), /invalid/, "hyphen/upper invalid for python");
  assert.throws(() => scaffoldPackages("shop", { python: [""] }), /empty/, "empty name");
  assert.throws(() => scaffoldPackages("shop", { python: ["dup"], node: ["dup"] }), /twice|unique/, "cross-runtime duplicate");
});

test("node packages: npm workspace members with a ./platform export; root workspaces patched", () => {
  const dir = scaffoldPackages("shop", { node: ["api"] });
  const base = join("packages", "node", "api");
  assert.ok(existsSync(join(dir, base, "src", "platform.ts")), "member platform.ts");
  const pkg = JSON.parse(read(dir, join(base, "package.json")));
  assert.equal(pkg.name, "@shop/api", "member is named @<project>/<name>");
  assert.equal(pkg.exports["./platform"], "./dist/platform.js", "exposes the ./platform subpath the runner loads");
  assert.equal(pkg.dependencies["@elaraai/east"], "^9.9.9", "deps pinned to the scaffold version (__VERSION__)");
  const root = JSON.parse(read(dir, "package.json"));
  assert.ok((root.workspaces as string[]).includes("packages/node/*"), "root is an npm workspace over node members");
  assert.equal(root.private, true, "npm workspace root must be private");
  const wiring = read(dir, join("src", "packages", "api.ts"));
  assert.ok(wiring.includes('custom: "@shop/api"'), "app references the member by its npm name");
  assert.ok(!/\n\s*environment:\s*\{/.test(wiring), "no explicit environment — e3 derives it from the platform reference");
  rmSync(dirname(dir), { recursive: true, force: true });
});

test("mixed python + node packages coexist (uv + npm workspaces, one barrel)", () => {
  const dir = scaffoldPackages("shop", { python: ["pricing"], node: ["api"] });
  assert.ok(existsSync(join(dir, "packages", "python", "pricing", "pyproject.toml")), "python member");
  assert.ok(existsSync(join(dir, "packages", "node", "api", "package.json")), "node member");
  assert.ok(read(dir, "pyproject.toml").includes('members = ["packages/python/*"]'), "uv workspace over python members");
  assert.ok((JSON.parse(read(dir, "package.json")).workspaces as string[]).includes("packages/node/*"), "npm workspace over node members");
  const barrel = read(dir, join("src", "packages", "index.ts"));
  assert.ok(barrel.includes("pricing_task") && barrel.includes("api_task"), "barrel collects tasks from both runtimes");
  rmSync(dirname(dir), { recursive: true, force: true });
});

test("C packages are guarded with a clear message until the template ships", () => {
  // C has no member template yet; the guard must be a friendly error, not an
  // internal 'missing template' crash. (Self-resolves when the C template lands.)
  assert.throws(() => scaffoldPackages("shop", { c: ["solver"] }), /not available|remove --c-packages/);
});
