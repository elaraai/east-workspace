/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What a route reads from a request's query string, read alike by every route
 * that takes it: a window's offset and limit, and the like.
 */

import type { Context } from 'hono';

/** A whole number as a query spells it: decimal digits, nothing else. */
const DIGITS = /^\d+$/;

/** The least a whole-number query parameter takes: 0 for an offset, or for a
 *  limit whose empty window still reports a total; 1 for a limit whose empty
 *  window says nothing. */
export type QueryLeast = 0 | 1;

/** What a parameter taking each least must be, as the dataset routes word it. */
const TAKES: Record<QueryLeast, string> = {
  0: 'a non-negative integer',
  1: 'a positive integer',
};

/**
 * The `400 bad_request` that refuses a malformed query, as the dataset routes
 * answer one: JSON naming what was wrong, which the client reads as an
 * `ApiError` of that type.
 *
 * @param message - What was wrong, naming the parameter and what it was given
 * @returns The response
 */
export function badQuery(message: string): Response {
  return new Response(JSON.stringify({ error: { type: 'bad_request', message } }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Reads whole-number query parameters, each at or above the least it takes.
 *
 * @remarks
 * A parameter absent, or given empty, is left out. One given that is not a
 * whole number at or above its least — `abc`, `-1`, `1.5`, `NaN` — or that is
 * past the integers a number holds exactly, is refused before any store is
 * asked: `400 bad_request`, naming it and what it was given.
 *
 * @param c - The request's context
 * @param least - Each parameter by name, and the least value it takes
 * @returns The parameters given, by name; or the 400 that refuses one
 */
export function wholeQuery<K extends string>(c: Context, least: Readonly<Record<K, QueryLeast>>): Partial<Record<K, number>> | Response {
  const read: Partial<Record<K, number>> = {};
  for (const name of Object.keys(least) as K[]) {
    const given = c.req.query(name);
    if (given === undefined || given === '') continue;
    const value = DIGITS.test(given) ? Number(given) : NaN;
    if (!(value >= least[name])) {
      return badQuery(`${name} must be ${TAKES[least[name]]}, got ${JSON.stringify(given)}`);
    }
    if (!Number.isSafeInteger(value)) {
      return badQuery(`${name} must be at most ${Number.MAX_SAFE_INTEGER}, got ${JSON.stringify(given)}`);
    }
    read[name] = value;
  }
  return read;
}
