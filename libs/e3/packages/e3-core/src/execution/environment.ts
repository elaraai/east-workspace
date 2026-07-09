/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local materialization of execution environments.
 *
 * A task/function whose object carries an `environment` hash references a
 * content-addressed {@link EnvironmentSpec}: the project's manifest +
 * lockfile blobs plus the project's own built packages (sdists / tarballs).
 * Before spawning the runner, the environment is materialized into a cache
 * directory keyed by the environment hash — cold: create + install from the
 * locked closure; warm: reuse — and the environment's executable dir is
 * prepended to the child PATH so its runner entry points win.
 *
 * Cache layout: `<repo>/envs/<envHash>/` — sibling to the repo's object
 * store, one directory per distinct environment. Materialization builds in a
 * temp sibling and atomically renames into place, so a cache directory's
 * existence means it is complete; concurrent builders race benignly (the
 * loser discards its build) and in-process duplicates are deduped with a
 * keyed lock.
 */

import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { extract as tarExtract } from 'tar-stream';
import { decodeBeast2For } from '@elaraai/east';
import { EnvironmentSpecType, type EnvironmentSpec } from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/index.js';
import { withKeyedLock } from '../storage/local/keyedMutex.js';

const execFileAsync = promisify(execFile);

const decodeEnvironmentSpec = decodeBeast2For(EnvironmentSpecType);

/** The executable dir a materialized environment contributes to PATH. */
function environmentBinDir(envDir: string, spec: EnvironmentSpec): string {
  switch (spec.type) {
    case 'python':
      return path.join(envDir, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');
    case 'node':
    case 'workspace_node':
      return path.join(envDir, 'node_modules', '.bin');
    case 'tools':
      return path.join(envDir, 'bin');
    case 'image':
      // Rejected before this is reached (materializeEnvironment throws on
      // image); present only to keep the switch exhaustive.
      throw new Error('image environments have no local bin dir');
  }
}

async function run(command: string, args: string[], cwd: string, what: string): Promise<void> {
  try {
    await execFileAsync(command, args, {
      cwd,
      // npm is npm.cmd on Windows; a shell resolves both.
      shell: process.platform === 'win32',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? String(err);
    throw new Error(`environment materialization: ${what} ('${command} ${args.join(' ')}') failed:\n${stderr}`);
  }
}

async function writeBlob(storage: StorageBackend, repo: string, hash: string, dest: string): Promise<void> {
  const data = await storage.objects.read(repo, hash);
  await fs.writeFile(dest, Buffer.from(data));
}

/** The two lockfile formats node captures can carry; content-sniffed because
 *  the spec stores lock bytes, not a filename (JSON ⇒ npm, YAML ⇒ pnpm). */
function nodeLockFilename(lock: Buffer): 'package-lock.json' | 'pnpm-lock.yaml' {
  const head = lock.toString('utf-8', 0, Math.min(lock.length, 512)).trimStart();
  return head.startsWith('{') ? 'package-lock.json' : 'pnpm-lock.yaml';
}

async function buildPython(
  storage: StorageBackend, repo: string,
  spec: Extract<EnvironmentSpec, { type: 'python' }>, buildDir: string,
): Promise<void> {
  await writeBlob(storage, repo, spec.value.pyproject, path.join(buildDir, 'pyproject.toml'));
  await writeBlob(storage, repo, spec.value.lock, path.join(buildDir, 'uv.lock'));
  // Relocatable: the venv is built in a temp sibling and atomically renamed
  // into the cache path — absolute shebangs would break on rename.
  await run('uv', ['venv', '--relocatable', '.venv'], buildDir, 'virtualenv creation');
  // Install the whole locked third-party closure but no first-party code:
  // `--no-install-workspace` skips every workspace member and the root,
  // `--no-install-local` skips any local/path source (a sibling member's
  // dir need not even exist on this machine). The project's own code comes
  // from the captured sdists below. Superset of the old
  // `--no-install-project` for a single-project env (verified equivalent).
  await run('uv', ['sync', '--frozen', '--all-packages', '--no-install-workspace', '--no-install-local'],
    buildDir, 'locked dependency sync');
  if (spec.value.sdists.length > 0) {
    const sdistDir = path.join(buildDir, '.sdists');
    await fs.mkdir(sdistDir);
    const files: string[] = [];
    for (const sdist of spec.value.sdists) {
      // Installers derive the package name from `name-version.tar.gz`;
      // basename() guards against path segments in wire data.
      const f = path.join(sdistDir, path.basename(sdist.filename));
      await writeBlob(storage, repo, sdist.hash, f);
      files.push(f);
    }
    // `--no-deps`: the sdist install must NOT resolve anything from a
    // registry — every dependency is already pinned and installed by the
    // sync above (or is another captured sdist). Without it, a missing
    // first-party dep would be silently satisfied by a same-named PyPI
    // package (a stale-code hazard). `uv pip check` then verifies the
    // environment is internally consistent and fails loudly otherwise, so
    // an incomplete capture is a materialization error, never a silent
    // wrong-code env.
    await run('uv', ['pip', 'install', '--python', path.join(buildDir, '.venv'), '--no-deps', ...files],
      buildDir, 'project sdist install');
  }
  await run('uv', ['pip', 'check', '--python', path.join(buildDir, '.venv')], buildDir,
    'environment consistency check');
}

async function buildNode(
  storage: StorageBackend, repo: string,
  spec: Extract<EnvironmentSpec, { type: 'node' }>, buildDir: string,
): Promise<void> {
  await writeBlob(storage, repo, spec.value.packageJson, path.join(buildDir, 'package.json'));
  const lockData = Buffer.from(await storage.objects.read(repo, spec.value.lock));
  const lockName = nodeLockFilename(lockData);
  await fs.writeFile(path.join(buildDir, lockName), lockData);
  if (lockName === 'pnpm-lock.yaml') {
    await run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], buildDir,
      'locked dependency install');
  } else {
    await run('npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts'], buildDir,
      'locked dependency install');
  }
  if (spec.value.tarballs.length > 0) {
    const packDir = path.join(buildDir, '.tarballs');
    await fs.mkdir(packDir);
    const files: string[] = [];
    for (let i = 0; i < spec.value.tarballs.length; i++) {
      const f = path.join(packDir, `pack-${i}.tgz`);
      await writeBlob(storage, repo, spec.value.tarballs[i]!, f);
      files.push(f);
    }
    await run('npm', ['install', '--no-save', '--no-audit', '--no-fund', ...files], buildDir,
      'project tarball install');
  }
}

