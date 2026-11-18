/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What an export reads of an npm lock: the governing root of a node project,
 * the workspace member a name refers to, and the local members a member's
 * environment carries, with the lock checked against them. Pure reads of the
 * lock and the manifests: nothing is packed here (`environment-capture.ts`
 * packs what these name).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { StringType, compareFor } from '@elaraai/east';

/** Orders the paths a lock holds through East, by code point. */
const byCodePoint = compareFor(StringType);

// ---------------------------------------------------------------------------
// Node (npm workspace) dependency-closure capture (#280)
//
// A `{ node: { project } }` declaration is either a self-contained project
// (its own lockfile — captured byte-identically to before) or an npm
// workspace member. For a member we capture the ROOT package.json + lockfile
// plus an `npm pack` tarball per LOCAL closure member; the materializer
// (#276) reconstructs a closure-only workspace and `npm ci`s it.
//
// Unlike python's `uv pip check`, `npm ci` is NOT a loud oracle — it will
// silently install a member's unlocked deps from the registry — so the
// closure walk validates the lock at export (N4/N5) rather than relying on
// a run-time gate. pnpm workspaces are refused here (N8) until #284.
// ---------------------------------------------------------------------------

const NODE_LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml'] as const;

interface NpmLockEntry {
  name?: string;
  link?: boolean;
  resolved?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: string[];
}
/** An npm lock, for what a capture reads of it. */
export interface NpmLock { lockfileVersion?: number; packages?: Record<string, NpmLockEntry> }

/** Walk up from `start` to the nearest npm lockfile (not pnpm/yarn); null if none.
 *  @internal */
