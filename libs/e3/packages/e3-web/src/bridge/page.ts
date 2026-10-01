/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The page's side of `e3.fetch`: {@link createWebE3}, which connects a page to
 * its e3 worker, and gives the page the `fetch` the worker answers.
 *
 * @packageDocumentation
 */

import {
  WEB_E3_ORIGIN,
  errorText,
  holdLifeline,
  protocolMessage,
  watchLifeline,
  type PageMessage,
  type ReadyMessage,
  type ResponseMessage,
  type WorkerMessage,
} from './protocol.js';

/**
 * The e3 a page runs in its e3 worker: the URL and the `fetch` e3's client and
 * e3-ui-components are given, so every request they make is answered by the
 * worker, in the page.
 */
export interface WebE3 {
  /**
   * `https://e3-web.invalid`: the URL e3's client and e3-ui-components are
   * given, which only {@link WebE3.fetch} answers. Its origin is reserved, so
   * a request that bypasses `e3.fetch` fails at once rather than reaching the
   * network.
   */
  readonly apiUrl: string;
  /**
   * Answers a request in the e3 worker, with the global `fetch`'s signature:
   * the `fetch` of e3-api-client's `RequestOptions` and e3-ui-components'
   * `E3Config`.
   *
   * @remarks
   * - It posts the request's method, URL, every header and its body to the
   *   worker, and resolves to a `Response` made of the worker's answer. Each
   *   body crosses whole, as an `ArrayBuffer` transferred rather than copied;
   *   the caller's own body is copied once, as `fetch` copies it, and never
   *   taken from it.
   * - It answers only {@link WebE3.apiUrl}'s origin: a request to any other
   *   is refused with a `TypeError` naming that origin, and nothing is posted.
   * - The request's signal aborts it: the promise rejects with the signal's
   *   reason, an `AbortError` unless the caller gave another, and the signal
   *   of the `Request` the worker's handler was given aborts.
   * - A request the worker answers with no response — its handler threw —
   *   rejects with a `TypeError` carrying what failed, as `fetch` rejects a
   *   network failure. An error the app answers with a response, a 500 say,
   *   resolves to that response.
   * - Once the worker has stopped, failed or been closed, every request
   *   pending rejects with a `TypeError` saying which, and every later one is
   *   refused with it.
   * - It follows no redirect: a redirect the worker answers is the response.
   */
  readonly fetch: typeof globalThis.fetch;
  /**
   * Whether the browser keeps the worker's repositories through storage
   * pressure, rather than evicting them as it may evict an origin's storage
   * that is not persisted.
   *
   * @remarks
   * When the worker keeps repositories past the page, `createWebE3` asks
   * `navigator.storage.persist()` — only a page can ask it — and this is the
   * answer. With `requestPersistence: false` it does not ask, and this is
   * `navigator.storage.persisted()`'s answer. A worker that keeps nothing past
   * the page is never persisted, and a browser that has no storage manager,
   * or refuses the question, is taken to keep nothing.
   */
  readonly persisted: boolean;
  /**
   * Closes the e3 worker: terminates it, or, over a port, tells the e3 at its
   * other end that the page has closed — which closes it — and closes the
   * port. Every request pending rejects with a `TypeError` naming the close,
   * and every later one is refused with it. Closing it again does nothing.
   */
  close(): void;
}

/**
 * How {@link createWebE3} connects.
 */
export interface WebE3Options {
  /**
   * Whether to ask the browser to keep the worker's repositories through
   * storage pressure (`navigator.storage.persist()`), when the worker keeps
   * them: `true` unless given. An app that asks at a moment of its own
   * choosing gives `false` — Firefox asks its user, and `createWebE3` would
   * wait on the answer.
   */
  readonly requestPersistence?: boolean;
}

/**
 * How a connection is made: {@link WebE3Options}, and whether the page holds
 * a lifeline over a port.
 *
 * @internal
 */
export interface ConnectOptions extends WebE3Options {
  /**
   * Whether the page, connecting over a port, holds a lifeline the e3 at the
   * other end waits on to learn the page has gone: `true` unless given. A unit
   * worker's connection to its e3 worker holds none: the pool that started
   * the unit worker ends the e3's side as it lets the worker go.
   */
  readonly lifeline?: boolean;
}

