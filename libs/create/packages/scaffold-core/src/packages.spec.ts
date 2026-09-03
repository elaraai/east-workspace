/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
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

// A Windows checkout carries the templates with CRLF and the scaffold copies
// their bodies verbatim, so the multi-line assertions below read LF-normalized.
const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), "utf8").replaceAll("\r\n", "\n");

test("python packages: generates each member with an __init__ and example platform fn", () => {
  const dir = scaffoldPackages("shop", { python: ["pricing", "common"] });
  for (const name of ["pricing", "common"]) {
    const base = join("packages", "python", name);
    assert.ok(existsSync(join(dir, base, "pyproject.toml")), `${name} pyproject`);
    assert.ok(existsSync(join(dir, base, "src", name, "__init__.py")), `${name} __init__.py must survive (dunder is a member file, not a companion)`);
    const example = read(dir, join(base, "src", name, "example.py"));
    assert.ok(example.includes(`name="${name}.example"`), `${name}.example dotted name`);
    // The other way across the boundary: an East function the package exports.
    assert.ok(read(dir, join(base, "src", name, "functions.py")).includes("East.function("), `${name} functions.py builds an East function`);
    assert.ok(read(dir, join(base, "src", name, "__init__.py")).includes('east_functions = {"scale": scale}'), `${name} root module declares east_functions`);
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
  // The East function the package exports is imported by package + name + type
  // and called from a task on the DEFAULT runner (no runner, platform or environment).
  assert.ok(wiring.includes('East.importFunction(\n  "pricing",\n  "scale",\n  FunctionType([ArrayType(FloatType), FloatType], ArrayType(FloatType)),\n)'), "imports the package's East function by package, name and type");
  assert.ok(/e3\.task\(\n  "pricing_scaled",[\s\S]*?\$\.return\(scale\(v, f\)\);\n  \}\),\n\);/.test(wiring), "the importing task takes no runner config");
  assert.ok(wiring.includes("export const pricing_tasks = [pricing_task, pricing_scaled_task];"), "exports every task the package contributes");
  // The barrel + app index collect the member tasks.
  assert.ok(read(dir, join("src", "packages", "index.ts")).includes("...pricing_tasks"), "barrel spreads the package's tasks");
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
  assert.equal(pkg.exports["./functions"], "./dist/functions.js", "exposes the ./functions subpath e3 exports East functions from");
  assert.ok(read(dir, join(base, "src", "functions.ts")).includes("export const eastFunctions = { scale };"), "member functions.ts exports its East functions");
  assert.equal(pkg.dependencies["@elaraai/east"], "^9.9.9", "deps pinned to the scaffold version (__VERSION__)");
  const root = JSON.parse(read(dir, "package.json"));
  assert.ok((root.workspaces as string[]).includes("packages/node/*"), "root is an npm workspace over node members");
  assert.equal(root.private, true, "npm workspace root must be private");
  const wiring = read(dir, join("src", "packages", "api.ts"));
  assert.ok(wiring.includes('custom: "@shop/api"'), "app references the member by its npm name");
  assert.ok(!/\n\s*environment:\s*\{/.test(wiring), "no explicit environment — e3 derives it from the platform reference");
  assert.ok(wiring.includes('East.importFunction(\n  "@shop/api",\n  "scale",'), "imports the member's East function by its npm name");
  assert.ok(wiring.includes("export const api_tasks = [api_task, api_scaled_task];"), "exports every task the package contributes");
  rmSync(dirname(dir), { recursive: true, force: true });
});

test("mixed python + node packages coexist (uv + npm workspaces, one barrel)", () => {
  const dir = scaffoldPackages("shop", { python: ["pricing"], node: ["api"] });
  assert.ok(existsSync(join(dir, "packages", "python", "pricing", "pyproject.toml")), "python member");
  assert.ok(existsSync(join(dir, "packages", "node", "api", "package.json")), "node member");
  assert.ok(read(dir, "pyproject.toml").includes('members = ["packages/python/*"]'), "uv workspace over python members");
  assert.ok((JSON.parse(read(dir, "package.json")).workspaces as string[]).includes("packages/node/*"), "npm workspace over node members");
  const barrel = read(dir, join("src", "packages", "index.ts"));
  assert.ok(barrel.includes("...pricing_tasks") && barrel.includes("...api_tasks"), "barrel collects tasks from both runtimes");
  rmSync(dirname(dir), { recursive: true, force: true });
});

