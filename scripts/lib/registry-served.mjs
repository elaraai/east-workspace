// Whether a registry serves a package version the way an install reads it,
// and a wait until it does. Shared by publish-npm.mjs and publish-plugins.mjs
// (a publish is done once the registry serves what it accepted, so the
// release's finalize, which needs every publish job, tags an installable
// release) and by wait-served.mjs, which the release's shell-driven publishes
// and the Docker image workflow run. Free of side effects.
//
// npm accepts a publish and serves the version minutes later ("Your package
// is being processed and may take a few minutes to become available"): in
// v1.0.95 @elaraai/east-ui took 8 minutes and a 14 kB package as long, in
// v1.0.96 @elaraai/e3 took 7, and the image workflow, which the tag push had
// already started, gave up on each after 5 (#1399). Served is what an
// install reads, not what `npm view` reads: the registry's CDN caches the
// abbreviated packument `npm install` reads apart from the full one
// `npm view` reads, and a tarball can 404 for a while after both list its
// version (v1.0.83's east-node image build failed three seconds after
// `npm view` first listed @elaraai/east-ui, #1042). Likewise uv reads PyPI's
// simple index, not its JSON API.

const NPM_REGISTRY = 'https://registry.npmjs.org';
const PYPI_SIMPLE = 'https://pypi.org/simple';

/** How long a wait allows the registries in all, in minutes: four times the longest lag seen. */
export const DEFAULT_DEADLINE_MINUTES = 30;

/**
 * A package version on a registry.
 * @typedef {{ registry: 'npm' | 'pypi', name: string, version: string }} Target
 */

/**
 * `@elaraai/east@1.0.96 on npm`, `elaraai-east-py==1.0.96 on PyPI`.
 * @param {Target} target
 */
export function describeTarget({ registry, name, version }) {
  return registry === 'npm' ? `${name}@${version} on npm` : `${name}==${version} on PyPI`;
}

/**
 * True once npm's abbreviated packument lists the version and its tarball is
 * served.
 *
 * @param {string} name The package, scope included.
 * @param {string} version The exact version.
 * @param {typeof fetch} [fetchFn]
 */
export async function npmServes(name, version, fetchFn = fetch) {
  const packument = await fetchFn(`${NPM_REGISTRY}/${name.replace('/', '%2f')}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  });
  if (!packument.ok) return false;
  const tarball = (await packument.json()).versions?.[version]?.dist?.tarball;
  if (typeof tarball !== 'string') return false;
  return (await fetchFn(tarball, { method: 'HEAD' })).ok;
}

/**
 * True once PyPI's simple index lists the version.
 *
 * @param {string} project The project, as PyPI names it.
 * @param {string} version The exact version, in its PEP 440 form.
 * @param {typeof fetch} [fetchFn]
 */
export async function pypiServes(project, version, fetchFn = fetch) {
  const index = await fetchFn(`${PYPI_SIMPLE}/${project}/`, {
    headers: { accept: 'application/vnd.pypi.simple.v1+json' },
  });
  if (!index.ok) return false;
  const { versions } = await index.json();
  return Array.isArray(versions) && versions.includes(version);
}

/**
 * Whether a target is served. A registry that cannot be reached is not
 * serving it yet.
 *
 * @param {Target} target
 * @param {typeof fetch} [fetchFn]
 */
export async function serves(target, fetchFn = fetch) {
  try {
    return target.registry === 'npm'
      ? await npmServes(target.name, target.version, fetchFn)
      : await pypiServes(target.name, target.version, fetchFn);
  } catch {
    return false;
  }
}

/**
 * Polls every target, together, until each is served or the deadline passes,
 * logging each as it is served and what is still waited for.
 *
 * @param {Target[]} targets
 * @param {object} [options]
 * @param {number} [options.deadlineMs] How long to wait in all.
 * @param {number} [options.intervalMs] The time between polls.
 * @param {(line: string) => void} [options.log]
 * @param {typeof fetch} [options.fetchFn]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => number} [options.now]
 * @returns {Promise<Target[]>} The targets not served by the deadline: none when every one is.
 */
export async function waitUntilServed(targets, {
  deadlineMs = DEFAULT_DEADLINE_MINUTES * 60_000,
  intervalMs = 10_000,
  log = console.log,
  fetchFn = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
} = {}) {
  const pending = new Set(targets);
  const start = now();
  const elapsed = () => `${Math.round((now() - start) / 1000)}s`;
  for (;;) {
    const checks = await Promise.all([...pending].map(async (target) => [target, await serves(target, fetchFn)]));
    for (const [target, served] of checks) {
      if (!served) continue;
      pending.delete(target);
      log(`  served: ${describeTarget(target)} (${elapsed()})`);
    }
    if (pending.size === 0) return [];
    if (now() - start + intervalMs > deadlineMs) return [...pending];
    log(`  waiting for ${pending.size} (${elapsed()}): ${[...pending].map(describeTarget).join(', ')}`);
    await sleep(intervalMs);
  }
}
