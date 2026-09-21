#!/usr/bin/env node
// Stages @elaraai/e3-job-win32-x64 — the Windows job launcher e3-core runs
// each runner through (libs/e3/native/e3-job) — from a built e3-job.exe: the
// binary, a generated `os`/`cpu`-gated package.json, a minimal README and the
// BSL LICENSE. Like the east-c per-platform packages it is not committed; it
// exists only as a build output. release.yml's build-e3-job job packs it for
// publish-npm, and `make -C libs/e3 install-job` stages it into the workspace
// node_modules, where e3-core finds it in a dev checkout.
//
// Usage:
//   node scripts/stage-e3-job-package.mjs \
//       --exe <path/to/e3-job.exe> \
//       --out <package directory> \
//       [--version <semver>]      # default: the root package.json's version
//
// An existing --out directory is replaced only when it is an earlier staging of
// this package; anything else there is left alone and the script fails.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = '@elaraai/e3-job-win32-x64';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--exe') out.exe = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--version') out.version = argv[++i];
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  for (const k of ['exe', 'out']) {
    if (!out[k]) { console.error(`Missing --${k}`); process.exit(2); }
  }
  out.version ??= JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
  return out;
}

const { exe, out, version } = parseArgs(process.argv.slice(2));
if (!fs.existsSync(exe)) {
  console.error(`No launcher at ${exe} — build it first (make -C libs/e3 job-launcher)`);
  process.exit(1);
}

if (fs.existsSync(out)) {
  const manifest = path.join(out, 'package.json');
  const staged = fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).name === NAME;
  if (!staged && fs.readdirSync(out).length > 0) {
    console.error(`Refusing to replace ${out}: it is not an earlier staging of ${NAME}`);
    process.exit(1);
  }
  fs.rmSync(out, { recursive: true, force: true });
}
fs.mkdirSync(out, { recursive: true });

fs.copyFileSync(exe, path.join(out, 'e3-job.exe'));
fs.copyFileSync(path.join(repoRoot, 'libs/e3/packages/e3-core/LICENSE.md'), path.join(out, 'LICENSE.md'));

const manifest = {
  name: NAME,
  version,
  description: 'The Windows job launcher e3 runs each task runner through — installed automatically as an optionalDependency of @elaraai/e3-core.',
  license: 'BUSL-1.1',
  repository: {
    type: 'git',
    url: 'git+https://github.com/elaraai/east-workspace.git',
    directory: 'libs/e3/native/e3-job',
  },
  os: ['win32'],
  cpu: ['x64'],
  // No `bin` and no `exports`: e3-core resolves `${NAME}/e3-job.exe` by path.
  files: ['e3-job.exe', 'README.md', 'LICENSE.md'],
};
fs.writeFileSync(path.join(out, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

fs.writeFileSync(path.join(out, 'README.md'), `# ${NAME}

> The Windows job launcher, \`e3-job.exe\`, that [\`@elaraai/e3-core\`](https://www.npmjs.com/package/@elaraai/e3-core) runs each task runner through (version ${version}).

Windows has no process group a signal can address. Its container for "a process and everything it starts" is the Job Object, which Node cannot create. e3-core starts each runner through this launcher, which joins a new job that allows no breakaway and ends every member when its last handle closes, then runs the runner in it: stopping the runner ends the launcher, and with it every process the runner started — as does e3 exiting, or the runner exiting.

This package is published as an **optional dependency** of \`@elaraai/e3-core\`, gated on the host's \`os\` / \`cpu\` so npm installs it only on Windows x64. There is no public API — install \`@elaraai/e3-core\` (or \`@elaraai/e3-cli\`) and it is used automatically. Without it, e3 on Windows runs runners directly and warns (\`E3_NO_JOB_LAUNCHER\`) that stopping one ends only the processes \`taskkill /T\` can find.

## Source

Native source: [\`libs/e3/native/e3-job\`](https://github.com/elaraai/east-workspace/tree/main/libs/e3/native/e3-job).

## License

[Business Source License 1.1](LICENSE.md). Production use by for-profit entities requires a commercial license — contact support@elara.ai.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/).*
`);

console.log(`Staged ${NAME}@${version} in ${out}`);
