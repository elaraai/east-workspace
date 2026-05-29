#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const NEW_VERSION = process.argv[2];
if (!NEW_VERSION) {
  console.error('Usage: set-npm-version.mjs <semver>');
  console.error('  Writes <semver> to every publishable @elaraai/* package.json file.');
  console.error('  Does NOT touch pyproject.toml or the VSCode extension — see:');
  console.error('    scripts/set-python-version.mjs');
  console.error('    scripts/set-vsix-version.mjs');
  process.exit(1);
}

// Plain-text files that hold a single semver line (no JSON / no key-value).
// Read by CMake / other non-npm tooling.
const TEXT_VERSION_FILES = [
  'libs/east-c/VERSION',  // CMake reads this to bake EAST_CLI_VERSION / EAST_RUNTIME_VERSION into the east-c binary
];

const PKGS = [
  'package.json',
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
  'libs/create/packages/create-east/package.json',
  'libs/create/packages/create-e3/package.json',
];

for (const rel of PKGS) {
  const p = path.join(repoRoot, rel);
  const raw = fs.readFileSync(p, 'utf8');
  const pkg = JSON.parse(raw);
  const old = pkg.version;
  pkg.version = NEW_VERSION;
  const trailingNewline = raw.endsWith('\n') ? '\n' : '';
  const indent = raw.startsWith('{\n    ') ? 4 : 2;
  fs.writeFileSync(p, JSON.stringify(pkg, null, indent) + trailingNewline);
  console.log(`${pkg.name}: ${old} → ${NEW_VERSION}`);
}

// Plain-text VERSION files (CMake input, etc.). Preserve trailing newline.
for (const rel of TEXT_VERSION_FILES) {
  const p = path.join(repoRoot, rel);
  const raw = fs.readFileSync(p, 'utf8');
  const old = raw.trim();
  const trailingNewline = raw.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(p, NEW_VERSION + trailingNewline);
  console.log(`${rel}: ${old} → ${NEW_VERSION}`);
}
