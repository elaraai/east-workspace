/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The worker side of `e3.fetch`'s contract: a plain handler — no Hono — that
 * every case's requests reach, the boots a case starts a worker with, and a
 * record of the bodies the worker side posted, which a case reads back to see
 * each was transferred.
 *
 * It serves in Node over a `MessageChannel`, and in a page's dedicated worker
 * (`browser/bridge.worker.ts`). Its routes:
 * - `/reverse` — the request's body, its bytes reversed;
 * - `/headers` — the request's headers, as JSON pairs, with `x-answer` given
 *   twice;
 * - `/status/<code>/<text>` — that status and status text;
 * - `/empty` — a 200 with an empty body; `/none` — a 204 with none;
 * - `/throw` — throws;
 * - `/wait/<key>` — holds the request until its signal aborts, and records
 *   the abort; `/began/<key>` — whether it has begun; `/seen/<key>` — the
 *   name of the abort's reason it saw, or `null`;
 * - `/transfers` — `[id, byteLength]` of each response body the worker side
 *   posted, its length now: 0 once transferred;
 * - `/raise` — raises an error the worker does not catch, and never answers;
 *   `/exit` — closes the worker, as a worker closes itself, and never
 *   answers: each for a worker in a page alone.
 *
 * @packageDocumentation
 */

import type { WorkerMessage } from '../bridge/protocol.js';
import type { BridgeBoot, BridgeEndpoint } from '../bridge/worker.js';

/** How a case's worker boots: ready, keeping repositories past the page or
 *  not, or refused, as `openWebStorage` refuses a browser that lacks an API. */
export type ContractBoot = 'persist' | 'memory' | 'refused';

/**
 * The contract's worker side: the endpoint it serves over, and its handler.
 */
export interface ContractWorker {
  /** The endpoint it was given, recording each response body it posts */
  readonly endpoint: BridgeEndpoint;
  /** The handler */
  readonly fetch: (request: Request) => Promise<Response>;
}

/** A response of JSON. */
function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}

/**
 * Makes the contract's worker side over an endpoint.
 *
 * @param endpoint - What it serves over: a worker's global scope, or a port
 * @returns The endpoint, recording what it posts, and the handler
 */
export function contractWorker(endpoint: BridgeEndpoint): ContractWorker {
  /** Each response body posted, by its request's number */
  const posted: Array<[number, ArrayBuffer]> = [];
  /** The `/wait` requests begun, by key */
  const began = new Set<string>();
  /** What each `/wait` request saw abort it, by key */
  const seen = new Map<string, string>();

  const recording: BridgeEndpoint = {
    postMessage: (message: WorkerMessage, transfer: Transferable[]) => {
      if (message.kind === 'response' && message.body !== null) posted.push([message.id, message.body]);
      endpoint.postMessage(message, transfer);
    },
    addEventListener: (type, listener) => endpoint.addEventListener(type, listener),
    start: () => endpoint.start?.(),
  };

  const fetch = async (request: Request): Promise<Response> => {
    const [route = '', ...rest] = new URL(request.url).pathname.split('/').slice(1);
    const key = rest[0] ?? '';
    switch (route) {
      case 'reverse':
        return new Response(new Uint8Array(await request.arrayBuffer()).reverse(), {
          headers: { 'content-type': 'application/octet-stream' },
        });
      case 'headers': {
        const headers = new Headers({ 'content-type': 'application/json' });
        headers.append('x-answer', 'first');
        headers.append('x-answer', 'second');
        return new Response(JSON.stringify([...request.headers]), { headers });
      }
      case 'status':
        return new Response(`status ${key}`, { status: Number(key), statusText: decodeURIComponent(rest[1] ?? '') });
      case 'empty':
        return new Response(new Uint8Array(0));
      case 'none':
        return new Response(null, { status: 204 });
      case 'throw':
        throw new Error('the handler broke');
      case 'wait':
        began.add(key);
        return new Promise<Response>((_, reject) => {
          const aborted = (): void => {
            seen.set(key, (request.signal.reason as { name?: string } | undefined)?.name ?? 'a reason with no name');
            reject(request.signal.reason);
          };
          if (request.signal.aborted) aborted();
          else request.signal.addEventListener('abort', aborted, { once: true });
        });
      case 'began':
        return json(began.has(key));
      case 'seen':
        return json(seen.get(key) ?? null);
      case 'transfers':
        return json(posted.map(([id, body]) => [id, body.byteLength]));
      case 'raise':
        setTimeout(() => {
          throw new Error('the e3 worker raised this');
        });
        return new Promise<Response>(() => undefined);
      case 'exit':
        (globalThis as unknown as { close(): void }).close();
        return new Promise<Response>(() => undefined);
      default:
        return new Response(`no route ${request.url}`, { status: 404 });
    }
  };

  return { endpoint: recording, fetch };
}

/**
 * The boot of a case's worker.
 *
 * @param boot - How it boots, as {@link ContractBoot} names it
 * @param worker - Its worker side, whose handler a ready boot answers with
 * @param refuse - Opens a persisted storage where the page lacks an API it
 *   needs, which refuses, naming it
 * @returns The boot `serveBridge` is given
 */
export function contractBoot(boot: string | null, worker: ContractWorker, refuse: () => Promise<void>): () => Promise<BridgeBoot> {
  return async () => {
    switch (boot) {
      case 'persist':
      case 'memory':
        return { fetch: worker.fetch, persist: boot === 'persist' };
      case 'refused':
        await refuse();
        throw new Error('the persisted storage opened, though the boot was to be refused');
      default:
        throw new Error(`there is no contract boot '${boot}'`);
    }
  };
}
