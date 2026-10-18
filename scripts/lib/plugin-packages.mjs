// East's agent plugins as npm packages (#1309): where
// `make -C libs/east-plugin package` assembles them, and what an assembled
// directory must hold to be published. Shared by publish-plugins.mjs (the
// release) and bootstrap-plugins-npm.mjs (a name's first version, by hand),
// and free of side effects so either can import it.

import fs from 'node:fs';
import path from 'node:path';

/** The assembled plugins, relative to the repo root, where scripts/package.ts puts them. */
export const PLUGIN_DIRS = [
  'libs/east-plugin/marketplace/east-claude-plugin',
  'libs/east-plugin/marketplace/east-codex-plugin',
];

/**
 * What an assembled plugin lacks to be published: a host's manifest, its
 * bundles, its hooks, its skills, its index, its README and LICENSE — and a
 * manifest with no dependencies and not private, since the bundles are
 * self-contained. Empty when it is complete.
 *
 * @param {string} dir The assembled directory.
 * @param {{ dependencies?: unknown; private?: unknown }} pkg Its package.json.
 * @returns {string[]}
 */
export function missingParts(dir, pkg) {
  const manifestDir = fs.existsSync(path.join(dir, '.codex-plugin')) ? '.codex-plugin' : '.claude-plugin';
  const required = [`${manifestDir}/plugin.json`, '.build/mcp/server.js', 'hooks/hooks.json', '.mcp.json', 'skills/east/SKILL.md', 'index.json', 'README.md', 'LICENSE.md'];
  const missing = required.filter((rel) => !fs.existsSync(path.join(dir, rel)));
  if (pkg.dependencies !== undefined) missing.push('(no dependencies: the bundles are self-contained)');
  if (pkg.private === true) missing.push('(not private)');
  return missing;
}
