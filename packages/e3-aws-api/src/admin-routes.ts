/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Admin Routes for e3 Cloud Platform
 *
 * Provides repository user management endpoints:
 * - Repo user routes (for owners/members)
 * - Admin routes (for e3-admins Cognito group)
 */

import { Hono } from 'hono';
import { ArrayType, NullType, variant, some, none } from '@elaraai/east';
import type { AclStore, Identity } from '@elaraai/e3-cloud-core';
import { hasAccess, canRemoveUser, errorCodeToStatus } from '@elaraai/e3-cloud-core';
import {
  RepoUserType,
  AddUserRequestType,
  type RepoUser,
  type AuthzError,
} from '@elaraai/e3-cloud-types';
import { sendSuccess, sendError, decodeBody } from '@elaraai/e3-api-server/beast2';
import { extractIdentity, lookupUserByEmail } from './auth/index.js';
import type { RepoManager } from '@elaraai/e3-cloud-core';

/**
 * Helper to extract identity from Hono context (API Gateway event).
 */
function getIdentity(c: any): Identity | null {
  const env = c.env as { event: unknown };
  return extractIdentity(env.event as Parameters<typeof extractIdentity>[0]);
}

/**
 * Create authorization error response with BEAST2 encoding.
 */
function authzError(error: AuthzError) {
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
 * Create admin routes for repository user management.
 *
 * @param aclStore - ACL storage backend
 * @param refStore - Repository reference store (for repo existence checks)
 */
export function createAdminRoutes(aclStore: AclStore, refStore: RepoManager) {
  const app = new Hono();

  // ============================================================
  // Repo User Management (for owners/members)
  // ============================================================

  // GET /api/repos/:repo/users - List repo users
  // Requires: member role
  app.get('/api/repos/:repo/users', async (c) => {
    const repo = c.req.param('repo');
    const identity = getIdentity(c);

    if (!identity) {
      return authzError({
        error: variant('unauthorized', null),
        message: 'Authentication required',
      });
    }

    // Check user has member access
    if (!await hasAccess(aclStore, repo, identity.sub, 'member', identity.isAdmin)) {
      return authzError({
        error: variant('forbidden', null),
        message: 'You do not have access to this repository',
      });
    }

    try {
      const users = await aclStore.listUsers(repo);
      return sendSuccess(ArrayType(RepoUserType), users);
    } catch (err) {
      console.error('Failed to list repo users:', err);
      return sendError(ArrayType(RepoUserType), variant('internal', { message: 'Failed to list users' }));
    }
  });

  // POST /api/repos/:repo/users - Add user to repo
  // Requires: owner role
  app.post('/api/repos/:repo/users', async (c) => {
    const repo = c.req.param('repo');
    const identity = getIdentity(c);

    if (!identity) {
      return authzError({
        error: variant('unauthorized', null),
        message: 'Authentication required',
      });
    }

    // Check user has owner access
    if (!await hasAccess(aclStore, repo, identity.sub, 'owner', identity.isAdmin)) {
      return authzError({
        error: variant('forbidden', null),
        message: 'Only repository owners can add users',
      });
    }

    try {
      // Decode request body
      const body = await decodeBody(c, AddUserRequestType);
      const { email, role } = body;

      // Look up user in Cognito by email
      const cognitoUser = await lookupUserByEmail(email);
      if (!cognitoUser) {
        return authzError({
          error: variant('user_not_found', null),
          message: `User with email '${email}' not found. They must log in at least once.`,
        });
      }

      // Create the user entry
      const user: RepoUser = {
        userId: cognitoUser.sub,
        email: cognitoUser.email,
        name: cognitoUser.name ? some(cognitoUser.name) : none,
        role,
        addedBy: identity.sub,
        addedAt: new Date().toISOString(),
      };

      await aclStore.addUser(repo, user);
      console.log(`User added to repo: repo=${repo}, userId=${cognitoUser.sub}, email=${email}, role=${role.type}, addedBy=${identity.sub}, addedByEmail=${identity.email ?? 'unknown'}`);
      return sendSuccess(RepoUserType, user);
    } catch (err) {
      console.error('Failed to add user to repo:', err);
      return sendError(RepoUserType, variant('internal', { message: 'Failed to add user' }));
    }
  });

  // DELETE /api/repos/:repo/users/:userId - Remove user from repo
  // Requires: owner role
  app.delete('/api/repos/:repo/users/:userId', async (c) => {
    const repo = c.req.param('repo');
    const userId = c.req.param('userId');
    const identity = getIdentity(c);

    if (!identity) {
      return authzError({
        error: variant('unauthorized', null),
        message: 'Authentication required',
      });
    }

    // Use canRemoveUser which checks owner permission and last-owner protection
    const result = await canRemoveUser(aclStore, repo, identity.sub, userId, identity.isAdmin);
    if (!result.ok) {
      return authzError({
        error: result.code,
        message: result.message,
      });
    }

    try {
      await aclStore.removeUser(repo, userId);
      console.log(`User removed from repo: repo=${repo}, userId=${userId}, removedBy=${identity.sub}, removedByEmail=${identity.email ?? 'unknown'}`);
      return sendSuccess(NullType, null);
    } catch (err) {
      console.error('Failed to remove user from repo:', err);
      return sendError(NullType, variant('internal', { message: 'Failed to remove user' }));
    }
  });

  // ============================================================
  // Admin Endpoints (for e3-admins Cognito group)
  // ============================================================

  // GET /api/admin/repos - List all repos (bypasses ACL)
  // Requires: admin group
  app.get('/api/admin/repos', async (c) => {
    const identity = getIdentity(c);

    if (!identity) {
      return authzError({
        error: variant('unauthorized', null),
        message: 'Authentication required',
      });
    }

    if (!identity.isAdmin) {
      return authzError({
        error: variant('forbidden', null),
        message: 'Admin access required',
      });
    }

    try {
      const repos = await refStore.listRepos();
      return sendSuccess(ArrayType(RepoUserType.fields.userId), repos);
    } catch (err) {
      console.error('Failed to list repos (admin):', err);
      return sendError(ArrayType(RepoUserType.fields.userId), variant('internal', { message: 'Failed to list repositories' }));
    }
  });

  // GET /api/admin/repos/:repo/users - View any repo's users
  // Requires: admin group
  app.get('/api/admin/repos/:repo/users', async (c) => {
    const repo = c.req.param('repo');
    const identity = getIdentity(c);

    if (!identity) {
      return authzError({
        error: variant('unauthorized', null),
        message: 'Authentication required',
      });
    }

    if (!identity.isAdmin) {
      return authzError({
        error: variant('forbidden', null),
        message: 'Admin access required',
      });
    }

    try {
      // Check repo exists
      const metadata = await refStore.getRepoMetadata(repo);
      if (!metadata) {
        return sendError(ArrayType(RepoUserType), variant('repository_not_found', { repo }));
      }

      const users = await aclStore.listUsers(repo);
      return sendSuccess(ArrayType(RepoUserType), users);
    } catch (err) {
      console.error('Failed to list repo users (admin):', err);
      return sendError(ArrayType(RepoUserType), variant('internal', { message: 'Failed to list users' }));
    }
  });

  // POST /api/admin/repos/:repo/users - Add user to any repo
  // Requires: admin group
  app.post('/api/admin/repos/:repo/users', async (c) => {
    const repo = c.req.param('repo');
    const identity = getIdentity(c);

    if (!identity) {
      return authzError({
        error: variant('unauthorized', null),
        message: 'Authentication required',
      });
    }

    if (!identity.isAdmin) {
      return authzError({
        error: variant('forbidden', null),
        message: 'Admin access required',
      });
    }

    try {
      // Check repo exists
      const metadata = await refStore.getRepoMetadata(repo);
      if (!metadata) {
        return sendError(RepoUserType, variant('repository_not_found', { repo }));
      }

      // Decode request body
      const body = await decodeBody(c, AddUserRequestType);
      const { email, role } = body;

      // Look up user in Cognito by email
      const cognitoUser = await lookupUserByEmail(email);
      if (!cognitoUser) {
        return authzError({
          error: variant('user_not_found', null),
          message: `User with email '${email}' not found. They must log in at least once.`,
        });
      }

      // Create the user entry
      const user: RepoUser = {
        userId: cognitoUser.sub,
        email: cognitoUser.email,
        name: cognitoUser.name ? some(cognitoUser.name) : none,
        role,
        addedBy: identity.sub,
        addedAt: new Date().toISOString(),
      };

      await aclStore.addUser(repo, user);
      console.log(`Admin: User added to repo: repo=${repo}, userId=${cognitoUser.sub}, email=${email}, role=${role.type}, addedBy=${identity.sub}, addedByEmail=${identity.email ?? 'unknown'}`);
      return sendSuccess(RepoUserType, user);
    } catch (err) {
      console.error('Failed to add user to repo (admin):', err);
      return sendError(RepoUserType, variant('internal', { message: 'Failed to add user' }));
    }
  });

  // DELETE /api/admin/repos/:repo - Force-delete any repo
  // Requires: admin group
  // Note: This deletes both ACL entries and the repo itself
  app.delete('/api/admin/repos/:repo', async (c) => {
    const repo = c.req.param('repo');
    const identity = getIdentity(c);

    if (!identity) {
      return authzError({
        error: variant('unauthorized', null),
        message: 'Authentication required',
      });
    }

    if (!identity.isAdmin) {
      return authzError({
        error: variant('forbidden', null),
        message: 'Admin access required',
      });
    }

    try {
      // Check repo exists
      const metadata = await refStore.getRepoMetadata(repo);
      if (!metadata) {
        return sendError(NullType, variant('repository_not_found', { repo }));
      }

      // Delete all ACL entries first
      await aclStore.deleteAllForRepo(repo);

      // Note: Full repo deletion (S3 objects, DynamoDB refs) is handled
      // by the main DELETE /api/repos/:repo endpoint. This admin endpoint
      // ensures ACLs are cleaned up. Caller should use regular delete after.

      console.log(`Admin: Deleted ACL entries for repo '${repo}', deletedBy=${identity.sub}, deletedByEmail=${identity.email ?? 'unknown'}`);
      return sendSuccess(NullType, null);
    } catch (err) {
      console.error('Failed to delete repo ACLs (admin):', err);
      return sendError(NullType, variant('internal', { message: 'Failed to delete repository ACLs' }));
    }
  });

  return app;
}