/**
 * Resolve a `tools` spec's env-relative file path to an absolute path inside
 * `buildDir`, rejecting anything that could escape it.
 *
 * The `path` field is wire data (it rides in an imported bundle), so it is
 * validated defensively: it must be relative, use no `.`/`..`/empty
 * segments, and — after resolution — still live under `buildDir`. Backslash
 * separators are treated as separators too, so a Windows-style path in a
 * spec can't smuggle a segment past the POSIX split.
 *
 * @throws {Error} if the path is absolute, empty, or escapes the build dir
 */
function resolveToolsPath(buildDir: string, relPath: string): string {
  if (relPath.length === 0) {
    throw new Error('tools file has an empty path');
  }
  if (path.isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) {
    throw new Error(`tools file path must be relative, got '${relPath}'`);
  }
  const segments = relPath.split(/[/\\]/);
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new Error(`tools file path '${relPath}' has an invalid segment '${seg}'`);
    }
  }
  const dest = path.resolve(buildDir, ...segments);
  const root = path.resolve(buildDir);
  if (dest !== root && !dest.startsWith(root + path.sep)) {
    throw new Error(`tools file path '${relPath}' escapes the environment directory`);
  }
  return dest;
}

async function buildTools(
  storage: StorageBackend, repo: string,
  spec: Extract<EnvironmentSpec, { type: 'tools' }>, buildDir: string,
): Promise<void> {
  for (const file of spec.value.files) {
    const dest = resolveToolsPath(buildDir, file.path);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await writeBlob(storage, repo, file.hash, dest);
    // Uniform executable mode: the spec stores no mode (an exec-bit-only
    // change must not alter the env hash), so every captured file is made
    // runnable. No-op on Windows, which has no POSIX exec bit.
    if (process.platform !== 'win32') {
      await fs.chmod(dest, 0o755);
    }
  }
}

/** Rejects a member path from a workspace_node spec that could escape the
 *  build dir (wire data). Returns the absolute member dir under buildDir. */
