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
  NullType,
  RUN_MAX_BYTES,
  SetType,
  SortedMap,
  StringType,
  StructType,
  compareFor,
  decodeBeast2For,
  encodeBeast2For,
  encodeBeast2PagedFor,
  equalFor,
  none,
  some,
  toEastTypeValue,
  variant,
  type EastType,
  type ValueTypeOf,
} from '@elaraai/east';
import { computeHash, datasetWrite, InMemoryTransferBackend, writeRecordState } from '@elaraai/e3-core';
import { InMemoryStorage, encodeInSegmentsOf, storeSegmentsOf } from '@elaraai/e3-core/test';
import {
  BEAST2_CONTENT_TYPE, PackageObjectType, RecordIndexObjectType, WorkspaceRecordType, decodeCollectionManifest, indexCollectionType, indexWindowType,
} from '@elaraai/e3-types';
import { ResponseType } from '../types.js';
import { findDatasetKey, getDataset, getDatasetPage, setDataset } from './datasets.js';

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

  it('streams a manifest-backed collection, reading each segment as the client takes it', async () => {
    // A collection is many objects, so there is no one object to redirect a
    // download to — and splicing it into a buffer first held the whole value
    // (twice) in the server for every download.
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);
    const type = DictType(StringType, IntegerType);
    const value = new Map(Array.from({ length: 20_000 }, (_, i) => [`k${String(i).padStart(6, '0')}`, BigInt(i)] as [string, bigint]));
    const hash = await datasetWrite(storage, REPO, value, type);
    const segments = decodeCollectionManifest(await storage.objects.read(REPO, hash)).entries.map((entry) => entry.hash);
    assert.ok(segments.length > 3, `the value spans segments, got ${segments.length}`);
    await storage.datasets.write(REPO, WS, 'inputs/lookup', variant('value', { hash, versions: new Map() }));

    const objects = storage.objects;
    const read = objects.read.bind(objects);
    let segmentReads = 0;
    objects.read = (repo: string, object: string) => {
      if (segments.includes(object)) segmentReads++;
      return read(repo, object);
    };
    try {
      const response = await getDataset(storage, REPO, WS, [variant('field', 'inputs'), variant('field', 'lookup')]);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Content-Type'), BEAST2_CONTENT_TYPE);
      assert.equal(segmentReads, 0, 'nothing is read before the client takes the body');

      const decoded = decodeBeast2For(type)(new Uint8Array(await response.arrayBuffer()));
      assert.equal(decoded.size, 20_000);
      assert.equal(decoded.get('k019999'), 19_999n);
      assert.equal(segmentReads, segments.length, 'each segment is read once, as its bytes are sent');
    } finally {
      objects.read = read;
    }
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

/** Seeds a deployed workspace whose `.inputs.<name>` dataset holds `blob`'s
 *  segments, as they stand, under a manifest — or, `bare`, the blob itself, as
 *  an older e3 stored a collection. Reseeding the same storage replaces the
 *  workspace's package wholesale. */
async function seedDataset(
  storage: InMemoryStorage, blob: Uint8Array, name: string, type: EastType, options: { bare?: boolean } = {},
): Promise<string> {
  try {
    await storage.repos.create(REPO);
  } catch {
    // Already created by an earlier seed into this storage.
  }
  const hash = options.bare === true ? await storage.objects.write(REPO, blob) : await storeSegmentsOf(storage, REPO, blob);
  const structure = variant('struct', new Map([
    ['inputs', variant('struct', new Map([
      [name, variant('value', { type: toEastTypeValue(type), writable: true })],
    ]))],
  ]));
  const pkgHash = await storage.objects.write(REPO, encodeBeast2For(PackageObjectType)({
    tasks: new Map(),
    data: { structure, refs: new Map([[`inputs/${name}`, variant('value', { hash, versions: new Map() })]]) },
    functions: new Map(),
    records: new Map(), sources: new Map(),
  }));
  await storage.refs.workspaceWrite(REPO, WS, encodeBeast2For(WorkspaceRecordType)(some({
    packageName: 'pages', packageVersion: '1.0.0', packageHash: pkgHash, deployedAt: new Date(0), currentRunId: none,
  })));
  await storage.datasets.write(REPO, WS, `inputs/${name}`, variant('value', { hash, versions: new Map() }));
  return hash;
}

/** Seeds a deployed workspace whose `.inputs.rows` dataset holds `blob`. */
async function seedRowsDataset(storage: InMemoryStorage, blob: Uint8Array): Promise<string> {
  return seedDataset(storage, blob, 'rows', RowsType);
}

/** Counts whole-object reads of the watched objects — a dataset's segments, or
 *  a bare blob; workspace/package object reads are expected and not counted. */
function spyObjectReads(storage: InMemoryStorage, watched: Iterable<string>): { wholeReads: () => number } {
  const objects = storage.objects;
  const hashes = new Set(watched);
  let whole = 0;
  const origRead = objects.read.bind(objects);
  objects.read = (repo: string, hash: string) => {
    if (hashes.has(hash)) whole++;
    return origRead(repo, hash);
  };
  return { wholeReads: () => whole };
}

/** The segment objects a stored collection's manifest names. */
async function segmentsOf(storage: InMemoryStorage, hash: string): Promise<string[]> {
  return decodeCollectionManifest(await storage.objects.read(REPO, hash)).entries.map((entry) => entry.hash);
}

describe('setDataset (an upload, read as it arrives)', () => {
  /** The body in pieces, as a request's arrives. */
  function* pieces(bytes: Uint8Array): Generator<Uint8Array> {
    for (let at = 0; at < bytes.length; at += 4096) yield bytes.subarray(at, at + 4096);
  }

  /** The dataset's current hash. */
  async function rowsHash(storage: InMemoryStorage): Promise<string | null> {
    const ref = await storage.datasets.read(REPO, WS, 'inputs/rows');
    return ref?.type === 'value' ? ref.value.hash : null;
  }

  it('stores a collection upload as the manifest the value path writes, whatever layout the client sent', async () => {
    const storage = new InMemoryStorage();
    await seedRowsDataset(storage, encodeBeast2PagedFor(RowsType)(makeRows(10)));
    const rows = makeRows(5_000);
    const expected = await datasetWrite(storage, REPO, rows, RowsType);
    const layouts: [string, Uint8Array][] = [
      ['batched by the client', encodeInSegmentsOf(RowsType, 100)(rows)],
      ['encoded whole', encodeBeast2For(RowsType)(rows)],
    ];
    for (const [layout, bytes] of layouts) {
      const response = await setDataset(storage, REPO, WS, rowsPath, pieces(bytes));
      const answer = decodeBeast2For(ResponseType(NullType))(new Uint8Array(await response.arrayBuffer()));
      assert.equal(answer.type, 'success', `${layout}: ${JSON.stringify(answer.value)}`);
      assert.equal(await rowsHash(storage), expected, layout);
    }
  });

  it('refuses an upload of another type, and one holding a segment larger than a collection is read in, storing nothing', async () => {
    const storage = new InMemoryStorage();
    const seeded = await seedRowsDataset(storage, encodeBeast2PagedFor(RowsType)(makeRows(10)));
    const objects = await storage.objects.count(REPO);

    const drifted = await setDataset(storage, REPO, WS, rowsPath, pieces(encodeBeast2PagedFor(ArrayType(StringType))(['a'])));
    const refusal = decodeBeast2For(ResponseType(NullType))(new Uint8Array(await drifted.arrayBuffer()));
    assert.equal(refusal.type === 'error' ? refusal.value.type : refusal.type, 'dataset_type_mismatch');

    // A whole-value encode is one frame; this one declares more logical bytes
    // than the limit, and none of them follow.
    const head = encodeBeast2For(RowsType, { codec: 'none' })([]);
    const frameHeader = new Uint8Array(21);
    let at = 0;
    for (const n of [0, RUN_MAX_BYTES + 1, RUN_MAX_BYTES + 1]) {
      let v = n;
      for (; v >= 0x80; v = Math.floor(v / 128)) frameHeader[at++] = (v & 0x7f) | 0x80;
      frameHeader[at++] = v;
    }
    const oversized = await setDataset(storage, REPO, WS, rowsPath, [head.subarray(0, head.length - 5), frameHeader.subarray(0, at)]);
    const cap = decodeBeast2For(ResponseType(NullType))(new Uint8Array(await oversized.arrayBuffer()));
    assert.ok(cap.type === 'error' && cap.value.type === 'internal'
      && /more than the 67108864 a collection is read in at once/.test((cap.value.value as { message: string }).message),
      JSON.stringify(cap));

    assert.equal(await rowsHash(storage), seeded, 'the dataset keeps its value');
    assert.equal(await storage.objects.count(REPO), objects, 'nothing was stored');
  });
});

describe('getDatasetPage (segment reads)', () => {
  it('serves element windows from the segments they touch, and no others', async () => {
    const storage = new InMemoryStorage();
    const rows = makeRows(8000);
    const hash = await seedRowsDataset(storage, encodeInSegmentsOf(RowsType, 100)(rows));
    const spy = spyObjectReads(storage, await segmentsOf(storage, hash));

    const response = await getDatasetPage(storage, REPO, WS, rowsPath, { offset: 900, limit: 200 });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Total-Elements'), '8000');
    assert.equal(response.headers.get('X-Page-Offset'), '900');
    assert.equal(response.headers.get('X-Page-Count'), '200');
    const page = decodeBeast2For(RowsType)(new Uint8Array(await response.arrayBuffer()));
    assert.ok(equalFor(RowsType)(page, rows.slice(900, 1100)), 'window equals the expected slice');
    assert.equal(spy.wholeReads(), 2, 'rows 900..1099 are segments 9 and 10, and only they are read');

    // A second window on the same hash reads only its own segment.
    const deep = await getDatasetPage(storage, REPO, WS, rowsPath, { offset: 7500, limit: 100 });
    assert.equal(deep.status, 200);
    const deepPage = decodeBeast2For(RowsType)(new Uint8Array(await deep.arrayBuffer()));
    assert.ok(equalFor(RowsType)(deepPage, rows.slice(7500, 7600)));
    assert.equal(spy.wholeReads(), 3, 'the second window reads one segment');
  });

  it('clamps a window that runs past the end to the rows there are', async () => {
    const storage = new InMemoryStorage();
    const rows = makeRows(2500);
    const blob = encodeInSegmentsOf(RowsType, 100)(rows);
    await seedRowsDataset(storage, blob);

    const response = await getDatasetPage(storage, REPO, WS, rowsPath, { offset: 2400, limit: 1000 });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Page-Count'), '100', 'the tail clamps the window');
    const page = decodeBeast2For(RowsType)(new Uint8Array(await response.arrayBuffer()));
    assert.ok(equalFor(RowsType)(page, rows.slice(2400)));
  });

  it('serves segment windows and empty past-the-end windows', async () => {
    const storage = new InMemoryStorage();
    const rows = makeRows(2500);
    const blob = encodeInSegmentsOf(RowsType, 100)(rows);
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

  it('refuses a collection an older e3 stored as one blob, naming the fix, without reading it whole', async () => {
    const storage = new InMemoryStorage();
    const blob = encodeBeast2For(RowsType)(makeRows(50));
    const hash = await seedDataset(storage, blob, 'rows', RowsType, { bare: true });
    const spy = spyObjectReads(storage, [hash]);

    const response = await getDatasetPage(storage, REPO, WS, rowsPath, { offset: 0, limit: 10 });
    assert.equal(response.status, 400);
    const body = await response.json() as { error: { type: string; message: string } };
    assert.equal(body.error.type, 'dataset_not_indexed');
    assert.equal(body.error.message, `the collection ${hash} is stored as one blob: ` +
      'an older e3 wrote this repository — re-create it: deploy again and import its data again');
    assert.equal(spy.wholeReads(), 0, 'the refusal comes from the head probe, not a whole read');
  });

  it('surfaces storage failures as errors, never as dataset_not_indexed', async () => {
    const storage = new InMemoryStorage();
    // Distinct row count → distinct content hash, so the module-level
    // cache of opened datasets cannot mask the injected failure.
    const rows = makeRows(600);
    const blob = encodeInSegmentsOf(RowsType, 100)(rows);
    await seedRowsDataset(storage, blob);
    // The dataset is a manifest; the BACKEND fails at read time, and an I/O
    // failure must not read as a refusal of the layout.
    storage.objects.readRange = () => Promise.reject(new Error('injected storage failure'));

    const response = await getDatasetPage(storage, REPO, WS, rowsPath, { offset: 0, limit: 10 });
    assert.notEqual(response.status, 200);
    const body = await response.json() as { error: { type: string; message: string } };
    assert.notEqual(body.error.type, 'dataset_not_indexed',
      'an I/O failure must not masquerade as a refusal of the layout');
    assert.match(body.error.message, /injected storage failure/);
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
  // Segments of 97 put boundaries at 97, 194, … — deliberately off the
  // decimal key grid, so prefix ranges span segment boundaries.
  it('locates exact keys by fence bisect, including segment-fence rows and misses', async () => {
    const storage = new InMemoryStorage();
    const blob = encodeInSegmentsOf(LookupType, 97)(lookupOf(2500));
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
    const blob = encodeInSegmentsOf(LookupType, 97)(lookupOf(2500));
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
    const blob = encodeInSegmentsOf(LookupType, 97)(lookupOf(2500));
    const hash = await seedDataset(storage, blob, 'lookup', LookupType);
    // Warm the cache of opened datasets, then count reads: the fences come
    // with the manifest, and each segment decode is one read of its object.
    await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k0150"' });
    await findDatasetKey(storage, REPO, WS, lookupPath, { prefix: 'k01' });
    const spy = spyObjectReads(storage, await segmentsOf(storage, hash));

    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k0150"' })),
      { found: true, row: 150, count: 1 });
    assert.equal(spy.wholeReads(), 1, 'an exact find decodes exactly one segment');

    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { prefix: 'k01' })),
      { found: true, row: 100, count: 100 });
    assert.equal(spy.wholeReads(), 3, 'a boundary-spanning prefix decodes exactly the two edge segments');
  });

  it('scalar keys parse as .east literals; bad literals are key_parse_error', async () => {
    const storage = new InMemoryStorage();
    const entries = new Map(Array.from({ length: 500 }, (_, i) => [BigInt(i), `v${i}`] as const));
    const blob = encodeInSegmentsOf(IntLookupType, 97)(entries);
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
    const blob = encodeInSegmentsOf(TagsType, 97)(tags);
    await seedDataset(storage, blob, 'tags', TagsType);

    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, tagsPath, { key: '"k0123"' })),
      { found: true, row: 123, count: 1 });
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, tagsPath, { prefix: 'k00' })),
      { found: true, row: 0, count: 100 });
  });

  it('refuses non-keyed datasets and malformed queries', async () => {
    const storage = new InMemoryStorage();
    const blob = encodeInSegmentsOf(RowsType, 100)(makeRows(50));
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

  it('refuses a collection an older e3 stored as one blob, naming the fix, without reading it whole', async () => {
    const storage = new InMemoryStorage();
    const raw = encodeBeast2For(LookupType)(lookupOf(60));
    const hash = await seedDataset(storage, raw, 'lookup', LookupType, { bare: true });
    const spy = spyObjectReads(storage, [hash]);
    const refused = await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k0001"' });
    assert.equal(refused.status, 400);
    const body = await refused.json() as { error: { type: string; message: string } };
    assert.equal(body.error.type, 'dataset_not_indexed');
    assert.match(body.error.message, /is stored as one blob: an older e3 wrote this repository — re-create it/);
    assert.equal(spy.wholeReads(), 0, 'the refusal comes from the head probe, not a whole read');
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
    // Segments of 23 put boundaries all over the tuple ranges.
    const blob = encodeInSegmentsOf(MachinesType, 23)(machinesOf());
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
    const blob = encodeInSegmentsOf(MachinesType, 23)(machinesOf());
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

const PlanRowType = StructType({ due: IntegerType, title: StringType });
const PlansType = DictType(StringType, PlanRowType);
const plansPath = [variant('field', 'records'), variant('field', 'plans')];
type PlanRow = ValueTypeOf<typeof PlanRowType>;

/**
 * Seeds a deployed workspace holding an indexed record: `n` plans keyed
 * `p-000000…`, and a `by_due` index whose order scatters them — `due` is a
 * permutation of the rows, so consecutive index entries land in unrelated
 * primary segments. The index object carries only what a read resolves
 * (its key and projection types); no program runs here.
 */
async function seedIndexedRecord(storage: InMemoryStorage, n: number): Promise<{ rows: SortedMap<string, PlanRow>; primarySegments: string[] }> {
  await storage.repos.create(REPO);
  const rows = new SortedMap<string, PlanRow>(
    Array.from({ length: n }, (_, i) => [`p-${String(i).padStart(6, '0')}`,
      { due: BigInt((i * 7919) % n), title: `Plan ${i}` }] as [string, PlanRow]),
    compareFor(StringType));
  const primary = await datasetWrite(storage, REPO, rows, PlansType);
  const EntryType = StructType({ ik: IntegerType, k: StringType });
  const entries = new SortedMap<{ ik: bigint; k: string }, string>(
    [...rows].map(([k, row]) => [{ ik: row.due, k }, row.title] as [{ ik: bigint; k: string }, string]),
    compareFor(EntryType));
  const index = await datasetWrite(storage, REPO, entries, indexCollectionType(StringType, IntegerType, StringType));
  const declaration = await storage.objects.write(REPO, encodeBeast2For(RecordIndexObjectType)({
    keyIr: '0'.repeat(64), multi: false, valueIr: some('0'.repeat(64)),
    keyType: toEastTypeValue(IntegerType), valueType: toEastTypeValue(StringType),
    buildIr: '0'.repeat(64), runner: variant('east_node', { platforms: [] }),
  }));
  const state = await writeRecordState(storage, REPO, {
    primary, indexes: new Map([['by_due', { manifest: index, index: declaration }]]),
  });
  const structure = variant('struct', new Map([
    ['records', variant('struct', new Map([
      ['plans', variant('value', { type: toEastTypeValue(PlansType), writable: false })],
    ]))],
  ]));
  const pkgHash = await storage.objects.write(REPO, encodeBeast2For(PackageObjectType)({
    tasks: new Map(),
    data: { structure, refs: new Map([['records/plans', variant('value', { hash: state, versions: new Map() })]]) },
    functions: new Map(),
    records: new Map(), sources: new Map(),
  }));
  await storage.refs.workspaceWrite(REPO, WS, encodeBeast2For(WorkspaceRecordType)(some({
    packageName: 'plans', packageVersion: '1.0.0', packageHash: pkgHash, deployedAt: new Date(0), currentRunId: none,
  })));
  await storage.datasets.write(REPO, WS, 'records/plans', variant('value', { hash: state, versions: new Map() }));
  const manifest = decodeCollectionManifest(await storage.objects.read(REPO, primary));
  return { rows, primarySegments: manifest.entries.map((entry) => entry.hash) };
}

describe('getDatasetPage (index reads)', () => {
  it('a joined page reads each primary segment it needs once, and serves the window whole', async () => {
    const storage = new InMemoryStorage();
    const { rows, primarySegments } = await seedIndexedRecord(storage, 12_000);
    assert.ok(primarySegments.length > 3, `the record spans segments, got ${primarySegments.length}`);

    const reads = new Map<string, number>();
    const objects = storage.objects;
    const read = objects.read.bind(objects);
    objects.read = (repo: string, hash: string) => {
      if (primarySegments.includes(hash)) reads.set(hash, (reads.get(hash) ?? 0) + 1);
      return read(repo, hash);
    };
    const response = await getDatasetPage(storage, REPO, WS, plansPath, { offset: 100, limit: 200, index: 'by_due', join: true });
    objects.read = read;
    assert.equal(response.status, 200, await response.clone().text());

    // The window is the index's rows 100..299, in INDEX order, each joined to
    // its row — never shortened to bound the join: a client concatenates
    // windows at their offsets, so a short one would silently drop rows.
    const window = decodeBeast2For(indexWindowType(StringType, IntegerType, StringType, PlanRowType) as never)(
      new Uint8Array(await response.arrayBuffer())) as Array<{ ik: bigint; key: string; value: string; row: { type: string; value: PlanRow } }>;
    const expected = [...rows].sort(([ka, a], [kb, b]) => compareFor(IntegerType)(a.due, b.due) || compareFor(StringType)(ka, kb)).slice(100, 300);
    assert.equal(window.length, 200);
    assert.equal(response.headers.get('X-Page-Count'), '200');
    window.forEach((entry, i) => {
      const [key, row] = expected[i]!;
      assert.equal(entry.key, key);
      assert.equal(entry.ik, row.due);
      assert.equal(entry.value, row.title);
      assert.ok(entry.row.type === 'some' && equalFor(PlanRowType)(entry.row.value, row), `row ${i} joined`);
    });

    // Scattered keys touch many segments; each is read once, however many of
    // the window's rows it holds.
    assert.ok(reads.size > 1, 'the window scatters across the record');
    assert.deepEqual([...reads.values()].filter((count) => count !== 1), [], 'every touched segment is read exactly once');
  });

  it('an unjoined page never touches the primary', async () => {
    const storage = new InMemoryStorage();
    const { primarySegments } = await seedIndexedRecord(storage, 3000);
    const objects = storage.objects;
    const read = objects.read.bind(objects);
    const touched: string[] = [];
    objects.read = (repo: string, hash: string) => {
      if (primarySegments.includes(hash)) touched.push(hash);
      return read(repo, hash);
    };
    const response = await getDatasetPage(storage, REPO, WS, plansPath, { offset: 0, limit: 50, index: 'by_due' });
    objects.read = read;
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(touched, [], 'a covering read is the index alone');
  });
});
