/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What the client's specs build a stand-in server from: the BEAST2 answers a
 * server sends, and a wait for what a test holds to come true.
 *
 * @internal
 */

import { encodeBeast2For, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE, ResponseType, type Error as ApiErrorValue } from '@elaraai/e3-types';

/**
 * A BEAST2 success, as the server sends one.
 *
 * @param type - The type of the answer's value
 * @param value - The answer's value
 * @param status - The response's HTTP status
 * @param headers - Headers beside its content type: a `Retry-After`, say
 * @returns The response
 */
export function success<T extends EastType>(type: T, value: ValueTypeOf<T>, status = 200, headers: Record<string, string> = {}): globalThis.Response {
  const body = encodeBeast2For(ResponseType(type))(variant('success', value) as never);
  return new Response(body, { status, headers: { 'Content-Type': BEAST2_CONTENT_TYPE, ...headers } });
}

/**
 * A BEAST2 refusal, as the server sends one.
 *
 * @param type - The type of the value the request would have been answered with
 * @param error - The refusal
 * @param headers - Headers beside its content type: a `Retry-After`, say
 * @returns The response
 */
export function refusal<T extends EastType>(type: T, error: ApiErrorValue, headers: Record<string, string> = {}): globalThis.Response {
  const body = encodeBeast2For(ResponseType(type))(variant('error', error) as never);
  return new Response(body, { status: 200, headers: { 'Content-Type': BEAST2_CONTENT_TYPE, ...headers } });
}

/**
 * Resolves once `holds`, checked between turns of the event loop.
 *
 * @param holds - What the test waits for
 */
export async function until(holds: () => boolean): Promise<void> {
  while (!holds()) await new Promise((resolve) => setTimeout(resolve, 5));
}
