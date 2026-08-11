/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ArrayType,
  DictType,
  IntegerType,
  SetType,
  StringType,
  StructType,
  decodeBeast2For,
  encodeBeast2For,
  encodeBeast2PagedFor,
  equalFor,
  none,
  toEastTypeValue,
  variant,
  type EastType,
} from '@elaraai/east';
import { BEAST2_CONTENT_TYPE, computeHash, InMemoryTransferBackend } from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import { PackageObjectType, WorkspaceStateType } from '@elaraai/e3-types';
import { findDatasetKey, getDataset, getDatasetPage } from './datasets.js';

/**
 * ~`byteLength` bytes of high-entropy ASCII, deterministic across runs.
 *
 * These fixtures exist to cross a byte-size threshold, so they must not be
 * compressible: beast2 frames deflate by default (container v5), and a run of
 * one repeated character shrinks to a few hundred bytes — putting the payload
 * back under the very threshold the test is probing. A cheap LCG gives content
 * deflate cannot shrink, without depending on Math.random.
 */
function incompressibleString(byteLength: number): string {
  // Math.imul, not `*`: a 32-bit LCG done in float multiplication loses low
  // bits past 2^53 and degenerates into a short, highly compressible cycle
  // (1.1 MB of it deflates to 25 kB). Take the high bits — an LCG's low bits
  // are weak.
  let seed = 0x2545f491 >>> 0;
  const chars = new Array<string>(byteLength);
  for (let i = 0; i < byteLength; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    chars[i] = String.fromCharCode(33 + ((seed >>> 16) % 94)); // printable ASCII: 1 byte in UTF-8
  }
  return chars.join('');
}

const REPO = 'test-repo';
const WS = 'test-ws';

