/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What an export reads of a uv lock: the governing root of a python project,
 * the packages its environment reaches, the registry distributions installed
 * beside its members, and what the sync of those leaves out. Pure reads of the
 * lock and of the directories it names: nothing is built here
 * (`environment-capture.ts` builds and stores what these name).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { StringType, compareFor } from '@elaraai/east';
import { STOCK_PLATFORMS_BY_RUNNER } from './runner.js';

/** Orders the names and paths a lock holds through East, by code point. */
const byCodePoint = compareFor(StringType);

// ---------------------------------------------------------------------------
// Python (uv) dependency-closure capture (#278)
//
// A `{ python: { project } }` declaration may point at a standalone uv
// project, a uv-workspace member, a workspace root, or a standalone project
// with `tool.uv.sources` path deps. We capture the ROOT manifest + lockfile
// plus the source distributions of exactly the LOCAL packages the project
// transitively depends on — so editing one package invalidates only the
// environments whose closure contains it.
//
// A project that is its own root is a `python` spec, whose lock is all its
// own. A member of a workspace is a `workspace_python` spec, which names the
// member: its environment installs the member's dependencies and not those
// of the workspace's root or of its other members (#1654).
//
// The lock is the single source of truth: we do not mirror uv's workspace
// discovery, we only trust what `uv lock` recorded. The materializer's
// fail-closed `uv pip check` (#275) means a closure that misses a local
// package fails loudly at build time, never as silent wrong code — so this
// walk favours simplicity and slight over-capture over cleverness.
// ---------------------------------------------------------------------------

/** One package of a uv lock. */
export interface UvLockPackage {
  name: string;
  source?: Record<string, string>;
  dependencies?: Array<{ name: string; extra?: string[] }>;
  'optional-dependencies'?: Record<string, Array<{ name: string; extra?: string[] }>>;
  'dev-dependencies'?: Record<string, Array<{ name: string; extra?: string[] }>>;
}
/** A uv lock, for what a capture reads of it. */
export interface UvLock {
  version?: number;
  manifest?: { members?: string[] };
  package?: UvLockPackage[];
}

/** Canonicalize a path for identity comparison — realpath when it exists,
 *  case-folded on win32 (uv.lock stores portable forward-slash relatives).
 *  @internal */
