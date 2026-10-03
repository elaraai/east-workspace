/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for the dataset key-search client call, and a collection's download.
 *
 * `datasetFindKey` is the client half of the fence-backed find endpoint:
 * these tests pin the request shape (the `find` query and its exactly-one
 * of key/prefix parameters, hash pinning), the JSON result decoding with
 * the content hash lifted off the headers, and the error mapping the
 * paged preview relies on (typed ApiError codes, AuthError on 401).
 *
 * `datasetGet` downloads a collection as the objects its manifest names and
 * splices them: these tests pin that the splice is the value's blob, that an
 * object answered by URL is fetched without the API's auth, and that an object
 * which does not hash to its name is refused. `datasetGetStream`, which it is
 * built on, hands the splice over as it goes, a few segments ahead. Given a
 * `fetch`, every request of a download goes through it — the URLs a large
 * object or value is answered with among them — and none through the global
 * one.
 *
 * A dataset can move while it is read, and the old value's objects then be
 * refused: these tests pin that `datasetGet` starts over from the new content,
 * at most 3 times, and that `datasetGetStream` starts over only before it
 * returns, raising the move once it has handed out a hash. A dataset that has
 * not moved raises the read's own error, and a manifest above level 0 is
 * refused before a segment is read.
 *
 * A host that serves a value it names by hash — a record's state at a past
 * commit, say — reads it through the same calls: `objectGet` for one object,
 * `collectionGetStream` for a collection by its manifest's hash, and
 * `parsePage` for a page of it, which `datasetGetPage` reads its own with.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  Beast2ManifestWriter, DictType, IntegerType, SortedMap, StringType, compareFor, decodeCollectionManifest, encodeBeast2PagedFor, encodeCollectionManifest,
  sha256Hex, variant,
} from '@elaraai/east';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-types';
import { datasetFindKey, datasetGet, datasetGetPage, datasetGetStream } from './datasets.js';
import { ApiError, AuthError, DatasetHashMismatchError } from './http.js';
// Through the root entry, as a host reaches them.
import { collectionGetStream, objectGet, parsePage } from './index.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const BASE = 'https://example.test';
const HASH = 'f'.repeat(64);
const lookupPath = [variant('field', 'inputs'), variant('field', 'lookup')];

/** A global fetch that fails any request that reaches it. */
function refuseGlobalFetch(): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    throw new Error(`the global fetch was called for ${String(input)}`);
  }) as typeof fetch;
}

/** Installs a fetch mock returning `respond()` and recording request URLs. */
function mockFetch(respond: () => globalThis.Response): { urls: string[] } {
  const state = { urls: [] as string[] };
  globalThis.fetch = (async (input: string | URL | Request) => {
    state.urls.push(input instanceof Request ? input.url : String(input));
    return respond();
  }) as typeof fetch;
  return state;
}

