/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Giving a split call up (#1104): once `splitCall`'s or `splitCallExplain`'s
 * signal aborts, the client stops polling, cancels the job, and rejects with
 * the signal's reason; a call that ends on its own is cancelled by no one.
 * Through a stand-in server given as the `fetch`, whose job runs until it is
 * cancelled.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBeast2For, none, some, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE, PackageJobResponseType, ResponseType, SplitCallStatusType, type SplitCallRequest } from '@elaraai/e3-types';
import { splitCall, splitCallExplain } from './functions.js';

const BASE = 'https://e3.test';
const SPLIT = '/api/repos/r/workspaces/ws/one-shot/split';

/** A BEAST2 success envelope, as the server sends one. */
function success<T extends EastType>(type: T, value: ValueTypeOf<T>): globalThis.Response {
  const body = encodeBeast2For(ResponseType(type))(variant('success', value) as never);
  return new Response(body, { status: 200, headers: { 'Content-Type': BEAST2_CONTENT_TYPE } });
}

/** A call the stand-in server takes: it decodes none of it. */
const request: SplitCallRequest = {
  bodyIr: new Uint8Array(0),
  args: [],
  output: variant('array', null),
  then: none,
  runner: variant('east_node', { platforms: [], decode: variant('lazy', null) }),
  limits: none,
};

/**
 * A server whose job `job-1` runs until it is cancelled, or ends `completed`
 * at its `ends`-th poll.
 *
 * @returns How many polls and cancels it was sent, and the `fetch` it answers
 */
function server(ends = Infinity): { polls: () => number; cancels: string[]; fetch: typeof globalThis.fetch } {
  let polls = 0;
  let cancelled = false;
  const cancels: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (method === 'POST' && url.pathname === SPLIT) return success(PackageJobResponseType, { id: 'job-1' });
    if (method === 'POST' && url.pathname === `${SPLIT}/job-1/cancel`) {
      cancels.push('job-1');
      cancelled = true;
      return success(SplitCallStatusType, variant('cancelled', null));
    }
    if (method === 'GET' && url.pathname === `${SPLIT}/job-1`) {
      polls++;
      if (cancelled) return success(SplitCallStatusType, variant('cancelled', null));
      if (polls < ends) return success(SplitCallStatusType, variant('processing', none));
      return success(SplitCallStatusType, variant('completed', {
        result: {
          outcome: variant('success', { value: new Uint8Array(0) }),
          stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false, inputs: [], drafts: [],
        },
        output: some('output'),
        report: some({ pieces: 1n, ran: 1n, cached: 0n, peakBytes: none }),
      }));
    }
    return new Response(`unexpected ${method} ${url.href}`, { status: 500 });
  }) as typeof globalThis.fetch;
  return { polls: () => polls, cancels, fetch };
}

/** Resolves once `holds`, checked between turns of the event loop. */
async function until(holds: () => boolean): Promise<void> {
  while (!holds()) await new Promise((resolve) => setTimeout(resolve, 5));
}

describe('giving a split call up (#1104)', () => {
  it('cancels the job once splitCall\'s signal aborts, and rejects with the signal\'s reason', async () => {
    const stub = server();
    const controller = new AbortController();
    const running = splitCall(BASE, 'r', 'ws', request, { token: null, fetch: stub.fetch }, { signal: controller.signal });
    await until(() => stub.polls() > 0);
    const reason = new Error('the query moved on');
    controller.abort(reason);
    await assert.rejects(running, (err) => err === reason);
    assert.deepEqual(stub.cancels, ['job-1'], 'the job was cancelled, once');
    const polled = stub.polls();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(stub.polls(), polled, 'and polling stopped');
  });

  it('cancels the job once splitCallExplain\'s signal aborts', async () => {
    const stub = server();
    const controller = new AbortController();
    const running = splitCallExplain(BASE, 'r', 'ws', request, { token: null, fetch: stub.fetch }, { signal: controller.signal });
    await until(() => stub.polls() > 0);
    controller.abort();
    await assert.rejects(running, { name: 'AbortError' });
    assert.deepEqual(stub.cancels, ['job-1']);
  });

  it('cancels no call that ends on its own', async () => {
    const stub = server(2);
    const controller = new AbortController();
    const answer = await splitCall(BASE, 'r', 'ws', request, { token: null, fetch: stub.fetch }, { signal: controller.signal });
    assert.equal(answer.result.outcome.type, 'success');
    controller.abort();
    assert.deepEqual(stub.cancels, [], 'nothing was cancelled');
  });
});
