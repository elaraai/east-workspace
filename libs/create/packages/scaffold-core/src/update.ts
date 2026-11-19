/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { hasReleasePins, withReleasePins, type ReleasePins } from "./pins.js";
import { uvSync } from "./scaffold.js";

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
  /** Whether the project's `pyproject.toml` carries this release's python
   *  pins: given them by this update, or holding them already. */
  pythonPinned: boolean;
  /** Whether `uv sync` locked the python dependencies under them in this update. */
  pythonLocked: boolean;
  /** Whether a reinstall ran. */
  installed: boolean;
}

/** Inputs to {@link updateStack}. */
export interface UpdateOptions {
  /** Project directory holding the package.json to update. */
  cwd: string;
  /** Target version — every `@elaraai/*` pin is set to this exact version. */
  version: string;
  /** Reinstall after rewriting pins: drop the stale lock and `npm install`,
   *  then `uv sync` a project that carries the release's python pins. */
  install?: boolean;
  /**
   * Reads the release's python pins (`readReleasePins`): called only for a
   * project whose `pyproject.toml` carries a release's pins, which then take
   * these. One that finds none (create-east's) leaves them, and says so.
   */
  pins?: () => ReleasePins | null;
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
 * A python project whose `pyproject.toml` carries a release's pins, the block
 * a scaffold writes, takes this release's ({@link withReleasePins}), so its
 * next lock resolves what the release's images hold. A project without the
 * block is left as it is: its author never took the pins, or removed them.
 *
 * @param options - Target directory, version, the release's python pins, and install/log controls
 * @returns Which deps changed, how many `@elaraai/*` deps were found, whether the project carries this release's python pins and they were locked, and whether install ran
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

  const pythonPinned = pinPython(cwd, version, options.pins, log);

  let installed = false;
  let pythonLocked = false;
  if (install) {
    log("Reinstalling (npm install)...");
    const npm = spawnSync("npm", ["install"], { cwd, stdio: "inherit", shell: process.platform === "win32" });
    if (npm.status !== 0) {
      throw new Error(`npm install failed (exit ${npm.status ?? "unknown"})`);
    }
    installed = true;
    // Its lock may be of an earlier release's pins, or never synced under
    // these: a sync locks again where it is stale.
    if (pythonPinned) {
      const synced = uvSync(cwd, log);
      if (synced === "failed") {
        throw new Error("uv sync failed. Where uv says the project's dependencies conflict with the release's pins, those " +
          "are the `# >>> east release pins` block of pyproject.toml: change the dependency, or replace the block with " +
          "constraint-dependencies of your own");
      }
      pythonLocked = synced === "synced";
    }
  }

  return { projectName: pkg.name ?? "project", changed, found, pythonPinned, pythonLocked, installed };
}

/**
 * Gives a project's block of a release's python pins this release's. A
 * project with no block is left as it is, and so is one whose pins this
 * initializer does not carry, or that cannot take them: the log says why.
 *
 * @returns Whether its `pyproject.toml` carries this release's pins now
 */
function pinPython(cwd: string, version: string, loadPins: (() => ReleasePins | null) | undefined, log: (msg: string) => void): boolean {
  const path = join(cwd, "pyproject.toml");
  if (!existsSync(path)) return false;
  const before = readFileSync(path, "utf8");
  try {
    if (!hasReleasePins(before)) {
      log("pyproject.toml carries no east release pins (a project create-e3 scaffolds does): its python dependencies are left as they are.");
      return false;
    }
    const pins = loadPins?.() ?? null;
    if (pins === null) {
      log(`pyproject.toml's east release pins are left as they are: run \`npm create @elaraai/e3@${version} -- --update\` to move them.`);
      return false;
    }
    const after = withReleasePins(before, pins);
    if (after === before) {
      log(`The python dependencies are pinned to east release ${pins.release}'s already.`);
    } else {
      writeFileSync(path, after);
      log(`Pinned the python dependencies to east release ${pins.release}'s.`);
    }
    return true;
  } catch (err) {
    log(`Python pins not written: ${err instanceof Error ? err.message : String(err)}.`);
    return false;
  }
}
