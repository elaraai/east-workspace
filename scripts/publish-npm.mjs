#!/usr/bin/env node
// Publishes the 18 @elaraai/* npm packages, skipping any that are already on npm
// at the current version. Makes retry-after-partial-failure safe without requiring
// manual cherry-pick.
//
// Usage: publish-npm.mjs <tag> [--dry-run]
//   <tag>       "beta" | "latest"
//   --dry-run   pack only, don't publish
//
// Expects package.json files to already be at the target version (run set-npm-version.mjs first).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const TAG = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');
if (!TAG || (TAG !== 'beta' && TAG !== 'latest')) {
  console.error('Usage: publish-npm.mjs <beta|latest> [--dry-run]');
  process.exit(1);
}

// Topological order (least-deps first). pnpm would sort this for us, but we iterate manually
// so we can skip-if-published per package.
const PKGS = [
  'libs/east/package.json',
  'libs/east-node/packages/east-node-std/package.json',
  'libs/east-node/packages/east-node-io/package.json',
  'libs/east-node/packages/east-node-cli/package.json',
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
];

function alreadyPublished(pkgName, version) {
  const r = spawnSync('npm', ['view', `${pkgName}@${version}`, 'version'], {
    encoding: 'utf8',
  });
  return r.status === 0 && r.stdout.trim() === version;
}

function publish(pkgDir) {
  const args = [
    'publish',
    '--access', 'public',
    '--provenance',
    '--tag', TAG,
    '--no-git-checks',
  ];
  if (DRY_RUN) args.push('--dry-run');
  const r = spawnSync('pnpm', args, { cwd: pkgDir, stdio: 'inherit' });
  return r.status === 0;
}

let failed = 0;
let published = 0;
let skipped = 0;

for (const rel of PKGS) {
  const manifestPath = path.join(repoRoot, rel);
  const pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const pkgDir = path.dirname(manifestPath);

  if (!DRY_RUN && alreadyPublished(pkg.name, pkg.version)) {
    console.log(`  skip: ${pkg.name}@${pkg.version} already on npm`);
    skipped++;
    continue;
  }

  console.log(`  publish: ${pkg.name}@${pkg.version}${DRY_RUN ? ' (dry run)' : ''}`);
  if (!publish(pkgDir)) {
    console.error(`  FAILED: ${pkg.name}@${pkg.version}`);
    failed++;
  } else {
    published++;
  }
}

console.log(`\nDone: ${published} published, ${skipped} skipped, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
