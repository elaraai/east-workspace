/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3.fetch`'s protocol: the messages a page and its e3 worker exchange.
 *
 * The page posts each request to the worker, and the worker posts back its
 * answer: a response, or the failure that stands for a network error. Bodies
 * travel as `ArrayBuffer`s, transferred rather than copied, so a large body
 * crosses between the threads without a copy. The messages are plain objects
 * that `postMessage` clones, and they travel over a dedicated worker's
 * `postMessage`, or a `MessagePort`'s: one protocol over either transport.
 *
 * - **The page posts** a `hello` as it connects, a `request` for each
 *   request, an `abort` when a request's signal aborts, and, over a port, a
 *   `close` when the page closes its connection.
 * - **The worker posts**, to each `hello`, `ready` once it has booted, or
 *   `boot-error` when its boot failed: a page that connects at any time,
 *   however long after the worker booted, is answered. Then a `response`, or
 *   an `error`, for each request.
 *
 * Each side may hold a lifeline: a Web Lock it holds while it lives, which the
 * other waits on to learn it has gone, as no event says. The worker names its
 * own in `ready`, and the page, over a port, names its own in `hello`: the e3
 * at the other end of a port outlives no page that has gone.
 *
 * @packageDocumentation
 */

/**
 * The one origin `e3.fetch` answers: `https://e3-web.invalid`.
 *
 * @remarks
 * `.invalid` is a top-level domain reserved never to resolve (RFC 2606), so a
 * request to it that bypasses `e3.fetch` — the global `fetch`, given e3's URL
 * by mistake — fails at once, and none reaches the network. A URL e3 hands a
 * client to fetch later, such as an upload's or a download's, is on this
 * origin too.
 */
export const WEB_E3_ORIGIN = 'https://e3-web.invalid';

/**
 * A request's or a response's headers, a pair each, in the order the
 * `Headers` they came from iterates them: lowercase names, a header given
 * twice combined as `fetch` combines it, and each `Set-Cookie` apart.
 */
export type HeaderPairs = Array<[string, string]>;

/**
 * The page asks the worker to answer a request.
 */
export interface RequestMessage {
  readonly kind: 'request';
  /** The request's number, unique among the page's requests to the worker */
  readonly id: number;
  /** Its method, normalized as a `Request` normalizes it */
  readonly method: string;
  /** Its URL, absolute, on {@link WEB_E3_ORIGIN} */
  readonly url: string;
  /** Its headers */
  readonly headers: HeaderPairs;
  /** Its body, whole and transferred, or `null` for a request with none */
  readonly body: ArrayBuffer | null;
}

/**
 * The page has given up a request: its signal aborted. The worker aborts the
 * signal of the `Request` its handler was given.
 */
export interface AbortMessage {
  readonly kind: 'abort';
  /** The request's number */
  readonly id: number;
}

/**
 * The page connects: the worker answers with `ready`, or with `boot-error`,
 * once its boot has settled, to every hello, whenever it comes.
 */
export interface HelloMessage {
  readonly kind: 'hello';
  /** The Web Lock the page holds for as long as it is connected, which the
   *  worker at the other end of a port waits on to learn the page has gone;
   *  `null` when it holds none */
  readonly lifeline: string | null;
}

/**
 * The page has closed its connection, over a port: what the worker served it
 * is wanted no more.
 */
export interface CloseMessage {
  readonly kind: 'close';
}

/**
 * The worker has booted, and answers requests: its answer to a hello.
 */
export interface ReadyMessage {
  readonly kind: 'ready';
  /** Whether the worker keeps repositories past the page's life, which the
   *  page asks the browser to keep through storage pressure */
  readonly persist: boolean;
  /** The Web Lock the worker holds for as long as it lives, which the page
   *  waits on to learn that it has stopped; `null` when it holds none */
  readonly lifeline: string | null;
}

/**
 * The worker's boot failed, and it answers no request: its answer to a
 * hello.
 */
export interface BootErrorMessage {
  readonly kind: 'boot-error';
  /** What failed: a browser API the boot lacks, named, say */
  readonly message: string;
}

/**
 * The worker's response to a request.
 */
export interface ResponseMessage {
  readonly kind: 'response';
  /** The request's number */
  readonly id: number;
  readonly status: number;
  readonly statusText: string;
  readonly headers: HeaderPairs;
  /** Its body, whole and transferred, or `null` for a response with none:
   *  a null-body status's, or a `HEAD` request's */
  readonly body: ArrayBuffer | null;
}

/**
 * A request the worker answered with no response: its handler threw, or its
 * response's body failed. The page's `fetch` rejects, as `fetch` rejects a
 * network failure; an app answers its own errors with responses.
 */
export interface ErrorMessage {
  readonly kind: 'error';
  /** The request's number */
  readonly id: number;
  /** What failed */
  readonly message: string;
}

/** A message the page posts to the worker. */
export type PageMessage = HelloMessage | RequestMessage | AbortMessage | CloseMessage;

/** A message the worker posts to the page. */
export type WorkerMessage = ReadyMessage | BootErrorMessage | ResponseMessage | ErrorMessage;

/**
 * What a message's data is, when it is one of the protocol's: an object with
 * a `kind`. A side ignores a message of a kind it does not take.
 *
 * @param data - The data of a message event
 * @returns The message, or `null` when the data is no protocol message
 */
export function protocolMessage<M extends PageMessage | WorkerMessage>(data: unknown): M | null {
  return typeof data === 'object' && data !== null && 'kind' in data ? data as M : null;
}

/**
 * Takes a lifeline: a Web Lock of a fresh name, which this agent holds until
 * `released` settles, or for as long as it lives. Another agent waiting on it
 * ({@link watchLifeline}) learns that this one has gone, however it went —
 * closed, terminated, or its tab closed — as the browser frees the locks of an
 * agent that has gone, and no event says so.
 *
 * @param prefix - What the name begins with, before a fresh id
 * @param released - Settles once the lifeline is let go: never, for one held
 *   while the agent lives
 * @returns The lock's name, once held, or `null` when the agent has no Web
 *   Locks, or may not take one
 */
export async function holdLifeline(prefix: string, released: Promise<void>): Promise<string | null> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (locks === undefined) return null;
  const name = `${prefix}:${crypto.randomUUID()}`;
  try {
    await new Promise<void>((held, refused) => {
      locks.request(name, () => {
        held();
        return released;
      }).catch(refused);
    });
    return name;
  } catch {
    // An agent that cannot hold a Web Lock names none: the other side cannot
    // learn when it goes, and is told only what events say.
    return null;
  }
}

/**
 * Waits on another agent's lifeline ({@link holdLifeline}), and says when it
 * has gone.
 *
 * @param name - The lifeline's name, or `null` for none: nothing is waited on
 * @param signal - Withdraws the wait, once the waiter no longer cares
 * @param gone - Told once the lifeline is freed, unless the wait was
 *   withdrawn first
 */
export function watchLifeline(name: string | null, signal: AbortSignal, gone: () => void): void {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (name === null || locks === undefined || signal.aborted) return;
  locks.request(name, { signal }, () => {
    gone();
  }).catch(() => undefined); // the wait was withdrawn
}

/**
 * What an error says, as a message carries it: its message, after its name
 * when that says more than `Error`.
 *
 * @param err - What was thrown
 * @returns The text
 */
export function errorText(err: unknown): string {
  if (!(err instanceof Error)) return `${err as string}`;
  return err.name === 'Error' ? err.message : `${err.name}: ${err.message}`;
}
