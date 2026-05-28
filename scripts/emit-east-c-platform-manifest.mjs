#!/usr/bin/env node
// Generates a per-platform npm `package.json` for @elaraai/east-c-cli-<target>
// from a single build artifact (just the binary). The per-platform packages
// are NOT committed: they only exist as build outputs, one binary plus this
// generated manifest, packed with `npm pack` and published from publish-c-npm.
//
// Usage:
//   node scripts/emit-east-c-platform-manifest.mjs \
//       --target <linux-x64|linux-arm64|darwin-arm64|darwin-x64|win32-x64> \
//       --version <semver> \
//       --out <path/to/package.json>

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target')  out.target  = argv[++i];
    else if (a === '--version') out.version = argv[++i];
    else if (a === '--out')     out.out     = argv[++i];
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  for (const k of ['target', 'version', 'out']) {
    if (!out[k]) { console.error(`Missing --${k}`); process.exit(2); }
  }
  return out;
}

const TARGETS = {
  'linux-x64':    { os: 'linux',  cpu: 'x64'   },
  'linux-arm64':  { os: 'linux',  cpu: 'arm64' },
  'darwin-arm64': { os: 'darwin', cpu: 'arm64' },
  'darwin-x64':   { os: 'darwin', cpu: 'x64'   },
  'win32-x64':    { os: 'win32',  cpu: 'x64'   },
};

const { target, version, out } = parseArgs(process.argv.slice(2));
const spec = TARGETS[target];
if (!spec) {
  console.error(`Unknown --target ${target}. Valid: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(2);
}

const manifest = {
  name: `@elaraai/east-c-cli-${target}`,
  version,
  description: `east-c native binary for ${target} — installed automatically as an optionalDependency of @elaraai/east-c-cli.`,
  license: 'BUSL-1.1',
  repository: {
    type: 'git',
    url: 'git+https://github.com/elaraai/east-workspace.git',
    directory: 'libs/east-c/packages/east-c-cli',
  },
  os: [spec.os],
  cpu: [spec.cpu],
  // `east-c*` covers both `east-c` (POSIX) and `east-c.exe` (Windows) without
  // having to vary `files` per target.
  files: ['east-c*', 'README.md', 'LICENSE.md'],
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${out} for ${manifest.name}@${version}`);