/**
 * What the page's side speaks over: a dedicated worker, or a port to the
 * worker.
 */
interface Endpoint {
  postMessage(message: PageMessage, transfer: Transferable[]): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
}

/** A request posted to the worker, not yet settled. */
interface Pending {
  /** The request's method, which a failure names */
  readonly method: string;
  /** The request's URL, which a failure names */
  readonly url: string;
  /** Settles the request with the worker's response */
  resolve(response: Response): void;
  /** Settles the request with a failure */
  fail(err: unknown): void;
}

/** Each request's number: unique among the requests of every connection in
 *  this realm, so two connections over one worker never take each other's
 *  answers. */
let nextRequestId = 0;

/** What an `error` event says of the worker's failure. */
function failureOf(event: Event): string {
  const { message, filename, lineno } = event as Partial<ErrorEvent>;
  if (typeof message !== 'string' || message === '') return 'its script did not load, or raised an error it did not describe';
  return typeof filename === 'string' && filename !== '' ? `${message} (${filename}:${lineno ?? 0})` : message;
}

/**
 * The page's connection to its e3 worker: the requests it has posted, and why
 * it answers no more once it does not.
 */
class Connection {
  private readonly port: Endpoint;
  /** The requests posted and not yet settled, by number */
  private readonly pending = new Map<number, Pending>();
  /** Why the worker answers no more requests, once it does not */
  private ended: string | null = null;
  /** Whether the worker has said it is ready */
  private readied = false;
  /** Aborted as the connection ends: withdraws the wait on the worker's
   *  lifeline, and frees the page's */
  private readonly ending = new AbortController();
  /** Settles once the worker is ready, or has failed to start */
  readonly ready: Promise<ReadyMessage>;
  private settleReady!: { resolve(ready: ReadyMessage): void; reject(err: Error): void };

  /**
   * @param worker - The worker, or a port to it
   * @param lifeline - Whether the page holds a lifeline, over a port
   */
  constructor(private readonly worker: Worker | MessagePort, lifeline: boolean) {
    this.ready = new Promise<ReadyMessage>((resolve, reject) => {
      this.settleReady = { resolve, reject };
    });
    this.port = worker;
    this.port.addEventListener('message', (event) => this.receive((event as MessageEvent<unknown>).data));
    this.port.addEventListener('messageerror', () => this.end('the e3 worker failed: a message from it could not be read'));
    this.port.addEventListener('error', (event) => this.end(`the e3 worker failed: ${failureOf(event)}`));
    // A port's close event, where the platform fires one, is the worker's end.
    this.port.addEventListener('close', () => this.end('the e3 worker has stopped: its port has closed'));
    if (!('terminate' in worker)) worker.start();
    void this.hello(lifeline && !('terminate' in worker));
  }