function resolveMemberDir(buildDir: string, memberPath: string): string {
  const segments = memberPath.split(/[/\\]/);
  if (segments.length === 0 || path.isAbsolute(memberPath) || /^[a-zA-Z]:/.test(memberPath)) {
    throw new Error(`workspace member path must be relative, got '${memberPath}'`);
  }
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new Error(`workspace member path '${memberPath}' has an invalid segment '${seg}'`);
    }
  }
  const dest = path.resolve(buildDir, ...segments);
  const root = path.resolve(buildDir);
  if (!dest.startsWith(root + path.sep)) {
    throw new Error(`workspace member path '${memberPath}' escapes the environment directory`);
  }
  return dest;
}

/**
 * Extracts an `npm pack` tarball (gzipped tar) into `destDir`, stripping the
 * leading `package/` directory every npm tarball carries.
 *
 * Entries are validated defensively (they ride in an imported bundle):
 * path traversal is rejected, and symlink/hardlink/other special entries are
 * refused (a workspace member must be plain files). File modes are floored
 * so an extracted file is at least readable/executable as npm would leave it.
 *
 * @throws {Error} on a traversal path, a link entry, or a malformed archive
 */
async function extractMemberTarball(tarball: Buffer, destDir: string): Promise<void> {
  const tarBytes = gunzipSync(tarball);
  await new Promise<void>((resolve, reject) => {
    const ex = tarExtract();
    ex.on('entry', (header, stream, next) => {
      void (async () => {
        try {
          if (header.type !== 'file' && header.type !== 'directory') {
            throw new Error(`unsupported tar entry type '${header.type ?? 'unknown'}' in workspace member tarball`);
          }
          // Strip the leading `package/` segment npm pack adds.
          const rel = header.name.replace(/^[^/]+\//, '');
          if (rel === '') { stream.resume(); return next(); }
          const segments = rel.split('/');
          if (segments.some((s) => s === '..' || s === '')) {
            throw new Error(`illegal path '${header.name}' in workspace member tarball`);
          }
          const dest = path.resolve(destDir, ...segments);
          if (!dest.startsWith(path.resolve(destDir) + path.sep)) {
            throw new Error(`path '${header.name}' escapes the member directory`);
          }
          if (header.type === 'directory') {
            await fs.mkdir(dest, { recursive: true });
            stream.resume();
            return next();
          }
          await fs.mkdir(path.dirname(dest), { recursive: true });
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            const mode = ((header.mode ?? 0) & 0o777) | 0o644;
            fs.writeFile(dest, Buffer.concat(chunks), { mode }).then(() => next(), reject);
          });
          stream.on('error', reject);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    });
    ex.on('error', reject);
    ex.on('finish', resolve);
    Readable.from(tarBytes).pipe(ex);
  });
}

/**
 * On Windows, `npm ci` materializes workspace members as directory
 * *junctions* holding an **absolute** target under `buildDir`. After the
 * atomic rename of `buildDir` → `envDir` those junctions dangle. This
 * re-points every symlink/junction under `buildDir` whose target lies inside
 * `buildDir` to the equivalent path under the final `envDir`. No-op on POSIX
 * (npm uses relative symlinks there, which survive the rename).
 */
async function retargetWindowsJunctions(buildDir: string, envDir: string): Promise<void> {
  if (process.platform !== 'win32') return;
  const buildRoot = path.resolve(buildDir);
  const walk = async (dir: string): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let target: string;
        try { target = await fs.readlink(full); } catch { continue; }
        if (path.isAbsolute(target) && target.startsWith(buildRoot + path.sep)) {
          const rebased = path.join(envDir, path.relative(buildRoot, target));
          await fs.rm(full, { recursive: true, force: true });
          await fs.symlink(rebased, full, 'junction');
        }
      } else if (entry.isDirectory()) {
        await walk(full);
      }
    }
  };
  await walk(buildDir);
}

