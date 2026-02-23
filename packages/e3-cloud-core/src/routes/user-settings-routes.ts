/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Per-User Per-Workspace Settings Routes
 *
 * Provides endpoints for opaque binary user settings:
 * - GET  / — Get settings for the authenticated user (200 + binary | 204)
 * - PUT  / — Put settings for the authenticated user (204 | 404 | 409 | 413)
 * - DELETE / — Delete settings for the authenticated user (204)
 */

import { Hono } from 'hono';
import type { UserSettingsStore } from '../user-settings-store.js';
import type { IdentityBackend } from '../interfaces.js';
import { WorkspaceNotFoundError, WorkspaceLockedError } from '../errors.js';

/** 350KB payload limit (DynamoDB 400KB item limit minus attribute overhead). */
const MAX_PAYLOAD_BYTES = 350 * 1024;

/** Helper to extract identity from Hono context via IdentityBackend. */
function getIdentity(c: any, identityBackend: IdentityBackend) {
  const env = c.env as { event: unknown };
  return identityBackend.getIdentity(env.event);
}

/**
 * Create user settings routes.
 *
 * Mounted at /api/repos/:repo/workspaces/:ws/user-settings.
 * Auth is handled by the authz middleware on /api/repos/*.
 */
export function createUserSettingsRoutes(
  userSettingsStore: UserSettingsStore,
  identityBackend: IdentityBackend,
): Hono {
  const app = new Hono();

  // GET / — Get settings for the authenticated user
  app.get('/', async (c) => {
    const identity = getIdentity(c, identityBackend);
    if (!identity) {
      return c.json({ error: 'unauthorized', message: 'Authentication required' }, 401);
    }

    const repo = c.req.param('repo')!;
    const workspace = c.req.param('ws')!;

    try {
      const data = await userSettingsStore.get(repo, workspace, identity.sub);
      if (!data) {
        return new Response(null, { status: 204 });
      }
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    } catch (err) {
      console.error('Failed to get user settings:', err);
      return c.json({ error: 'internal', message: 'Failed to get user settings' }, 500);
    }
  });

  // PUT / — Put settings for the authenticated user
  app.put('/', async (c) => {
    const identity = getIdentity(c, identityBackend);
    if (!identity) {
      return c.json({ error: 'unauthorized', message: 'Authentication required' }, 401);
    }

    const repo = c.req.param('repo')!;
    const workspace = c.req.param('ws')!;

    try {
      const buffer = await c.req.arrayBuffer();
      const data = new Uint8Array(buffer);

      if (data.byteLength > MAX_PAYLOAD_BYTES) {
        return c.json({
          error: 'payload_too_large',
          message: `Payload exceeds maximum size of ${MAX_PAYLOAD_BYTES} bytes`,
        }, 413);
      }

      await userSettingsStore.put(repo, workspace, identity.sub, data);
      return new Response(null, { status: 204 });
    } catch (err) {
      if (err instanceof WorkspaceNotFoundError) {
        return c.json({ error: 'not_found', message: err.message }, 404);
      }
      if (err instanceof WorkspaceLockedError) {
        return c.json({ error: 'conflict', message: err.message }, 409);
      }
      console.error('Failed to put user settings:', err);
      return c.json({ error: 'internal', message: 'Failed to put user settings' }, 500);
    }
  });

  // DELETE / — Delete settings for the authenticated user
  app.delete('/', async (c) => {
    const identity = getIdentity(c, identityBackend);
    if (!identity) {
      return c.json({ error: 'unauthorized', message: 'Authentication required' }, 401);
    }

    const repo = c.req.param('repo')!;
    const workspace = c.req.param('ws')!;

    try {
      await userSettingsStore.delete(repo, workspace, identity.sub);
      return new Response(null, { status: 204 });
    } catch (err) {
      console.error('Failed to delete user settings:', err);
      return c.json({ error: 'internal', message: 'Failed to delete user settings' }, 500);
    }
  });

  return app;
}
