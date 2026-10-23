/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { encodeBeast2For, decodeBeast2For } from '@elaraai/east';
import type { EastType, ValueTypeOf } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-types';
import { ResponseType, ErrorType } from './types.js';

/**
 * API response wrapper - success or typed error.
 *
 * This type mirrors the BEAST2 wire format (ResponseType from types.ts) used for
 * HTTP 200 responses. The server sends either { type: 'success', value } or
 * { type: 'error', value } as BEAST2-encoded payloads.
 *
 * Note: Client functions now throw ApiError instead of returning this type directly.
 * This type is still used internally for decoding responses and is exported for
 * cases where callers need to work with the wire format directly.
 */
export type Response<T> =
  | { type: 'success'; value: T }
  | { type: 'error'; value: ValueTypeOf<typeof ErrorType> };

/**
 * Tuning for the bounded retry-with-backoff applied to transient HTTP failures.
 *
 * Retries are **on by default** with a conservative policy ({@link DEFAULT_RETRY});
 * pass a partial override to tune it, or `{ attempts: 1 }` to opt out entirely.
 *
 * @see {@link fetchWithRetry} for the retry and idempotency semantics.
 */
export interface RetryOptions {
  /** Maximum total attempts, including the first (clamped to ≥ 1; default 4 — i.e. up to 3 retries). */
  attempts?: number;
  /** Base delay for exponential backoff, in milliseconds (default 100). */
  baseDelayMs?: number;
  /** Upper bound on any single backoff delay the client picks itself, in
   *  milliseconds (default 2000). A server's `Retry-After` is bounded by
   *  {@link maxRetryAfterMs} instead. */
  maxDelayMs?: number;
  /**
   * Upper bound on a server's `Retry-After` hint, in milliseconds (default
   * 30000). A server that asks for longer than the client's own backoff is
   * waited for as it asks, up to this: e3-api-server's repository gate asks
   * for 5 s while an upgrade it owes waits.
   */
  maxRetryAfterMs?: number;
}

/**
 * Request options for authenticated API calls.
 *
 * The token is mandatory to ensure callers explicitly handle authentication (or not).
 */
export interface RequestOptions {
  /** Bearer token for authentication (optional depending on server) */
  token: string | null;
  /**
   * Overrides for the transient-failure retry policy (see {@link RetryOptions}).
   * Omit to use the default policy; set `{ attempts: 1 }` to disable retries.
   */
  retry?: RetryOptions;
  /**
   * Request the runner's timing/perf output on execution endpoints (call /
   * one-shot / mutate / dataflow). Sent out-of-band as a `?verbose=1` query
   * param — no wire-type change — so a server that predates it simply ignores
   * it. Runtime-only: never affects hashing or caching. */
  verbose?: boolean;
  /**
   * The `fetch` every request of the call goes through: its API requests, the
   * upload and download URLs they are sent to, and their retries. Absent, the
   * global `fetch`.
   *
   * @remarks
   * A host that answers e3's API itself passes its own: e3 running in a page,
   * whose requests a function answers rather than the network. The client
   * calls it as a plain function, never as a method of these options, so a
   * browser's `fetch` passed as it stands works.
   */
  fetch?: typeof globalThis.fetch;
}

/**
 * The `fetch` a request goes through: the one its options give, or the global
 * `fetch`, looked up when the request is made.
 *
 * @remarks
 * The result is called as a plain function, never as a method of the options:
 * a browser's `fetch` refuses to run with another object as its `this`.
 *
 * @param options - The request's options
 * @returns The `fetch` to call
 */
export function requestFetch(options: { fetch?: typeof globalThis.fetch }): typeof globalThis.fetch {
  return options.fetch ?? globalThis.fetch;
}

/** Append `?verbose=1` to an endpoint path when verbose was requested. */
export function verboseQuery(path: string, options: RequestOptions): string {
  return options.verbose ? `${path}?verbose=1` : path;
}

/**
 * API error with typed error details.
 */
export class ApiError extends Error {
  /**
   * @param code - The error's code
   * @param details - What the server said of it
   * @param retryAfterMs - How long the server asks the client to wait before
   *   it asks again, in milliseconds, as the refusal's `Retry-After` says:
   *   a workspace a run that is stopping still holds is refused with one
   *   ({@link retryingRefusal}); `undefined` when it names none
   */
  constructor(
    public readonly code: string,
    public readonly details?: unknown,
    public readonly retryAfterMs?: number,
  ) {
    super(`API error: ${code}`);
    this.name = 'ApiError';
  }
}

