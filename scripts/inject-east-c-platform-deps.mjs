#!/usr/bin/env node
// Adds the 5 per-platform packages as `optionalDependencies` to the launcher
// package.json, pinned to the given version. Run by release.yml's
// publish-c-npm step and by scripts/bootstrap-east-c-npm.mjs immediately
// before `pnpm publish`.
//
// The committed launcher package.json deliberately does NOT carry these
// optionalDependencies, because pnpm install --frozen-lockfile (CI default)
// would reject the lockfile every time the canonical version moves and the
// per-platform packages don't yet exist on the registry. Injecting them at
// publish time keeps the workspace lockfile clean while the *published*
// tarball still contains the deps end-users need.
//
// Usage:
//   node scripts/inject-east-c-platform-deps.mjs \
//       --version <semver> \
//       --file libs/east-c/packages/east-c-cli/package.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGETS = ['linux-x64', 'linux-arm64', 'darwin-arm64', 'darwin-x64', 'win32-x64'];

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
    out.file = path.resolve(here, '..', 'libs/east-c/packages/east-c-cli/package.json');
  }
  return out;
}

const { version, file } = parseArgs(process.argv.slice(2));
const raw = fs.readFileSync(file, 'utf8');
const pkg = JSON.parse(raw);
pkg.optionalDependencies = pkg.optionalDependencies ?? {};
for (const t of TARGETS) {
  pkg.optionalDependencies[`@elaraai/east-c-cli-${t}`] = version;
}
const trailingNewline = raw.endsWith('\n') ? '\n' : '';
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + trailingNewline);
console.log(`Injected ${TARGETS.length} optionalDependencies @${version} into ${file}`);
