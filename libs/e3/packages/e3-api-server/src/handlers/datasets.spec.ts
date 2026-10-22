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
  OptionType,
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
  printFor,
  some,
  toEastTypeValue,
  variant,
  type EastType,
  type ValueTypeOf,
} from '@elaraai/east';
import { computeHash, datasetWrite, InMemoryTransferBackend, readRecordState, writeRecordState } from '@elaraai/e3-core';
import { InMemoryStorage, encodeInSegmentsOf, storeSegmentsOf } from '@elaraai/e3-core/test';
import {
  BEAST2_CONTENT_TYPE, PackageObjectType, RecordIndexObjectType, WorkspaceRecordType, datasetRowsType, decodeCollectionManifest,
  encodeCollectionManifest, indexCollectionType, indexWindowType,
} from '@elaraai/e3-types';
import { Hono } from 'hono';
import { ResponseType } from '../types.js';
import { createDatasetRoutes } from '../routes/datasets.js';
import { createTransferRoutes } from '../routes/transfer.js';
import { findDatasetKey, getDataset, setDataset, type DatasetFindQuery } from './datasets.js';
// The page and batch handlers through the handlers entry, as a host reaches them.
import {
  decodedSegmentStats, findDatasetKeys, getDatasetPage, getDatasetRows, getDatasetRuns, getValuePage, placeDatasetRuns, withinDatasetRuns,
  type DatasetPageWindow, type DatasetPlacedSegment, type KeySearchQuery, type PinnedCache,
} from './index.js';

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

  it('answers a caller asking for segments with the manifest to download, and any other value as before', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);
    const type = DictType(StringType, IntegerType);
    const hash = await datasetWrite(storage, REPO, new Map([['a', 1n], ['b', 2n]]), type);
    await storage.datasets.write(REPO, WS, 'inputs/lookup', variant('value', { hash, versions: new Map() }));
    const small = await storage.objects.write(REPO, encodeBeast2For(StringType)('small value'));
    await storage.datasets.write(REPO, WS, 'inputs/small', variant('value', { hash: small, versions: new Map() }));

    const response = await getDataset(storage, REPO, WS, [variant('field', 'inputs'), variant('field', 'lookup')], undefined, undefined, undefined, true);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/json');
    assert.equal(response.headers.get('X-Content-SHA256'), hash);
    assert.deepEqual(await response.json(), { manifest: hash });

    const inline = await getDataset(storage, REPO, WS, [variant('field', 'inputs'), variant('field', 'small')], undefined, undefined, undefined, true);
    assert.equal(inline.headers.get('Content-Type'), BEAST2_CONTENT_TYPE);
    assert.equal(computeHash(new Uint8Array(await inline.arrayBuffer())), small);
  });

  it('names an indexed record\'s primary as the manifest to download', async () => {
    const storage = new InMemoryStorage();
    const { rows } = await seedIndexedRecord(storage, 500);
    const state = await storage.datasets.read(REPO, WS, 'records/plans');
    assert.ok(state?.type === 'value');

    const response = await getDataset(storage, REPO, WS, plansPath, undefined, undefined, undefined, true);
    assert.equal(response.headers.get('X-Content-SHA256'), state.value.hash, 'the dataset is the record\'s state');
    assert.deepEqual(await response.json(), { manifest: await datasetWrite(storage, REPO, rows, PlansType) });
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

describe('getValuePage (a stored value, by its hash)', () => {
  it('answers each window of a value with the body and headers a page of a dataset holding it answers with', async () => {
    const storage = new InMemoryStorage();
    const rows = makeRows(2500);
    const hash = await seedRowsDataset(storage, encodeInSegmentsOf(RowsType, 100)(rows));
    const windows: DatasetPageWindow[] = [
      { offset: 900, limit: 200 },
      { offset: 2400, limit: 1000 },
      { offset: 5000, limit: 10 },
      { segment: 3 },
      { offset: 0, limit: 5, hash },
    ];
    for (const window of windows) {
      const byDataset = await getDatasetPage(storage, REPO, WS, rowsPath, window);
      const byValue = await getValuePage(storage, REPO, hash, toEastTypeValue(RowsType), window);
      assert.equal(byValue.status, 200, `${JSON.stringify(window)}: ${await byValue.clone().text()}`);
      assert.deepEqual(Object.fromEntries(byValue.headers), Object.fromEntries(byDataset.headers), JSON.stringify(window));
      assert.deepEqual(new Uint8Array(await byValue.arrayBuffer()), new Uint8Array(await byDataset.arrayBuffer()), JSON.stringify(window));
    }
  });

  it('pages a value no dataset holds, and refuses a stale pin, a type it cannot page and an index window', async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create(REPO);
    const lookup = lookupOf(500);
    const hash = await datasetWrite(storage, REPO, lookup, LookupType);
    const type = toEastTypeValue(LookupType);

    const page = await getValuePage(storage, REPO, hash, type, { offset: 100, limit: 50, hash });
    assert.equal(page.status, 200, await page.clone().text());
    assert.equal(page.headers.get('X-Content-SHA256'), hash);
    assert.equal(page.headers.get('Cache-Control'), 'private, max-age=31536000, immutable', 'a window pinned to the value is content-addressed');
    assert.equal(page.headers.get('X-Total-Elements'), '500');
    assert.equal(page.headers.get('X-Page-Offset'), '100');
    assert.equal(page.headers.get('X-Page-Count'), '50');
    const window = decodeBeast2For(LookupType)(new Uint8Array(await page.arrayBuffer()));
    assert.ok(equalFor(LookupType)(window, new SortedMap([...lookup].slice(100, 150), compareFor(StringType))),
      'the window is the value\'s rows 100..149');

    /** A refusal's status and JSON error. */
    const refusal = async (response: Response): Promise<{ status: number; type: string; sha: string | null }> => ({
      status: response.status,
      type: (await response.json() as { error: { type: string } }).error.type,
      sha: response.headers.get('X-Content-SHA256'),
    });
    assert.deepEqual(await refusal(await getValuePage(storage, REPO, hash, type, { offset: 0, limit: 10, hash: '0'.repeat(64) })),
      { status: 409, type: 'dataset_hash_mismatch', sha: hash }, 'a pin to another hash names the value\'s');
    assert.deepEqual(await refusal(await getValuePage(storage, REPO, hash, toEastTypeValue(StringType), { offset: 0 })),
      { status: 400, type: 'dataset_not_pageable', sha: null });
    assert.deepEqual(await refusal(await getValuePage(storage, REPO, hash, type, { index: 'by_due' })),
      { status: 400, type: 'bad_request', sha: null }, 'an index window is a record dataset\'s');
  });
});
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

  it('decodes at most the touched segments — one for exact, two for a spanning prefix — and keeps them', async () => {
    const storage = new InMemoryStorage();
    const blob = encodeInSegmentsOf(LookupType, 97)(lookupOf(2500));
    const hash = await seedDataset(storage, blob, 'lookup', LookupType);
    // The fences come with the manifest, so a bisect reads nothing, and each
    // segment decode is one read of its object.
    const spy = spyObjectReads(storage, await segmentsOf(storage, hash));

    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k0150"' })),
      { found: true, row: 150, count: 1 });
    assert.equal(spy.wholeReads(), 1, 'an exact find decodes exactly one segment: rows 97..193');

    // k01__ is rows 100..199: its lower bound is in the segment the key was,
    // which is kept, and its upper bound in the next, rows 194..290.
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { prefix: 'k01' })),
      { found: true, row: 100, count: 100 });
    assert.equal(spy.wholeReads(), 2, 'a boundary-spanning prefix decodes the edge segment not yet kept');

    // Asked again, both answer from the kept segments.
    await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k0150"' }));
    await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { prefix: 'k01' }));
    assert.equal(spy.wholeReads(), 2, 'a segment decoded once is never read again while it is kept');
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
    assert.match(prefixBody.error.message, /String or Option<String> keys/);
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
    assert.equal(pinned.headers.get('Cache-Control'), 'private, max-age=31536000, immutable');
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
/** The `by_status` index's key, which many rows share. */
const PlanStatusKeyType = StructType({ status: StringType, week: IntegerType });
const plansPath = [variant('field', 'records'), variant('field', 'plans')];
type PlanRow = ValueTypeOf<typeof PlanRowType>;

