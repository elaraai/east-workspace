/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { scaffold, type Features, type ProjectKind } from "./scaffold.js";

interface FeatureManifest {
  features: Record<string, { default?: boolean }>;
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
  const templateDir = join(pkgRoot, "templates", kind);
  const name = args.find((a) => !a.startsWith("-")) ?? ".";
  const install = args.includes("--install")
    ? true
    : args.includes("--no-install")
      ? false
      : Boolean(process.stdout.isTTY);

  try {
    const features = await resolveFeatures(templateDir, args);
    const result = scaffold({ kind, name, templateDir, version, install, features });
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
async function resolveFeatures(templateDir: string, args: string[]): Promise<Features> {
  const manifestPath = join(templateDir, "template.json");
  if (!existsSync(manifestPath)) return {};
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as FeatureManifest;

  const features: Features = {};
  for (const [key, spec] of Object.entries(manifest.features)) features[key] = spec.default ?? true;

  const runnerKeys = Object.keys(manifest.features).filter((k) => k.startsWith("runner:"));
  const runnerName = (key: string): string => key.slice("runner:".length);

  const runnersFlag = args.find((a) => a.startsWith("--runners="));
  const selectionFlags = ["--tests", "--no-tests", "--ui", "--no-ui"].some((f) => args.includes(f)) || Boolean(runnersFlag);

  if (args.includes("--tests")) features["tests"] = true;
  if (args.includes("--no-tests")) features["tests"] = false;
  if (args.includes("--ui")) features["ui"] = true;
  if (args.includes("--no-ui")) features["ui"] = false;
  if (runnersFlag) {
    const chosen = new Set(runnersFlag.slice("--runners=".length).split(",").map((s) => s.trim()).filter(Boolean));
    for (const key of runnerKeys) features[key] = chosen.has(runnerName(key));
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
  } finally {
    rl.close();
  }
  return features;
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
  console.log("Options:");
  console.log("  --install | --no-install     install dependencies after scaffolding (default: TTY)");
  if (kind === "e3") {
    console.log("  --tests | --no-tests         include test files (default: yes)");
    console.log("  --ui | --no-ui               include east-ui + e3-ui UI components (default: no)");
    console.log("  --runners=east-node,east-c,east-py   East runtimes to include (default: all)");
    console.log("");
    console.log("Run interactively (a TTY with no feature flags) to be prompted for these.");
  }
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
