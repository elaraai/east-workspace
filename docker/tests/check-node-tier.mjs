#!/usr/bin/env node
// Copyright (c) 2025 Elara AI Pty Ltd
// Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
/**
 * Checks a node image's tier manifest, in the image: it is form 2, of the
 * image's Node alone, naming the global node_modules npm installs into, the
 * registry npm installs from, and East's packages installed there, the ones
 * named and no other, each at its own version as installed, and at the
 * release's when `RELEASE` names one.
 *
 *     RELEASE=<version> check-node-tier.mjs <tier-manifest.json> <package>...
 *
 * Exits 1, saying what differs, when the manifest is not the image's.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [manifestPath, ...expected] = process.argv.slice(2);
const npm = (...args) => execFileSync('npm', args, { cwd: '/', encoding: 'utf8' }).trim();
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const root = npm('root', '-g');
const problems = [];
const said = (what, got, want) => { if (got !== want) problems.push(`${what} is ${JSON.stringify(got)}, not ${JSON.stringify(want)}`); };

said('its form', manifest.version, 2);
said('its python section', manifest.python, undefined);
said('its Node', manifest.node?.version, process.versions.node);
said('its node_modules root', manifest.node?.root, root);
said('its registry', manifest.node?.registry, npm('config', 'get', 'registry').replace(/\/?$/, '/'));
const packages = manifest.node?.packages ?? [];
said('its packages', JSON.stringify(packages.map(({ name }) => name)), JSON.stringify([...expected].sort()));
for (const { name, version } of packages) {
  said(`${name}'s version`, version, JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf8')).version);
  if (process.env.RELEASE) said(`${name}'s version`, version, process.env.RELEASE);
}
if (problems.length > 0) {
  process.stderr.write(`the image's tier manifest is not what it holds:\n  ${problems.join('\n  ')}\n${JSON.stringify(manifest)}\n`);
  process.exit(1);
}