/**
 * Seeds a deployed workspace holding an indexed record: `n` plans keyed
 * `p-000000…`, and two indexes. `by_due`'s order scatters them — `due` is a
 * permutation of the rows, so consecutive index entries land in unrelated
 * primary segments. `by_status` keys each row by a status and a week its
 * `due` picks, so a key is a run of rows: for `n` a multiple of 30, a third
 * of them per status, `done` then `late` then `open`, and a tenth of a
 * status's per week. An index object carries only what a read resolves (its
 * key and projection types); no program runs here.
 */
async function seedIndexedRecord(
  storage: InMemoryStorage, n: number,
): Promise<{ rows: SortedMap<string, PlanRow>; primary: string; primarySegments: string[]; statusSegments: string[]; dueSegments: string[] }> {
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
    buildIr: '0'.repeat(64), runner: variant('east_node', { platforms: [], decode: variant('lazy', null) }),
    form: variant('entries', null),
  }));
  const StatusEntryType = StructType({ ik: PlanStatusKeyType, k: StringType });
  type StatusEntry = ValueTypeOf<typeof StatusEntryType>;
  const statusEntries = new SortedMap<StatusEntry, string>(
    [...rows].map(([k, row]) => [
      { ik: { status: ['done', 'late', 'open'][Number(row.due % 3n)]!, week: row.due % 10n }, k }, row.title,
    ] as [StatusEntry, string]),
    compareFor(StatusEntryType));
  const statusIndex = await datasetWrite(storage, REPO, statusEntries, indexCollectionType(StringType, PlanStatusKeyType, StringType));
  const statusDeclaration = await storage.objects.write(REPO, encodeBeast2For(RecordIndexObjectType)({
    keyIr: '0'.repeat(64), multi: false, valueIr: some('0'.repeat(64)),
    keyType: toEastTypeValue(PlanStatusKeyType), valueType: toEastTypeValue(StringType),
    buildIr: '0'.repeat(64), runner: variant('east_node', { platforms: [], decode: variant('lazy', null) }),
    form: variant('entries', null),
  }));
  const state = await writeRecordState(storage, REPO, {
    primary, indexes: new Map([
      ['by_due', { manifest: index, index: declaration }],
      ['by_status', { manifest: statusIndex, index: statusDeclaration }],
    ]),
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
  return {
    rows,
    primary,
    primarySegments: manifest.entries.map((entry) => entry.hash),
    statusSegments: await segmentsOf(storage, statusIndex),
    dueSegments: await segmentsOf(storage, index),
  };
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

/** A summary index's key (#1039): a week, then a press. */
const PressWeekType = StructType({ __tile: IntegerType, press: StringType });
/** Its entries' keys: each stands for every row of its key, so names none. */
const PressWeekEntryType = StructType({ ik: PressWeekType, k: NullType });
/** Its totals. */
const TotalsType = StructType({ count: IntegerType, ms: IntegerType });
type PressWeekEntry = ValueTypeOf<typeof PressWeekEntryType>;
type Totals = ValueTypeOf<typeof TotalsType>;

describe('a summary index (#1039)', () => {
  /**
   * The `plans` record of `seedIndexedRecord`, with a summary beside its
   * indexes: `presses` presses by `weeks` weeks, each total its own count and
   * milliseconds. Its entries are `{ik, k: Null}`: one stands for many rows.
   */
  async function seedSummary(storage: InMemoryStorage, presses: number, weeks: number): Promise<SortedMap<PressWeekEntry, Totals>> {
    await seedIndexedRecord(storage, 300);
    const ref = await storage.datasets.read(REPO, WS, 'records/plans');
    assert.ok(ref?.type === 'value');
    const totals = new SortedMap<PressWeekEntry, Totals>(undefined, compareFor(PressWeekEntryType));
    for (let week = 0; week < weeks; week++) {
      for (let p = 0; p < presses; p++) {
        totals.set({ ik: { __tile: BigInt(week), press: `P-${String(p).padStart(4, '0')}` }, k: null }, { count: BigInt(week + p + 1), ms: BigInt((week + p) * 1000) });
      }
    }
    const manifest = await datasetWrite(storage, REPO, totals, indexCollectionType(NullType, PressWeekType, TotalsType));
    const summary = await storage.objects.write(REPO, encodeBeast2For(RecordIndexObjectType)({
      keyIr: '0'.repeat(64), multi: true, valueIr: none,
      keyType: toEastTypeValue(PressWeekType), valueType: toEastTypeValue(TotalsType),
      buildIr: '0'.repeat(64), runner: variant('east_node', { platforms: [], decode: variant('lazy', null) }),
      form: variant('summary', { mergeIr: '1'.repeat(64) }),
    }));
    const held = await readRecordState(storage, REPO, ref.value.hash);
    const state = await writeRecordState(storage, REPO, {
      primary: held.primary, indexes: new Map([...held.indexes, ['by_press_week', { manifest, index: summary }]]),
    });
    await storage.datasets.write(REPO, WS, 'records/plans', variant('value', { hash: state, versions: new Map() }));
    return totals;
  }

  /** A summary's window, as e3 answers it: `indexWindowType` with a Null `key`. */
  const SummaryWindowType = ArrayType(StructType({ ik: PressWeekType, key: NullType, value: TotalsType, row: OptionType(PlanRowType) }));
  const decodeSummaryWindow = decodeBeast2For(SummaryWindowType);

  it('pages its totals as an index page, each entry naming no row, and answers a block\'s search and its runs', async () => {
    const storage = new InMemoryStorage();
    const totals = await seedSummary(storage, 50, 12);
    const state = await stateOf(storage);
    const page = await getDatasetPage(storage, REPO, WS, plansPath, { offset: 0, limit: 600, index: 'by_press_week' });
    assert.equal(page.status, 200, await page.clone().text());
    const window = decodeSummaryWindow(new Uint8Array(await page.arrayBuffer()));
    assert.equal(window.length, 600);
    const unjoined = equalFor(OptionType(PlanRowType));
    for (const [i, [entry, value]] of [...totals].entries()) {
      const read = window[i]!;
      assert.ok(equalFor(PressWeekType)(read.ik, entry.ik) && equalFor(TotalsType)(read.value, value), `total ${i}`);
      assert.ok(equalFor(NullType)(read.key, null), 'a summary\'s entry names no row');
      assert.ok(unjoined(read.row, none));
    }

    // A block: week 3's presses P-0010 to P-0019, one contiguous run of the summary.
    const { results } = await batchJson<{ results: { found: boolean; row: number; count: number }[] }>(await findDatasetKeys(storage, REPO, WS, plansPath, {
      queries: [{ from: ['3', '"P-0010"'], to: ['3', '"P-0020"'] }], index: 'by_press_week', hash: state,
    }));
    assert.deepEqual(results, [{ found: true, row: 3 * 50 + 10, count: 10 }]);
    const runs = await getDatasetRuns(storage, REPO, WS, plansPath, { runs: [[results[0]!.row, results[0]!.count]], hash: state, index: 'by_press_week' });
    assert.equal(runs.status, 200, await runs.clone().text());
    const block = decodeSummaryWindow(new Uint8Array(await runs.arrayBuffer()));
    assert.deepEqual(block.map((entry) => entry.ik.press), Array.from({ length: 10 }, (_, i) => `P-${String(10 + i).padStart(4, '0')}`));
    assert.ok(block.every((entry) => equalFor(IntegerType)(entry.ik.__tile, 3n)), 'all in week 3');
  });

  it('refuses a joined read of it, a page or runs, naming it: its entries name no row to join', async () => {
    const storage = new InMemoryStorage();
    await seedSummary(storage, 10, 4);
    const state = await stateOf(storage);
    for (const response of [
      await getDatasetPage(storage, REPO, WS, plansPath, { offset: 0, limit: 10, index: 'by_press_week', join: true }),
      await getDatasetRuns(storage, REPO, WS, plansPath, { runs: [[0, 5]], hash: state, index: 'by_press_week', join: true }),
    ]) {
      const refused = await refusalOf(response);
      assert.deepEqual([refused.status, refused.type], [400, 'bad_request']);
      assert.match(refused.message, /^index 'by_press_week' of 'records\/plans' is a summary: each entry stands for every row of its key and names none to join — read it without join$/);
    }
    // The record's other indexes still join.
    assert.equal((await getDatasetPage(storage, REPO, WS, plansPath, { offset: 0, limit: 10, index: 'by_due', join: true })).status, 200);
  });
});

describe('findDatasetKey (through an index)', () => {
  it('takes the index key: an exact key is every entry under it, and a prefix or leading fields a run of them', async () => {
    const storage = new InMemoryStorage();
    const { statusSegments } = await seedIndexedRecord(storage, 12_000);
    assert.ok(statusSegments.length > 3, `the index spans segments, got ${statusSegments.length}`);
    const byStatus = async (query: DatasetFindQuery): Promise<{ found: boolean; row: number; count: number }> =>
      findJson(await findDatasetKey(storage, REPO, WS, plansPath, { ...query, index: 'by_status' }));

    // `done` is rows 0..3999, `late` 4000..7999 and `open` 8000..11999, and
    // a status's weeks are 400 rows apiece.
    assert.deepEqual(await byStatus({ key: '(status="late", week=3)' }), { found: true, row: 5200, count: 400 });
    assert.deepEqual(await byStatus({ key: '(status="late", week=12)' }), { found: false, row: 8000, count: 0 });
    assert.deepEqual(await byStatus({ fields: ['"late"'] }), { found: true, row: 4000, count: 4000 });
    assert.deepEqual(await byStatus({ fields: ['"late"', '3'] }), { found: true, row: 5200, count: 400 });
    // A prefix types ahead on the index key's first field.
    assert.deepEqual(await byStatus({ prefix: 'l' }), { found: true, row: 4000, count: 4000 });
    // A range still bounds the collection's flattened key, `ik`'s fields first.
    assert.deepEqual(await byStatus({ from: ['"late"', '3'], to: ['"late"', '5'] }), { found: true, row: 5200, count: 800 });

    // `due` is a permutation, so each of its keys is one entry, at the row of its own value.
    assert.deepEqual(await findJson(await findDatasetKey(storage, REPO, WS, plansPath, { key: '42', index: 'by_due' })),
      { found: true, row: 42, count: 1 });
  });

  it('refuses a form the index key cannot take, naming the index, and an index the record does not declare', async () => {
    const storage = new InMemoryStorage();
    await seedIndexedRecord(storage, 300);
    const refusal = async (query: DatasetFindQuery): Promise<{ status: number; error: { type: string; message: string } }> => {
      const response = await findDatasetKey(storage, REPO, WS, plansPath, query);
      return { status: response.status, ...await response.json() as { error: { type: string; message: string } } };
    };

    // A prefix continues the index key's own fields, never the collection's `ik`.
    const intPrefix = await refusal({ fields: ['"late"'], prefix: '3', index: 'by_status' });
    assert.equal(intPrefix.status, 400);
    assert.match(intPrefix.error.message, /prefix continues key field 'week', which is Integer, not String/);
    assert.match((await refusal({ prefix: '4', index: 'by_due' })).error.message,
      /prefix search needs String or Option<String> keys; the keys of index 'by_due' are Integer/);
    // The collection's own key is not the index's.
    assert.equal((await refusal({ key: '(ik=42, k="p-000042")', index: 'by_due' })).error.type, 'key_parse_error');

    const missing = await refusal({ key: '42', index: 'nope' });
    assert.equal(missing.status, 404);
    assert.equal(missing.error.type, 'index_not_found');
    assert.match(missing.error.message, /has no index 'nope' — it has by_due, by_status/);
  });
});

describe('who may keep an answer pinned to a hash', () => {
  it('is the caller\'s own cache alone, unless the host lets any cache keep it: a page, a value\'s page, an index page and a key search', async () => {
    const storage = new InMemoryStorage();
    const hash = await seedDataset(storage, encodeInSegmentsOf(LookupType, 97)(lookupOf(500)), 'lookup', LookupType);
    const records = new InMemoryStorage();
    await seedIndexedRecord(records, 300);
    const state = await records.datasets.read(REPO, WS, 'records/plans');
    assert.ok(state?.type === 'value');

    /** Each pinned answer's Cache-Control, as a host that names `cache` serves it. */
    const controls = async (cache?: PinnedCache): Promise<(string | null)[]> => {
      const limits = cache === undefined ? undefined : { cache };
      const answers = [
        await getDatasetPage(storage, REPO, WS, lookupPath, { offset: 0, limit: 10, hash }, limits),
        await getValuePage(storage, REPO, hash, toEastTypeValue(LookupType), { offset: 0, limit: 10, hash }, limits),
        await getDatasetPage(records, REPO, WS, plansPath, { offset: 0, limit: 10, index: 'by_due', hash: state.value.hash }, limits),
        await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k0007"', hash }, limits ?? {}),
      ];
      for (const answer of answers) assert.equal(answer.status, 200, await answer.clone().text());
      return answers.map((answer) => answer.headers.get('Cache-Control'));
    };
    const kept = (by: string): string[] => Array.from({ length: 4 }, () => `${by}, max-age=31536000, immutable`);
    assert.deepEqual(await controls(), kept('private'));
    assert.deepEqual(await controls('private'), kept('private'));
    assert.deepEqual(await controls('public'), kept('public'));
  });

  it('is what the dataset routes\' options say', async () => {
    const storage = new InMemoryStorage();
    const hash = await seedDataset(storage, encodeInSegmentsOf(LookupType, 97)(lookupOf(500)), 'lookup', LookupType);
    for (const [cache, by] of [[undefined, 'private'], ['public', 'public']] as const) {
      const app = new Hono();
      app.route('/api/repos/:repo/workspaces/:ws/datasets', createDatasetRoutes(storage, () => REPO, undefined, cache === undefined ? {} : { cache }));
      for (const query of [`page=true&offset=0&limit=10&hash=${hash}`, `find=true&key="k0007"&hash=${hash}`]) {
        const answer = await app.request(`/api/repos/${REPO}/workspaces/${WS}/datasets/inputs/lookup?${query}`);
        assert.equal(answer.status, 200, `${query}: ${await answer.clone().text()}`);
        assert.equal(answer.headers.get('Cache-Control'), `${by}, max-age=31536000, immutable`, `${cache}: ${query}`);
      }
    }
  });
});

/** Counts whole-object reads of each watched object, by its hash. */
function spyReadsByObject(storage: InMemoryStorage, watched: Iterable<string>): { reads: Map<string, number>; total: () => number; restore: () => void } {
  const objects = storage.objects;
  const hashes = new Set(watched);
  const reads = new Map<string, number>();
  const read = objects.read.bind(objects);
  objects.read = (repo: string, hash: string) => {
    if (hashes.has(hash)) reads.set(hash, (reads.get(hash) ?? 0) + 1);
    return read(repo, hash);
  };
  return {
    reads,
    total: () => [...reads.values()].reduce((sum, n) => sum + n, 0),
    restore: () => { objects.read = read; },
  };
}

/** A batch's JSON answer, asserting it is a 200. */
async function batchJson<T>(response: Response): Promise<T> {
  assert.equal(response.status, 200, `batch failed: ${await response.clone().text()}`);
  return await response.json() as T;
}

/** A refusal's status, its JSON error and the content hash it names. */
async function refusalOf(response: Response): Promise<{ status: number; type: string; message: string; sha: string | null }> {
  const { error } = await response.json() as { error: { type: string; message: string } };
  return { status: response.status, type: error.type, message: error.message, sha: response.headers.get('X-Content-SHA256') };
}

/** The `by_status` index window, as e3 answers it. */
const decodeStatusWindow = decodeBeast2For(indexWindowType(StringType, PlanStatusKeyType, StringType, PlanRowType) as never) as
  (bytes: Uint8Array) => Array<{ ik: { status: string; week: bigint }; key: string; value: string; row: ReturnType<typeof some<PlanRow>> | typeof none }>;
const StatusWindowType = indexWindowType(StringType, PlanStatusKeyType, StringType, PlanRowType);

/** The state hash an indexed record's dataset holds. */
async function stateOf(storage: InMemoryStorage): Promise<string> {
  const state = await storage.datasets.read(REPO, WS, 'records/plans');
  assert.ok(state?.type === 'value');
  return state.value.hash;
}

describe('findDatasetKeys (several key searches in one request)', () => {
  it('answers each query as findDatasetKey does, in the order asked, at one hash', async () => {
    const storage = new InMemoryStorage();
    await seedIndexedRecord(storage, 12_000);
    const state = await stateOf(storage);
    const byStatus: KeySearchQuery[] = [
      { key: '(status="late", week=3)' },
      { key: '(status="late", week=12)' },
      { fields: ['"late"'] },
      { fields: ['"late"', '3'] },
      { prefix: 'l' },
      { prefix: 'z' },
      { from: ['"late"', '3'], to: ['"late"', '5'] },
      { from: ['"open"'] },
      { to: ['"done"', '2'] },
      { key: '(status="late", week=3)' },
    ];
    const answer = await batchJson<{ results: { found: boolean; row: number; count: number }[] }>(
      await findDatasetKeys(storage, REPO, WS, plansPath, { queries: byStatus, index: 'by_status', hash: state }));
    const expected = [];
    for (const query of byStatus) expected.push(await findJson(await findDatasetKey(storage, REPO, WS, plansPath, { ...query, index: 'by_status' })));
    assert.deepEqual(answer.results, expected);
    assert.deepEqual(answer.results[0], { found: true, row: 5200, count: 400 }, 'a key through an index is every entry under it');

    // The record's own keys: a key, a miss between keys, a prefix and a range.
    const byKey: KeySearchQuery[] = [{ key: '"p-000042"' }, { key: '"p-000042x"' }, { prefix: 'p-0001' }, { from: ['"p-000100"'], to: ['"p-000110"'] }];
    const own = await findDatasetKeys(storage, REPO, WS, plansPath, { queries: byKey });
    assert.equal(own.headers.get('X-Content-SHA256'), state);
    assert.equal(own.headers.get('Cache-Control'), 'no-store', 'a POST is no cache\'s to keep');
    const ownExpected = [];
    for (const query of byKey) ownExpected.push(await findJson(await findDatasetKey(storage, REPO, WS, plansPath, query)));
    assert.deepEqual((await batchJson<{ results: unknown[] }>(own)).results, ownExpected);
    assert.deepEqual(ownExpected[1], { found: false, row: 43, count: 0 }, 'a miss answers its insertion row');
  });

  it('reads each segment its searches land in once, however many land in it', async () => {
    const storage = new InMemoryStorage();
    const { statusSegments } = await seedIndexedRecord(storage, 12_000);
    const spy = spyReadsByObject(storage, statusSegments);
    // Fifty searches, two bounds each, inside `late`'s weeks 3 and 4.
    const queries: KeySearchQuery[] = Array.from({ length: 50 }, (_, i) => ({ from: ['"late"', '3', `"p-${String(i * 7).padStart(6, '0')}"`], to: ['"late"', '4'] }));
    try {
      const { results } = await batchJson<{ results: { found: boolean; row: number; count: number }[] }>(
        await findDatasetKeys(storage, REPO, WS, plansPath, { queries, index: 'by_status' }));
      assert.equal(results.length, 50);
      assert.ok(results.every((result) => result.found), 'every search names a run of `late` week 3');
      assert.deepEqual([...spy.reads.values()].filter((n) => n !== 1), [], 'every segment touched is read exactly once');
      assert.ok(spy.total() > 0 && spy.total() <= 3, `a hundred bounds in two weeks' entries read the few segments they lie in, read ${spy.total()}`);
      const before = spy.total();
      await batchJson(await findDatasetKeys(storage, REPO, WS, plansPath, { queries, index: 'by_status' }));
      assert.equal(spy.total(), before, 'asked again, the batch reads nothing: its segments are kept');
    } finally {
      spy.restore();
    }
  });

  it('refuses more than 10,000 queries, a query a single search refuses — naming its place — and a stale pin', async () => {
    const storage = new InMemoryStorage();
    await seedIndexedRecord(storage, 300);
    const state = await stateOf(storage);
    const many = await refusalOf(await findDatasetKeys(storage, REPO, WS, plansPath,
      { queries: Array.from({ length: 10_001 }, () => ({ key: '"p-000001"' })) }));
    assert.deepEqual([many.status, many.type], [400, 'bad_request']);
    assert.match(many.message, /at most 10000 queries; this one has 10001/);

    const intPrefix = await refusalOf(await findDatasetKeys(storage, REPO, WS, plansPath,
      { queries: [{ key: '(status="late", week=3)' }, { fields: ['"late"'], prefix: '3' }], index: 'by_status' }));
    assert.deepEqual([intPrefix.status, intPrefix.type], [400, 'bad_request']);
    assert.match(intPrefix.message, /^query 1: prefix continues key field 'week', which is Integer, not String/);
    const badLiteral = await refusalOf(await findDatasetKeys(storage, REPO, WS, plansPath, { queries: [{ key: 'p-1' }] }));
    assert.deepEqual([badLiteral.status, badLiteral.type], [400, 'key_parse_error']);
    assert.match(badLiteral.message, /^query 0: /);

    const stale = await refusalOf(await findDatasetKeys(storage, REPO, WS, plansPath, { queries: [{ key: '"p-000001"' }], hash: '0'.repeat(64) }));
    assert.deepEqual([stale.status, stale.type, stale.sha], [409, 'dataset_hash_mismatch', state]);
    const missing = await refusalOf(await findDatasetKeys(storage, REPO, WS, plansPath, { queries: [], index: 'nope' }));
    assert.deepEqual([missing.status, missing.type], [404, 'index_not_found']);
    assert.deepEqual(await batchJson(await findDatasetKeys(storage, REPO, WS, plansPath, { queries: [] })), { results: [] });
  });
});

const decodeRows = decodeBeast2For(datasetRowsType(StringType, PlanRowType)) as
  (bytes: Uint8Array) => Array<{ key: string; row: ReturnType<typeof some<PlanRow>> | typeof none; position: bigint }>;
const OptionRowType = OptionType(PlanRowType);

describe('getDatasetRows (the rows of several keys in one request)', () => {
  it('answers each key\'s row, or its absence, and its position as a search and a one-row page give them', async () => {
    const storage = new InMemoryStorage();
    const { rows } = await seedIndexedRecord(storage, 3000);
    const state = await stateOf(storage);
    const keys = ['p-002999', 'p-000000', 'p-001500x', 'p-001234', 'a', 'z', 'p-001234', 'p-000097'];
    const response = await getDatasetRows(storage, REPO, WS, plansPath, { keys: keys.map((key) => printKey(key)), hash: state });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('X-Content-SHA256'), state);
    assert.equal(response.headers.get('X-Page-Count'), String(keys.length));
    assert.equal(response.headers.get('X-Total-Elements'), '3000');
    const answers = decodeRows(new Uint8Array(await response.arrayBuffer()));
    assert.equal(answers.length, keys.length);
    for (const [i, key] of keys.entries()) {
      const found = await findJson(await findDatasetKey(storage, REPO, WS, plansPath, { key: printKey(key) }));
      const answer = answers[i]!;
      assert.equal(answer.key, key, `key ${i} answers the key asked`);
      assert.equal(answer.position, BigInt(found.row), `key ${i}'s position is a search's row`);
      if (!found.found) {
        assert.ok(equalFor(OptionRowType)(answer.row, none), `key ${i} is absent`);
        continue;
      }
      const page = await getDatasetPage(storage, REPO, WS, plansPath, { offset: found.row, limit: 1 });
      const held = [...decodeBeast2For(PlansType)(new Uint8Array(await page.arrayBuffer()))];
      assert.ok(equalFor(OptionRowType)(answer.row, some(held[0]![1])), `key ${i}'s row is a one-row page's`);
      assert.ok(equalFor(OptionRowType)(answer.row, some(rows.get(key)!)));
    }
  });

  it('reads each segment its keys lie in once', async () => {
    const storage = new InMemoryStorage();
    const { primary, primarySegments } = await seedIndexedRecord(storage, 12_000);
    const keys = Array.from({ length: 400 }, (_, i) => `p-${String((i * 6007) % 12_000).padStart(6, '0')}`);
    const cumulative: number[] = [];
    let sum = 0;
    for (const entry of decodeCollectionManifest(await storage.objects.read(REPO, primary)).entries) {
      sum += Number(entry.count);
      cumulative.push(sum);
    }
    const spy = spyReadsByObject(storage, primarySegments);
    try {
      const response = await getDatasetRows(storage, REPO, WS, plansPath, { keys: keys.map((key) => printKey(key)) });
      const answers = decodeRows(new Uint8Array(await response.arrayBuffer()));
      assert.ok(answers.every((answer) => answer.row.type === 'some'), 'every key is held');
      const holding = new Set<number>();
      for (const answer of answers) holding.add(cumulative.findIndex((end) => Number(answer.position) < end));
      assert.deepEqual([...spy.reads.values()].filter((n) => n !== 1), [], 'every segment touched is read exactly once');
      assert.equal(spy.total(), holding.size, 'the keys read exactly the segments holding them');
    } finally {
      spy.restore();
    }
  });

  it('holds the answer to the byte budget, answering the keys it reached in order', async () => {
    const storage = new InMemoryStorage();
    await seedIndexedRecord(storage, 300);
    const response = await getDatasetRows(storage, REPO, WS, plansPath, { keys: ['"p-000010"', '"p-000020"', '"p-000030"'] }, { byteBudget: 1 });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('X-Page-Count'), '1');
    const answers = decodeRows(new Uint8Array(await response.arrayBuffer()));
    assert.deepEqual(answers.map((answer) => answer.key), ['p-000010'], 'the first key, the one the budget reached');
  });

  it('refuses more than 10,000 keys, a key that is no literal of the key type — naming its place — another kind of dataset, and a stale pin', async () => {
    const storage = new InMemoryStorage();
    await seedIndexedRecord(storage, 300);
    const state = await stateOf(storage);
    const many = await refusalOf(await getDatasetRows(storage, REPO, WS, plansPath, { keys: Array.from({ length: 10_001 }, () => '"p"') }));
    assert.deepEqual([many.status, many.type], [400, 'bad_request']);
    const bad = await refusalOf(await getDatasetRows(storage, REPO, WS, plansPath, { keys: ['"p-000001"', 'p-000002'] }));
    assert.deepEqual([bad.status, bad.type], [400, 'key_parse_error']);
    assert.match(bad.message, /^key 1: /);
    const stale = await refusalOf(await getDatasetRows(storage, REPO, WS, plansPath, { keys: ['"p-000001"'], hash: '0'.repeat(64) }));
    assert.deepEqual([stale.status, stale.type, stale.sha], [409, 'dataset_hash_mismatch', state]);

    const arrays = new InMemoryStorage();
    await seedDataset(arrays, encodeInSegmentsOf(RowsType, 100)(makeRows(50)), 'rows', RowsType);
    const notDict = await refusalOf(await getDatasetRows(arrays, REPO, WS, rowsPath, { keys: ['1'] }));
    assert.deepEqual([notDict.status, notDict.type], [400, 'dataset_not_searchable']);
  });
});

