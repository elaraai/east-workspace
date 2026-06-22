/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for the HTTP retry layer in http.ts.
 *
 * The client is the shared HTTP layer used by the compliance suite, the e3 CLI,
 * and the cloud. A single transient failure (a cold-Lambda dropped socket, or a
 * 429/502/503/504) must not hard-fail a call, but a retry must never double-apply
 * a non-idempotent write nor mask a real 500. These tests pin that contract:
 * which errors/statuses are retried, the idempotency gate, the attempt cap,
 * abort handling, and the backoff/Retry-After policy.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBeast2For, variant, IntegerType } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-types';
import {
  fetchWithRetry,
  parseRetryAfter,
  computeBackoffMs,
  isRetryableNetworkError,
  get,
  del,
  post,
  ApiError,
  type RetryOptions,
} from './http.js';
import { ResponseType } from './types.js';

// Zero-delay policy so the loop tests never actually wait.
const NO_WAIT: RetryOptions = { baseDelayMs: 0, maxDelayMs: 0 };
const URL = 'https://example.test/api/x';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * Install a fetch mock that runs `steps[i]` for the i-th call (the last step
 * repeats once exhausted, for "persistent failure" tests). Returns a live call
 * counter.
 */
type FetchStep = () => globalThis.Response | Promise<globalThis.Response>;

function mockFetch(steps: FetchStep[]): { calls: number } {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    const i = state.calls++;
    return steps[Math.min(i, steps.length - 1)]();
  }) as typeof fetch;
  return state;
}

/** A connection-level fetch failure, the way Node's WHATWG fetch reports it. */
function networkError(): never {
  throw new TypeError('fetch failed');
}

/** An error carrying an errno code on `.cause`, as undici attaches it. */
function networkErrorWithCause(code: string): Error {
  return new TypeError('fetch failed', { cause: Object.assign(new Error('boom'), { code }) });
}

const ok = (): globalThis.Response => new Response('ok', { status: 200 });
const status = (code: number, headers: Record<string, string> = {}): globalThis.Response =>
  new Response(`{"error":{"type":"http"}}`, { status: code, headers });

// ===========================================================================
// fetchWithRetry — thrown network errors
// ===========================================================================

describe('fetchWithRetry: thrown network errors', () => {
  it('retries a thrown "fetch failed" then resolves', async () => {
    const m = mockFetch([networkError, ok]);
    const res = await fetchWithRetry(URL, {}, { idempotent: false, retry: NO_WAIT });
    assert.equal(res.status, 200);
    assert.equal(m.calls, 2);
  });

  it('retries a thrown error even for a non-idempotent request (request never completed)', async () => {
    // POST with no idempotency key: a pre-response network throw is still safe to retry.
    const m = mockFetch([() => Promise.reject(networkErrorWithCause('ECONNRESET')), ok]);
    const res = await fetchWithRetry(URL, { method: 'POST' }, { idempotent: false, retry: NO_WAIT });
    assert.equal(res.status, 200);
    assert.equal(m.calls, 2);
  });

  it('stops after the attempt cap on a persistent network error and rethrows', async () => {
    const m = mockFetch([networkError]);
    await assert.rejects(
      fetchWithRetry(URL, {}, { idempotent: true, retry: { ...NO_WAIT, attempts: 3 } }),
      (err: unknown) => err instanceof TypeError && err.message === 'fetch failed',
    );
    assert.equal(m.calls, 3);
  });

  it('does not retry a non-network thrown error', async () => {
    const m = mockFetch([() => Promise.reject(new Error('programmer bug'))]);
    await assert.rejects(
      fetchWithRetry(URL, {}, { idempotent: true, retry: NO_WAIT }),
      /programmer bug/,
    );
    assert.equal(m.calls, 1);
  });

  it('opts out of retries entirely with attempts: 1', async () => {
    const m = mockFetch([networkError]);
    await assert.rejects(fetchWithRetry(URL, {}, { idempotent: true, retry: { attempts: 1 } }));
    assert.equal(m.calls, 1);
  });
});

// ===========================================================================
// fetchWithRetry — transient response statuses + idempotency gate
// ===========================================================================

