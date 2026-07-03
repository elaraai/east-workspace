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
import { variant, encodeBeast2For } from '@elaraai/east';
import type { EnvironmentSpec } from '@elaraai/e3-types';
import { EnvironmentSpecType } from '@elaraai/e3-types';
import { validateEnvironmentDecl, type EnvironmentDecl } from './environment.js';

const encodeEnvironmentSpec = encodeBeast2For(EnvironmentSpecType);

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
    const pyproject = addBlob(readProjectFile(project, 'pyproject.toml', owner));
    const lock = addBlob(readProjectFile(project, 'uv.lock', owner));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-env-sdist-'));
    try {
      // Installers derive the package name from the sdist filename — keep it.
      const sdists = buildArtifacts(
        'uv', ['build', '--sdist', '--out-dir', outDir], project, outDir, '.tar.gz', owner,
      ).map((a) => ({ filename: a.filename, hash: addBlob(a.data) }));
      spec = variant('python', { pyproject, lock, sdists });
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
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
