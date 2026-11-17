/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What a rack's tier image says it contains: its tier manifest, which an
 * environment the rack runs over that image is built without.
 *
 * A runtime image writes its manifest when it is built
 * (this package's `tier/tier-manifest.py`): its interpreter, the base interpreter a
 * virtualenv over it runs, its site directory, the namespace packages of
 * that directory, and each distribution installed for it, by name, version
 * and the digest of the files it installed. A manifest is named by the
 * SHA-256 of its bytes.
 *
 * @packageDocumentation
 */

import { StringType, compareFor } from '@elaraai/east';
import { canonicalPythonName } from '@elaraai/e3';
import { computeHash } from './objects.js';

/** One distribution a tier holds. */
export interface TierDistribution {
  /** Its name, as PEP 503 writes one */
  readonly name: string;
  /** Its version, a local label included (`2.9.0+cu130`) */
  readonly version: string;
  /** The digest of the files it installed ({@link installedFilesDigest}) */
  readonly files: string;
}

/** What a tier image contains. */
export interface TierManifest {
  /** The manifest's form: 1 */
  readonly version: 1;
  /** The interpreter its tasks run with */
  readonly python: {
    /** Its version (`3.11.2`) */
    readonly version: string;
    /** Its path in the image, absolute */
    readonly executable: string;
    /** The interpreter a virtualenv over the tier runs, absolute: itself,
     *  or, when it is a virtualenv's, the one that virtualenv was made from */
    readonly base: string;
    /** The directory its distributions are installed in, absolute */
    readonly site: string;
  };
  /**
   * The namespace packages of its site directory: each directory at its top
   * that holds no `__init__` module, sorted. Python reads such a package
   * from every directory on its path that holds a part of it, so its parts
   * may be left to the tier singly ({@link leftToTier}).
   */
  readonly namespaces: readonly string[];
  /** The distributions installed for it, sorted by name */
  readonly distributions: readonly TierDistribution[];
}

/** What an installer writes beside a distribution's files, which says how it
 *  was installed and not what was. */
const BOOKKEEPING: readonly string[] = ['RECORD', 'INSTALLER', 'REQUESTED', 'direct_url.json'];

/** Orders strings by code point, as the image's script, which is python,
 *  orders them: JavaScript's `<` orders UTF-16 code units, which differs. */
const byCodePoint = compareFor(StringType);

/** The fields of one row of a RECORD, which is CSV: a field that holds a
 *  comma or a quote is quoted, a quote in it doubled. */
function recordRow(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quoted) {
      if (char !== '"') field += char;
      else if (line[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',') { fields.push(field); field = ''; }
    else field += char;
  }
  fields.push(field);
  return fields;
}

/**
 * The digest of the files a distribution installed, from its `RECORD`: each
 * file in the site directory, by its path, hash and size, sorted by path.
 *
 * @remarks
 * Two installs of a distribution that have this digest hold the same files.
 * Left out, since they say how a distribution was installed and not what
 * was: the installer's bookkeeping in its `.dist-info` (`RECORD`,
 * `INSTALLER`, `REQUESTED`, `direct_url.json`), compiled files, and what is
 * installed outside the site directory — a script, whose first line names the
 * interpreter it was installed for. The image's script computes the same
 * digest (`tier/tier-manifest.py`).
 *
 * @param record - The `RECORD` file's text
 * @returns `sha256:<hex>`
 * @example
 * const files = installedFilesDigest(await readFile(join(site, 'idna-3.20.dist-info', 'RECORD'), 'utf8'));
 */
export function installedFilesDigest(record: string): string {
  const rows = recordedSiteFiles(record).filter(({ file }) => {
    const parts = file.split('/');
    if (parts.length === 2 && parts[0]!.endsWith('.dist-info') && BOOKKEEPING.includes(parts[1]!)) return false;
    return !parts.includes('__pycache__') && !file.endsWith('.pyc');
  });
  // By code point, as the image's script sorts them
  rows.sort((a, b) => byCodePoint(a.file, b.file));
  const lines = rows.map(({ file, digest, size }) => `${file}\t${digest}\t${size}\n`).join('');
  return `sha256:${computeHash(new TextEncoder().encode(lines))}`;
}

/** One file a `RECORD` lists: its path from the site directory, and the hash
 *  and size the installer recorded for it, each as written. */
export interface RecordedFile {
  readonly file: string;
  readonly digest: string;
  readonly size: string;
}

/**
 * The files a `RECORD` lists in the site directory, as it writes them: every
 * row but those of what is installed outside it — a script, a header — whose
 * path leads up out of it.
 *
 * @param record - The `RECORD` file's text
 * @returns The files, in the record's order
 */
export function recordedSiteFiles(record: string): RecordedFile[] {
  const files: RecordedFile[] = [];
  for (const line of record.split(/\r?\n/)) {
    const fields = recordRow(line);
    if (fields.length < 3 || fields[0] === '' || fields[0]!.split('/')[0] === '..') continue;
    files.push({ file: fields[0]!, digest: fields[1]!, size: fields[2]! });
  }
  return files;
}

/**
 * A manifest's digest: the SHA-256 of its bytes, as its image wrote them.
 *
 * @param bytes - The manifest file's bytes
 * @returns `sha256:<hex>`
 */
export function tierManifestDigest(bytes: Uint8Array): string {
  return `sha256:${computeHash(bytes)}`;
}

/**
 * Reads a tier manifest.
 *
 * @remarks
 * It arrives from a rack, and what it names is written into an environment
 * built over the tier (its virtualenv's `pyvenv.cfg`, a path file of its site
 * directory): so its interpreter's version is a Python's, and its paths are
 * absolute, on one line each.
 *
 * @param bytes - The manifest file's bytes
 * @returns The manifest
 * @throws {Error} When it is not a manifest of the form this build reads
 * @example
 * const manifest = readTierManifest(await readFile('/opt/e3/tier-manifest.json'));
 */
export function readTierManifest(bytes: Uint8Array): TierManifest {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('the tier manifest is not JSON');
  }
  const fields = value as { version?: unknown; python?: Record<string, unknown>; namespaces?: unknown; distributions?: unknown } | null;
  if (typeof fields !== 'object' || fields === null || fields.version !== 1) {
    throw new Error('the tier manifest is not of the form this e3 reads (version 1)');
  }
  const python = fields.python;
  const text = (field: unknown, what: string): string => {
    if (typeof field !== 'string' || field === '') throw new Error(`the tier manifest names no ${what}`);
    return field;
  };
  // A Python's version, as `platform.python_version()` writes one: `3.11.2`, `3.13.0rc1`, `3.14.0a1+`
  const version = (field: unknown): string => {
    const said = text(field, 'interpreter version');
    if (!/^\d+\.\d+\.\d+[A-Za-z0-9.+]*$/.test(said)) throw new Error(`the tier manifest's interpreter version ${JSON.stringify(said)} is not a Python's`);
    return said;
  };
  // An absolute path of the image's, on one line
  const absolute = (field: unknown, what: string): string => {
    const said = text(field, what);
    if (!said.startsWith('/') || /[\u0000-\u001f\u007f]/.test(said)) throw new Error(`the tier manifest's ${what} ${JSON.stringify(said)} is not an absolute path`);
    return said;
  };
  if (typeof python !== 'object' || python === null) throw new Error('the tier manifest names no interpreter');
  // Each a directory's name: what a tier does not say of its packages is not guessed
  const namespaces: unknown = fields.namespaces;
  if (!Array.isArray(namespaces) || !namespaces.every((name: unknown): name is string => typeof name === 'string' && name !== '' && !/[/\\]/.test(name))) {
    throw new Error('the tier manifest names no namespace packages');
  }
  if (!Array.isArray(fields.distributions)) throw new Error('the tier manifest lists no distributions');
  return {
    version: 1,
    python: {
      version: version(python.version),
      executable: absolute(python.executable, 'interpreter'),
      base: absolute(python.base, 'base interpreter'),
      site: absolute(python.site, 'site directory'),
    },
    namespaces,
    distributions: fields.distributions.map((entry: unknown): TierDistribution => {
      const { name, version: held, files } = (entry ?? {}) as Record<string, unknown>;
      return { name: canonicalPythonName(text(name, 'distribution\'s name')), version: text(held, 'distribution\'s version'),
        files: text(files, 'distribution\'s files digest') };
    }),
  };
}

