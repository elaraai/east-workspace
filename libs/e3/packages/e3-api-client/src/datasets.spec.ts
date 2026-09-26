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
 * which does not hash to its name is refused.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  Beast2ManifestWriter, DictType, IntegerType, SortedMap, StringType, compareFor, decodeCollectionManifest, encodeBeast2PagedFor, sha256Hex, variant,
} from '@elaraai/east';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-types';
import { datasetFindKey, datasetGet } from './datasets.js';
import { ApiError, AuthError } from './http.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const BASE = 'https://example.test';
const HASH = 'f'.repeat(64);
const lookupPath = [variant('field', 'inputs'), variant('field', 'lookup')];

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
});

/** A collection as a server stores it — every object by its hash, the
 *  manifest's own among them — and the blob its splice is. */
function storedCollection(): { objects: Map<string, Uint8Array>; manifest: string; segments: string[]; blob: Uint8Array } {
  const type = DictType(StringType, IntegerType);
  const value = new SortedMap(
    Array.from({ length: 20_000 }, (_, i) => [`k${String(i).padStart(6, '0')}`, BigInt(i)] as [string, bigint]),
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

/** Serves a dataset route naming `manifest`, and an objects route answering
 *  from `objects` — the `presigned` ones with a URL to fetch them from — and
 *  records each request, and whether it carried the API's auth. */
function mockServer(manifest: string, objects: Map<string, Uint8Array>, presigned: Set<string>): { requests: { url: string; auth: boolean }[] } {
  const state = { requests: [] as { url: string; auth: boolean }[] };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    state.requests.push({ url: url.href, auth: new Headers(init?.headers).has('Authorization') });
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
  }) as typeof fetch;
  return state;
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