describe('datasetFindKey', () => {
  it('addresses the find endpoint and returns the row placement plus content hash', async () => {
    const m = mockFetch(() => new Response(JSON.stringify({ found: true, row: 150, count: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Content-SHA256': HASH },
    }));
    const result = await datasetFindKey(BASE, 'my repo', 'ws', lookupPath, { key: '"k0150"', hash: HASH }, { token: null });
    assert.deepEqual(result, { found: true, row: 150, count: 1, hash: HASH });

    const url = new URL(m.urls[0]!);
    assert.equal(url.pathname, '/api/repos/my%20repo/workspaces/ws/datasets/inputs/lookup');
    assert.equal(url.searchParams.get('find'), 'true');
    assert.equal(url.searchParams.get('key'), '"k0150"');
    assert.equal(url.searchParams.get('hash'), HASH);
    assert.equal(url.searchParams.get('prefix'), null, 'exactly one of key/prefix goes on the wire');
  });

  it('sends prefix queries without a key parameter', async () => {
    const m = mockFetch(() => new Response(JSON.stringify({ found: true, row: 100, count: 27 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Content-SHA256': HASH },
    }));
    const result = await datasetFindKey(BASE, 'r', 'ws', lookupPath, { prefix: 'k01' }, { token: null });
    assert.equal(result.row, 100);
    assert.equal(result.count, 27);

    const url = new URL(m.urls[0]!);
    assert.equal(url.searchParams.get('prefix'), 'k01');
    assert.equal(url.searchParams.get('key'), null);
    assert.equal(url.searchParams.get('hash'), null, 'unpinned queries carry no hash');
  });

  it('sends struct leading-field literals as repeated field params, with an optional prefix', async () => {
    const m = mockFetch(() => new Response(JSON.stringify({ found: true, row: 120, count: 10 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Content-SHA256': HASH },
    }));
    const result = await datasetFindKey(BASE, 'r', 'ws', lookupPath, { fields: ['"press"', '"L2"'], prefix: 'x' }, { token: null });
    assert.equal(result.row, 120);

    const url = new URL(m.urls[0]!);
    assert.deepEqual(url.searchParams.getAll('field'), ['"press"', '"L2"']);
    assert.equal(url.searchParams.get('prefix'), 'x');
    assert.equal(url.searchParams.get('key'), null);
  });

  it('maps server refusals to ApiError with the server type and detail', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: { type: 'key_parse_error', message: 'bad literal' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }));
    await assert.rejects(
      datasetFindKey(BASE, 'r', 'ws', lookupPath, { key: 'nope' }, { token: null }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
        assert.equal(err.code, 'key_parse_error');
        assert.match(String(err.details), /bad literal/);
        return true;
      },
    );
  });

  it('maps 401 to AuthError', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: { type: 'unauthorized', message: 'token expired' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }));
    await assert.rejects(
      datasetFindKey(BASE, 'r', 'ws', lookupPath, { key: '"a"' }, { token: null }),
      (err: unknown) => err instanceof AuthError,
    );
  });

  it('names the hash the dataset moved on to when a pinned read is refused, for a search and a page', async () => {
    const current = 'a'.repeat(64);
    mockFetch(() => new Response(JSON.stringify({ error: { type: 'dataset_hash_mismatch', message: `Dataset content is ${current}, not ${HASH}` } }), {
      status: 409,
      headers: { 'Content-Type': 'application/json', 'X-Content-SHA256': current },
    }));
    const moved = (err: unknown): boolean => {
      assert.ok(err instanceof DatasetHashMismatchError, `expected DatasetHashMismatchError, got ${String(err)}`);
      assert.ok(err instanceof ApiError, 'it is still an ApiError');
      assert.equal(err.code, 'dataset_hash_mismatch');
      assert.equal(err.currentHash, current);
      return true;
    };
    await assert.rejects(datasetFindKey(BASE, 'r', 'ws', lookupPath, { key: '"a"', hash: HASH }, { token: null }), moved);
    await assert.rejects(datasetGetPage(BASE, 'r', 'ws', lookupPath, { offset: 0, limit: 10, hash: HASH }, { token: null }), moved);
  });
});

/** A collection as a server stores it — every object by its hash, the
 *  manifest's own among them — and the blob its splice is: `length` keys,
 *  each holding its index plus `first`, so another `first` is another value. */
function storedCollection(
  { first = 0, length = 20_000 }: { first?: number; length?: number } = {},
): { objects: Map<string, Uint8Array>; manifest: string; segments: string[]; blob: Uint8Array } {
  const type = DictType(StringType, IntegerType);
  const value = new SortedMap(
    Array.from({ length }, (_, i) => [`k${String(i).padStart(6, '0')}`, BigInt(first + i)] as [string, bigint]),
    compareFor(StringType));
  const objects = new Map<string, Uint8Array>();
  let manifest = '';
  const writer = new Beast2ManifestWriter(type, {
    object: (hash, bytes) => objects.set(hash, bytes),
    manifest: (bytes) => {
      manifest = sha256Hex(bytes);
      objects.set(manifest, bytes);
    },
  });
  for (const entry of value.entries()) writer.add(entry);
  writer.finish();
  const segments = decodeCollectionManifest(objects.get(manifest)!).entries.map((entry) => entry.hash);
  return { objects, manifest, segments, blob: encodeBeast2PagedFor(type)(value) };
}

/** A `fetch` serving a dataset route naming `manifest`, and an objects route
 *  answering from `objects` — the `presigned` ones with a URL to fetch them
 *  from — which records each request, and whether it carried the API's
 *  auth. */