describe('fetchWithRetry: transient statuses', () => {
  for (const code of [429, 502, 503, 504]) {
    it(`retries ${code} for an idempotent request then resolves`, async () => {
      const m = mockFetch([() => Promise.resolve(status(code)), ok]);
      const res = await fetchWithRetry(URL, { method: 'GET' }, { idempotent: true, retry: NO_WAIT });
      assert.equal(res.status, 200);
      assert.equal(m.calls, 2);
    });
  }

  it('does NOT retry a transient status for a non-idempotent request (keyless POST)', async () => {
    const m = mockFetch([() => Promise.resolve(status(503))]);
    const res = await fetchWithRetry(URL, { method: 'POST' }, { idempotent: false, retry: NO_WAIT });
    assert.equal(res.status, 503); // returned as-is for the caller to surface
    assert.equal(m.calls, 1);
  });

  it('does NOT retry a 500 (could mask a real regression)', async () => {
    const m = mockFetch([() => Promise.resolve(status(500))]);
    const res = await fetchWithRetry(URL, { method: 'GET' }, { idempotent: true, retry: NO_WAIT });
    assert.equal(res.status, 500);
    assert.equal(m.calls, 1);
  });

  it('does NOT retry a 4xx other than 429', async () => {
    for (const code of [400, 403, 404, 409, 422]) {
      const m = mockFetch([() => Promise.resolve(status(code))]);
      const res = await fetchWithRetry(URL, { method: 'GET' }, { idempotent: true, retry: NO_WAIT });
      assert.equal(res.status, code);
      assert.equal(m.calls, 1);
    }
  });

  it('stops after the attempt cap on a persistent transient status and returns the last response', async () => {
    const m = mockFetch([() => Promise.resolve(status(503))]);
    const res = await fetchWithRetry(URL, { method: 'GET' }, { idempotent: true, retry: { ...NO_WAIT, attempts: 4 } });
    assert.equal(res.status, 503);
    assert.equal(m.calls, 4);
  });

  it('retries even when draining the discarded transient body rejects (broken cold-start stream)', async () => {
    // A 503 whose body stream cancel() throws must not abort the retry loop.
    const m = mockFetch([
      () => new Response(
        new ReadableStream({
          start(c) { c.enqueue(new Uint8Array([1])); },
          cancel() { throw new Error('cancel boom'); },
        }),
        { status: 503 },
      ),
      ok,
    ]);
    const res = await fetchWithRetry(URL, { method: 'GET' }, { idempotent: true, retry: NO_WAIT });
    assert.equal(res.status, 200);
    assert.equal(m.calls, 2);
  });
});

describe('fetchWithRetry: Retry-After wiring', () => {
  it('reads the Retry-After header and lets it drive the backoff delay (end-to-end)', async () => {
    // baseDelayMs:0 means a working wiring waits ~50ms (the header), while a
    // regression that ignored/misread the header would back off ~0ms.
    const m = mockFetch([() => status(503, { 'retry-after': '0.05' }), ok]);
    const t0 = Date.now();
    const res = await fetchWithRetry(URL, { method: 'GET' }, { idempotent: true, retry: { baseDelayMs: 0, maxDelayMs: 10_000 } });
    const elapsed = Date.now() - t0;
    assert.equal(res.status, 200);
    assert.equal(m.calls, 2);
    assert.ok(elapsed >= 40, `expected the Retry-After (~50ms) to drive the delay, waited ${elapsed}ms`);
  });
});

// ===========================================================================
// fetchWithRetry — AbortSignal
// ===========================================================================

describe('fetchWithRetry: AbortSignal', () => {
  it('throws on a pre-aborted signal without calling fetch', async () => {
    const m = mockFetch([ok]);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(fetchWithRetry(URL, { signal: controller.signal }, { idempotent: true, retry: NO_WAIT }));
    assert.equal(m.calls, 0);
  });

  it('stops retrying when the signal aborts during backoff', async () => {
    const controller = new AbortController();
    // First attempt aborts the controller, then throws a retryable error; the
    // backoff sleep must observe the abort and reject instead of retrying.
    const m = mockFetch([() => { controller.abort(); return Promise.reject(new TypeError('fetch failed')); }]);
    await assert.rejects(
      fetchWithRetry(URL, { signal: controller.signal }, { idempotent: true, retry: { baseDelayMs: 10_000, maxDelayMs: 10_000 } }),
    );
    assert.equal(m.calls, 1);
  });
});

// ===========================================================================
// Idempotency wiring through the BEAST2 helpers (get / del / post)
// ===========================================================================

