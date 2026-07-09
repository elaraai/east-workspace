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
import { variant, encodeBeast2For } from '@elaraai/east';
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
    const closure = pythonClosure(lock, root, subject, owner);
    const sdists: Array<{ filename: string; hash: string }> = [];
    for (const member of closure) {
      // Build each closure member's sdist in its own out-dir so the artifact
      // set is unambiguous. Installers derive the package name from the
      // filename — keep it.
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
    spec = variant('python', { pyproject, lock: lockBlob, sdists });
  } else {
    const project = path.resolve(decl.node.project);
    const packageJson = addBlob(readProjectFile(project, 'package.json', owner));
    const lockName = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml']
      .find((f) => fs.existsSync(path.join(project, f)));
    if (!lockName) {
      throw new Error(
        `Environment for '${owner}': no lockfile (package-lock.json, npm-shrinkwrap.json ` +
        `or pnpm-lock.yaml) in project '${project}' — an environment project must be locked ` +
        `so the capture is reproducible`,
      );
    }
    const lock = addBlob(readProjectFile(project, lockName, owner));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-env-pack-'));
    try {
      const tarballs = buildArtifacts(
        'npm', ['pack', '--pack-destination', outDir], project, outDir, '.tgz', owner,
      ).map((a) => addBlob(a.data));
      spec = variant('node', { packageJson, lock, tarballs });
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }

  return encodeEnvironmentSpec(spec);
}
