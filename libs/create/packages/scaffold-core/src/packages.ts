/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

/**
 * Per-runtime workspace-package generation — the value-list half of the
 * scaffold (as opposed to the boolean feature-pruning half in `scaffold.ts`).
 *
 * `create-e3 --python-packages=a,b --node-packages=c --c-packages=d` splits a
 * project's platform code into separate workspace packages, each with its OWN
 * execution environment. Editing one package changes only its captured
 * environment hash, so e3 re-runs only the tasks wired to it — the package
 * boundary IS the change-detection granularity (epic elaraai/east-workspace#271).
 *
 * The three runtimes map to three package shapes:
 * - `python` → a uv workspace member under `packages/python/<name>` (hatchling,
 *   an `@platform_function`), captured via `environment: { python }`.
 * - `node` → an npm workspace member under `packages/node/<name>` (an
 *   `East.platform` impl), captured via `environment: { node }`.
 * - `c` → a native build under `packages/native/<name>` producing a binary,
 *   captured via `environment: { tools }` — no uv/npm workspace (C has none).
 *
 * Every generated package gets a companion app-side wiring file at
 * `src/packages/<name>.ts` holding its example tasks — one calling the
 * package's platform function (native code, the task's environment derived
 * from the `{ custom }` reference) and, for python and node, one calling an
 * East function the package exports (`East.importFunction`: East IR authored
 * in the package's language, embedded at export, run by the default runner —
 * the two ways of crossing the language boundary). A generated
 * `src/packages/index.ts` barrel collects them and the app's `src/index.ts`
 * exports them as the package's dataflow.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import type { ProjectNames } from "./names.js";

/** Named packages to generate, grouped by runtime. */
export interface PackageSpec {
  /** Python (uv) workspace members — `packages/python/<name>`. */
  python?: string[];
  /** Node (npm) workspace members — `packages/node/<name>`. */
  node?: string[];
  /** Native binaries wired via a `tools` env — `packages/native/<name>`. */
  c?: string[];
}

export type PackageRuntime = keyof PackageSpec;

/** A single generated package, tracked so the app barrel can collect its task. */
interface GeneratedPackage {
  /** The user-supplied package name (also the src dir + dotted platform name). */
  name: string;
  /** A JavaScript-safe identifier derived from {@link name} (`-` → `_`). */
  ident: string;
  runtime: PackageRuntime;
}

interface RuntimeConfig {
  runtime: PackageRuntime;
  /** Project-relative parent dir for this runtime's packages. */
  destParent: string;
  /** Sub-directory under `_packages/` holding this runtime's member template. */
  templateName: string;
  /** Human label for messages. */
  label: string;
  /** How many example tasks the runtime's `_app.ts` companion exports as `<ident>_tasks` — the count the generated smoke spec pins. */
  tasks: number;
  /** Names must match this (runtime-specific packaging rules). */
  valid: RegExp;
  /** Why a name is rejected, for the error message. */
  rule: string;
}

const RUNTIMES: Record<PackageRuntime, RuntimeConfig> = {
  // Python package/dir names must be import-safe (letters, digits, underscore).
  python: {
    runtime: "python", destParent: "packages/python", templateName: "python", label: "Python", tasks: 2,
    valid: /^[a-z][a-z0-9_]*$/, rule: "lowercase letters, digits and underscores, starting with a letter",
  },
  // Node member names become the last segment of an npm dir; keep them tame.
  node: {
    runtime: "node", destParent: "packages/node", templateName: "node", label: "Node", tasks: 2,
    valid: /^[a-z][a-z0-9-]*$/, rule: "lowercase letters, digits and hyphens, starting with a letter",
  },
  // C build dir names — letters, digits, underscore, hyphen.
  c: {
    runtime: "c", destParent: "packages/native", templateName: "c", label: "C", tasks: 1,
    valid: /^[a-z][a-z0-9_-]*$/, rule: "lowercase letters, digits, underscores and hyphens, starting with a letter",
  },
};