/**
 * A read pinned to a content hash the dataset no longer holds (a 409
 * `dataset_hash_mismatch`): the dataset has moved on, and the server names what
 * it holds now.
 *
 * @remarks
 * A pinned read is never answered from other content, so a window from one
 * snapshot can never sit beside one from another. A reader that follows the
 * dataset moves to `currentHash` and reads again, pinned to it.
 */
export class DatasetHashMismatchError extends ApiError {
  /**
   * @param details - The server's message
   * @param currentHash - The content the dataset holds now, as the response's
   *   `X-Content-SHA256` names it; `null` when the response names none
   */
  constructor(details: unknown, public readonly currentHash: string | null) {
    super('dataset_hash_mismatch', details);
    this.name = 'DatasetHashMismatchError';
  }
}

/**
 * A read by the runs of a record's index pinned to a content hash the record
 * no longer holds (a 409 `runs_hash_mismatch`, #1393): the record has moved on
 * — the dataset read may not have — and the server names what it holds now.
 *
 * @remarks
 * A run is a position at the content it was found at and means nothing at
 * another, so the read is never answered from other content. A reader that
 * follows the record moves it to `currentHash`, finds its runs there and reads
 * again. Apart from {@link DatasetHashMismatchError}, which says the dataset
 * read moved.
 */
export class RunsHashMismatchError extends ApiError {
  /**
   * @param details - The server's message
   * @param currentHash - The content the record holds now, as the response's
   *   `X-Content-SHA256` names it; `null` when it holds no value, or the
   *   response names none
   */
  constructor(details: unknown, public readonly currentHash: string | null) {
    super('runs_hash_mismatch', details);
    this.name = 'RunsHashMismatchError';
  }
}

/**
 * Authentication error (401 response).
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(`Authentication failed: ${message}`);
    this.name = 'AuthError';
  }
}

// =============================================================================
// Retry layer — bounded, idempotency-aware retry-with-backoff for transient
// HTTP failures (cold-start / dropped-socket / rate-limit). All fetch helpers
// below route through fetchWithRetry, so every consumer (client, CLI, the
// shared compliance suite) is resilient without per-call-site retry code.
// =============================================================================

/**
 * Transient HTTP status codes that are safe to retry for an idempotent request.
 *
 * These signal a temporary, server-side condition (rate limiting, a cold or
 * overloaded upstream) rather than a client error, so a second attempt commonly
 * succeeds. `500` is deliberately excluded — it can mask a real regression, so
 * it is surfaced immediately rather than retried.
 */
const TRANSIENT_STATUS = new Set([429, 502, 503, 504]);

/**
 * `errno` codes for connection-level failures where the request never completed,
 * making a retry safe even for a non-idempotent method. Node surfaces these as a
 * `TypeError: fetch failed` carrying the code on `.cause`.
 */
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
]);

/** HTTP methods that are idempotent by definition, so retrying is always safe. */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'TRACE']);

/** Default retry policy: conservative, bounded, and on by default. */
const DEFAULT_RETRY: Required<RetryOptions> = {
  attempts: 4,
  baseDelayMs: 100,
  maxDelayMs: 2000,
  maxRetryAfterMs: 30_000,
};

/**
 * A retry policy of one attempt: a poll's, whose next poll is its retry.
 *
 * @remarks
 * A call that is made again a second later gains nothing from retrying a
 * transient failure in between, and a server under load is asked once per
 * poll rather than four times. {@link pollRequestOptions} gives a poll this
 * policy unless its caller set one.
 */
export const NO_RETRY: RetryOptions = { attempts: 1 };

/**
 * The request options of a poll: the caller's, with {@link NO_RETRY} unless
 * the caller set a policy of its own.
 *
 * @param options - The caller's request options
 * @returns The options a poll's request is made with
 */
export function pollRequestOptions(options: RequestOptions): RequestOptions {
  return options.retry === undefined ? { ...options, retry: NO_RETRY } : options;
}