/** A String key's `.east` literal. */
function printKey(key: string): string {
  return JSON.stringify(key);
}

describe('getDatasetRuns (the entries of several runs in one request)', () => {
  it('answers each run\'s entries through an index as by-offset index pages give them, joined or not', async () => {
    const storage = new InMemoryStorage();
    await seedIndexedRecord(storage, 12_000);
    const state = await stateOf(storage);
    const runs: [number, number][] = [[100, 50], [4000, 30], [5199, 2], [11_990, 10]];
    for (const join of [false, true]) {
      const response = await getDatasetRuns(storage, REPO, WS, plansPath, { runs, hash: state, index: 'by_status', join });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get('X-Page-Count'), '92');
      assert.equal(response.headers.get('X-Run-Entries'), '92');
      assert.equal(response.headers.get('X-Window-Index'), 'by_status');
      assert.equal(response.headers.get('X-Window-Joined'), join ? 'true' : null);
      const window = decodeStatusWindow(new Uint8Array(await response.arrayBuffer()));
      const expected: unknown[] = [];
      for (const [offset, limit] of runs) {
        const page = await getDatasetPage(storage, REPO, WS, plansPath, { offset, limit, index: 'by_status', join });
        expected.push(...decodeStatusWindow(new Uint8Array(await page.arrayBuffer())));
      }
      assert.ok(equalFor(StatusWindowType)(window as never, expected as never), `the runs' entries, in order (join ${join})`);
    }
  });

  it('reads each segment the runs touch once, and each record segment a join needs once', async () => {
    const storage = new InMemoryStorage();
    const { primarySegments, dueSegments } = await seedIndexedRecord(storage, 12_000);
    const state = await stateOf(storage);
    // `by_due` scatters the record: a run's keys land all over it.
    const runs: [number, number][] = [[0, 400], [3000, 300], [9000, 600]];
    const spy = spyReadsByObject(storage, [...primarySegments, ...dueSegments]);
    try {
      const response = await getDatasetRuns(storage, REPO, WS, plansPath, { runs, hash: state, index: 'by_due', join: true });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get('X-Page-Count'), '1300');
      assert.deepEqual([...spy.reads.values()].filter((n) => n !== 1), [], 'every segment touched is read exactly once');
      assert.ok([...spy.reads.keys()].some((hash) => primarySegments.includes(hash)), 'the join reads the record');
      assert.ok([...spy.reads.keys()].some((hash) => dueSegments.includes(hash)), 'the runs read the index');
    } finally {
      spy.restore();
    }
  });

  it('answers runs of the dataset\'s own rows as a value of its type, holding exactly those rows', async () => {
    const storage = new InMemoryStorage();
    const { rows } = await seedIndexedRecord(storage, 3000);
    const state = await stateOf(storage);
    const runs: [number, number][] = [[0, 3], [96, 4], [2990, 10]];
    const response = await getDatasetRuns(storage, REPO, WS, plansPath, { runs, hash: state });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('X-Window-Index'), null);
    const value = decodeBeast2For(PlansType)(new Uint8Array(await response.arrayBuffer()));
    const all = [...rows];
    const expected = new SortedMap(runs.flatMap(([row, count]) => all.slice(row, row + count)), compareFor(StringType));
    assert.ok(equalFor(PlansType)(value, expected), 'the union of the runs, in the record\'s order');
  });

  it('cuts an answer at a page\'s bounds, saying how many it holds of how many, and the rest reads on', async () => {
    const storage = new InMemoryStorage();
    await seedIndexedRecord(storage, 12_000);
    const state = await stateOf(storage);
    const runs: [number, number][] = [[0, 6000], [6000, 6000]];
    const first = await getDatasetRuns(storage, REPO, WS, plansPath, { runs, hash: state, index: 'by_status' });
    assert.equal(first.status, 200, await first.clone().text());
    assert.equal(first.headers.get('X-Page-Count'), '10000', 'a page holds at most 10,000 entries');
    assert.equal(first.headers.get('X-Run-Entries'), '12000');
    const head = decodeStatusWindow(new Uint8Array(await first.arrayBuffer()));
    // The rest: the runs named, less the 10,000 entries in hand.
    const rest = await getDatasetRuns(storage, REPO, WS, plansPath, { runs: [[10_000, 2000]], hash: state, index: 'by_status' });
    const tail = decodeStatusWindow(new Uint8Array(await rest.arrayBuffer()));
    const whole = await getDatasetPage(storage, REPO, WS, plansPath, { offset: 10_000, limit: 2000, index: 'by_status' });
    assert.ok(equalFor(StatusWindowType)(tail as never, decodeStatusWindow(new Uint8Array(await whole.arrayBuffer())) as never));
    assert.equal(head.length + tail.length, 12_000);

    const budget = await getDatasetRuns(storage, REPO, WS, plansPath, { runs: [[0, 10], [20, 10]], hash: state, index: 'by_status' }, { byteBudget: 1 });
    assert.equal(budget.headers.get('X-Page-Count'), '1', 'the byte budget clamps the entries too');
    assert.equal(budget.headers.get('X-Run-Entries'), '20');
  });

  it('refuses runs that are not ascending, disjoint and inside, more than 10,000 of them, a join with no index, and a stale pin', async () => {
    const storage = new InMemoryStorage();
    await seedIndexedRecord(storage, 300);
    const state = await stateOf(storage);
    const refused = async (runs: [number, number][], extra: { index?: string; join?: boolean } = {}) =>
      refusalOf(await getDatasetRuns(storage, REPO, WS, plansPath, { runs, hash: state, ...extra }));
    assert.match((await refused([[10, 5], [12, 3]])).message, /run 1 starts at row 12, before the run before it ends \(15\)/);
    assert.match((await refused([[290, 20]])).message, /run 0 ends at row 310, past the collection's 300 rows/);
    assert.match((await refused([[3, 0]])).message, /run 0 is \[3, 0\]/);
    assert.match((await refused([[-1, 2]])).message, /run 0 is \[-1, 2\]/);
    assert.equal((await refused(Array.from({ length: 10_001 }, (_, i) => [i, 1] as [number, number]))).type, 'bad_request');
    assert.match((await refused([[0, 1]], { join: true })).message, /name the index/);
    assert.deepEqual(await refused([[0, 1]], { index: 'nope' }).then((r) => [r.status, r.type]), [404, 'index_not_found']);
    const stale = await refusalOf(await getDatasetRuns(storage, REPO, WS, plansPath, { runs: [[0, 1]], hash: '0'.repeat(64) }));
    assert.deepEqual([stale.status, stale.type, stale.sha], [409, 'dataset_hash_mismatch', state]);
  });
});

