/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The export cache of python workspace members' function manifests (#1459).
 *
 * A manifest is a function of what the member's code can come from — its
 * sources, those of the local packages it depends on, and the workspace's
 * lockfile and root manifest — of the east-py that exports it, and of what
 * the export asks for: the module, the name and version it records, the
 * platform packages (`-p`) and the functions (`--only`). The cache keeps each
 * manifest under that key, beside the project, so a redeploy whose python has
 * not changed runs no export. A package keeps its newest source state only:
 * writing a new one removes the rest. Deleting the directory clears it.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, type Hash } from 'node:crypto';
import { decodeFunctionManifest, type FunctionManifest } from '@elaraai/east';

/** Changed when what a key covers changes, so that no older entry is read. */
const CACHE_FORMAT = 'e3-functions-1';

/** Directories that hold no sources: build output, and the environments and caches tools keep. */
const NOT_SOURCES = new Set(['node_modules', '__pycache__', 'build', 'dist']);

/** Adds one length-prefixed field to a hash, so no two sequences of fields hash alike. */
function field(hash: Hash, value: string | Uint8Array): void {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf-8') : value;
  hash.update(`${bytes.byteLength}:`);
  hash.update(bytes);
}

/**
 * Adds the files under `dir` to a hash: each one's path relative to `dir` and
 * its bytes, in path order. Dot-directories, build output and compiled python
 * are skipped; a link is followed, once.
 */
function hashTree(hash: Hash, dir: string, rel: string, seen: Set<string>): void {
  const here = rel === '' ? dir : path.join(dir, rel);
  let real: string;
  try {
    real = fs.realpathSync(here);
  } catch {
    return;
  }
  if (seen.has(real)) return;
  seen.add(real);
  for (const name of fs.readdirSync(here).sort()) {
    const child = rel === '' ? name : `${rel}/${name}`;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(path.join(dir, child));
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (name.startsWith('.') || NOT_SOURCES.has(name) || name.endsWith('.egg-info')) continue;
      hashTree(hash, dir, child, seen);
    } else if (stat.isFile() && !name.endsWith('.pyc')) {
      field(hash, child);
      field(hash, fs.readFileSync(path.join(dir, child)));
    }
  }
}

/** What a python member's export runs over, besides what each manifest asks for. */
export interface ExportSource {
  /** The workspace root, whose `uv.lock` and `pyproject.toml` pin what is not local. */
  root: string;
  /** The directories of the member and of the local packages it depends on. */
  dirs: string[];
  /** What the export is run with: the module, the name and version recorded, the east-py, its version, `PYTHONPATH`. */
  args: string[];
}

/**
 * The key of a member's source state: its export's arguments, the
 * workspace's lockfile and root manifest, and every source file of the
 * member and of the local packages it depends on.
 *
 * @param source - What the export runs over
 * @returns A hex digest
 */
export function sourceKey(source: ExportSource): string {
  const hash = createHash('sha256');
  field(hash, CACHE_FORMAT);
  for (const arg of source.args) field(hash, arg);
  for (const file of ['uv.lock', 'pyproject.toml']) {
    field(hash, file);
    let bytes: Uint8Array;
    try {
      bytes = fs.readFileSync(path.join(source.root, file));
    } catch {
      bytes = new Uint8Array(0);
    }
    field(hash, bytes);
  }
  for (const dir of source.dirs) {
    field(hash, dir);
    hashTree(hash, dir, '', new Set());
  }
  return hash.digest('hex');
}

/** The key of what one manifest asks for: its platform packages and its functions. */
function entryKey(providers: string[], only: string[]): string {
  const hash = createHash('sha256');
  field(hash, String(providers.length));
  for (const provider of providers) field(hash, provider);
  for (const name of only) field(hash, name);
  return hash.digest('hex');
}

/** One manifest a member's export wrote, as the cache keeps it. */
export interface CachedManifest {
  /** The platform packages it was exported with (`-p`). */
  providers: string[];
  /** The functions it exports (`--only`). */
  only: string[];
  /** Its bytes, as the exporter wrote them. */
  bytes: Uint8Array;
}

/**
 * Function manifests kept by package, source state and what each asks for:
 * `<dir>/<package>/<source key>/<entry key>.beast2`.
 *
 * Reads and writes never fail an export: an entry that cannot be read or
 * decoded is a miss, and a write that fails leaves the cache as it was.
 */
export class ManifestCache {
  /**
   * @param dir - Where the cache lives
   */
  constructor(private readonly dir: string) {}

  private packageDir(pkg: string): string {
    return path.join(this.dir, pkg.replace(/[^\w.-]+/g, '_'));
  }

  private file(pkg: string, key: string, providers: string[], only: string[]): string {
    return path.join(this.packageDir(pkg), key, `${entryKey(providers, only)}.beast2`);
  }

  /**
   * The manifest kept for a package's source state and what it asks for.
   *
   * @returns The decoded manifest, or null when none is kept or it does not decode
   */
  read(pkg: string, key: string, providers: string[], only: string[]): FunctionManifest | null {
    try {
      return decodeFunctionManifest(new Uint8Array(fs.readFileSync(this.file(pkg, key, providers, only))));
    } catch {
      return null;
    }
  }

  /**
   * Keeps manifests a package's export wrote for a source state, and removes
   * the package's other source states.
   */
  write(pkg: string, key: string, manifests: CachedManifest[]): void {
    try {
      fs.mkdirSync(path.join(this.packageDir(pkg), key), { recursive: true });
      for (const manifest of manifests) {
        const target = this.file(pkg, key, manifest.providers, manifest.only);
        const partial = `${target}.${process.pid}.partial`;
        fs.writeFileSync(partial, manifest.bytes);
        fs.renameSync(partial, target);
      }
      for (const state of fs.readdirSync(this.packageDir(pkg))) {
        if (state !== key) fs.rmSync(path.join(this.packageDir(pkg), state), { recursive: true, force: true });
      }
    } catch {
      // The cache saves time and nothing else: an export never fails for it.
    }
  }
}