export function findNpmRoot(start: string): { root: string; lock: NpmLock } | null {
  const names = ['package-lock.json', 'npm-shrinkwrap.json'];
  let dir = start;
  for (;;) {
    const found = names.find((f) => fs.existsSync(path.join(dir, f)));
    if (found) return { root: dir, lock: JSON.parse(fs.readFileSync(path.join(dir, found), 'utf-8')) as NpmLock };
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The local npm-workspace member a name refers to — the package a `{ custom }`
 * platform or an `East.importFunction(pkg, …)` names (#652) — resolved the
 * way `captureAutoEnvironment` resolves it: the governing npm lockfile
 * above `anchorDir`, matched by `package.json` name, workspace members only
 * (never an installed dependency). The python twin is
 * `pythonWorkspaceMember`.
 *
 * @param name - The package name as referenced (`@scope/name` or bare)
 * @param anchorDir - Directory the workspace is resolved from (the export cwd)
 * @returns The member's directory and its `package.json` version, or null
 *   when there is no npm workspace above `anchorDir` or the name is not a
 *   local member (a registry package, a typo)
 */
export function nodeWorkspaceMember(name: string, anchorDir: string): { dir: string; version: string | null } | null {
  const found = findNpmRoot(anchorDir);
  if (!found) return null;
  const entry = Object.entries(found.lock.packages ?? {}).find(
    ([p, v]) => p !== '' && !p.includes('node_modules/') && v.name === name && v.link !== true,
  );
  if (!entry) return null;
  const dir = path.join(found.root, ...entry[0].split('/'));
  let version: string | null = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')) as { version?: unknown };
    if (typeof pkg.version === 'string') version = pkg.version;
  } catch {
    /* no readable package.json: the exporter records its own default */
  }
  return { dir, version };
}

/** Workspace-relative POSIX path from the root to a dir. */
function posixRel(root: string, dir: string): string {
  return path.relative(root, dir).split(path.sep).join('/');
}

/** The union of every dependency section's package names. */
function allDepNames(e: NpmLockEntry | undefined): string[] {
  if (!e) return [];
  return [
    ...Object.keys(e.dependencies ?? {}),
    ...Object.keys(e.devDependencies ?? {}),
    ...Object.keys(e.optionalDependencies ?? {}),
    ...Object.keys(e.peerDependencies ?? {}),
  ];
}

/**
 * Detect whether `project` is a self-contained node project or an npm
 * workspace member, and locate the governing root.
 *
 * @internal
 * @throws {Error} N1 (no lockfile anywhere), N8 (pnpm workspace — unsupported
 *   yet), N3 (project is the workspace root), N2 (not a member of the workspace)
 */
export function discoverNodeRoot(project: string, owner: string):
  { mode: 'single'; lockName: string } |
  { mode: 'workspace'; root: string; lock: NpmLock; subject: string } {
  const ownLock = NODE_LOCKFILES.find((f) => fs.existsSync(path.join(project, f)));
  if (ownLock) {
    // A workspace ROOT also has its own lockfile — but capturing it packs the
    // (usually code-less) root, not a member. Reject: the environment belongs
    // on a member.
    const pkg = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf-8')) as NpmLockEntry;
    if (Array.isArray(pkg.workspaces) && pkg.workspaces.length > 0) {
      throw new Error(`Environment for '${owner}': declare the environment on a workspace member, not the workspace root '${project}'`);
    }
    return { mode: 'single', lockName: ownLock };
  }

  let dir = path.dirname(project);
  for (;;) {
    const found = NODE_LOCKFILES.find((f) => fs.existsSync(path.join(dir, f)));
    if (found) {
      if (found === 'pnpm-lock.yaml') {
        throw new Error(`Environment for '${owner}': pnpm workspaces are not yet supported as environments — use npm workspaces or a single-project env`);
      }
      const root = dir;
      if (path.resolve(root) === path.resolve(project)) {
        throw new Error(`Environment for '${owner}': declare the environment on a workspace member, not the workspace root '${root}'`);
      }
      const lock = JSON.parse(fs.readFileSync(path.join(root, found), 'utf-8')) as NpmLock;
      const subject = posixRel(root, project);
      if (!lock.packages || !(subject in lock.packages)) {
        throw new Error(`Environment for '${owner}': '${project}' is not a member of the workspace at '${root}' — add it to "workspaces" and refresh the lockfile, or run 'npm install' in '${project}' for a standalone env`);
      }
      return { mode: 'workspace', root, lock, subject };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Environment for '${owner}': no lockfile in '${project}' or any parent — run 'npm install' there, or add it to a workspace and lock at the root`);
}

/**
 * The transitive closure of LOCAL workspace members reachable from `subject`,
 * with export-time lock validation.
 *
 * @internal
 * @returns Closure members (workspace-relative path + package name), sorted by path
 * @throws {Error} N4 (a member's on-disk manifest drifted from the lock — npm
 *   ci would silently install unlocked deps), N5 (a dep shadows a workspace
 *   member name from the registry), N6 (root depends on a member), N7 (a local
 *   dep resolves outside the workspace)
 */
export function npmClosure(lock: NpmLock, root: string, subject: string, owner: string): Array<{ path: string; name: string }> {
  const pkgs = lock.packages ?? {};
  const memberNames = new Set(
    Object.entries(pkgs)
      .filter(([p, e]) => p !== '' && !p.includes('node_modules/') && typeof e.name === 'string')
      .map(([, e]) => e.name!),
  );

  // N6: the root manifest must not depend on a workspace member.
  for (const dep of allDepNames(pkgs[''])) {
    if (memberNames.has(dep)) {
      throw new Error(`Environment for '${owner}': the workspace root depends on member '${dep}' — move member deps into the members that need them`);
    }
  }

  const resolveDep = (fromPath: string, dep: string): NpmLockEntry | null => {
    let dir = fromPath;
    for (;;) {
      const key = `${dir ? dir + '/' : ''}node_modules/${dep}`;
      if (pkgs[key]) return pkgs[key]!;
      if (!dir) return null;
      dir = dir.split('/').slice(0, -1).join('/');
    }
  };

  const included = new Map<string, string>(); // memberPath -> name
  const seen = new Set<string>();
  const queue = [subject];
  while (queue.length > 0) {
    const memberPath = queue.shift()!;
    if (seen.has(memberPath)) continue;
    seen.add(memberPath);
    const entry = pkgs[memberPath];
    if (!entry) continue;
    included.set(memberPath, entry.name ?? path.basename(memberPath));

    // N4: the locked dep sections must match the on-disk manifest.
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, ...memberPath.split('/'), 'package.json'), 'utf-8')) as NpmLockEntry;
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const) {
      if (JSON.stringify(onDisk[section] ?? {}) !== JSON.stringify(entry[section] ?? {})) {
        throw new Error(`Environment for '${owner}': '${memberPath}/package.json' ${section} differ from the lockfile — run 'npm install' to refresh the lock before exporting`);
      }
    }

    for (const dep of allDepNames(entry)) {
      const resolved = resolveDep(memberPath, dep);
      if (resolved?.link) {
        const target = resolved.resolved ?? '';
        if (target === '' || target.startsWith('..') || path.isAbsolute(target)) {
          throw new Error(`Environment for '${owner}': local dependency '${dep}' of '${memberPath}' resolves outside the workspace ('${target}')`);
        }
        queue.push(target);
      } else if (memberNames.has(dep)) {
        // N5: name collides with a workspace member but came from the registry.
        throw new Error(`Environment for '${owner}': '${dep}' in '${memberPath}' is satisfied from the registry, not the workspace — align its version to the workspace member (or rename)`);
      }
    }
  }
  return [...included.entries()].map(([p, name]) => ({ path: p, name })).sort((a, b) => byCodePoint(a.path, b.path));
}
