#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
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
    const updated = raw.replace(
      /(\[project\][\s\S]*?\nversion\s*=\s*")[^"]+(")/m,
      `$1${pep440}$2`,
    );
    if (updated === raw) {
      throw new Error(`Failed to find [project].version in ${rel}`);
    }
    fs.writeFileSync(p, updated);
    console.log(`${rel}: ${pep440}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