test("C packages: native dir with a Makefile + a tools-wired customTask (explicit env)", () => {
  const dir = scaffoldPackages("shop", { c: ["solver"] });
  const base = join("packages", "native", "solver");
  assert.ok(existsSync(join(dir, base, "Makefile")), "Makefile");
  assert.ok(existsSync(join(dir, base, "src", "solver.c")), "src/solver.c (token-substituted filename)");
  const wiring = read(dir, join("src", "packages", "solver.ts"));
  assert.ok(wiring.includes("e3.customTask"), "C is wired as a customTask, not an auto-derived platform");
  assert.ok(wiring.includes('files: ["packages/native/solver/build/solver"]'), "explicit tools env points at the built binary");
  assert.ok(wiring.includes("export const solver_tasks = [solver_task];"), "a C package contributes its one tool task");
  rmSync(dirname(dir), { recursive: true, force: true });
});

test("the generated smoke spec pins the task count the wiring files actually define", () => {
  const dir = scaffoldPackagesDefaultFeatures("shop", { python: ["pricing"], node: ["api"], c: ["solver"] });
  const defined = ["pricing", "api", "solver"]
    .map((name) => (read(dir, join("src", "packages", `${name}.ts`)).match(/e3\.(task|customTask)\(/g) ?? []).length)
    .reduce((a, b) => a + b, 0);
  assert.equal(defined, 5, "python 2 (platform + imported East fn), node 2, C 1");
  assert.ok(read(dir, join("src", "index.spec.ts")).includes("East.value(5n)"), "the smoke spec expects exactly the tasks the wiring defines");
  rmSync(dirname(dir), { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// #301 — a member-flag scaffold with DEFAULT features (tests ON) must compile.
// writeAppWiring rewrites src/index.ts to the generated barrel app, so the
// base template's src/index.spec.ts (which imported the example app's
// `reorderFn`) must be rewritten too, or the scaffold fails `npm run build`
// out of the box.
// ---------------------------------------------------------------------------

/** Scaffold with workspace packages and DEFAULT features (tests stay on). */
function scaffoldPackagesDefaultFeatures(name: string, packages: PackageSpec): string {
  const cwd = mkdtempSync(join(tmpdir(), "create-pkg-default-"));
  scaffold({
    kind: "e3", name, cwd, templateDir: join(TEMPLATES, "e3"), version: "9.9.9", log: () => {},
    packages,
  });
  return join(cwd, deriveNames(name, cwd).projectName);
}

test("member-flag scaffold with default features rewrites index.spec.ts against the generated app (#301)", () => {
  const dir = scaffoldPackagesDefaultFeatures("envpy", { python: ["calc"] });
  const spec = read(dir, join("src", "index.spec.ts"));
  assert.ok(!spec.includes("reorderFn"), "spec must not import the example app the wiring replaced");
  assert.ok(spec.includes('from "./packages/index.js"'), "spec smoke-tests the generated barrel");
  assert.ok(spec.includes("packageTasks"), "spec asserts the per-package task wiring");
  rmSync(dirname(dir), { recursive: true, force: true });
});

test("member-flag scaffold with default features compiles (tsc --noEmit) (#301)", (t) => {
  // Resolve deps against the monorepo's built lib packages (pnpm links
  // @elaraai/* per-package, not at the root, so link each one), then
  // typecheck the scaffold exactly as `npm run build` would. The create CI
  // job builds only the scaffolder packages, so skip (loudly) when the lib
  // dists aren't built — the spec-rewrite assertions above still pin #301
  // there; this compile gate runs wherever the monorepo is built.
  const repoRoot = join(TEMPLATES, "..", "..", "..");
  const links: Array<[string, string]> = [
    ["@elaraai/east", join(repoRoot, "libs", "east")],
    ["@elaraai/e3", join(repoRoot, "libs", "e3", "packages", "e3")],
    ["@elaraai/east-node-std", join(repoRoot, "libs", "east-node", "packages", "east-node-std")],
  ];
  const unbuilt = links.filter(([, target]) => !existsSync(join(target, "dist")));
  if (unbuilt.length > 0) {
    t.skip(`lib dists not built here: ${unbuilt.map(([n]) => n).join(", ")}`);
    return;
  }
  const dir = scaffoldPackagesDefaultFeatures("envpy", { python: ["calc"] });
  links.push(["@types/node", dirname(createRequire(import.meta.url).resolve("@types/node/package.json"))]);
  for (const [name, target] of links) {
    assert.ok(existsSync(target), `${name} source present at ${target}`);
    const linkPath = join(dir, "node_modules", ...name.split("/"));
    mkdirSync(dirname(linkPath), { recursive: true });
    symlinkSync(target, linkPath, "junction");
  }
  const require = createRequire(import.meta.url);
  const tsc = join(dirname(require.resolve("typescript")), "..", "bin", "tsc");
  try {
    execFileSync(process.execPath, [tsc, "--noEmit", "-p", dir], { stdio: "pipe" });
  } catch (err) {
    const out = (err as { stdout?: Buffer }).stdout?.toString() ?? "";
    assert.fail(`member-flag scaffold failed to typecheck:\n${out.slice(0, 4000)}`);
  }
  rmSync(dirname(dir), { recursive: true, force: true });
});
