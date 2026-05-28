#!/usr/bin/env node
// Generates the minimal README.md shipped inside each
// @elaraai/east-c-cli-<target> tarball. Users never see this directly —
// the per-platform package is an internal dependency of the launcher. It
// exists so the published artifact has a self-describing readme on
// npmjs.com instead of npm's "no README found" placeholder.

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

const { target, version, out } = parseArgs(process.argv.slice(2));

const body = `# @elaraai/east-c-cli-${target}

> Pre-built \`east-c\` native binary for \`${target}\` (version ${version}).

This package contains a single platform-specific binary plus a minimal manifest. It is published as an **optional dependency** of [\`@elaraai/east-c-cli\`](https://www.npmjs.com/package/@elaraai/east-c-cli) and gated on the host's \`os\` / \`cpu\` so npm installs only the matching one. There is no public API — install \`@elaraai/east-c-cli\` instead and let it resolve this package automatically.

The launcher script ([\`@elaraai/east-c-cli\`](https://www.npmjs.com/package/@elaraai/east-c-cli)'s \`bin/east-c.mjs\`) locates this package via \`require.resolve\` and spawns the binary with the original argv.

## Source

Native source: [\`libs/east-c\`](https://github.com/elaraai/east-workspace/tree/main/libs/east-c).

## License

[Business Source License 1.1](LICENSE.md). Production use by for-profit entities requires a commercial license — contact support@elara.ai.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/).*
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, body);
console.log(`Wrote ${out} for @elaraai/east-c-cli-${target}@${version}`);
