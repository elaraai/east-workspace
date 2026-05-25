/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { scaffold, type ProjectKind } from "./scaffold.js";

/**
 * Entry point shared by the `create-east` / `create-e3` bins. Each bin is a
 * one-liner: `runCreateCli("e3", import.meta.url)`. Resolves the template dir
 * and the pin version relative to the *published package* (dist/ and templates/
 * sit next to package.json), parses argv, and scaffolds.
 */
export function runCreateCli(kind: ProjectKind, moduleUrl: string): void {
  const pkgRoot = join(dirname(fileURLToPath(moduleUrl)), "..");
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: npm create @elaraai/${kind} <project-name> [-- --install|--no-install]`);
    console.log(`       create-${kind} <project-name|.> [--install|--no-install]`);
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
    const result = scaffold({ kind, name, templateDir, version, install });
    printNextSteps(kind, result.projectName, result.inPlace, install);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function printNextSteps(kind: ProjectKind, projectName: string, inPlace: boolean, installed: boolean): void {
  console.log("");
  console.log("Next steps:");
  if (!inPlace) console.log(`  cd ${projectName}`);
  if (!installed) console.log(kind === "e3" ? "  npm run setup" : "  npm install");
  console.log(kind === "e3" ? "  npm run start" : "  npm run test");
}
