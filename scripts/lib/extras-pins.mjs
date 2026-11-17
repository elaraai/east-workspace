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

/** A distribution's name as PEP 503 writes it. */
function canonicalName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/**
 * The requirement strings of each extra of a `pyproject.toml`.
 *
 * Reads the `[project.optional-dependencies]` table for what such a table
 * holds: arrays of strings, with comments. It is not a TOML parser, and reads
 * nothing else of the file.
 *
 * @param pyproject - The manifest's text
 * @returns Each extra's requirements, in the manifest's order
 * @throws {Error} When the table holds what is not an array of strings
 */
export function extraRequirements(pyproject) {
  const extras = new Map();
  const lines = pyproject.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '[project.optional-dependencies]');
  if (start === -1) return extras;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\[/.test(line));
  const table = (end === -1 ? rest : rest.slice(0, end)).join('\n');
  let at = 0;
  /** Skips blanks and comments. */
  const skip = () => {
    for (;;) {
      while (at < table.length && /\s/.test(table[at])) at++;
      if (table[at] !== '#') return;
      while (at < table.length && table[at] !== '\n') at++;
    }
  };
  const fail = (what) => { throw new Error(`[project.optional-dependencies]: ${what} at offset ${at}`); };
  for (skip(); at < table.length; skip()) {
    const key = /^[A-Za-z0-9_-]+/.exec(table.slice(at));
    if (key === null) fail('expected an extra\'s name');
    at += key[0].length;
    skip();
    if (table[at] !== '=') fail(`expected '=' after '${key[0]}'`);
    at++;
    skip();
    if (table[at] !== '[') fail(`the extra '${key[0]}' is not an array`);
    at++;
    const requirements = [];
    for (skip(); table[at] !== ']'; skip()) {
      const quote = table[at];
      if (quote !== '"' && quote !== '\'') fail(`the extra '${key[0]}' holds what is not a string`);
      const close = table.indexOf(quote, at + 1);
      if (close === -1) fail(`the extra '${key[0]}' holds a string that does not end`);
      requirements.push(table.slice(at + 1, close));
      at = close + 1;
      skip();
      if (table[at] === ',') at++;
      else if (table[at] !== ']') fail(`expected ',' or ']' in the extra '${key[0]}'`);
    }
    at++;
    extras.set(key[0], requirements);
  }
  return extras;
}

/**
 * The versions a uv lock holds a package at.
 *
 * @param lock - The lock's text
 * @param name - The package
 * @returns Its versions, in the lock's order: more than one when the lock
 *   holds it at a version per platform
 */
export function lockedVersions(lock, name) {
  const wanted = canonicalName(name);
  const versions = [];
  for (const block of lock.split(/\n(?=\[\[package\]\])/)) {
    if (!block.startsWith('[[package]]')) continue;
    const named = block.match(/\nname\s*=\s*"([^"]+)"/)?.[1];
    if (named === undefined || canonicalName(named) !== wanted) continue;
    const version = block.match(/\nversion\s*=\s*"([^"]+)"/)?.[1];
    if (version !== undefined) versions.push(version);
  }
  return versions;
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