function collectionServer(
  manifest: string,
  objects: Map<string, Uint8Array>,
  presigned: Set<string>,
): { requests: { url: string; auth: boolean }[]; fetch: typeof globalThis.fetch } {
  const requests: { url: string; auth: boolean }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push({ url: url.href, auth: new Headers(init?.headers).has('Authorization') });
    if (url.pathname.includes('/datasets/')) {
      return new Response(JSON.stringify({ manifest }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Content-SHA256': HASH },
      });
    }
    const hash = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
    if (url.host === 'example.test' && presigned.has(hash)) {
      return new Response(JSON.stringify({ url: `https://bucket.test/${hash}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(objects.get(hash)!, { status: 200, headers: { 'Content-Type': BEAST2_CONTENT_TYPE } });
  }) as typeof globalThis.fetch;
  return { requests, fetch };
}

/** Stands {@link collectionServer} in for the global `fetch`. */
function mockServer(manifest: string, objects: Map<string, Uint8Array>, presigned: Set<string>): { requests: { url: string; auth: boolean }[] } {
  const server = collectionServer(manifest, objects, presigned);
  globalThis.fetch = server.fetch;
  return server;
}

type StoredCollection = ReturnType<typeof storedCollection>;

/** A server whose dataset moves from one value to the next. */
interface MovingServer {
  /** The index of the value the dataset holds. */
  at: number;
  /** Every request's URL. */
  requests: string[];
  /** Told each object asked for before it is answered; it moves the dataset
   *  on by setting `at`. */
  beforeObject: (hash: string) => void;
  fetch: typeof globalThis.fetch;
}

/**
 * A `fetch` serving a dataset that holds `values[at]`, as a host serves a
 * caller only the objects of the datasets it reads, or as a store does once gc
 * has collected an old value: the dataset route names the held value's
 * manifest, which is its content hash too, and the objects route refuses,
 * `object_not_found`, any object the held value does not name.
 */
function movingServer(values: StoredCollection[]): MovingServer {
  const server: MovingServer = {
    at: 0,
    requests: [],
    beforeObject: () => { /* the dataset holds still */ },
    fetch: (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      server.requests.push(url.href);
      if (url.pathname.includes('/datasets/')) {
        const { manifest } = values[server.at]!;
        return new Response(JSON.stringify({ manifest }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-Content-SHA256': manifest },
        });
      }
      const hash = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
      server.beforeObject(hash);
      const bytes = values[server.at]!.objects.get(hash);
      if (bytes === undefined) {
        return new Response(JSON.stringify({ error: { type: 'object_not_found', message: `object ${hash} is no object of the dataset` } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(bytes, { status: 200, headers: { 'Content-Type': BEAST2_CONTENT_TYPE } });
    }) as typeof globalThis.fetch,
  };
  return server;
}

/** How many times a server's dataset was asked for. */
function datasetReads(server: MovingServer): number {
  return server.requests.filter((url) => url.includes('/datasets/')).length;
}

describe('datasetGet', () => {
  it('downloads a collection as the objects its manifest names, spliced into the value\'s blob', async () => {
    const { objects, manifest, segments, blob } = storedCollection();
    assert.ok(segments.length > 3, `the value spans segments, got ${segments.length}`);
    // One segment is large, as an object answered with a URL is.
    const m = mockServer(manifest, objects, new Set([segments[1]!]));

    const result = await datasetGet(BASE, 'r', 'ws', lookupPath, { token: 'tok' });
    assert.deepEqual(result.data, blob);
    assert.equal(result.hash, HASH, 'the hash is the dataset\'s own');
    assert.equal(result.size, blob.byteLength);

    assert.equal(new URL(m.requests[0]!.url).searchParams.get('segments'), 'true');
    const [presigned, api] = [
      m.requests.filter((request) => request.url.startsWith('https://bucket.test/')),
      m.requests.filter((request) => !request.url.startsWith('https://bucket.test/')),
    ];
    assert.deepEqual(presigned, [{ url: `https://bucket.test/${segments[1]}`, auth: false }], 'a URL is fetched without the API\'s auth');
    assert.equal(api.length, segments.length + 3, 'the dataset, the manifest, the header and each segment');
    assert.ok(api.every((request) => request.auth));
  });

  it('streams a collection a few segments ahead of the reader, never the value', async () => {
    const { objects, manifest, segments, blob } = storedCollection();
    assert.ok(segments.length > 12, `the value spans many segments, got ${segments.length}`);
    const m = mockServer(manifest, objects, new Set());

    const { hash, chunks } = await datasetGetStream(BASE, 'r', 'ws', lookupPath, { token: null });
    assert.equal(hash, HASH);
    assert.equal(m.requests.length, 2, 'the dataset and its manifest are read before the chunks are taken');
    const parts: Uint8Array[] = [];
    let fetchedByFirst = 0;
    for await (const chunk of chunks) {
      if (parts.length === 0) fetchedByFirst = m.requests.length;
      parts.push(chunk);
    }
    assert.ok(fetchedByFirst <= 2 + 1 + 8, `the first chunk came after ${fetchedByFirst} requests: the header and at most 8 segments ahead`);
    assert.deepEqual(new Uint8Array(Buffer.concat(parts)), blob);
  });

  it('streams any other value as the body the server sends', async () => {
    const body = new Uint8Array(300_000).map((_, i) => i % 251);
    mockFetch(() => new Response(new Blob([body]).stream(), {
      status: 200,
      headers: { 'Content-Type': BEAST2_CONTENT_TYPE, 'X-Content-SHA256': HASH },
    }));
    const { hash, chunks } = await datasetGetStream(BASE, 'r', 'ws', lookupPath, { token: null });
    const parts: Uint8Array[] = [];
    for await (const chunk of chunks) parts.push(chunk);
    assert.equal(hash, HASH);
    assert.deepEqual(new Uint8Array(Buffer.concat(parts)), body);
  });

  it('refuses an object that does not hash to its name', async () => {
    const { objects, manifest, segments } = storedCollection();
    const cut = objects.get(segments[2]!)!.subarray(0, 100);
    objects.set(segments[2]!, cut);
    mockServer(manifest, objects, new Set());
    await assert.rejects(datasetGet(BASE, 'r', 'ws', lookupPath, { token: null }), {
      message: `object ${segments[2]} arrived as ${sha256Hex(cut)}: the download was cut short or corrupted`,
    });
  });
});

describe('datasetGet through a given fetch', () => {
  it('downloads a collection through the given fetch alone, a large object\'s URL among its requests', async () => {
    refuseGlobalFetch();
    const { objects, manifest, segments, blob } = storedCollection();
    const server = collectionServer(manifest, objects, new Set([segments[1]!]));

    const result = await datasetGet(BASE, 'r', 'ws', lookupPath, { token: 'tok', fetch: server.fetch });
    assert.deepEqual(result.data, blob);
    assert.equal(server.requests.length, segments.length + 4, 'the dataset, the manifest, the header, each segment and the URL');
    assert.deepEqual(server.requests.filter((request) => request.url.startsWith('https://bucket.test/')),
      [{ url: `https://bucket.test/${segments[1]}`, auth: false }]);
  });

  it('downloads a large value from the URL the dataset route answers with, through the given fetch', async () => {
    refuseGlobalFetch();
    const body = Uint8Array.from({ length: 300_000 }, (_, i) => i % 251);
    const requests: { url: string; auth: boolean }[] = [];
    const given = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push({ url: url.href, auth: new Headers(init?.headers).has('Authorization') });
      if (url.host === 'example.test') {
        return new Response(JSON.stringify({ url: 'https://bucket.test/value' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-Content-SHA256': HASH },
        });
      }
      return new Response(new Blob([body]).stream(), { status: 200, headers: { 'Content-Type': BEAST2_CONTENT_TYPE } });
    }) as typeof fetch;

    const result = await datasetGet(BASE, 'r', 'ws', lookupPath, { token: 'tok', fetch: given });
    assert.deepEqual(result.data, body);
    assert.equal(result.hash, HASH);
    assert.deepEqual(requests.map((request) => [new URL(request.url).host, request.auth]),
      [['example.test', true], ['bucket.test', false]], 'the URL is fetched without the API\'s auth');
  });
});

