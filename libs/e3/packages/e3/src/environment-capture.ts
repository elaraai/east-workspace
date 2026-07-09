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
import { parse as parseToml } from 'smol-toml';
import { variant, none, encodeBeast2For } from '@elaraai/east';
import type { EnvironmentSpec } from '@elaraai/e3-types';
import { EnvironmentSpecType } from '@elaraai/e3-types';
import { validateEnvironmentDecl, type EnvironmentDecl } from './environment.js';

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
// The lock is the single source of truth: we do not mirror uv's workspace
// discovery, we only trust what `uv lock` recorded. The materializer's
// fail-closed `uv pip check` (#275) means a closure that misses a local
// package fails loudly at build time, never as silent wrong code — so this
// walk favours simplicity and slight over-capture over cleverness.
// ---------------------------------------------------------------------------

interface UvLockPackage {
  name: string;
  source?: Record<string, string>;
  dependencies?: Array<{ name: string; extra?: string[] }>;
  'optional-dependencies'?: Record<string, Array<{ name: string }>>;
  'dev-dependencies'?: Record<string, Array<{ name: string }>>;
}
interface UvLock {
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

/** The on-disk directory a lock `source` points at, with its kind — or null
 *  for registry/git/url sources (installed by uv sync, not captured). */
function localSource(root: string, source: Record<string, string> | undefined):
  { dir: string; kind: 'editable' | 'directory' | 'virtual' } | null {
  if (!source) return null;
  for (const kind of ['editable', 'directory', 'virtual'] as const) {
    if (typeof source[kind] === 'string') return { dir: path.resolve(root, source[kind]!), kind };
  }
  return null;
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
 * The transitive closure of LOCAL packages reachable from `subject` — the
 * set whose sdists must ride the environment.
 *
 * Walks `dependencies` plus every optional-dependency and dev-dependency
 * group (over-capture is sound: it only over-invalidates). Registry/git/url
 * targets are skipped (uv sync installs them); a `path=<archive>` source is
 * refused, and a virtual package contributes its deps but no sdist.
 *
 * @returns The buildable closure members, sorted by name
 * @throws {Error} P6 (dangling edge), P7 (subject not packaged), P8 (source
 *   dir missing), P9 (local archive dependency)
 */
function pythonClosure(lock: UvLock, root: string, subject: string, owner: string): Array<{ name: string; dir: string }> {
  const byName = new Map((lock.package ?? []).map((p) => [p.name, p]));
  const build = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [subject];
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const pkg = byName.get(name);
    if (!pkg) {
      if (name === subject) throw new Error(`Environment for '${owner}': subject '${name}' not in uv.lock`);
      throw new Error(`Environment for '${owner}': uv.lock is inconsistent — depends on unknown '${name}'; run 'uv lock'`);
    }
    if (typeof pkg.source?.path === 'string') {
      throw new Error(`Environment for '${owner}': local archive dependency '${name}' is not supported — use a directory/workspace source or a registry`);
    }
    const local = localSource(root, pkg.source);
    if (!local) continue; // registry/git/url — sync installs it; don't recurse
    if (local.kind !== 'virtual') {
      if (!fs.existsSync(local.dir)) {
        throw new Error(`Environment for '${owner}': package '${name}' resolves to '${local.dir}' which does not exist — run 'uv lock' or fix its path`);
      }
      build.set(name, local.dir);
    } else if (name === subject) {
      throw new Error(`Environment for '${owner}': '${name}' is a virtual package (no build-system) and cannot be an environment subject`);
    }
    for (const edge of [
      ...(pkg.dependencies ?? []),
      ...Object.values(pkg['optional-dependencies'] ?? {}).flat(),
      ...Object.values(pkg['dev-dependencies'] ?? {}).flat(),
    ]) queue.push(edge.name);
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
): Array<{ filename: string; hash: string }> {
  const sdists: Array<{ filename: string; hash: string }> = [];
  for (const member of closure) {
    // Build each closure member's sdist in its own out-dir so the artifact set
    // is unambiguous. Installers derive the package name from the filename.
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-env-sdist-'));
    try {
      for (const a of buildArtifacts('uv', ['build', '--sdist', '--out-dir', outDir], member.dir, outDir, '.tar.gz', owner)) {
        sdists.push({ filename: a.filename, hash: addBlob(a.data) });
      }
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
  sdists.sort((a, b) => (a.filename < b.filename ? -1 : 1));
  return sdists;
}

/**
 * Derive a python environment from the platform packages a task's runner
 * references. Each `custom` name that resolves to a LOCAL workspace member
 * (a directory/workspace/editable source in the governing `uv.lock`)
 * contributes its transitive closure; the union rides ONE `python` spec —
 * shared root manifest + lock, union of member sdists (byte-identical to the
 * explicit capture of a project depending on all of them). Registry /
 * first-party names (e.g. `east-py-std`) are skipped — `uv sync` installs
 * them. Returns null when `anchorDir` has no uv workspace or no referenced
 * name is a local member (nothing to capture beyond the ambient runtime).
 */
function capturePythonPlatforms(
  customNames: string[],
  anchorDir: string,
  owner: string,
  addBlob: (data: Buffer) => string,
): Uint8Array | null {
  const found = findUvLock(anchorDir, owner);
  if (!found) return null;
  const { root, lock } = found;
  const subjects = customNames.filter((name) => {
    const pkg = (lock.package ?? []).find((p) => p.name === name);
    return pkg !== undefined && localSource(root, pkg.source) !== null;
  });
  if (subjects.length === 0) return null;
  // Union the referenced members' closures, deduped by package name.
  const union = new Map<string, string>();
  for (const subject of subjects) {
    for (const member of pythonClosure(lock, root, subject, owner)) union.set(member.name, member.dir);
  }
  const pyproject = addBlob(readProjectFile(root, 'pyproject.toml', owner));
  const lockBlob = addBlob(readProjectFile(root, 'uv.lock', owner));
  const members = [...union.entries()].map(([name, dir]) => ({ name, dir })).sort((a, b) => (a.name < b.name ? -1 : 1));
  const sdists = buildMemberSdists(members, owner, addBlob);
  return encodeEnvironmentSpec(variant('python', { pyproject, lock: lockBlob, sdists }));
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
 * @returns The beast2-encoded EnvironmentSpec, or null when nothing local is
 *   referenced (no workspace, or every platform is a registry/first-party package)
 */
export function captureAutoEnvironment(
  runtime: string,
  customNames: string[],
  anchorDir: string,
  owner: string,
  addBlob: (data: Buffer) => string,
): Uint8Array | null {
  if (customNames.length === 0) return null;
  // east-py resolves against a uv workspace. east-node (npm) auto-derivation
  // and east-c (tools) are not derived here yet — they use explicit
  // `environment`. Unknown runtimes never auto-derive.
  if (runtime === 'east-py') return capturePythonPlatforms(customNames, anchorDir, owner, addBlob);
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
 * @returns The beast2-encoded EnvironmentSpec bytes
 * @throws {Error} if the project is missing its manifest/lockfile or the build fails
 */
export function captureEnvironment(
  decl: EnvironmentDecl,
  owner: string,
  addBlob: (data: Buffer) => string,
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
    // Identity + closure come from the governing (root) lock; the ROOT
    // manifest/lockfile are captured so materialization can `uv sync
    // --all-packages` the whole third-party set. A member's own pyproject
    // rides inside its sdist. For a standalone project root === project, so
    // the captured spec is byte-identical to the pre-#278 single-project one.
    const { root, lock, subject } = discoverPythonRoot(project, owner);
    const pyproject = addBlob(readProjectFile(root, 'pyproject.toml', owner));
    const lockBlob = addBlob(readProjectFile(root, 'uv.lock', owner));
    const sdists = buildMemberSdists(pythonClosure(lock, root, subject, owner), owner, addBlob);
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
        const tarballs = buildArtifacts(
          'npm', ['pack', '--pack-destination', outDir], project, outDir, '.tgz', owner,
        ).map((a) => addBlob(a.data));
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
