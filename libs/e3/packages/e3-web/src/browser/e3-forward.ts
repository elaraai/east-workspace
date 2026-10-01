/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A `fetch`, in Node, that forwards each request into a test page running e3
 * (`e3.page.ts`), whose `e3.fetch` answers it: what the shared API suites and
 * the specs' own requests go through, so e3 in Chromium answers them.
 *
 * @packageDocumentation
 */

import { fromBase64, toBase64, type WireRequest, type WireResponse } from './e3-wire.js';
import type { HarnessPage } from './harness.js';

/** The statuses whose responses have no body. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/** What a forwarding fetch asks of a page: a call it reads the answer of, and
 *  one it does not. */
export type ForwardedPage = Pick<HarnessPage, 'call' | 'tell'>;

/**
 * A `fetch` that forwards each request into a page running e3.
 *
 * @remarks
 * Each request is sent whole — its method, URL, headers and body — and
 * answered with the response the page's `e3.fetch` gave, whole. A request
 * whose signal aborts — before it is sent, while its body is read, or while
 * the page answers it — rejects with the signal's reason, as `fetch` rejects,
 * and one the page has been sent is given up there too, by a call whose
 * answer nothing reads, so what the page raised is not lost with it. A
 * request whose call into the page fails — the page threw, or did not answer
 * within the call's deadline — rejects with what failed, and is given up in
 * the page.
 *
 * @param page - A page running `e3.page.ts`, whose e3 has started
 * @returns The fetch
 */
export function forwardInto(page: ForwardedPage): typeof globalThis.fetch {
  let nextId = 0;
  return async (input, init) => {
    const request = new Request(input, init);
    const { signal } = request;
    const id = nextId++;
    // Heard from the start: an abort while the body is read ends the request
    // there, and one after it is sent gives it up in the page.
    let sent = false;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        if (sent) page.tell('abort', id);
        reject(signal.reason);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
    // Nothing may await it but the races below.
    aborted.catch(() => undefined);
    try {
      const body = request.body === null ? null : toBase64(new Uint8Array(await Promise.race([request.arrayBuffer(), aborted])));
      // Aborted as the body was read, though the race went to the body.
      if (signal.aborted) throw signal.reason;
      const wire: WireRequest = { method: request.method, url: request.url, headers: [...request.headers], body };
      sent = true;
      const answering = page.call<WireResponse>('fetch', id, wire).catch((err: unknown) => {
        // The page threw, or ran past the call's deadline: what it was doing
        // for the request is given up.
        page.tell('abort', id);
        throw err;
      });
      const answer = await Promise.race([answering, aborted]);
      return new Response(NULL_BODY_STATUSES.has(answer.status) ? null : fromBase64(answer.body), {
        status: answer.status,
        statusText: answer.statusText,
        headers: answer.headers.map(([name, value]): [string, string] => [name, value]),
      });
    } finally {
      if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
    }
  };
}