describe('a read of a dataset that moves while it is read', () => {
  /** Is `err` the move to `current`, as a pinned page's refusal names it? */
  const movedTo = (current: string) => (err: unknown): boolean => {
    assert.ok(err instanceof DatasetHashMismatchError, `expected DatasetHashMismatchError, got ${String(err)}`);
    assert.equal(err.code, 'dataset_hash_mismatch');
    assert.equal(err.currentHash, current);
    return true;
  };

  it('datasetGet starts over from the new content when the old value\'s objects are refused mid-read, and names that content', async () => {
    const [before, after] = [storedCollection(), storedCollection({ first: 1 })];
    const server = movingServer([before, after]);
    // A run writes the new value while the fourth segment is asked for: it and
    // every later segment of the old value are refused from then on.
    server.beforeObject = (hash) => {
      if (hash === before.segments[3]) server.at = 1;
    };

    const result = await datasetGet(BASE, 'r', 'ws', lookupPath, { token: null, fetch: server.fetch });
    assert.deepEqual(result.data, after.blob, 'the new value, with none of the old one\'s bytes');
    assert.equal(result.hash, after.manifest, 'the hash is the content read');
    assert.equal(datasetReads(server), 3, 'the read, the check that found it moved, and the read that started over');
  });

  it('datasetGetStream starts over before it returns, and raises a move once it has returned, never splicing two values', async () => {
    const [before, after] = [storedCollection(), storedCollection({ first: 1 })];
    assert.ok(before.segments.length > 12, `the value spans many segments, got ${before.segments.length}`);

    // Moved between the dataset's answer and its manifest's read: nothing has
    // been returned, so the read starts over.
    const early = movingServer([before, after]);
    early.beforeObject = (hash) => {
      if (hash === before.manifest) early.at = 1;
    };
    const restarted = await datasetGetStream(BASE, 'r', 'ws', lookupPath, { token: null, fetch: early.fetch });
    assert.equal(restarted.hash, after.manifest);
    const parts: Uint8Array[] = [];
    for await (const chunk of restarted.chunks) parts.push(chunk);
    assert.deepEqual(new Uint8Array(Buffer.concat(parts)), after.blob);
    assert.equal(datasetReads(early), 2, 'the read and the check, whose answer the read starts over from');

    // Moved once a hash and some chunks are out: the chunks end in the move,
    // and every byte they gave is the old value's.
    const late = movingServer([before, after]);
    const { hash, chunks } = await datasetGetStream(BASE, 'r', 'ws', lookupPath, { token: null, fetch: late.fetch });
    assert.equal(hash, before.manifest);
    const taken: Uint8Array[] = [];
    await assert.rejects((async () => {
      for await (const chunk of chunks) {
        taken.push(chunk);
        late.at = 1;
      }
    })(), movedTo(after.manifest));
    const given = new Uint8Array(Buffer.concat(taken));
    assert.ok(given.length > 0 && given.length < before.blob.length, `some of the value was given, ${given.length} bytes`);
    assert.deepEqual(given, before.blob.subarray(0, given.length), 'what was given is the old value\'s, and nothing else');
  });

  it('raises the read\'s own error when the dataset has not moved', async () => {
    const held = storedCollection();
    held.objects.delete(held.segments[2]!);
    const server = movingServer([held]);
    await assert.rejects(datasetGet(BASE, 'r', 'ws', lookupPath, { token: null, fetch: server.fetch }), (err: unknown) => {
      assert.ok(err instanceof ApiError && !(err instanceof DatasetHashMismatchError), `expected the refusal itself, got ${String(err)}`);
      assert.equal(err.code, 'object_not_found');
      return true;
    });
    assert.equal(datasetReads(server), 2, 'the read and the one check');
  });

  it('gives up after 3 restarts on a dataset that keeps moving, naming the content it holds now', async () => {
    const values = [0, 1, 2, 3, 4].map((first) => storedCollection({ first, length: 50 }));
    const server = movingServer(values);
    // Every read finds the dataset moved on by the time it asks for the manifest.
    server.beforeObject = (hash) => {
      if (hash === values[server.at]!.manifest) server.at++;
    };
    await assert.rejects(datasetGet(BASE, 'r', 'ws', lookupPath, { token: null, fetch: server.fetch }), movedTo(values[4]!.manifest));
    assert.deepEqual(server.requests.filter((url) => url.includes('/objects/')),
      values.slice(0, 4).map((value) => `${BASE}/api/repos/r/objects/${value.manifest}`), 'the read and 3 restarts, each refused its manifest');
  });

  it('refuses a manifest above level 0 by name, before reading a segment', async () => {
    const { objects, manifest } = storedCollection();
    const levelled = encodeCollectionManifest({ ...decodeCollectionManifest(objects.get(manifest)!), level: 1n });
    const levelledHash = sha256Hex(levelled);
    objects.set(levelledHash, levelled);
    const refusal = `the collection ${levelledHash} is a level 1 manifest, whose entries name manifests, not segments: ` +
      'a newer e3 wrote it, which this client does not read — update @elaraai/e3-api-client';

    const server = collectionServer(levelledHash, objects, new Set());
    await assert.rejects(collectionGetStream(BASE, 'r', levelledHash, { token: null, fetch: server.fetch }), { message: refusal });
    assert.deepEqual(server.requests.map((request) => request.url), [`${BASE}/api/repos/r/objects/${levelledHash}`], 'the manifest alone is read');

    // A dataset holding one is refused the same way.
    await assert.rejects(datasetGet(BASE, 'r', 'ws', lookupPath, { token: null, fetch: collectionServer(levelledHash, objects, new Set()).fetch }),
      { message: refusal });
  });
});