/** Merge caller overrides onto {@link DEFAULT_RETRY}, clamping to sane bounds. */
function resolveRetry(retry?: RetryOptions): Required<RetryOptions> {
  return {
    attempts: Math.max(1, Math.trunc(retry?.attempts ?? DEFAULT_RETRY.attempts)),
    baseDelayMs: Math.max(0, retry?.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs),
    maxDelayMs: Math.max(0, retry?.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs),
    maxRetryAfterMs: Math.max(0, retry?.maxRetryAfterMs ?? DEFAULT_RETRY.maxRetryAfterMs),
  };
}

/** Whether the given headers carry an `Idempotency-Key` (case-insensitive). */
function hasIdempotencyKey(headers?: RequestInit['headers']): boolean {
  if (!headers) return false;
  return new Headers(headers).has('Idempotency-Key');
}

/**
 * Whether a request may be safely retried on a transient *status*: an idempotent
 * method, or a `POST`/`PATCH` carrying an `Idempotency-Key` (which lets the
 * server dedupe a re-applied call).
 */
function isIdempotentRequest(init: RequestInit): boolean {
  const method = (init.method ?? 'GET').toUpperCase();
  if (IDEMPOTENT_METHODS.has(method)) return true;
  return hasIdempotencyKey(init.headers);
}

/** Extract a Node `errno` code from a thrown error or its `.cause`, if any. */
function errnoCode(err: unknown): string | undefined {
  const cause = (err && typeof err === 'object') ? (err as { cause?: unknown }).cause : undefined;
  for (const target of [err, cause]) {
    if (target && typeof target === 'object') {
      const code = (target as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
  }
  return undefined;
}

/**
 * Whether an error is an `AbortError` raised by an aborted {@link AbortSignal}.
 * Duck-typed on `name` rather than `instanceof Error`, since `fetch` rejects an
 * abort with a `DOMException` whose `Error` lineage is not guaranteed across
 * platforms/runtimes.
 */
function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

/**
 * Whether a thrown `fetch` error is a connection-level failure where the request
 * did not complete, so a retry cannot double-apply. An `AbortError` is never
 * retryable — it is an intentional cancellation.
 *
 * @param err - The value thrown by `fetch`.
 * @returns `true` when the failure is a retryable network fault.
 */
export function isRetryableNetworkError(err: unknown): boolean {
  if (isAbortError(err)) return false;
  const code = errnoCode(err);
  if (code !== undefined && RETRYABLE_NETWORK_CODES.has(code)) return true;
  // Node's WHATWG fetch reports every connection-level fault as `TypeError: fetch failed`.
  const message = err instanceof Error ? err.message.toLowerCase() : '';
  return message.includes('fetch failed') || message.includes('socket hang up');
}

/**
 * Parse a `Retry-After` header into a delay in milliseconds. Supports both the
 * delta-seconds form (`"120"`) and the HTTP-date form, the latter measured from
 * `nowMs`. Returns `undefined` when the header is absent or unparseable.
 *
 * @param value - The raw `Retry-After` header value, or `null` if absent.
 * @param nowMs - The current time in epoch milliseconds, for the HTTP-date form.
 * @returns The requested delay in milliseconds, or `undefined`.
 */
export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - nowMs);
  return undefined;
}

/**
 * Compute the delay before the next attempt. A server `Retry-After` hint wins,
 * waited for as the server asks up to `maxRetryAfterMs` — however far past the
 * client's own backoff cap; otherwise exponential backoff with full jitter — a
 * uniform random point in `[0, min(maxDelayMs, baseDelayMs · 2^attempt)]` — which
 * spreads retries so concurrent clients don't lock-step a cold upstream.
 *
 * @param attempt - Zero-based index of the attempt that just failed.
 * @param cfg - The resolved retry policy.
 * @param retryAfterMs - A server `Retry-After` delay in ms, if present.
 * @param rng - Source of randomness for the jitter; injectable for tests.
 * @returns The delay in milliseconds before the next attempt.
 */
export function computeBackoffMs(
  attempt: number,
  cfg: Required<RetryOptions>,
  retryAfterMs: number | undefined,
  rng: () => number = Math.random,
): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, cfg.maxRetryAfterMs);
  const ceiling = Math.min(cfg.maxDelayMs, cfg.baseDelayMs * 2 ** attempt);
  return rng() * ceiling;
}

