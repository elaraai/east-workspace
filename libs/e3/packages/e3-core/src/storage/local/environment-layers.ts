/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A local repository's kept environment layers: an environment installed for
 * a platform that is not this machine's (`materializeEnvironmentFor`), packed
 * as the layers a rack composes it from, and kept beside the repository so a
 * run that needs it again builds nothing.
 *
 * ```
 * <repo>/rack/env-layers/
 *   blobs/sha256-<hex>     each layer once: a gzip tar, named by its SHA-256
 *   manifests/<name>.json  what names an environment's layers, for one
 *                          platform and e3 release; its name begins with the
 *                          environment's hash
 *   building/              a build's claim, and its scratch tree
 * ```
 *
 * A layer is a gzip tar of part of the installed tree, its entries under
 * {@link ENVIRONMENT_LAYER_ROOT}, where a guest finds a composed environment:
 *
 * | Layer | Holds | Changes when |
 * |---|---|---|
 * | interpreter | the interpreter the environment carries | its Python or the platform changes |
 * | packages, one per gigabyte | what the lock installs, in sorted order | the lock changes |
 * | project | what the project's own packages installed | the project's code changes |
 *
 * The same files pack to the same bytes on one machine: entries are sorted,
 * times and owners are zeroed, modes are one of two, and the gzip setting is
 * one. So an environment whose lock did not change shares its interpreter and
 * package layers with the one before it, and only its project layer is new.
 *
 * Entries are plain: files, directories, and links that stay inside the
 * tree. A link that is absolute or leaves the tree refuses the pack, and an
 * entry that is neither, or names a path outside the tree, refuses the
 * unpack.
 *
 * What is in a manifest is its writer's: this module keeps it by name, and
 * reads of it only the layers it names, which gc keeps.
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { extract as tarExtract, pack as tarPack, type Pack } from 'tar-stream';
import type { StorageBackend } from '../interfaces.js';
import { withKeyedLock } from '../../keyed-mutex.js';
import { isObjectHash } from '../../objects.js';
import { materializeEnvironmentFor, type EnvironmentTarget, type TargetEnvironment } from '../../execution/environment.js';
import { getPidStartTime, processExited } from '../../execution/processHelpers.js';
import type { ProcessSettings } from '../../execution/processExec.js';
import { atomicWriteFile, renameWithRetry } from './localHelpers.js';

/**
 * Where a guest finds a composed environment, relative to its root: every
 * entry of every layer is under it.
 */
export const ENVIRONMENT_LAYER_ROOT = 'var/task/.e3-env';

/** The most bytes of files one package layer holds, unless one file is more. */
export const ENVIRONMENT_PACKAGE_LAYER_BYTES = 1024 ** 3;

/** The one gzip setting every layer is packed with. */
const GZIP_LEVEL = 6;

/** How often a build that waits for another's looks again, in ms. */
const BUILD_WAIT_MS = 500;

/** One kept layer of an environment. */
export interface EnvironmentLayer {
  /** `sha256:<hex>`: the SHA-256 of the layer's bytes */
  readonly digest: string;
  /** The layer's size, in bytes */
  readonly sizeBytes: number;
}

/** An environment's layers, as a pack kept them. */
export interface PackedEnvironment {
  /** The layers, in the order they are applied: the interpreter, the
   *  packages, the project */
  readonly layers: readonly EnvironmentLayer[];
  /** How many of them the repository did not hold already */
  readonly fresh: number;
}

/** What a build of an environment's layers came to. */
export interface EnvironmentLayerBuild extends PackedEnvironment {
  /** How long the install and the pack took, in ms */
  readonly ms: number;
}

/** How an environment's layers are built. */
export interface BuildEnvironmentLayersOptions {
  /** How the installs run: their environment, user and group. Absent, this
   *  process's own. */
  readonly settings?: ProcessSettings;
  /** Told the build starts: no manifest names the layers yet, and no other
   *  build is making them. */
  readonly onBuilding?: () => void;
  /** Ends a wait for another build. */
  readonly signal?: AbortSignal;
}

