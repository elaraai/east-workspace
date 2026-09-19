#!/usr/bin/env node
// Adds the Windows job launcher, @elaraai/e3-job-win32-x64, to e3-core's
// package.json as an `optionalDependencies` entry pinned to the given version.
// Run by release.yml's publish-npm job and by scripts/test-release-verdaccio.sh
// immediately before e3-core is published.
//
// The committed e3-core package.json deliberately does NOT carry it, for the
// reason inject-east-c-platform-deps.mjs gives for the east-c launcher: pnpm
// install --frozen-lockfile (CI default) would reject the lockfile every time
// the canonical version moves, as the package at that version does not exist
// on the registry yet. Injecting it at publish time keeps the workspace
// lockfile clean while the *published* e3-core carries the dependency.
//
// Usage:
//   node scripts/inject-e3-job-dep.mjs \
//       --version <semver> \
//       [--file libs/e3/packages/e3-core/package.json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = '@elaraai/e3-job-win32-x64';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version') out.version = argv[++i];
    else if (a === '--file') out.file = argv[++i];
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  if (!out.version) { console.error('Missing --version'); process.exit(2); }
  if (!out.file) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    out.file = path.resolve(here, '..', 'libs/e3/packages/e3-core/package.json');
  }
  return out;
}

const { version, file } = parseArgs(process.argv.slice(2));
const raw = fs.readFileSync(file, 'utf8');
const pkg = JSON.parse(raw);
pkg.optionalDependencies = { ...(pkg.optionalDependencies ?? {}), [NAME]: version };
const trailingNewline = raw.endsWith('\n') ? '\n' : '';
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + trailingNewline);
console.log(`Injected optionalDependency ${NAME}@${version} into ${file}`);