/** Resolve after `ms`, or reject early with the abort reason if `signal` fires. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Run `fetch` with a bounded, idempotency-aware retry-with-backoff.
 *
 * The general safety net for transient failures against a freshly-deployed or
 * cold environment. All BEAST2 helpers ({@link get}, {@link post}, {@link put},
 * {@link del}) and the transfer helpers ({@link fetchWithAuth},
 * {@link fetchWithProgress}) route through it.
 *
 * Retries:
 * - a thrown connection-level error — the request never completed, see
 *   {@link isRetryableNetworkError} — for **any** method;
 * - a transient response status (`429`/`502`/`503`/`504`) **only** when
 *   `idempotent` is set, honouring a `Retry-After` header when present.
 *
 * Never retries a `4xx` other than `429`, a `500` (which may be a real
 * regression), or a transient status on a non-idempotent request — those are
 * returned for the caller to surface. Honours `init.signal`: an abort during a
 * request or a backoff delay rejects immediately with no further attempt.
 *
 * @param input - The request URL.
 * @param init - Standard `fetch` init; a re-readable body (string / `Uint8Array` / `Blob`) is required for a retry to resend it.
 *   Pass a function to build the init afresh for every attempt instead — the way to retry a body that is a stream, which
 *   one attempt consumes.
 * @param opts - `idempotent` gates transient-status retries; `retry` overrides the {@link DEFAULT_RETRY} policy (set `attempts: 1` to opt out);
 *   `fetch` is the `fetch` every attempt goes through ({@link RequestOptions.fetch}), the global one when absent.
 * @returns The final `fetch` response — a success, or the last transient/non-retryable response for the caller to decode.
 * @throws The original error once retries are exhausted or the error is non-retryable; the abort reason if `init.signal` aborts.
 */
export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit | (() => RequestInit),
  opts: { idempotent: boolean; retry?: RetryOptions; fetch?: typeof globalThis.fetch },
): Promise<globalThis.Response> {
  const cfg = resolveRetry(opts.retry);
  const send = requestFetch(opts);
  for (let attempt = 0; ; attempt++) {
    const request = typeof init === 'function' ? init() : init;
    const signal = request.signal ?? undefined;
    if (signal?.aborted) {
      // A built stream body that will never be sent is released here.
      const body = request.body as { cancel?: () => Promise<void> } | null | undefined;
      await body?.cancel?.().catch(() => { /* unsent body */ });
      throw signal.reason;
    }
    let response: globalThis.Response;
    try {
      response = await send(input, request);
    } catch (err) {
      if (isAbortError(err)) throw err;
      if (!isRetryableNetworkError(err) || attempt + 1 >= cfg.attempts) throw err;
      await sleep(computeBackoffMs(attempt, cfg, undefined), signal);
      continue;
    }
    // Success, or a status we never retry (2xx/3xx, 4xx other than 429, 500):
    // hand it back for the caller to decode.
    if (response.ok || !TRANSIENT_STATUS.has(response.status)) return response;
    // Transient status: retry only for idempotent requests, only if attempts remain.
    if (!opts.idempotent || attempt + 1 >= cfg.attempts) return response;
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), Date.now());
    // Drain the discarded response so the socket can be reused. A half-broken
    // cold-start stream can make cancel() reject — that must not abort the retry.
    await response.body?.cancel().catch(() => { /* discarded body */ });
    await sleep(computeBackoffMs(attempt, cfg, retryAfterMs), signal);
  }
}

/**
 * Fetch with consistent auth header injection and 401 → AuthError handling.
 *
 * Use this for multi-step transfer flows where raw `fetch` is needed
 * (e.g. upload/download to presigned URLs, polling endpoints). Transient
 * failures are retried per {@link fetchWithRetry}: thrown network errors for any
 * method, and transient statuses for idempotent methods or requests carrying an
 * `Idempotency-Key`.
 */
export async function fetchWithAuth(
  input: string,
  init: RequestInit,
  options: RequestOptions
): Promise<globalThis.Response> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  const withHeaders: RequestInit = { ...init, headers };
  const response = await fetchWithRetry(input, withHeaders, {
    idempotent: isIdempotentRequest(withHeaders),
    retry: options.retry,
    fetch: options.fetch,
  });
  if (response.status === 401) {
    throw new AuthError(await response.text());
  }
  return response;
}

