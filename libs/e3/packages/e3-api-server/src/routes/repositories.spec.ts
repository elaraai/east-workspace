/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The routes of a host's repositories, and the gate every request to one
 * passes, mounted over a backend other than the local server's — the
 * in-memory one, as a cloud mounts them over its own: a repository is listed,
 * created, opened at each request and removed, and one being removed answers
 * its status alone. And a server of one repository serves it as `default`,
 * whichever order the gate and the routes are mounted in.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { ArrayType, NullType, StringType, decodeBeast2For, variant } from '@elaraai/east';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import { E3_RELEASE } from '@elaraai/e3-types';
import { createRepositoryGate, createSingleRepositoryGate } from '../middleware/repository.js';
import { ResponseType } from '../types.js';
import { createRepositoriesRoutes, createSingleRepositoryRoutes } from './repositories.js';

const decodeList = decodeBeast2For(ResponseType(ArrayType(StringType)));
const decodeName = decodeBeast2For(ResponseType(StringType));
const decodeNull = decodeBeast2For(ResponseType(NullType));
const bytes = async (response: Response | Promise<Response>) => new Uint8Array(await (await response).arrayBuffer());

describe('the repositories routes and gate', () => {
  it('list, create and remove a host\'s repositories, and open one at every request to it', async () => {
    const storage = new InMemoryStorage();
    const app = new Hono();
    app.use('/api/repos/:repo/*', createRepositoryGate(storage, (repo) => repo));
    app.route('/api/repos', createRepositoriesRoutes(storage));
    app.get('/api/repos/:repo/probe', (c) => c.text('passed'));
    app.get('/api/repos/:repo/status', (c) => c.text('its status'));
    const notFound = (repo: string) => ({ error: 'not_found', message: `Repository '${repo}' not found` });

    const created = await app.request('/api/repos/alpha', { method: 'PUT' });
    assert.equal(created.status, 201);
    assert.deepEqual(decodeName(await bytes(created)), variant('success', 'alpha'));
    assert.deepEqual(decodeList(await bytes(app.request('/api/repos'))), variant('success', ['alpha']));
    assert.equal((decodeName(await bytes(app.request('/api/repos/alpha', { method: 'PUT' })))).type, 'error', 'one that exists is not created again');

    assert.equal(await (await app.request('/api/repos/alpha/probe')).text(), 'passed');
    const missing = await app.request('/api/repos/beta/probe');
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), notFound('beta'));

    // One this e3 cannot open is refused, naming the release that upgraded it.
    await app.request('/api/repos/gamma', { method: 'PUT' });
    const record = await storage.refs.repositoryRead('gamma');
    assert.ok(record !== null);
    await storage.refs.repositoryWrite('gamma', { ...record, upgrades: [...record.upgrades, { name: 'from-a-newer-e3', release: '999.0.0' }] });
    const refused = await app.request('/api/repos/gamma/probe');
    assert.equal(refused.status, 500);
    assert.deepEqual(await refused.json(), { error: { type: 'internal', message:
      `the repository at gamma has had the upgrade "from-a-newer-e3", which e3 999.0.0 applied and this e3, ${E3_RELEASE}, does not know — open it with e3 999.0.0 or a newer one` } });

    // One being removed answers its status alone, and a removal asked again
    // answers at once.
    await storage.repos.setStatus('alpha', 'deleting', 'active');
    assert.deepEqual(await (await app.request('/api/repos/alpha/probe')).json(), notFound('alpha'));
    assert.equal(await (await app.request('/api/repos/alpha/status')).text(), 'its status');
    assert.deepEqual(decodeNull(await bytes(app.request('/api/repos/alpha', { method: 'DELETE' }))), variant('success', null));

    await storage.repos.setStatus('alpha', 'active', 'deleting');
    assert.deepEqual(decodeNull(await bytes(app.request('/api/repos/alpha', { method: 'DELETE' }))), variant('success', null));
    assert.deepEqual(decodeList(await bytes(app.request('/api/repos'))), variant('success', ['gamma']));
    assert.deepEqual(await (await app.request('/api/repos/alpha/probe')).json(), notFound('alpha'));
    assert.deepEqual(decodeNull(await bytes(app.request('/api/repos/alpha', { method: 'DELETE' }))),
      variant('error', variant('repository_not_found', { repo: 'alpha' })));
  });

  it('serve one repository as `default`, and create and remove none, the gate mounted ahead of the routes', async () => {
    const app = new Hono();
    app.use('/api/repos/:repo/*', createSingleRepositoryGate());
    app.route('/api/repos', createSingleRepositoryRoutes());
    app.get('/api/repos/:repo/probe', (c) => c.text('passed'));

    assert.deepEqual(decodeList(await bytes(app.request('/api/repos'))), variant('success', ['default']));
    assert.equal(await (await app.request('/api/repos/default/probe')).text(), 'passed');
    assert.equal((await app.request('/api/repos/other/probe')).status, 404);
    assert.equal((await app.request('/api/repos/new-repo', { method: 'PUT' })).status, 405);
    assert.equal((await app.request('/api/repos/default', { method: 'DELETE' })).status, 405);
    assert.equal((await app.request('/api/repos/other', { method: 'DELETE' })).status, 404);
  });
});
