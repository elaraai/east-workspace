/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The repository gate: an upgrade a repository owes never makes the work it
 * waits for impossible to stop, no request is held for the wait, and a host
 * may leave the upgrade to a job of its own.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { encodeBeast2For, none, variant } from '@elaraai/east';
import { repositoryUpgradeStep } from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import { WorkspaceRecordType } from '@elaraai/e3-types';
import { createRepositoryGate } from './repository.js';

describe('the repository gate', () => {
  it('lets a running dataflow\'s cancel and poll through while an upgrade waits on the run, and holds no request for it', async () => {
    const storage = new InMemoryStorage();
    const repo = 'gated';
    await storage.repos.create(repo);
    await storage.refs.workspaceWrite(repo, 'main', encodeBeast2For(WorkspaceRecordType)(none));
    // A dataflow runs in `main`, holding its workspace's dataflow lock, as the
    // orchestrator does for the whole run.
    const run = await storage.locks.acquire(repo, 'main#dataflow', variant('dataflow', null));
    assert.ok(run, 'the run holds its workspace');
    // The host is upgraded to a release whose backend ships a layout step,
    // which the repository, created before it, owes.
    const before = (await storage.refs.repositoryRead(repo))?.upgrades.map(({ name }) => name) ?? [];
    const applied: string[] = [];
    storage.upgrades.push({ name: 'host-layout-2', apply: async () => { applied.push('host-layout-2'); return null; } });

    const app = new Hono();
    app.use('/api/repos/:repo/*', createRepositoryGate(storage, (r) => r));
    app.post('/api/repos/:repo/workspaces/:ws/dataflow/cancel', (c) => c.text('the cancel route ran'));
    app.get('/api/repos/:repo/workspaces/:ws/dataflow/execution', (c) => c.text('the poll route ran'));
    app.get('/api/repos/:repo/workspaces/:ws/status', (c) => c.text('the status route ran'));

    try {
      for (const [method, path, answer] of [
        ['POST', 'dataflow/cancel', 'the cancel route ran'],
        ['GET', 'dataflow/execution', 'the poll route ran'],
      ] as const) {
        const started = Date.now();
        const response = await app.request(`/api/repos/${repo}/workspaces/main/${path}`, { method });
        assert.equal(response.status, 200, `${method} ${path}`);
        assert.equal(await response.text(), answer);
        assert.ok(Date.now() - started < 5_000, `${method} ${path} waited on the upgrade`);
      }

      // Every other request is refused at once, naming the step and the run,
      // with when to ask again.
      const started = Date.now();
      const refused = await app.request(`/api/repos/${repo}/workspaces/main/status`);
      assert.ok(Date.now() - started < 5_000, 'the refusal waited on the upgrade');
      assert.equal(refused.status, 503);
      assert.equal(refused.headers.get('Retry-After'), '5');
      assert.deepEqual(await refused.json(), {
        error: {
          type: 'repository_upgrade_pending',
          message: 'the repository gated owes the upgrade "host-layout-2", which applies once nothing runs in it, '
            + 'and a dataflow is running in workspace \'main\' — retry when it finishes, or cancel it',
        },
      });
      assert.deepEqual(applied, []);
    } finally {
      await run.release();
    }

    // Once the run has let its workspace go, the next request applies the step.
    const status = await app.request(`/api/repos/${repo}/workspaces/main/status`);
    assert.equal(await status.text(), 'the status route ran');
    assert.deepEqual(applied, ['host-layout-2']);
    assert.deepEqual((await storage.refs.repositoryRead(repo))?.upgrades.map(({ name }) => name), [...before, 'host-layout-2']);
  });

  it('leaves the upgrade to the host\'s job when told to: no request applies it, each one tells the host, and all pass once the job has', async () => {
    const storage = new InMemoryStorage();
    const repo = 'gated';
    await storage.repos.create(repo);
    await storage.refs.workspaceWrite(repo, 'main', encodeBeast2For(WorkspaceRecordType)(none));
    const applied: string[] = [];
    storage.upgrades.push({ name: 'host-layout-2', apply: async () => { applied.push('host-layout-2'); return null; } });

    // The host starts its job as it is told; the second time, starting it
    // fails, which the host reports itself.
    const told: Array<[string, readonly string[]]> = [];
    const app = new Hono();
    app.use('/api/repos/:repo/*', createRepositoryGate(storage, (r) => r, {
      applyUpgrades: false,
      onUpgradePending: (name, upgrades) => {
        told.push([name, upgrades]);
        if (told.length === 2) throw new Error('the job did not start');
      },
    }));
    app.post('/api/repos/:repo/workspaces/:ws/dataflow/cancel', (c) => c.text('the cancel route ran'));
    app.get('/api/repos/:repo/workspaces/:ws/status', (c) => c.text('the status route ran'));

    // Nothing runs in the repository, and still no request applies the step.
    for (let i = 0; i < 2; i++) {
      const refused = await app.request(`/api/repos/${repo}/workspaces/main/status`);
      assert.equal(refused.status, 503);
      assert.equal(refused.headers.get('Retry-After'), '5');
      assert.deepEqual(await refused.json(), {
        error: {
          type: 'repository_upgrade_pending',
          message: 'the repository gated owes the upgrade "host-layout-2", which a job applies before the repository is read — retry once it has',
        },
      });
    }
    const cancel = await app.request(`/api/repos/${repo}/workspaces/main/dataflow/cancel`, { method: 'POST' });
    assert.equal(await cancel.text(), 'the cancel route ran');
    assert.deepEqual(told, [['gated', ['host-layout-2']], ['gated', ['host-layout-2']], ['gated', ['host-layout-2']]]);
    assert.deepEqual(applied, []);

    // The host's job applies the step, a part at a time until none is owed.
    assert.deepEqual(await repositoryUpgradeStep(storage, repo, { budgetMs: 10_000 }), { owed: [] });
    assert.deepEqual(applied, ['host-layout-2']);
    const status = await app.request(`/api/repos/${repo}/workspaces/main/status`);
    assert.equal(await status.text(), 'the status route ran');
    assert.equal(told.length, 3, 'a repository that owes nothing tells the host nothing');
  });
});