/**
 * JSON error response format from the server.
 */
interface ServerErrorResponse {
  success?: false;
  error?: { type: string; message?: string };
  message?: string; // Some endpoints return { message } directly
}

/**
 * Read an error answer's body as the `ApiError` the rest of the client throws.
 *
 * @remarks
 * A JSON `{ error: { type, message } }` — what a route that answers JSON, and
 * the repository gate, refuse with — gives its type as the code and its
 * message as the details; a JSON `{ message }` gives its message under the
 * fallback code; any other body is the details under the fallback code. A
 * client of a host's own route, built on {@link fetchWithAuth}, throws its
 * refusals through it, so they carry the codes every other client function's
 * do.
 *
 * @param text - The answer's body
 * @param fallbackCode - The code when the body names none, such as one by the
 *   answer's HTTP status
 * @returns The error
 */
export function parseErrorBody(text: string, fallbackCode: string): ApiError {
  try {
    const json = JSON.parse(text) as ServerErrorResponse;
    if (json.error?.type) {
      return new ApiError(json.error.type, json.error.message);
    }
    if (json.message) {
      return new ApiError(fallbackCode, json.message);
    }
  } catch {
    // Not JSON
  }
  return new ApiError(fallbackCode, text || undefined);
}

/** HTTP status code to error code mapping */
const STATUS_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  415: 'unsupported_media_type',
  422: 'unprocessable_entity',
  429: 'too_many_requests',
  500: 'internal_server_error',
  502: 'bad_gateway',
  503: 'service_unavailable',
  504: 'gateway_timeout',
};

/**
 * Make a GET request and decode BEAST2 response.
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function get<T extends EastType>(
  url: string,
  path: string,
  successType: T,
  options: RequestOptions,
): Promise<ValueTypeOf<T>> {
  const response = await fetchWithRetry(`${url}/api${path}`, {
    method: 'GET',
    headers: {
      'Accept': BEAST2_CONTENT_TYPE,
      ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {}),
    },
  }, { idempotent: true, retry: options.retry, fetch: options.fetch });

  return decodeResponse(response, successType);
}

/**
 * An answer a conditional GET was given, with the tag it carries: what a
 * client sends back to ask whether the answer has changed.
 */
export interface Conditional<T> {
  /** The answer's value */
  readonly value: T;
  /** The answer's `ETag`; `null` when the server named none, in which case
   *  the next ask is unconditional */
  readonly etag: string | null;
}

/**
 * Make a conditional GET request: the answer, decoded, with the `ETag` it
 * carries; or `null` when the server answers `304 Not Modified` to the tag
 * sent as `If-None-Match`, which says the answer the client holds is current.
 *
 * @remarks
 * A poll holds the tag of the last answer it was given and asks with it: an
 * unchanged status costs the server a read of the workspace's revision, and
 * the client no decoding. A server that names no tag answers in full every
 * time, and the next ask is unconditional.
 *
 * @param url - Base URL of the e3 API server
 * @param path - The request's path under `/api`
 * @param successType - The type of the answer's value
 * @param etag - The tag of the answer the client holds; `null` for none
 * @param options - Request options including auth token
 * @returns The answer and its tag, or `null` when the one the client holds is
 *   current
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function getConditional<T extends EastType>(
  url: string,
  path: string,
  successType: T,
  etag: string | null,
  options: RequestOptions,
): Promise<Conditional<ValueTypeOf<T>> | null> {
  const response = await fetchWithRetry(`${url}/api${path}`, {
    method: 'GET',
    headers: {
      'Accept': BEAST2_CONTENT_TYPE,
      ...(etag === null ? {} : { 'If-None-Match': etag }),
      ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {}),
    },
  }, { idempotent: true, retry: options.retry, fetch: options.fetch });
  if (response.status === 304) {
    await response.body?.cancel().catch(() => { /* an empty body */ });
    return null;
  }
  const value = await decodeResponse(response, successType);
  return { value, etag: response.headers.get('etag') };
}