/**
 * The directory a repository keeps its environment layers in.
 *
 * @param repo - Repository path
 * @returns The directory, absolute
 */
export function environmentLayersDir(repo: string): string {
  return path.resolve(repo, 'rack', 'env-layers');
}

/**
 * The file a repository keeps a layer in.
 *
 * @param repo - Repository path
 * @param digest - The layer's digest, `sha256:<hex>`
 * @returns The file's path, absolute
 * @throws {Error} When the digest is not a SHA-256's
 *
 * @example
 * ```ts
 * const { size } = await stat(environmentLayerPath(repo, layer.digest));
 * ```
 */
export function environmentLayerPath(repo: string, digest: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`'${digest}' is not a layer's digest`);
  return path.join(environmentLayersDir(repo), 'blobs', digest.replace(':', '-'));
}

/** A manifest's name: an environment's hash, and what else its writer keys it by. */
const MANIFEST_NAME = /^([0-9a-f]{64})-[A-Za-z0-9][A-Za-z0-9._+-]*\.json$/;

/** The file a repository keeps a manifest in, by its name. */
function manifestPath(repo: string, name: string): string {
  if (!MANIFEST_NAME.test(name)) throw new Error(`'${name}' is not an environment manifest's name`);
  return path.join(environmentLayersDir(repo), 'manifests', name);
}

/**
 * Reads a manifest a repository keeps.
 *
 * @param repo - Repository path
 * @param name - The manifest's name: `<environment hash>-<key>.json`
 * @returns What its writer stored, or null when the repository keeps none by
 *   the name
 * @throws {Error} When the name is not a manifest's
 *
 * @example
 * ```ts
 * const manifest = await readEnvironmentManifest(repo, `${envHash}-1.0.108-x86_64-manylinux_2_28.json`);
 * ```
 */
export async function readEnvironmentManifest(repo: string, name: string): Promise<string | null> {
  try {
    return await fs.readFile(manifestPath(repo, name), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** One thing in an installed tree. */
interface TreeEntry {
  /** Its path, relative to the tree, with `/` between segments */
  readonly rel: string;
  readonly type: 'file' | 'directory' | 'symlink';
  /** A file's size */
  readonly size: number;
  /** Whether a file may be run */
  readonly executable: boolean;
  /** What a link names */
  readonly linkname: string;
}

/** Every file, directory and link under `root`, in no order. */
async function treeOf(root: string, dir: string = root, into: TreeEntry[] = []): Promise<TreeEntry[]> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      into.push({ rel, type: 'directory', size: 0, executable: false, linkname: '' });
      await treeOf(root, full, into);
    } else if (entry.isSymbolicLink()) {
      const linkname = (await fs.readlink(full)).split(path.sep).join('/');
      // A link is plain when what it names is in the tree, wherever the tree
      // is put.
      const named = path.posix.normalize(path.posix.join(path.posix.dirname(rel), linkname));
      if (path.isAbsolute(linkname) || /^[a-zA-Z]:/.test(linkname) || named === '..' || named.startsWith('../')) {
        throw new Error(`environment layers: the link '${rel}' names '${linkname}', outside its tree`);
      }
      into.push({ rel, type: 'symlink', size: 0, executable: false, linkname });
    } else if (entry.isFile()) {
      const stat = await fs.lstat(full);
      into.push({ rel, type: 'file', size: stat.size, executable: (stat.mode & 0o111) !== 0, linkname: '' });
    } else {
      throw new Error(`environment layers: '${rel}' is not a file, a directory or a link`);
    }
  }
  return into;
}

/** Orders paths as their code units compare, whatever the locale. */
const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The directories above a path, the nearest last. */
function ancestors(rel: string): string[] {
  const segments = rel.split('/');
  return segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join('/'));
}

