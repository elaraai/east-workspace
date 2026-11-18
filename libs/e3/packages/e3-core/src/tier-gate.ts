/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The import gate of an environment built over a tier: what lets it import
 * from the tier the code of the distributions left to it, and nothing else
 * (#1655).
 *
 * The environment was installed whole, and then the code of each distribution
 * the tier's image holds the same was removed from it (`leftToTier`), its
 * metadata kept: so whatever lists what is installed — `importlib.metadata`,
 * `pkg_resources`, a scan of `sys.path` — finds it, as where the environment
 * runs whole. The tier's site directory is not put on `sys.path`, where
 * everything in it could be imported. A module of the environment's own,
 * which a path file imports as Python starts, finds in the tier the modules
 * left to it, and runs their path files. So a task imports and lists on a
 * rack what it does where its environment runs whole, and a module the tier
 * holds that the environment's lock never installed fails to import, as it
 * does there.
 *
 * No package's path holds a directory of the tier's. Inside a namespace
 * package both hold parts of, a name left to the tier is found in the tier's
 * part, and any other in the environment's own parts alone, so the tier's
 * part of that name, a module or an ordinary package, never takes the place
 * of the one the environment ships (PEP 420), and a name neither holds is
 * not found, as `importlib.util.find_spec` asks.
 *
 * A name left to the tier is the tier's unless a module or an ordinary
 * package of that name is found first on the path, as where the environment
 * runs whole: a bare directory of that name — the working directory's, say —
 * is a namespace portion, which the tier's ordinary package wins over.
 *
 * @packageDocumentation
 */

import type { TierImports } from './tier-manifest.js';

/** The module the gate is, in the environment's site directory. */
export const TIER_GATE_MODULE = '_e3_tier';

/** The path file in the environment's site directory that imports the gate,
 *  after every path file of the environment's own. */
export const TIER_GATE_PATH_FILE = 'zzz_e3_tier.pth';

/**
 * The gate's source. Python, with each value e3 writes in it a JSON literal,
 * which Python reads as the same string or list.
 */
const SOURCE = `# Written by e3 into an environment built over a tier.
"""What this environment imports from the tier it was built over.

The environment was installed whole, and then the code of each distribution
the tier's image holds the same was removed from it, its metadata kept. That
code alone is taken from the tier: its site directory is not on sys.path, and
this module, which a path file imports as Python starts, finds in it the
modules left to it, and runs their path files. Nothing else in the tier is
imported, as nothing else is where the environment runs whole.

No package's path holds a directory of the tier's. Inside a namespace package
both hold parts of, a name left to the tier is found in the tier's part, and
any other in the environment's own parts alone. A name left to the tier is
the tier's unless a module or an ordinary package of that name is found first
on the path, as where the environment runs whole.
"""

import os
import site
import sys
from importlib.machinery import ModuleSpec, PathFinder

TIER = __TIER__
ROOTS = frozenset(__ROOTS__)
NAMESPACES = frozenset(__NAMESPACES__)
PATH_FILES = __PATH_FILES__


def _package(name, locations):
    spec = ModuleSpec(name, None, is_package=True)
    spec.submodule_search_locations = locations
    return spec


def _left(name, path, tier):
    """A name left to the tier, found in the tier's directory: the tier's, unless a
    module or an ordinary package of that name is found first on the path."""
    here = PathFinder.find_spec(name, path)
    if here is not None and here.origin is not None:
        return None
    there = PathFinder.find_spec(name, [tier])
    if there is None or here is None or there.origin is not None:
        return there
    # Namespace portions on both sides are one namespace package, as on one path
    return _package(name, [*here.submodule_search_locations, *there.submodule_search_locations])


class TierFinder:
    """Finds in the tier what the environment left to it, and nothing else."""

    @classmethod
    def find_spec(cls, fullname, path=None, target=None):
        if path is None and fullname in NAMESPACES:
            # The environment's parts, which the path finder reads; with none
            # left here, a namespace package still, whose names left to the
            # tier are found below
            return _package(fullname, []) if PathFinder.find_spec(fullname) is None else None
        if path is None and fullname in ROOTS:
            return _left(fullname, None, TIER)
        names = fullname.split(".")
        if len(names) == 2 and names[0] in NAMESPACES and fullname in ROOTS:
            return _left(fullname, path, os.path.join(TIER, names[0]))
        return None


if TierFinder not in sys.meta_path:
    sys.meta_path.insert(sys.meta_path.index(PathFinder) if PathFinder in sys.meta_path else len(sys.meta_path), TierFinder)
    for name in PATH_FILES:
        site.addpackage(TIER, name, None)
`;

/**
 * The gate module of an environment built over a tier, as its source: what
 * lets it import from the tier only what it left to it.
 *
 * @param site - The tier's site directory, absolute
 * @param imports - What the environment imports from the tier (`tierImports`)
 * @returns The module's source, to be written as `_e3_tier.py` in the
 *   environment's site directory, which {@link TIER_GATE_PATH_FILE} imports
 * @example
 * await writeFile(join(site, `${TIER_GATE_MODULE}.py`), tierGateModule(tier.python.site, tierImports(installed, tier)));
 * await writeFile(join(site, TIER_GATE_PATH_FILE), `import ${TIER_GATE_MODULE}\n`);
 */
export function tierGateModule(site: string, imports: TierImports): string {
  const values: Record<string, unknown> = {
    __TIER__: site, __ROOTS__: imports.roots, __NAMESPACES__: imports.namespaces, __PATH_FILES__: imports.pathFiles,
  };
  // Each value once, in its place: a JSON string or list of strings is the same Python literal
  return SOURCE.replace(/\b__(TIER|ROOTS|NAMESPACES|PATH_FILES)__\b/g, (placeholder) => JSON.stringify(values[placeholder]));
}
