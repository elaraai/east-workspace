/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What a node environment built over a tier leaves to it (#1697): each of
 * East's packages its lock resolved from the registry at the version the
 * tier's image holds, and every package only they need.
 *
 * Node resolves what a package needs from where the package is: the nearest
 * `node_modules/<dependency>` above it, once its links are followed. So an
 * East package linked to the image's copy where the environment is composed
 * brings the image's dependencies, and its own copies of them here are never
 * read: each package the environment's own code reaches only through a left
 * one goes with it. What the project's own packages need stays, at the
 * versions its lock chose, and so does each package the graph does not
 * reach at all.
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { StringType, compareFor } from '@elaraai/east';
import { nodeTierHolds, type NodeTier } from '../tier-manifest.js';
import { NODE_TIER_LINKS, layerPathAncestors as ancestorsOf, type NodeTierLink } from '../environment-layer-unpack.js';
import { pathExists } from './environment-install.js';

/** Orders paths by code point, the same on every machine. */
const byPath = compareFor(StringType);

/** The directory a package's dependencies are installed in. */
const NODE_MODULES = 'node_modules';

/** npm's account of the tree it installed, in the tree. */
const HIDDEN_LOCK = `${NODE_MODULES}/.package-lock.json`;

/**
 * A package as npm's account of an installed tree names it
 * (`node_modules/.package-lock.json`), by where it is in the tree: a lock's
 * entry.
 *
 * @internal
 */
export interface LockedPackage {
  /** Its name, where its path does not say it: a workspace member's, an alias's */
  readonly name?: string;
  /** Its version */
  readonly version?: string;
  /** Where it was installed from: a registry's tarball, a path, a repository */
  readonly resolved?: string;
  /** Whether it is a link to `resolved`, a path in the tree */
  readonly link?: boolean;
  /** What it depends on */
  readonly dependencies?: Readonly<Record<string, string>>;
  /** What it depends on when it installs */
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  /** What it takes from its dependents, which npm installs beside it */
  readonly peerDependencies?: Readonly<Record<string, string>>;
  /** What a root or a workspace member is developed with, which npm installs for them alone */
  readonly devDependencies?: Readonly<Record<string, string>>;
}

/**
 * What a node environment built over a tier leaves to it.
 *
 * @internal
 */
export interface NodeTierShare {
  /** East's packages the tier holds, each linked where it was to the image's
   *  copy when the environment is composed, sorted by path */
  readonly links: readonly NodeTierLink[];
  /** The packages only they need, removed, sorted */
  readonly removed: readonly string[];
  /** How many installed packages the environment no longer carries: those
   *  left, those removed, and those inside either */
  readonly gone: number;
}

/** The name of the package at a path of the tree, as the path gives it: what
 *  follows its last `node_modules/`; null for one under none, the root's or a
 *  workspace member's. */
function pathName(key: string): string | null {
  const at = key.lastIndexOf(`${NODE_MODULES}/`);
  return at === -1 || (at > 0 && key[at - 1] !== '/') ? null : key.slice(at + NODE_MODULES.length + 1);
}

/**
 * The `node_modules` directories Node looks for what a package needs in,
 * nearest first, as paths of the tree: one in the package's own directory,
 * and in each above it that is not one, to the tree's root.
 */
function lookups(dir: string): string[] {
  const segments = dir === '' ? [] : dir.split('/');
  const found: string[] = [];
  for (let i = segments.length; i >= 0; i--) {
    if (i > 0 && segments[i - 1] === NODE_MODULES) continue;
    const above = segments.slice(0, i).join('/');
    found.push(above === '' ? NODE_MODULES : `${above}/${NODE_MODULES}`);
  }
  return found;
}

/** What a package names among what it needs, which npm installs: what it
 *  depends on, may depend on, and takes from its dependents; and what a root
 *  or a workspace member is developed with. */
function dependenciesOf(key: string, locked: LockedPackage): string[] {
  const own = pathName(key) === null;
  return [...new Set([locked.dependencies, locked.optionalDependencies, locked.peerDependencies, own ? locked.devDependencies : undefined]
    .flatMap((needs) => Object.keys(needs ?? {})))];
}

/**
 * Works out what a node environment built over a tier leaves to it, from
 * npm's account of the tree it installed.
 *
 * @remarks
 * A package is the tier's when it is one of East's (`@elaraai/*`), named as
 * its path names it, its lock resolved it from the registry the tier
 * installed its own from, and the tier holds it at that version
 * (`nodeTierHolds`): a published version is immutable, so it is the same
 * package. One from a path, a repository, another registry or at another
 * version is the project's own, and stays.
 *
 * What a package needs is found as Node finds it: the nearest
 * `node_modules/<dependency>` above the package, its links followed. A left
 * package's needs are found from the image's copy where the environment is
 * composed, so each package reached from what the left ones need, and not
 * from the project's own packages, is removed. A package the graph reaches
 * from neither stays.
 *
 * @internal
 * @param packages - npm's account of the tree, by path; the root's own entry
 *   is the root's manifest, which npm's account holds none of
 * @param roots - The paths of the project's own packages: the root, each
 *   workspace member, each package installed from the project's tarballs
 * @param tier - What the tier holds of Node
 * @returns What is left to the tier, what is removed, and how many
 *   installed packages go
 */
export function nodeTierShare(packages: ReadonlyMap<string, LockedPackage>, roots: readonly string[], tier: NodeTier): NodeTierShare {
  // East's packages the tier holds the same
  const left = new Set<string>();
  for (const [key, locked] of packages) {
    const name = pathName(key);
    if (name === null || !name.startsWith('@elaraai/') || locked.link === true || locked.version === undefined) continue;
    if (locked.name !== undefined && locked.name !== name) continue;
    if (nodeTierHolds(tier, { name, version: locked.version, resolved: locked.resolved })) left.add(key);
  }
  /** Where what a package needs is, from its own directory. */
  const resolve = (dir: string, dependency: string): string | null => {
    for (const lookup of lookups(dir)) {
      const key = `${lookup}/${dependency}`;
      if (packages.has(key)) return key;
    }
    return null;
  };
  /** What a link leads to in the tree; any other package's own path. */
  const realKey = (key: string): string => {
    const locked = packages.get(key);
    return locked?.link === true && locked.resolved !== undefined ? path.posix.normalize(locked.resolved) : key;
  };
  /** The packages that what is named reaches, and what each needs in turn, up to the left ones. */
  const reach = (from: Iterable<string>): Set<string> => {
    const seen = new Set<string>();
    const queue = [...from];
    while (queue.length > 0) {
      const key = queue.pop()!;
      if (seen.has(key)) continue;
      seen.add(key);
      if (left.has(key)) continue;
      const real = realKey(key);
      if (real !== key) {
        queue.push(real);
        continue;
      }
      const locked = packages.get(key);
      if (locked === undefined) continue;
      for (const dependency of dependenciesOf(key, locked)) {
        const found = resolve(key, dependency);
        if (found !== null) queue.push(found);
      }
    }
    return seen;
  };
  const needed = reach(roots);
  const theirs = reach([...left].flatMap((key) => dependenciesOf(key, packages.get(key)!)
    .flatMap((dependency) => resolve(key, dependency) ?? [])));
  // Only a package's of the tree goes: never the root, a workspace member or what one links to
  const removed = new Set([...theirs].filter((key) => !needed.has(key) && !left.has(key) && packages.has(key) && pathName(key) !== null
    && !(packages.get(key)!.link === true && needed.has(realKey(key)))));
  const inside = (key: string, among: ReadonlySet<string>): boolean => ancestorsOf(key).some((above) => among.has(above));
  const gone = new Set([...left, ...removed]);
  const links = [...left].filter((key) => !inside(key, gone)).sort(byPath)
    .map((key): NodeTierLink => ({ path: key, name: pathName(key)!, version: packages.get(key)!.version! }));
  return {
    links,
    removed: [...removed].filter((key) => !inside(key, gone)).sort(byPath),
    gone: [...packages.keys()].filter((key) => pathName(key) !== null && (gone.has(key) || inside(key, gone))).length,
  };
}

/**
 * Leaves to its tier what the tier holds of a node environment built for it,
 * once the environment is installed whole: East's packages the tier holds
 * the same, and every package only they need ({@link nodeTierShare}).
 *
 * @remarks
 * Each left package is removed where it was, and named in the environment's
 * {@link NODE_TIER_LINKS} file: the agent that composes it over its tier
 * links each to the image's copy (`composeEnvironmentOverTier`), as no layer
 * holds a link that leads out of the environment. A package only they need
 * is removed, with each link npm made in a `.bin` directory to what it
 * holds; one to a left package stays, and leads to the image's once that is
 * linked. npm's account of the tree goes too, as it is no longer the tree's.
 *
 * @internal
 * @param buildDir - The installed environment
 * @param tier - What the tier holds of Node
 * @param project - The files the project's own packages installed, relative
 *   to `buildDir`: the packages they are in are the project's own
 * @returns How many installed packages were left to the tier, and the
 *   project's files that are still there
 * @throws {Error} When npm left no account of the tree it installed
 */
export async function leaveNodeToTier(buildDir: string, tier: NodeTier, project: readonly string[]): Promise<{ fromTier: number; project: string[] }> {
  const packages = new Map<string, LockedPackage>();
  if (await pathExists(path.join(buildDir, NODE_MODULES))) {
    let lock: { packages?: unknown };
    try {
      lock = JSON.parse(await fs.readFile(path.join(buildDir, ...HIDDEN_LOCK.split('/')), 'utf-8')) as { packages?: unknown };
    } catch (err) {
      throw new Error(`environment materialization: npm left no account of the tree it installed (${HIDDEN_LOCK}), ` +
        `which a node environment is built over a tier by: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (typeof lock.packages !== 'object' || lock.packages === null) {
      throw new Error(`environment materialization: npm's account of the tree it installed (${HIDDEN_LOCK}) names no packages`);
    }
    for (const [key, locked] of Object.entries(lock.packages as Record<string, LockedPackage>)) packages.set(key, locked);
  }
  // The root, by its manifest: npm's account of the tree holds no entry of it
  packages.set('', JSON.parse(await fs.readFile(path.join(buildDir, 'package.json'), 'utf-8')) as LockedPackage);
  // The project's own packages: the root, and each the project's files are in
  const roots = new Set(['']);
  for (const file of project) {
    const found = ancestorsOf(file).reverse().find((dir) => packages.has(dir));
    if (found !== undefined) roots.add(found);
  }
  const share = nodeTierShare(packages, [...roots], tier);
  const at = (key: string): string => path.join(buildDir, ...key.split('/'));
  for (const key of [...share.links.map((link) => link.path), ...share.removed]) await fs.rm(at(key), { recursive: true, force: true });

  // A link in a `.bin` directory to what was removed leads nowhere: it goes
  const removed = new Set(share.removed);
  const gone = (key: string): boolean => removed.has(key) || ancestorsOf(key).some((above) => removed.has(above));
  for (const key of ['', ...packages.keys()]) {
    const bin = key === '' ? `${NODE_MODULES}/.bin` : `${key}/${NODE_MODULES}/.bin`;
    let names: string[];
    try {
      names = await fs.readdir(at(bin));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'ENOTDIR') continue;
      throw err;
    }
    for (const name of names) {
      const link = at(`${bin}/${name}`);
      if (!(await fs.lstat(link)).isSymbolicLink()) continue;
      const target = path.posix.normalize(path.posix.join(bin, (await fs.readlink(link)).split(path.sep).join('/')));
      if (gone(target)) await fs.rm(link, { force: true });
    }
  }
  await fs.rm(at(HIDDEN_LOCK), { force: true });
  // What the agent links to the image's, a key at a time in one order: the same tree, the same bytes
  await fs.writeFile(path.join(buildDir, NODE_TIER_LINKS),
    `${JSON.stringify({ links: share.links.map(({ path: where, name, version }) => ({ path: where, name, version })) })}\n`);
  const kept: string[] = [];
  for (const file of project) if (await pathExists(at(file))) kept.push(file);
  return { fromTier: share.gone, project: kept };
}
