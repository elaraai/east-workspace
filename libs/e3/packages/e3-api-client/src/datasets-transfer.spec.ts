/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for the client half of the dataset transfer protocol.
 *
 * `datasetSetStream` (and `datasetSet` above the inline threshold) must speak
 * the transfer protocol to a server that plans parts and polls commits. These
 * tests stand a fake server in for `fetch` and pin what reaches the wire: the
 * version on the init and the
 * commit, each part's exact byte range with the headers the server named and
 * no credentials, a transient part failure retried from a fresh read of its
 * range, the commit polled until it finishes, and every refusal surfaced.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBeast2For, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import {
  BEAST2_CONTENT_TYPE,
  ResponseType,
  TransferDoneResponseType,
  TransferPartResponseType,
  TransferUploadResponseType,
} from '@elaraai/e3-types';
import { datasetSetStream, type DatasetTransferSource } from './datasets.js';
import { ApiError, type RetryOptions } from './http.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const BASE = 'https://e3.test';
const ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const PATH = [variant('field', 'inputs'), variant('field', 'table')];
const NO_WAIT: RetryOptions = { baseDelayMs: 0, maxDelayMs: 0 };

/** One request the fake server received, its body read whole. */
interface Call {
  method: string;
  url: URL;
  headers: Headers;
  body: Uint8Array | null;
}

/** Stands a fake server in for `fetch`, recording every request it answers. */
function fakeServer(answer: (call: Call) => globalThis.Response | Promise<globalThis.Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? new Uint8Array(await new Response(init.body).arrayBuffer()) : null;
    const call = { method: init?.method ?? 'GET', url: new URL(String(input)), headers: new Headers(init?.headers), body };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return calls;
}

/** A BEAST2 success envelope, as the server sends one. */
function success<T extends EastType>(type: T, value: ValueTypeOf<T>): globalThis.Response {
  const body = encodeBeast2For(ResponseType(type))(variant('success', value) as never);
  return new Response(body, { status: 200, headers: { 'Content-Type': BEAST2_CONTENT_TYPE } });
}

/** A source over `bytes` that serves each range as a stream and counts the reads. */
function streamedSource(bytes: Uint8Array): DatasetTransferSource & { reads: string[] } {
  const reads: string[] = [];
  return {
    size: bytes.byteLength,
    hash: 'a'.repeat(64),
    reads,
    slice(start, end) {
      reads.push(`${start}-${end}`);
      return new ReadableStream<Uint8Array>({
        start(controller) {
          // One byte per chunk, so a range is only right if every chunk is.
          for (let at = start; at < end; at++) controller.enqueue(bytes.slice(at, at + 1));
          controller.close();
        },
      });
    },
  };
}

const payload = Uint8Array.from({ length: 10 }, (_, i) => 100 + i);