describe('getDataset', () => {
  it('returns BEAST2 bytes with correct headers', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);

    // Write a BEAST2-encoded value to the object store
    const encode = encodeBeast2For(StringType);
    const data = encode('hello');
    const hash = await storage.objects.write(REPO, data);

    // Write a dataset ref pointing to that object
    await storage.datasets.write(REPO, WS, 'inputs/config', variant('value', {
      hash,
      versions: new Map(),
    }));

    const treePath = [variant('field', 'inputs'), variant('field', 'config')];
    const response = await getDataset(storage, REPO, WS, treePath);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), BEAST2_CONTENT_TYPE);
    assert.equal(response.headers.get('X-Content-SHA256'), hash);
    assert.equal(response.headers.get('Content-Length'), String(data.byteLength));

    const body = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual(body, data);
  });

  it('returns correct Content-Length for large payloads', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);

    // Create a larger payload (~100KB)
    const largeString = 'x'.repeat(100_000);
    const encode = encodeBeast2For(StringType);
    const data = encode(largeString);
    const hash = await storage.objects.write(REPO, data);

    await storage.datasets.write(REPO, WS, 'inputs/big', variant('value', {
      hash,
      versions: new Map(),
    }));

    const treePath = [variant('field', 'inputs'), variant('field', 'big')];
    const response = await getDataset(storage, REPO, WS, treePath);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Length'), String(data.byteLength));
    assert.equal(response.headers.get('X-Content-SHA256'), hash);

    // Verify hash matches actual content
    const body = new Uint8Array(await response.arrayBuffer());
    assert.equal(computeHash(body), hash);
  });

  it('returns JSON with download URL for >1MB datasets when transferBackend provided', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);
    const transferBackend = new InMemoryTransferBackend({ baseUrl: '' });

    // Create a >1MB payload
    const largeString = incompressibleString(1_100_000);
    const encode = encodeBeast2For(StringType);
    const data = encode(largeString);
    assert.ok(data.byteLength > 1024 * 1024, 'fixture must cross the 1 MB threshold');
    const hash = await storage.objects.write(REPO, data);

    await storage.datasets.write(REPO, WS, 'inputs/big', variant('value', {
      hash,
      versions: new Map(),
    }));

    const treePath = [variant('field', 'inputs'), variant('field', 'big')];
    const requestUrl = `http://localhost:3000/api/repos/${REPO}/workspaces/${WS}/datasets/inputs/big`;
    const response = await getDataset(storage, REPO, WS, treePath, REPO, requestUrl, transferBackend);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/json');
    assert.equal(response.headers.get('X-Content-SHA256'), hash);
    assert.equal(response.headers.get('X-Content-Length'), String(data.byteLength));

    const body = await response.json() as { url: string };
    assert.ok(body.url, 'should have url in body');
    assert.ok(body.url.includes('/api/downloads/'), `Expected /api/downloads/ URL, got ${body.url}`);
  });

  it('returns inline bytes for >1MB datasets without transferBackend', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);

    // Create a >1MB payload
    const largeString = incompressibleString(1_100_000);
    const encode = encodeBeast2For(StringType);
    const data = encode(largeString);
    assert.ok(data.byteLength > 1024 * 1024, 'fixture must cross the 1 MB threshold');
    const hash = await storage.objects.write(REPO, data);

    await storage.datasets.write(REPO, WS, 'inputs/big', variant('value', {
      hash,
      versions: new Map(),
    }));

    const treePath = [variant('field', 'inputs'), variant('field', 'big')];
    const requestUrl = `http://localhost:3000/api/repos/${REPO}/workspaces/${WS}/datasets/inputs/big`;
    const response = await getDataset(storage, REPO, WS, treePath, REPO, requestUrl);

    // Without transferBackend, large datasets are served inline
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), BEAST2_CONTENT_TYPE);
    assert.equal(response.headers.get('X-Content-SHA256'), hash);
  });

  it('returns inline bytes for ≤1MB datasets even with requestUrl', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);

    const encode = encodeBeast2For(StringType);
    const data = encode('small value');
    const hash = await storage.objects.write(REPO, data);

    await storage.datasets.write(REPO, WS, 'inputs/small', variant('value', {
      hash,
      versions: new Map(),
    }));

    const treePath = [variant('field', 'inputs'), variant('field', 'small')];
    const requestUrl = `http://localhost:3000/api/repos/${REPO}/workspaces/${WS}/datasets/inputs/small`;
    const response = await getDataset(storage, REPO, WS, treePath, REPO, requestUrl);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), BEAST2_CONTENT_TYPE);
    assert.equal(response.headers.get('X-Content-SHA256'), hash);
  });

  it('returns 404 JSON error for null dataset', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);

    await storage.datasets.write(REPO, WS, 'inputs/empty', variant('null', {
      versions: new Map(),
    }));

    const treePath = [variant('field', 'inputs'), variant('field', 'empty')];
    const response = await getDataset(storage, REPO, WS, treePath);

    assert.equal(response.status, 404);
    assert.equal(response.headers.get('Content-Type'), 'application/json');
    const body = await response.json() as { error: { type: string; message: string } };
    assert.equal(body.error.type, 'dataset_null');
  });

  it('returns 404 JSON error for unassigned dataset', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);

    await storage.datasets.write(REPO, WS, 'tasks/output', variant('unassigned', null));

    const treePath = [variant('field', 'tasks'), variant('field', 'output')];
    const response = await getDataset(storage, REPO, WS, treePath);

    assert.equal(response.status, 404);
    assert.equal(response.headers.get('Content-Type'), 'application/json');
    const body = await response.json() as { error: { type: string; message: string } };
    assert.equal(body.error.type, 'dataset_unassigned');
  });

  it('returns 400 JSON error for empty path', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);

    const response = await getDataset(storage, REPO, WS, []);

    assert.equal(response.status, 400);
    assert.equal(response.headers.get('Content-Type'), 'application/json');
    const body = await response.json() as { error: { type: string; message: string } };
    assert.equal(body.error.type, 'bad_request');
  });
});

