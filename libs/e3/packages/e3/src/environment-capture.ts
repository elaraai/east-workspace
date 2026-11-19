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
 *
 * What it reads of a project's lock is the lock modules': a uv lock's
 * (`environment-uv-lock.ts`) and an npm lock's (`environment-npm-lock.ts`).
 * This module builds and stores what they name.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { StringType, compareFor, variant, none, encodeBeast2For } from '@elaraai/east';
import type { EnvironmentSpec } from '@elaraai/e3-types';
import { EnvironmentSpecType } from '@elaraai/e3-types';
import { validateEnvironmentDecl, type EnvironmentDecl } from './environment.js';
import { canonicalPath, canonicalPythonName, discoverPythonRoot, findUvLock, ownPackage, pythonClosure, pythonRequires, requiredStart,
  type UvLock } from './environment-uv-lock.js';
import { discoverNodeRoot, findNpmRoot, npmClosure } from './environment-npm-lock.js';

export { canonicalPythonName, pythonInstalls, pythonLeftOut, pythonLockSettings, pythonMemberSources, pythonRequires, pythonWorkspaceMember, readRequiredDistribution,
  type PythonSync, type UvLock, type UvLockPackage } from './environment-uv-lock.js';
export { nodeWorkspaceMember } from './environment-npm-lock.js';

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

const encodeEnvironmentSpec = encodeBeast2For(EnvironmentSpecType);

/** Orders the names and paths a spec holds through East, by code point. */
const byCodePoint = compareFor(StringType);

/**
 * The sdists an export built of each local python package, by the package's
 * directory: built once in an export, however many environments it rides in.
 * The environments of one declaration whose runners name different stock
 * platforms differ in what they require, and share their members' builds, so
 * one that names the same distributions is the same spec, byte for byte, even
 * from a build backend whose sdists are not reproducible.
 */
export type BuiltSdists = Map<string, ReadonlyArray<{ filename: string; hash: string }>>;

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
 * Build one sdist per closure member and store it, returning the sorted
 * artifact set. Shared by the explicit `{ python }` capture and the derived
 * platform capture so both produce byte-identical specs for the same closure.
 * A member the export built already ({@link BuiltSdists}) is not built again.
 */
function buildMemberSdists(
  closure: Array<{ name: string; dir: string }>,
  owner: string,
  addBlob: (data: Buffer) => string,
  onEvent?: CaptureEventFn,
  built?: BuiltSdists,
): Array<{ filename: string; hash: string }> {
  const sdists: Array<{ filename: string; hash: string }> = [];
  for (const member of closure) {
    const kept = built?.get(member.dir);
    if (kept !== undefined) {
      sdists.push(...kept);
      continue;
    }
    const mine: Array<{ filename: string; hash: string }> = [];
    // Build each closure member's sdist in its own out-dir so the artifact set
    // is unambiguous. Installers derive the package name from the filename.
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-env-sdist-'));
    try {
      let memberBytes = 0;
      for (const a of buildArtifacts('uv', ['build', '--sdist', '--out-dir', outDir], member.dir, outDir, '.tar.gz', owner)) {
        memberBytes += a.data.byteLength;
        mine.push({ filename: a.filename, hash: addBlob(a.data) });
      }
      onEvent?.({ member: member.name, tool: 'uv build --sdist', bytes: memberBytes });
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
    built?.set(member.dir, mine);
    sdists.push(...mine);
  }
  sdists.sort((a, b) => byCodePoint(a.filename, b.filename));
  return sdists;
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
 * @param built - The sdists the export built already
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
  built?: BuiltSdists,
): Uint8Array {
  const requires = pythonRequires(lock, platforms, owner);
  // Walked as each is installed: with its extras
  const members = pythonClosure(lock, root, subjects, owner, requires.map(requiredStart));
  const pyproject = addBlob(readProjectFile(root, 'pyproject.toml', owner));
  const lockBlob = addBlob(readProjectFile(root, 'uv.lock', owner));
  const sdists = buildMemberSdists(members, owner, addBlob, onEvent, built);
  return encodeEnvironmentSpec(variant('workspace_python', {
    pyproject, lock: lockBlob, subjects: [...subjects].sort(byCodePoint), sdists, requires,
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
  built?: BuiltSdists,
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
        return pkg !== undefined && ownPackage(pkg) ? pkg.name : null;
      })
      .filter((n): n is string => n !== null),
  )];
  if (subjects.length === 0) return null;
  return captureWorkspacePython(root, lock, subjects, platforms, owner, addBlob, onEvent, built);
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
 * @param built - The sdists the export built already, which it adds to: each
 *   local python package is built once in an export ({@link BuiltSdists})
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
  built?: BuiltSdists,
): Uint8Array | null {
  if (customNames.length === 0) return null;
  // east-py resolves against a uv workspace, east-node against an npm
  // workspace. east-c (tools) is never derived — it uses explicit
  // `environment: { tools }`. Unknown runtimes never auto-derive.
  if (runtime === 'east-py') return capturePythonPlatforms(customNames, platforms, anchorDir, owner, addBlob, onEvent, built);
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
  const files = fs.readdirSync(outDir).filter((f) => f.endsWith(extension)).sort(byCodePoint);
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
 * @param onEvent - Told each member's artifact as it is built
 * @param platforms - The stock platform packages the declaring task's runner
 *   names (`east-py-std`): the environment of a python workspace's member
 *   installs their distributions too
 * @param built - The sdists the export built already, which it adds to: each
 *   local python package is built once in an export ({@link BuiltSdists})
 * @returns The beast2-encoded EnvironmentSpec bytes
 * @throws {Error} if the project is missing its manifest/lockfile or the build fails
 */
export function captureEnvironment(
  decl: EnvironmentDecl,
  owner: string,
  addBlob: (data: Buffer) => string,
  onEvent?: CaptureEventFn,
  platforms: readonly string[] = [],
  built?: BuiltSdists,
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
    files.sort((a, b) => byCodePoint(a.path, b.path));
    spec = variant('tools', { files });
  } else if ('python' in decl) {
    const project = path.resolve(decl.python.project);
    // Identity + closure come from the governing (root) lock. A member's own
    // pyproject rides inside its sdist.
    const { root, lock, subject } = discoverPythonRoot(project, owner);
    // A member of a workspace names itself, so its environment installs its
    // own dependencies and not its workspace's (#1654)
    if (canonicalPath(root) !== canonicalPath(project)) {
      return captureWorkspacePython(root, lock, [subject], platforms, owner, addBlob, onEvent, built);
    }
    // A project that is its own root: the ROOT manifest/lockfile are its own,
    // and materialization syncs the whole of its lock. The captured spec is
    // byte-identical to the pre-#278 single-project one.
    const pyproject = addBlob(readProjectFile(root, 'pyproject.toml', owner));
    const lockBlob = addBlob(readProjectFile(root, 'uv.lock', owner));
    const sdists = buildMemberSdists(pythonClosure(lock, root, [subject], owner), owner, addBlob, onEvent, built);
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
