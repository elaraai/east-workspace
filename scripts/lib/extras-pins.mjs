/**
 * The exact pins a package's extras hold, checked against its workspace's
 * lock.
 *
 * An environment a rack runs over a tier image leaves a distribution to the
 * image only when the image holds that exact build. A project that asks for
 * a package's extras gets the tier's build of torch only when the extras pin
 * it exactly, at the version the release's images are built with: the
 * version the workspace's lock holds. This module reads the pins and the
 * lock, and says where they part.
 */

import { canonicalName, lockedVersions, readToml } from './uv-lock.mjs';

/**
 * The extras whose pins are held to a lock: for each package, the manifest,
 * the lock, and for each pinned distribution the extras that pin it.
 */
export const PINNED_EXTRAS = [
  {
    file: 'libs/east-py/packages/east-py-datascience/pyproject.toml',
    lock: 'libs/east-py/uv.lock',
    pins: { torch: ['torch', 'lightning', 'all'], 'pytorch-lightning': ['lightning', 'all'] },
  },
];

/**
 * The requirement strings of each extra of a `pyproject.toml`.
 *
 * The manifest is read as TOML by Python's `tomllib` ({@link readToml}), as
 * scripts/east-py-constraints.py reads one: what uv reads, this reads.
 *
 * @param pyproject - The manifest's text
 * @returns Each extra's requirements, in the manifest's order
 * @throws {Error} When the manifest is not TOML, or its
 *   `[project.optional-dependencies]` holds what is not an array of strings
 */
export function extraRequirements(pyproject) {
  const read = readToml(pyproject, 'json.dump(read.get("project", {}).get("optional-dependencies", {}), sys.stdout)', 'manifest');
  const extras = new Map();
  for (const [name, requirements] of Object.entries(read)) {
    if (!Array.isArray(requirements) || !requirements.every((requirement) => typeof requirement === 'string')) {
      throw new Error(`[project.optional-dependencies]: the extra '${name}' is not an array of strings`);
    }
    extras.set(name, requirements);
  }
  return extras;
}

/**
 * Where a package's extras part from the rule: each named extra pins each of
 * its distributions exactly (`name==version`, with no marker), the same in
 * every extra, at the one version the lock holds.
 *
 * @param pyproject - The package manifest's text
 * @param lock - The workspace lock's text
 * @param pinned - The manifest's and the lock's names, for the messages, and
 *   for each pinned distribution the extras that pin it
 * @returns One line for each fault; none when the pins hold
 */
export function extrasPinErrors(pyproject, lock, pinned) {
  const errors = [];
  const extras = extraRequirements(pyproject);
  const missing = new Set();
  for (const [name, among] of Object.entries(pinned.pins)) {
    /** The pin each extra holds, for those that hold one. */
    const pins = [];
    for (const extra of among) {
      const requirements = extras.get(extra);
      if (requirements === undefined) {
        if (!missing.has(extra)) errors.push(`${pinned.file}: the extra '${extra}' is not found`);
        missing.add(extra);
        continue;
      }
      const naming = requirements.filter((requirement) => canonicalName(/^[A-Za-z0-9._-]+/.exec(requirement.trim())?.[0] ?? '') === canonicalName(name));
      if (naming.length === 0) { errors.push(`${pinned.file} (${extra}): does not require ${name}`); continue; }
      if (naming.length > 1) { errors.push(`${pinned.file} (${extra}): requires ${name} ${naming.length} times`); continue; }
      const exact = /^[A-Za-z0-9._-]+\s*==\s*([0-9][A-Za-z0-9.!+_-]*)$/.exec(naming[0].trim());
      if (exact === null) { errors.push(`${pinned.file} (${extra}): '${naming[0]}' is not an exact pin of ${name} (${name}==<version>)`); continue; }
      pins.push({ extra, version: exact[1] });
    }
    if (pins.length === 0) continue;
    const other = pins.find((pin) => pin.version !== pins[0].version);
    if (other !== undefined) {
      errors.push(`${pinned.file}: ${name} is pinned ==${pins[0].version} in '${pins[0].extra}' and ==${other.version} in '${other.extra}'`);
      continue;
    }
    const held = lockedVersions(lock, name);
    if (held.length === 0) errors.push(`${pinned.file}: ${name} is pinned ==${pins[0].version}, and ${pinned.lock} holds no ${name}`);
    else if (held.length > 1) errors.push(`${pinned.file}: ${name} is pinned ==${pins[0].version}, and ${pinned.lock} holds it at ${held.join(' and ')}: one pin cannot be both`);
    else if (held[0] !== pins[0].version) errors.push(`${pinned.file}: ${name} is pinned ==${pins[0].version}, and ${pinned.lock} holds ${held[0]}: \`uv lock\` writes the lock of the pin`);
  }
  return errors;
}
