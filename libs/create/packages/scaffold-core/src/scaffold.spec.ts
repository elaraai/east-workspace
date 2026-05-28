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

import { scaffold, type ProjectKind } from "./scaffold.js";
import { deriveNames } from "./names.js";

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "templates");

function scaffoldInto(kind: ProjectKind, name: string, version: string): string {
  const cwd = mkdtempSync(join(tmpdir(), "create-test-"));
  scaffold({ kind, name, cwd, templateDir: join(TEMPLATES, kind), version, log: () => {} });
  return join(cwd, deriveNames(name, cwd).projectName);
}

test("deriveNames normalizes to kebab / Title / snake", () => {
  const n = deriveNames("My Cool App", "/tmp");
  assert.equal(n.projectName, "my-cool-app");
  assert.equal(n.displayName, "My Cool App");
  assert.equal(n.workspaceName, "my_cool_app");
});

for (const kind of ["east", "e3"] as const) {
  test(`scaffold ${kind}: rewrites workspace:* to pinned version`, () => {
    const dir = scaffoldInto(kind, "my-proj", "9.9.9");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));

    assert.equal(pkg.name, "@elaraai/my-proj");
    assert.equal(pkg.version, "0.0.1");
    assert.equal(pkg.private, undefined, "private must be stripped on emit");
    assert.equal(pkg.dependencies["@elaraai/east"], "^9.9.9");
    // east-node-cli is in devDeps for both templates so scaffolded projects
    // can run `npx east-node` immediately.
    assert.equal(pkg.devDependencies["@elaraai/east-node-cli"], "^9.9.9",
      "east-node-cli must be a pinned devDep in every scaffolded project");
    if (kind === "e3") {
      // east-c-cli is in e3 devDeps too — the typed Runner API lets users
      // switch to `{ runtime: 'east-c', ... }` without a separate install.
      assert.equal(pkg.devDependencies["@elaraai/east-c-cli"], "^9.9.9",
        "east-c-cli must be a pinned devDep in scaffolded e3 projects");
    }
    const raw = readFileSync(join(dir, "package.json"), "utf8");
    assert.ok(!raw.includes("workspace:"), "no workspace: specifiers may survive emit");

    rmSync(dirname(dir), { recursive: true, force: true });
  });

  test(`scaffold ${kind}: substitutes tokens and renames dotfiles`, () => {
    const dir = scaffoldInto(kind, "my-proj", "1.0.0");

    assert.ok(existsSync(join(dir, ".gitignore")), ".gitignore must be written from template `gitignore`");
    assert.ok(!existsSync(join(dir, "gitignore")), "raw `gitignore` must not be emitted");

    const spec = readFileSync(join(dir, "src", "index.spec.ts"), "utf8");
    assert.ok(spec.includes("My Proj"), "__DISPLAY_NAME__ must be substituted");
    assert.ok(!spec.includes("__DISPLAY_NAME__"), "no tokens may survive");

    rmSync(dirname(dir), { recursive: true, force: true });
  });
}

test("scaffold e3: pyproject + index default export are emitted", () => {
  const dir = scaffoldInto("e3", "my-proj", "1.0.0");

  const pyproject = readFileSync(join(dir, "pyproject.toml"), "utf8");
  assert.ok(pyproject.includes('name = "my-proj"'), "pyproject name substituted");

  const index = readFileSync(join(dir, "src", "index.ts"), "utf8");
  assert.ok(index.includes("export default"), "e3 index must default-export the package");

  rmSync(dirname(dir), { recursive: true, force: true });
});
