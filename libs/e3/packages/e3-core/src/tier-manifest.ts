/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What a rack's tier image says it contains: its tier manifest, which an
 * environment the rack runs over that image is built without.
 *
 * A runtime image writes its manifest when it is built
 * (`docker/images/tier-manifest.py`): its interpreter, its site directory,
 * and each distribution installed for it, by name, version and the digest of
 * the files it installed. A manifest is named by the SHA-256 of its bytes.
 *
 * @packageDocumentation
 */

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
    /** The directory its distributions are installed in, absolute */
    readonly site: string;
  };
  /** The distributions installed for it, sorted by name */
  readonly distributions: readonly TierDistribution[];
}

/** What an installer writes beside a distribution's files, which says how it
 *  was installed and not what was. */
const BOOKKEEPING: readonly string[] = ['RECORD', 'INSTALLER', 'REQUESTED', 'direct_url.json'];

/**
 * A distribution's name as PEP 503 writes it: lowercase, runs of `-`, `_` and
 * `.` as one `-`.
 *
 * @param name - The name, as a manifest or a directory spells it
 * @returns The canonical name
 */
export function canonicalDistributionName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

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
 * digest (`docker/images/tier-manifest.py`).
 *
 * @param record - The `RECORD` file's text
 * @returns `sha256:<hex>`
 * @example
 * const files = installedFilesDigest(await readFile(join(site, 'idna-3.20.dist-info', 'RECORD'), 'utf8'));
 */
export function installedFilesDigest(record: string): string {
  const rows: [string, string, string][] = [];
  for (const line of record.split(/\r?\n/)) {
    const fields = recordRow(line);
    if (fields.length < 3) continue;
    const [file, digest, size] = fields as [string, string, string];
    const parts = file.split('/');
    if (parts[0] === '..') continue;
    if (parts.length === 2 && parts[0]!.endsWith('.dist-info') && BOOKKEEPING.includes(parts[1]!)) continue;
    if (parts.includes('__pycache__') || file.endsWith('.pyc')) continue;
    rows.push([file, digest, size]);
  }
  // By code point, as the image's script sorts them
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const lines = rows.map(([file, digest, size]) => `${file}\t${digest}\t${size}\n`).join('');
  return `sha256:${computeHash(new TextEncoder().encode(lines))}`;
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
  const fields = value as { version?: unknown; python?: Record<string, unknown>; distributions?: unknown } | null;
  if (typeof fields !== 'object' || fields === null || fields.version !== 1) {
    throw new Error('the tier manifest is not of the form this e3 reads (version 1)');
  }
  const python = fields.python;
  const text = (field: unknown, what: string): string => {
    if (typeof field !== 'string' || field === '') throw new Error(`the tier manifest names no ${what}`);
    return field;
  };
  if (typeof python !== 'object' || python === null) throw new Error('the tier manifest names no interpreter');
  if (!Array.isArray(fields.distributions)) throw new Error('the tier manifest lists no distributions');
  return {
    version: 1,
    python: {
      version: text(python.version, 'interpreter version'),
      executable: text(python.executable, 'interpreter'),
      site: text(python.site, 'site directory'),
    },
    distributions: fields.distributions.map((entry: unknown): TierDistribution => {
      const { name, version, files } = (entry ?? {}) as Record<string, unknown>;
      return { name: canonicalDistributionName(text(name, 'distribution\'s name')), version: text(version, 'distribution\'s version'),
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
  const name = canonicalDistributionName(distribution.name);
  return manifest.distributions.some((held) => held.name === name && held.version === distribution.version && held.files === distribution.files);
}
