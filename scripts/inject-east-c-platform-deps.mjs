#!/usr/bin/env node
// Adds the per-platform packages as `optionalDependencies` to a meta package's
// package.json, pinned to the given version: the 5 @elaraai/east-c-cli-<target>
// packages to the launcher, or the linux-x64 @elaraai/east-c-datascience-<target>
// package to @elaraai/east-c-datascience (--package datascience). Run by
// release.yml's publish-c-npm step and by scripts/bootstrap-east-c-npm.mjs
// immediately before `pnpm publish`.
//
// The committed package.json files deliberately do NOT carry these
// optionalDependencies, because pnpm install --frozen-lockfile (CI default)
// would reject the lockfile every time the canonical version moves and the
// per-platform packages don't yet exist on the registry. Injecting them at
// publish time keeps the workspace lockfile clean while the *published*
// tarball still contains the deps end-users need.
//
// Usage:
//   node scripts/inject-east-c-platform-deps.mjs \
//       --version <semver> \
//       [--package cli|datascience] \
//       [--file libs/east-c/packages/east-c-cli/package.json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGES = {
  cli: {
    targets: ['linux-x64', 'linux-arm64', 'darwin-arm64', 'darwin-x64', 'win32-x64'],
    name: (t) => `@elaraai/east-c-cli-${t}`,
    file: 'libs/east-c/packages/east-c-cli/package.json',
  },
  datascience: {
    targets: ['linux-x64'],
    name: (t) => `@elaraai/east-c-datascience-${t}`,
    file: 'libs/east-c/packages/east-c-datascience/package.json',
  },
};

function parseArgs(argv) {
  const out = { package: 'cli' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version') out.version = argv[++i];
    else if (a === '--file') out.file = argv[++i];
    else if (a === '--package') out.package = argv[++i];
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  if (!out.version) { console.error('Missing --version'); process.exit(2); }
  if (!PACKAGES[out.package]) { console.error(`Unknown --package ${out.package} (cli | datascience)`); process.exit(2); }
  if (!out.file) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    out.file = path.resolve(here, '..', PACKAGES[out.package].file);
  }
  return out;
}

const { version, file, package: which } = parseArgs(process.argv.slice(2));
const spec = PACKAGES[which];
const raw = fs.readFileSync(file, 'utf8');
const pkg = JSON.parse(raw);
pkg.optionalDependencies = pkg.optionalDependencies ?? {};
for (const t of spec.targets) {
  pkg.optionalDependencies[spec.name(t)] = version;
}
const trailingNewline = raw.endsWith('\n') ? '\n' : '';
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + trailingNewline);
console.log(`Injected ${spec.targets.length} optionalDependencies @${version} into ${file}`);
