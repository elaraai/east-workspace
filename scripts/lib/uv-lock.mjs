/**
 * uv's TOML files as the release scripts read them: a workspace's lock, and a
 * package's manifest, each read by Python's `tomllib`, as uv and
 * scripts/east-py-constraints.py read them, never split by hand. And a
 * distribution's name as PEP 503 writes it, which every name read here is
 * compared by.
 */

import { execFileSync } from 'node:child_process';

/**
 * A distribution's name as PEP 503 writes it.
 *
 * @param name - The name as a manifest or lock writes it
 * @returns It lowercased, each run of `-`, `_` and `.` one `-`
 * @example
 * canonicalName('PyTorch_Lightning'); // 'pytorch-lightning'
 */
export function canonicalName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/**
 * What a Python program writes as JSON of TOML text: the text is read with
 * `tomllib` as `read`, and the program dumps what it wants of it.
 *
 * @param text - The TOML
 * @param body - Python that writes JSON of `read` to `sys.stdout`
 * @param what - What the text is, for the message
 * @returns What the program wrote, parsed
 * @throws {Error} When the text is not TOML
 * @example
 * readToml('[project]\nname = "pkg"\n', 'json.dump(read["project"]["name"], sys.stdout)', 'manifest'); // 'pkg'
 */
export function readToml(text, body, what) {
  let read;
  try {
    read = execFileSync('python3', ['-c', `import json, sys, tomllib\nread = tomllib.loads(sys.stdin.read())\n${body}`],
      { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
  } catch (error) {
    const said = typeof error.stderr === 'string' && error.stderr.trim() !== '' ? error.stderr.trim().split('\n').at(-1) : String(error);
    throw new Error(`the ${what} is not read as TOML: ${said}`);
  }
  return JSON.parse(read);
}

/**
 * The packages a uv lock holds: each `[[package]]`'s name, version, and
 * whether it is a workspace member (an editable source).
 *
 * @param lock - The lock's text
 * @returns Each package, in the lock's order; a package held at a version per
 *   platform is there once for each
 * @throws {Error} When the lock is not TOML
 * @example
 * lockPackages('version = 1\n\n[[package]]\nname = "six"\nversion = "1.17.0"\nsource = { registry = "https://pypi.org/simple" }\n');
 * // [{ name: 'six', version: '1.17.0', editable: false }]
 */
export function lockPackages(lock) {
  return readToml(lock, [
    'json.dump([{"name": package.get("name"), "version": package.get("version"), "editable": "editable" in package.get("source", {})}',
    '           for package in read.get("package", [])], sys.stdout)',
  ].join('\n'), 'lock');
}

/**
 * The versions a uv lock holds a package at.
 *
 * @param lock - The lock's text
 * @param name - The package, compared by its name as PEP 503 writes it
 * @returns Its versions, in the lock's order: more than one when the lock
 *   holds it at a version per platform
 * @throws {Error} When the lock is not TOML
 * @example
 * lockedVersions(lock, 'PyTorch_Lightning'); // ['2.6.6']
 */
export function lockedVersions(lock, name) {
  const wanted = canonicalName(name);
  return lockPackages(lock)
    .filter((locked) => typeof locked.name === 'string' && typeof locked.version === 'string' && canonicalName(locked.name) === wanted)
    .map((locked) => locked.version);
}