const RowType = StructType({ id: IntegerType, name: StringType });
const RowsType = ArrayType(RowType);
const rowsPath = [variant('field', 'inputs'), variant('field', 'rows')];

function makeRows(n: number): { id: bigint; name: string }[] {
  return Array.from({ length: n }, (_, i) => ({ id: BigInt(i), name: `row-${i % 97}` }));
}

/** Seeds a deployed workspace whose `.inputs.<name>` dataset holds `blob`.
 *  Reseeding the same storage replaces the workspace's package wholesale. */
async function seedDataset(storage: InMemoryStorage, blob: Uint8Array, name: string, type: EastType): Promise<string> {
  try {
    await storage.repos.create(REPO);
  } catch {
    // Already created by an earlier seed into this storage.
  }
  const hash = await storage.objects.write(REPO, blob);
  const structure = variant('struct', new Map([
    ['inputs', variant('struct', new Map([
      [name, variant('value', { type: toEastTypeValue(type), writable: true })],
    ]))],
  ]));
  const pkgHash = await storage.objects.write(REPO, encodeBeast2For(PackageObjectType)({
    tasks: new Map(),
    data: { structure, refs: new Map([[`inputs/${name}`, variant('value', { hash, versions: new Map() })]]) },
    functions: new Map(),
    records: new Map(),
  }));
  await storage.refs.workspaceWrite(REPO, WS, encodeBeast2For(WorkspaceStateType)({
    packageName: 'pages', packageVersion: '1.0.0', packageHash: pkgHash, deployedAt: new Date(0), currentRunId: none,
  }));
  await storage.datasets.write(REPO, WS, `inputs/${name}`, variant('value', { hash, versions: new Map() }));
  return hash;
}

/** Seeds a deployed workspace whose `.inputs.rows` dataset holds `blob`. */
async function seedRowsDataset(storage: InMemoryStorage, blob: Uint8Array): Promise<string> {
  return seedDataset(storage, blob, 'rows', RowsType);
}

/** Counts whole-object and ranged reads of `watchedHash` (the dataset blob —
 *  workspace/package object reads are expected and not counted). */
function spyObjectReads(storage: InMemoryStorage, watchedHash: string): { wholeReads: () => number; rangedBytes: () => number; rangedCalls: () => number } {
  const objects = storage.objects;
  let whole = 0;
  let ranged = 0;
  let calls = 0;
  const origRead = objects.read.bind(objects);
  const origRange = objects.readRange.bind(objects);
  objects.read = (repo: string, hash: string) => {
    if (hash === watchedHash) whole++;
    return origRead(repo, hash);
  };
  objects.readRange = (repo: string, hash: string, offset: number, length: number) => {
    if (hash === watchedHash) {
      ranged += length;
      calls++;
    }
    return origRange(repo, hash, offset, length);
  };
  return { wholeReads: () => whole, rangedBytes: () => ranged, rangedCalls: () => calls };
}