export function canonicalPath(p: string): string {
  let r = p;
  try { r = fs.realpathSync(p); } catch { /* may not exist yet */ }
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/**
 * A python distribution's name as PEP 503 writes it: lowercase, runs of `-`,
 * `_` and `.` as one `-`.
 *
 * @remarks
 * uv.lock stores canonical names while a `{ custom }` platform ref uses the
 * import-style name (`platform_module`), so both sides must canonicalize
 * before comparison (#391 — a strict match silently derived NO environment for
 * any underscore-named member, leaving its source edits out of the task hash
 * and serving stale cached outputs). e3-core names a tier's distributions by
 * it too, and the image's script that writes a tier's manifest
 * (`tier/tier-manifest.py` in `@elaraai/e3-core`) writes the same rule in
 * python: a name both sides spell otherwise is no longer told to be the
 * tier's.
 *
 * @param name - The name, as a lock, a manifest or a directory spells it
 * @returns The canonical name
 * @example
 * canonicalPythonName('Typing_Extensions'); // 'typing-extensions'
 */
export function canonicalPythonName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/** The on-disk directory a lock `source` points at, with its kind — or null
 *  for registry/git/url sources (installed by uv sync, not captured), and for
 *  a local archive (`path`), which no environment takes.
 *  @internal */
export function localSource(root: string, source: Record<string, string> | undefined):
  { dir: string; kind: 'editable' | 'directory' | 'virtual' } | null {
  if (!source) return null;
  for (const kind of ['editable', 'directory', 'virtual'] as const) {
    if (typeof source[kind] === 'string') return { dir: path.resolve(root, source[kind]!), kind };
  }
  return null;
}

/** The refusal of a package the lock holds as a local archive (`path`), which
 *  no environment takes: neither its sdist nor a registry's copy of it. */
function localArchiveRefused(owner: string, name: string): Error {
  return new Error(`Environment for '${owner}': local archive dependency '${name}' is not supported — use a directory/workspace source or a registry`);
}

/** A package a walk of a lock starts from: its name, and the extras it is
 *  installed with. */
export interface LockStart {
  /** Its name, as the lock or a manifest spells it */
  readonly name: string;
  /** The extras it is installed with; none unless given */
  readonly extras?: readonly string[];
}

/**
 * Every package of a lock that `starts` reach by what they depend on, each
 * name once, in the order reached, with each of its entries: a name the lock
 * locks at several versions, one for each platform it forks for, has
 * several.
 *
 * @remarks
 * A package is walked as an install takes it: through its dependencies, and
 * the optional groups of the extras the dependency that reached it asked for;
 * an extra another dependency asks for is walked when that one reaches it. So
 * an extra of a registry package that nothing asks for is never walked, nor
 * what only it names. A package `whole` says so of is walked through every
 * group it names, its development groups among them, whatever reached it: a
 * workspace's own package, whose walk may over-reach, since over-capture only
 * over-invalidates.
 *
 * A registry package's dependency may be a local package: the lock resolves a
 * name the workspace holds to the workspace's package.
 *
 * @internal
 * @param lock - The lock
 * @param starts - The packages to start from, with their extras
 * @param whole - Whether a package is walked through every group it names;
 *   none is unless given
 * @returns Each package reached, by its PEP 503 name, with its entries; none
 *   for a name the lock does not hold
 * @example
 * for (const { name, packages } of lockWalk(lock, [{ name: 'elaraai-east-py-datascience', extras: ['torch'] }])) needed.add(name);
 */
export function* lockWalk(lock: UvLock, starts: Iterable<LockStart>, whole: (pkg: UvLockPackage) => boolean = () => false):
  Generator<{ name: string; packages: UvLockPackage[] }> {
  const byName = new Map<string, UvLockPackage[]>();
  for (const pkg of lock.package ?? []) {
    const name = canonicalPythonName(pkg.name);
    byName.set(name, [...(byName.get(name) ?? []), pkg]);
  }
  const reached = new Set<string>();
  // What has been walked: a package's dependencies by its name, and an extra's by `name[extra]`
  const walked = new Set<string>();
  const queue: LockStart[] = [...starts];
  while (queue.length > 0) {
    const start = queue.shift()!;
    const name = canonicalPythonName(start.name);
    const packages = byName.get(name) ?? [];
    if (!reached.has(name)) {
      reached.add(name);
      yield { name, packages };
    }
    const fresh = [...(walked.has(name) ? [] : ['']), ...(start.extras ?? []).filter((extra) => !walked.has(`${name}[${extra}]`))];
    for (const part of fresh) walked.add(part === '' ? name : `${name}[${part}]`);
    for (const pkg of packages) {
      const edges = !whole(pkg) ? fresh.flatMap((part) => part === '' ? pkg.dependencies ?? [] : pkg['optional-dependencies']?.[part] ?? [])
        : !fresh.includes('') ? []
          : [...pkg.dependencies ?? [], ...Object.values(pkg['optional-dependencies'] ?? {}).flat(), ...Object.values(pkg['dev-dependencies'] ?? {}).flat()];
      for (const edge of edges) queue.push({ name: edge.name, extras: edge.extra ?? [] });
    }
  }
}

/**
 * Find the workspace/standalone root governing `project` and the lock
 * package (`subject`) whose local source resolves to it.
 *
 * @internal
 * @throws {Error} P3 (no lock in project or any ancestor), P5 (unsupported
 *   lock version), P4 (lock does not list a package at `project`)
 */
export function discoverPythonRoot(project: string, owner: string): { root: string; lock: UvLock; subject: string } {
  let dir = project;
  let lockPath: string | null = null;
  for (;;) {
    const candidate = path.join(dir, 'uv.lock');
    if (fs.existsSync(candidate)) { lockPath = candidate; break; }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!lockPath) {
    throw new Error(
      `Environment for '${owner}': no uv.lock in '${project}' or any parent — run 'uv lock' in ` +
      `'${project}' (standalone), or add it to [tool.uv.workspace].members of the workspace root and 'uv lock' there`,
    );
  }
  const root = path.dirname(lockPath);
  const lock = parseToml(fs.readFileSync(lockPath, 'utf-8')) as unknown as UvLock;
  if (lock.version !== 1) {
    throw new Error(`Environment for '${owner}': unsupported uv.lock version ${lock.version} at '${root}' — update @elaraai/e3 or re-lock with a compatible uv`);
  }
  const projectCanon = canonicalPath(project);
  const subject = (lock.package ?? []).find((p) => {
    const local = localSource(root, p.source);
    return local !== null && canonicalPath(local.dir) === projectCanon;
  });
  if (!subject) {
    throw new Error(
      `Environment for '${owner}': uv.lock at '${root}' does not list a package at '${project}' — ` +
      `the lockfile is out of date or the project is not a workspace member; run 'uv lock' at '${root}'`,
    );
  }
  return { root, lock, subject: subject.name };
}

/**
 * The LOCAL packages reachable from an environment's subjects, and from the
 * registry distributions it requires beside them — the set whose sdists must
 * ride the environment.
 *
 * Walks a local package through `dependencies` plus every optional-dependency
 * and dev-dependency group (over-capture is sound: it only over-invalidates),
 * and a registry package as an install takes it: through its dependencies
 * and the extras asked of it ({@link lockWalk}). A registry package is
 * installed from the lock, and a local package it depends on rides as an
 * sdist, as the installs take no local package from a registry. A
 * `path=<archive>` source the walk reaches is refused — never one only an
 * extra nothing asks for names — and a virtual package contributes its deps
 * but no sdist.
 *
 * @internal
 * @param subjects - The members the environment is of, by the lock's names
 * @param required - The registry distributions it requires beside them, with
 *   the extras each is installed with
 * @returns The buildable closure members, sorted by name
 * @throws {Error} P6 (dangling edge), P7 (subject not packaged), P8 (source
 *   dir missing), P9 (local archive dependency)
 */
export function pythonClosure(lock: UvLock, root: string, subjects: readonly string[], owner: string,
  required: readonly LockStart[] = []): Array<{ name: string; dir: string }> {
  const build = new Map<string, string>();
  const own = new Set(subjects.map(canonicalPythonName));
  const local = (pkg: UvLockPackage): boolean => localSource(root, pkg.source) !== null;
  for (const { name, packages } of lockWalk(lock, [...subjects.map((subject) => ({ name: subject })), ...required], local)) {
    if (packages.length === 0) {
      if (own.has(name)) throw new Error(`Environment for '${owner}': subject '${name}' not in uv.lock`);
      throw new Error(`Environment for '${owner}': uv.lock is inconsistent — depends on unknown '${name}'; run 'uv lock'`);
    }
    for (const pkg of packages) {
      if (typeof pkg.source?.path === 'string') throw localArchiveRefused(owner, pkg.name);
      const source = localSource(root, pkg.source);
      if (!source) continue; // registry/git/url — sync installs it, and what it depends on is walked
      if (source.kind !== 'virtual') {
        if (!fs.existsSync(source.dir)) {
          throw new Error(`Environment for '${owner}': package '${pkg.name}' resolves to '${source.dir}' which does not exist — run 'uv lock' or fix its path`);
        }
        build.set(pkg.name, source.dir);
      } else if (own.has(name)) {
        throw new Error(`Environment for '${owner}': '${pkg.name}' is a virtual package (no build-system) and cannot be an environment subject`);
      }
    }
  }
  return [...build.entries()].map(([name, dir]) => ({ name, dir })).sort((a, b) => byCodePoint(a.name, b.name));
}

/**
 * Walk up from `start` to the nearest `uv.lock`, parse and version-check it.
 * Returns the governing workspace/standalone root + parsed lock, or null when
 * no lock exists in `start` or any ancestor (no uv workspace to derive from).
 *
 * @internal
 * @throws {Error} if a lock is found but its version is unsupported
 */
export function findUvLock(start: string, owner: string): { root: string; lock: UvLock } | null {
  let dir = start;
  for (;;) {
    const candidate = path.join(dir, 'uv.lock');
    if (fs.existsSync(candidate)) {
      const lock = parseToml(fs.readFileSync(candidate, 'utf-8')) as unknown as UvLock;
      if (lock.version !== 1) {
        throw new Error(`Environment for '${owner}': unsupported uv.lock version ${lock.version} at '${dir}' — update @elaraai/e3 or re-lock with a compatible uv`);
      }
      return { root: dir, lock };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The distributions every east-py task runs with: the runtime, and the
 *  command that is its runner. */
const PYTHON_RUNTIME_DISTRIBUTIONS = ['elaraai-east-py', 'elaraai-east-py-cli'];

/**
 * The registry distributions a workspace member's environment installs beside
 * the member's own dependencies: the runtime's, and those of the stock
 * platform packages its task's runner names, as the lock pins them.
 *
 * @remarks
 * A workspace commonly lists these on its root alone, which an environment
 * that installs a member's dependencies would otherwise leave out. A stock
 * platform package `east-py-std` is the distribution `elaraai-east-py-std`.
 * One the lock does not hold, or holds as a local package, is not named: the
 * first comes from wherever the task runs, the second rides as an sdist.
 *
 * Each is named with the extras the workspace declares it with, on its root
 * or on any member (`elaraai-east-py-datascience[lightning]`): a member
 * whose task names the platform, and does not list the distribution itself,
 * runs with what the workspace asked of it, torch among it.
 *
 * One the lock holds as a local archive (`path`) is refused, as a member's
 * own is: an install would otherwise take a registry's copy of it.
 *
 * @internal
 * @param root - The workspace root
 * @param lock - Its lock
 * @param platforms - The platform packages the runner names
 * @param owner - The declaring task or function, which a refusal names
 * @returns The distributions, by PEP 503 name and with their extras, sorted
 * @throws {Error} When the lock holds one of them as a local archive
 */
export function pythonRequires(root: string, lock: UvLock, platforms: readonly string[], owner: string): string[] {
  const stock: readonly string[] = STOCK_PLATFORMS_BY_RUNNER.east_py;
  const wanted = new Set([...PYTHON_RUNTIME_DISTRIBUTIONS, ...platforms.filter((name) => stock.includes(name)).map((name) => `elaraai-${name}`)]
    .map(canonicalPythonName));
  // The extras the workspace's own packages declare each with
  const extras = new Map<string, Set<string>>();
  for (const pkg of lock.package ?? []) {
    if (localSource(root, pkg.source) === null) continue;
    for (const dependency of pkg.dependencies ?? []) {
      const name = canonicalPythonName(dependency.name);
      if (!wanted.has(name)) continue;
      const declared = extras.get(name) ?? new Set<string>();
      for (const extra of dependency.extra ?? []) declared.add(extra);
      extras.set(name, declared);
    }
  }
  const held = (lock.package ?? []).filter((pkg) => wanted.has(canonicalPythonName(pkg.name)));
  for (const pkg of held) if (typeof pkg.source?.path === 'string') throw localArchiveRefused(owner, pkg.name);
  return held
    .filter((pkg) => localSource(root, pkg.source) === null)
    .map((pkg) => {
      const name = canonicalPythonName(pkg.name);
      const declared = [...(extras.get(name) ?? [])].sort(byCodePoint);
      return declared.length === 0 ? name : `${name}[${declared.join(',')}]`;
    })
    .sort(byCodePoint);
}

/**
 * A required distribution, as {@link pythonRequires} names one: its name, and
 * the extras it is installed with.
 *
 * @param required - A name, or a name with its extras
 *   (`elaraai-east-py-datascience[lightning,torch]`)
 * @returns Its name and extras; null for what is neither, which its reader
 *   refuses in its own words
 * @example
 * readRequiredDistribution('elaraai-east-py-datascience[torch]'); // { name: 'elaraai-east-py-datascience', extras: ['torch'] }
 */
export function readRequiredDistribution(required: string): { name: string; extras: string[] } | null {
  const parts = /^([^[\]]+)(?:\[([^[\]]+)\])?$/.exec(required);
  return parts === null ? null : { name: parts[1]!, extras: parts[2]?.split(',') ?? [] };
}

/** The sources a lock installs a package from that are this machine's: what
 *  a sync told `--no-install-local` and `--no-install-workspace` installs
 *  nothing of. */
const LOCAL_SOURCE_KINDS = ['editable', 'directory', 'virtual', 'path'] as const;

/**
 * The packages of a workspace's lock, by the lock's names, that the sync
 * installing an environment's required distributions leaves out: every one it
 * installs from an index, a repository or a URL but those the required
 * distributions need, with their extras, and what those depend on.
 *
 * @remarks
 * So that sync installs the required distributions as the lock pins them and
 * from where the lock pins them — an explicit index of the workspace's
 * among them, which no install that resolves again from a registry reads —
 * and nothing else. A local package one of them depends on rides as an sdist
 * ({@link pythonClosure}), and no sync of an environment installs a local
 * package: none is taken from a registry.
 *
 * What a distribution needs is read from the lock for every platform it was
 * resolved for, its markers aside: one a platform does not need is in no
 * install for that platform, which the sync decides.
 *
 * @internal
 * @param lockText - The lock, as `uv.lock` holds it
 * @param requires - The required distributions, each a name or a name with
 *   its extras (`elaraai-east-py-datascience[lightning,torch]`), as
 *   {@link pythonRequires} names them
 * @returns The names, sorted
 * @throws {Error} When the lock is not of the version this reads, or a
 *   required distribution is not a name with or without extras
 * @example
 * const leftOut = pythonLeftOut(await readFile('uv.lock', 'utf8'), ['elaraai-east-py-datascience[torch]']);
 * // uv sync --frozen --inexact --all-packages ... --no-install-package <each>
 */
export function pythonLeftOut(lockText: string, requires: readonly string[]): string[] {
  const lock = parseToml(lockText) as unknown as UvLock;
  if (lock.version !== 1) throw new Error(`unsupported uv.lock version ${String(lock.version)}`);
  // Each of every version a name is locked at, one for each platform it forks for
  const needed = new Set<string>();
  for (const { name } of lockWalk(lock, requires.map(requiredStart))) needed.add(name);
  const local = (pkg: UvLockPackage): boolean => LOCAL_SOURCE_KINDS.some((kind) => typeof pkg.source?.[kind] === 'string');
  return [...new Set((lock.package ?? []).filter((pkg) => !local(pkg) && !needed.has(canonicalPythonName(pkg.name))).map((pkg) => pkg.name))].sort(byCodePoint);
}

/**
 * A required distribution, as {@link pythonRequires} names one, as a walk of
 * the lock starts from it.
 *
 * @internal
 * @param required - A name, or a name with its extras
 * @returns The distribution, with its extras
 * @throws {Error} When it is neither
 */
export function requiredStart(required: string): LockStart {
  const read = readRequiredDistribution(required);
  if (read === null) throw new Error(`the required distribution '${required}' is not a package's name`);
  return read;
}

/**
 * The local uv-workspace member a name refers to — the package a `{ custom }`
 * platform or an `East.importFunction(pkg, …)` names (#652) — resolved the
 * way `captureAutoEnvironment` resolves it: the governing `uv.lock`
 * above `anchorDir`, matched by PEP 503 canonical name, local sources only.
 *
 * @param name - The package name as referenced (import-style or canonical)
 * @param anchorDir - Directory the workspace is resolved from (the export cwd)
 * @param owner - The referencing task/function name, for error messages
 * @returns The member's directory and its `pyproject.toml` version, or null
 *   when there is no uv workspace above `anchorDir` or the name is not a
 *   local member (a registry package, a typo)
 */
export function pythonWorkspaceMember(name: string, anchorDir: string, owner: string): { dir: string; version: string | null } | null {
  const found = findUvLock(anchorDir, owner);
  if (!found) return null;
  const { root, lock } = found;
  const canon = canonicalPythonName(name);
  const pkg = (lock.package ?? []).find((p) => canonicalPythonName(p.name) === canon);
  const local = pkg === undefined ? null : localSource(root, pkg.source);
  if (local === null) return null;
  let version: string | null = null;
  try {
    const project = parseToml(fs.readFileSync(path.join(local.dir, 'pyproject.toml'), 'utf-8')) as { project?: { version?: unknown } };
    if (typeof project.project?.version === 'string') version = project.project.version;
  } catch {
    /* no readable pyproject: the exporter records its own default */
  }
  return { dir: local.dir, version };
}

/**
 * Where a python workspace member's code can come from (#1459): the governing
 * workspace's root — whose `uv.lock` and `pyproject.toml` pin everything else
 * — and the directories of the member and of every local package it depends
 * on, transitively, as `captureAutoEnvironment` walks them ({@link lockWalk}).
 * What the export cache keys a member's manifests on.
 *
 * Unlike the environment's walk this refuses nothing: a virtual package's
 * directory counts, and a registry or archive package is pinned by the lock.
 *
 * @param name - The package name as referenced (import-style or canonical)
 * @param anchorDir - Directory the workspace is resolved from (the export cwd)
 * @param owner - The referencing task/function name, for error messages
 * @returns The workspace root and the closure's directories, sorted, or null
 *   when there is no uv workspace above `anchorDir` or the name is not a
 *   local member
 */
export function pythonMemberSources(name: string, anchorDir: string, owner: string): { root: string; dirs: string[] } | null {
  const found = findUvLock(anchorDir, owner);
  if (!found) return null;
  const { root, lock } = found;
  const canon = canonicalPythonName(name);
  const subject = (lock.package ?? []).find((p) => canonicalPythonName(p.name) === canon);
  if (subject === undefined || localSource(root, subject.source) === null) return null;
  // Through registry packages too: one may depend on a local package
  const dirs = new Set<string>();
  for (const { packages } of lockWalk(lock, [{ name: subject.name }], (pkg) => localSource(root, pkg.source) !== null)) {
    for (const pkg of packages) {
      const local = localSource(root, pkg.source);
      if (local !== null) dirs.add(local.dir);
    }
  }
  return { root, dirs: [...dirs].sort() };
}
