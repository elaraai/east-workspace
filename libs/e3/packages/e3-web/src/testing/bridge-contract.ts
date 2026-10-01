/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3.fetch`'s contract: what a page's `createWebE3` and its e3 worker's
 * `serveBridge` do together, over either transport.
 *
 * A case is a plain function over a setup, asserting with `./assert.js`, as
 * the adapters' cases are (`./adapter-contract.js`, whose runner runs these
 * too). In Node it runs over a `MessageChannel`, the worker's side in
 * process; in a page it runs over a dedicated worker, where the page runs it
 * by name and the Node-side spec reports it as a test of its own. Both
 * workers answer with the contract's plain handler (`./bridge-handler.js`).
 *
 * @packageDocumentation
 */

import { createWebE3, type WebE3 } from '../bridge/page.js';
import { WEB_E3_ORIGIN, protocolMessage, type PageMessage, type RequestMessage, type WorkerMessage } from '../bridge/protocol.js';
import type { AdapterCase } from './adapter-contract.js';
import { deepEqual, equal, ok, rejects } from './assert.js';
import type { ContractBoot } from './bridge-handler.js';

// =============================================================================
// Setups
// =============================================================================

/**
 * A worker a case started, and what it can see of it.
 */
export interface StartedWorker {
  /** What `createWebE3` is given: the worker, or the page's end of a channel
   *  to it */
  readonly endpoint: Worker | MessagePort;
  /** Each message the page's side posted to the worker, as it posted it */
  readonly posted: readonly PageMessage[];
  /** Stops the worker as a crash stops it: nothing of the page's is told */
  kill(): void;
}

/**
 * What a case runs over: workers it starts, which answer with the contract's
 * handler.
 */
export interface BridgeSetup {
  /** Starts a worker that boots as named, stopped once the case has run */
  start(boot: ContractBoot): StartedWorker;
  /** The API a refused boot's page lacks, as the refusal names it */
  readonly missing: string;
  /**
   * Records each answer to the page's asks of `navigator.storage.persist()`
   * from now until the case has run, in the order asked.
   */
  persistAsks(): readonly boolean[];
}

/** A case of the contract. */
export type BridgeCase = AdapterCase<BridgeSetup>;

/**
 * Records each message the page's side posts over an endpoint, as it posts
 * it: a request's body, once transferred, is detached in the record too.
 *
 * @param endpoint - The worker, or the page's end of a channel to it
 * @returns The messages posted, as they are posted
 */
export function recordPosts(endpoint: Worker | MessagePort): PageMessage[] {
  const posted: PageMessage[] = [];
  const post = endpoint.postMessage.bind(endpoint) as (message: PageMessage, transfer: Transferable[]) => void;
  Object.defineProperty(endpoint, 'postMessage', {
    configurable: true,
    value: (message: PageMessage, transfer: Transferable[]) => {
      posted.push(message);
      post(message, transfer);
    },
  });
  return posted;
}

// =============================================================================
// Helpers
// =============================================================================

const encoder = new TextEncoder();

/** A JSON response's value. */
async function json(response: Response): Promise<unknown> {
  return JSON.parse(await response.text()) as unknown;
}

/** The requests among the messages posted. */
function requestsOf(posted: readonly PageMessage[]): RequestMessage[] {
  return posted.filter((message): message is RequestMessage => message.kind === 'request');
}

/** Whether a `/wait` request of a key has reached the worker's handler. */
async function began(e3: WebE3, key: string): Promise<boolean> {
  return (await json(await e3.fetch(`${e3.apiUrl}/began/${key}`))) === true;
}

/** The length now of each response body the worker posted, by its
 *  request's number. */
async function workerTransfers(e3: WebE3): Promise<Map<number, number>> {
  return new Map(await json(await e3.fetch(`${e3.apiUrl}/transfers`)) as Array<[number, number]>);
}

/**
 * Waits for the worker to answer a hello the case posts itself, as a page that
 * connected before would have: once it has answered, its boot has settled,
 * and what it would have said unasked has gone to no connection.
 *
 * @param endpoint - The worker, or the page's end of a channel to it
 * @returns Its answer: ready, or its boot's error
 */
function answered(endpoint: Worker | MessagePort): Promise<WorkerMessage> {
  return new Promise<WorkerMessage>((resolve) => {
    const hear = (event: Event): void => {
      const message = protocolMessage<WorkerMessage>((event as MessageEvent<unknown>).data);
      if (message?.kind !== 'ready' && message?.kind !== 'boot-error') return;
      endpoint.removeEventListener('message', hear);
      resolve(message);
    };
    endpoint.addEventListener('message', hear);
    if (!('terminate' in endpoint)) endpoint.start();
    endpoint.postMessage({ kind: 'hello', lifeline: null });
  });
}

/** A regular expression that matches a text as it is. */
function literally(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================================================
// The contract
// =============================================================================

/**
 * The contract every transport holds: over a `MessageChannel` in Node, and
 * over a dedicated worker in a page.
 */
export const bridgeContract: readonly BridgeCase[] = [
  {
    name: 'answers a request with the worker\'s response, each body crossing whole and transferred, the caller\'s kept',
    run: async ({ start }) => {
      const started = start('memory');
      const e3 = await createWebE3(started.endpoint);
      equal(e3.apiUrl, WEB_E3_ORIGIN);
      equal(e3.apiUrl, 'https://e3-web.invalid');
      const sent = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
      const response = await e3.fetch(`${e3.apiUrl}/reverse`, { method: 'POST', body: sent });
      equal(response.status, 200);
      equal(response.headers.get('content-type'), 'application/octet-stream');
      deepEqual(new Uint8Array(await response.arrayBuffer()), sent.slice().reverse(), 'the answer is the body, reversed');
      deepEqual(sent, Uint8Array.from({ length: 1000 }, (_, i) => i % 251), 'the caller\'s body is the caller\'s still');

      const [request] = requestsOf(started.posted);
      ok(request !== undefined, 'the request was posted');
      equal(request.method, 'POST');
      equal(request.url, 'https://e3-web.invalid/reverse');
      ok(request.body !== null, 'with its body');
      equal(request.body.byteLength, 0, 'the body the page posted was transferred: it is detached');
      equal((await workerTransfers(e3)).get(request.id), 0, 'the body the worker posted was transferred: it is detached');
    },
  },
  {
    name: 'sends a streamed body whole, as e3\'s client streams an upload',
    run: async ({ start }) => {
      const e3 = await createWebE3(start('memory').endpoint);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const part of ['a ', 'streamed ', 'body']) controller.enqueue(encoder.encode(part));
          controller.close();
        },
      });
      const response = await e3.fetch(`${e3.apiUrl}/reverse`, { method: 'PUT', body, duplex: 'half' } as RequestInit);
      equal(await response.text(), 'ydob demaerts a');
    },
  },
  {
    name: 'carries every header each way, a header given twice among them',
    run: async ({ start }) => {
      const e3 = await createWebE3(start('memory').endpoint);
      const response = await e3.fetch(`${e3.apiUrl}/headers`, {
        headers: [['x-repeated', 'one'], ['x-repeated', 'two'], ['authorization', 'Bearer a-token'], ['accept', 'application/beast2']],
      });
      const seen = new Map(await json(response) as Array<[string, string]>);
      equal(seen.get('x-repeated'), 'one, two', 'a request header given twice reaches the handler as fetch combines it');
      equal(seen.get('authorization'), 'Bearer a-token');
      equal(seen.get('accept'), 'application/beast2');
      equal(response.headers.get('x-answer'), 'first, second', 'a response header given twice reaches the page as fetch combines it');
      equal(response.headers.get('content-type'), 'application/json');
    },
  },
  {
    name: 'answers with the handler\'s status and status text, an error\'s among them',
    run: async ({ start }) => {
      const e3 = await createWebE3(start('memory').endpoint);
      const teapot = await e3.fetch(`${e3.apiUrl}/status/418/I'm%20a%20teapot`);
      equal(teapot.status, 418);
      equal(teapot.statusText, 'I\'m a teapot');
      equal(teapot.ok, false);
      equal(await teapot.text(), 'status 418');
      const failed = await e3.fetch(`${e3.apiUrl}/status/500/Internal%20Server%20Error`);
      equal(failed.status, 500, 'an error the app answers with a response is that response');
      equal(failed.statusText, 'Internal Server Error');
      const created = await e3.fetch(`${e3.apiUrl}/status/201/Created`, { method: 'POST' });
      equal(created.status, 201);
      equal(created.statusText, 'Created');
      equal(created.ok, true);
    },
  },
  {
    name: 'answers an empty body as empty, a 204 with none, and a HEAD request with none',
    run: async ({ start }) => {
      const e3 = await createWebE3(start('memory').endpoint);
      const empty = await e3.fetch(`${e3.apiUrl}/empty`);
      equal(empty.status, 200);
      ok(empty.body !== null, 'an empty body is a body');
      equal((await empty.arrayBuffer()).byteLength, 0);
      const none = await e3.fetch(`${e3.apiUrl}/none`, { method: 'DELETE' });
      equal(none.status, 204);
      equal(none.body, null);
      const head = await e3.fetch(`${e3.apiUrl}/headers`, { method: 'HEAD' });
      equal(head.status, 200);
      equal(head.body, null, 'a HEAD request\'s response has no body, though its handler gave one');
      equal(head.headers.get('x-answer'), 'first, second', 'and has its headers');
    },
  },
  {
    name: 'rejects a request whose handler throws with a TypeError carrying what it threw, as fetch rejects a network failure',
    run: async ({ start }) => {
      const e3 = await createWebE3(start('memory').endpoint);
      await rejects(() => e3.fetch(`${e3.apiUrl}/throw`), {
        name: 'TypeError',
        message: /^e3\.fetch: the e3 worker could not answer GET https:\/\/e3-web\.invalid\/throw: the handler broke$/,
      });
      equal((await e3.fetch(`${e3.apiUrl}/empty`)).status, 200, 'and answers the next request');
    },
  },
  {
    name: 'rejects a request whose signal aborted before it was sent with an AbortError, posting nothing',
    run: async ({ start }) => {
      const started = start('memory');
      const e3 = await createWebE3(started.endpoint);
      const controller = new AbortController();
      controller.abort();
      await rejects(() => e3.fetch(`${e3.apiUrl}/wait/early`, { signal: controller.signal }), { name: 'AbortError' });
      deepEqual(requestsOf(started.posted), [], 'nothing was posted');
      equal(await began(e3, 'early'), false, 'the handler never saw it');
    },
  },
  {
    name: 'rejects a request whose signal aborts while its handler runs with an AbortError, and aborts the handler\'s request',
    run: async ({ start }) => {
      const started = start('memory');
      const e3 = await createWebE3(started.endpoint);
      const controller = new AbortController();
      const pending = e3.fetch(`${e3.apiUrl}/wait/during`, { signal: controller.signal });
      equal(await began(e3, 'during'), true, 'the handler has the request');
      controller.abort();
      await rejects(() => pending, { name: 'AbortError' });
      equal(await json(await e3.fetch(`${e3.apiUrl}/seen/during`)), 'AbortError', 'the handler saw its request\'s signal abort');
      equal(started.posted.filter((message) => message.kind === 'abort').length, 1, 'the page posted the abort once');
    },
  },
  {
    name: 'refuses a request off e3-web.invalid with a TypeError naming e3.fetch\'s one origin, posting nothing',
    run: async ({ start }) => {
      const started = start('memory');
      const e3 = await createWebE3(started.endpoint);
      for (const url of [
        'https://example.com/api/repos',
        'http://e3-web.invalid/api/repos',
        'https://e3-web.invalid:8443/api/repos',
        'https://api.e3-web.invalid/api/repos',
      ]) {
        await rejects(() => e3.fetch(url), {
          name: 'TypeError',
          message: new RegExp(`^e3\\.fetch: e3\\.fetch answers https://e3-web\\.invalid alone \\(e3\\.apiUrl\\), and ${literally(url)} is not on it$`),
        }, url);
      }
      deepEqual(requestsOf(started.posted), [], 'nothing was posted');
    },
  },
  {
    name: 'rejects the requests pending when e3.close() closes the worker, and refuses every one after, naming the close',
    run: async ({ start }) => {
      const e3 = await createWebE3(start('memory').endpoint);
      const pending = e3.fetch(`${e3.apiUrl}/wait/closed`);
      equal(await began(e3, 'closed'), true);
      e3.close();
      await rejects(() => pending, { name: 'TypeError', message: /^e3\.fetch: e3\.close\(\) has closed the e3 worker$/ });
      await rejects(() => e3.fetch(`${e3.apiUrl}/empty`), { name: 'TypeError', message: /^e3\.fetch: e3\.close\(\) has closed the e3 worker$/ });
      e3.close();
      await rejects(() => e3.fetch(`${e3.apiUrl}/empty`), { message: /e3\.close\(\) has closed/ }, 'closing it again changes nothing');
    },
  },
  {
    name: 'rejects the requests pending when the worker stops mid-request — terminated, or its port closed — and refuses every one after, naming it',
    run: async ({ start }) => {
      const started = start('memory');
      const e3 = await createWebE3(started.endpoint);
      const pending = e3.fetch(`${e3.apiUrl}/wait/stopped`);
      equal(await began(e3, 'stopped'), true);
      started.kill();
      await rejects(() => pending, { name: 'TypeError', message: /^e3\.fetch: the e3 worker has stopped: / });
      await rejects(() => e3.fetch(`${e3.apiUrl}/empty`), { name: 'TypeError', message: /^e3\.fetch: the e3 worker has stopped: / });
    },
  },
  {
    name: 'rejects the requests pending when a message from the worker cannot be read, and refuses every one after',
    run: async ({ start }) => {
      const started = start('memory');
      const e3 = await createWebE3(started.endpoint);
      const pending = e3.fetch(`${e3.apiUrl}/wait/unread`);
      equal(await began(e3, 'unread'), true);
      started.endpoint.dispatchEvent(new MessageEvent('messageerror'));
      const unread = /^e3\.fetch: the e3 worker failed: a message from it could not be read$/;
      await rejects(() => pending, { name: 'TypeError', message: unread });
      await rejects(() => e3.fetch(`${e3.apiUrl}/empty`), { name: 'TypeError', message: unread });
    },
  },
  {
    name: 'rejects when the worker\'s boot fails, with the boot\'s message, which names the API the browser lacks',
    run: async ({ start, missing }) => {
      await rejects(() => createWebE3(start('refused').endpoint), {
        name: 'Error',
        message: new RegExp(
          `^createWebE3: the e3 worker did not start: e3-web cannot keep repositories in this page: it has no ${literally(missing)} `,
        ),
      });
    },
  },
  {
    name: 'connects a createWebE3 called once the worker has booted and answered another, and rejects one over a boot that failed, naming the API',
    run: async ({ start, missing }) => {
      const booted = start('memory');
      equal((await answered(booted.endpoint)).kind, 'ready', 'the worker has booted, and said so to a page before');
      const late = await createWebE3(booted.endpoint);
      equal((await late.fetch(`${late.apiUrl}/empty`)).status, 200, 'a page that connects after is answered');
      const refused = start('refused');
      equal((await answered(refused.endpoint)).kind, 'boot-error', 'the worker\'s boot has failed, and it said so to a page before');
      await rejects(() => createWebE3(refused.endpoint), {
        name: 'Error',
        message: new RegExp(
          `^createWebE3: the e3 worker did not start: e3-web cannot keep repositories in this page: it has no ${literally(missing)} `,
        ),
      });
    },
  },
  {
    name: 'asks the browser to keep the repositories of a worker that keeps them, and reports its answer as persisted',
    run: async ({ start, persistAsks }) => {
      const answers = persistAsks();
      const unasked = await createWebE3(start('persist').endpoint, { requestPersistence: false });
      equal(answers.length, 0, 'an app that asks for itself is not asked for');
      equal(unasked.persisted, await navigator.storage.persisted(), 'and is told whether the browser keeps them');
      const memory = await createWebE3(start('memory').endpoint);
      equal(answers.length, 0, 'a worker that keeps nothing past the page asks nothing');
      equal(memory.persisted, false);
      const kept = await createWebE3(start('persist').endpoint);
      equal(answers.length, 1, 'a worker that keeps repositories asks the browser to keep them, once');
      equal(kept.persisted, answers[0], 'and is told its answer');
    },
  },
];