describe('getDatasetPage (ranged reads)', () => {
  it('serves element windows through ranged reads without buffering the blob', async () => {
    const storage = new InMemoryStorage();
    // Incompressible per-row names so the deflated blob comfortably exceeds
    // the 64 KiB tail probe — otherwise the probe alone covers the blob and
    // the read-volume assertion below measures nothing.
    const rows = Array.from({ length: 8000 }, (_, i) => {
      let seed = (Math.imul(i, 2654435761) + 1) >>> 0;
      const chars = new Array<string>(48);
      for (let j = 0; j < 48; j++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        chars[j] = String.fromCharCode(33 + ((seed >>> 16) % 94));
      }
      return { id: BigInt(i), name: chars.join('') };
    });
    const blob = encodeBeast2PagedFor(RowsType, { batchSize: 100 })(rows);
    assert.ok(blob.byteLength > 128 * 1024, `fixture (${blob.byteLength} bytes) must dwarf the 64 KiB tail probe`);
    const hash = await seedRowsDataset(storage, blob);
    const spy = spyObjectReads(storage, hash);

    const response = await getDatasetPage(storage, REPO, WS, rowsPath, { offset: 900, limit: 200 });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Total-Elements'), '8000');
    assert.equal(response.headers.get('X-Total-Bytes'), String(blob.byteLength));
    assert.equal(response.headers.get('X-Page-Offset'), '900');
    assert.equal(response.headers.get('X-Page-Count'), '200');
    const page = decodeBeast2For(RowsType)(new Uint8Array(await response.arrayBuffer()));
    assert.ok(equalFor(RowsType)(page, rows.slice(900, 1100)), 'window equals the expected slice');

    assert.equal(spy.wholeReads(), 0, 'the ranged path must never read the blob whole');
    assert.ok(spy.rangedBytes() < blob.byteLength / 2, `ranged reads (${spy.rangedBytes()} bytes) must stay well under the blob (${blob.byteLength} bytes)`);

    // A second window on the same hash reuses the cached extents: only the
    // window's own frame bytes are read.
    const before = spy.rangedBytes();
    const deep = await getDatasetPage(storage, REPO, WS, rowsPath, { offset: 7500, limit: 100 });
    assert.equal(deep.status, 200);
    const deepPage = decodeBeast2For(RowsType)(new Uint8Array(await deep.arrayBuffer()));
    assert.ok(equalFor(RowsType)(deepPage, rows.slice(7500, 7600)));
    assert.ok(spy.rangedBytes() - before < 64 * 1024, 'a cached-extents window reads only its own segments');
  });

  it('pages blobs beyond the fallback cap — no size limit on the ranged path', async () => {
    const storage = new InMemoryStorage();
    const rows = makeRows(2500);
    const blob = encodeBeast2PagedFor(RowsType, { batchSize: 100 })(rows);
    await seedRowsDataset(storage, blob);

    // A cap far below the blob size: the ranged path must ignore it.
    const response = await getDatasetPage(storage, REPO, WS, rowsPath, { offset: 2400, limit: 1000 }, { readMaxBytes: 1024 });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Page-Count'), '100', 'tail clamp still applies');
    const page = decodeBeast2For(RowsType)(new Uint8Array(await response.arrayBuffer()));
    assert.ok(equalFor(RowsType)(page, rows.slice(2400)));
  });

  it('serves segment windows and empty past-the-end windows', async () => {
    const storage = new InMemoryStorage();
    const rows = makeRows(2500);
    const blob = encodeBeast2PagedFor(RowsType, { batchSize: 100 })(rows);
    await seedRowsDataset(storage, blob);

    const seg = await getDatasetPage(storage, REPO, WS, rowsPath, { segment: 1 });
    assert.equal(seg.status, 200);
    assert.equal(seg.headers.get('X-Page-Offset'), '100');
    assert.equal(seg.headers.get('X-Page-Count'), '100');
    const segPage = decodeBeast2For(RowsType)(new Uint8Array(await seg.arrayBuffer()));
    assert.ok(equalFor(RowsType)(segPage, rows.slice(100, 200)));

    const past = await getDatasetPage(storage, REPO, WS, rowsPath, { offset: 5000, limit: 100 });
    assert.equal(past.status, 200);
    assert.equal(past.headers.get('X-Page-Count'), '0');
    assert.equal(past.headers.get('X-Page-Offset'), '5000');
    assert.deepEqual(decodeBeast2For(RowsType)(new Uint8Array(await past.arrayBuffer())), []);
  });

  it('refuses index-less blobs without buffering them', async () => {
    const storage = new InMemoryStorage();
    // Whole-value v5 encode: no index — predates the stored-segmented contract.
    const blob = encodeBeast2For(RowsType)(makeRows(50));
    const hash = await seedRowsDataset(storage, blob);
    const spy = spyObjectReads(storage, hash);

    const response = await getDatasetPage(storage, REPO, WS, rowsPath, { offset: 0, limit: 10 });
    assert.equal(response.status, 400);
    const body = await response.json() as { error: { type: string } };
    assert.equal(body.error.type, 'dataset_not_indexed');
    assert.equal(spy.wholeReads(), 0, 'the refusal must come from the tail probe, not a whole read');
  });

  it('surfaces storage failures as errors, never as dataset_not_indexed', async () => {
    const storage = new InMemoryStorage();
    // Distinct row count → distinct content hash, so the module-level
    // extents cache cannot mask the injected failure.
    const rows = makeRows(600);
    const blob = encodeBeast2PagedFor(RowsType, { batchSize: 100 })(rows);
    await seedRowsDataset(storage, blob);
    // The blob IS indexed; the BACKEND fails at read time. The old bare
    // catch would answer dataset_not_indexed ("re-write the dataset") for
    // what is really an I/O failure.
    storage.objects.readRange = () => Promise.reject(new Error('injected storage failure'));

    const response = await getDatasetPage(storage, REPO, WS, rowsPath, { offset: 0, limit: 10 });
    assert.notEqual(response.status, 200);
    const body = await response.json() as { error: { type: string; message: string } };
    assert.notEqual(body.error.type, 'dataset_not_indexed',
      'an I/O failure must not masquerade as a re-write suggestion');
    assert.match(body.error.message, /injected storage failure/);
  });

  it('falls back to whole reads — and keeps the cap — when the backend has no ranged reads', async () => {
    const storage = new InMemoryStorage();
    const rows = makeRows(500);
    const blob = encodeBeast2PagedFor(RowsType, { batchSize: 100 })(rows);
    await seedRowsDataset(storage, blob);
    // Simulate a backend without ranged reads (e.g. a store that has not
    // implemented the optional method yet).
    (storage.objects as { readRange?: unknown }).readRange = undefined;

    const capped = await getDatasetPage(storage, REPO, WS, rowsPath, { offset: 0, limit: 10 }, { readMaxBytes: 1024 });
    assert.equal(capped.status, 400);
    const body = await capped.json() as { error: { type: string } };
    assert.equal(body.error.type, 'dataset_too_large');

    const served = await getDatasetPage(storage, REPO, WS, rowsPath, { offset: 90, limit: 20 });
    assert.equal(served.status, 200);
    const page = decodeBeast2For(RowsType)(new Uint8Array(await served.arrayBuffer()));
    assert.ok(equalFor(RowsType)(page, rows.slice(90, 110)), 'the fallback still pages correctly');
  });
});

