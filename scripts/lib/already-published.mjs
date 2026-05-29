// Shared "is this @elaraai/* version already on the npm registry" check.
// Used by publish-npm.mjs (per-package idempotency on partial-failure retry)
// and by bootstrap-east-c-npm.mjs (refuse to re-publish a name+version that
// already exists, since the first-publish must be a brand-new name).

import { spawnSync } from 'node:child_process';

/**
 * Return true if `<name>@<version>` is published to the public npm registry.
 *
 * Uses `npm view <name>@<version> version` rather than a raw HTTP probe so
 * the same auth/registry config as the surrounding shell applies.
 *
 * @param {string} name    Full package name (`@elaraai/east-c-cli`).
 * @param {string} version Exact semver to check.
 * @returns {boolean}
 */
export function alreadyPublished(name, version) {
  const r = spawnSync('npm', ['view', `${name}@${version}`, 'version'], {
    encoding: 'utf8',
  });
  return r.status === 0 && r.stdout.trim() === version;
}
