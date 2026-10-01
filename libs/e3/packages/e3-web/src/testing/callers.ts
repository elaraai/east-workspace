/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The callers e3-web's specs serve e3 to: an admin and a reader, each known
 * by a token, as the shared API suites call a server — the admin's one-shots
 * run with any platform, and the reader's are platform-free.
 *
 * The specs' e3 worker knows each by its token (`identify`), and grants by
 * their roles (`oneShotAccessByRoles()`); the specs call it with the tokens.
 * Portable: a page's e3 worker bundles it, and Node reads it.
 *
 * @packageDocumentation
 */

import type { Identity } from '@elaraai/e3-api-server/portable';

/** The admin's token: its one-shots run with any platform. */
export const ADMIN_TOKEN = 'e3-web-admin';

/** A reader's token, with no role: its one-shots are platform-free. */
export const READER_TOKEN = 'e3-web-reader';

/** Whom each token's bearer is. */
const CALLERS: ReadonlyMap<string, Identity> = new Map([
  [`Bearer ${ADMIN_TOKEN}`, { sub: 'admin', roles: ['admin'] }],
  [`Bearer ${READER_TOKEN}`, { sub: 'reader', roles: [] }],
]);

/**
 * Who calls, by the request's bearer token: the admin, the reader, or no one
 * the specs' e3 knows.
 *
 * @param request - The request
 * @returns The caller's identity, or `undefined`
 */
export function identifyCaller(request: Request): Identity | undefined {
  return CALLERS.get(request.headers.get('authorization') ?? '');
}
