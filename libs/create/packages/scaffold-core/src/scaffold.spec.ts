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

import { scaffold, type Features, type ProjectKind } from "./scaffold.js";
import { deriveNames } from "./names.js";

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "templates");

function scaffoldInto(kind: ProjectKind, name: string, version: string, features?: Features): string {
  const cwd = mkdtempSync(join(tmpdir(), "create-test-"));
  scaffold({ kind, name, cwd, templateDir: join(TEMPLATES, kind), version, features, log: () => {} });
  return join(cwd, deriveNames(name, cwd).projectName);
}

function readPkg(dir: string): { dependencies: Record<string, string>; devDependencies: Record<string, string>; scripts: Record<string, string> } {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
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

  test(`scaffold ${kind}: eslint is on by default — config, lint script, plugin dep`, () => {
    const dir = scaffoldInto(kind, "my-proj", "9.9.9");
    const pkg = readPkg(dir);

    assert.ok(existsSync(join(dir, "eslint.config.js")), "eslint.config.js is emitted by default");
    assert.equal(pkg.scripts["lint"], "eslint .", "the lint script is present by default");
    assert.equal(pkg.devDependencies["@elaraai/eslint-plugin-east"], "^9.9.9",
      "the East ESLint plugin is a pinned devDep by default");

    rmSync(dirname(dir), { recursive: true, force: true });
  });

  test(`scaffold ${kind}: disabling eslint drops the config, lint script, and lint deps`, () => {
    const dir = scaffoldInto(kind, "my-proj", "1.0.0", { eslint: false });
    const pkg = readPkg(dir);

    assert.ok(!existsSync(join(dir, "eslint.config.js")), "no eslint.config.js when eslint is off");
    assert.equal(pkg.scripts["lint"], undefined, "the lint script is dropped");
    for (const d of ["eslint", "@typescript-eslint/eslint-plugin", "@typescript-eslint/parser", "@elaraai/eslint-plugin-east"]) {
      assert.equal(pkg.devDependencies[d], undefined, `eslint devDep ${d} must be dropped`);
    }

    rmSync(dirname(dir), { recursive: true, force: true });
  });

  test(`scaffold ${kind}: editor diagnostics are on by default and toggle off`, () => {
    const onDir = scaffoldInto(kind, "my-proj", "9.9.9");
    assert.equal(readPkg(onDir).devDependencies["@elaraai/tsserver-plugin-east"], "^9.9.9",
      "the East tsserver plugin is a pinned devDep by default");
    const tsconfig = readFileSync(join(onDir, "tsconfig.json"), "utf8");
    assert.ok(tsconfig.includes("@elaraai/tsserver-plugin-east"), "tsconfig wires the tsserver plugin");
    rmSync(dirname(onDir), { recursive: true, force: true });

    const offDir = scaffoldInto(kind, "my-proj", "1.0.0", { "editor-diagnostics": false });
    assert.equal(readPkg(offDir).devDependencies["@elaraai/tsserver-plugin-east"], undefined,
      "editor-diagnostics off drops the tsserver plugin devDep");
    rmSync(dirname(offDir), { recursive: true, force: true });
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

test("scaffold e3: defaults omit UI and never emit the manifest", () => {
  const dir = scaffoldInto("e3", "my-proj", "1.0.0");
  const pkg = readPkg(dir);

  assert.equal(pkg.dependencies["@elaraai/east-ui"], undefined, "UI is opt-in — east-ui must be absent by default");
  assert.equal(pkg.dependencies["@elaraai/e3-ui"], undefined, "UI is opt-in — e3-ui must be absent by default");
  assert.ok(!existsSync(join(dir, "src", "surface.tsx")), "surface.tsx is UI-only");
  assert.ok(!existsSync(join(dir, "src", "index.ui.ts")), "the UI index variant must never be emitted under its source name");
  assert.ok(!existsSync(join(dir, "template.json")), "template.json is build metadata, never scaffolded");

  rmSync(dirname(dir), { recursive: true, force: true });
});

test("scaffold e3: ui feature adds east-ui + e3-ui and swaps in the UI entry", () => {
  const dir = scaffoldInto("e3", "my-proj", "9.9.9", { ui: true });
  const pkg = readPkg(dir);

  assert.equal(pkg.dependencies["@elaraai/east-ui"], "^9.9.9", "ui adds a pinned east-ui dep");
  assert.equal(pkg.dependencies["@elaraai/e3-ui"], "^9.9.9", "ui adds a pinned e3-ui dep");
  assert.ok(existsSync(join(dir, "src", "surface.tsx")), "ui emits the .tsx decision surface");

  const surface = readFileSync(join(dir, "src", "surface.tsx"), "utf8");
  assert.ok(surface.includes("ui(") && surface.includes('"surface"'), "surface.tsx defines the ui() task");

  const index = readFileSync(join(dir, "src", "index.ts"), "utf8");
  assert.ok(index.includes('./surface.js'), "the swapped index.ts imports the surface");
  assert.ok(index.includes("reorderQty, surface"), "index.ts registers the surface in the package");
  assert.ok(!existsSync(join(dir, "src", "index.ui.ts")), "the UI variant is renamed onto index.ts, not emitted alongside it");

  rmSync(dirname(dir), { recursive: true, force: true });
});

test("scaffold e3: disabling tests removes specs and test scripts", () => {
  const dir = scaffoldInto("e3", "my-proj", "1.0.0", { tests: false });
  const pkg = readPkg(dir);

  assert.ok(!existsSync(join(dir, "src", "index.spec.ts")), "no spec when tests are off");
  assert.ok(!existsSync(join(dir, "tests", "test_unit.py")), "no python test when tests are off");
  for (const s of ["test", "test:ts", "test:export", "test:py"]) {
    assert.equal(pkg.scripts[s], undefined, `test script ${s} must be dropped`);
  }

  rmSync(dirname(dir), { recursive: true, force: true });
});

test("scaffold e3: disabling east-py removes python files, deps and uv steps", () => {
  const dir = scaffoldInto("e3", "my-proj", "1.0.0", { "runner:east-py": false });
  const pkg = readPkg(dir);

  assert.ok(!existsSync(join(dir, "pyproject.toml")), "no pyproject without the east-py runner");
  assert.ok(!existsSync(join(dir, ".python-version")), "no .python-version without the east-py runner");
  assert.ok(!existsSync(join(dir, "tests", "test_unit.py")), "no python test without the east-py runner");
  assert.equal(pkg.dependencies["@elaraai/east-py-datascience"], undefined, "datascience dep is east-py-only");
  assert.equal(pkg.scripts["test:py"], undefined, "test:py is dropped");
  assert.equal(pkg.scripts["test"], "npm run build && npm run test:export", "test must drop the py leg");
  assert.equal(pkg.scripts["setup"], "npm install", "setup must drop uv sync");

  rmSync(dirname(dir), { recursive: true, force: true });
});

test("scaffold e3: runner toggles drop the matching cli devDep", () => {
  const dir = scaffoldInto("e3", "my-proj", "1.0.0", { "runner:east-c": false, "runner:east-node": false });
  const pkg = readPkg(dir);

  assert.equal(pkg.devDependencies["@elaraai/east-c-cli"], undefined, "east-c off drops east-c-cli");
  assert.equal(pkg.devDependencies["@elaraai/east-node-cli"], undefined, "east-node off drops east-node-cli");
  assert.ok(pkg.devDependencies["@elaraai/e3-cli"], "e3-cli is core and must remain");

  rmSync(dirname(dir), { recursive: true, force: true });
});

test("scaffold e3: platform feature emits the module, pyproject build-system, index variant, and ./platform export", () => {
  const dir = scaffoldInto("e3", "my-proj", "9.9.9", { platform: true });

  // Python platform package, with the dotted "<project>.<fn>" name.
  assert.ok(existsSync(join(dir, "platform_module", "__init__.py")), "platform_module package is emitted");
  const initPy = readFileSync(join(dir, "platform_module", "__init__.py"), "utf8");
  assert.ok(initPy.includes('name="my-proj.forecast_demand"'), "platform fn uses the dotted <project>.<fn> name");
  assert.ok(initPy.includes("platform = platform_functions(__name__)"), "platform_module exports the platform list");

  // setuptools build-system block, swapped in from the pyproject.platform.toml variant.
  const pyproject = readFileSync(join(dir, "pyproject.toml"), "utf8");
  assert.ok(pyproject.includes("[build-system]"), "platform pyproject has a build-system block");
  assert.ok(pyproject.includes('packages = ["platform_module"]'), "setuptools discovers platform_module");
  assert.ok(!existsSync(join(dir, "pyproject.platform.toml")), "the pyproject variant is renamed, not emitted alongside");

  // TS stub for the Python fn + the co-located TS-East platform fn.
  assert.ok(existsSync(join(dir, "src", "platform_module.ts")), "TS stub for the Python platform fn");
  assert.ok(existsSync(join(dir, "src", "platform.ts")), "TS-East co-located platform fn");

  // Exactly one index.ts, sourced from the platform (no-ui) variant.
  const index = readFileSync(join(dir, "src", "index.ts"), "utf8");
  assert.ok(index.includes("./platform_module.js") && index.includes("./platform.js"), "platform index wires both platform fns");
  assert.ok(index.includes('runtime: "east-py"') && index.includes('{ custom: "platform_module" }'), "python platform task uses the east-py runner");
  assert.ok(index.includes('{ custom: "@elaraai/my-proj" }'), "TS-East platform task references the project's own scoped package name");
  assert.ok(!existsSync(join(dir, "src", "index.platform.ts")), "the platform index variant is renamed, not emitted");
  assert.ok(!existsSync(join(dir, "src", "index.ui.platform.ts")), "the ui+platform index variant must not leak without ui");

  // The main package exposes its TS-East platform via the ./platform subpath.
  const raw = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  assert.equal(raw.exports["./platform"], "./dist/platform.js", "main package exposes the ./platform subpath");
  assert.equal(raw.exports["."], "./dist/index.js", "main package keeps a default entry alongside ./platform");

  // test_unit.py threads the project platform through the same reserved-name filter.
  const testPy = readFileSync(join(dir, "tests", "test_unit.py"), "utf8");
  assert.ok(testPy.includes("from platform_module import platform as project_platform"), "test_unit imports the project platform");
  assert.ok(testPy.includes("for pf in project_platform"), "test_unit includes the project platform in the list");

  rmSync(dirname(dir), { recursive: true, force: true });
});

test("scaffold e3: platform is opt-in — module, ./platform export, and pyproject block never leak by default", () => {
  const dir = scaffoldInto("e3", "my-proj", "1.0.0"); // defaults: platform off

  assert.ok(!existsSync(join(dir, "platform_module")), "no platform_module by default");
  assert.ok(!existsSync(join(dir, "src", "platform.ts")), "no TS-East platform by default");
  assert.ok(!existsSync(join(dir, "src", "platform_module.ts")), "no TS stub by default");
  assert.ok(!existsSync(join(dir, "src", "index.platform.ts")), "no platform index variant by default");
  assert.ok(!existsSync(join(dir, "src", "index.ui.platform.ts")), "no ui+platform index variant by default");
  assert.ok(!existsSync(join(dir, "pyproject.platform.toml")), "no platform pyproject variant by default");

  const pyproject = readFileSync(join(dir, "pyproject.toml"), "utf8");
  assert.ok(!pyproject.includes("[build-system]"), "the default pyproject has no build-system block");

  const raw = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  assert.equal(raw.exports, undefined, "no ./platform export when platform is off");

  rmSync(dirname(dir), { recursive: true, force: true });
});

test("scaffold e3: --ui --platform emits the combined index with no clobber", () => {
  const dir = scaffoldInto("e3", "my-proj", "9.9.9", { ui: true, platform: true });

  const index = readFileSync(join(dir, "src", "index.ts"), "utf8");
  assert.ok(index.includes("./surface.js"), "combined index imports the UI surface");
  assert.ok(index.includes("./platform_module.js") && index.includes("./platform.js"), "combined index wires the platform fns");
  assert.ok(index.includes("reorderQty, forecast, bufferedReorder, surface"), "combined index registers the surface alongside the platform tasks");

  for (const f of ["index.ui.ts", "index.platform.ts", "index.ui.platform.ts"]) {
    assert.ok(!existsSync(join(dir, "src", f)), `${f} must not be emitted alongside index.ts`);
  }
  assert.ok(existsSync(join(dir, "src", "surface.tsx")), "ui surface is emitted");
  assert.ok(existsSync(join(dir, "platform_module", "__init__.py")), "platform module is emitted");

  rmSync(dirname(dir), { recursive: true, force: true });
});

test("scaffold e3: --platform without the east-py runner errors clearly", () => {
  const cwd = mkdtempSync(join(tmpdir(), "create-test-"));
  try {
    assert.throws(
      () =>
        scaffold({
          kind: "e3",
          name: "my-proj",
          cwd,
          templateDir: join(TEMPLATES, "e3"),
          version: "1.0.0",
          features: { platform: true, "runner:east-py": false },
          log: () => {},
        }),
      /--platform requires the east-py runner/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
