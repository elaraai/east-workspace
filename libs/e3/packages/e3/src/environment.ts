/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Execution environment declarations for tasks and functions.
 *
 * An environment declaration names the project whose dependency closure a
 * task/function needs at execution time — a Python (uv) project directory, a
 * Node project directory, or a pinned container image. Declarations are
 * validated at definition time and resolved to a content-addressed
 * {@link EnvironmentSpec} at package export time: the project's manifest +
 * lockfile are captured as blobs and the project's own package is built
 * (`uv build --sdist` / `npm pack`) so the implementation code itself rides
 * the object store to wherever the task runs.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { variant, encodeBeast2For } from '@elaraai/east';
import type { EnvironmentSpec } from '@elaraai/e3-types';
import { EnvironmentSpecType } from '@elaraai/e3-types';

/**
 * An execution environment declaration on `e3.task` / `e3.function`.
 *
 * - `python`: `project` is a directory containing `pyproject.toml` and
 *   `uv.lock`. At export the manifest + lockfile are captured and
 *   `uv build --sdist` packages the project itself.
 * - `node`: `project` is a directory containing `package.json` and a
 *   lockfile. At export the manifest + lockfile are captured and `npm pack`
 *   packages the project itself.
 * - `image`: a full immutable digest reference (`repo@sha256:<64 hex>`);
 *   validated at definition time — mutable tags are rejected.
 *
 * Relative `project` paths resolve against the exporting process's working
 * directory.
 */
export type EnvironmentDecl =
  | { python: { project: string } }
  | { node: { project: string } }
  | { image: { digest: string } };

const IMAGE_DIGEST_RE = /@sha256:[0-9a-f]{64}$/;

/**
 * Validates an environment declaration at definition time.
 *
 * Cheap, filesystem-free checks only — everything that needs the project on
 * disk happens at export time in {@link captureEnvironment}.
 *
 * @param decl - The declaration to validate
 * @param owner - The declaring task/function name, for error messages
 * @throws {Error} if an `image` reference is not a full sha256 digest
 */
export function validateEnvironmentDecl(decl: EnvironmentDecl, owner: string): void {
  if ('image' in decl) {
    if (!IMAGE_DIGEST_RE.test(decl.image.digest)) {
      throw new Error(
        `Environment for '${owner}': image reference must be a full digest ` +
        `('repo@sha256:<64 hex chars>'), got '${decl.image.digest}' — tags are mutable and ` +
        `would let the environment drift under a fixed hash`,
      );
    }
  }
}

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
): Buffer[] {
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
  return files.map((f) => fs.readFileSync(path.join(outDir, f)));
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
      const sdists = buildArtifacts(
        'uv', ['build', '--sdist', '--out-dir', outDir], project, outDir, '.tar.gz', owner,
      ).map(addBlob);
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
      ).map(addBlob);
      spec = variant('node', { packageJson, lock, tarballs });
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }

  return encodeEnvironmentSpec(spec);
}
