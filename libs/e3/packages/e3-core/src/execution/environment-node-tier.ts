/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What a node environment keeps of what npm installed for it, and what one
 * built over a tier leaves to it.
 *
 * A workspace member's environment keeps what its members need and the
 * runner's own packages, east-node's CLI and its stock platforms, which a
 * workspace commonly lists on its root alone (#1700). Nothing else the
 * workspace's root depends on is kept, and none of a member's development
 * dependencies, as the environment of a python workspace's member installs
 * none of them (#1654).
 *
 * Built over a tier, an environment leaves to it each of East's packages its
 * lock resolved from the registry at the version the tier's image holds, and
 * every package only they need (#1697).
 *
 * Node resolves what a package needs from where the package is: the nearest
 * `node_modules/<dependency>` above it, once its links are followed. So an
 * East package linked to the image's copy where the environment is composed
 * brings the image's dependencies, and its own copies of them here are never
 * read: each package the environment's own code reaches only through a left
 * one goes with it. What the project's own packages need stays, at the
 * versions its lock chose.
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { StringType, compareFor } from '@elaraai/east';
import { STOCK_PLATFORMS_BY_RUNNER } from '@elaraai/e3';
import { nodeTierHolds, type NodeTier } from '../tier-manifest.js';
import { NODE_TIER_LINKS, layerPathAncestors as ancestorsOf, type NodeTierLink } from '../environment-layer-unpack.js';
import { pathExists } from './environment-install.js';

/** Orders paths by code point, the same on every machine. */
const byPath = compareFor(StringType);

/** The directory a package's dependencies are installed in. */
const NODE_MODULES = 'node_modules';

/** npm's account of the tree it installed, in the tree. */
const HIDDEN_LOCK = `${NODE_MODULES}/.package-lock.json`;

/** The packages a node runner loads beside a project's own: east-node's CLI,
 *  which runs a unit, and its stock platforms. */
const RUNNER_PACKAGES: readonly string[] = ['@elaraai/east-node-cli', ...STOCK_PLATFORMS_BY_RUNNER.east_node];

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

/**
 * What a workspace member's node environment keeps of what npm installed for
 * its workspace.
 *
 * @internal
 */
export interface NodeMembersShare {
  /** What the environment's own code and its runner start from: its members,
   *  and each of the runner's packages the root's lock installed */
  readonly roots: readonly string[];
  /** The packages none of them needs, removed, sorted: what the workspace's
   *  root, and the members' development, alone need */
  readonly removed: readonly string[];
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

/** What a package names among what it needs to run, which npm installs: what
 *  it depends on, may depend on, and takes from its dependents. */
function runtimeNeeds(locked: LockedPackage): string[] {
  return [...new Set([locked.dependencies, locked.optionalDependencies, locked.peerDependencies].flatMap((needs) => Object.keys(needs ?? {})))];
}

/** What a package names among what it needs, which npm installs: what it
 *  needs to run, and what a root or a workspace member is developed with. */
function dependenciesOf(key: string, locked: LockedPackage): string[] {
  const own = pathName(key) === null ? Object.keys(locked.devDependencies ?? {}) : [];
  return [...new Set([...runtimeNeeds(locked), ...own])];
}

/** How Node finds what each package of an installed tree needs, from npm's
 *  account of it. */
function treeOf(packages: ReadonlyMap<string, LockedPackage>) {
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
  /** The packages that what is named reaches, and what each needs in turn as
   *  `needs` names it, up to and with those `stop` holds. */
  const reach = (from: Iterable<string>, needs: (key: string, locked: LockedPackage) => string[], stop: ReadonlySet<string> = new Set()): Set<string> => {
    const seen = new Set<string>();
    const queue = [...from];
    while (queue.length > 0) {
      const key = queue.pop()!;
      if (seen.has(key)) continue;
      seen.add(key);
      if (stop.has(key)) continue;
      const real = realKey(key);
      if (real !== key) {
        queue.push(real);
        continue;
      }
      const locked = packages.get(key);
      if (locked === undefined) continue;
      for (const dependency of needs(key, locked)) {
        const found = resolve(key, dependency);
        if (found !== null) queue.push(found);
      }
    }
    return seen;
  };
  return { resolve, realKey, reach };
}

/**
 * Works out what a workspace member's node environment keeps of what npm
 * installed for its workspace, from npm's account of the tree.
 *
 * @remarks
 * What is kept starts from the environment's members and from each of the
 * runner's packages the root's lock installed: east-node's CLI and its stock
 * platforms, which the runner loads and a workspace commonly lists on its
 * root alone. Each package what is kept needs to run is kept in turn, as
 * Node finds it, with each link that leads to what is kept: a member's, by
 * which the runner loads it. Nothing else is: what the workspace's root
 * depends on, or its members are developed with, and nothing kept needs.
 *
 * @internal
 * @param packages - npm's account of the tree, by path
 * @param members - The paths of the environment's members in the tree
 * @returns Where what is kept starts, and what is removed
 */
export function nodeMembersShare(packages: ReadonlyMap<string, LockedPackage>, members: readonly string[]): NodeMembersShare {
  const tree = treeOf(packages);
  const roots = [...members, ...RUNNER_PACKAGES.map((name) => `${NODE_MODULES}/${name}`).filter((key) => packages.has(key))];
  const kept = tree.reach(roots, (_key, locked) => runtimeNeeds(locked));
  const keeps = (key: string): boolean => kept.has(key) || (packages.get(key)?.link === true && kept.has(tree.realKey(key)));
  // Only a package's of the tree goes: never the root or a workspace member
  const unneeded = new Set([...packages.keys()].filter((key) => pathName(key) !== null && !keeps(key)));
  return { roots, removed: [...unneeded].filter((key) => !ancestorsOf(key).some((above) => unneeded.has(above))).sort(byPath) };
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
 * @param roots - What the project's own code starts from: for a project, the
 *   root and each package installed from the project's tarballs; for a
 *   workspace member's environment, what {@link nodeMembersShare} keeps from
 * @param tier - What the tier holds of Node
 * @param development - Whether what a root or a workspace member is
 *   developed with is the project's own: a project's tools are installed for
 *   it, and a workspace member's environment keeps none of its members'
 *   ({@link nodeMembersShare}), so what one of them needs and a left package
 *   alone besides is left with it
 * @returns What is left to the tier, what is removed, and how many
 *   installed packages go
 */
export function nodeTierShare(packages: ReadonlyMap<string, LockedPackage>, roots: readonly string[], tier: NodeTier, development = true): NodeTierShare {
  // East's packages the tier holds the same
  const left = new Set<string>();
  for (const [key, locked] of packages) {
    const name = pathName(key);
    if (name === null || !name.startsWith('@elaraai/') || locked.link === true || locked.version === undefined) continue;
    if (locked.name !== undefined && locked.name !== name) continue;
    if (nodeTierHolds(tier, { name, version: locked.version, resolved: locked.resolved })) left.add(key);
  }
  const tree = treeOf(packages);
  const needs = development ? dependenciesOf : (_key: string, locked: LockedPackage): string[] => runtimeNeeds(locked);
  const needed = tree.reach(roots, needs, left);
  const theirs = tree.reach([...left].flatMap((key) => needs(key, packages.get(key)!)
    .flatMap((dependency) => tree.resolve(key, dependency) ?? [])), needs, left);
  // Only a package's of the tree goes: never the root, a workspace member or what one links to
  const removed = new Set([...theirs].filter((key) => !needed.has(key) && !left.has(key) && packages.has(key) && pathName(key) !== null
    && !(packages.get(key)!.link === true && needed.has(tree.realKey(key)))));
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
 * npm's account of the tree installed in a build directory, by path, and the
 * root, by its manifest: npm's account holds no entry of it.
 *
 * @param why - What reads it, which a refusal names
 * @throws {Error} When npm left no account of a tree it installed
 */
async function installedTree(buildDir: string, why: string): Promise<Map<string, LockedPackage>> {
  const packages = new Map<string, LockedPackage>();
  if (await pathExists(path.join(buildDir, NODE_MODULES))) {
    let lock: { packages?: unknown };
    try {
      lock = JSON.parse(await fs.readFile(path.join(buildDir, ...HIDDEN_LOCK.split('/')), 'utf-8')) as { packages?: unknown };
    } catch (err) {
      throw new Error(`environment materialization: npm left no account of the tree it installed (${HIDDEN_LOCK}), ` +
        `which ${why}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (typeof lock.packages !== 'object' || lock.packages === null) {
      throw new Error(`environment materialization: npm's account of the tree it installed (${HIDDEN_LOCK}) names no packages`);
    }
    for (const [key, locked] of Object.entries(lock.packages as Record<string, LockedPackage>)) packages.set(key, locked);
  }
  packages.set('', JSON.parse(await fs.readFile(path.join(buildDir, 'package.json'), 'utf-8')) as LockedPackage);
  return packages;
}

/**
 * Takes packages out of an installed tree: those removed, with each link npm
 * made in a `.bin` directory to what they held, which leads nowhere; and those
 * left to a tier, whose links stay and lead to the image's once the agent has
 * linked them. A scope's directory that held only what was taken out goes
 * too: the agent makes one again for a link it makes in it. Each taken out,
 * and each inside one, leaves npm's account of the tree as it is read here.
 */
async function takeOut(buildDir: string, packages: Map<string, LockedPackage>, removed: readonly string[], left: readonly string[]): Promise<void> {
  const at = (key: string): string => path.join(buildDir, ...key.split('/'));
  for (const key of [...left, ...removed]) await fs.rm(at(key), { recursive: true, force: true });
  const scopes = new Set([...left, ...removed].map((key) => path.posix.dirname(key)).filter((dir) => path.posix.basename(dir).startsWith('@')));
  for (const scope of scopes) {
    try {
      await fs.rmdir(at(scope));
    } catch (err) {
      // One that holds what stays, or that went with a package it was in
      if (!['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes((err as NodeJS.ErrnoException).code ?? '')) throw err;
    }
  }
  const out = new Set(removed);
  const gone = (key: string): boolean => out.has(key) || ancestorsOf(key).some((above) => out.has(above));
  for (const key of packages.keys()) {
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
  const taken = new Set([...left, ...removed]);
  for (const key of [...packages.keys()]) if (taken.has(key) || ancestorsOf(key).some((above) => taken.has(above))) packages.delete(key);
}

/**
 * Leaves to its tier what the tier holds of an installed tree
 * ({@link nodeTierShare}), and names each left package in the environment's
 * {@link NODE_TIER_LINKS} file.
 *
 * @param development - Whether what the roots are developed with is the
 *   project's own ({@link nodeTierShare})
 * @returns How many installed packages were left to the tier
 */
async function leaveToTier(
  buildDir: string, packages: Map<string, LockedPackage>, roots: readonly string[], tier: NodeTier, development: boolean,
): Promise<number> {
  const share = nodeTierShare(packages, roots, tier, development);
  await takeOut(buildDir, packages, share.removed, share.links.map((link) => link.path));
  // What the agent links to the image's, a key at a time in one order: the same tree, the same bytes
  await fs.writeFile(path.join(buildDir, NODE_TIER_LINKS),
    `${JSON.stringify({ links: share.links.map(({ path: where, name, version }) => ({ path: where, name, version })) })}\n`);
  return share.gone;
}

/** The files of a list that are still in the build directory. */
async function stillThere(buildDir: string, files: readonly string[]): Promise<string[]> {
  const kept: string[] = [];
  for (const file of files) if (await pathExists(path.join(buildDir, ...file.split('/')))) kept.push(file);
  return kept;
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
  const packages = await installedTree(buildDir, 'a node environment is built over a tier by');
  // The project's own packages: the root, and each the project's files are in
  const roots = new Set(['']);
  for (const file of project) {
    const found = ancestorsOf(file).reverse().find((dir) => packages.has(dir));
    if (found !== undefined) roots.add(found);
  }
  const fromTier = await leaveToTier(buildDir, packages, [...roots], tier, true);
  await fs.rm(path.join(buildDir, ...HIDDEN_LOCK.split('/')), { force: true });
  return { fromTier, project: await stillThere(buildDir, project) };
}

/**
 * Keeps of a workspace member's node environment, once npm has installed its
 * workspace whole, what its members and the runner need
 * ({@link nodeMembersShare}); and, built over a tier, leaves to the tier what
 * it holds of that ({@link nodeTierShare}).
 *
 * @remarks
 * Every package nothing kept needs is removed, with each link npm made in a
 * `.bin` directory to what it held: what the workspace's root depends on, its
 * tools among it, and what the members are developed with. So a member's
 * environment is the same wherever it is built, here, for a rack's platform
 * or over its tier, and a member whose code reads a package only its root
 * lists fails alike everywhere. npm's account of the tree goes too, as it is
 * no longer the tree's.
 *
 * A backend that installs a member's workspace by its own steps, as an
 * image's build does, calls this once the install is done, and its
 * environment is the same as the one e3 builds. What it reads is npm's
 * account of the tree it installed (`node_modules/.package-lock.json`, which
 * `npm ci` writes): the workspace installed whole, its root's `workspaces`
 * naming the members, each at its path.
 *
 * @param buildDir - The installed environment
 * @param members - The paths of the environment's members, relative to `buildDir`
 * @param project - The members' own files, relative to `buildDir`, of which
 *   it returns those still there: a build that names none gives none
 * @param tier - What the tier it is built over holds of Node, if it is built
 *   over one
 * @returns How many installed packages were left to a tier, null when it is
 *   built over none, and the members' files that are still there
 * @throws {Error} When npm left no account of the tree it installed
 *
 * @example
 * ```ts
 * import { keepNodeMembers, readTierManifest } from '@elaraai/e3-core';
 *
 * // `npm ci` installed the workspace in `dir`, against its root's lock
 * const tier = readTierManifest(manifestBytes).node; // none, to build it whole
 * const { fromTier } = await keepNodeMembers(dir, ['packages/pricing'], [], tier);
 * // fromTier: how many installed packages the tier's image holds for it
 * ```
 */
export async function keepNodeMembers(
  buildDir: string, members: readonly string[], project: readonly string[], tier?: NodeTier,
): Promise<{ fromTier: number | null; project: string[] }> {
  const packages = await installedTree(buildDir, 'what a workspace member\'s node environment keeps is read from');
  const share = nodeMembersShare(packages, members);
  await takeOut(buildDir, packages, share.removed, []);
  const fromTier = tier === undefined ? null : await leaveToTier(buildDir, packages, share.roots, tier, false);
  await fs.rm(path.join(buildDir, ...HIDDEN_LOCK.split('/')), { force: true });
  return { fromTier, project: await stillThere(buildDir, project) };
}