/**
 * Whether a tier holds a distribution: one of that name, that version, and
 * the same installed files. Never by name and version alone: a `+cpu` build
 * is not a `+cu130` one, and a rebuilt wheel is not the one before it.
 *
 * @param manifest - The tier's manifest
 * @param distribution - The distribution, as an environment installed it
 * @returns Whether the tier's is the same
 */
export function tierHolds(manifest: TierManifest, distribution: TierDistribution): boolean {
  const name = canonicalPythonName(distribution.name);
  return manifest.distributions.some((held) => held.name === name && held.version === distribution.version && held.files === distribution.files);
}

/** A distribution as an environment installed it. */
export interface InstalledDistribution {
  /** Its name, as its metadata spells it */
  readonly name: string;
  /** Its version */
  readonly version: string;
  /** Its `RECORD` file's text */
  readonly record: string;
}

/**
 * Which of an environment's installed distributions are left to the tier it
 * is built over: each the tier holds the same ({@link tierHolds}), unless it
 * shares a package with one the tier does not.
 *
 * @remarks
 * Python finds a package that has an `__init__` module in the first
 * directory on its path that holds it, and looks no further for the
 * package's modules. So distributions that install into one such package are
 * left to the tier together or not at all: were one left and another kept,
 * the environment's part of the package would hide the tier's.
 *
 * A namespace package, which has no `__init__` module, is read from every
 * directory that holds a part of it, so its parts may be in two places.
 * Distributions that share one are bound a level down: by the directory, or
 * the module, directly in it. A top-level package is taken for a namespace
 * package only when it is one on both sides: the tier's manifest names it
 * ({@link TierManifest.namespaces}), and no distribution here installs an
 * `__init__` module in it. The tier's word is needed because it may hold a
 * distribution this environment does not, whose `__init__` module would make
 * the package an ordinary one there, and hide the part shipped here.
 *
 * Distributions are grouped by what they share, and a group is left only
 * when the tier holds every distribution of it.
 *
 * @param installed - The environment's distributions
 * @param manifest - The tier's manifest
 * @returns The canonical names of those left to the tier
 * @example
 * const left = leftToTier(installed, manifest);
 * const shipped = installed.filter(({ name }) => !left.has(canonicalPythonName(name)));
 */
