/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The import gate of an environment built over a tier: what lets it import
 * from the tier the distributions left to it, and nothing else (#1655).
 *
 * The environment was installed whole, and then each distribution the tier's
 * image holds the same was removed from it (`leftToTier`). The tier's
 * site directory is then not put on `sys.path`, where everything in it could
 * be imported. A module of the environment's own, which a path file imports
 * as Python starts, finds in the tier the modules and the distributions left
 * to it, and runs their path files. So a task imports and lists on a rack
 * what it does where its environment runs whole, and a module the tier holds
 * that the environment's lock never installed fails to import, as it does
 * there.
 *
 * Inside a namespace package both hold parts of, a name not left to the tier
 * is looked for in the environment's own parts alone: the tier's part of
 * that name, a module or an ordinary package, never takes the place of the
 * namespace package's part the environment ships (PEP 420), at any depth.
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

The environment was installed whole, and then each distribution the tier's
image holds the same was removed from it. Those alone are taken from the
tier: its site directory is not on sys.path, and this module, which a path
file imports as Python starts, finds in it the modules and the distributions
left to it, and runs their path files. Nothing else in the tier is imported or
listed, as nothing else is where the environment runs whole.

Inside a namespace package both hold parts of, a name not left to the tier is
looked for in the environment's own parts alone, so the tier's part of that
name never takes the place of the one the environment ships.
"""

import os
import re
import site
import sys
from importlib.machinery import ModuleSpec, PathFinder
from importlib.metadata import DistributionFinder, MetadataPathFinder

TIER = __TIER__
ROOTS = frozenset(__ROOTS__)
NAMESPACES = frozenset(__NAMESPACES__)
DISTRIBUTIONS = frozenset(__DISTRIBUTIONS__)
PATH_FILES = __PATH_FILES__


def _in_tier(directory):
    return directory == TIER or directory.startswith(TIER + os.sep)


def _canonical(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def _namespace(name):
    """A namespace package both hold parts of: the environment's parts, then the tier's."""
    here = PathFinder.find_spec(name)
    if here is not None and here.origin is not None:
        return None
    spec = ModuleSpec(name, None, is_package=True)
    spec.submodule_search_locations = [*(here.submodule_search_locations if here is not None else []), os.path.join(TIER, name)]
    return spec


class TierFinder(DistributionFinder):
    """Finds in the tier what the environment left to it, and nothing else."""

    @classmethod
    def find_spec(cls, fullname, path=None, target=None):
        names = fullname.split(".")
        if names[0] in NAMESPACES:
            if path is None:
                return _namespace(fullname)
            if ".".join(names[:2]) in ROOTS:
                return None
            # Not left to the tier: the environment's own parts alone
            spec = PathFinder.find_spec(fullname, [part for part in path if not _in_tier(part)])
            if spec is None:
                raise ModuleNotFoundError("No module named " + repr(fullname), name=fullname)
            return spec
        if path is None and fullname in ROOTS and PathFinder.find_spec(fullname) is None:
            return PathFinder.find_spec(fullname, [TIER])
        return None

    @classmethod
    def find_distributions(cls, context=DistributionFinder.Context()):
        # A caller that names its own path asks of that path, not of this environment
        if "path" in vars(context):
            return
        for dist in MetadataPathFinder.find_distributions(DistributionFinder.Context(name=context.name, path=[TIER])):
            if _canonical(dist.metadata["Name"] or "") in DISTRIBUTIONS:
                yield dist


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
    __TIER__: site, __ROOTS__: imports.roots, __NAMESPACES__: imports.namespaces,
    __DISTRIBUTIONS__: imports.distributions, __PATH_FILES__: imports.pathFiles,
  };
  // Each value once, in its place: a JSON string or list of strings is the same Python literal
  return SOURCE.replace(/\b__(TIER|ROOTS|NAMESPACES|DISTRIBUTIONS|PATH_FILES)__\b/g, (placeholder) => JSON.stringify(values[placeholder]));
}
