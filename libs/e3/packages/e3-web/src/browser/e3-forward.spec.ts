/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The forwarding fetch's edges, in Node, over a stand-in for a page: a
 * request answered; one aborted while its body is read, which the page is
 * never sent; one aborted while the page answers it; and one whose call into
 * the page fails — past the call's deadline, say — each of the last two given
 * up in the page by a call whose answer nothing reads. Every request the API
 * suites make is forwarded so into Chromium (`e3-api.ts`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toBase64, type WireResponse } from './e3-wire.js';
import { forwardInto, type ForwardedPage } from './e3-forward.js';

/** A call of a page's function, or a word to it. */
interface Sent {
  readonly name: string;
  readonly args: readonly unknown[];
}

/** A stand-in for a page running e3: it answers each call as a test says,
 *  and records what it is called with and told. */
class StandInPage implements ForwardedPage {
  readonly called: Sent[] = [];
  readonly told: Sent[] = [];

  constructor(private readonly answer: (name: string) => Promise<unknown>) {}

  call<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
    this.called.push({ name, args });
    return this.answer(name) as Promise<T>;
  }

  tell(name: string, ...args: unknown[]): void {
    this.told.push({ name, args });
  }
}

/** A promise that never settles: a page that does not answer. */
function never(): Promise<never> {
  return new Promise<never>(() => undefined);
}

describe('the forwarding fetch', () => {
  it('answers a request with the response the page gave', async () => {
    const answer: WireResponse = { status: 201, statusText: 'Created', headers: [['x-answer', 'yes']], body: toBase64(new Uint8Array([1, 2, 3])) };
    const page = new StandInPage(() => Promise.resolve(answer));
    const response = await forwardInto(page)('https://e3-web.invalid/api/repos/default', { method: 'PUT', body: new Uint8Array([9]) });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('x-answer'), 'yes');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
    assert.deepEqual(page.called.map(({ name }) => name), ['fetch']);
    assert.deepEqual(page.told, []);
  });

  it('gives up a request aborted while its body is read: it rejects with the abort\'s reason, and the page is sent nothing', async () => {
    const page = new StandInPage(() => never());
    const controller = new AbortController();
    // A body that never ends: reading it waits until the abort.
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new Uint8Array([1]));
      },
    });
    const pending = forwardInto(page)('https://e3-web.invalid/api/uploads/an-upload', {
      method: 'PUT', body, duplex: 'half', signal: controller.signal,
    } as RequestInit);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.deepEqual(page.called, [], 'the page was sent nothing');
    assert.deepEqual(page.told, [], 'and told nothing');
  });

  it('gives up in the page a request aborted while the page answers it, by a call whose answer nothing reads', async () => {
    const page = new StandInPage(() => never());
    const controller = new AbortController();
    const pending = forwardInto(page)('https://e3-web.invalid/api/repos', { signal: controller.signal });
    while (page.called.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.deepEqual(page.called.map(({ name }) => name), ['fetch'], 'the abort is no call whose answer is read');
    assert.deepEqual(page.told, [{ name: 'abort', args: [0] }], 'the page is told to give the request up');
  });

  it('gives up in the page a request whose call into it failed — past the call\'s deadline, say — rejecting with what failed', async () => {
    const page = new StandInPage(() => Promise.reject(new Error('the page did not answer fetch in 120 s')));
    await assert.rejects(forwardInto(page)('https://e3-web.invalid/api/repos'), /^Error: the page did not answer fetch in 120 s$/);
    assert.deepEqual(page.told, [{ name: 'abort', args: [0] }], 'what the page was doing for it is given up');
  });
});
