/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The e3 worker's side of `e3.fetch`: {@link serveBridge}, which boots the
 * worker's e3, tells each page that says hello whether it is ready, and
 * answers the page's requests.
 *
 * `serveE3`, the e3 worker's public entry, serves through it: its boot opens
 * the storage and the runner, and its handler is the app that mounts e3's
 * routes.
 *
 * @packageDocumentation
 */

import {
  errorText,
  holdLifeline,
  protocolMessage,
  watchLifeline,
  type HelloMessage,
  type PageMessage,
  type RequestMessage,
  type WorkerMessage,
} from './protocol.js';

/**
 * What answers a request in the worker: a fetch handler, as Hono's
 * `app.fetch` is. It is called as a plain function, never as a method.
 */
export type RequestHandler = (request: Request) => Response | Promise<Response>;

/**
 * What the worker's boot resolves to.
 */
export interface BridgeBoot {
  /** Answers each request the page posts */
  readonly fetch: RequestHandler;
  /** Whether the worker keeps repositories past the page's life, so the page
   *  asks the browser to keep them through storage pressure */
  readonly persist: boolean;
}

/**
 * What the worker's side speaks over: a dedicated worker's global scope, or a
 * `MessagePort`.
 */
export interface BridgeEndpoint {
  postMessage(message: WorkerMessage, transfer: Transferable[]): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
  /** Starts a port's messages; a worker's global scope has none to start */
  start?(): void;
}

/**
 * How {@link serveBridge} serves.
 */
export interface BridgeOptions {
  /**
   * Whether the worker holds a lifeline the page waits on to learn it has
   * stopped, and waits on the lifeline a page connected over a port names, to
   * learn the page has gone: `true` unless given. The port a unit worker is
   * handed has neither: the pool that let the worker go ends its bridge
   * ({@link BridgeServer.end}).
   */
  readonly lifelines?: boolean;
  /**
   * Told once, when the page has gone: it closed its connection over a port,
   * the lifeline it named was freed, or its port closed. The bridge has ended
   * by then. Not told when {@link BridgeServer.end} ends it.
   */
  readonly onEnd?: () => void;
}

/**
 * A bridge being served.
 */
export interface BridgeServer {
  /**
   * Ends the bridge: every request it is answering is aborted, and it answers
   * nothing the page posts after. Its lifeline is freed. Ending it again does
   * nothing.
   */
  end(): void;
}

/** Lets a response's body go unread. */
async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/**
 * Serves `e3.fetch` from an e3 worker: boots the worker's e3, tells each page
 * that says hello whether it is ready, or that it failed, and answers each
 * request the page posts with the boot's handler.
 *
 * @param boot - Boots the worker's e3: resolves to the handler that answers
 *   requests, and whether the worker keeps repositories past the page; or
 *   rejects with what failed — a browser API it lacks, named — which the
 *   page's `createWebE3` rejects with
 * @param endpoint - What the page's messages come over: the worker's global
 *   scope unless given, or a `MessagePort`
 * @param options - Whether it holds and waits on lifelines, and what it tells
 *   when the page has gone
 * @returns The bridge, which its host may end
 *
 * @remarks
 * - The worker answers every hello, once its boot has settled: `ready`, or
 *   `boot-error` with what failed. A page that connects late — long after the
 *   boot, or a second time — is answered as the first.
 * - The page posts its requests once it is told the worker is ready; a
 *   request that came sooner would wait for the boot.
 * - Each request reaches the handler as a `Request` whose signal aborts when
 *   the page gives the request up, or when the bridge ends.
 * - The handler's response is posted back: its status, status text, headers
 *   and body, the body whole and transferred. A `HEAD` request's response has
 *   no body, as `fetch` gives it none.
 * - A handler that throws, or whose response's body fails, is answered with
 *   no response: the page's `fetch` rejects with a `TypeError` carrying what
 *   failed, as `fetch` rejects a network failure. An app answers its own
 *   errors with responses: Hono's `app.fetch` answers what a route throws
 *   with a 500.
 * - Unless told otherwise, the worker holds a Web Lock for as long as it
 *   lives, and names it to the page, which learns from it that the worker has
 *   stopped. Over a port, the bridge ends when the page posts `close`, when
 *   the lifeline the page named is freed — its tab has gone — or when the port
 *   closes, where the platform says so; {@link BridgeOptions.onEnd} is told.
 *
 * @example
 * ```ts
 * // e3.worker.ts
 * import { Hono } from 'hono';
 * import { openWebStorage } from '@elaraai/e3-web';
 *
 * serveBridge(async () => {
 *   const storage = await openWebStorage();   // refuses, naming the API, in a browser that lacks one
 *   const app = new Hono();
 *   app.get('/api/repos', async (c) => c.json(await storage.repos.list()));
 *   return { fetch: app.fetch, persist: true };
 * });
 * ```
 */
