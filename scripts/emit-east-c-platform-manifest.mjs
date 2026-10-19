#!/usr/bin/env node
// Generates a per-platform npm `package.json` from a build artifact:
//   @elaraai/east-c-cli-<target>          just the east-c binary (--package cli, the default)
//   @elaraai/east-c-datascience-<target>  the east-c-datascience libraries (--package datascience)
// The per-platform packages are NOT committed: they only exist as build
// outputs — one binary, or one lib/ directory — plus this generated manifest,
// packed with `npm pack` and published from publish-c-npm.
//
// Usage:
//   node scripts/emit-east-c-platform-manifest.mjs \
//       --target <linux-x64|linux-arm64|darwin-arm64|darwin-x64|win32-x64> \
//       --version <semver> \
//       [--package cli|datascience] \
//       --out <path/to/package.json>

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = { package: 'cli' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target')  out.target  = argv[++i];
    else if (a === '--version') out.version = argv[++i];
    else if (a === '--out')     out.out     = argv[++i];
    else if (a === '--package') out.package = argv[++i];
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  for (const k of ['target', 'version', 'out']) {
    if (!out[k]) { console.error(`Missing --${k}`); process.exit(2); }
  }
  if (!['cli', 'datascience'].includes(out.package)) { console.error(`Unknown --package ${out.package} (cli | datascience)`); process.exit(2); }
  return out;
}

const TARGETS = {
  'linux-x64':    { os: 'linux',  cpu: 'x64'   },
  'linux-arm64':  { os: 'linux',  cpu: 'arm64' },
  'darwin-arm64': { os: 'darwin', cpu: 'arm64' },
  'darwin-x64':   { os: 'darwin', cpu: 'x64'   },
  'win32-x64':    { os: 'win32',  cpu: 'x64'   },
};

const { target, version, out, package: which } = parseArgs(process.argv.slice(2));
const spec = TARGETS[target];
if (!spec) {
  console.error(`Unknown --target ${target}. Valid: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(2);
}
if (which === 'datascience' && target !== 'linux-x64') {
  console.error(`@elaraai/east-c-datascience is published for linux-x64 only (got --target ${target})`);
  process.exit(2);
}

const manifest = which === 'cli' ? {
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
  // Per-platform packages ship ONLY the binary — no `bin` field. The `east-c`
  // bin is owned by the launcher (@elaraai/east-c-cli/bin/east-c.mjs), which
  // resolves this package and execs the binary. npm does not reliably link a
  // bin that comes from an optionalDependency, so putting it on the launcher
  // (a normal dependency) is what makes `.bin/east-c` exist after a plain
  // `npm install`. `east-c*` covers both `east-c` (POSIX) and `east-c.exe`
  // (Windows) without having to vary `files` per target.
  files: ['east-c*', 'README.md', 'LICENSE.md'],
} : {
  name: `@elaraai/east-c-datascience-${target}`,
  version,
  description: `east-c-datascience's libraries for ${target} (OR-Tools, XGBoost, the neural networks on libtorch) — installed automatically as an optionalDependency of @elaraai/east-c-datascience; the east-c launcher points the runner at them.`,
  license: 'BUSL-1.1',
  repository: {
    type: 'git',
    url: 'git+https://github.com/elaraai/east-workspace.git',
    directory: 'libs/east-c/packages/east-c-datascience',
  },
  os: [spec.os],
  cpu: [spec.cpu],
  // lib/ holds libeast-c-datascience and libeast-c-nn with every library they
  // load (scripts/stage-datascience.sh). libtorch is not in the tarball: the
  // postinstall fetches the pinned build into libtorch/ beside lib/
  // (fetch-libtorch.mjs; EAST_LIBTORCH=skip leaves it out, and
  // `east-c-datascience fetch-libtorch` does it later), and the install
  // succeeds without it — only the nn_* functions need it.
  files: ['lib', 'fetch-libtorch.mjs', 'libtorch-pins.json', 'README.md', 'LICENSE.md'],
  scripts: { postinstall: 'node fetch-libtorch.mjs --postinstall' },
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${out} for ${manifest.name}@${version}`);
