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
import { createWriteStream, promises as fs } from 'node:fs';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { extract as tarExtract } from 'tar-stream';

/**
 * Where a guest finds a composed environment, relative to its root: every
 * entry of every layer is under it.
 */
export const ENVIRONMENT_LAYER_ROOT = 'var/task/.e3-env';

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
  const realDirectory = async (dir: string, entry: string): Promise<void> => {
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
      if (!stat.isDirectory()) throw new Error(`environment layers: the entry '${entry}' is at or under '${shown(at)}', which is not a directory`);
      real.add(at);
    }
  };
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
        await realDirectory(dest, header.name);
        stream.resume();
      } else if (header.type === 'symlink' && inTree) {
        const linkname = header.linkname ?? '';
        if (!environmentLinkInside(name.slice(ENVIRONMENT_LAYER_ROOT.length + 1), linkname)) {
          throw new Error(`environment layers: the link '${header.name}' names '${linkname}', outside the environment or not as a layer writes one`);
        }
        await realDirectory(path.dirname(dest), header.name);
        await clear(dest, header.name, true);
        await fs.symlink(linkname, dest);
        stream.resume();
      } else if (header.type === 'file' && inTree) {
        await realDirectory(path.dirname(dest), header.name);
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
