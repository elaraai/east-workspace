/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for removing a repository whose server finishes the removal after it
 * answers (#1285): `repoRemove` follows the route a `202 Accepted` names until
 * the repository is gone, through a stand-in server given as the `fetch`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NullType, encodeBeast2For, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE, RepositoryRemovalType, ResponseType, type Error as ApiErrorValue, type RepositoryRemoval } from '@elaraai/e3-types';
import { ApiError } from './http.js';
import { repoRemove } from './repository.js';

const BASE = 'https://e3.test';

/** A BEAST2 success, as the server sends one. */
function success<T extends EastType>(type: T, value: ValueTypeOf<T>, status = 200, headers: Record<string, string> = {}): globalThis.Response {
  const body = encodeBeast2For(ResponseType(type))(variant('success', value) as never);
  return new Response(body, { status, headers: { 'Content-Type': BEAST2_CONTENT_TYPE, ...headers } });
}

/** A BEAST2 refusal, as the server sends one. */
function refusal<T extends EastType>(type: T, error: ApiErrorValue): globalThis.Response {
  const body = encodeBeast2For(ResponseType(type))(variant('error', error) as never);
  return new Response(body, { status: 200, headers: { 'Content-Type': BEAST2_CONTENT_TYPE } });
}

/**
 * A server that removes repository `r`: within the request when `answers` is
 * empty, or else answering 202 — naming its removal's route, unless `named` is
 * false — whose route then answers each of `answers` in turn, `gone` as
 * `repository_not_found`.
 *
 * @returns The requests, as `METHOD /path`, and the `fetch` the server answers
 */
function server(answers: Array<{ removal: RepositoryRemoval } | { gone: true }>, named = true): { requests: string[]; fetch: typeof globalThis.fetch } {
  const requests: string[] = [];
  let asked = 0;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    requests.push(`${method} ${url.pathname}`);
    if (requests.length > 10) return new Response('the client asked on past the removal\'s end', { status: 500 });
    if (method === 'DELETE' && url.pathname === '/api/repos/r') {
      if (answers.length === 0) return success(NullType, null);
      return success(NullType, null, 202, { 'Retry-After': '0', ...(named && { Location: '/api/repos/r/removal/job-1' }) });
    }
    if (method === 'GET' && url.pathname === '/api/repos/r/removal/job-1') {
      const answer = answers[asked++]!;
      if ('gone' in answer) return refusal(RepositoryRemovalType, variant('repository_not_found', { repo: 'r' }));
      return success(RepositoryRemovalType, answer.removal, 200, { 'Retry-After': '0' });
    }
    return new Response(`unexpected ${method} ${url.href}`, { status: 500 });
  }) as typeof globalThis.fetch;
  return { requests, fetch };
}

describe('removing a repository (#1285)', () => {
  it('answers once a server that removes the repository within the request answers 200', async () => {
    const { requests, fetch } = server([]);
    let waited = false;
    await repoRemove(BASE, 'r', { token: null, fetch }, { onWaiting: () => { waited = true; } });
    assert.deepEqual(requests, ['DELETE /api/repos/r']);
    assert.equal(waited, false);
  });

  it('follows a 202 to the route it names, as each answer\'s Retry-After says, until the repository is removed', async () => {
    const removing = { removal: variant('removing', null) };
    const { requests, fetch } = server([removing, removing, { removal: variant('removed', null) }]);
    let waits = 0;
    await repoRemove(BASE, 'r', { token: null, fetch }, { onWaiting: () => { waits++; } });
    assert.deepEqual(requests, ['DELETE /api/repos/r', ...Array<string>(3).fill('GET /api/repos/r/removal/job-1')]);
    assert.equal(waits, 1, 'told once that it waits');
  });

  it('takes a route that answers repository_not_found as the repository gone', async () => {
    const { requests, fetch } = server([{ removal: variant('removing', null) }, { gone: true }]);
    await repoRemove(BASE, 'r', { token: null, fetch });
    assert.equal(requests.length, 3);
  });

  it('raises a removal that failed, with its reason', async () => {
    const { fetch } = server([{ removal: variant('removing', null) }, { removal: variant('failed', { message: 'the objects could not be deleted' }) }]);
    await assert.rejects(repoRemove(BASE, 'r', { token: null, fetch }), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, 'repository_removal_failed');
      assert.equal(err.details, 'the objects could not be deleted');
      return true;
    });
  });

  it('takes a 202 that names no route as done, as a client before servers named one did', async () => {
    const { requests, fetch } = server([{ removal: variant('removing', null) }], false);
    await repoRemove(BASE, 'r', { token: null, fetch });
    assert.deepEqual(requests, ['DELETE /api/repos/r']);
  });
});