describe('datasetSetStream: the transfer protocol', () => {
  it('sends the parts the server plans, with their headers and no credentials, and polls the commit', async () => {
    const parts = new Map<number, Uint8Array>();
    let polls = 0;
    const calls = fakeServer(({ method, url, body }) => {
      const part = url.pathname.match(/\/upload\/[^/]+\/parts\/(\d+)$/);
      if (method === 'POST' && url.pathname.endsWith('/upload')) {
        return success(TransferUploadResponseType, variant('upload_parts', { id: ID, partBytes: 4n }));
      }
      if (method === 'GET' && part) {
        return success(TransferPartResponseType, {
          url: `https://store.test/part/${part[1]}`,
          headers: new Map([['x-part', part[1]!]]),
        });
      }
      if (method === 'PUT' && url.host === 'store.test') {
        parts.set(Number(url.pathname.split('/').pop()), body!);
        return new Response(null, { status: 200 });
      }
      if (method === 'POST' && url.pathname.endsWith(`/upload/${ID}`)) {
        return success(TransferDoneResponseType, variant('processing', null));
      }
      if (method === 'GET' && url.pathname.endsWith(`/upload/${ID}`)) {
        return success(TransferDoneResponseType, polls++ < 1 ? variant('processing', null) : variant('completed', null));
      }
      return new Response(`unexpected ${method} ${url.href}`, { status: 500 });
    });

    await datasetSetStream(BASE, 'my repo', 'ws', PATH, streamedSource(payload), { token: 'tok', retry: NO_WAIT });

    assert.deepEqual([...parts.keys()].sort(), [1, 2, 3]);
    assert.deepEqual([...parts.get(1)!], [...payload.subarray(0, 4)]);
    assert.deepEqual([...parts.get(2)!], [...payload.subarray(4, 8)]);
    assert.deepEqual([...parts.get(3)!], [...payload.subarray(8, 10)]);

    const init = calls[0]!;
    assert.equal(init.url.pathname, '/api/repos/my%20repo/workspaces/ws/datasets/inputs/table/upload');
    assert.equal(init.url.searchParams.get('protocol'), '2');
    const commit = calls.find(c => c.method === 'POST' && c.url.pathname.endsWith(`/upload/${ID}`))!;
    assert.equal(commit.url.searchParams.get('protocol'), '2');
    assert.equal(polls, 2, 'polled until the commit completed');

    for (const call of calls) {
      if (call.method === 'PUT') {
        assert.equal(call.headers.get('authorization'), null, 'a part URL may be presigned: no credentials');
        assert.equal(call.headers.get('x-part'), call.url.pathname.split('/').pop(), 'each PUT carries its own part\'s headers');
        assert.equal(call.headers.get('content-length'), String(call.body!.byteLength));
      } else {
        assert.equal(call.headers.get('authorization'), 'Bearer tok');
      }
    }
  });

  it('re-reads a part\'s range when its PUT meets a transient failure', async () => {
    const attempts = new Map<number, number>();
    const parts = new Map<number, Uint8Array>();
    fakeServer(({ method, url, body }) => {
      const part = url.pathname.match(/\/upload\/[^/]+\/parts\/(\d+)$/);
      if (method === 'POST' && url.pathname.endsWith('/upload')) {
        return success(TransferUploadResponseType, variant('upload_parts', { id: ID, partBytes: 4n }));
      }
      if (method === 'GET' && part) {
        return success(TransferPartResponseType, { url: `https://store.test/part/${part[1]}`, headers: new Map() });
      }
      if (method === 'PUT') {
        const n = Number(url.pathname.split('/').pop());
        attempts.set(n, (attempts.get(n) ?? 0) + 1);
        if (n === 2 && attempts.get(n) === 1) return new Response('slow down', { status: 503 });
        parts.set(n, body!);
        return new Response(null, { status: 200 });
      }
      if (method === 'POST' && url.pathname.endsWith(`/upload/${ID}`)) {
        return success(TransferDoneResponseType, variant('completed', null));
      }
      return new Response(`unexpected ${method} ${url.href}`, { status: 500 });
    });

    const source = streamedSource(payload);
    await datasetSetStream(BASE, 'r', 'ws', PATH, source, { token: null, retry: NO_WAIT });

    assert.equal(attempts.get(2), 2);
    assert.equal(source.reads.filter(r => r === '4-8').length, 2, 'the retried part is read afresh, not resent from a spent stream');
    assert.deepEqual([...parts.get(2)!], [...payload.subarray(4, 8)]);
  });

  it('names the part whose PUT is refused', async () => {
    fakeServer(({ method, url }) => {
      const part = url.pathname.match(/\/upload\/[^/]+\/parts\/(\d+)$/);
      if (method === 'POST' && url.pathname.endsWith('/upload')) {
        return success(TransferUploadResponseType, variant('upload_parts', { id: ID, partBytes: 4n }));
      }
      if (method === 'GET' && part) {
        return success(TransferPartResponseType, { url: `https://store.test/part/${part[1]}`, headers: new Map() });
      }
      if (method === 'PUT') {
        return url.pathname.endsWith('/3') ? new Response('expired', { status: 403, statusText: 'Forbidden' }) : new Response(null, { status: 200 });
      }
      return new Response(`unexpected ${method} ${url.href}`, { status: 500 });
    });

    await assert.rejects(
      datasetSetStream(BASE, 'r', 'ws', PATH, streamedSource(payload), { token: null, retry: NO_WAIT }),
      /Transfer upload failed: part 3 of 3: 403 Forbidden/,
    );
  });

  it('surfaces a commit that fails, and one the server refuses', async () => {
    const answerWith = (done: globalThis.Response) => fakeServer(({ method, url }) => {
      if (method === 'POST' && url.pathname.endsWith('/upload')) {
        return success(TransferUploadResponseType, variant('upload_parts', { id: ID, partBytes: 16n }));
      }
      if (method === 'GET' && url.pathname.includes('/parts/')) {
        return success(TransferPartResponseType, { url: 'https://store.test/part/1', headers: new Map() });
      }
      if (method === 'PUT') return new Response(null, { status: 200 });
      return done;
    });

    answerWith(success(TransferDoneResponseType, variant('error', { message: 'hash mismatch: expected a, got b' })));
    await assert.rejects(
      datasetSetStream(BASE, 'r', 'ws', PATH, streamedSource(payload), { token: null, retry: NO_WAIT }),
      /Transfer failed: hash mismatch: expected a, got b/,
    );

    const refusal = encodeBeast2For(ResponseType(TransferDoneResponseType))(variant('error', variant('dataset_type_mismatch', {
      workspace: 'ws',
      path: '.inputs.table',
      message: "dataset '.inputs.table' declares .String but the value carries .Blob",
    })) as never);
    answerWith(new Response(refusal, { status: 200, headers: { 'Content-Type': BEAST2_CONTENT_TYPE } }));
    await assert.rejects(
      datasetSetStream(BASE, 'r', 'ws', PATH, streamedSource(payload), { token: null, retry: NO_WAIT }),
      (err: unknown) => err instanceof ApiError && err.code === 'dataset_type_mismatch',
    );
  });

  it('reads nothing when the server already holds the bytes', async () => {
    const calls = fakeServer(() => success(TransferUploadResponseType, variant('completed', null)));
    const source = streamedSource(payload);
    await datasetSetStream(BASE, 'r', 'ws', PATH, source, { token: null, retry: NO_WAIT });
    assert.deepEqual(source.reads, []);
    assert.equal(calls.length, 1);
  });
});
