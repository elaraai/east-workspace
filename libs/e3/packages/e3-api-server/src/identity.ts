/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Identity information extracted from JWT and set on context.
 *
 * @remarks
 * A host's auth sets it on a request's context (`c.set('identity', …)`): the
 * server's auth middleware, from a verified token, or another host's own. The
 * routes that answer by who calls read it: `oneShotAccessByRoles` grants by its
 * roles, and the record routes commit as it and gate compaction on its roles.
 */
export interface Identity {
  /** Subject - typically user ID */
  sub: string;
  /** User email (if present in token) */
  email?: string;
  /** User roles (if present in token) */
  roles: string[];
}