export function leftToTier(installed: readonly InstalledDistribution[], manifest: TierManifest): Set<string> {
  // Each distribution's files in the site directory, as path segments.
  // Left out: its own metadata, and compiled files, whose directory every
  // module beside it shares
  const files = installed.map((distribution) => recordedSiteFiles(distribution.record).map(({ file }) => file.split('/'))
    .filter((parts) => !parts[0]!.endsWith('.dist-info') && !parts.includes('__pycache__')));
  // A package some distribution here gives an `__init__` module is an ordinary one
  const ordinary = new Set<string>();
  for (const parts of files.flat()) if (parts.length === 2 && parts[1]!.startsWith('__init__.')) ordinary.add(parts[0]!);
  const namespaces = new Set(manifest.namespaces.filter((name) => !ordinary.has(name)));

  // Each distribution's group, by what it shares with others: a top-level
  // name, or, in a namespace package, what is directly in it
  const group = installed.map((_, i) => i);
  const find = (i: number): number => {
    while (group[i] !== i) i = group[i] = group[group[i]!]!;
    return i;
  };
  const owner = new Map<string, number>();
  for (const [i, paths] of files.entries()) {
    for (const parts of paths) {
      const shared = parts.length > 1 && namespaces.has(parts[0]!) ? `${parts[0]!}/${parts[1]!}` : parts[0]!;
      const first = owner.get(shared);
      if (first === undefined) owner.set(shared, i);
      else group[find(i)] = find(first);
    }
  }
  const held = installed.map((distribution) =>
    tierHolds(manifest, { name: distribution.name, version: distribution.version, files: installedFilesDigest(distribution.record) }));
  const whole = new Map<number, boolean>();
  for (const i of installed.keys()) whole.set(find(i), (whole.get(find(i)) ?? true) && held[i]!);
  return new Set(installed.filter((_, i) => whole.get(find(i)) === true).map(({ name }) => canonicalPythonName(name)));
}