/**
 * Splits a tree into its layers: the interpreter, the packages a gigabyte at
 * a time, and the project's own files. A layer holds the directories above
 * each of its entries, so it unpacks alone, and a directory is in no layer
 * for itself unless it is empty: a directory the project's code adds changes
 * the project's layer alone.
 */
function layersOf(tree: Pick<TargetEnvironment, 'interpreter' | 'project'>, entries: readonly TreeEntry[], packageLayerBytes: number): TreeEntry[][] {
  const project = new Set(tree.project);
  const interpreter: TreeEntry[] = [];
  const packages: TreeEntry[] = [];
  const own: TreeEntry[] = [];
  const directories = new Map<string, TreeEntry>();
  const holding = new Set(entries.flatMap((entry) => ancestors(entry.rel)));
  for (const entry of [...entries].sort((a, b) => byPath(a.rel, b.rel))) {
    if (entry.type === 'directory') {
      directories.set(entry.rel, entry);
      if (holding.has(entry.rel)) continue;
    }
    if (tree.interpreter !== null && (entry.rel === tree.interpreter || entry.rel.startsWith(`${tree.interpreter}/`))) interpreter.push(entry);
    else if (entry.type !== 'directory' && project.has(entry.rel)) own.push(entry);
    else packages.push(entry);
  }
  const chunks: TreeEntry[][] = [];
  let chunk: TreeEntry[] = [];
  let bytes = 0;
  for (const entry of packages) {
    if (chunk.length > 0 && bytes + entry.size > packageLayerBytes) {
      chunks.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push(entry);
    bytes += entry.size;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return [interpreter, ...chunks, own].filter((layer) => layer.length > 0).map((layer) => {
    const all = new Map(layer.map((entry) => [entry.rel, entry]));
    for (const entry of layer) {
      for (const above of ancestors(entry.rel)) {
        if (!all.has(above)) all.set(above, directories.get(above) ?? { rel: above, type: 'directory', size: 0, executable: false, linkname: '' });
      }
    }
    return [...all.values()].sort((a, b) => byPath(a.rel, b.rel));
  });
}

/** Adds one entry to a layer's tar, a file's bytes as they are read. */
function addEntry(tar: Pack, root: string, name: string, entry: TreeEntry): Promise<void> {
  // Nothing of this machine or of when the tree was made: the same files
  // pack to the same bytes.
  const header = { name, mtime: new Date(0), uid: 0, gid: 0, uname: '', gname: '' };
  return new Promise((resolve, reject) => {
    const done = (err?: Error | null): void => { if (err) reject(err); else resolve(); };
    if (entry.type === 'directory') tar.entry({ ...header, type: 'directory', mode: 0o755 }, done);
    else if (entry.type === 'symlink') tar.entry({ ...header, type: 'symlink', mode: 0o777, linkname: entry.linkname }, done);
    else {
      const sink = tar.entry({ ...header, type: 'file', mode: entry.executable ? 0o755 : 0o644, size: entry.size }, done);
      createReadStream(path.join(root, ...entry.rel.split('/'))).on('error', reject).pipe(sink);
    }
  });
}

/** Packs one layer and keeps it under its digest. */
async function keepLayer(repo: string, root: string, entries: readonly TreeEntry[]): Promise<{ layer: EnvironmentLayer; fresh: boolean }> {
  const blobs = path.join(environmentLayersDir(repo), 'blobs');
  await fs.mkdir(blobs, { recursive: true });
  const staging = path.join(blobs, `${randomUUID()}.partial`);
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      sizeBytes += chunk.length;
      callback(null, chunk);
    },
  });
  const tar = tarPack();
  const written = pipeline(tar, createGzip({ level: GZIP_LEVEL }), meter, createWriteStream(staging, { mode: 0o600 }));
  try {
    // The directories a guest's root holds above the environment, then the
    // layer's own entries under it.
    for (const above of [...ancestors(`${ENVIRONMENT_LAYER_ROOT}/x`)]) {
      await addEntry(tar, root, above, { rel: above, type: 'directory', size: 0, executable: false, linkname: '' });
    }
    for (const entry of entries) await addEntry(tar, root, `${ENVIRONMENT_LAYER_ROOT}/${entry.rel}`, entry);
    tar.finalize();
    await written;
  } catch (err) {
    tar.destroy();
    await written.catch(() => { /* the failure above is the one that is told */ });
    await fs.rm(staging, { force: true });
    throw err;
  }
  const layer = { digest: `sha256:${hash.digest('hex')}`, sizeBytes };
  const kept = environmentLayerPath(repo, layer.digest);
  try {
    await fs.access(kept);
    await fs.rm(staging, { force: true });
    return { layer, fresh: false };
  } catch {
    await renameWithRetry(staging, kept);
    return { layer, fresh: true };
  }
}

