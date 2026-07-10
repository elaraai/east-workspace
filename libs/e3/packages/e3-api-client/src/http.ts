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
  /** Upper bound on any single backoff delay, in milliseconds (default 2000). */
  maxDelayMs?: number;
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
}

/** Append `?verbose=1` to an endpoint path when verbose was requested. */
export function verboseQuery(path: string, options: RequestOptions): string {
  return options.verbose ? `${path}?verbose=1` : path;
}

/**
 * API error with typed error details.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(`API error: ${code}`);
    this.name = 'ApiError';
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
};

/** Merge caller overrides onto {@link DEFAULT_RETRY}, clamping to sane bounds. */
function resolveRetry(retry?: RetryOptions): Required<RetryOptions> {
  return {
    attempts: Math.max(1, Math.trunc(retry?.attempts ?? DEFAULT_RETRY.attempts)),
    baseDelayMs: Math.max(0, retry?.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs),
    maxDelayMs: Math.max(0, retry?.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs),
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
 * Compute the delay before the next attempt. A server `Retry-After` hint wins
 * (capped at `maxDelayMs`); otherwise exponential backoff with full jitter — a
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
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, cfg.maxDelayMs);
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
 * @param opts - `idempotent` gates transient-status retries; `retry` overrides the {@link DEFAULT_RETRY} policy (set `attempts: 1` to opt out).
 * @returns The final `fetch` response — a success, or the last transient/non-retryable response for the caller to decode.
 * @throws The original error once retries are exhausted or the error is non-retryable; the abort reason if `init.signal` aborts.
 */
export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit,
  opts: { idempotent: boolean; retry?: RetryOptions },
): Promise<globalThis.Response> {
  const cfg = resolveRetry(opts.retry);
  const signal = init.signal ?? undefined;
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw signal.reason;
    let response: globalThis.Response;
    try {
      response = await fetch(input, init);
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
 * Parse error details from response text.
 * Returns an ApiError with the error code from the body if available, otherwise uses fallback.
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
  options: RequestOptions
): Promise<ValueTypeOf<T>> {
  const response = await fetchWithRetry(`${url}/api${path}`, {
    method: 'GET',
    headers: {
      'Accept': BEAST2_CONTENT_TYPE,
      ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {}),
    },
  }, { idempotent: true, retry: options.retry });

  return decodeResponse(response, successType);
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
  }, { idempotent: hasIdempotencyKey(extraHeaders), retry: options.retry });

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
  }, { idempotent: true, retry: options.retry });

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
  }, { idempotent: true, retry: options.retry });

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
  }, { idempotent: true, retry: options.retry });

  return decodeResponse(response, successType);
}

/**
 * Decode a BEAST2 response, throwing on errors.
 * @throws {ApiError} On application-level errors (including BEAST2 error responses)
 * @throws {AuthError} On 401 Unauthorized
 */
async function decodeResponse<T extends EastType>(
  response: globalThis.Response,
  successType: T
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
  const buffer = await response.arrayBuffer();
  const decode = decodeBeast2For(ResponseType(successType));
  const result = decode(new Uint8Array(buffer)) as Response<ValueTypeOf<T>>;

  // Handle application-level errors in BEAST2 response
  if (result.type === 'error') {
    throw new ApiError(result.value.type, result.value.value);
  }

  return result.value;
}

/**
 * Fetch a URL with streaming download progress reporting.
 *
 * Falls back to a single `arrayBuffer()` call if no `onProgress` callback
 * is provided or if the response has no readable body stream.
 *
 * The initial request is retried per {@link fetchWithRetry} (GET is idempotent);
 * once streaming begins a mid-stream failure surfaces, since a partial download
 * cannot be safely resumed.
 */
export async function fetchWithProgress(
  url: string,
  onProgress?: (downloaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const res = await fetchWithRetry(url, { method: 'GET', signal }, { idempotent: true });
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

/**
 * Unwrap a response, throwing on error.
 * @deprecated Functions now throw ApiError on error; this function is no longer needed.
 */
export function unwrap<T>(response: Response<T>): T {
  if (response.type === 'error') {
    const err = response.value;
    throw new ApiError(err.type, err.value);
  }
  return response.value;
}