/** A version's release numbers: `3.11.2` as `[3, 11, 2]`, what follows them
 *  (`rc1`, `+local`) left out; `null` for what begins with none. */
function releaseOf(version: string): number[] | null {
  const release = /^\s*v?(\d+(?:\.\d+)*)/.exec(version)?.[1];
  return release === undefined ? null : release.split('.').map(Number);
}

/** Orders two Python releases, the shorter read as ending in zeros (PEP 440). */
function comparePythonReleases(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const order = (a[i] ?? 0) - (b[i] ?? 0);
    if (order !== 0) return order;
  }
  return 0;
}

/**
 * Whether a Python's version meets a `requires-python` specifier, as PEP 440
 * writes one: clauses joined by commas, each an operator (`>=`, `<=`, `>`,
 * `<`, `==`, `!=`, `~=`) and a version, which `==` and `!=` may end in `.*`.
 *
 * @remarks
 * A final release's numbers are compared, which is what an image's Python
 * is. A clause this does not read — another operator, a version with no
 * number — is not met: an environment is then built whole, which is always
 * right.
 *
 * @param version - The Python's version, as `3.11.2`
 * @param specifier - The specifier, as `>=3.11,<3.14`
 * @returns Whether the version meets every clause
 * @example
 * pythonSatisfies('3.11.2', '>=3.11'); // true
 * pythonSatisfies('3.11.2', '>=3.12'); // false
 */
export function pythonSatisfies(version: string, specifier: string): boolean {
  const python = releaseOf(version);
  if (python === null) return false;
  return specifier.split(',').map((clause) => clause.trim()).filter((clause) => clause !== '').every((clause) => {
    const match = /^(>=|<=|==|!=|~=|>|<)\s*(\d+(?:\.\d+)*)(\.\*)?$/.exec(clause);
    if (match === null) return false;
    const [, operator, text, wildcard] = match as unknown as [string, string, string, string | undefined];
    const wanted = text.split('.').map(Number);
    const order = comparePythonReleases(python, wanted);
    // The release begins with the numbers given
    const begins = (numbers: readonly number[]): boolean => numbers.every((number, i) => (python[i] ?? 0) === number);
    switch (operator) {
      case '>=': return wildcard === undefined && order >= 0;
      case '<=': return wildcard === undefined && order <= 0;
      case '>': return wildcard === undefined && order > 0;
      case '<': return wildcard === undefined && order < 0;
      case '==': return wildcard === undefined ? order === 0 : begins(wanted);
      case '!=': return wildcard === undefined ? order !== 0 : !begins(wanted);
      // Compatible: at least the version, within the release above its last number
      case '~=': return wildcard === undefined && wanted.length >= 2 && order >= 0 && begins(wanted.slice(0, -1));
      default: return false;
    }
  });
}

/**
 * A Python's minor release, as its virtualenvs and its site directory name
 * it: `3.11` of `3.11.2`.
 *
 * @param version - The Python's version
 * @returns The minor release
 * @throws {Error} When the version names none
 */
export function pythonMinor(version: string): string {
  const release = releaseOf(version);
  if (release === null || release.length < 2) throw new Error(`'${version}' names no Python minor release`);
  return `${release[0]!}.${release[1]!}`;
}
