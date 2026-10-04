/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The repository routes' record: a read, which applies no upgrade the
 * repository owes and waits on no work running in it, whether the repository
 * gate is mounted ahead of it or not. Without the gate, a repository that owes
 * upgrades is refused as the gate refuses it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { decodeBeast2For, variant } from '@elaraai/east';
import { InMemoryTransferBackend, TASKS_LOCK, repositoryUpgradeStep } from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import { RepositoryRecordType } from '@elaraai/e3-types';
import { getRecord } from '../handlers/repository.js';
import { createRepositoryGate } from '../middleware/repository.js';
import { ResponseType } from '../types.js';
import { createRepositoryRoutes } from './repository.js';

const decodeRecord = decodeBeast2For(ResponseType(RepositoryRecordType));

/** A repository written before its host's backend shipped a layout step,
 *  which it now owes, and the names of the steps applied. */
async function owing(): Promise<{ storage: InMemoryStorage; applied: string[] }> {
  const storage = new InMemoryStorage();
  await storage.repos.create('owing');
  const applied: string[] = [];
  storage.upgrades.push({ name: 'host-layout-2', apply: async () => { applied.push('host-layout-2'); return null; } });
  return { storage, applied };
}

/** The refusal the gate answers too, with when to ask again. */
async function assertRefused(response: Response, what: string): Promise<void> {
  assert.equal(response.status, 503, what);
  assert.equal(response.headers.get('Retry-After'), '5', what);
  assert.deepEqual(await response.json(), {
    error: {
      type: 'repository_upgrade_pending',
      message: 'the repository owing owes the upgrade "host-layout-2", which a job applies before the repository is read — retry once it has',
    },
  }, what);
}

describe('the repository record route', () => {
  it('reads a repository that owes an upgrade without applying it, refused at once as the gate refuses it, while a task runs or not', async () => {
    const { storage, applied } = await owing();
    const app = new Hono();
    app.route('/api/repos/:repo', createRepositoryRoutes(storage, (repo) => repo, new InMemoryTransferBackend({ storage, getRepoPath: (repo) => repo })));

    await assertRefused(await app.request('/api/repos/owing/record'), 'the route, with no gate ahead of it');
    await assertRefused(await getRecord(storage, 'owing'), 'the handler, as a host calls it');

    // A task running in the repository holds no read: the refusal is at once.
    const task = await storage.locks.acquire('owing', TASKS_LOCK, variant('dataflow', null), { mode: 'shared' });
    assert.ok(task !== null);
    try {
      const started = Date.now();
      await assertRefused(await app.request('/api/repos/owing/record'), 'the route, while a task runs');
      assert.ok(Date.now() - started < 5_000, 'the read waited on the running task');
    } finally {
      await task.release();
    }
    assert.deepEqual(applied, [], 'no read applies the step');

    // Once the host's job has applied it, the record is read.
    assert.deepEqual(await repositoryUpgradeStep(storage, 'owing', { budgetMs: 10_000 }), { owed: [] });
    const read = decodeRecord(new Uint8Array(await (await app.request('/api/repos/owing/record')).arrayBuffer()));
    assert.equal(read.type, 'success');
    if (read.type !== 'success') return;
    assert.ok(read.value.upgrades.some(({ name }) => name === 'host-layout-2'), 'the record names the step the job applied');
    assert.deepEqual(applied, ['host-layout-2']);
  });

  it('answers the record behind the gate as it always has: the gate applies the step, and the route reads it', async () => {
    const { storage, applied } = await owing();
    const app = new Hono();
    app.use('/api/repos/:repo/*', createRepositoryGate(storage, (repo) => repo));
    app.route('/api/repos/:repo', createRepositoryRoutes(storage, (repo) => repo, new InMemoryTransferBackend({ storage, getRepoPath: (repo) => repo })));

    const read = decodeRecord(new Uint8Array(await (await app.request('/api/repos/owing/record')).arrayBuffer()));
    assert.equal(read.type, 'success');
    if (read.type !== 'success') return;
    assert.ok(read.value.upgrades.some(({ name }) => name === 'host-layout-2'), 'the record names the step the gate applied');
    assert.deepEqual(applied, ['host-layout-2']);
  });
});