/** The `by_due` index window, as e3 answers it. */
const DueWindowType = indexWindowType(StringType, IntegerType, StringType, PlanRowType);
const decodeDueWindow = decodeBeast2For(DueWindowType as never) as (bytes: Uint8Array) => Array<{ ik: bigint; key: string }>;
/** An entry key of the `by_status` index: its index key beside the row's key. */
const StatusEntryKeyType = StructType({ ik: PlanStatusKeyType, k: StringType });
const printStatusEntryKey = printFor(StatusEntryKeyType);

/** The rows each of a stored collection's segments ends before, by its manifest. */
async function cumulativeOf(storage: InMemoryStorage, manifest: string): Promise<number[]> {
  const out: number[] = [];
  let sum = 0;
  for (const entry of decodeCollectionManifest(await storage.objects.read(REPO, manifest)).entries) {
    sum += Number(entry.count);
    out.push(sum);
  }
  return out;
}

/** Where some index entries' rows sit, worked out from the record's rows: each segment holding some, with how many. */
function placementOf(keys: readonly string[], rows: SortedMap<string, PlanRow>, cumulative: readonly number[]): DatasetPlacedSegment[] {
  const positions = new Map([...rows.keys()].map((key, i) => [key, i]));
  const held = new Map<number, number>();
  for (const key of keys) {
    const segment = cumulative.findIndex((end) => positions.get(key)! < end);
    held.set(segment, (held.get(segment) ?? 0) + 1);
  }
  return [...held].sort((a, b) => a[0] - b[0]).map(([segment, count]) => ({
    segment, offset: segment === 0 ? 0 : cumulative[segment - 1]!, count: cumulative[segment]! - (segment === 0 ? 0 : cumulative[segment - 1]!), rows: count,
  }));
}

