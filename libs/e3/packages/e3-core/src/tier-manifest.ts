/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What a rack's tier image says it contains: its tier manifest, which an
 * environment the rack runs over that image is built without.
 *
 * A runtime image writes its manifest when it is built, by a script of this
 * package's `tier/`. A python image's (`tier-manifest.py`) names its
 * interpreter, the base interpreter a virtualenv over it runs, its site
 * directory, the namespace packages of that directory, and each distribution
 * installed for it, by name, version and the digest of the files it
 * installed: the manifest's form 1. A node image's (`tier-manifest.mjs`)
 * names its Node, the global `node_modules` directory, the registry its
 * packages were installed from, and each of East's packages installed there,
 * by name and version: form 2, whose `python` and `node` sections are each
 * the image's when it holds that runtime. A manifest is named by the SHA-256
 * of its bytes.
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

/** What a tier image holds of Python: the interpreter its tasks run with,
 *  and what is installed for it. */
export interface PythonTier {
  /** The interpreter's version (`3.11.2`) */
  readonly version: string;
  /** Its path in the image, absolute */
  readonly executable: string;
  /** The interpreter a virtualenv over the tier runs, absolute: itself,
   *  or, when it is a virtualenv's, the one that virtualenv was made from */
  readonly base: string;
  /** The directory its distributions are installed in, absolute */
  readonly site: string;
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

/** One of East's packages a node tier holds. */
export interface TierPackage {
  /** Its name (`@elaraai/east-node-io`) */
  readonly name: string;
  /** Its version, as the registry serves it */
  readonly version: string;
}

/** What a tier image holds of Node: East's packages, installed globally. */
export interface NodeTier {
  /** Node's version (`22.12.0`) */
  readonly version: string;
  /** The global `node_modules` directory the packages are installed in,
   *  absolute: each is `<root>/<name>` */
  readonly root: string;
  /** The registry they were installed from, as npm names it, ending in `/`:
   *  `https://registry.npmjs.org/` */
  readonly registry: string;
  /** Each `@elaraai/*` package installed there, sorted by name */
  readonly packages: readonly TierPackage[];
}

/** What a tier image contains: each runtime it holds for environments to be
 *  built over. */
export interface TierManifest {
  /** Its Python, for an image that holds one */
  readonly python?: PythonTier;
  /** Its Node, for an image that holds East's node packages */
  readonly node?: NodeTier;
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
 * @example
 * const files = recordedSiteFiles('six.py,sha256=AbC,34549\n../../bin/six,sha256=DeF,207\n');
 * // [{ file: 'six.py', digest: 'sha256=AbC', size: '34549' }]
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
 * @example
 * const digest = tierManifestDigest(await readFile('/opt/e3/tier-manifest.json')); // 'sha256:3f9a…'
 */
export function tierManifestDigest(bytes: Uint8Array): string {
  return `sha256:${computeHash(bytes)}`;
}

/** A field of a manifest that names something: a string that is not empty. */
function named(field: unknown, what: string): string {
  if (typeof field !== 'string' || field === '') throw new Error(`the tier manifest names no ${what}`);
  return field;
}

/** An absolute path of the image's, on one line. */
function absolutePath(field: unknown, what: string): string {
  const said = named(field, what);
  if (!said.startsWith('/') || /[\u0000-\u001f\u007f]/.test(said)) throw new Error(`the tier manifest's ${what} ${JSON.stringify(said)} is not an absolute path`);
  return said;
}

/** A manifest's python section: its interpreter, its namespace packages and its distributions. */
function readPythonTier(section: Record<string, unknown>): PythonTier {
  // A Python's version, as `platform.python_version()` writes one: `3.11.2`, `3.13.0rc1`, `3.14.0a1+`
  const version = named(section.version, 'interpreter version');
  if (!/^\d+\.\d+\.\d+[A-Za-z0-9.+]*$/.test(version)) throw new Error(`the tier manifest's interpreter version ${JSON.stringify(version)} is not a Python's`);
  // Each a name at the top of its site directory: what a tier does not say of its packages is not guessed
  const namespaces = section.namespaces;
  if (!Array.isArray(namespaces) || !namespaces.every((name: unknown): name is string => typeof name === 'string' && name !== '' && !/[/\\]/.test(name))) {
    throw new Error('the tier manifest names no namespace packages');
  }
  if (!Array.isArray(section.distributions)) throw new Error('the tier manifest lists no distributions');
  return {
    version,
    executable: absolutePath(section.executable, 'interpreter'),
    base: absolutePath(section.base, 'base interpreter'),
    site: absolutePath(section.site, 'site directory'),
    namespaces,
    distributions: section.distributions.map((entry: unknown): TierDistribution => {
      const { name, version: held, files } = (entry ?? {}) as Record<string, unknown>;
      return { name: canonicalPythonName(named(name, 'distribution\'s name')), version: named(held, 'distribution\'s version'),
        files: named(files, 'distribution\'s files digest') };
    }),
  };
}

/**
 * A package's name as npm writes one, scoped or not: lowercase, and safe as
 * a path under a `node_modules` directory.
 *
 * @internal
 */
export const NPM_PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** A manifest's node section: its Node, its global root, its registry and East's packages there. */
function readNodeTier(section: unknown): NodeTier {
  if (typeof section !== 'object' || section === null || Array.isArray(section)) throw new Error('the tier manifest names no Node');
  const fields = section as Record<string, unknown>;
  const version = named(fields.version, 'Node version');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`the tier manifest's Node version ${JSON.stringify(version)} is not a Node's`);
  // What a lock's tarball is named under, by npm's own spelling: a URL that ends in `/`
  const registry = named(fields.registry, 'registry');
  let protocol: string | undefined;
  try {
    protocol = new URL(registry).protocol;
  } catch {
    protocol = undefined;
  }
  if ((protocol !== 'https:' && protocol !== 'http:') || !registry.endsWith('/') || /[\s\u0000-\u001f\u007f]/.test(registry)) {
    throw new Error(`the tier manifest's registry ${JSON.stringify(registry)} is not a registry's URL`);
  }
  if (!Array.isArray(fields.packages)) throw new Error('the tier manifest lists no packages');
  const seen = new Set<string>();
  const packages = fields.packages.map((entry: unknown): TierPackage => {
    const { name, version: held } = (entry ?? {}) as Record<string, unknown>;
    const said = named(name, 'package\'s name');
    if (!NPM_PACKAGE_NAME.test(said)) throw new Error(`the tier manifest's package ${JSON.stringify(said)} is not named as npm names one`);
    if (seen.has(said)) throw new Error(`the tier manifest lists the package ${said} twice`);
    seen.add(said);
    const at = named(held, 'package\'s version');
    if (/[\s/\\\u0000-\u001f\u007f]/.test(at)) throw new Error(`the tier manifest's version ${JSON.stringify(at)} of ${said} is not a package's version`);
    return { name: said, version: at };
  });
  return { version, root: absolutePath(fields.root, 'node_modules root'), registry, packages };
}

/**
 * Reads a tier manifest, of either form: a python image's form 1, or form 2,
 * a section for each runtime the image holds.
 *
 * @remarks
 * It arrives from a rack, and what it names is written into an environment
 * built over the tier (its virtualenv's `pyvenv.cfg`, a path file of its site
 * directory), and is what an environment's links lead to: so an
 * interpreter's version is a Python's, its paths and the node root are
 * absolute, on one line each, and a package is named as npm names one.
 *
 * @param bytes - The manifest file's bytes
 * @returns The manifest
 * @throws {Error} When it is not a manifest of a form this build reads, or
 *   names no runtime
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
  const fields = value as { version?: unknown; python?: unknown; namespaces?: unknown; distributions?: unknown; node?: unknown } | null;
  if (typeof fields !== 'object' || fields === null || (fields.version !== 1 && fields.version !== 2)) {
    throw new Error('the tier manifest is not of a form this e3 reads (version 1 or 2)');
  }
  const section = (field: unknown): Record<string, unknown> | undefined =>
    typeof field === 'object' && field !== null && !Array.isArray(field) ? field as Record<string, unknown> : undefined;
  if (fields.version === 1) {
    // A python image's: its interpreter, and beside it what is installed for it
    const python = section(fields.python);
    if (python === undefined) throw new Error('the tier manifest names no interpreter');
    return { python: readPythonTier({ ...python, namespaces: fields.namespaces, distributions: fields.distributions }) };
  }
  if (fields.python === undefined && fields.node === undefined) throw new Error('the tier manifest names no runtime');
  const python = fields.python === undefined ? undefined : section(fields.python);
  if (fields.python !== undefined && python === undefined) throw new Error('the tier manifest names no interpreter');
  return {
    ...(python !== undefined && { python: readPythonTier(python) }),
    ...(fields.node !== undefined && { node: readNodeTier(fields.node) }),
  };
}

/**
 * Whether a tier holds a distribution: one of that name, that version, and
 * the same installed files. Never by name and version alone: a `+cpu` build
 * is not a `+cu130` one, and a rebuilt wheel is not the one before it.
 *
 * @param tier - What the tier holds of Python
 * @param distribution - The distribution, as an environment installed it
 * @returns Whether the tier's is the same
 * @example
 * const record = await readFile(join(site, 'idna-3.10.dist-info', 'RECORD'), 'utf8');
 * tierHolds(manifest.python, { name: 'idna', version: '3.10', files: installedFilesDigest(record) }); // true when the tier's idna is that one
 */
export function tierHolds(tier: PythonTier, distribution: TierDistribution): boolean {
  const name = canonicalPythonName(distribution.name);
  return tier.distributions.some((held) => held.name === name && held.version === distribution.version && held.files === distribution.files);
}

/**
 * The tarball a registry serves a package's version as: what a lock that
 * resolved the package from that registry names
 * (`https://registry.npmjs.org/@elaraai/east/-/east-1.0.111.tgz`).
 *
 * @param registry - The registry, as npm names it, ending in `/`
 * @param name - The package's name
 * @param version - Its version
 * @returns The tarball's URL
 * @example
 * registryTarball('https://registry.npmjs.org/', '@elaraai/east', '1.0.111'); // 'https://registry.npmjs.org/@elaraai/east/-/east-1.0.111.tgz'
 */
export function registryTarball(registry: string, name: string, version: string): string {
  return `${registry}${name}/-/${name.slice(name.indexOf('/') + 1)}-${version}.tgz`;
}

/**
 * Whether a node tier holds a package an environment installed: one of that
 * name and version, which the environment's lock resolved from the registry
 * the tier installed its own from. A published version is immutable, so it is
 * then the same package; one from a path, git or another registry is not.
 *
 * @param tier - What the tier holds of Node
 * @param installed - The package, as the environment's lock names it: its
 *   name, its version, and where it was resolved from
 * @returns Whether the tier's is the same
 * @example
 * nodeTierHolds(manifest.node, { name: '@elaraai/east', version: '1.0.111', resolved: 'https://registry.npmjs.org/@elaraai/east/-/east-1.0.111.tgz' }); // true for the 1.0.111 image
 */
export function nodeTierHolds(tier: NodeTier, installed: { readonly name: string; readonly version: string; readonly resolved: string | undefined }): boolean {
  return installed.resolved === registryTarball(tier.registry, installed.name, installed.version)
    && tier.packages.some((held) => held.name === installed.name && held.version === installed.version);
}

/** A distribution as an environment installed it. */
export interface InstalledDistribution {
  /** Its name, as its metadata spells it */
  readonly name: string;
  /** Its version */
  readonly version: string;
  /** Its `RECORD` file's text */
  readonly record: string;
  /** The distributions it requires, by the names its metadata gives them
   *  ({@link readDistributionMetadata}) */
  readonly requires: readonly string[];
}

/**
 * What a distribution's `METADATA` says of it: its name, its version, and the
 * distributions it requires (`Requires-Dist`), by name, whatever their markers
 * and extras say.
 *
 * @remarks
 * Its headers alone are read, which end at its first blank line: the
 * description that may follow is the package's own text.
 *
 * @param metadata - The `METADATA` file's text
 * @returns What it says, or null when it names no name or no version
 * @example
 * const read = readDistributionMetadata(await readFile(join(site, 'torch-2.15.0.dist-info', 'METADATA'), 'utf8'));
 * // { name: 'torch', version: '2.15.0', requires: ['filelock', 'nvidia-cublas', …] }
 */
export function readDistributionMetadata(metadata: string): { name: string; version: string; requires: string[] } | null {
  const headers = metadata.split(/\r?\n\r?\n/, 1)[0]!;
  const name = /^Name:[ \t]*(\S.*?)[ \t]*$/m.exec(headers)?.[1];
  const version = /^Version:[ \t]*(\S.*?)[ \t]*$/m.exec(headers)?.[1];
  if (name === undefined || version === undefined) return null;
  const requires = [...headers.matchAll(/^Requires-Dist:[ \t]*([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/gm)].map((match) => match[1]!);
  return { name, version, requires };
}

/** A file of native code: a shared library or an extension module, of any
 *  platform (`libcublas.so.13`, `_C.cpython-311-x86_64-linux-gnu.so`). */
const NATIVE_CODE = /\.(so(\.\d+)*|dylib|pyd|dll)$/;

/** Each distribution's files in the site directory, as path segments. Left
 *  out: its own metadata, and compiled files, whose directory every module
 *  beside it shares. */
function packageFiles(installed: readonly InstalledDistribution[]): string[][][] {
  return installed.map((distribution) => recordedSiteFiles(distribution.record).map(({ file }) => file.split('/'))
    .filter((parts) => !parts[0]!.endsWith('.dist-info') && !parts.includes('__pycache__')));
}

/** The top-level namespace packages an environment and its tier both hold
 *  parts of: each the tier's manifest names, in which no distribution of the
 *  environment installs an `__init__` module. */
function sharedNamespaces(files: readonly string[][][], manifest: PythonTier): Set<string> {
  // A package some distribution here gives an `__init__` module is an ordinary one
  const ordinary = new Set<string>();
  for (const parts of files.flat()) if (parts.length === 2 && parts[1]!.startsWith('__init__.')) ordinary.add(parts[0]!);
  return new Set(manifest.namespaces.filter((name) => !ordinary.has(name)));
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
 * Native code finds the native code of what it requires by paths of the
 * environment's own site directory: a library's RUNPATH relative to itself
 * (`$ORIGIN/../../nvidia/cublas/lib`), or `site.getsitepackages()`, which
 * names the environment's directory alone. So a distribution with native code
 * that ships takes with it each distribution with native code it requires,
 * with its group, and what that requires in turn. One left to the tier finds
 * the tier's copies the same way, and takes nothing.
 *
 * @param installed - The environment's distributions
 * @param manifest - What the tier holds of Python
 * @returns The canonical names of those left to the tier
 * @example
 * const left = leftToTier(installed, manifest.python);
 * const shipped = installed.filter(({ name }) => !left.has(canonicalPythonName(name)));
 */
export function leftToTier(installed: readonly InstalledDistribution[], manifest: PythonTier): Set<string> {
  const files = packageFiles(installed);
  return leftOf(installed, manifest, files, sharedNamespaces(files, manifest));
}

/** {@link leftToTier}, given each distribution's files and the namespace
 *  packages both hold parts of, which {@link tierImports} reads too. */
function leftOf(installed: readonly InstalledDistribution[], manifest: PythonTier, files: readonly string[][][], namespaces: ReadonlySet<string>): Set<string> {
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

  const native = files.map((paths) => paths.some((parts) => NATIVE_CODE.test(parts[parts.length - 1]!)));
  const byName = new Map(installed.map((distribution, i) => [canonicalPythonName(distribution.name), i]));
  const shipping = [...installed.keys()].filter((i) => native[i]! && whole.get(find(i)) !== true);
  while (shipping.length > 0) {
    for (const required of installed[shipping.pop()!]!.requires) {
      const j = byName.get(canonicalPythonName(required));
      if (j === undefined || !native[j]! || whole.get(find(j)) !== true) continue;
      // It ships, with its group, and takes what it requires in turn
      whole.set(find(j), false);
      for (const k of installed.keys()) if (native[k]! && find(k) === find(j)) shipping.push(k);
    }
  }
  return new Set(installed.filter((_, i) => whole.get(find(i)) === true).map(({ name }) => canonicalPythonName(name)));
}

/**
 * What an environment built over a tier imports from it: what its import gate
 * lets through, and nothing else (`tierGateModule`).
 */
export interface TierImports {
  /** The canonical names of the distributions left to the tier, sorted */
  readonly distributions: readonly string[];
  /** The names their code is imported by, sorted: a module or a package at
   *  the top of the site directory, or, in a namespace package both hold
   *  parts of, one directly in it (`nvidia.cudnn`) */
  readonly roots: readonly string[];
  /** The namespace packages both hold parts of, which the environment holds
   *  parts of too, sorted */
  readonly namespaces: readonly string[];
  /** The path files (`.pth`) those distributions installed, sorted */
  readonly pathFiles: readonly string[];
}

/** The name a module or a package is imported by, from its file's or its
 *  directory's name: `six` of `six.py`, `_C` of
 *  `_C.cpython-312-x86_64-linux-gnu.so`; null for one no import names
 *  (`numpy.libs`, `LICENSE`). */
function importName(entry: string, file: boolean): string | null {
  if (file && !/\.(py|so|pyd)$/.test(entry)) return null;
  const name = file ? entry.slice(0, entry.indexOf('.')) : entry;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : null;
}

/**
 * What an environment imports from the tier it is built over: the
 * distributions left to it ({@link leftToTier}), the names their code is
 * imported by, the namespace packages both hold parts of, and the path files
 * those distributions installed.
 *
 * @remarks
 * A name is taken where {@link leftToTier} binds distributions: at the top of
 * the site directory, or one level down in a namespace package both hold
 * parts of. So a name the environment ships and one it left to the tier are
 * never the same.
 *
 * @param installed - The environment's distributions, as installed whole
 * @param manifest - What the tier holds of Python
 * @returns What the environment imports from the tier
 * @example
 * const imports = tierImports(installed, manifest.python);
 * // imports.roots: ['idna', 'nvidia.cudnn', …]; imports.namespaces: ['nvidia']
 */
export function tierImports(installed: readonly InstalledDistribution[], manifest: PythonTier): TierImports {
  // Each record read, and each distribution's files digested, once
  const files = packageFiles(installed);
  const shared = sharedNamespaces(files, manifest);
  const left = leftOf(installed, manifest, files, shared);
  const roots = new Set<string>();
  const pathFiles = new Set<string>();
  for (const [i, distribution] of installed.entries()) {
    if (!left.has(canonicalPythonName(distribution.name))) continue;
    for (const parts of files[i]!) {
      if (parts.length === 1 && parts[0]!.endsWith('.pth')) { pathFiles.add(parts[0]!); continue; }
      const top = importName(parts[0]!, parts.length === 1);
      if (top === null) continue;
      if (!shared.has(top) || parts.length === 1) { roots.add(top); continue; }
      const inner = importName(parts[1]!, parts.length === 2);
      if (inner !== null) roots.add(`${top}.${inner}`);
    }
  }
  // A namespace package the environment holds no part of is the tier's alone,
  // and no name in it was left
  const held = new Set(files.flat().map((parts) => parts[0]!));
  const sorted = (names: Iterable<string>): string[] => [...names].sort(byCodePoint);
  return { distributions: sorted(left), roots: sorted(roots), namespaces: sorted([...shared].filter((name) => held.has(name))), pathFiles: sorted(pathFiles) };
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
 * @example
 * pythonMinor('3.11.2'); // '3.11'
 */
export function pythonMinor(version: string): string {
  const release = releaseOf(version);
  if (release === null || release.length < 2) throw new Error(`'${version}' names no Python minor release`);
  return `${release[0]!}.${release[1]!}`;
}
