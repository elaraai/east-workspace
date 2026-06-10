#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { semverToPep440 } from './set-python-version.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const NPM_PKGS = [
  'libs/east/package.json',
  'libs/east-node/packages/east-node-std/package.json',
  'libs/east-node/packages/east-node-io/package.json',
  'libs/east-node/packages/east-node-cli/package.json',
  'libs/east-c/packages/east-c-cli/package.json',
  'libs/east-py/packages/east-py-datascience/package.json',
  'libs/e3/packages/e3-types/package.json',
  'libs/e3/packages/e3/package.json',
  'libs/e3/packages/e3-api-client/package.json',
  'libs/e3/packages/e3-core/package.json',
  'libs/e3/packages/e3-cli/package.json',
  'libs/e3/packages/e3-api-server/package.json',
  'libs/e3/packages/e3-api-tests/package.json',
  'libs/east-ui/packages/east-ui/package.json',
  'libs/east-ui/packages/east-ui-components/package.json',
  'libs/east-ui/packages/e3-ui/package.json',
  'libs/east-ui/packages/e3-ui-components/package.json',
  'libs/east-diagnostics/package.json',
  'libs/eslint-plugin-east/package.json',
  'libs/tsserver-plugin-east/package.json',
  'libs/create/packages/create-east/package.json',
  'libs/create/packages/create-e3/package.json',
];

// Plain-text VERSION files (CMake input, etc.). Same canonical version
// as everything else.
const TEXT_VERSION_FILES = [
  'libs/east-c/VERSION',  // baked into the east-c binary at CMake configure time
];

// The launcher's per-platform optionalDependencies are NOT committed (they'd
// break pnpm install --frozen-lockfile until the per-platform packages exist
// on npm). They get injected at publish time via
// scripts/inject-east-c-platform-deps.mjs, pinned to the canonical version.
// So nothing to verify here — the lack of optionalDependencies in the source
// package.json is the correct state.

const PYPROJECTS = [
  'libs/east-py/packages/east-py/pyproject.toml',
  'libs/east-py/packages/east-py-std/pyproject.toml',
  'libs/east-py/packages/east-py-io/pyproject.toml',
  'libs/east-py/packages/east-py-cli/pyproject.toml',
  'libs/east-py/packages/east-py-datascience/pyproject.toml',
];

const VSIX_PKG = 'libs/east-ui/packages/east-ui-extension/package.json';
const PLUGIN_JSON = 'libs/east-claude-plugin/.claude-plugin/plugin.json';
const MARKETPLACE_JSON = '.claude-plugin/marketplace.json';

function readJsonVersion(rel) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8')).version;
}

function readPyprojectVersion(rel) {
  const raw = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
  const m = raw.match(/\[project\][\s\S]*?\nversion\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error(`No [project].version in ${rel}`);
  return m[1];
}

const canonical = readJsonVersion('package.json');
const isPrerelease = canonical.includes('-');
const expectedPep440 = semverToPep440(canonical);

const errors = [];

for (const rel of NPM_PKGS) {
  const v = readJsonVersion(rel);
  if (v !== canonical) errors.push(`${rel}: ${v} ≠ ${canonical}`);
}

for (const rel of TEXT_VERSION_FILES) {
  const v = fs.readFileSync(path.join(repoRoot, rel), 'utf8').trim();
  if (v !== canonical) errors.push(`${rel}: ${v} ≠ ${canonical}`);
}

for (const rel of PYPROJECTS) {
  const v = readPyprojectVersion(rel);
  if (v !== expectedPep440) errors.push(`${rel}: ${v} ≠ ${expectedPep440} (PEP 440 of ${canonical})`);
}

const vsixVersion = readJsonVersion(VSIX_PKG);
if (!isPrerelease && vsixVersion !== canonical) {
  errors.push(`${VSIX_PKG}: ${vsixVersion} ≠ ${canonical} (must match on stable canonical)`);
}

const pluginVersion = readJsonVersion(PLUGIN_JSON);
if (pluginVersion !== canonical) {
  errors.push(`${PLUGIN_JSON}: ${pluginVersion} ≠ ${canonical}`);
}

const marketplace = JSON.parse(fs.readFileSync(path.join(repoRoot, MARKETPLACE_JSON), 'utf8'));
const marketEntry = marketplace.plugins?.find((p) => p.name === 'east') ?? marketplace.plugins?.[0];
if (marketEntry && marketEntry.version !== canonical) {
  errors.push(`${MARKETPLACE_JSON} (east): ${marketEntry.version} ≠ ${canonical}`);
}

if (errors.length > 0) {
  console.error(`Version drift detected against canonical /package.json = ${canonical}:`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error(`\nFix by running: make set-version VERSION=${canonical}`);
  process.exit(1);
}

console.log(`OK — all manifests aligned to ${canonical}`);
console.log(`     (PEP 440: ${expectedPep440}; VSIX: ${vsixVersion}${isPrerelease ? ' [drift allowed: pre-release]' : ''}; plugin: ${pluginVersion})`);