async function buildWorkspaceNode(
  storage: StorageBackend, repo: string,
  spec: Extract<EnvironmentSpec, { type: 'workspace_node' }>, buildDir: string, envDir: string,
): Promise<void> {
  // v1 supports npm workspaces only; pnpm capture ships later.
  const lockData = Buffer.from(await storage.objects.read(repo, spec.value.lock));
  if (nodeLockFilename(lockData) !== 'package-lock.json') {
    throw new Error('workspace_node: only npm workspaces are supported by the local runner yet');
  }

  // Root package.json with `workspaces` pinned to exactly the closure members
  // (explicit paths, no globs) so npm ci links only them — non-closure
  // members and their third-party deps are pruned.
  const rootPkg = JSON.parse(Buffer.from(await storage.objects.read(repo, spec.value.packageJson)).toString('utf-8'));
  rootPkg.workspaces = spec.value.members.map((m) => m.path);
  await fs.writeFile(path.join(buildDir, 'package.json'), JSON.stringify(rootPkg, null, 2));
  await fs.writeFile(path.join(buildDir, 'package-lock.json'), lockData);

  // Materialize each member's packed code at its workspace path.
  for (const member of spec.value.members) {
    const memberDir = resolveMemberDir(buildDir, member.path);
    await fs.mkdir(memberDir, { recursive: true });
    await extractMemberTarball(Buffer.from(await storage.objects.read(repo, member.tarball)), memberDir);
    const memberPkg = JSON.parse(await fs.readFile(path.join(memberDir, 'package.json'), 'utf-8'));
    if (memberPkg.name !== member.name) {
      throw new Error(`workspace member at '${member.path}' is '${memberPkg.name}', expected '${member.name}'`);
    }
  }

  // Frozen install against the verbatim root lock. --ignore-scripts: member
  // code arrives by extraction, already built (prepack ran at capture).
  await run('npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts'], buildDir,
    'workspace install');

  await retargetWindowsJunctions(buildDir, envDir);

  // Sanity: every member is present and resolvable — guards the silent
  // "npm ci said up-to-date but installed nothing" class of failure.
  for (const member of spec.value.members) {
    const pkgJson = path.join(buildDir, ...member.path.split('/'), 'package.json');
    const linked = path.join(buildDir, 'node_modules', ...member.name.split('/'));
    if (!await pathExists(pkgJson) || !await pathExists(linked)) {
      throw new Error(`materialized workspace is incomplete: member '${member.name}' missing after install`);
    }
  }
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

/**
 * Materializes an environment into the repo-local cache and returns the
 * executable dirs to prepend to the runner's PATH.
 *
 * Warm environments (cache dir present) return immediately. Cold
 * environments build in a temp sibling directory and atomically rename into
 * place; when two processes race, the loser keeps the winner's build.
 *
 * @param storage - Storage backend holding the spec + blobs
 * @param repo - Repository path (the cache lives at `<repo>/envs/<hash>`)
 * @param envHash - Object hash of the beast2-encoded {@link EnvironmentSpec}
 * @returns PATH entries for the materialized environment
 * @throws {Error} for `image` environments (cloud-only) and failed builds
 */
export async function materializeEnvironment(
  storage: StorageBackend,
  repo: string,
  envHash: string,
): Promise<string[]> {
  const specData = await storage.objects.read(repo, envHash);
  const spec = decodeEnvironmentSpec(Buffer.from(specData));

  if (spec.type === 'image') {
    throw new Error(
      `environment ${envHash.slice(0, 12)} is a container image (${spec.value.digest}) — ` +
      `image environments are not supported by the local runner; deploy to a cloud workspace ` +
      `or use a python/node environment locally`,
    );
  }

  const envDir = path.join(repo, 'envs', envHash);
  const binDir = environmentBinDir(envDir, spec);

  // Warm path: an existing cache dir is complete by construction.
  try {
    await fs.access(envDir);
    return [binDir];
  } catch {
    // cold — build below
  }

  await withKeyedLock(`env:${envHash}`, async () => {
    // Re-check under the in-process lock.
    try {
      await fs.access(envDir);
      return;
    } catch {
      // still cold
    }

    const buildDir = `${envDir}.building-${process.pid}`;
    await fs.rm(buildDir, { recursive: true, force: true });
    await fs.mkdir(buildDir, { recursive: true });
    try {
      switch (spec.type) {
        case 'python':
          await buildPython(storage, repo, spec, buildDir);
          break;
        case 'node':
          await buildNode(storage, repo, spec, buildDir);
          break;
        case 'tools':
          await buildTools(storage, repo, spec, buildDir);
          break;
        case 'workspace_node':
          await buildWorkspaceNode(storage, repo, spec, buildDir, envDir);
          break;
      }
      try {
        await fs.rename(buildDir, envDir);
      } catch {
        // Another process won the race — its build is complete; drop ours.
        await fs.rm(buildDir, { recursive: true, force: true });
        await fs.access(envDir);
      }
    } catch (err) {
      await fs.rm(buildDir, { recursive: true, force: true });
      throw err;
    }
  });

  return [binDir];
}