const LookupType = DictType(StringType, IntegerType);
const IntLookupType = DictType(IntegerType, StringType);
const TagsType = SetType(StringType);
const lookupPath = [variant('field', 'inputs'), variant('field', 'lookup')];
const tagsPath = [variant('field', 'inputs'), variant('field', 'tags')];

function lookupOf(n: number): Map<string, bigint> {
  return new Map(Array.from({ length: n }, (_, i) => [`k${String(i).padStart(4, '0')}`, BigInt(i)] as const));
}

async function findJson(response: Response): Promise<{ found: boolean; row: number; count: number }> {
  assert.equal(response.status, 200, `find failed: ${await response.clone().text()}`);
  return await response.json() as { found: boolean; row: number; count: number };
}

describe('findDatasetKey', () => {
  // batchSize 97 puts segment boundaries at 97, 194, … — deliberately off
  // the decimal key grid, so prefix ranges span segment boundaries.
  it('locates exact keys by fence bisect, including segment-fence rows and misses', async () => {
    const storage = new InMemoryStorage();
    const blob = encodeBeast2PagedFor(LookupType, { batchSize: 97 })(lookupOf(2500));
    await seedDataset(storage, blob, 'lookup', LookupType);

    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k0150"' })),
      { found: true, row: 150, count: 1 });
    // A key that IS a segment fence — row 97 opens segment 1.
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k0097"' })),
      { found: true, row: 97, count: 1 });
    // Misses report the insertion row: between keys, below the minimum,
    // and past the end.
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k0150x"' })),
      { found: false, row: 151, count: 0 });
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"a"' })),
      { found: false, row: 0, count: 0 });
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"z"' })),
      { found: false, row: 2500, count: 0 });
  });

  it('prefix ranges are contiguous rows, spanning segment boundaries', async () => {
    const storage = new InMemoryStorage();
    const blob = encodeBeast2PagedFor(LookupType, { batchSize: 97 })(lookupOf(2500));
    await seedDataset(storage, blob, 'lookup', LookupType);

    // k01__ covers rows 100..199 — across the boundary at row 194.
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { prefix: 'k01' })),
      { found: true, row: 100, count: 100 });
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { prefix: 'k0150' })),
      { found: true, row: 150, count: 1 });
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { prefix: 'k9' })),
      { found: false, row: 2500, count: 0 });
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { prefix: '' })),
      { found: true, row: 0, count: 2500 });
  });

  it('decodes at most the touched segments: one for exact, two for a spanning prefix', async () => {
    const storage = new InMemoryStorage();
    const blob = encodeBeast2PagedFor(LookupType, { batchSize: 97 })(lookupOf(2500));
    const hash = await seedDataset(storage, blob, 'lookup', LookupType);
    // Warm the per-hash extents + fence caches, then count reads: each
    // segment decode is exactly one ranged read of that segment's frames.
    await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k0150"' });
    await findDatasetKey(storage, REPO, WS, lookupPath, { prefix: 'k01' });
    const spy = spyObjectReads(storage, hash);

    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k0150"' })),
      { found: true, row: 150, count: 1 });
    assert.equal(spy.wholeReads(), 0, 'the ranged path must never read the blob whole');
    assert.equal(spy.rangedCalls(), 1, 'an exact find decodes exactly one segment');

    const before = spy.rangedCalls();
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { prefix: 'k01' })),
      { found: true, row: 100, count: 100 });
    assert.equal(spy.rangedCalls() - before, 2, 'a boundary-spanning prefix decodes exactly the two edge segments');
    assert.equal(spy.wholeReads(), 0);
  });

  it('scalar keys parse as .east literals; bad literals are key_parse_error', async () => {
    const storage = new InMemoryStorage();
    const entries = new Map(Array.from({ length: 500 }, (_, i) => [BigInt(i), `v${i}`] as const));
    const blob = encodeBeast2PagedFor(IntLookupType, { batchSize: 97 })(entries);
    await seedDataset(storage, blob, 'lookup', IntLookupType);

    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { key: '42' })),
      { found: true, row: 42, count: 1 });

    const bad = await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"abc"' });
    assert.equal(bad.status, 400);
    const badBody = await bad.json() as { error: { type: string; message: string } };
    assert.equal(badBody.error.type, 'key_parse_error');
    assert.match(badBody.error.message, /Integer/);

    const prefixErr = await findDatasetKey(storage, REPO, WS, lookupPath, { prefix: '4' });
    assert.equal(prefixErr.status, 400);
    const prefixBody = await prefixErr.json() as { error: { type: string; message: string } };
    assert.match(prefixBody.error.message, /String keys/);
  });

  it('Set datasets search elements like dict keys', async () => {
    const storage = new InMemoryStorage();
    const tags = new Set(Array.from({ length: 300 }, (_, i) => `k${String(i).padStart(4, '0')}`));
    const blob = encodeBeast2PagedFor(TagsType, { batchSize: 97 })(tags);
    await seedDataset(storage, blob, 'tags', TagsType);

    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, tagsPath, { key: '"k0123"' })),
      { found: true, row: 123, count: 1 });
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, tagsPath, { prefix: 'k00' })),
      { found: true, row: 0, count: 100 });
  });

  it('refuses non-keyed datasets and malformed queries', async () => {
    const storage = new InMemoryStorage();
    const blob = encodeBeast2PagedFor(RowsType, { batchSize: 100 })(makeRows(50));
    await seedDataset(storage, blob, 'rows', RowsType);

    const arr = await findDatasetKey(storage, REPO, WS, rowsPath, { key: '(id=1, name="x")' });
    assert.equal(arr.status, 400);
    assert.equal(((await arr.json()) as { error: { type: string } }).error.type, 'dataset_not_searchable');

    const lookupBlob = encodeBeast2PagedFor(LookupType)(lookupOf(10));
    await seedDataset(storage, lookupBlob, 'lookup', LookupType);
    const neither = await findDatasetKey(storage, REPO, WS, lookupPath, {});
    assert.equal(neither.status, 400);
    const both = await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"a"', prefix: 'a' });
    assert.equal(both.status, 400);
  });

  it('hash pins mirror the page endpoint: immutable when matching, 409 when stale', async () => {
    const storage = new InMemoryStorage();
    const blob = encodeBeast2PagedFor(LookupType)(lookupOf(50));
    const hash = await seedDataset(storage, blob, 'lookup', LookupType);

    const pinned = await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k0007"', hash });
    assert.equal(pinned.status, 200);
    assert.match(pinned.headers.get('Cache-Control') ?? '', /immutable/);
    assert.equal(pinned.headers.get('X-Content-SHA256'), hash);

    const unpinned = await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k0007"' });
    assert.equal(unpinned.headers.get('Cache-Control'), 'no-store');

    const stale = await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k0007"', hash: '0'.repeat(64) });
    assert.equal(stale.status, 409);
    assert.equal(stale.headers.get('X-Content-SHA256'), hash);
  });

  it('refuses index-less blobs; the whole-read fallback still searches under its cap', async () => {
    const storage = new InMemoryStorage();
    // Whole-value v5 encode: no index — predates the stored-segmented contract.
    const raw = encodeBeast2For(LookupType)(lookupOf(60));
    const hash = await seedDataset(storage, raw, 'lookup', LookupType);
    const spy = spyObjectReads(storage, hash);
    const refused = await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k0001"' });
    assert.equal(refused.status, 400);
    assert.equal(((await refused.json()) as { error: { type: string } }).error.type, 'dataset_not_indexed');
    assert.equal(spy.wholeReads(), 0, 'the refusal must come from the tail probe, not a whole read');

    const fallback = new InMemoryStorage();
    const blob = encodeBeast2PagedFor(LookupType, { batchSize: 97 })(lookupOf(400));
    await seedDataset(fallback, blob, 'lookup', LookupType);
    (fallback.objects as { readRange?: unknown }).readRange = undefined;
    assert.deepEqual(await findJson(await findDatasetKey(fallback, REPO, WS, lookupPath, { key: '"k0123"' })),
      { found: true, row: 123, count: 1 });
    const capped = await findDatasetKey(fallback, REPO, WS, lookupPath, { key: '"k0123"' }, { readMaxBytes: 64 });
    assert.equal(capped.status, 400);
    assert.equal(((await capped.json()) as { error: { type: string } }).error.type, 'dataset_too_large');
  });

  it('an empty collection reports no match at row 0', async () => {
    const storage = new InMemoryStorage();
    const blob = encodeBeast2PagedFor(LookupType)(new Map<string, bigint>());
    await seedDataset(storage, blob, 'lookup', LookupType);

    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"a"' })),
      { found: false, row: 0, count: 0 });
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { prefix: 'a' })),
      { found: false, row: 0, count: 0 });
  });
});

