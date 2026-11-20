/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * An environment's layers, composed where they are run: what a rack's guest,
 * or the agent that composes its image, does with the layers a source sent,
 * whatever backend the source keeps them in.
 *
 * A layer is a gzip tar whose entries are under {@link ENVIRONMENT_LAYER_ROOT}:
 * files, directories, and links whose targets are written one way (see
 * {@link environmentLinkInside}). It is what another machine sent, so each
 * entry is checked before it is written, and nothing is written through a
 * link, one this layer made or one an earlier layer did: so every entry lands
 * under the root, and every link names a path in the environment.
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { createWriteStream, promises as fs, type Stats } from 'node:fs';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { extract as tarExtract } from 'tar-stream';
import { NPM_PACKAGE_NAME, type NodeTier, type PythonTier, type TierManifest } from './tier-manifest.js';

/**
 * Where a guest finds a composed environment, relative to its root: every
 * entry of every layer is under it.
 */
export const ENVIRONMENT_LAYER_ROOT = 'var/task/.e3-env';

/**
 * The file in which a node environment built over a tier names what it left
 * to the tier: each of East's packages, where it was, by its name and
 * version. The agent that composes the environment links each to the image's
 * copy ({@link composeEnvironmentOverTier}).
 */
export const NODE_TIER_LINKS = '.e3-tier-links.json';

/** One of East's packages a node environment built over a tier left to it. */
export interface NodeTierLink {
  /** Where it was, relative to the environment, `/` between its segments:
   *  `node_modules/@elaraai/east` */
  readonly path: string;
  /** Its name */
  readonly name: string;
  /** Its version, which the tier holds */
  readonly version: string;
}

/**
 * Makes or finds each directory from `base` down to `dir` real: one that is
 * not there is made, and a link or a file among them refuses.
 *
 * @param base - Where the walk starts, taken as it is
 * @param dir - The directory, at or under `base`
 * @param real - The directories found or made real already, which it adds to
 * @param refused - The refusal of what is at a path and is not a directory
 */
async function realDirectory(base: string, dir: string, real: Set<string>, refused: (at: string) => Error): Promise<void> {
  let at = base;
  for (const segment of path.relative(base, dir).split(path.sep).filter((part) => part !== '')) {
    at = path.join(at, segment);
    if (real.has(at)) continue;
    let stat;
    try {
      stat = await fs.lstat(at);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      await fs.mkdir(at);
      real.add(at);
      continue;
    }
    if (!stat.isDirectory()) throw refused(at);
    real.add(at);
  }
}

/**
 * The directories above a path, the nearest last.
 *
 * @internal
 * @param rel - A path, `/` between its segments
 * @returns Each directory above it, as a path of the same form
 */
export function layerPathAncestors(rel: string): string[] {
  const segments = rel.split('/');
  return segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join('/'));
}

/**
 * Whether a link's target is written as a layer holds one, and names a path
 * in the environment from where the link is.
 *
 * @remarks
 * A target is `.`, or relative with its `..` segments all leading and no
 * other segment `.`, `..` or empty, climbing no higher than the environment.
 * So the directories a target climbs are the link's own, which no link stands
 * in for, and what it then names is reached going down: whatever links it
 * passes, each written so, it stays in the environment.
 *
 * @param rel - Where the link is, relative to the environment, `/` between
 *   its segments
 * @param linkname - What it names
 * @returns Whether it is written so, and names a path in the environment
 *
 * @example
 * ```ts
 * environmentLinkInside('.venv/bin/python', '../../.python/cpython/bin/python3.12'); // true
 * environmentLinkInside('.venv/bin/python', 'lib/../../../../etc'); // false
 * ```
 */