describe('a stored value, by its hash', () => {
  it('streams a collection by its manifest\'s hash through the objects route alone, spliced into the value\'s blob', async () => {
    refuseGlobalFetch();
    const { objects, manifest, segments, blob } = storedCollection();
    const server = collectionServer(manifest, objects, new Set([segments[1]!]));

    const chunks = await collectionGetStream(BASE, 'r', manifest, { token: 'tok', fetch: server.fetch });
    assert.deepEqual(server.requests.map((request) => request.url), [`${BASE}/api/repos/r/objects/${manifest}`],
      'the manifest is read before the chunks are taken');
    const parts: Uint8Array[] = [];
    for await (const chunk of chunks) parts.push(chunk);
    assert.deepEqual(new Uint8Array(Buffer.concat(parts)), blob);
    assert.equal(server.requests.length, segments.length + 3, 'the manifest, the header, each segment and the URL');
    assert.deepEqual(server.requests.filter((request) => request.url.includes('/datasets/')), [], 'no dataset is asked for');
  });

  it('reads one object by its hash, following a URL answer without the API\'s auth', async () => {
    refuseGlobalFetch();
    const { objects, manifest, segments } = storedCollection();
    const server = collectionServer(manifest, objects, new Set([segments[1]!]));
    const options = { token: 'tok', fetch: server.fetch };

    assert.deepEqual(await objectGet(BASE, 'r', segments[0]!, options), objects.get(segments[0]!));
    assert.deepEqual(await objectGet(BASE, 'r', segments[1]!, options), objects.get(segments[1]!));
    assert.deepEqual(server.requests, [
      { url: `${BASE}/api/repos/r/objects/${segments[0]}`, auth: true },
      { url: `${BASE}/api/repos/r/objects/${segments[1]}`, auth: true },
      { url: `https://bucket.test/${segments[1]}`, auth: false },
    ]);
  });

  it('refuses an object that does not hash to its name, and throws a refusal as the ApiError the server names', async () => {
    const { objects, manifest, segments } = storedCollection();
    const cut = objects.get(segments[2]!)!.subarray(0, 100);
    objects.set(segments[2]!, cut);
    const server = collectionServer(manifest, objects, new Set());
    await assert.rejects(objectGet(BASE, 'r', segments[2]!, { token: null, fetch: server.fetch }), {
      message: `object ${segments[2]} arrived as ${sha256Hex(cut)}: the download was cut short or corrupted`,
    });

    const missing = (async () => new Response(JSON.stringify({ error: { type: 'object_not_found', message: `object ${HASH} not found` } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
    await assert.rejects(objectGet(BASE, 'r', HASH, { token: null, fetch: missing }), (err: unknown) => {
      assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
      assert.equal(err.code, 'object_not_found');
      return true;
    });
  });

  it('reads a page answer\'s window from its headers, as datasetGetPage reads its own', async () => {
    const data = Uint8Array.from([1, 2, 3]);
    const headers = {
      'Content-Type': BEAST2_CONTENT_TYPE,
      'X-Content-SHA256': HASH,
      'X-Total-Bytes': '123456',
      'X-Total-Elements': '8000',
      'X-Total-Exactness': 'exact',
      'X-Segment-Count': '80',
      'X-Page-Offset': '900',
      'X-Page-Count': '200',
    };
    const expected = { data, totalElements: 8000, totalBytes: 123456, totalExact: true, segmentCount: 80, offset: 900, count: 200, hash: HASH };
    assert.deepEqual(await parsePage(new Response(data, { status: 200, headers })), expected);
    mockFetch(() => new Response(data, { status: 200, headers }));
    assert.deepEqual(await datasetGetPage(BASE, 'r', 'ws', lookupPath, { offset: 900, limit: 200 }, { token: null }), expected);

    // A header the answer leaves out reads as nothing there.
    assert.deepEqual(await parsePage(new Response(new Uint8Array(), { status: 200, headers: { 'X-Total-Exactness': 'upper-bound' } })), {
      data: new Uint8Array(), totalElements: 0, totalBytes: 0, totalExact: false, segmentCount: 0, offset: 0, count: 0, hash: '',
    });
  });
});