  /**
   * Says hello to the worker, which answers whether it is ready, however long
   * ago it booted. Over a port, the page first takes the lifeline the e3 at
   * the other end waits on, held until the connection ends.
   */
  private async hello(withLifeline: boolean): Promise<void> {
    const ended = new Promise<void>((resolve) => {
      this.ending.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    const lifeline = withLifeline ? await holdLifeline('e3-web:page', ended) : null;
    if (this.ended !== null) return;
    try {
      this.post({ kind: 'hello', lifeline }, []);
    } catch (err) {
      this.end(`the e3 worker could not be reached: ${errorText(err)}`);
    }
  }

  /** Takes a message from the worker. */
  private receive(data: unknown): void {
    const message = protocolMessage<WorkerMessage>(data);
    if (message === null || this.ended !== null) return;
    switch (message.kind) {
      case 'ready':
        // Another connection's answer, over the same worker, once this one has
        // its own.
        if (this.readied) return;
        this.readied = true;
        this.watch(message.lifeline);
        this.settleReady.resolve(message);
        return;
      case 'boot-error':
        this.end(`the e3 worker did not start: ${message.message}`);
        return;
      case 'response':
        this.respond(message);
        return;
      case 'error': {
        const entry = this.take(message.id);
        entry?.fail(new TypeError(`e3.fetch: the e3 worker could not answer ${entry.method} ${entry.url}: ${message.message}`));
        return;
      }
    }
  }

  /** Settles a request with the worker's response. */
  private respond(message: ResponseMessage): void {
    // A request given up meanwhile is settled already.
    const entry = this.take(message.id);
    if (entry === undefined) return;
    let response: Response;
    try {
      response = new Response(message.body, { status: message.status, statusText: message.statusText, headers: message.headers });
    } catch (err) {
      entry.fail(new TypeError(`e3.fetch: the e3 worker's answer to ${entry.method} ${entry.url} is no response: ${errorText(err)}`));
      return;
    }
    entry.resolve(response);
  }

  /**
   * Waits on the Web Lock the worker holds while it lives: the browser frees
   * it once the worker has stopped, however it stopped — terminated by the
   * page's own code, or closed by itself — which no event tells the page.
   */
  private watch(lifeline: string | null): void {
    watchLifeline(lifeline, this.ending.signal, () => {
      this.end('the e3 worker has stopped: it was terminated, or it closed itself');
    });
  }

  /** Takes a pending request away, to settle it. */
  private take(id: number): Pending | undefined {
    const entry = this.pending.get(id);
    this.pending.delete(id);
    return entry;
  }

  /**
   * Ends the connection: stops the worker, or closes the port to it, fails the
   * boot if it has not finished, and fails every request pending; later
   * requests are refused. The page's lifeline is freed.
   *
   * @param reason - What happened, as every failure names it
   */
  private end(reason: string): void {
    if (this.ended !== null) return;
    this.ended = reason;
    this.ending.abort();
    if ('terminate' in this.worker) this.worker.terminate();
    else this.worker.close();
    this.settleReady.reject(new Error(`createWebE3: ${reason}`));
    for (const entry of this.pending.values()) entry.fail(new TypeError(`e3.fetch: ${reason}`));
    this.pending.clear();
  }

  /** Refuses a request that cannot be sent: its signal has aborted, or the
   *  worker answers no more. */
  private check(signal: AbortSignal): void {
    if (signal.aborted) throw signal.reason;
    if (this.ended !== null) throw new TypeError(`e3.fetch: ${this.ended}`);
  }

  /** Answers a request in the worker: {@link WebE3.fetch}. */
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // As `fetch` does: method, headers, body and signal normalized, and
    // refused as `fetch` refuses them.
    const request = new Request(input, init);
    if (new URL(request.url).origin !== WEB_E3_ORIGIN) {
      throw new TypeError(`e3.fetch: e3.fetch answers ${WEB_E3_ORIGIN} alone (e3.apiUrl), and ${request.url} is not on it`);
    }
    this.check(request.signal);
    let body: ArrayBuffer | null = null;
    if (request.body !== null) {
      // The request's own copy of the caller's body, which is the caller's
      // still; this copy is transferred.
      try {
        body = await request.arrayBuffer();
      } catch (err) {
        throw new TypeError(`e3.fetch: the body of ${request.method} ${request.url} could not be read: ${errorText(err)}`);
      }
      this.check(request.signal);
    }
    return this.send(request, body);
  }

  /** Posts a request to the worker, and settles once it is answered, given
   *  up or failed. */
  private send(request: Request, body: ArrayBuffer | null): Promise<Response> {
    const id = nextRequestId++;
    const { method, url, signal } = request;
    return new Promise<Response>((resolve, reject) => {
      const onAbort = (): void => {
        if (this.take(id) === undefined) return;
        this.post({ kind: 'abort', id }, []);
        reject(signal.reason);
      };
      this.pending.set(id, {
        method,
        url,
        resolve: (response) => {
          signal.removeEventListener('abort', onAbort);
          resolve(response);
        },
        fail: (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      });
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        this.post({ kind: 'request', id, method, url, headers: [...request.headers], body }, body === null ? [] : [body]);
      } catch (err) {
        this.take(id)?.fail(new TypeError(`e3.fetch: ${method} ${url} could not be posted to the e3 worker: ${errorText(err)}`));
      }
    });
  }

  private post(message: PageMessage, transfer: Transferable[]): void {
    this.port.postMessage(message, transfer);
  }

  /** Closes the worker: {@link WebE3.close}. */
  close(): void {
    // Over a port, the e3 at the other end is told: a browser's port says
    // nothing as it closes.
    if (this.ended === null && !('terminate' in this.worker)) {
      try {
        this.post({ kind: 'close' }, []);
      } catch {
        // The port is closed already.
      }
    }
    this.end('e3.close() has closed the e3 worker');
  }
}

/**
 * Asks the browser to keep the origin's storage through storage pressure, or
 * only whether it does, and answers whether it does.
 */
async function keepsRepositories(ask: boolean): Promise<boolean> {
  const storage = (globalThis.navigator as Navigator | undefined)?.storage as StorageManager | undefined;
  try {
    // `persist` is a page's alone; a worker has `persisted` only.
    if (ask && typeof storage?.persist === 'function') return await storage.persist();
    if (typeof storage?.persisted === 'function') return await storage.persisted();
  } catch {
    // A browser that refuses the question keeps nothing through pressure.
  }
  return false;
}

/**
 * Connects a page to its e3 worker, once the worker has booted.
 *
 * The worker runs e3 itself — its storage, its runner and its API — and this
 * gives the page {@link WebE3.fetch}, which the worker answers, and
 * {@link WebE3.apiUrl}, the URL e3's client and e3-ui-components are given
 * with it. No request reaches the network.
 *
 * @param worker - The e3 worker: a dedicated worker running e3, or a port to
 *   one. It is the connection's from now on, and {@link WebE3.close} closes it
 * @param options - Whether to ask the browser to keep the repositories
 * @returns The e3, once the worker says it is ready
 *
 * @throws {Error} When the worker does not start: its boot failed — a
 *   browser API it needs is missing, say, which the message names — or it
 *   failed or stopped before it was ready. The worker is closed.
 *
 * @remarks
 * - The page says hello, and the worker answers whether it is ready, and
 *   whether it keeps repositories past the page, however long ago it booted:
 *   a page may connect at any time. When it keeps them, the page asks the
 *   browser to keep them ({@link WebE3.persisted}).
 * - The page learns that the worker has stopped — terminated by other code,
 *   or closed by itself, which no event tells it — through a Web Lock the
 *   worker holds while it lives; an `error` or `messageerror` event of the
 *   worker, or its port's closing, ends the connection too. Each fails every
 *   request pending, naming what happened, and refuses every later one.
 * - Over a port, the page holds a Web Lock of its own while it is connected,
 *   which the e3 at the other end waits on: the e3 closes once the page has
 *   gone — its tab closed — as it does when {@link WebE3.close} tells it.
 * - A body crosses between the page and the worker whole, as an
 *   `ArrayBuffer` transferred rather than copied.
 *
 * @example
 * ```ts
 * import { createWebE3 } from '@elaraai/e3-web';
 * import { repoList } from '@elaraai/e3-api-client';
 *
 * const e3 = await createWebE3(new Worker(new URL('./e3.worker.ts', import.meta.url), { type: 'module' }));
 * const repos = await repoList(e3.apiUrl, { token: null, fetch: e3.fetch });
 * ```
 */
export function createWebE3(worker: Worker | MessagePort, options: WebE3Options = {}): Promise<WebE3> {
  return connectWebE3(worker, options);
}

/**
 * Connects to an e3 worker: {@link createWebE3}, with whether the page holds
 * a lifeline over a port.
 *
 * @param worker - The e3 worker, or a port to one
 * @param options - Whether to ask the browser to keep the repositories, and
 *   whether to hold a lifeline
 * @returns The e3, once the worker says it is ready
 * @throws {Error} As {@link createWebE3} throws
 * @internal
 */
export async function connectWebE3(worker: Worker | MessagePort, options: ConnectOptions = {}): Promise<WebE3> {
  const connection = new Connection(worker, options.lifeline ?? true);
  const ready = await connection.ready;
  const persisted = ready.persist && await keepsRepositories(options.requestPersistence ?? true);
  return {
    apiUrl: WEB_E3_ORIGIN,
    fetch: (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => connection.fetch(input, init),
    persisted,
    close: () => connection.close(),
  };
}