describe('helper idempotency wiring', () => {
  it('get retries a network error then decodes the success body', async () => {
    const body = encodeBeast2For(ResponseType(IntegerType))(variant('success', 42n));
    const m = mockFetch([
      networkError,
      () => Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': BEAST2_CONTENT_TYPE } })),
    ]);
    const result = await get(URL, '/x', IntegerType, { token: null, retry: NO_WAIT });
    assert.equal(result, 42n);
    assert.equal(m.calls, 2);
  });

  it('del (idempotent) retries a transient 503 up to the cap, then surfaces ApiError', async () => {
    const m = mockFetch([() => Promise.resolve(status(503))]);
    await assert.rejects(
      del(URL, '/x', IntegerType, { token: null, retry: { ...NO_WAIT, attempts: 3 } }),
      ApiError,
    );
    assert.equal(m.calls, 3); // idempotent DELETE retried
  });

  it('keyless POST does NOT retry a transient 503 — surfaces ApiError immediately', async () => {
    const m = mockFetch([() => Promise.resolve(status(503))]);
    await assert.rejects(
      post(URL, '/x', 1n, IntegerType, IntegerType, { token: null, retry: { ...NO_WAIT, attempts: 3 } }),
      ApiError,
    );
    assert.equal(m.calls, 1); // non-idempotent, no key → no retry
  });

  it('POST carrying an Idempotency-Key DOES retry a transient 503', async () => {
    const m = mockFetch([() => Promise.resolve(status(503))]);
    await assert.rejects(
      post(URL, '/x', 1n, IntegerType, IntegerType, { token: null, retry: { ...NO_WAIT, attempts: 3 } }, { 'Idempotency-Key': 'k1' }),
      ApiError,
    );
    assert.equal(m.calls, 3); // key makes the retry safe
  });
});

// ===========================================================================
// Pure policy: isRetryableNetworkError / parseRetryAfter / computeBackoffMs
// ===========================================================================

describe('isRetryableNetworkError', () => {
  it('treats "fetch failed" as retryable', () => {
    assert.equal(isRetryableNetworkError(new TypeError('fetch failed')), true);
  });
  it('treats "socket hang up" as retryable', () => {
    assert.equal(isRetryableNetworkError(new Error('socket hang up')), true);
  });
  it('treats a retryable errno code (direct or on .cause) as retryable', () => {
    assert.equal(isRetryableNetworkError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })), true);
    assert.equal(isRetryableNetworkError(networkErrorWithCause('EAI_AGAIN')), true);
  });
  it('treats a plain error as non-retryable', () => {
    assert.equal(isRetryableNetworkError(new Error('boom')), false);
  });
  it('never treats an AbortError as retryable', () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    assert.equal(isRetryableNetworkError(e), false);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2020-01-01T00:00:00Z');
  it('parses the delta-seconds form to milliseconds', () => {
    assert.equal(parseRetryAfter('2', now), 2000);
    assert.equal(parseRetryAfter('0', now), 0);
  });
  it('parses the HTTP-date form relative to now', () => {
    const when = new Date(now + 5000).toUTCString();
    assert.equal(parseRetryAfter(when, now), 5000);
  });
  it('returns undefined for an absent or unparseable header', () => {
    assert.equal(parseRetryAfter(null, now), undefined);
    assert.equal(parseRetryAfter('  ', now), undefined);
    assert.equal(parseRetryAfter('soon', now), undefined);
  });
});

describe('computeBackoffMs', () => {
  const cfg = { attempts: 4, baseDelayMs: 100, maxDelayMs: 2000 };
  it('honours a Retry-After hint, capped at maxDelayMs', () => {
    assert.equal(computeBackoffMs(0, cfg, 1500), 1500);
    assert.equal(computeBackoffMs(0, cfg, 5000), 2000); // capped
  });
  it('applies full jitter within [0, exponential ceiling]', () => {
    // attempt 2 → ceiling = min(2000, 100·2^2) = 400.
    assert.equal(computeBackoffMs(2, cfg, undefined, () => 1), 400);
    assert.equal(computeBackoffMs(2, cfg, undefined, () => 0), 0);
    assert.equal(computeBackoffMs(2, cfg, undefined, () => 0.5), 200);
  });
  it('caps the exponential ceiling at maxDelayMs', () => {
    assert.equal(computeBackoffMs(10, cfg, undefined, () => 1), 2000);
  });
});