const MachineKeyType = StructType({ machine: StringType, line: StringType, shift: IntegerType });
const MachinesType = DictType(MachineKeyType, IntegerType);
const machinesPath = [variant('field', 'inputs'), variant('field', 'machines')];

/** 4 machines × 5 lines × 10 shifts = 200 keys, ascending in the canonical
 *  (machine, line, shift) order: `press` spans rows 100..149, `press`/`L2`
 *  rows 120..129. */
function machinesOf(): Map<{ machine: string; line: string; shift: bigint }, bigint> {
  const entries: [{ machine: string; line: string; shift: bigint }, bigint][] = [];
  let i = 0;
  for (const machine of ['mill', 'oven', 'press', 'wrap']) {
    for (let line = 0; line < 5; line++) {
      for (let shift = 0; shift < 10; shift++) {
        entries.push([{ machine, line: `L${line}`, shift: BigInt(shift) }, BigInt(i++)]);
      }
    }
  }
  return new Map(entries);
}

describe('findDatasetKey — struct keys', () => {
  it('leading fields and field prefixes address contiguous tuple ranges', async () => {
    const storage = new InMemoryStorage();
    // batchSize 23 puts segment boundaries all over the tuple ranges.
    const blob = encodeBeast2PagedFor(MachinesType, { batchSize: 23 })(machinesOf());
    await seedDataset(storage, blob, 'machines', MachinesType);

    // A prefix alone types ahead on the FIRST field.
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, machinesPath, { prefix: 'p' })),
      { found: true, row: 100, count: 50 });
    // Exact leading fields narrow the tuple range field by field.
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, machinesPath, { fields: ['"press"'] })),
      { found: true, row: 100, count: 50 });
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, machinesPath, { fields: ['"press"', '"L2"'] })),
      { found: true, row: 120, count: 10 });
    // Leading exact + a prefix continuing into the next String field.
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, machinesPath, { fields: ['"press"'], prefix: 'L2' })),
      { found: true, row: 120, count: 10 });
    // Every field exact pins one row; the whole-key literal agrees.
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, machinesPath, { fields: ['"press"', '"L2"', '7'] })),
      { found: true, row: 127, count: 1 });
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, machinesPath, { key: '(machine="press", line="L2", shift=7)' })),
      { found: true, row: 127, count: 1 });
    // Misses report the insertion row.
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, machinesPath, { prefix: 'q' })),
      { found: false, row: 150, count: 0 });
  });

  it('refuses malformed struct queries with typed errors', async () => {
    const storage = new InMemoryStorage();
    const blob = encodeBeast2PagedFor(MachinesType, { batchSize: 23 })(machinesOf());
    await seedDataset(storage, blob, 'machines', MachinesType);

    const intPrefix = await findDatasetKey(storage, REPO, WS, machinesPath, { fields: ['"press"', '"L2"'], prefix: '7' });
    assert.equal(intPrefix.status, 400);
    assert.match(((await intPrefix.json()) as { error: { message: string } }).error.message, /shift.*Integer.*not String/);

    const exhausted = await findDatasetKey(storage, REPO, WS, machinesPath, { fields: ['"press"', '"L2"', '7'], prefix: 'x' });
    assert.equal(exhausted.status, 400);
    assert.match(((await exhausted.json()) as { error: { message: string } }).error.message, /nothing left for a prefix/);

    const tooMany = await findDatasetKey(storage, REPO, WS, machinesPath, { fields: ['"a"', '"b"', '1', '2'] });
    assert.equal(tooMany.status, 400);
    assert.match(((await tooMany.json()) as { error: { message: string } }).error.message, /has 3 fields/);

    const badLiteral = await findDatasetKey(storage, REPO, WS, machinesPath, { fields: ['press'] });
    assert.equal(badLiteral.status, 400);
    const badBody = await badLiteral.json() as { error: { type: string; message: string } };
    assert.equal(badBody.error.type, 'key_parse_error');
    assert.match(badBody.error.message, /machine/);

    const scalar = new InMemoryStorage();
    await seedDataset(scalar, encodeBeast2PagedFor(LookupType)(lookupOf(10)), 'lookup', LookupType);
    const fieldsOnScalar = await findDatasetKey(scalar, REPO, WS, lookupPath, { fields: ['"a"'] });
    assert.equal(fieldsOnScalar.status, 400);
    assert.match(((await fieldsOnScalar.json()) as { error: { message: string } }).error.message, /Struct keys/);
  });
});
