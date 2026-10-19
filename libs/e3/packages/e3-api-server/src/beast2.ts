/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { decodeBeast2For } from '@elaraai/east';
import type { EastType, ValueTypeOf } from '@elaraai/east';
import { beast2Error, beast2Success, decodeBeast2Request } from '@elaraai/e3-types';
import type { Context } from 'hono';
import type { Error } from './types.js';

/**
 * Decode BEAST2 request body from Hono context.
 */
export function decodeBody<T extends EastType>(
  c: Context,
  type: T
): Promise<ValueTypeOf<T>> {
  return decodeBeast2Request(c.req.raw, type);
}

/**
 * Decode raw BEAST2 bytes (for handlers that receive body directly).
 */
export function decodeBeast2<T extends EastType>(
  data: Uint8Array,
  type: T
): ValueTypeOf<T> {
  const decode = decodeBeast2For(type);
  return decode(data);
}

/**
 * Send BEAST2 success response.
 *
 * Returns a web Response object that can be used by both Hono routes and Lambda handlers.
 *
 * @param type - The type of the answer's value
 * @param value - The answer's value
 * @param headers - Headers beside the body's, such as the `ETag` a
 *   conditional route names its answer by
 * @returns The response
 */
export function sendSuccess<T extends EastType>(
  type: T,
  value: ValueTypeOf<T>,
  headers: Record<string, string> = {},
): Response {
  return beast2Success(type, value, { headers });
}

/**
 * Send BEAST2 error response.
 *
 * Returns a web Response object that can be used by both Hono routes and Lambda handlers.
 */
export function sendError<T extends EastType>(
  type: T,
  error: Error
): Response {
  return beast2Error(type, error);
}

/**
 * Send BEAST2 success response with custom HTTP status.
 */
export function sendSuccessWithStatus<T extends EastType>(
  type: T,
  value: ValueTypeOf<T>,
  status: number
): Response {
  return beast2Success(type, value, { status });
}
