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
  // The East diagnostics policy travels with the project (#653): every surface
  // reads `[tool.east-py]`, and the build tier is off everywhere until a
  // project opts in — so a scaffold that wants it has to say so.
  assert.ok(pyproject.includes("[tool.east-py]"), "pyproject configures the East diagnostics");
  // Off by default: the build tier IMPORTS the module, so an editor would run
  // this project's code on every save. The comment above it shows how to opt in.
  assert.ok(/\[tool\.east-py\][\s\S]*check = false/.test(pyproject), "the build tier is not opted into by default");
  assert.ok(pyproject.includes("check = true"), "the comment shows how to turn it on");

  const index = readFileSync(join(dir, "src", "index.ts"), "utf8");
  assert.ok(index.includes("export default"), "e3 index must default-export the package");

  rmSync(dirname(dir), { recursive: true, force: true });
});

test("scaffold e3: defaults omit UI and never emit the manifest", () => {
  const dir = scaffoldInto("e3", "my-proj", "1.0.0");
  const pkg = readPkg(dir);

  assert.equal(pkg.dependencies["@elaraai/east-ui"], undefined, "UI is opt-in — east-ui must be absent by default");
  assert.equal(pkg.dependencies["@elaraai/e3-ui"], undefined, "UI is opt-in — e3-ui must be absent by default");
  assert.equal(pkg.devDependencies["@elaraai/e3-ui-cli"], undefined, "UI is opt-in — e3-ui-cli must be absent by default");
  assert.equal(pkg.scripts["shot"], undefined, "the shot script is UI-only");
  assert.equal(pkg.scripts["shots:png"], undefined, "the shots:png sweep script is UI-only");
  assert.equal(pkg.scripts["shots:html"], undefined, "the shots:html sweep script is UI-only");
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
  assert.equal(pkg.devDependencies["@elaraai/e3-ui-cli"], "^9.9.9", "ui adds the pinned screenshot CLI");
  assert.ok(String(pkg.scripts["shot"]).includes("e3-ui shot --from-source src/ui/index.tsx"), "ui adds the shot script targeting the surface");
  assert.ok(String(pkg.scripts["shots:png"]).includes("e3-ui shots src --out .shots"), "ui adds the PNG sweep script");
  assert.ok(String(pkg.scripts["shots:html"]).includes("--html"), "ui adds the HTML sweep script");
  assert.ok(readFileSync(join(dir, ".gitignore"), "utf8").includes(".shots/"), "the sweep output dir is git-ignored");
  assert.ok(existsSync(join(dir, "src", "ui", "index.tsx")), "ui emits the .tsx decision surface");

  const surface = readFileSync(join(dir, "src", "ui", "index.tsx"), "utf8");
  assert.ok(surface.includes("ui(") && surface.includes('"surface"'), "src/ui/index.tsx defines the ui() task");

  const index = readFileSync(join(dir, "src", "index.ts"), "utf8");
  assert.ok(index.includes('./ui/index.js'), "the swapped index.ts imports the surface");
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

/** No index variant source file may be left behind next to the emitted index.ts. */
function assertNoIndexVariantsLeak(dir: string): void {
  for (const f of ["index.ui.ts", "index.platform.ts", "index.platform.py.ts", "index.ui.platform.ts", "index.ui.platform.py.ts"]) {
    assert.ok(!existsSync(join(dir, "src", f)), `${f} must not be emitted alongside index.ts`);
  }
}

test("scaffold e3: --platform with east-py (default) emits BOTH the TS-East and Python modules", () => {
  const dir = scaffoldInto("e3", "my-proj", "9.9.9", { platform: true }); // east-py on by default

  // Python half (platform AND east-py): example fn in its own module + aggregator __init__.
  assert.ok(existsSync(join(dir, "platform_module", "example.py")), "platform_module/example.py is emitted");
  const examplePy = readFileSync(join(dir, "platform_module", "example.py"), "utf8");
  assert.ok(examplePy.includes('name="my-proj.example_python"'), "platform fn uses the dotted <project>.<fn> name");
  assert.ok(examplePy.includes("example_impl = East.platform_functions(__name__)"), "submodule collects its own fns");
  const initPy = readFileSync(join(dir, "platform_module", "__init__.py"), "utf8");
  assert.ok(initPy.includes("from .example import example_impl"), "__init__ imports the submodule");
  assert.ok(initPy.includes("platform = [*example_impl]"), "__init__ aggregates into the platform list");
  const pyproject = readFileSync(join(dir, "pyproject.toml"), "utf8");
  assert.ok(pyproject.includes("[build-system]"), "platform pyproject has a build-system block");
  assert.ok(/\[tool\.east-py\][\s\S]*check = false/.test(pyproject), "the platform pyproject is not opted in either");
  assert.ok(pyproject.includes('packages = ["platform_module"]'), "setuptools discovers platform_module");
  assert.ok(!existsSync(join(dir, "pyproject.platform.toml")), "the pyproject variant is renamed, not emitted alongside");
  assert.ok(existsSync(join(dir, "src", "platform_module.ts")), "TS declaration for the Python platform fn");

  // TS-East half (always when platform on): a src/platform/ dir with a barrel.
  assert.ok(existsSync(join(dir, "src", "platform", "index.ts")), "TS-East platform barrel (the ./platform export)");
  assert.ok(existsSync(join(dir, "src", "platform", "example.ts")), "TS-East example fn file");

  // The emitted index wires both runtimes.
  const index = readFileSync(join(dir, "src", "index.ts"), "utf8");
  assert.ok(index.includes("./platform_module.js") && index.includes("./platform/index.js"), "index wires both platform fns");
  assert.ok(index.includes('runtime: "east-py"') && index.includes('{ custom: "platform_module" }'), "python task uses the east-py runner");
  assert.ok(index.includes('runtime: "east-node"') && index.includes('{ custom: "@elaraai/my-proj" }'), "TS-East task uses east-node + the project's own scoped name");
  assertNoIndexVariantsLeak(dir);

  const raw = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  assert.equal(raw.exports["./platform"], "./dist/platform/index.js", "main package exposes the ./platform subpath");
  assert.equal(raw.exports["."], "./dist/index.js", "main package keeps a default entry alongside ./platform");

  const testPy = readFileSync(join(dir, "tests", "test_unit.py"), "utf8");
  assert.ok(testPy.includes("from platform_module import platform as project_platform"), "test_unit imports the project platform");

  // `npm run start` must build first — the TS-East platform task loads
  // ./dist/platform/index.js, which only exists after `tsc`.
  assert.ok(raw.scripts.start.includes("npm run build"), "platform start builds before deploy");

  rmSync(dirname(dir), { recursive: true, force: true });
});

test("scaffold e3: --platform WITHOUT east-py emits the TS-East module only (no Python)", () => {
  const dir = scaffoldInto("e3", "my-proj", "9.9.9", { platform: true, "runner:east-py": false });

  // TS-East half is present and wired on the east-node runner.
  assert.ok(existsSync(join(dir, "src", "platform", "index.ts")), "TS-East platform barrel is emitted");
  assert.ok(existsSync(join(dir, "src", "platform", "example.ts")), "TS-East example fn is emitted");
  const index = readFileSync(join(dir, "src", "index.ts"), "utf8");
  assert.ok(index.includes("./platform/index.js"), "index wires the TS-East platform fn");
  assert.ok(index.includes('runtime: "east-node"') && index.includes('{ custom: "@elaraai/my-proj" }'), "TS-East task uses east-node + the project's own scoped name");
  const raw = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  assert.equal(raw.exports["./platform"], "./dist/platform/index.js", "main package exposes the ./platform subpath even without east-py");

  // Python half is absent (no east-py).
  assert.ok(!existsSync(join(dir, "platform_module")), "no platform_module without east-py");
  assert.ok(!existsSync(join(dir, "src", "platform_module.ts")), "no Python TS declaration without east-py");
  assert.ok(!existsSync(join(dir, "pyproject.toml")), "no pyproject without east-py");
  assert.ok(!index.includes("./platform_module.js"), "index must not reference the Python module");
  assert.ok(!index.includes('runtime: "east-py"'), "no east-py task without east-py");
  assertNoIndexVariantsLeak(dir);

  rmSync(dirname(dir), { recursive: true, force: true });
});

test("scaffold e3: platform is opt-in — nothing leaks by default", () => {
  const dir = scaffoldInto("e3", "my-proj", "1.0.0"); // defaults: platform off

  assert.ok(!existsSync(join(dir, "platform_module")), "no platform_module by default");
  assert.ok(!existsSync(join(dir, "src", "platform")), "no src/platform dir by default");
  assert.ok(!existsSync(join(dir, "src", "platform_module.ts")), "no TS declaration by default");
  assert.ok(!existsSync(join(dir, "pyproject.platform.toml")), "no platform pyproject variant by default");
  assertNoIndexVariantsLeak(dir);

  const pyproject = readFileSync(join(dir, "pyproject.toml"), "utf8");
  assert.ok(!pyproject.includes("[build-system]"), "the default pyproject has no build-system block");

  const raw = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  assert.equal(raw.exports, undefined, "no ./platform export when platform is off");
  assert.ok(!raw.scripts.start.includes("npm run build"), "non-platform start does not build (deploy uses --from-source)");

  rmSync(dirname(dir), { recursive: true, force: true });
});

test("scaffold e3: --ui --platform (with east-py) emits the combined ui+python index, no clobber", () => {
  const dir = scaffoldInto("e3", "my-proj", "9.9.9", { ui: true, platform: true });

  const index = readFileSync(join(dir, "src", "index.ts"), "utf8");
  assert.ok(index.includes("./ui/index.js"), "combined index imports the UI surface");
  assert.ok(index.includes("./platform_module.js") && index.includes("./platform/index.js"), "combined index wires both platform fns");
  assert.ok(index.includes("reorderQty, examplePythonTask, exampleNodeTask, surface"), "combined index registers surface + both platform tasks");
  assertNoIndexVariantsLeak(dir);
  assert.ok(existsSync(join(dir, "src", "ui", "index.tsx")), "ui surface is emitted");
  assert.ok(existsSync(join(dir, "platform_module", "example.py")), "platform module is emitted");

  rmSync(dirname(dir), { recursive: true, force: true });
});

test("scaffold e3: --ui --platform WITHOUT east-py emits the combined ui+node index", () => {
  const dir = scaffoldInto("e3", "my-proj", "9.9.9", { ui: true, platform: true, "runner:east-py": false });

  const index = readFileSync(join(dir, "src", "index.ts"), "utf8");
  assert.ok(index.includes("./ui/index.js"), "combined index imports the UI surface");
  assert.ok(index.includes("./platform/index.js"), "combined index wires the TS-East platform fn");
  assert.ok(index.includes("reorderQty, exampleNodeTask, surface"), "combined index registers surface + the node task");
  assert.ok(!index.includes("./platform_module.js"), "no Python module without east-py");
  assertNoIndexVariantsLeak(dir);
  assert.ok(!existsSync(join(dir, "platform_module")), "no platform_module without east-py");

  rmSync(dirname(dir), { recursive: true, force: true });
});
