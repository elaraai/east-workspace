/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The BEAST2 envelopes over a Hono context: e3-types' request and answer
 * helpers, as e3-api-server's `/beast2` entry wraps them. Declared here so
 * this package needs nothing of the server, whose optional peer it is.
 */

import type { EastType, ValueTypeOf } from '@elaraai/east';
import { beast2Error, beast2Success, decodeBeast2Request, type Error as ApiError } from '@elaraai/e3-types';
import type { Context } from 'hono';

/** Decodes a route's BEAST2 body as a value of a type. */
export function decodeBody<T extends EastType>(c: Context, type: T): Promise<ValueTypeOf<T>> {
  return decodeBeast2Request(c.req.raw, type);
}

/** Answers a success envelope. */
export function sendSuccess<T extends EastType>(type: T, value: ValueTypeOf<T>): Response {
  return beast2Success(type, value);
}

/** Answers an error envelope. */
export function sendError<T extends EastType>(type: T, error: ApiError): Response {
  return beast2Error(type, error);
}
