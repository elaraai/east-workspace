/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';

const app = new Hono();

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Tenant-scoped routes: /repos/{tenant}/api/...
app.get('/repos/:tenant/api/workspaces', async (c) => {
  const tenant = c.req.param('tenant');
  // TODO: Implement workspace list using e3-core + EfsBackend
  return c.json({ tenant, workspaces: [] });
});

app.get('/repos/:tenant/api/workspaces/:ws', async (c) => {
  const tenant = c.req.param('tenant');
  const ws = c.req.param('ws');
  // TODO: Implement workspace get
  return c.json({ tenant, workspace: ws });
});

app.post('/repos/:tenant/api/workspaces/:ws/start', async (c) => {
  const tenant = c.req.param('tenant');
  const ws = c.req.param('ws');
  // TODO: Start Step Functions execution
  return c.json({ tenant, workspace: ws, status: 'started' });
});

// Export Lambda handler
export const handler = handle(app);
