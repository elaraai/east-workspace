#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const NEW_VERSION = process.argv[2];
if (!NEW_VERSION) {
  console.error('Usage: set-vsix-version.mjs <semver>');
  console.error('  Stable semver  → set extension version to that exact value');
  console.error('  Pre-release    → patch-bump the extension on its own track (marketplace constraint)');
  process.exit(1);
}

const VSIX_PKG = 'libs/east-ui/packages/east-ui-extension/package.json';

const p = path.join(repoRoot, VSIX_PKG);
const raw = fs.readFileSync(p, 'utf8');
const pkg = JSON.parse(raw);
const old = pkg.version;

const isPrerelease = NEW_VERSION.includes('-');

if (isPrerelease) {
  const m = old.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Extension version is not plain semver: ${old}`);
  const [, major, minor, patch] = m;
  pkg.version = `${major}.${minor}.${Number(patch) + 1}`;
} else {
  pkg.version = NEW_VERSION;
}

const trailingNewline = raw.endsWith('\n') ? '\n' : '';
const indent = raw.startsWith('{\n    ') ? 4 : 2;
fs.writeFileSync(p, JSON.stringify(pkg, null, indent) + trailingNewline);

console.log(
  `${pkg.name}: ${old} → ${pkg.version}` +
  (isPrerelease ? `  (npm ${NEW_VERSION} is pre-release; patch-bumped on own track)` : ''),
);