const RUNTIME_ORDER: PackageRuntime[] = ["python", "node", "c"];

/** A JavaScript-safe identifier: hyphens and any non-word char become `_`. */
function toIdent(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_");
}

/** Substitute the project + package + version tokens in a path or file body. */
function substitute(text: string, names: ProjectNames, version: string, pkg?: GeneratedPackage): string {
  let out = text
    .replaceAll("__PROJECT_NAME__", names.projectName)
    .replaceAll("__DISPLAY_NAME__", names.displayName)
    .replaceAll("__WORKSPACE_NAME__", names.workspaceName)
    .replaceAll("__VERSION__", version);
  if (pkg) out = out.replaceAll("__PACKAGE_NAME__", pkg.name).replaceAll("__PACKAGE_IDENT__", pkg.ident);
  return out;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * Stamp a runtime's member sub-template into `<destParent>/<name>`, and its
 * app-side `_app.ts` companion into `src/packages/<name>.ts`. Tokens are
 * substituted in BOTH paths and file bodies (so `src/__PACKAGE_NAME__/…`
 * becomes `src/<name>/…`). Files whose basename starts with `_` are app-side
 * companions, not member files.
 */
function stampMember(
  projectDir: string, templateRoot: string, cfg: RuntimeConfig,
  names: ProjectNames, version: string, pkg: GeneratedPackage,
): void {
  const memberTemplate = join(templateRoot, cfg.templateName);
  if (!existsSync(memberTemplate)) {
    throw new Error(`internal: missing package template for ${cfg.label} at ${memberTemplate}`);
  }
  const memberDir = join(projectDir, cfg.destParent, pkg.name);
  for (const srcPath of walkFiles(memberTemplate)) {
    const rel = relative(memberTemplate, srcPath).replaceAll("\\", "/");
    // A `_`-prefixed file AT THE MEMBER-TEMPLATE ROOT is an app-side companion,
    // not a member file — currently just `_app.ts` → src/packages/<name>.ts.
    // The root check keeps nested dunder files (e.g. src/<pkg>/__init__.py) as
    // ordinary member files.
    if (!rel.includes("/") && rel.startsWith("_")) {
      if (rel === "_app.ts") {
        const dest = join(projectDir, "src", "packages", `${pkg.name}.ts`);
        mkdirSync(join(dest, ".."), { recursive: true });
        writeFileSync(dest, substitute(readFileSync(srcPath, "utf8"), names, version, pkg));
      }
      continue;
    }
    const dest = join(memberDir, substitute(rel, names, version, pkg));
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, substitute(readFileSync(srcPath, "utf8"), names, version, pkg));
  }
}

/** Rewrite the root `pyproject.toml` into a uv workspace root over the members. */
function writePythonWorkspaceRoot(projectDir: string, names: ProjectNames, members: string[]): void {
  const sources = members.map((m) => `${m} = { workspace = true }`).join("\n");
  const body =
    `[project]\n` +
    `name = "${names.projectName}"\n` +
    `version = "0.1.0"\n` +
    `description = "${names.displayName}"\n` +
    `requires-python = ">=3.11"\n` +
    `dependencies = [\n` +
    `  "elaraai-east-py",\n  "elaraai-east-py-std",\n  "elaraai-east-py-io",\n` +
    `  "elaraai-east-py-datascience",\n  "elaraai-east-py-cli",\n]\n\n` +
    `# This project is a uv workspace root: each package under packages/python/*\n` +
    `# is its own member with its own dependency closure (and its own captured\n` +
    `# execution environment). No [build-system] — the root is not itself a\n` +
    `# Python package, just the workspace + the shared runtime dependencies.\n` +
    `[tool.uv.workspace]\n` +
    `members = ["packages/python/*"]\n\n` +
    `[tool.uv.sources]\n${sources}\n`;
  writeFileSync(join(projectDir, "pyproject.toml"), body);
}

