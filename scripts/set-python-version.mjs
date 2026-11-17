#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

export function semverToPep440(semver) {
  const m = semver.match(/^(\d+\.\d+\.\d+)(?:-(alpha|beta|rc)\.(\d+))?$/);
  if (!m) throw new Error(`Unsupported semver for PEP 440 translation: ${semver}`);
  const [, base, kind, n] = m;
  if (!kind) return base;
  const tag = { alpha: 'a', beta: 'b', rc: 'rc' }[kind];
  return `${base}${tag}${n}`;
}

/** Where the pins a release's python packages are installed under are kept:
 *  a directory of @elaraai/e3-core, which ships it. */
export const EAST_PY_PINS_DIR = 'libs/e3/packages/e3-core/tier';

/** The pin files, each of which names the release it is of in its first line. */
export const EAST_PY_PINS = ['east-py-constraints.txt', 'east-py-overrides.txt'];

export const PYPROJECTS = [
  'libs/east-py/packages/east-py/pyproject.toml',
  'libs/east-py/packages/east-py-std/pyproject.toml',
  'libs/east-py/packages/east-py-io/pyproject.toml',
  'libs/east-py/packages/east-py-cli/pyproject.toml',
  'libs/east-py/packages/east-py-datascience/pyproject.toml',
];

function main() {
  const NEW_VERSION = process.argv[2];
  if (!NEW_VERSION) {
    console.error('Usage: set-python-version.mjs <semver>');
    console.error('Translates semver to PEP 440 and writes all east-py pyproject.toml files.');
    process.exit(1);
  }
  const pep440 = semverToPep440(NEW_VERSION);
  for (const rel of PYPROJECTS) {
    const p = path.join(repoRoot, rel);
    const raw = fs.readFileSync(p, 'utf8');
    const pattern = /(\[project\][\s\S]*?\nversion\s*=\s*")[^"]+(")/m;
    if (!pattern.test(raw)) {
      throw new Error(`Failed to find [project].version in ${rel}`);
    }
    const updated = raw.replace(pattern, `$1${pep440}$2`);
    fs.writeFileSync(p, updated);
    console.log(`${rel}: ${pep440}`);
  }

  // Regenerate the uv workspace lock so the editable members' own versions
  // follow the pyproject bump. Without this the lock lags and every `uv sync`
  // silently rewrites it; check-version-drift.mjs enforces the alignment.
  const eastPyDir = path.join(repoRoot, 'libs/east-py');
  console.log('libs/east-py/uv.lock: re-locking …');
  execFileSync('uv', ['lock'], { cwd: eastPyDir, stdio: 'inherit' });

  // The pins the release's python packages are installed under are that
  // lock, exported, and name their release: written again of the lock just
  // made, for the version it is of. @elaraai/e3-core ships them, and a
  // release's python images install under the copy its published package
  // holds; check-version-drift.mjs holds them to the release.
  console.log(`${EAST_PY_PINS_DIR}: writing the release's pins …`);
  execFileSync('python3', [path.join(repoRoot, 'scripts/east-py-constraints.py'), eastPyDir, path.join(repoRoot, EAST_PY_PINS_DIR), '--release', pep440],
    { stdio: 'inherit' });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