export function environmentLinkInside(rel: string, linkname: string): boolean {
  if (linkname === '.') return true;
  if (linkname === '' || linkname.startsWith('/') || linkname.includes('\\') || /^[a-zA-Z]:/.test(linkname)) return false;
  const segments = linkname.split('/');
  let up = 0;
  while (up < segments.length && segments[up] === '..') up++;
  if (segments.slice(up).some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
  // The directories above the link, in the environment
  return up <= rel.split('/').length - 1;
}

/**
 * Unpacks one layer under a root, as a rack's guest finds it there: the
 * environment is then at {@link ENVIRONMENT_LAYER_ROOT} under the root.
 *
 * @remarks
 * A layer is what another machine sent, so each entry is checked: its name is
 * relative, has no `.`, `..` or empty segment, and is the environment's
 * directory, one above it, or under it; it is a file, a directory, or a link
 * whose target {@link environmentLinkInside} takes. And it is written under
 * real directories alone: an entry whose path passes through a link, one this
 * layer or an earlier one made, refuses the layer, and a file or a link takes
 * the place of a link already at its path, never writing through it. Anything
 * else refuses the layer, and what was written before stays.
 *
 * @param layer - The layer's bytes: a gzip tar
 * @param root - The directory to unpack under
 * @throws {Error} When an entry is not plain, or the bytes are not a gzip tar
 *
 * @example
 * ```ts
 * for (const file of layers) await unpackEnvironmentLayer(createReadStream(file), root);
 * const dir = path.join(root, ENVIRONMENT_LAYER_ROOT);
 * ```
 */
export async function unpackEnvironmentLayer(layer: Readable, root: string): Promise<void> {
  const base = path.resolve(root);
  const above = new Set(layerPathAncestors(`${ENVIRONMENT_LAYER_ROOT}/x`));
  // The directories found, or made, real: no link stands in for one
  const real = new Set<string>();
  const shown = (at: string): string => path.relative(base, at).split(path.sep).join('/');
  /** Makes or finds each directory down to `dir` real, refusing a link or a file among them. */
  const directory = (dir: string, entry: string): Promise<void> => realDirectory(base, dir, real,
    (at) => new Error(`environment layers: the entry '${entry}' is at or under '${shown(at)}', which is not a directory`));
  /** Clears the way for a file or a link: what is at its path goes, unless a directory is. */
  const clear = async (dest: string, entry: string, directoryGoes: boolean): Promise<void> => {
    let stat;
    try {
      stat = await fs.lstat(dest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    if (stat.isDirectory() && !directoryGoes) throw new Error(`environment layers: the entry '${entry}' is a file where a directory is`);
    // A link is removed itself, never what it names
    await fs.rm(dest, { recursive: true, force: true });
    for (const dir of [...real]) if (dir === dest || dir.startsWith(`${dest}${path.sep}`)) real.delete(dir);
  };
  // The root is the caller's: made if it is not there, and taken as it is
  await fs.mkdir(base, { recursive: true });
  const extract = tarExtract();
  extract.on('entry', (header, stream, next) => {
    void (async () => {
      const name = header.name.replace(/\/$/, '');
      const segments = name.split('/');
      const inTree = name.startsWith(`${ENVIRONMENT_LAYER_ROOT}/`);
      if (segments.some((segment) => segment === '' || segment === '.' || segment === '..') || !(inTree || above.has(name))) {
        throw new Error(`environment layers: the entry '${header.name}' is not in the environment`);
      }
      const dest = path.join(base, ...segments);
      if (header.type === 'directory') {
        await directory(dest, header.name);
        stream.resume();
      } else if (header.type === 'symlink' && inTree) {
        const linkname = header.linkname ?? '';
        if (!environmentLinkInside(name.slice(ENVIRONMENT_LAYER_ROOT.length + 1), linkname)) {
          throw new Error(`environment layers: the link '${header.name}' names '${linkname}', outside the environment or not as a layer writes one`);
        }
        await directory(path.dirname(dest), header.name);
        await clear(dest, header.name, true);
        await fs.symlink(linkname, dest);
        stream.resume();
      } else if (header.type === 'file' && inTree) {
        await directory(path.dirname(dest), header.name);
        await clear(dest, header.name, false);
        // Made new: a link that appeared at its path is not written through
        await pipeline(stream, createWriteStream(dest, { flags: 'wx', mode: ((header.mode ?? 0) & 0o111) !== 0 ? 0o755 : 0o644 }));
      } else {
        throw new Error(`environment layers: the entry '${header.name}' is a ${header.type ?? 'thing'} no layer holds`);
      }
    })().then(() => next(), (err: unknown) => extract.destroy(err instanceof Error ? err : new Error(String(err))));
  });
  await pipeline(layer, createGunzip(), extract);
}

/**
 * Finishes an environment built over a tier, where it is composed over that
 * tier: a python environment's virtualenv is linked to the tier's base
 * interpreter, and each of East's packages a node environment left to the
 * tier to the image's copy.
 *
 * @remarks
 * No layer holds a link that leads out of the environment: so the agent that
 * composes it makes the links that do, once its layers are unpacked, into the
 * image of the tier it boots it over. Nothing is written through a link: the
 * directories on the way are real, as the layers' unpacking leaves them.
 *
 * A node environment is one that holds {@link NODE_TIER_LINKS}: each package
 * it names is linked where it was to `<root>/<name>` of the tier's Node, once
 * the tier is found to hold every one at its version. Node finds what the
 * image's copy needs from where that copy is, so the project's code and the
 * runner load one copy of East.
 *
 * Any other is a python environment, which carries no interpreter: its
 * virtualenv's `python` is linked to the tier's base interpreter. Its
 * `pyvenv.cfg` names that interpreter's directory as its `home`, written when
 * it was built from the tier's manifest; one that names another was built
 * over another tier, and is refused.
 *
 * @param envDir - The composed environment: `<root>/var/task/.e3-env`
 * @param tier - The manifest of the tier it is composed over
 * @throws {Error} When the tier holds no runtime of the environment's kind,
 *   or not a package the environment left to it at its version; when the
 *   environment's directories are not real directories, its links file does
 *   not read, or it was built over another interpreter
 *
 * @example
 * ```ts
 * for (const file of layers) await unpackEnvironmentLayer(createReadStream(file), root);
 * if (manifest.over !== undefined) await composeEnvironmentOverTier(path.join(root, ENVIRONMENT_LAYER_ROOT), readTierManifest(await readFile('/opt/e3/tier-manifest.json')));
 * ```
 */
export async function composeEnvironmentOverTier(envDir: string, tier: TierManifest): Promise<void> {
  const root = await fs.lstat(envDir).catch(() => null);
  if (root === null || !root.isDirectory()) throw new Error(`environment layers: '${envDir}' is not a directory of an environment built over a tier`);
  const links = await fs.lstat(path.join(envDir, NODE_TIER_LINKS)).catch(() => null);
  if (links === null) await composePythonOverTier(envDir, tier.python);
  else await composeNodeOverTier(envDir, links, tier.node);
}

/** Links a python environment's virtualenv to the tier's base interpreter
 *  ({@link composeEnvironmentOverTier}). */
async function composePythonOverTier(envDir: string, tier: PythonTier | undefined): Promise<void> {
  if (tier === undefined) throw new Error('environment layers: the environment was built over a tier\'s Python, and the tier holds none');
  const interpreter = tier.base;
  if (!path.posix.isAbsolute(interpreter) || interpreter.includes('\\')) {
    throw new Error(`environment layers: the tier's interpreter '${interpreter}' is not an absolute path`);
  }
  const venv = path.join(envDir, '.venv');
  const bin = path.join(venv, 'bin');
  for (const dir of [venv, bin]) {
    const stat = await fs.lstat(dir).catch(() => null);
    if (stat === null || !stat.isDirectory()) throw new Error(`environment layers: '${dir}' is not a directory of an environment built over a tier`);
  }
  const config = path.join(venv, 'pyvenv.cfg');
  const written = await fs.lstat(config).catch(() => null);
  const home = written !== null && written.isFile() ? /^home\s*=\s*(.*?)\s*$/m.exec(await fs.readFile(config, 'utf-8'))?.[1] : undefined;
  if (home !== path.posix.dirname(interpreter)) {
    throw new Error(`environment layers: the environment was built over an interpreter in '${home ?? 'no directory'}', not the tier's '${interpreter}'`);
  }
  const link = path.join(bin, 'python');
  // What is at its path goes, a link itself and never what it names
  await fs.rm(link, { recursive: true, force: true });
  await fs.symlink(interpreter, link);
}

/**
 * Reads what a node environment built over a tier left to it: its
 * {@link NODE_TIER_LINKS} file, which another machine wrote, so each path is
 * checked to be a package's of the environment by its name.
 *
 * @internal
 * @param text - The file's text
 * @returns The packages, each where it was
 * @throws {Error} When it does not read as one
 */
export function readNodeTierLinks(text: string): NodeTierLink[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`environment layers: ${NODE_TIER_LINKS} is not JSON`);
  }
  const links = (value as { links?: unknown } | null)?.links;
  if (!Array.isArray(links)) throw new Error(`environment layers: ${NODE_TIER_LINKS} names no packages`);
  const seen = new Set<string>();
  return links.map((entry: unknown): NodeTierLink => {
    const { path: where, name, version } = (entry ?? {}) as Record<string, unknown>;
    const segments = typeof where === 'string' ? where.split('/') : [];
    if (typeof where !== 'string' || typeof name !== 'string' || typeof version !== 'string' || version === '' || !NPM_PACKAGE_NAME.test(name)
      || segments.some((segment) => segment === '' || segment === '.' || segment === '..' || segment.includes('\\'))
      || !(where === `node_modules/${name}` || where.endsWith(`/node_modules/${name}`)) || seen.has(where)) {
      throw new Error(`environment layers: ${NODE_TIER_LINKS} names ${JSON.stringify(entry)}, which is not a package of the environment`);
    }
    seen.add(where);
    return { path: where, name, version };
  });
}

/** Links each of East's packages a node environment left to the tier to the
 *  image's copy ({@link composeEnvironmentOverTier}). */
async function composeNodeOverTier(envDir: string, file: Stats, tier: NodeTier | undefined): Promise<void> {
  if (!file.isFile()) throw new Error(`environment layers: ${NODE_TIER_LINKS} is not a file`);
  if (tier === undefined) throw new Error('environment layers: the environment was built over a tier\'s Node, and the tier holds none');
  if (!path.posix.isAbsolute(tier.root) || tier.root.includes('\\')) {
    throw new Error(`environment layers: the tier's node_modules root '${tier.root}' is not an absolute path`);
  }
  const links = readNodeTierLinks(await fs.readFile(path.join(envDir, NODE_TIER_LINKS), 'utf-8'));
  // Every one the tier's before any is linked: a refusal leaves the environment as its layers made it
  for (const { name, version } of links) {
    if (!tier.packages.some((held) => held.name === name && held.version === version)) {
      throw new Error(`environment layers: the environment left ${name} ${version} to the tier, whose image does not hold it`);
    }
  }
  const real = new Set<string>();
  for (const link of links) {
    const at = path.join(envDir, ...link.path.split('/'));
    await realDirectory(envDir, path.dirname(at), real,
      (dir) => new Error(`environment layers: '${link.path}' is under '${path.relative(envDir, dir).split(path.sep).join('/')}', which is not a directory`));
    // What is at its path goes, a link itself and never what it names
    await fs.rm(at, { recursive: true, force: true });
    await fs.symlink(path.posix.join(tier.root, link.name), at);
  }
}
