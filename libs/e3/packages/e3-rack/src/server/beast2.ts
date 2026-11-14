/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The bodies of the rack's HTTP wires over a Hono context: the machine
 * protocol between an agent and its source, a hub's control socket, and a
 * session's data socket.
 *
 * A request's body and a success's are the BEAST2 of the route's own type,
 * with no envelope, and a refusal of the machine protocol is a status and
 * JSON. None holds a type of e3's HTTP API: its error variant changes between
 * releases, a rack serves the hubs of several, a hub the e3 of several
 * projects, and beast2 reads a blob only as the type its header names.
 */

import { encodeBeast2For, type EastType, type ValueTypeOf } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE, decodeBeast2Request } from '@elaraai/e3-types';
import type { Context } from 'hono';
import type { RackRefusal } from '../protocol/rack-json.js';

/** Decodes a route's BEAST2 body as a value of a type. */
export function decodeBody<T extends EastType>(c: Context, type: T): Promise<ValueTypeOf<T>> {
  return decodeBeast2Request(c.req.raw, type);
}

/**
 * Answers a route's value: its BEAST2, bare, with status 200.
 *
 * @param type - The route's response type
 * @param value - The value
 * @returns The response
 * @example
 * return answer(RackHeartbeatResponseType, { stop, rotatedToken, pendingApproval });
 */
export function answer<T extends EastType>(type: T, value: ValueTypeOf<T>): Response {
  const body = encodeBeast2For(type)(value);
  return new Response(body, { headers: { 'Content-Type': BEAST2_CONTENT_TYPE, 'Content-Length': String(body.byteLength) } });
}

/**
 * Refuses a request of the machine protocol: a status, which says whether the
 * same request is worth sending again, and why, as JSON.
 *
 * @param status - 400 and its like for a request not to send again, 422 for
 *   one whose content is to be put right, 429 and 503 for one to send again
 *   after a wait
 * @param code - Why, as a word a program reads
 * @param message - The same in words
 * @param retryAfterMs - How long to wait before sending it again, also sent
 *   as `Retry-After`
 * @returns The response
 * @example
 * return refuse(429, 'busy', '8 transfers are in flight for this rack', 500);
 */
export function refuse(status: number, code: string, message: string, retryAfterMs?: number): Response {
  const error: RackRefusal = { code, message, ...(retryAfterMs !== undefined && { retryAfterMs }) };
  return new Response(JSON.stringify({ error }), { status, headers: {
    'Content-Type': 'application/json',
    ...(retryAfterMs !== undefined && { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) }),
  } });
}