/**
 * Packs an environment installed for another platform as its layers, and
 * keeps each in the repository under its digest.
 *
 * @remarks
 * A layer the repository holds already is not written again: an environment
 * whose lock did not change shares its interpreter and package layers with
 * the one before it.
 *
 * @param repo - Repository path
 * @param tree - The installed environment, as `materializeEnvironmentFor`
 *   answers it
 * @param packageLayerBytes - The most bytes of files one package layer holds,
 *   unless one file is more: {@link ENVIRONMENT_PACKAGE_LAYER_BYTES} unless
 *   given
 * @returns The layers, in the order they are applied, and how many are new
 * @throws {Error} When the tree holds a link that names a path outside it, or
 *   something that is not a file, a directory or a link
 *
 * @example
 * ```ts
 * const tree = await materializeEnvironmentFor(storage, repo, envHash, { platform }, scratch);
 * const { layers, fresh } = await packEnvironmentLayers(repo, tree);
 * ```
 */
export async function packEnvironmentLayers(
  repo: string, tree: TargetEnvironment, packageLayerBytes: number = ENVIRONMENT_PACKAGE_LAYER_BYTES,
): Promise<PackedEnvironment> {
  if (!Number.isSafeInteger(packageLayerBytes) || packageLayerBytes < 1) throw new RangeError('A package layer holds at least a byte');
  const layers: EnvironmentLayer[] = [];
  let fresh = 0;
  for (const entries of layersOf(tree, await treeOf(tree.dir), packageLayerBytes)) {
    const kept = await keepLayer(repo, tree.dir, entries);
    layers.push(kept.layer);
    if (kept.fresh) fresh++;
  }
  return { layers, fresh };
}