/** Merge `workspaces`, `private`, and a member build step into the root package.json. */
function patchNodeWorkspaceRoot(projectDir: string): void {
  const path = join(projectDir, "package.json");
  const pkg = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const globs = new Set<string>(Array.isArray(pkg.workspaces) ? (pkg.workspaces as string[]) : []);
  globs.add("packages/node/*");
  pkg.workspaces = [...globs];
  // npm requires a workspace root to be private (it is never published).
  pkg.private = true;
  // Build the node members (each emits dist/ for `npm pack` + its ./platform
  // export) before the app — otherwise the captured package would be empty.
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  if (typeof scripts.build === "string" && !scripts.build.includes("--workspaces")) {
    scripts.build = `npm run build --workspaces --if-present && ${scripts.build}`;
    pkg.scripts = scripts;
  }
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

/** Exclude the generated `packages/` tree from the app's own tsc program. */
function excludePackagesFromRootTsconfig(projectDir: string): void {
  const path = join(projectDir, "tsconfig.json");
  if (!existsSync(path)) return;
  const tsconfig = JSON.parse(readFileSync(path, "utf8")) as { exclude?: string[] };
  const exclude = new Set<string>(tsconfig.exclude ?? []);
  // Member packages compile themselves; the app's tsc (rootDir: ./src) must not
  // pull their sources in (they live under ./packages, not ./src).
  exclude.add("packages");
  tsconfig.exclude = [...exclude];
  writeFileSync(path, `${JSON.stringify(tsconfig, null, 2)}\n`);
}

/** Generate `src/packages/index.ts` (barrel) and rewrite `src/index.ts` (app). */
function writeAppWiring(projectDir: string, names: ProjectNames, members: GeneratedPackage[]): void {
  const imports = members.map((m) => `import { ${m.ident}_tasks } from "./${m.name}.js";`).join("\n");
  const list = members.map((m) => `  ...${m.ident}_tasks,`).join("\n");
  const taskCount = members.reduce((n, m) => n + RUNTIMES[m.runtime].tasks, 0);
  const barrel =
    `// Generated by create-e3 — collects the example tasks of every workspace package:\n` +
    `// a call of the package's platform function (its environment derived from the\n` +
    `// package) and, for python and node, a call of an East function the package\n` +
    `// exports (embedded at export). Add packages with \`create-e3 --python-packages=…\`.\n` +
    `${imports}\n\n` +
    `export const packageTasks = [\n${list}\n];\n`;
  mkdirSync(join(projectDir, "src", "packages"), { recursive: true });
  writeFileSync(join(projectDir, "src", "packages", "index.ts"), barrel);

  const index =
    `import e3 from "@elaraai/e3";\n\n` +
    `import { packageTasks } from "./packages/index.js";\n\n` +
    `// This app wires the example tasks of each generated workspace package. A\n` +
    `// platform-function task's \`environment\` is captured per package, so editing\n` +
    `// one package re-runs only its tasks — the other packages stay cached; an\n` +
    `// imported East function is embedded at export and runs anywhere. Add your\n` +
    `// own inputs, tasks and dataflows here.\n` +
    `export default e3.package("${names.projectName}", "1.0.0", ...packageTasks);\n`;
  writeFileSync(join(projectDir, "src", "index.ts"), index);

  // The base template's src/index.spec.ts tests the example app this rewrite
  // just replaced (importing exports like \`reorderFn\` that no longer exist),
  // so a default-features member-flag scaffold would not compile (#301).
  // Rewrite it as a smoke spec against the generated wiring; when the
  // \`tests\` feature is off the file is absent and there is nothing to do.
  const specPath = join(projectDir, "src", "index.spec.ts");
  if (existsSync(specPath)) {
    const spec =
      `import { East, IntegerType } from "@elaraai/east";\n` +
      `import { describeEast, Assert } from "@elaraai/east-node-std";\n` +
      `import pkg from "./index.js";\n` +
      `import { packageTasks } from "./packages/index.js";\n\n` +
      `// Generated by create-e3 — smoke tests for the generated multi-package\n` +
      `// app. Replace with real tests as you add inputs, tasks and dataflows.\n` +
      `describeEast("${names.displayName}", (test) => {\n` +
      `  test("wires every example task of every workspace package", ($) => {\n` +
      `    const count = $.const(BigInt(packageTasks.length), IntegerType);\n` +
      `    $(Assert.equal(count, East.value(${taskCount}n)));\n` +
      `  });\n\n` +
      `  test("exports the deployable package", ($) => {\n` +
      `    const name = $.const(pkg.name);\n` +
      `    $(Assert.equal(name, East.value("${names.projectName}")));\n` +
      `  });\n` +
      `}, { exportOnly: true });\n`;
    writeFileSync(specPath, spec);
  }
}

/**
 * Validate and generate every requested workspace package, wire the root
 * manifests, and write the app-side barrel + index. A no-op when `spec` names
 * no packages.
 *
 * @param options.projectDir - The scaffolded project root.
 * @param options.templateDir - The kind's template root (holds `_packages/`).
 * @param options.names - Derived project names for token substitution.
 * @param options.spec - The packages to generate, grouped by runtime.
 * @param options.log - Progress logger.
 * @throws {Error} if a package name is empty, malformed for its runtime, or
 *   collides with another package (names must be unique across all runtimes).
 */
export function generatePackages(options: {
  projectDir: string;
  templateDir: string;
  names: ProjectNames;
  version: string;
  spec: PackageSpec;
  log: (msg: string) => void;
}): void {
  const { projectDir, templateDir, names, version, spec, log } = options;
  const templateRoot = join(templateDir, "_packages");

  // Collect + validate. Names are unique across ALL runtimes because each
  // becomes a distinct src/packages/<name>.ts (and a distinct dataflow task).
  const members: GeneratedPackage[] = [];
  const seen = new Map<string, PackageRuntime>();
  for (const runtime of RUNTIME_ORDER) {
    const cfg = RUNTIMES[runtime];
    for (const raw of spec[runtime] ?? []) {
      const name = raw.trim();
      if (!name) throw new Error(`--${runtime}-packages contains an empty package name`);
      if (!cfg.valid.test(name)) {
        throw new Error(`${cfg.label} package name '${name}' is invalid — use ${cfg.rule}`);
      }
      const prior = seen.get(name);
      if (prior) {
        throw new Error(`package name '${name}' is declared twice (${prior} and ${runtime}) — names must be unique`);
      }
      seen.set(name, runtime);
      members.push({ name, ident: toIdent(name), runtime });
    }
  }
  if (members.length === 0) return;

  // A requested runtime must have a member template shipped. (Guards partial
  // rollout: python ships first; node/C templates land next.)
  for (const runtime of RUNTIME_ORDER) {
    if ((spec[runtime]?.length ?? 0) > 0 && !existsSync(join(templateRoot, RUNTIMES[runtime].templateName))) {
      throw new Error(
        `${RUNTIMES[runtime].label} packages are not available in this scaffold yet — ` +
        `remove --${runtime}-packages for now`,
      );
    }
  }

  for (const pkg of members) {
    stampMember(projectDir, templateRoot, RUNTIMES[pkg.runtime], names, version, pkg);
  }

  const py = members.filter((m) => m.runtime === "python").map((m) => m.name);
  const node = members.filter((m) => m.runtime === "node").map((m) => m.name);
  if (py.length > 0) writePythonWorkspaceRoot(projectDir, names, py);
  if (node.length > 0) patchNodeWorkspaceRoot(projectDir);
  excludePackagesFromRootTsconfig(projectDir);

  writeAppWiring(projectDir, names, members);

  const summary = RUNTIME_ORDER
    .map((r) => ({ r, n: members.filter((m) => m.runtime === r).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} ${RUNTIMES[x.r].label}`)
    .join(", ");
  log(`Generated ${members.length} workspace package${members.length === 1 ? "" : "s"} (${summary}).`);
}
