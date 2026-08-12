/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for the dataset key-search client call.
 *
 * `datasetFindKey` is the client half of the fence-backed find endpoint:
 * these tests pin the request shape (the `find` query and its exactly-one
 * of key/prefix parameters, hash pinning), the JSON result decoding with
 * the content hash lifted off the headers, and the error mapping the
 * paged preview relies on (typed ApiError codes, AuthError on 401).
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { variant } from '@elaraai/east';
import { datasetFindKey } from './datasets.js';
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
