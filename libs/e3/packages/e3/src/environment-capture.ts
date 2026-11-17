/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Execution environment capture — the Node-only half.
 *
 * Resolves an {@link EnvironmentDecl} to a content-addressed
 * `EnvironmentSpec` at package export time: the project's manifest +
 * lockfile are captured as blobs and the project's own package is built
 * (`uv build --sdist` / `npm pack`) so the implementation code itself rides
 * the object store to wherever the task runs.
 *
 * Split from `environment.ts` so the declaration types + definition-time
 * validation stay importable from the browser-safe `@elaraai/e3/browser`
 * surface (#99): this module shells out and reads the filesystem, so it is
 * re-exported only from the Node-only main `@elaraai/e3` entry, alongside
 * `export.ts` / `sha256.ts`.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * One environment-capture progress event (#311) — emitted after each member
 * artifact build (`uv build --sdist` / `npm pack`), so callers can surface
 * per-member progress during otherwise-silent multi-member exports.
 */
export interface CaptureEvent {
  /** The captured member/project name. */
  member: string;
  /** The tool that produced the artifact (e.g. `uv build --sdist`, `npm pack`). */
  tool: string;
  /** Total artifact bytes captured for this member. */
  bytes: number;
}

/** Capture progress callback (#311). */
export type CaptureEventFn = (event: CaptureEvent) => void;
import { parse as parseToml } from 'smol-toml';
import { variant, none, encodeBeast2For } from '@elaraai/east';
import type { EnvironmentSpec } from '@elaraai/e3-types';
import { EnvironmentSpecType } from '@elaraai/e3-types';
import { validateEnvironmentDecl, type EnvironmentDecl } from './environment.js';
import { STOCK_PLATFORMS_BY_RUNNER } from './runner.js';

const encodeEnvironmentSpec = encodeBeast2For(EnvironmentSpecType);

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
  'dev-dependencies'?: Record<string, Array<{ name: string }>>;
}
/** A uv lock, for what a capture reads of it. */
export interface UvLock {
  version?: number;
  manifest?: { members?: string[] };
  package?: UvLockPackage[];
}

/** Canonicalize a path for identity comparison — realpath when it exists,
 *  case-folded on win32 (uv.lock stores portable forward-slash relatives). */
function canonicalPath(p: string): string {
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
 *  a local archive (`path`), which no environment takes. */
function localSource(root: string, source: Record<string, string> | undefined):
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

/**
 * Every package of a lock that `starts` reach by what they depend on, each
 * once, in the order they are reached: the starts, then what each depends on
 * — its dependencies, and those of every optional and development group —
 * through a package of any source. A registry package's dependency may be a
 * local package: the lock resolves a name the workspace holds to the
 * workspace's package.
 *
 * @param lock - The lock
 * @param starts - The packages to start from, by the lock's names
 * @returns Each package reached, by its name, with its entry; none for a name
 *   the lock does not hold
 */
function* lockReach(lock: UvLock, starts: readonly string[]): Generator<{ name: string; pkg: UvLockPackage | undefined }> {
  const byName = new Map((lock.package ?? []).map((p) => [p.name, p]));
  const seen = new Set<string>();
  const queue = [...starts];
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const pkg = byName.get(name);
    yield { name, pkg };
    if (pkg === undefined) continue;
    for (const edge of [
      ...(pkg.dependencies ?? []),
      ...Object.values(pkg['optional-dependencies'] ?? {}).flat(),
      ...Object.values(pkg['dev-dependencies'] ?? {}).flat(),
    ]) queue.push(edge.name);
  }
}

/**
 * Find the workspace/standalone root governing `project` and the lock
 * package (`subject`) whose local source resolves to it.
 *
 * @throws {Error} P3 (no lock in project or any ancestor), P5 (unsupported
 *   lock version), P4 (lock does not list a package at `project`)
 */
function discoverPythonRoot(project: string, owner: string): { root: string; lock: UvLock; subject: string } {
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
 * Walks `dependencies` plus every optional-dependency and dev-dependency
 * group (over-capture is sound: it only over-invalidates), through packages
 * of every source ({@link lockReach}): a registry package is installed from
 * the lock, and a local package it depends on rides as an sdist, as the
 * installs take no local package from a registry. A `path=<archive>` source is
 * refused, and a virtual package contributes its deps but no sdist.
 *
 * @param subjects - The members the environment is of, by the lock's names
 * @param required - The registry distributions it requires beside them
 * @returns The buildable closure members, sorted by name
 * @throws {Error} P6 (dangling edge), P7 (subject not packaged), P8 (source
 *   dir missing), P9 (local archive dependency)
 */
function pythonClosure(lock: UvLock, root: string, subjects: readonly string[], owner: string,
  required: readonly string[] = []): Array<{ name: string; dir: string }> {
  const build = new Map<string, string>();
  for (const { name, pkg } of lockReach(lock, [...subjects, ...required])) {
    if (!pkg) {
      if (subjects.includes(name)) throw new Error(`Environment for '${owner}': subject '${name}' not in uv.lock`);
      throw new Error(`Environment for '${owner}': uv.lock is inconsistent — depends on unknown '${name}'; run 'uv lock'`);
    }
    if (typeof pkg.source?.path === 'string') throw localArchiveRefused(owner, name);
    const local = localSource(root, pkg.source);
    if (!local) continue; // registry/git/url — sync installs it, and what it depends on is walked
    if (local.kind !== 'virtual') {
      if (!fs.existsSync(local.dir)) {
        throw new Error(`Environment for '${owner}': package '${name}' resolves to '${local.dir}' which does not exist — run 'uv lock' or fix its path`);
      }
      build.set(name, local.dir);
    } else if (subjects.includes(name)) {
      throw new Error(`Environment for '${owner}': '${name}' is a virtual package (no build-system) and cannot be an environment subject`);
    }
  }
  return [...build.entries()].map(([name, dir]) => ({ name, dir })).sort((a, b) => (a.name < b.name ? -1 : 1));
}

function readProjectFile(project: string, name: string, owner: string): Buffer {
  const p = path.join(project, name);
  if (!fs.existsSync(p)) {
    throw new Error(
      `Environment for '${owner}': ${name} not found in project '${project}' — ` +
      `an environment project must be locked (${name} present) so the capture is reproducible`,
    );
  }
  return fs.readFileSync(p);
}

/**
 * Walk up from `start` to the nearest `uv.lock`, parse and version-check it.
 * Returns the governing workspace/standalone root + parsed lock, or null when
 * no lock exists in `start` or any ancestor (no uv workspace to derive from).
 *
 * @throws {Error} if a lock is found but its version is unsupported
 */
function findUvLock(start: string, owner: string): { root: string; lock: UvLock } | null {
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

/**
 * Build one sdist per closure member and store it, returning the sorted
 * artifact set. Shared by the explicit `{ python }` capture and the derived
 * platform capture so both produce byte-identical specs for the same closure.
 */
function buildMemberSdists(
  closure: Array<{ name: string; dir: string }>,
  owner: string,
  addBlob: (data: Buffer) => string,
  onEvent?: CaptureEventFn,
): Array<{ filename: string; hash: string }> {
  const sdists: Array<{ filename: string; hash: string }> = [];
  for (const member of closure) {
    // Build each closure member's sdist in its own out-dir so the artifact set
    // is unambiguous. Installers derive the package name from the filename.
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-env-sdist-'));
    try {
      let memberBytes = 0;
      for (const a of buildArtifacts('uv', ['build', '--sdist', '--out-dir', outDir], member.dir, outDir, '.tar.gz', owner)) {
        memberBytes += a.data.byteLength;
        sdists.push({ filename: a.filename, hash: addBlob(a.data) });
      }
      onEvent?.({ member: member.name, tool: 'uv build --sdist', bytes: memberBytes });
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
  sdists.sort((a, b) => (a.filename < b.filename ? -1 : 1));
  return sdists;
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
      const declared = [...(extras.get(name) ?? [])].sort();
      return declared.length === 0 ? name : `${name}[${declared.join(',')}]`;
    })
    .sort();
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
 * ({@link captureEnvironment}), and no sync of an environment installs a local
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
  const packages = lock.package ?? [];
  // A name may be locked at several versions, one for each platform it forks for
  const byName = new Map<string, UvLockPackage[]>();
  for (const pkg of packages) {
    const name = canonicalPythonName(pkg.name);
    byName.set(name, [...(byName.get(name) ?? []), pkg]);
  }
  const needed = new Set<string>();
  // What has been walked: a package's dependencies by its name, and an extra's by `name[extra]`
  const walked = new Set<string>();
  const queue = requires.map((required) => {
    const read = readRequiredDistribution(required);
    if (read === null) throw new Error(`the required distribution '${required}' is not a package's name`);
    return read;
  });
  while (queue.length > 0) {
    const { name, extras } = queue.shift()!;
    const key = canonicalPythonName(name);
    needed.add(key);
    const fresh = [...(walked.has(key) ? [] : ['']), ...extras.filter((extra) => !walked.has(`${key}[${extra}]`))];
    for (const pkg of byName.get(key) ?? []) {
      for (const part of fresh) {
        for (const edge of part === '' ? pkg.dependencies ?? [] : pkg['optional-dependencies']?.[part] ?? []) {
          queue.push({ name: edge.name, extras: edge.extra ?? [] });
        }
      }
    }
    for (const part of fresh) walked.add(part === '' ? key : `${key}[${part}]`);
  }
  const local = (pkg: UvLockPackage): boolean => LOCAL_SOURCE_KINDS.some((kind) => typeof pkg.source?.[kind] === 'string');
  return [...new Set(packages.filter((pkg) => !local(pkg) && !needed.has(canonicalPythonName(pkg.name))).map((pkg) => pkg.name))].sort();
}

/**
 * Captures the environment of members of a uv workspace: the root's manifest
 * and lock, the sdists of the members and of every local package they — or
 * the distributions installed beside them — depend on, and those
 * distributions.
 *
 * @param root - The workspace root
 * @param lock - Its lock
 * @param subjects - The members, by the lock's names
 * @param platforms - The platform packages the task's runner names
 * @returns The encoded `workspace_python` spec
 */
function captureWorkspacePython(
  root: string,
  lock: UvLock,
  subjects: readonly string[],
  platforms: readonly string[],
  owner: string,
  addBlob: (data: Buffer) => string,
  onEvent?: CaptureEventFn,
): Uint8Array {
  const requires = pythonRequires(root, lock, platforms, owner);
  // The lock's own spelling of each required distribution, for the walk
  const required = requires.map((name) => name.replace(/\[.*$/, ''))
    .flatMap((name) => (lock.package ?? []).filter((pkg) => canonicalPythonName(pkg.name) === name).map((pkg) => pkg.name));
  const members = pythonClosure(lock, root, subjects, owner, required);
  const pyproject = addBlob(readProjectFile(root, 'pyproject.toml', owner));
  const lockBlob = addBlob(readProjectFile(root, 'uv.lock', owner));
  const sdists = buildMemberSdists(members, owner, addBlob, onEvent);
  return encodeEnvironmentSpec(variant('workspace_python', {
    pyproject, lock: lockBlob, subjects: [...subjects].sort(), sdists, requires,
  }));
}

/**
 * Derive a python environment from the platform packages a task's runner
 * references. Each `custom` name that resolves to a LOCAL workspace member
 * (a directory/workspace/editable source in the governing `uv.lock`)
 * contributes its transitive closure; the union rides ONE `workspace_python`
 * spec — shared root manifest + lock, the members as its subjects, the union
 * of their sdists. Names are matched by PEP 503 canonical form, so an
 * import-style ref (`platform_module`) finds its lock entry
 * (`platform-module`). A stock platform package the runner names
 * (`east-py-std`) is no member: it is installed from the registry, as the
 * lock pins it ({@link pythonRequires}). Returns null when `anchorDir` has no
 * uv workspace or no referenced name is a local member (nothing to capture
 * beyond the ambient runtime).
 */
function capturePythonPlatforms(
  customNames: string[],
  platforms: readonly string[],
  anchorDir: string,
  owner: string,
  addBlob: (data: Buffer) => string,
  onEvent?: CaptureEventFn,
): Uint8Array | null {
  const found = findUvLock(anchorDir, owner);
  if (!found) return null;
  const { root, lock } = found;
  // Match refs to lock packages by PEP 503 canonical name — `{ custom }`
  // names are import-style (`sim_engine`), the lock stores `sim-engine`.
  // Subjects carry the LOCK's spelling so the closure walk stays lock-keyed.
  const subjects = [...new Set(
    customNames
      .map((name) => {
        const canon = canonicalPythonName(name);
        const pkg = (lock.package ?? []).find((p) => canonicalPythonName(p.name) === canon);
        return pkg !== undefined && localSource(root, pkg.source) !== null ? pkg.name : null;
      })
      .filter((n): n is string => n !== null),
  )];
  if (subjects.length === 0) return null;
  return captureWorkspacePython(root, lock, subjects, platforms, owner, addBlob, onEvent);
}

/**
 * The local uv-workspace member a name refers to — the package a `{ custom }`
 * platform or an `East.importFunction(pkg, …)` names (#652) — resolved the
 * way {@link captureAutoEnvironment} resolves it: the governing `uv.lock`
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
 * on, transitively, as {@link captureAutoEnvironment} walks them. What the
 * export cache keys a member's manifests on.
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
  for (const { pkg } of lockReach(lock, [subject.name])) {
    const local = pkg === undefined ? null : localSource(root, pkg.source);
    if (local !== null) dirs.add(local.dir);
  }
  return { root, dirs: [...dirs].sort() };
}

/** Walk up from `start` to the nearest npm lockfile (not pnpm/yarn); null if none. */
function findNpmRoot(start: string): { root: string; lock: NpmLock } | null {
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
 * way {@link captureAutoEnvironment} resolves it: the governing npm lockfile
 * above `anchorDir`, matched by `package.json` name, workspace members only
 * (never an installed dependency). The python twin is
 * {@link pythonWorkspaceMember}.
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

/**
 * Derive a node environment from the platform packages a task's runner
 * references. Each `custom` name that resolves to a LOCAL npm workspace member
 * (matched by package.json name in the governing lockfile) is captured through
 * the same `workspace_node` path as an explicit `{ node }`. Registry /
 * first-party names are skipped. Returns null when `anchorDir` has no npm
 * workspace or no referenced name is a local member.
 *
 * Multiple local node members in ONE task are not unioned yet (that needs a
 * multi-subject `workspace_node` spec) — declare an explicit `environment`.
 */
function captureNodePlatforms(
  customNames: string[],
  anchorDir: string,
  owner: string,
  addBlob: (data: Buffer) => string,
  onEvent?: CaptureEventFn,
): Uint8Array | null {
  const found = findNpmRoot(anchorDir);
  if (!found) return null;
  const { root, lock } = found;
  const memberDirs = customNames
    .map((name) => {
      const entry = Object.entries(lock.packages ?? {}).find(
        ([p, v]) => p !== '' && !p.startsWith('node_modules/') && v.name === name && v.link !== true,
      );
      return entry ? path.join(root, entry[0]) : null;
    })
    .filter((d): d is string => d !== null);
  if (memberDirs.length === 0) return null;
  if (memberDirs.length > 1) {
    throw new Error(
      `Environment for '${owner}': a task referencing multiple local node packages ` +
      `(${customNames.join(', ')}) needs an explicit \`environment\` — auto-union of npm ` +
      `workspace members is not supported yet`,
    );
  }
  // A single member reuses the explicit workspace_node capture verbatim.
  return captureEnvironment({ node: { project: memberDirs[0]! } }, owner, addBlob, onEvent);
}

/**
 * Derive an EnvironmentSpec from a task/function's RUNNER platform references,
 * for tasks that declare no explicit `environment`. Resolves each `{ custom }`
 * platform name to its local workspace member and captures the union of their
 * closures — so a project split into packages gets per-package change-detection
 * granularity with zero `environment` boilerplate. The `environment` field
 * remains the explicit override (and the only way to reach `tools` / `image`,
 * which are never auto-derived).
 *
 * @param runtime - The runner runtime tag (e.g. `east-py`, `east-node`)
 * @param customNames - The `{ custom: X }` platform names declared on the runner
 * @param anchorDir - Directory the workspace is resolved from (the export cwd)
 * @param owner - The declaring task/function name, for error messages
 * @param addBlob - Stores a blob in the bundle's object store, returning its hash
 * @param onEvent - Told each member's artifact as it is built
 * @param platforms - The stock platform packages the runner names beside its
 *   custom ones (`east-py-std`): a python workspace member's environment
 *   installs their distributions too
 * @returns The beast2-encoded EnvironmentSpec, or null when nothing local is
 *   referenced (no workspace, or every platform is a registry/first-party package)
 */
export function captureAutoEnvironment(
  runtime: string,
  customNames: string[],
  anchorDir: string,
  owner: string,
  addBlob: (data: Buffer) => string,
  onEvent?: CaptureEventFn,
  platforms: readonly string[] = [],
): Uint8Array | null {
  if (customNames.length === 0) return null;
  // east-py resolves against a uv workspace, east-node against an npm
  // workspace. east-c (tools) is never derived — it uses explicit
  // `environment: { tools }`. Unknown runtimes never auto-derive.
  if (runtime === 'east-py') return capturePythonPlatforms(customNames, platforms, anchorDir, owner, addBlob, onEvent);
  if (runtime === 'east-node') return captureNodePlatforms(customNames, anchorDir, owner, addBlob, onEvent);
  return null;
}

function buildArtifacts(
  command: string,
  args: string[],
  project: string,
  outDir: string,
  extension: string,
  owner: string,
): { filename: string; data: Buffer }[] {
  try {
    execFileSync(command, args, {
      cwd: project,
      stdio: ['ignore', 'pipe', 'pipe'],
      // npm is npm.cmd on Windows; a shell resolves both.
      shell: process.platform === 'win32',
    });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err);
    throw new Error(
      `Environment for '${owner}': '${command} ${args.join(' ')}' failed in '${project}':\n${stderr}`,
    );
  }
  const files = fs.readdirSync(outDir).filter((f) => f.endsWith(extension)).sort();
  if (files.length === 0) {
    throw new Error(
      `Environment for '${owner}': '${command}' produced no ${extension} artifacts in '${project}'`,
    );
  }
  return files.map((f) => ({ filename: f, data: fs.readFileSync(path.join(outDir, f)) }));
}

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
interface NpmLock { lockfileVersion?: number; packages?: Record<string, NpmLockEntry> }

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
 * @throws {Error} N1 (no lockfile anywhere), N8 (pnpm workspace — unsupported
 *   yet), N3 (project is the workspace root), N2 (not a member of the workspace)
 */
function discoverNodeRoot(project: string, owner: string):
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
 * @returns Closure members (workspace-relative path + package name), sorted by path
 * @throws {Error} N4 (a member's on-disk manifest drifted from the lock — npm
 *   ci would silently install unlocked deps), N5 (a dep shadows a workspace
 *   member name from the registry), N6 (root depends on a member), N7 (a local
 *   dep resolves outside the workspace)
 */
function npmClosure(lock: NpmLock, root: string, subject: string, owner: string): Array<{ path: string; name: string }> {
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
  return [...included.entries()].map(([p, name]) => ({ path: p, name })).sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * Resolves an environment declaration to an encoded {@link EnvironmentSpec}
 * at package export time.
 *
 * Reads the project's manifest + lockfile, builds the project's own package
 * artifacts (`uv build --sdist` / `npm pack`), stores every blob through
 * `addBlob`, and returns the beast2-encoded spec (whose object hash is the
 * environment hash).
 *
 * @param decl - The declaration to resolve
 * @param owner - The declaring task/function name, for error messages
 * @param addBlob - Stores a blob in the bundle's object store, returning its hash
 * @param onEvent - Told each member's artifact as it is built
 * @param platforms - The stock platform packages the declaring task's runner
 *   names (`east-py-std`): the environment of a python workspace's member
 *   installs their distributions too
 * @returns The beast2-encoded EnvironmentSpec bytes
 * @throws {Error} if the project is missing its manifest/lockfile or the build fails
 */
export function captureEnvironment(
  decl: EnvironmentDecl,
  owner: string,
  addBlob: (data: Buffer) => string,
  onEvent?: CaptureEventFn,
  platforms: readonly string[] = [],
): Uint8Array {
  let spec: EnvironmentSpec;

  if ('image' in decl) {
    validateEnvironmentDecl(decl, owner);
    spec = variant('image', { digest: decl.image.digest });
  } else if ('tools' in decl) {
    validateEnvironmentDecl(decl, owner);
    // Capture each named prebuilt file as a blob under bin/<basename>,
    // sorted by path so declaration order never affects the env hash. e3
    // builds nothing here — the developer built these.
    const files = decl.tools.files.map((f) => {
      const p = path.resolve(f);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(p); // follows symlinks — captures the target's bytes
      } catch {
        throw new Error(`Environment for '${owner}': tools file '${f}' not found at '${p}' — build it before export (e3 does not build your binaries)`);
      }
      if (!stat.isFile()) {
        throw new Error(`Environment for '${owner}': tools file '${f}' at '${p}' is not a regular file`);
      }
      return { path: `bin/${path.basename(p)}`, hash: addBlob(fs.readFileSync(p)) };
    });
    files.sort((a, b) => (a.path < b.path ? -1 : 1));
    spec = variant('tools', { files });
  } else if ('python' in decl) {
    const project = path.resolve(decl.python.project);
    // Identity + closure come from the governing (root) lock. A member's own
    // pyproject rides inside its sdist.
    const { root, lock, subject } = discoverPythonRoot(project, owner);
    // A member of a workspace names itself, so its environment installs its
    // own dependencies and not its workspace's (#1654)
    if (canonicalPath(root) !== canonicalPath(project)) {
      return captureWorkspacePython(root, lock, [subject], platforms, owner, addBlob, onEvent);
    }
    // A project that is its own root: the ROOT manifest/lockfile are its own,
    // and materialization syncs the whole of its lock. The captured spec is
    // byte-identical to the pre-#278 single-project one.
    const pyproject = addBlob(readProjectFile(root, 'pyproject.toml', owner));
    const lockBlob = addBlob(readProjectFile(root, 'uv.lock', owner));
    const sdists = buildMemberSdists(pythonClosure(lock, root, [subject], owner), owner, addBlob, onEvent);
    spec = variant('python', { pyproject, lock: lockBlob, sdists });
  } else {
    const project = path.resolve(decl.node.project);
    const disco = discoverNodeRoot(project, owner);
    if (disco.mode === 'single') {
      // Self-contained project — today's byte-identical capture.
      const packageJson = addBlob(readProjectFile(project, 'package.json', owner));
      const lock = addBlob(readProjectFile(project, disco.lockName, owner));
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-env-pack-'));
      try {
        const built = buildArtifacts(
          'npm', ['pack', '--pack-destination', outDir], project, outDir, '.tgz', owner,
        );
        onEvent?.({
          member: path.basename(project),
          tool: 'npm pack',
          bytes: built.reduce((sum, a) => sum + a.data.byteLength, 0),
        });
        const tarballs = built.map((a) => addBlob(a.data));
        spec = variant('node', { packageJson, lock, tarballs });
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    } else {
      // npm workspace member — capture the ROOT manifest/lock + a pack
      // tarball per LOCAL closure member (validated against the lock).
      const { root, lock, subject } = disco;
      const packageJson = addBlob(readProjectFile(root, 'package.json', owner));
      const lockBlob = addBlob(readProjectFile(root, 'package-lock.json', owner));
      const closure = npmClosure(lock, root, subject, owner);
      const members = closure.map((member) => {
        const memberDir = path.join(root, ...member.path.split('/'));
        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-env-pack-'));
        try {
          const built = buildArtifacts('npm', ['pack', '--pack-destination', outDir], memberDir, outDir, '.tgz', owner);
          onEvent?.({ member: member.name, tool: 'npm pack', bytes: built[0]!.data.byteLength });
          return { path: member.path, name: member.name, tarball: addBlob(built[0]!.data) };
        } finally {
          fs.rmSync(outDir, { recursive: true, force: true });
        }
      });
      spec = variant('workspace_node', { packageJson, lock: lockBlob, config: none, subject, members });
    }
  }

  return encodeEnvironmentSpec(spec);
}
