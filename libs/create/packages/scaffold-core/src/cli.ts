/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { scaffold, type Features, type ProjectKind } from "./scaffold.js";
import type { PackageSpec } from "./packages.js";
import { updateStack, type UpdateResult } from "./update.js";

interface FeatureManifest {
  features: Record<string, { default?: boolean; allOf?: string[] }>;
}

/**
 * Entry point shared by the `create-east` / `create-e3` bins. Each bin is a
 * one-liner: `await runCreateCli("e3", import.meta.url)`. Resolves the template
 * dir and the pin version relative to the *published package* (dist/ and
 * templates/ sit next to package.json), parses argv, prompts for any features
 * the template declares, and scaffolds.
 */
export async function runCreateCli(kind: ProjectKind, moduleUrl: string): Promise<void> {
  const pkgRoot = join(dirname(fileURLToPath(moduleUrl)), "..");
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp(kind);
    return;
  }

  const version = (JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as { version: string }).version;

  // `--update`: bump an existing project's whole @elaraai/* stack to THIS
  // package's version (the lockstep stack version) instead of scaffolding.
  if (args.includes("--update")) {
    const target = args.find((a) => !a.startsWith("-")) ?? ".";
    const install = args.includes("--no-install")
      ? false
      : args.includes("--install")
        ? true
        : Boolean(process.stdout.isTTY);
    try {
      const result = updateStack({ cwd: resolve(target), version, install });
      printUpdateNextSteps(result, install);
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    return;
  }

  const templateDir = join(pkgRoot, "templates", kind);
  const name = args.find((a) => !a.startsWith("-")) ?? ".";
  const install = args.includes("--install")
    ? true
    : args.includes("--no-install")
      ? false
      : Boolean(process.stdout.isTTY);

  try {
    const packages = kind === "e3" ? parsePackages(args) : undefined;
    const features = await resolveFeatures(templateDir, args, packages);
    const result = scaffold({ kind, name, templateDir, version, install, features, packages });
    printNextSteps(kind, result.projectName, result.inPlace, install, features);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Build the {@link Features} record from the template manifest, CLI flags, and
 * — when running interactively with no selection flags — a short prompt. Flags
 * (`--tests/--no-tests`, `--ui/--no-ui`, `--runners=east-node,east-c`) mark a
 * non-interactive run, so CI and piped invocations never block on a prompt.
 */
async function resolveFeatures(templateDir: string, args: string[], packages?: PackageSpec): Promise<Features> {
  const manifestPath = join(templateDir, "template.json");
  if (!existsSync(manifestPath)) return {};
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as FeatureManifest;

  const features: Features = {};
  for (const [key, spec] of Object.entries(manifest.features)) {
    if (spec.allOf) continue; // derived features are computed, never set directly
    features[key] = spec.default ?? true;
  }

  const runnerKeys = Object.keys(manifest.features).filter((k) => k.startsWith("runner:"));
  const runnerName = (key: string): string => key.slice("runner:".length);

  const runnersFlag = args.find((a) => a.startsWith("--runners="));
  const selectionFlags =
    ["--tests", "--no-tests", "--ui", "--no-ui", "--platform", "--no-platform", "--eslint", "--no-eslint"].some((f) => args.includes(f)) ||
    Boolean(runnersFlag) ||
    // `--python-packages=…` / `--node-packages=…` / `--c-packages=…` are an
    // explicit non-interactive selection: skip the prompt.
    Boolean(packages);

  if (args.includes("--tests")) features["tests"] = true;
  if (args.includes("--no-tests")) features["tests"] = false;
  if (args.includes("--ui")) features["ui"] = true;
  if (args.includes("--no-ui")) features["ui"] = false;
  if (args.includes("--platform")) features["platform"] = true;
  if (args.includes("--no-platform")) features["platform"] = false;
  if (args.includes("--eslint")) features["eslint"] = true;
  if (args.includes("--no-eslint")) features["eslint"] = false;
  if (args.includes("--editor-diagnostics")) features["editor-diagnostics"] = true;
  if (args.includes("--no-editor-diagnostics")) features["editor-diagnostics"] = false;
  if (runnersFlag) {
    const chosen = new Set(runnersFlag.slice("--runners=".length).split(",").map((s) => s.trim()).filter(Boolean));
    for (const key of runnerKeys) features[key] = chosen.has(runnerName(key));
  }

  // Each `--<runtime>-packages` flag implies its runner (a package can't run
  // without it), and the generated packages REPLACE the single-file `--platform`
  // demo (they are the multi-package platform path). Applied after `--runners=`
  // so a contradictory `--runners=` can't disable a runner a package needs.
  if (packages) {
    if (packages.python?.length && "runner:east-py" in manifest.features) features["runner:east-py"] = true;
    if (packages.node?.length && "runner:east-node" in manifest.features) features["runner:east-node"] = true;
    if (packages.c?.length && "runner:east-c" in manifest.features) features["runner:east-c"] = true;
    features["platform"] = false;
  }

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !selectionFlags;
  if (!interactive) return features;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if ("tests" in manifest.features) {
      features["tests"] = await askYesNo(rl, "Include tests?", features["tests"]!);
    }
    if ("ui" in manifest.features) {
      features["ui"] = await askYesNo(rl, "Include UI components (east-ui + e3-ui)?", features["ui"]!);
    }
    if (runnerKeys.length > 0) {
      const defaults = runnerKeys.filter((k) => features[k]).map(runnerName);
      const answer = (await rl.question(`Runners to include (comma-separated) [${defaults.join(",")}]: `)).trim();
      const picks = new Set(answer ? answer.split(",").map((s) => s.trim()).filter(Boolean) : defaults);
      for (const key of runnerKeys) features[key] = picks.has(runnerName(key));
    }
    // A project-owned platform module always brings a TS-East (east-node)
    // function; the Python half is added automatically when the east-py runner
    // is also selected. So the prompt is independent of the runner choice.
    if ("platform" in manifest.features) {
      features["platform"] = await askYesNo(
        rl,
        "Include a project-owned platform module (custom TS-East functions, plus Python when east-py is on)?",
        features["platform"]!,
      );
    }
    if ("eslint" in manifest.features) {
      features["eslint"] = await askYesNo(rl, "Include ESLint with the East lint rules?", features["eslint"]!);
    }
    if ("editor-diagnostics" in manifest.features) {
      features["editor-diagnostics"] = await askYesNo(
        rl,
        "Include East editor diagnostics (TypeScript language service plugin)?",
        features["editor-diagnostics"]!,
      );
    }
  } finally {
    rl.close();
  }
  return features;
}

/**
 * Parse the per-runtime package flags into a {@link PackageSpec}. Each flag is
 * a comma-separated value list: `--python-packages=pricing,common`,
 * `--node-packages=api`, `--c-packages=solver`. Returns `undefined` when none
 * are present (so the scaffold stays single-package).
 */
function parsePackages(args: string[]): PackageSpec | undefined {
  const grab = (flag: string): string[] | undefined => {
    const arg = args.find((a) => a === flag || a.startsWith(`${flag}=`));
    if (arg === undefined) return undefined;
    const value = arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : "";
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  };
  const python = grab("--python-packages");
  const node = grab("--node-packages");
  const c = grab("--c-packages");
  if (!python && !node && !c) return undefined;
  const spec: PackageSpec = {};
  if (python) spec.python = python;
  if (node) spec.node = node;
  if (c) spec.c = c;
  return spec;
}

async function askYesNo(rl: ReturnType<typeof createInterface>, question: string, def: boolean): Promise<boolean> {
  const answer = (await rl.question(`${question} [${def ? "Y/n" : "y/N"}] `)).trim().toLowerCase();
  if (answer === "") return def;
  return answer.startsWith("y");
}

function printHelp(kind: ProjectKind): void {
  console.log(`Usage: npm create @elaraai/${kind} <project-name> [-- <options>]`);
  console.log(`       create-${kind} <project-name|.> [options]`);
  console.log("");
  console.log("Update an existing project's @elaraai/* stack (run inside the project):");
  console.log(`  npm create @elaraai/${kind}@<version> -- --update   (@latest for newest)`);
  console.log("  Rewrites every @elaraai/* dependency to <version> and regenerates the lock,");
  console.log("  keeping the stack in lockstep without an ERESOLVE on bump.");
  console.log("");
  console.log("Options:");
  console.log("  --update                     bump this project's @elaraai/* deps instead of scaffolding");
  console.log("  --install | --no-install     install dependencies after scaffolding / updating (default: TTY)");
  console.log("  --eslint | --no-eslint       include ESLint with the East lint rules (default: yes)");
  console.log("  --editor-diagnostics | --no-editor-diagnostics   include the East tsserver plugin for editor squiggles (default: yes)");
  if (kind === "e3") {
    console.log("  --tests | --no-tests         include test files (default: yes)");
    console.log("  --ui | --no-ui               include east-ui + e3-ui UI components (default: no)");
    console.log("  --platform | --no-platform   include a project-owned platform module (TS-East; +Python when east-py is on) (default: no)");
    console.log("  --runners=east-node,east-c,east-py   East runtimes to include (default: all)");
    console.log("");
    console.log("  Split platform code into separate workspace packages, each with its own");
    console.log("  execution environment (editing one re-runs only its tasks):");
    console.log("  --python-packages=pricing,common   uv workspace members (packages/python/*)");
    console.log("  --node-packages=api                npm workspace members (packages/node/*)");
    console.log("  --c-packages=solver                native binaries wired via a tools env (packages/native/*)");
  }
  console.log("");
  console.log("Run interactively (a TTY with no feature flags) to be prompted for these.");
}

function printNextSteps(
  kind: ProjectKind,
  projectName: string,
  inPlace: boolean,
  installed: boolean,
  features: Features,
): void {
  console.log("");
  console.log("Next steps:");
  if (!inPlace) console.log(`  cd ${projectName}`);
  if (!installed) {
    if (kind === "e3") console.log(features["runner:east-py"] === false ? "  npm install" : "  npm run setup");
    else console.log("  npm install");
  }
  console.log(kind === "e3" ? "  npm run start" : "  npm run test");
}

function printUpdateNextSteps(result: UpdateResult, installed: boolean): void {
  if (result.changed.length > 0) {
    console.log("");
    for (const dep of result.changed) {
      console.log(`  ${dep.name}  ${dep.from} -> ${dep.to}`);
    }
  }
  if (!installed) {
    // updateStack already dropped the stale lock, so a plain install resolves.
    console.log("");
    console.log("Next steps:");
    console.log("  npm install");
  }
}
