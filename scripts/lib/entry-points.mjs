// The files a package's manifest names as its entry points, which the package
// it publishes must hold. Used by publish-npm.mjs, which refuses a package
// missing one: a package the release never built names files that are not
// there, and would install with no code. @elaraai/east-web-std was listed for
// publishing before any release job built it, and the verdaccio dry-run, which
// drives the same script, published it empty and passed.

import fs from 'node:fs';
import path from 'node:path';

/**
 * Every path a manifest names as an entry point: `main`, `types` (or
 * `typings`), each `bin`, and each target of `exports`, its conditions and
 * fallbacks included.
 *
 * @param {Record<string, unknown>} pkg A parsed package.json.
 * @returns {string[]} The paths, relative to the package, each once.
 */
export function entryPoints(pkg) {
  const found = new Set();
  const collect = (value) => {
    if (typeof value === 'string') found.add(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(pkg.main);
  collect(pkg.types ?? pkg.typings);
  collect(pkg.bin);
  collect(pkg.exports);
  return [...found];
}

/**
 * The entry points a package's directory does not hold. A subpath pattern's
 * target (`./dist/test/*.examples.js`) is held when the directory before its
 * `*` is.
 *
 * @param {string} pkgDir The package's directory.
 * @param {Record<string, unknown>} pkg Its parsed package.json.
 * @returns {string[]} The missing paths, as the manifest names them.
 */
export function missingEntryPoints(pkgDir, pkg) {
  return entryPoints(pkg).filter((target) => {
    const star = target.indexOf('*');
    const held = star === -1 ? target : path.dirname(`${target.slice(0, star)}_`);
    return !fs.existsSync(path.join(pkgDir, held));
  });
}