/**
 * Make a POST request with BEAST2 body and decode BEAST2 response.
 * @param extraHeaders - Optional additional request headers (e.g. `Idempotency-Key`), merged after the defaults.
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function post<Req extends EastType, Res extends EastType>(
  url: string,
  path: string,
  body: ValueTypeOf<Req>,
  requestType: Req,
  successType: Res,
  options: RequestOptions,
  extraHeaders?: Record<string, string>,
): Promise<ValueTypeOf<Res>> {
  const encode = encodeBeast2For(requestType);
  const response = await fetchWithRetry(`${url}/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': BEAST2_CONTENT_TYPE,
      'Accept': BEAST2_CONTENT_TYPE,
      ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {}),
      ...extraHeaders,
    },
    body: encode(body),
  }, { idempotent: hasIdempotencyKey(extraHeaders), retry: options.retry, fetch: options.fetch });

  return decodeResponse(response, successType);
}

/**
 * Make a PUT request with BEAST2 body and decode BEAST2 response.
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function put<Req extends EastType, Res extends EastType>(
  url: string,
  path: string,
  body: ValueTypeOf<Req>,
  requestType: Req,
  successType: Res,
  options: RequestOptions
): Promise<ValueTypeOf<Res>> {
  const encode = encodeBeast2For(requestType);
  const response = await fetchWithRetry(`${url}/api${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': BEAST2_CONTENT_TYPE,
      'Accept': BEAST2_CONTENT_TYPE,
      ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {}),
    },
    body: encode(body),
  }, { idempotent: true, retry: options.retry, fetch: options.fetch });

  return decodeResponse(response, successType);
}

/**
 * Make a DELETE request and decode BEAST2 response.
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function del<T extends EastType>(
  url: string,
  path: string,
  successType: T,
  options: RequestOptions
): Promise<ValueTypeOf<T>> {
  const response = await fetchWithRetry(`${url}/api${path}`, {
    method: 'DELETE',
    headers: {
      'Accept': BEAST2_CONTENT_TYPE,
      ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {}),
    },
  }, { idempotent: true, retry: options.retry, fetch: options.fetch });

  return decodeResponse(response, successType);
}

/**
 * Make a PUT request without body and decode BEAST2 response.
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function putEmpty<T extends EastType>(
  url: string,
  path: string,
  successType: T,
  options: RequestOptions
): Promise<ValueTypeOf<T>> {
  const response = await fetchWithRetry(`${url}/api${path}`, {
    method: 'PUT',
    headers: {
      'Accept': BEAST2_CONTENT_TYPE,
      ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {}),
    },
  }, { idempotent: true, retry: options.retry, fetch: options.fetch });

  return decodeResponse(response, successType);
}

/**
 * Decode a BEAST2 response, throwing on errors.
 * @throws {ApiError} On application-level errors (including BEAST2 error responses)
 * @throws {AuthError} On 401 Unauthorized
 */
async function decodeResponse<T extends EastType>(
  response: globalThis.Response,
  successType: T,
): Promise<ValueTypeOf<T>> {
  // Handle HTTP-level errors
  if (!response.ok) {
    const text = await response.text();
    const error = parseErrorBody(text, STATUS_CODES[response.status] ?? `http_${response.status}`);
    if (response.status === 401) {
      throw new AuthError(error.details as string ?? 'Authentication required');
    }
    throw error;
  }

  // Decode BEAST2 response
  const bytes = new Uint8Array(await response.arrayBuffer());
  const result = decodeBeast2For(ResponseType(successType))(bytes) as Response<ValueTypeOf<T>>;

  // Handle application-level errors in BEAST2 response, with the wait a
  // refusal the server asks to be asked again of names
  if (result.type === 'error') {
    throw new ApiError(result.value.type, result.value.value, parseRetryAfter(response.headers.get('retry-after'), Date.now()));
  }

  return result.value;
}

/**
 * An answer, with what its response says beside its value: whether the server
 * took the request on to finish after answering (`202 Accepted`), where it
 * says to follow it, and when to ask.
 */
export interface Answered<T> {
  /** The answer's value */
  readonly value: T;
  /** Whether the server answered `202 Accepted` */
  readonly accepted: boolean;
  /** The URL the answer's `Location` names, resolved against the request's;
   *  `null` when it names none */
  readonly location: string | null;
  /** The answer's `Retry-After`, in milliseconds; `undefined` when it names
   *  none */
  readonly retryAfterMs: number | undefined;
}

