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
import { decodeBeast2For } from '@elaraai/east';
import { EnvironmentSpecType, type EnvironmentSpec } from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/index.js';
import { withKeyedLock } from '../storage/local/keyedMutex.js';

const execFileAsync = promisify(execFile);

const decodeEnvironmentSpec = decodeBeast2For(EnvironmentSpecType);

/** The executable dir a materialized environment contributes to PATH. */
function environmentBinDir(envDir: string, spec: EnvironmentSpec): string {
  if (spec.type === 'python') {
    return path.join(envDir, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');
  }
  return path.join(envDir, 'node_modules', '.bin');
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
  await run('uv', ['sync', '--frozen', '--no-install-project'], buildDir,
    'locked dependency sync');
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
    await run('uv', ['pip', 'install', '--python', path.join(buildDir, '.venv'), ...files],
      buildDir, 'project sdist install');
  }
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
      if (spec.type === 'python') {
        await buildPython(storage, repo, spec, buildDir);
      } else {
        await buildNode(storage, repo, spec, buildDir);
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
