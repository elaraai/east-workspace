#!/usr/bin/env node
// Publishes the @elaraai/* npm packages, skipping any that are already on npm
// at the current version. Makes retry-after-partial-failure safe without requiring
// manual cherry-pick. A package whose dependency failed to publish is not
// published either: it would install for no one (a new package name that
// cannot accept trusted publishing yet, e.g. @elaraai/e3-rack before
// scripts/bootstrap-e3-rack-npm.mjs, fails, and e3-cli, which depends on it,
// must not go out without it). A re-run after the fix publishes both.
//
// A publish is done once npm serves it the way an install reads it
// (lib/registry-served.mjs): the registry accepts a publish minutes before it
// serves the version, and the release tags, and builds images against, what
// this script has published (#1399). A version already on npm is waited for
// too: the `npm view` the skip reads lists a version before its tarball is
// served.
//
// Usage: publish-npm.mjs <tag> [--dry-run] [--registry <url>]
//   <tag>            "beta" | "latest"
//   --dry-run        pack only, don't publish (npm's own --dry-run)
//   --registry <url> publish to a local registry (e.g. verdaccio) instead of
//                    npmjs: drops --provenance (which is npm-OIDC-only) and the
//                    real-npm already-published check, but otherwise drives the
//                    same pnpm publish path. Used by the release dry-run
//                    validation (scripts/test-release-verdaccio.sh).
//
// Expects package.json files to already be at the target version (run set-npm-version.mjs first).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { alreadyPublished } from './lib/already-published.mjs';
import { missingEntryPoints } from './lib/entry-points.mjs';
import { describeTarget, waitUntilServed } from './lib/registry-served.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const TAG = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');
const registryIdx = process.argv.indexOf('--registry');
const REGISTRY = registryIdx !== -1 ? process.argv[registryIdx + 1] : null;
if (!TAG || (TAG !== 'beta' && TAG !== 'latest')) {
  console.error('Usage: publish-npm.mjs <beta|latest> [--dry-run] [--registry <url>]');
  process.exit(1);
}

// Topological order (least-deps first). pnpm would sort this for us, but we iterate manually
// so we can skip-if-published per package.
const PKGS = [
  'libs/east/package.json',
  'libs/east-node/packages/east-node-std/package.json',
  'libs/east-node/packages/east-node-io/package.json',
  'libs/east-node/packages/east-node-cli/package.json',
  'libs/east-web/packages/east-web-std/package.json',
  'libs/east-py/packages/east-py-datascience/package.json',
  'libs/e3/packages/e3-types/package.json',
  'libs/e3/packages/e3/package.json',
  'libs/e3/packages/e3-api-client/package.json',
  'libs/e3/packages/e3-core/package.json',
  'libs/e3/packages/e3-api-server/package.json',
  'libs/e3/packages/e3-rack/package.json',
  'libs/e3/packages/e3-cli/package.json',
  'libs/e3/packages/e3-api-tests/package.json',
  'libs/e3/packages/e3-web/package.json',
  'libs/east-ui/packages/east-ui/package.json',
  'libs/east-ui/packages/east-ui-components/package.json',
  'libs/east-ui/packages/e3-ui/package.json',
  'libs/east-ui/packages/e3-ui-components/package.json',
  'libs/east-ui/packages/e3-ui-cli/package.json',
  'libs/east-diagnostics/package.json',
  'libs/east-plugin/package.json',
  'libs/eslint-plugin-east/package.json',
  'libs/tsserver-plugin-east/package.json',
  'libs/create/packages/create-east/package.json',
  'libs/create/packages/create-e3/package.json',
];

function publish(pkgDir) {
  const args = [
    'publish',
    '--access', 'public',
    '--tag', TAG,
    '--no-git-checks',
  ];
  // Provenance requires npm's OIDC and a real registry — a local verdaccio
  // can't honour it. Only request it for real npm publishes.
  if (!REGISTRY) args.push('--provenance');
  if (REGISTRY) args.push('--registry', REGISTRY);
  if (DRY_RUN) args.push('--dry-run');
  // On Windows `pnpm` is a `.cmd` shim; spawnSync can't resolve it without a
  // shell (the real release publishes from Linux, but the verdaccio dry-run's
  // Windows leg exercises this path). Args here are shell-safe (no spaces).
  const r = spawnSync('pnpm', args, {
    cwd: pkgDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.error) console.error(`  spawn error: ${r.error.message}`);
  return r.status === 0;
}

let failed = 0;
let published = 0;
let skipped = 0;
// The names that did not publish at this version, whose dependents are held back.
const unpublished = new Set();
// Every package npm is to serve at this version, published now or earlier.
const expected = [];

// The workspace packages a package needs installed: its dependencies and its
// required peers (an optional peer is the consumer's choice).
function required(pkg) {
  const peers = Object.keys(pkg.peerDependencies ?? {}).filter((name) => pkg.peerDependenciesMeta?.[name]?.optional !== true);
  return [...Object.keys(pkg.dependencies ?? {}), ...peers];
}

for (const rel of PKGS) {
  const manifestPath = path.join(repoRoot, rel);
  const pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const pkgDir = path.dirname(manifestPath);

  // The already-published guard queries npmjs; against a local registry it's
  // meaningless (and would wrongly skip if the proxy surfaces the real npm
  // version), so a fresh verdaccio run always publishes.
  if (!DRY_RUN && !REGISTRY && alreadyPublished(pkg.name, pkg.version)) {
    console.log(`  skip: ${pkg.name}@${pkg.version} already on npm`);
    skipped++;
    expected.push({ registry: 'npm', name: pkg.name, version: pkg.version });
    continue;
  }

  const missingDependencies = required(pkg).filter((name) => unpublished.has(name));
  if (missingDependencies.length > 0) {
    console.error(`  HELD BACK: ${pkg.name}@${pkg.version} needs ${missingDependencies.join(', ')}, which did not publish`);
    unpublished.add(pkg.name);
    failed++;
    continue;
  }

  // A package whose manifest names files it does not hold was never built,
  // and would install with no code. Refused here, so the release and its
  // verdaccio dry-run, which drives this script, both fail on it.
  const missing = missingEntryPoints(pkgDir, pkg);
  if (missing.length > 0) {
    console.error(`  NOT BUILT: ${pkg.name}@${pkg.version} lacks the entry points its manifest names: ${missing.join(', ')}`);
    unpublished.add(pkg.name);
    failed++;
    continue;
  }

  console.log(`  publish: ${pkg.name}@${pkg.version}${DRY_RUN ? ' (dry run)' : ''}`);
  if (!publish(pkgDir)) {
    console.error(`  FAILED: ${pkg.name}@${pkg.version}`);
    unpublished.add(pkg.name);
    failed++;
  } else {
    published++;
    expected.push({ registry: 'npm', name: pkg.name, version: pkg.version });
  }
}

console.log(`\nDone: ${published} published, ${skipped} skipped, ${failed} failed`);
if (failed > 0) process.exit(1);

// Nothing reached npm in a dry run, and a local registry serves at once.
if (!DRY_RUN && !REGISTRY && expected.length > 0) {
  console.log(`\nWaiting until npm serves ${expected.length} package(s)`);
  const missing = await waitUntilServed(expected);
  for (const target of missing) console.error(`  NOT SERVED: ${describeTarget(target)}`);
  process.exit(missing.length > 0 ? 1 : 0);
}