/** A build's claim: who makes a manifest's layers, in a file made exclusively. */
async function claimBuild(claim: string, signal: AbortSignal | undefined, made: () => Promise<boolean>): Promise<boolean> {
  await fs.mkdir(path.dirname(claim), { recursive: true });
  for (;;) {
    if (signal?.aborted) throw new Error('environment layers: the wait for another build was stopped');
    try {
      const file = await fs.open(claim, 'wx', 0o600);
      try {
        await file.writeFile(`${process.pid} ${await getPidStartTime(process.pid)}\n`);
      } finally {
        await file.close();
      }
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    // Another build holds it: while its process lives, its layers are waited
    // for; one that died left a claim no build holds.
    const holder = /^(\d+) (\d+)\n$/.exec(await fs.readFile(claim, 'utf8').catch(() => ''));
    if (holder !== null && await processExited(Number(holder[1]), Number(holder[2]))) {
      await fs.rm(claim, { force: true });
      continue;
    }
    if (await made()) return false;
    await delay(BUILD_WAIT_MS, undefined, { signal }).catch(() => { /* the loop's own check tells the stop */ });
  }
}

/**
 * Makes sure a repository keeps an environment's layers for a platform:
 * installs the environment for it, packs it, and keeps a manifest that names
 * the layers; or does nothing when a manifest by the name is kept already.
 *
 * @remarks
 * One build runs at a time for a manifest, in a repository: a second caller
 * that needs it, in this process or another, waits for the first and is
 * answered what it kept. The tree is installed in a scratch directory under
 * the layers' own and is not kept: what is kept is its layers. A build that
 * fails or is refused keeps no manifest, and removes its scratch.
 *
 * @param storage - Storage backend holding the environment's spec and files
 * @param repo - Repository path
 * @param envHash - Object hash of the environment's spec
 * @param target - The platform to install for
 * @param name - The manifest's name: `<envHash>-<key>.json`
 * @param manifestOf - What to keep as the manifest, given the layers
 * @param options - How the installs run, and who is told the build starts
 * @returns The manifest kept, and what the build came to, or null when the
 *   repository kept the manifest already
 * @throws {EnvironmentTargetRefused} For an environment no install makes for
 *   another platform, with its reason
 * @throws {Error} For a name that is not the environment's, a failed install,
 *   and a tree that cannot be packed
 *
 * @example
 * ```ts
 * const { manifest, built } = await buildEnvironmentLayers(storage, repo, envHash, { platform }, `${envHash}-${platform}.json`,
 *   (layers) => JSON.stringify({ envHash, layers }));
 * if (built !== null) console.log(`built in ${built.ms} ms: ${built.layers.length} layers (${built.fresh} new)`);
 * ```
 */
export async function buildEnvironmentLayers(
  storage: StorageBackend,
  repo: string,
  envHash: string,
  target: EnvironmentTarget,
  name: string,
  manifestOf: (layers: readonly EnvironmentLayer[]) => string,
  options: BuildEnvironmentLayersOptions = {},
): Promise<{ manifest: string; built: EnvironmentLayerBuild | null }> {
  if (!isObjectHash(envHash) || MANIFEST_NAME.exec(name)?.[1] !== envHash) {
    throw new Error(`'${name}' is not a manifest's name for the environment ${envHash}`);
  }
  const kept = await readEnvironmentManifest(repo, name);
  if (kept !== null) return { manifest: kept, built: null };
  const building = path.join(environmentLayersDir(repo), 'building');
  const claim = path.join(building, `${name}.claim`);
  return withKeyedLock(`env-layers:${manifestPath(repo, name)}`, async () => {
    const made = async (): Promise<boolean> => await readEnvironmentManifest(repo, name) !== null;
    if (!await claimBuild(claim, options.signal, made)) return { manifest: (await readEnvironmentManifest(repo, name))!, built: null };
    // Named after this process, so gc removes it once the process is gone.
    const scratch = path.join(building, `${name}.tree-${process.pid}-${await getPidStartTime(process.pid)}`);
    try {
      const again = await readEnvironmentManifest(repo, name);
      if (again !== null) return { manifest: again, built: null };
      options.onBuilding?.();
      const started = Date.now();
      await fs.rm(scratch, { recursive: true, force: true });
      const tree = await materializeEnvironmentFor(storage, repo, envHash, target, scratch, options.settings);
      const packed = await packEnvironmentLayers(repo, tree);
      const manifest = manifestOf(packed.layers);
      // The layers, then the manifest that names them.
      await atomicWriteFile(manifestPath(repo, name), manifest);
      return { manifest, built: { ...packed, ms: Date.now() - started } };
    } finally {
      await fs.rm(scratch, { recursive: true, force: true });
      await fs.rm(claim, { force: true });
    }
  });
}

/**
 * Unpacks one layer under a root, as a rack's guest finds it there: the
 * environment is then at {@link ENVIRONMENT_LAYER_ROOT} under the root.
 *
 * @remarks
 * A layer is what another machine sent, so each entry is checked: its name is
 * relative, has no `.`, `..` or empty segment, and is the environment's
 * directory, one above it, or under it; it is a file, a directory, or a link
 * that names a path in the environment. Anything else refuses the layer.
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
  const above = new Set(ancestors(`${ENVIRONMENT_LAYER_ROOT}/x`));
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
        await fs.mkdir(dest, { recursive: true });
        stream.resume();
      } else if (header.type === 'symlink' && inTree) {
        const linkname = header.linkname ?? '';
        const named = path.posix.normalize(path.posix.join(path.posix.dirname(name), linkname));
        if (linkname === '' || linkname.startsWith('/') || !(named === ENVIRONMENT_LAYER_ROOT || named.startsWith(`${ENVIRONMENT_LAYER_ROOT}/`))) {
          throw new Error(`environment layers: the link '${header.name}' names '${linkname}', outside the environment`);
        }
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.rm(dest, { recursive: true, force: true });
        await fs.symlink(linkname, dest);
        stream.resume();
      } else if (header.type === 'file' && inTree) {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await pipeline(stream, createWriteStream(dest, { mode: ((header.mode ?? 0) & 0o111) !== 0 ? 0o755 : 0o644 }));
      } else {
        throw new Error(`environment layers: the entry '${header.name}' is a ${header.type ?? 'thing'} no layer holds`);
      }
    })().then(() => next(), (err: unknown) => extract.destroy(err instanceof Error ? err : new Error(String(err))));
  });
  await pipeline(layer, createGunzip(), extract);
}

/**
 * Removes from a repository's kept environment layers what nothing needs: each
 * manifest whose environment spec gc's mark no longer reached, each layer no
 * kept manifest names, and what a build whose builder died left.
 *
 * @remarks
 * While a build runs, its layers are kept before its manifest names them: no
 * layer is removed then.
 *
 * @param repo - Repository path
 * @param reachable - The objects the mark reached
 * @returns How many manifests, layers and builds' leavings were removed
 */
export async function sweepEnvironmentLayers(repo: string, reachable: ReadonlySet<string>): Promise<number> {
  const dir = environmentLayersDir(repo);
  let removed = 0;
  const remove = async (file: string): Promise<void> => {
    try {
      await fs.rm(file, { recursive: true, force: true });
      removed++;
    } catch {
      // Left for the next sweep
    }
  };
  const list = (sub: string): Promise<string[]> => fs.readdir(path.join(dir, sub)).catch(() => [] as string[]);

  // A build's claim and scratch tree, once its builder is gone
  let building = false;
  const claims = await list('building');
  for (const entry of claims) {
    const file = path.join(dir, 'building', entry);
    const tree = /\.tree-(\d+)-(\d+)$/.exec(entry);
    const holder = tree ?? (entry.endsWith('.claim') ? /^(\d+) (\d+)\n$/.exec(await fs.readFile(file, 'utf8').catch(() => '')) : null);
    if (holder !== null && !await processExited(Number(holder[1]), Number(holder[2]))) building = true;
    else await remove(file);
  }

  // The manifests of environments the mark no longer reached, and what the
  // kept ones name
  const named = new Set<string>();
  for (const entry of await list('manifests')) {
    const file = path.join(dir, 'manifests', entry);
    const envHash = MANIFEST_NAME.exec(entry)?.[1];
    let layers: unknown;
    try {
      layers = (JSON.parse(await fs.readFile(file, 'utf8')) as { layers?: unknown }).layers;
    } catch {
      layers = undefined;
    }
    if (envHash === undefined || !reachable.has(envHash) || !Array.isArray(layers)) {
      // A staging file of a write in flight is the object sweep's kind: left
      // to the next sweep, when it is old.
      if (!entry.endsWith('.partial')) await remove(file);
      continue;
    }
    for (const layer of layers as Array<{ digest?: unknown }>) {
      if (typeof layer?.digest === 'string') named.add(layer.digest.replace(':', '-'));
    }
  }

  if (!building) {
    for (const entry of await list('blobs')) {
      if (!named.has(entry)) await remove(path.join(dir, 'blobs', entry));
    }
  }
  return removed;
}
