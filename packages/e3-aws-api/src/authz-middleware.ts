/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Authorization Middleware for e3 Cloud Platform
 *
 * This middleware intercepts all /api/repos/:repo/* requests and verifies
 * the user has appropriate access (member or owner) before the route
 * handler executes.
 */

import { createMiddleware } from 'hono/factory';
import type { AclStore, Identity } from '@elaraai/e3-cloud-core';
import { hasAccess, errorCodeToStatus } from '@elaraai/e3-cloud-core';
import { variant } from '@elaraai/east';
import type { AuthzError } from '@elaraai/e3-cloud-types';
import { extractIdentity } from './auth/index.js';

/**
 * Routes that require owner permission (destructive operations).
 * All other repo routes require member permission.
 */
const OWNER_ROUTES: Array<{ method: string; pattern: RegExp }> = [
  // DELETE /api/repos/:repo - Delete entire repository
  { method: 'DELETE', pattern: /^\/api\/repos\/[^/]+$/ },
  // DELETE /api/repos/:repo/packages/:name/:version - Delete package
  { method: 'DELETE', pattern: /^\/api\/repos\/[^/]+\/packages\/.+$/ },
  // DELETE /api/repos/:repo/workspaces/:ws - Delete workspace
  { method: 'DELETE', pattern: /^\/api\/repos\/[^/]+\/workspaces\/[^/]+$/ },
  // POST /api/repos/:repo/gc - Start garbage collection
  { method: 'POST', pattern: /^\/api\/repos\/[^/]+\/gc$/ },
];

/**
 * Check if a route requires owner permission.
 */
function requiresOwner(method: string, path: string): boolean {
  return OWNER_ROUTES.some(r => r.method === method && r.pattern.test(path));
}

/**
 * Helper to extract identity from Hono context (API Gateway event).
 */
function getIdentity(c: any): Identity | null {
  const env = c.env as { event: unknown };
  return extractIdentity(env.event as Parameters<typeof extractIdentity>[0]);
}

/**
 * Create authorization error response.
 */
function authzErrorResponse(error: AuthzError) {
  const status = errorCodeToStatus(error.error);
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        type: error.error.type,
        message: error.message,
      },
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Create authorization middleware for repo routes.
 *
 * This middleware:
 * 1. Extracts the repo name from the URL path
 * 2. Extracts user identity from JWT claims
 * 3. Checks if user has required access (owner or member)
 * 4. Returns 401/403 if access denied, otherwise continues
 *
 * @param aclStore - ACL storage backend for access checks
 */
export function createAuthzMiddleware(aclStore: AclStore) {
  return createMiddleware(async (c, next) => {
    const path = c.req.path;
    const method = c.req.method;

    // Skip routes that handle their own authorization
    // - User management routes in admin-routes.ts
    if (path.match(/^\/api\/repos\/[^/]+\/users/)) {
      return next();
    }
    // - Admin routes in admin-routes.ts
    if (path.startsWith('/api/admin/')) {
      return next();
    }

    // Skip repo creation - any authenticated user can create repos
    // (they become owner automatically)
    if (method === 'PUT' && /^\/api\/repos\/[^/]+$/.test(path)) {
      return next();
    }

    // Extract repo from path: /api/repos/:repo/...
    const match = path.match(/^\/api\/repos\/([^/]+)/);
    if (!match) {
      // Not a repo route, skip authz
      return next();
    }

    const repo = match[1];
    const identity = getIdentity(c);

    if (!identity) {
      return authzErrorResponse({
        error: variant('unauthorized', null),
        message: 'Authentication required',
      });
    }

    const requiredRole = requiresOwner(method, path) ? 'owner' : 'member';

    if (!await hasAccess(aclStore, repo, identity.sub, requiredRole, identity.isAdmin)) {
      const message = requiredRole === 'owner'
        ? 'Owner permission required for this operation'
        : 'You do not have access to this repository';

      return authzErrorResponse({
        error: variant('forbidden', null),
        message,
      });
    }

    return next();
  });
}
