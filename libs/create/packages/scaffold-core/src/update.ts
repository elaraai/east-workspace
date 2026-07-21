/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const DEP_BUCKETS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

/** A single `@elaraai/*` dependency whose pin was rewritten. */
export interface UpdatedDep {
  name: string;
  from: string;
  to: string;
}

/** Outcome of an {@link updateStack} run. */
export interface UpdateResult {
  projectName: string;
  /** Deps whose version actually changed (empty when already up to date). */
  changed: UpdatedDep[];
  /** Total `@elaraai/*` deps seen across all dependency buckets. */
  found: number;
  /** Whether a reinstall ran. */
  installed: boolean;
}

/** Inputs to {@link updateStack}. */
export interface UpdateOptions {
  /** Project directory holding the package.json to update. */
  cwd: string;
  /** Target version — every `@elaraai/*` pin is set to this exact version. */
  version: string;
  /** Reinstall (drop the stale lock + `npm install`) after rewriting pins. */
  install?: boolean;
  /** Progress sink; defaults to `console.log`. */
  log?: (msg: string) => void;
}

/**
 * Bump every `@elaraai/*` dependency in the project at `cwd` to `version`
 * (exact, matching the lockstep stack), then regenerate the lockfile.
 *
 * The `@elaraai/*` stack publishes in lockstep with exact intra-stack peers, so
 * an incremental `npm install` after a bump ERESOLVEs against the still-locked
 * old tree. Rewriting every pin to one version and dropping the stale lock lets
 * npm resolve the whole stack in a single consistent pass — replacing the
 * `rm -rf node_modules package-lock.json` workaround.
 *
 * @param options - Target directory, version, and install/log controls
 * @returns Which deps changed, how many `@elaraai/*` deps were found, and whether install ran
 * @throws {Error} If there is no package.json, it has no `@elaraai/*` dependencies, or install fails
 */
export function updateStack(options: UpdateOptions): UpdateResult {
  const { cwd, version, install = false } = options;
  const log = options.log ?? ((msg: string) => console.log(msg));

  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(`no package.json in ${cwd} — run this inside an East / e3 project`);
  }
  const raw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw) as Record<string, unknown> & { name?: string };

  const changed: UpdatedDep[] = [];
  let found = 0;
  for (const bucket of DEP_BUCKETS) {
    const deps = pkg[bucket] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      if (!name.startsWith("@elaraai/")) continue;
      found++;
      const from = deps[name]!;
      if (from === version) continue;
      deps[name] = version;
      changed.push({ name, from, to: version });
    }
  }

  if (found === 0) {
    throw new Error(`no @elaraai/* dependencies in ${pkgPath} — is this an East / e3 project?`);
  }

  if (changed.length > 0) {
    // Preserve the file's existing indent + trailing newline.
    const indent = /^\{\n( +)/.exec(raw)?.[1].length ?? 2;
    const trailingNewline = raw.endsWith("\n") ? "\n" : "";
    writeFileSync(pkgPath, JSON.stringify(pkg, null, indent) + trailingNewline);
    log(`Updated ${changed.length} @elaraai/* ${changed.length === 1 ? "dependency" : "dependencies"} to ${version}.`);
  } else {
    log(`All ${found} @elaraai/* dependencies already at ${version}.`);
  }

  if (changed.length > 0) {
    // The lock now pins the old stack — drop it so the next install (now or
    // later) resolves fresh from the consistent pins. Leaving it in place is
    // what makes an incremental `npm install` ERESOLVE on the exact peers.
    rmSync(join(cwd, "package-lock.json"), { force: true });
  }

  let installed = false;
  if (install) {
    log("Reinstalling (npm install)...");
    const npm = spawnSync("npm", ["install"], { cwd, stdio: "inherit", shell: process.platform === "win32" });
    if (npm.status !== 0) {
      throw new Error(`npm install failed (exit ${npm.status ?? "unknown"})`);
    }
    installed = true;
  }

  return { projectName: pkg.name ?? "project", changed, found, installed };
}