/** Adds windows' placements up, segment by segment. */
function sumPlacements(placements: readonly DatasetPlacedSegment[][]): DatasetPlacedSegment[] {
  const held = new Map<number, DatasetPlacedSegment>();
  for (const segment of placements.flat()) {
    const known = held.get(segment.segment);
    held.set(segment.segment, known === undefined ? { ...segment } : { ...known, rows: known.rows + segment.rows });
  }
  return [...held.values()].sort((a, b) => a.segment - b.segment);
}

type Placement = { segments: DatasetPlacedSegment[]; placed: number };

describe('placeDatasetRuns (where a narrowing\'s runs of an index sit in its record)', () => {
  it('places each entry of the runs in the record segment that holds its row, reading each index segment once and no record segment', async () => {
    const storage = new InMemoryStorage();
    const { rows, primary, primarySegments, dueSegments } = await seedIndexedRecord(storage, 12_000);
    const state = await stateOf(storage);
    // `by_due` scatters the record: a run's rows land all over it.
    const runs: [number, number][] = [[0, 400], [3000, 300], [9000, 600]];
    const spy = spyReadsByObject(storage, [...primarySegments, ...dueSegments]);
    let answer: Placement;
    try {
      const response = await placeDatasetRuns(storage, REPO, WS, plansPath, { index: 'by_due', runs, hash: state });
      assert.equal(response.headers.get('X-Content-SHA256'), state);
      assert.equal(response.headers.get('Cache-Control'), 'no-store', 'a POST is no cache\'s to keep');
      assert.equal(response.headers.get('X-Run-Entries'), '1300');
      assert.equal(response.headers.get('X-Total-Elements'), '12000', 'the record\'s rows');
      answer = await batchJson<Placement>(response);
      assert.deepEqual([...spy.reads.keys()].filter((hash) => primarySegments.includes(hash)), [], 'the record\'s fences place each row: no record segment is read');
      assert.ok(spy.total() > 0, 'the index\'s segments are read');
      assert.deepEqual([...spy.reads.values()].filter((n) => n !== 1), [], 'each index segment touched is read once');
    } finally {
      spy.restore();
    }
    assert.equal(answer.placed, 1300);
    const read = await getDatasetRuns(storage, REPO, WS, plansPath, { runs, hash: state, index: 'by_due' });
    const keys = decodeDueWindow(new Uint8Array(await read.arrayBuffer())).map((entry) => entry.key);
    assert.deepEqual(answer.segments, placementOf(keys, rows, await cumulativeOf(storage, primary)));
    assert.ok(answer.segments.length > 3, `the runs' rows scatter across the record, in ${answer.segments.length} segments`);
  });

  it('places a window of the runs at a time, within a page\'s bounds, the windows adding up to the whole', async () => {
    const storage = new InMemoryStorage();
    const { rows, primary } = await seedIndexedRecord(storage, 12_000);
    const state = await stateOf(storage);
    const place = async (runs: [number, number][], window: { offset?: number; limit?: number } = {}, byteBudget?: number) =>
      batchJson<Placement>(await placeDatasetRuns(storage, REPO, WS, plansPath, { index: 'by_status', runs, hash: state, ...window },
        byteBudget === undefined ? {} : { byteBudget }));
    // `late` is rows 4000..7999 of `by_status`, and `open`'s week 0 is 8000..8399.
    const runs: [number, number][] = [[4000, 4000], [8000, 400]];
    const whole = await place(runs);
    assert.equal(whole.placed, 4400);
    const read = await getDatasetRuns(storage, REPO, WS, plansPath, { runs, hash: state, index: 'by_status' });
    assert.deepEqual(whole.segments, placementOf(decodeStatusWindow(new Uint8Array(await read.arrayBuffer())).map((entry) => entry.key), rows,
      await cumulativeOf(storage, primary)));

    const windows: DatasetPlacedSegment[][] = [];
    for (let offset = 0; offset < 4400;) {
      const window = await place(runs, { offset, limit: 777 });
      assert.ok(window.placed > 0 && window.placed <= 777, `a window places at most its limit, placed ${window.placed}`);
      windows.push(window.segments);
      offset += window.placed;
    }
    assert.equal(windows.length, 6);
    assert.deepEqual(sumPlacements(windows), whole.segments, 'the windows add up to the whole, segment by segment');

    assert.deepEqual(await place(runs, { offset: 4400 }), { segments: [], placed: 0 }, 'past the runs\' end, nothing');
    assert.equal((await place(runs, {}, 1)).placed, 1, 'the byte budget clamps a window');
    const capped = await place([[0, 12_000]]);
    assert.equal(capped.placed, 10_000, 'a window places a page\'s 10,000 entries at most');
    const rest = await place([[0, 12_000]], { offset: capped.placed });
    assert.equal(rest.placed, 2000, 'and the rest places on from there');
    assert.equal(sumPlacements([capped.segments, rest.segments]).reduce((sum, segment) => sum + segment.rows, 0), 12_000);
    assert.deepEqual(sumPlacements([capped.segments, rest.segments]).map((segment) => segment.rows),
      sumPlacements([capped.segments, rest.segments]).map((segment) => segment.count), 'the whole index places every row of every segment');
  });

  it('refuses runs that are not ascending, disjoint and inside the index, more than 10,000 of them, a bad window, an index the record lacks, and a stale pin', async () => {
    const storage = new InMemoryStorage();
    await seedIndexedRecord(storage, 300);
    const state = await stateOf(storage);
    const refused = async (request: Partial<Parameters<typeof placeDatasetRuns>[4]>) =>
      refusalOf(await placeDatasetRuns(storage, REPO, WS, plansPath, { index: 'by_status', runs: [[0, 1]], hash: state, ...request }));
    assert.match((await refused({ runs: [[10, 5], [12, 3]] })).message, /run 1 starts at row 12, before the run before it ends \(15\)/);
    assert.match((await refused({ runs: [[290, 20]] })).message, /run 0 ends at row 310, past the collection's 300 rows/);
    assert.match((await refused({ runs: [[3, 0]] })).message, /run 0 is \[3, 0\]/);
    const many = await refused({ runs: Array.from({ length: 10_001 }, (_, i) => [i, 1] as [number, number]) });
    assert.deepEqual([many.status, many.type], [400, 'bad_request']);
    assert.match(many.message, /at most 10000 runs; this one has 10001/);
    assert.match((await refused({ offset: -1 })).message, /offset -1 is not a row at least 0/);
    assert.match((await refused({ limit: 1.5 })).message, /limit 1.5 is not a count at least 0/);
    const missing = await refused({ index: 'nope' });
    assert.deepEqual([missing.status, missing.type], [404, 'index_not_found']);
    const stale = await refused({ hash: '0'.repeat(64) });
    assert.deepEqual([stale.status, stale.type, stale.sha], [409, 'dataset_hash_mismatch', state]);
    // Ten thousand runs, the most a placement takes, place as one.
    const big = new InMemoryStorage();
    await seedIndexedRecord(big, 12_000);
    const most = await batchJson<Placement>(await placeDatasetRuns(big, REPO, WS, plansPath,
      { index: 'by_due', runs: Array.from({ length: 10_000 }, (_, i) => [i, 1] as [number, number]), hash: await stateOf(big) }));
    assert.equal(most.placed, 10_000);
  });
});

describe('withinDatasetRuns (which entries a narrowing\'s runs of an index hold)', () => {
  it('answers whether each entry lies in one of the runs, reading at most two index segments a run and no record segment', async () => {
    const storage = new InMemoryStorage();
    const { rows, primarySegments, statusSegments } = await seedIndexedRecord(storage, 12_000);
    const state = await stateOf(storage);
    // One `late` row's entry, `late`'s week 3, and every `open` entry.
    const runs: [number, number][] = [[4000, 1], [5200, 400], [8000, 4000]];
    const held = new Set<string>();
    const read = await getDatasetRuns(storage, REPO, WS, plansPath, { runs, hash: state, index: 'by_status' });
    for (const entry of decodeStatusWindow(new Uint8Array(await read.arrayBuffer()))) held.add(printStatusEntryKey({ ik: entry.ik, k: entry.key }));
    // A row's entry key, as the index files it: its status and week, then its key.
    const sampled = [...rows].filter((_, i) => i % 37 === 0).map(([k, row]) =>
      printStatusEntryKey({ ik: { status: ['done', 'late', 'open'][Number(row.due % 3n)]!, week: row.due % 10n }, k }));
    assert.ok(sampled.some((key) => held.has(key)) && sampled.some((key) => !held.has(key)), 'the keys are in and out of the runs');
    // Each run's first and last entries, and those just outside it: where a slip at a run's edge shows.
    const edges = [...new Set(runs.flatMap(([row, count]) => [row - 1, row, row + count - 1, row + count]))]
      .filter((row) => row >= 0 && row < 12_000).sort((a, b) => a - b);
    const edgeRead = await getDatasetRuns(storage, REPO, WS, plansPath, { runs: edges.map((row): [number, number] => [row, 1]), hash: state, index: 'by_status' });
    const edgeKeys = decodeStatusWindow(new Uint8Array(await edgeRead.arrayBuffer())).map((entry) => printStatusEntryKey({ ik: entry.ik, k: entry.key }));
    assert.equal(edgeKeys.length, edges.length);
    const keys = [...sampled, ...edgeKeys];

    const fresh = new InMemoryStorage();
    await seedIndexedRecord(fresh, 12_000);
    const spy = spyReadsByObject(fresh, [...primarySegments, ...statusSegments]);
    try {
      const response = await withinDatasetRuns(fresh, REPO, WS, plansPath, { index: 'by_status', runs, keys, hash: await stateOf(fresh) });
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      const { within } = await batchJson<{ within: boolean[] }>(response);
      assert.deepEqual(within, keys.map((key) => held.has(key)), 'each key is in the runs exactly when a read of them holds it');
      assert.deepEqual(within.slice(sampled.length), edges.map((row) => runs.some(([start, count]) => row >= start && row < start + count)),
        'each run holds its first and last entries, and not those beside it');
      assert.deepEqual([...spy.reads.keys()].filter((hash) => primarySegments.includes(hash)), [], 'no record segment is read');
      assert.ok(spy.total() > 0 && spy.total() <= 2 * runs.length, `the runs' first and last entries lie in at most two segments a run, read ${spy.total()}`);
      assert.deepEqual([...spy.reads.values()].filter((n) => n !== 1), [], 'each read once');
    } finally {
      spy.restore();
    }
  });

  it('refuses more than 10,000 keys or runs, runs not of the index, a key that is no entry key — naming its place — an index the record lacks, and a stale pin', async () => {
    const storage = new InMemoryStorage();
    await seedIndexedRecord(storage, 300);
    const state = await stateOf(storage);
    const refused = async (request: Partial<Parameters<typeof withinDatasetRuns>[4]>) =>
      refusalOf(await withinDatasetRuns(storage, REPO, WS, plansPath, { index: 'by_status', runs: [[0, 10]], keys: [], hash: state, ...request }));
    const manyKeys = await refused({ keys: Array.from({ length: 10_001 }, () => '(ik=(status="late", week=1), k="p-000001")') });
    assert.match(manyKeys.message, /at most 10000 keys; this one has 10001/);
    assert.match((await refused({ runs: Array.from({ length: 10_001 }, (_, i) => [i, 1] as [number, number]) })).message, /at most 10000 runs/);
    assert.match((await refused({ runs: [[5, 5], [8, 2]] })).message, /run 1 starts at row 8/);
    const bad = await refused({ keys: ['(ik=(status="late", week=1), k="p-000001")', '(status="late", week=1)'] });
    assert.deepEqual([bad.status, bad.type], [400, 'key_parse_error']);
    assert.match(bad.message, /^key 1: /, 'an index key alone is no entry key');
    const missing = await refused({ index: 'nope' });
    assert.deepEqual([missing.status, missing.type], [404, 'index_not_found']);
    const stale = await refused({ hash: '0'.repeat(64) });
    assert.deepEqual([stale.status, stale.type, stale.sha], [409, 'dataset_hash_mismatch', state]);
    assert.deepEqual(await batchJson(await withinDatasetRuns(storage, REPO, WS, plansPath, { index: 'by_status', runs: [], keys: ['(ik=(status="late", week=1), k="p-000001")'], hash: state })),
      { within: [false] }, 'no run holds anything');
  });
});

describe('the batch routes', () => {
  /** An app mounting the dataset routes behind the transfer routes, as every server does. */
  function serverOf(storage: InMemoryStorage, options: Parameters<typeof createDatasetRoutes>[3] = {}): Hono {
    const app = new Hono();
    const prefix = '/api/repos/:repo/workspaces/:ws/datasets';
    app.route(prefix, createTransferRoutes(storage, () => REPO, new InMemoryTransferBackend({ baseUrl: '' })).api);
    app.route(prefix, createDatasetRoutes(storage, () => REPO, undefined, options));
    return app;
  }
  const post = (app: Hono, query: string, body: unknown): Response | Promise<Response> =>
    app.request(`/api/repos/${REPO}/workspaces/${WS}/datasets/records/plans?${query}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('answer a POST naming its batch, past the transfer routes, as their handlers do', async () => {
    const storage = new InMemoryStorage();
    await seedIndexedRecord(storage, 300);
    const state = await stateOf(storage);
    const app = serverOf(storage);
    const found = await batchJson<{ results: { found: boolean; row: number; count: number }[] }>(
      await post(app, `findKeys=true&index=by_status&hash=${state}`, { queries: [{ fields: ['"late"'] }, { key: '(status="late", week=3)' }] }));
    assert.deepEqual(found.results, (await batchJson<{ results: unknown[] }>(await findDatasetKeys(storage, REPO, WS, plansPath,
      { queries: [{ fields: ['"late"'] }, { key: '(status="late", week=3)' }], index: 'by_status', hash: state }))).results);

    const rows = await post(app, `rows=true&hash=${state}`, { keys: ['"p-000007"', '"nope"'] });
    assert.equal(rows.status, 200, await rows.clone().text());
    assert.deepEqual(decodeRows(new Uint8Array(await rows.arrayBuffer())).map((answer) => [answer.key, answer.row.type]),
      [['p-000007', 'some'], ['nope', 'none']]);

    const runs = await post(app, `runs=true&index=by_status&join=true&hash=${state}`, { runs: [[0, 5], [100, 5]] });
    assert.equal(runs.status, 200, await runs.clone().text());
    assert.equal(runs.headers.get('X-Page-Count'), '10');
    assert.equal(runs.headers.get('X-Window-Joined'), 'true');

    // A page's byte budget holds a batch's answer too.
    const tight = serverOf(storage, { pageByteBudget: 1 });
    assert.equal((await post(tight, `rows=true&hash=${state}`, { keys: ['"p-000007"', '"p-000008"'] })).headers.get('X-Page-Count'), '1');
  });

  it('refuse a body not of the batch\'s form, a read of runs pinned to nothing, and two batches at once, and leave every other POST to no route', async () => {
    const storage = new InMemoryStorage();
    await seedIndexedRecord(storage, 300);
    const app = serverOf(storage);
    const refused = async (query: string, body: unknown) => refusalOf(await post(app, query, body));
    assert.match((await refused('findKeys=true', 'not json')).message, /^The body is not JSON/);
    assert.match((await refused('findKeys=true', { keys: [] })).message, /is \{ "queries": \[ … \] \}/);
    assert.match((await refused('findKeys=true', { queries: [{ key: 7 }] })).message, /query 0's key is not a string/);
    assert.match((await refused('findKeys=true', { queries: [{ index: 'x' }] })).message, /query 0 names index/);
    assert.match((await refused('rows=true', { keys: [1] })).message, /is \{ "keys": \[/);
    assert.match((await refused('runs=true&hash=x', { runs: [[1]] })).message, /run 0 is not \[row, count\]/);
    assert.match((await refused('runs=true', { runs: [] })).message, /names the content hash its runs are positions at/);
    assert.match((await refused('rows=true&findKeys=true', { keys: [] })).message, /Ask for one batch/);
    const other = await post(app, '', {});
    assert.equal(other.status, 404, 'a POST naming no batch is no route');
  });

  it('answer a placement and a membership read as their handlers do, and refuse their bodies\' wrong forms', async () => {
    const storage = new InMemoryStorage();
    await seedIndexedRecord(storage, 3000);
    const state = await stateOf(storage);
    const app = serverOf(storage);
    const placed = await batchJson<Placement>(await post(app, `place=true&hash=${state}`, { index: 'by_status', runs: [[0, 100], [1000, 50]], offset: 20, limit: 70 }));
    assert.deepEqual(placed, await batchJson<Placement>(await placeDatasetRuns(storage, REPO, WS, plansPath,
      { index: 'by_status', runs: [[0, 100], [1000, 50]], offset: 20, limit: 70, hash: state })));
    assert.equal(placed.placed, 70);
    const key = '(ik=(status="done", week=0), k="p-000000")';
    const within = await batchJson<{ within: boolean[] }>(await post(app, `within=true&hash=${state}`, { index: 'by_status', runs: [[0, 100]], keys: [key] }));
    assert.deepEqual(within, await batchJson(await withinDatasetRuns(storage, REPO, WS, plansPath, { index: 'by_status', runs: [[0, 100]], keys: [key], hash: state })));

    const refused = async (query: string, body: unknown) => refusalOf(await post(app, query, body));
    assert.match((await refused('place=true', { index: 'by_status', runs: [] })).message, /A placement names the content hash its runs are positions at/);
    assert.match((await refused('within=true', { index: 'by_status', runs: [], keys: [] })).message, /A membership read names the content hash/);
    assert.match((await refused(`place=true&hash=${state}`, { runs: [] })).message, /A placement names the index its runs are rows of/);
    assert.match((await refused(`within=true&hash=${state}`, { index: '', runs: [], keys: [] })).message, /A membership read names the index/);
    assert.match((await refused(`place=true&hash=${state}`, { index: 'by_status', runs: [[1]] })).message, /run 0 is not \[row, count\]/);
    assert.match((await refused(`place=true&hash=${state}`, { index: 'by_status', runs: [], offset: '1' })).message, /offset is a number/);
    assert.match((await refused(`within=true&hash=${state}`, { index: 'by_status', runs: [] })).message, /A membership read is \{ "index"/);
    assert.match((await refused(`place=true&within=true&hash=${state}`, {})).message, /Ask for one batch/);
  });
});

describe('the decoded segments the API process keeps', () => {
  it('serve a window read again, and a search in a segment a window decoded, with nothing read', async () => {
    const storage = new InMemoryStorage();
    const blob = encodeInSegmentsOf(LookupType, 97)(lookupOf(2500));
    const hash = await seedDataset(storage, blob, 'lookup', LookupType);
    const spy = spyReadsByObject(storage, await segmentsOf(storage, hash));
    const decodes = decodedSegmentStats().decodes;
    try {
      const window = await getDatasetPage(storage, REPO, WS, lookupPath, { offset: 150, limit: 100 });
      assert.equal(window.status, 200);
      assert.equal(spy.total(), 2, 'rows 150..249 lie in two segments');
      assert.equal(decodedSegmentStats().decodes - decodes, 2, 'each decoded once');
      const again = await getDatasetPage(storage, REPO, WS, lookupPath, { offset: 150, limit: 100 });
      assert.deepEqual(new Uint8Array(await again.arrayBuffer()), new Uint8Array(await window.arrayBuffer()), 'the same bytes');
      await findJson(await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k0200"' }));
      assert.equal(spy.total(), 2, 'the window again and the search in its segments read nothing');
    } finally {
      spy.restore();
    }
  });

  it('read a segment two requests ask for at once once, for both', async () => {
    const storage = new InMemoryStorage();
    const blob = encodeInSegmentsOf(LookupType, 97)(lookupOf(2500));
    const hash = await seedDataset(storage, blob, 'lookup', LookupType);
    const spy = spyReadsByObject(storage, await segmentsOf(storage, hash));
    try {
      const [a, b] = await Promise.all([
        findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k1000"' }),
        findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k1001"' }),
      ]);
      assert.deepEqual([await findJson(a), await findJson(b)], [{ found: true, row: 1000, count: 1 }, { found: true, row: 1001, count: 1 }]);
      assert.equal(spy.total(), 1, 'one segment holds both keys, and it is read once');
    } finally {
      spy.restore();
    }
  });

  it('refuse a collection whose manifest names its segments out of order, naming them, for a window, a segment and a search', async () => {
    const storage = new InMemoryStorage();
    const blob = encodeInSegmentsOf(LookupType, 97)(lookupOf(500));
    const hash = await seedDataset(storage, blob, 'lookup', LookupType);
    // The manifest's fences stay; segments 1 and 2 are named in each other's place.
    const manifest = decodeCollectionManifest(await storage.objects.read(REPO, hash));
    const entries = [...manifest.entries];
    [entries[1], entries[2]] = [{ ...entries[1]!, hash: entries[2]!.hash }, { ...entries[2]!, hash: entries[1]!.hash }];
    const swapped = await storage.objects.write(REPO, encodeCollectionManifest({ ...manifest, entries }));
    await storage.datasets.write(REPO, WS, 'inputs/lookup', variant('value', { hash: swapped, versions: new Map() }));

    const window = await refusalOf(await getDatasetPage(storage, REPO, WS, lookupPath, { offset: 90, limit: 20 }));
    assert.deepEqual([window.status, window.type], [400, 'dataset_not_canonical']);
    assert.match(window.message, /segment 1's first key is not its fence/);
    const segment = await refusalOf(await getDatasetPage(storage, REPO, WS, lookupPath, { segment: 2 }));
    assert.deepEqual([segment.status, segment.type], [400, 'dataset_not_segmented']);
    const search = await refusalOf(await findDatasetKey(storage, REPO, WS, lookupPath, { key: '"k0100"' }));
    assert.deepEqual([search.status, search.type], [400, 'dataset_not_canonical']);
  });
});
