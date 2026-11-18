/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What the environment specs share: python projects and a uv workspace,
 * captured as an export captures them.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BlobType, encodeBeast2For } from '@elaraai/east';

/** An environment's file, as export stores it: a beast2 Blob of its bytes. */
export const encodeFile = encodeBeast2For(BlobType);

/** A captured file of an environment: its original name and its object's hash. */
export interface CapturedSdist { filename: string; hash: string }

/**
 * Writes a python project that hatchling builds: its manifest, which names
 * what it depends on, and a package of its name whose `MARKER` is `marker`.
 *
 * @param dir - The project's directory
 * @param name - Its name, and its package's
 * @param dependencies - What it depends on
 * @param marker - Its package's `MARKER`
 * @param more - More of its manifest, written before its build system
 */
export function pythonProject(dir: string, name: string, dependencies: readonly string[], marker: string, more = ''): void {
  fs.mkdirSync(path.join(dir, 'src', name), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pyproject.toml'),
    `[project]\nname = "${name}"\nversion = "0.1.0"\nrequires-python = ">=3.11"\n` +
    `dependencies = [${dependencies.map((d) => `"${d}"`).join(', ')}]\n` + more +
    '\n[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n');
  fs.writeFileSync(path.join(dir, 'src', name, '__init__.py'), `MARKER = "${marker}"\n`);
}

/**
 * Builds a project's sdist and stores it as an environment's file, as a
 * capture does.
 *
 * @param project - The project's directory
 * @param out - Where its sdist is built: a directory of its own
 * @param write - Stores a file's bytes, answering its object's hash
 * @returns The sdist's file name and its object's hash
 */
export async function storedSdist(project: string, out: string, write: (bytes: Uint8Array) => Promise<string>): Promise<CapturedSdist> {
  execFileSync('uv', ['build', '--sdist', '--out-dir', out], { cwd: project, stdio: 'ignore' });
  const filename = fs.readdirSync(out).find((f) => f.endsWith('.tar.gz'))!;
  return { filename, hash: await write(fs.readFileSync(path.join(out, filename))) };
}

/** The script {@link writeWheel} runs: its arguments are the index, the
 *  distribution's name, its version, its tags and what it requires. */
const WHEEL_SCRIPT = [
  'import base64, hashlib, sys, zipfile',
  'out, name, version, tag, *requires = sys.argv[1:]',
  'dist = f"{name}-{version}.dist-info"',
  'metadata = f"Metadata-Version: 2.1\\nName: {name}\\nVersion: {version}\\n" + "".join(f"Requires-Dist: {r}\\n" for r in requires)',
  'files = {',
  '    f"{name}/__init__.py": f"PLATFORM = {tag.split(chr(45))[2]!r}\\n".encode(),',
  '    f"{dist}/METADATA": metadata.encode(),',
  '    f"{dist}/WHEEL": f"Wheel-Version: 1.0\\nGenerator: e3-test\\nRoot-Is-Purelib: false\\nTag: {tag}\\n".encode(),',
  '}',
  'record = [f"{path},sha256={base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b\'=\').decode()},{len(data)}" for path, data in files.items()]',
  'files[f"{dist}/RECORD"] = ("\\n".join(record + [f"{dist}/RECORD,,"]) + "\\n").encode()',
  'with zipfile.ZipFile(f"{out}/{name}-{version}-{tag}.whl", "w") as archive:',
  '    for path, data in files.items():',
  '        archive.writestr(zipfile.ZipInfo(path, (2020, 1, 1, 0, 0, 0)), data)',
  '',
].join('\n');

/**
 * Writes a wheel of one module into a flat index. A wheel is a zip: its
 * metadata names what it requires, and its module's `PLATFORM` the platform
 * tag it was made for, so what was installed says which was chosen.
 *
 * @param index - The index's directory
 * @param name - The distribution's name, which is its module's
 * @param version - Its version
 * @param tag - Its tags, as `py3-none-any`
 * @param requires - What it requires, each as its metadata writes it
 */
export function writeWheel(index: string, name: string, version: string, tag: string, requires: readonly string[] = []): void {
  execFileSync('uv', ['run', '--no-project', 'python', '-c', WHEEL_SCRIPT, index, name, version, tag, ...requires], { stdio: 'ignore' });
}

/**
 * A uv workspace of two members, locked, with its root's manifest and lock and
 * each member's sdist stored as an environment's files (#1654).
 *
 * @remarks
 * Its root lists `six`, which `trainer` alone uses, and `tomli` and
 * `markdown-it-py[linkify]`, which stand for stock platform packages a
 * workspace lists on its root alone, one of them with an extra; `features`
 * depends on `idna`, and `trainer` on `six` and on `features`. `features`
 * has a development group, `iniconfig`, as a member's tests have. `trainer`
 * also depends on `jaraco.classes` and `jaraco.functools`, two distributions
 * that share a namespace package, `jaraco`, which has no `__init__` module.
 *
 * @param dir - Where the workspace is made: an empty directory
 * @param write - Stores a file's bytes, answering its object's hash
 * @returns The hashes of the root's manifest and lock, and the two sdists
 */
export async function memberWorkspace(dir: string, write: (bytes: Uint8Array) => Promise<string>):
Promise<{ pyproject: string; lock: string; features: CapturedSdist; trainer: CapturedSdist }> {
  fs.writeFileSync(path.join(dir, 'pyproject.toml'),
    '[project]\nname = "ws-root"\nversion = "0.1.0"\nrequires-python = ">=3.11"\n' +
    'dependencies = ["six", "tomli", "markdown-it-py[linkify]", "features", "trainer"]\n\n' +
    '[tool.uv.workspace]\nmembers = ["packages/*"]\n\n' +
    '[tool.uv.sources]\nfeatures = { workspace = true }\ntrainer = { workspace = true }\n');
  const member = (name: string, dependencies: string[]): void => pythonProject(path.join(dir, 'packages', name), name, dependencies, name,
    dependencies.includes('features') ? '\n[tool.uv.sources]\nfeatures = { workspace = true }\n' : '\n[dependency-groups]\ndev = ["iniconfig"]\n');
  member('features', ['idna']);
  member('trainer', ['six', 'features', 'jaraco.classes', 'jaraco.functools']);
  execFileSync('uv', ['lock'], { cwd: dir, stdio: 'ignore' });
  const sdistOf = (name: string): Promise<CapturedSdist> => storedSdist(path.join(dir, 'packages', name), path.join(dir, 'dist', name), write);
  return {
    pyproject: await write(fs.readFileSync(path.join(dir, 'pyproject.toml'))),
    lock: await write(fs.readFileSync(path.join(dir, 'uv.lock'))),
    features: await sdistOf('features'),
    trainer: await sdistOf('trainer'),
  };
}