export function serveBridge(
  boot: () => Promise<BridgeBoot>,
  endpoint: BridgeEndpoint = globalThis as unknown as BridgeEndpoint,
  options: BridgeOptions = {},
): BridgeServer {
  const lifelines = options.lifelines ?? true;
  /** The requests being answered, by number: what aborts each */
  const answering = new Map<number, AbortController>();
  const booted = Promise.resolve().then(boot);
  // A boot that failed is told to each page that says hello.
  booted.catch(() => undefined);
  /** Aborted once the bridge ends: frees its lifeline, and withdraws its
   *  waits on the page's */
  const ending = new AbortController();
  const ended = new Promise<void>((resolve) => {
    ending.signal.addEventListener('abort', () => resolve(), { once: true });
  });
  /** The worker's lifeline, once taken: one for every page that says hello */
  let lifeline: Promise<string | null> | null = null;

  const post = (message: WorkerMessage, transfer: Transferable[] = []): void => endpoint.postMessage(message, transfer);

  const end = (): void => {
    if (ending.signal.aborted) return;
    ending.abort();
    for (const abort of answering.values()) abort.abort();
  };

  /** Ends the bridge as the page has gone, and says so. */
  const gone = (): void => {
    if (ending.signal.aborted) return;
    end();
    options.onEnd?.();
  };

  /** Answers a page's hello, once the boot has settled. */
  function greet(hello: HelloMessage): void {
    if (lifelines) watchLifeline(hello.lifeline, ending.signal, gone);
    void booted.then(
      async ({ persist }) => {
        const name = lifelines ? await (lifeline ??= holdLifeline('e3-web:worker', ended)) : null;
        if (!ending.signal.aborted) post({ kind: 'ready', persist, lifeline: name });
      },
      (err: unknown) => {
        if (!ending.signal.aborted) post({ kind: 'boot-error', message: errorText(err) });
      },
    );
  }

  /** Answers a request with the handler's response, or with what failed. */
  async function answer(message: RequestMessage): Promise<void> {
    const { id } = message;
    const abort = new AbortController();
    answering.set(id, abort);
    try {
      const { fetch } = await booted;
      const request = new Request(message.url, {
        method: message.method,
        headers: message.headers,
        body: message.body,
        signal: abort.signal,
      });
      const response = await fetch(request);
      if (response.type === 'error') throw new Error('its handler answered with a network error (Response.error())');
      let body: ArrayBuffer | null = null;
      if (message.method === 'HEAD' || response.body === null || abort.signal.aborted) await discard(response);
      else body = await response.arrayBuffer();
      // A request the page has given up, or the bridge ended, is answered no
      // more.
      if (abort.signal.aborted) return;
      post({
        kind: 'response',
        id,
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers],
        body,
      }, body === null ? [] : [body]);
    } catch (err) {
      if (!abort.signal.aborted) post({ kind: 'error', id, message: errorText(err) });
    } finally {
      answering.delete(id);
    }
  }

  endpoint.addEventListener('message', (event) => {
    if (ending.signal.aborted) return;
    const message = protocolMessage<PageMessage>((event as MessageEvent<unknown>).data);
    switch (message?.kind) {
      case 'hello':
        greet(message);
        return;
      case 'request':
        void answer(message);
        return;
      case 'abort':
        answering.get(message.id)?.abort();
        return;
      case 'close':
        gone();
        return;
      default:
        return;
    }
  });
  // A port's close event, where the platform fires one — Node's does, a
  // browser's does not — says the page has gone. A worker's global scope
  // never closes so; the worker ends.
  endpoint.addEventListener('close', () => gone());
  endpoint.start?.();

  return { end };
}
