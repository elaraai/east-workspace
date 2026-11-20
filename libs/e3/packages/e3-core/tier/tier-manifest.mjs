#!/usr/bin/env node
// Copyright (c) 2025 Elara AI Pty Ltd
// Licensed under BSL 1.1. See LICENSE for details.
/**
 * Writes what this image's Node holds: its tier manifest.
 *
 * A node environment a rack runs over this image is built without each of
 * East's packages the manifest says the image holds (e3: environments built
 * over their base tier), and the agent links each to the image's copy. The
 * manifest names Node's version, the global `node_modules` directory, the
 * registry npm installs from, and each `@elaraai/*` package installed there,
 * by name and version: the manifest's form 2, a section for each runtime the
 * image holds.
 *
 * Run with the Node the image's tasks run with, once East's packages are
 * installed globally:
 *
 *     node tier-manifest.mjs /opt/e3/tier-manifest.json
 *
 * The global directory is npm's (`npm root -g`), unless given as a second
 * argument. Node's standard library alone, so it runs in any image. It is a
 * file of the `@elaraai/e3-core` package (`tier/tier-manifest.mjs`), beside
 * the reader of what it writes: an image built elsewhere for a tier takes it
 * from the release's package, and so writes a manifest by this release's
 * rules.
 */

import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, parse } from 'node:path';

/**
 * What npm says of a setting, as it prints it: asked from the root of the
 * file system, so no project's settings or workspace where the script runs
 * are read as the image's.
 */
function npm(...args) {
  return execFileSync('npm', args, { cwd: parse(process.execPath).root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

/**
 * East's packages a global `node_modules` directory holds: each directory of
 * its `@elaraai` scope, by the name and version its manifest gives. A link is
 * none, as no registry installed it, and nor is a directory whose manifest
 * names another package.
 */
function eastPackages(root) {
  const scope = join(root, '@elaraai');
  let names;
  try {
    names = readdirSync(scope);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const packages = [];
  for (const name of names) {
    const dir = join(scope, name);
    if (!lstatSync(dir).isDirectory()) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    if (manifest.name !== `@elaraai/${name}` || typeof manifest.version !== 'string' || manifest.version === '') continue;
    packages.push({ name: manifest.name, version: manifest.version });
  }
  // By code point, which names of npm's characters are ordered by alike everywhere
  return packages.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** This Node's manifest: itself, and East's packages installed for it. */
function tierManifest(root) {
  const registry = npm('config', 'get', 'registry');
  // Keys in sorted order, so the same image writes the same bytes: its digest names it
  return {
    node: {
      packages: eastPackages(root).map(({ name, version }) => ({ name, version })),
      registry: registry.endsWith('/') ? registry : `${registry}/`,
      root,
      version: process.versions.node,
    },
    version: 2,
  };
}

const [output, root] = process.argv.slice(2);
if (output === undefined || process.argv.length > 4) {
  process.stderr.write('usage: tier-manifest.mjs <output.json> [<global node_modules>]\n');
  process.exit(2);
}
writeFileSync(output, `${JSON.stringify(tierManifest(root ?? npm('root', '-g')))}\n`);
