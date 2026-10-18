#!/usr/bin/env node
// Publishes East's agent plugins — @elaraai/east-claude-plugin and
// @elaraai/east-codex-plugin — from the directories
// `pnpm --filter @elaraai/east-plugin run package` assembled under
// libs/east-plugin/marketplace/ (#1309), skipping a version already on npm so
// a retry after a partial failure is safe. The assembled directory is the
// package: npm packs it as it is, dotfiles included, and runs no script.
//
// Usage: publish-plugins.mjs <tag> [--dry-run] [--registry <url>]
//   <tag>            "beta" | "latest"
//   --dry-run        npm's own --dry-run: packs and reports, publishes nothing
//   --registry <url> a local registry (verdaccio) instead of npmjs: drops
//                    --provenance (npm-OIDC-only) and the already-published
//                    check, as publish-npm.mjs does for the release dry-run.
//
// Expects the plugins assembled (make -C libs/east-plugin package).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { alreadyPublished } from './lib/already-published.mjs';
import { PLUGIN_DIRS, missingParts } from './lib/plugin-packages.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TAG = process.argv[2];
const DRY_RUN = process.argv.includes('--dry-run');
const registryIdx = process.argv.indexOf('--registry');
const REGISTRY = registryIdx !== -1 ? process.argv[registryIdx + 1] : null;
if (!TAG || (TAG !== 'beta' && TAG !== 'latest')) {
  console.error('Usage: publish-plugins.mjs <beta|latest> [--dry-run] [--registry <url>]');
  process.exit(1);
}

let failed = 0;
let published = 0;
let skipped = 0;

for (const rel of PLUGIN_DIRS) {
  const dir = path.join(repoRoot, rel);
  const manifestPath = path.join(dir, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`  NOT ASSEMBLED: ${rel} — run make -C libs/east-plugin package`);
    failed++;
    continue;
  }
  const pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (!DRY_RUN && !REGISTRY && alreadyPublished(pkg.name, pkg.version)) {
    console.log(`  skip: ${pkg.name}@${pkg.version} already on npm`);
    skipped++;
    continue;
  }

  const missing = missingParts(dir, pkg);
  if (missing.length > 0) {
    console.error(`  INCOMPLETE: ${pkg.name}@${pkg.version} lacks ${missing.join(', ')}`);
    failed++;
    continue;
  }

  const args = ['publish', dir, '--access', 'public', '--tag', TAG, '--ignore-scripts'];
  if (!REGISTRY) args.push('--provenance');
  if (REGISTRY) args.push('--registry', REGISTRY);
  if (DRY_RUN) args.push('--dry-run');
  console.log(`  publish: ${pkg.name}@${pkg.version}${DRY_RUN ? ' (dry run)' : ''}`);
  // `npm` is a `.cmd` shim on Windows (the verdaccio dry-run's Windows leg
  // drives this path); the arguments are shell-safe.
  const r = spawnSync('npm', args, { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.error) console.error(`  spawn error: ${r.error.message}`);
  if (r.status !== 0) {
    console.error(`  FAILED: ${pkg.name}@${pkg.version}`);
    failed++;
  } else {
    published++;
  }
}

console.log(`\nDone: ${published} published, ${skipped} skipped, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