/**
 * Make a request of a URL and decode its BEAST2 answer, keeping what the
 * response says beside its value: whether the server accepted the request to
 * finish after answering, the `Location` it names and its `Retry-After`.
 *
 * @param target - The request's URL, whole: a route's, or one a `Location`
 *   named
 * @param method - `GET` or `DELETE`, either of which a retry sends again
 * @param successType - The type of the answer's value
 * @param options - Request options including auth token
 * @returns The answer
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function requestAnswered<T extends EastType>(
  target: string,
  method: 'GET' | 'DELETE',
  successType: T,
  options: RequestOptions,
): Promise<Answered<ValueTypeOf<T>>> {
  const response = await fetchWithRetry(target, {
    method,
    headers: {
      'Accept': BEAST2_CONTENT_TYPE,
      ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {}),
    },
  }, { idempotent: true, retry: options.retry, fetch: options.fetch });
  const location = response.headers.get('location');
  const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), Date.now());
  const value = await decodeResponse(response, successType);
  return {
    value,
    accepted: response.status === 202,
    location: location === null ? null : new URL(location, target).toString(),
    retryAfterMs,
  };
}

/**
 * How long, in all, {@link retryingRefusal} waits out a refusal its server
 * says to ask again of, in milliseconds, before it raises it.
 */
export const RETRY_REFUSAL_MAX_MS = 5 * 60_000;

/**
 * Makes a call, and while its server refuses it with `code` and a
 * `Retry-After`, waits as the server says and makes it again.
 *
 * @remarks
 * A server refuses a start, a deploy or a workspace's removal so
 * (`workspace_locked`) while a run that is stopping still holds the workspace:
 * the run lets it go. A refusal with no `Retry-After`, or of another code, is
 * raised at once, and so is one still refused after
 * {@link RETRY_REFUSAL_MAX_MS}. Each wait is bounded as a `Retry-After` is
 * ({@link RetryOptions.maxRetryAfterMs}).
 *
 * @param code - The refusal's code
 * @param call - The call, made again for each retry
 * @param options - Request options: the wait's bound
 * @returns What the call answers
 * @throws {ApiError} The refusal, once it is raised; or what else the call
 *   throws
 */
export async function retryingRefusal<T>(code: string, call: () => Promise<T>, options: RequestOptions): Promise<T> {
  const cfg = resolveRetry(options.retry);
  const deadline = Date.now() + RETRY_REFUSAL_MAX_MS;
  for (;;) {
    try {
      return await call();
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== code || err.retryAfterMs === undefined) throw err;
      const wait = Math.min(err.retryAfterMs, cfg.maxRetryAfterMs);
      if (Date.now() + wait > deadline) throw err;
      await sleep(wait);
    }
  }
}

/**
 * Fetch a URL with streaming download progress reporting.
 *
 * Falls back to a single `arrayBuffer()` call if no `onProgress` callback
 * is provided or if the response has no readable body stream.
 *
 * The initial request is retried per {@link fetchWithRetry} (GET is idempotent),
 * under the caller's policy when given; once streaming begins a mid-stream
 * failure surfaces, since a partial download cannot be safely resumed.
 *
 * @param url - The URL to download
 * @param onProgress - Told the bytes downloaded so far and the total
 * @param signal - Aborts the download
 * @param fetch - The `fetch` the download goes through
 *   ({@link RequestOptions.fetch}); the global one when absent
 * @param retry - The retry policy of the request ({@link RequestOptions.retry});
 *   the default when absent
 * @returns The downloaded bytes
 */
export async function fetchWithProgress(
  url: string,
  onProgress?: (downloaded: number, total: number) => void,
  signal?: AbortSignal,
  fetch?: typeof globalThis.fetch,
  retry?: RetryOptions,
): Promise<Uint8Array> {
  const res = await fetchWithRetry(url, { method: 'GET', signal }, { idempotent: true, retry, fetch });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  if (!onProgress || !res.body) {
    return new Uint8Array(await res.arrayBuffer());
  }

  const total = parseInt(res.headers.get('Content-Length') ?? '0', 10);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloaded += value.byteLength;
    onProgress(downloaded, total);
  }

  const result = new Uint8Array(downloaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
