/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The test page of e3-web's specs of the whole e3: a page of an app, which
 * starts its e3 worker (`e3.worker.ts`) and connects with `createWebE3`, and
 * answers each request Node forwards with its `e3.fetch` — so the shared API
 * suites, run in Node, are answered by e3 in Chromium, over IndexedDB, OPFS,
 * Web Workers and Web Locks. It also serves e3 over a `MessagePort`, from a
 * worker of its own (`e3-port.worker.ts`), connected to by the page or by a
 * stand-in for another page (`e3-client.worker.ts`), and says which Web Locks
 * its origin holds.
 *
 * The harness bundles it for Chromium; `e3-api.spec.ts` and `e3.spec.ts`
 * drive it.
 *
 * @packageDocumentation
 */

import { connectWebE3, createWebE3, type WebE3 } from '../bridge/page.js';
import { deleteIndexedDbRecords } from '../storage/indexeddb.js';
import { fromBase64, toBase64, type WireRequest, type WireResponse } from './e3-wire.js';
import { servePage } from './page.js';

/** How the page's e3 worker runs. */
export interface E3PageOptions {
  /** What its storage is named after: the IndexedDB database and the OPFS
   *  directory its repositories are kept in */
  readonly name: string;
  /** Whether its units hold in `test_hold` until the page closes */
  readonly hold: boolean;
  /** The piece size its split tasks are planned with, as
   *  `E3_TEST_PIECE_BYTES` sets it, or `null` for the platform's */
  readonly pieceBytes: number | null;
}

/** What the page's e3 says as it connects. */
export interface E3PageStarted {
  readonly apiUrl: string;
  readonly persisted: boolean;
}

/** The page's e3, once started. */
let e3: WebE3 | null = null;

/** The requests in flight, by the number Node gave each: what aborts each. */
const inFlight = new Map<number, AbortController>();

/** The stand-in for another page, connected to an e3 over a port. */
let client: Worker | null = null;

/** Starts an e3 worker that serves e3 over a port, under a storage's name, and
 *  answers the other end of the port. */
function servedOverPort(name: string): MessagePort {
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker('/e3-port-worker.js', { type: 'module' });
  worker.postMessage({ port: port1, name }, [port1]);
  return port2;
}

servePage({
  /** Starts the page's e3 worker, and connects to it. */
  async start(options: E3PageOptions): Promise<E3PageStarted> {
    if (e3 !== null) throw new Error('the page has started its e3 already');
    const params = new URLSearchParams({ name: options.name, hold: options.hold ? '1' : '0' });
    if (options.pieceBytes !== null) params.set('pieceBytes', String(options.pieceBytes));
    e3 = await createWebE3(new Worker(`/e3-worker.js?${params}`, { type: 'module' }));
    return { apiUrl: e3.apiUrl, persisted: e3.persisted };
  },

  /** Answers a request Node forwards, with the page's `e3.fetch`. */
  async fetch(id: number, request: WireRequest): Promise<WireResponse> {
    if (e3 === null) throw new Error('the page has started no e3');
    const abort = new AbortController();
    inFlight.set(id, abort);
    try {
      const response = await e3.fetch(request.url, {
        method: request.method,
        headers: request.headers.map(([name, value]): [string, string] => [name, value]),
        body: request.body === null ? null : fromBase64(request.body),
        signal: abort.signal,
      });
      const body = new Uint8Array(await response.arrayBuffer());
      return { status: response.status, statusText: response.statusText, headers: [...response.headers], body: toBase64(body) };
    } finally {
      inFlight.delete(id);
    }
  },

  /** Starts an e3 served over a port, and connects the page to it: holding a
   *  lifeline, unless told not to. */
  async startOverPort(name: string, lifeline: boolean): Promise<void> {
    if (e3 !== null) throw new Error('the page has started its e3 already');
    e3 = await connectWebE3(servedOverPort(name), { requestPersistence: false, lifeline });
  },

  /** Starts an e3 served over a port, and connects a stand-in for another
   *  page to it, holding its lifeline. */
  async startClientOverPort(name: string): Promise<void> {
    if (client !== null) throw new Error('the page has started its client already');
    const port = servedOverPort(name);
    const started = new Worker('/e3-client-worker.js', { type: 'module' });
    client = started;
    const said = await new Promise<string>((resolve) => {
      started.onmessage = (event: MessageEvent<string>) => resolve(event.data);
      started.postMessage(port, [port]);
    });
    if (said !== 'connected') throw new Error(`the client did not connect: ${said}`);
  },

  /** Stops the stand-in for another page, as a tab closes: nothing is told. */
  endClient(): void {
    client?.terminate();
    client = null;
  },

  /** The names of the Web Locks the page's origin holds. */
  async locks(): Promise<string[]> {
    return ((await navigator.locks.query()).held ?? []).map((lock) => lock.name ?? '');
  },

  /** Gives up a request Node forwarded. */
  abort(id: number): void {
    inFlight.get(id)?.abort();
  },

  /** Closes the page's e3 worker. */
  close(): void {
    e3?.close();
    e3 = null;
  },

  /** Removes what a storage of a name kept: its IndexedDB database and its
   *  OPFS directory. */
  async clear(name: string): Promise<void> {
    await deleteIndexedDbRecords(name);
    await (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true }).catch((err: unknown) => {
      if (!(err instanceof DOMException && err.name === 'NotFoundError')) throw err;
    });
  },
});