/**
 * What only a dedicated worker in a page shows: a body of 64 MiB, a worker
 * that closes itself, and an error the worker raises and does not catch.
 */
export const browserBridgeContract: readonly BridgeCase[] = [
  {
    name: 'carries a 64 MiB body each way, each transferred',
    run: async ({ start }) => {
      const started = start('memory');
      const e3 = await createWebE3(started.endpoint);
      const size = 64 * 1024 * 1024;
      const sent = new Uint8Array(size);
      for (let i = 0; i < size; i++) sent[i] = (i ^ (i >>> 8) ^ (i >>> 16)) & 0xff;
      const response = await e3.fetch(`${e3.apiUrl}/reverse`, { method: 'POST', body: sent });
      const received = new Uint8Array(await response.arrayBuffer());
      equal(received.length, size);
      let differs = -1;
      for (let i = 0; i < size && differs < 0; i++) if (received[i] !== sent[size - 1 - i]) differs = i;
      equal(differs, -1, 'the answer is the body, reversed');
      const [request] = requestsOf(started.posted);
      ok(request !== undefined && request.body !== null, 'the request was posted with its body');
      equal(request.body.byteLength, 0, 'the 64 MiB the page posted were transferred');
      equal((await workerTransfers(e3)).get(request.id), 0, 'the 64 MiB the worker posted were transferred');
    },
  },
  {
    name: 'rejects the requests pending when the worker closes itself mid-request, and refuses every one after',
    run: async ({ start }) => {
      const e3 = await createWebE3(start('memory').endpoint);
      const pending = e3.fetch(`${e3.apiUrl}/wait/exited`);
      equal(await began(e3, 'exited'), true);
      const exiting = e3.fetch(`${e3.apiUrl}/exit`);
      const stopped = /^e3\.fetch: the e3 worker has stopped: it was terminated, or it closed itself$/;
      await rejects(() => pending, { name: 'TypeError', message: stopped });
      await rejects(() => exiting, { name: 'TypeError', message: stopped });
      await rejects(() => e3.fetch(`${e3.apiUrl}/empty`), { name: 'TypeError', message: stopped });
    },
  },
  {
    name: 'rejects the requests pending when the worker raises an error it does not catch, naming it, and refuses every one after',
    run: async ({ start }) => {
      const started = start('memory');
      const e3 = await createWebE3(started.endpoint);
      // The page reports a worker's error it leaves unhandled as its own; the
      // case has it in hand.
      (started.endpoint as Worker).addEventListener('error', (event) => event.preventDefault());
      const pending = e3.fetch(`${e3.apiUrl}/wait/raised`);
      equal(await began(e3, 'raised'), true);
      const raising = e3.fetch(`${e3.apiUrl}/raise`);
      const raised = /^e3\.fetch: the e3 worker failed: Uncaught Error: the e3 worker raised this \(http:\/\/127\.0\.0\.1:\d+\/bridge-worker\.js\?boot=memory:\d+\)$/;
      await rejects(() => pending, { name: 'TypeError', message: raised });
      await rejects(() => raising, { name: 'TypeError', message: raised });
      await rejects(() => e3.fetch(`${e3.apiUrl}/empty`), { name: 'TypeError', message: raised });
    },
  },
];
