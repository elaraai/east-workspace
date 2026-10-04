/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A deploy job run over several calls, as compute with a time limit runs a
 * long one: the job a call its caller stopped leaves behind, and the workspace
 * lock the caller holds from the first call to the last. And a gc job: the
 * status a poll reads, whatever gc did.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { DictType, East, StringType, StructType, none, some, variant } from '@elaraai/east';
import e3, { type PackageDef } from '@elaraai/e3';
import { packageImport } from '../package-files.js';
import { workspaceCreate, workspaceGetState } from '../workspaces.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from '../test-helpers.js';
import { InMemoryStorage } from '../storage/in-memory/InMemoryStorage.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/index.js';
import type { TaskRunner } from '../execution/interfaces.js';
import { LocalTaskRunner } from '../execution/LocalTaskRunner.js';
import { InMemoryTransferBackend } from './InMemoryTransferBackend.js';
import { handleProcessDeploy, handleProcessGc } from './process.js';

const PlanType = StructType({ owner: StringType });

/** A package whose deploy owes an index build, so it calls the runner. */
function indexed(): PackageDef<Record<string, unknown>> {
  const plans = e3.record('plans', DictType(StringType, PlanType), new Map());
  const byOwner = e3.recordIndex('by_owner', plans, {
    key: East.function([StringType, PlanType], StringType, ($, _id, plan) => plan.owner),
  });
  return e3.package('planning', '1.0.0', plans, byOwner);
}

/** A package whose deploy runs nothing. */
function plain(): PackageDef<Record<string, unknown>> {
  return e3.package('notes', '1.0.0', e3.input('note', StringType, variant('value', 'hello')));
}

describe('a deploy job run over several calls', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  let deployStore: InMemoryTransferBackend['workspaceDeploy'];
  const ws = 'main';

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    deployStore = new InMemoryTransferBackend({}).workspaceDeploy;
    await workspaceCreate(storage, repo, ws);
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** Imports `pkg`, and creates job `id`, which deploys it to the workspace. */
  async function job(id: string, pkg: PackageDef<Record<string, unknown>>): Promise<void> {
    const zip = join(tempDir, `${pkg.name}-${pkg.version}.zip`);
    await e3.export(pkg, zip);
    await packageImport(storage, repo, zip);
    await deployStore.create(id, {
      repo,
      workspace: ws,
      packageName: pkg.name,
      packageVersion: pkg.version,
      schema: variant('migrate', null),
      allowDropRecords: false,
      plan: false,
      status: variant('processing', variant('pending', null)),
      createdAt: new Date(),
    });
  }

  it('leaves the job processing, and rethrows, when a call its caller stopped throws', async () => {
    await job('stopped', indexed());
    const controller = new AbortController();
    // The caller stops the call while the deploy waits on the build, and the
    // runner, no longer waiting, throws.
    const runner = {
      execute: () => {
        controller.abort();
        return Promise.reject(new Error('the call stopped waiting for its units'));
      },
    } as unknown as TaskRunner;

    await assert.rejects(
      handleProcessDeploy({ storage, deployStore, runner, signal: controller.signal }, { id: 'stopped', repo }),
      /the call stopped waiting for its units/,
    );
    assert.equal((await deployStore.get('stopped'))!.status.type, 'processing', 'a call handed over is not a failure');
    assert.equal(await workspaceGetState(storage, repo, ws), null, 'nothing was written, so the next call deploys from the top');
  });

  it('records the job failed when the deploy throws and its signal has not aborted', async () => {
    await job('failed', indexed());
    const runner = { execute: () => Promise.reject(new Error('the build program failed')) } as unknown as TaskRunner;

    await assert.rejects(
      handleProcessDeploy({ storage, deployStore, runner, signal: new AbortController().signal }, { id: 'failed', repo }),
      /the build program failed/,
    );
    const { status } = (await deployStore.get('failed'))!;
    assert.equal(status.type, 'failed');
    if (status.type === 'failed') assert.match(status.value.message, /the build program failed/);
  });

  it('deploys under the workspace lock its caller holds, and leaves it held', async () => {
    await job('locked', plain());
    const lock = await storage.locks.acquire(repo, ws, variant('deployment', null));
    assert.ok(lock);
    try {
      // The caller holds the workspace exclusively: a deploy that took a lock
      // of its own would be refused it.
      await handleProcessDeploy({ storage, deployStore, lock }, { id: 'locked', repo });
      assert.equal((await deployStore.get('locked'))!.status.type, 'completed');
      assert.equal((await workspaceGetState(storage, repo, ws))?.packageName, 'notes');
      assert.equal(await storage.locks.acquire(repo, ws, variant('deployment', null)), null,
        'the caller still holds the workspace');
    } finally {
      await lock.release();
    }
  });
});

describe('a gc job', () => {
  let storage: InMemoryStorage;
  let gcStore: InMemoryTransferBackend['repoGc'];

  beforeEach(async () => {
    storage = new InMemoryStorage();
    await storage.repos.create('repo');
    gcStore = new InMemoryTransferBackend({}).repoGc;
  });

  it('records what gc did, having swept as it was asked', async () => {
    const orphan = await storage.objects.write('repo', new Uint8Array([1, 2, 3]));
    await gcStore.create('swept', {
      repo: 'repo',
      request: { dryRun: false, minAge: some(0n), keepRuns: none, keepDays: none },
      status: { status: variant('running', null), stats: none, error: none },
      createdAt: new Date(),
    });

    await handleProcessGc({ storage, gcStore }, { id: 'swept', repo: 'repo' });

    const { status } = (await gcStore.get('swept'))!;
    assert.equal(status.status.type, 'succeeded');
    assert.equal(status.stats.type === 'some' ? status.stats.value.deletedObjects : null, 1n);
    assert.equal(await storage.objects.exists('repo', orphan), false);
  });

  it('records the job failed, with why, and rethrows', async () => {
    await gcStore.create('refused', {
      repo: 'repo',
      request: { dryRun: true, minAge: none, keepRuns: some(-1n), keepDays: none },
      status: { status: variant('running', null), stats: none, error: none },
      createdAt: new Date(),
    });

    await assert.rejects(handleProcessGc({ storage, gcStore }, { id: 'refused', repo: 'repo' }), RangeError);

    const { status } = (await gcStore.get('refused'))!;
    assert.equal(status.status.type, 'failed');
    assert.equal(status.error.type === 'some' ? status.error.value : null, 'gc: keepRuns must be a whole number of zero or more, got -1');
  });

  describe('an attempt recorded running that cannot finish', () => {
    // Recorded long ago by a runner that never had a pid, with no owner: the
    // local runner says it cannot finish
    const [task, inputs] = ['a'.repeat(64), 'b'.repeat(64)];
    const old = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const time = old.toString(16).padStart(12, '0');
    const executionId = `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-000000000001`;
    const request = { dryRun: false, minAge: some(0n), keepRuns: none, keepDays: none };
    const running = { status: variant('running', null), stats: none, error: none };

    beforeEach(async () => {
      await storage.refs.executionWrite('repo', task, inputs, executionId, variant('running', {
        executionId, inputHashes: [], startedAt: new Date(old), pid: -1n, pidStartTime: -1n, bootId: 'boot-id', unit: false,
      }));
    });

    /** What a job deleted of the history, once it has ended. */
    async function deleted(store: InMemoryTransferBackend['repoGc'], id: string): Promise<bigint | null> {
      const { status } = (await store.get(id))!;
      return status.stats.type === 'some' ? status.stats.value.deletedExecutions : null;
    }

    it('is kept by a job given no runner, and recorded interrupted and pruned on the judgement of the runner it is given', async () => {
      await gcStore.create('unjudged', { repo: 'repo', request, status: running, createdAt: new Date() });
      await handleProcessGc({ storage, gcStore }, { id: 'unjudged', repo: 'repo' });
      assert.equal(await deleted(gcStore, 'unjudged'), 0n);
      assert.deepEqual(await storage.refs.executionListIds('repo', task, inputs), [executionId]);

      await gcStore.create('judged', { repo: 'repo', request, status: running, createdAt: new Date() });
      await handleProcessGc({ storage, gcStore, runner: new LocalTaskRunner('repo') }, { id: 'judged', repo: 'repo' });
      assert.equal(await deleted(gcStore, 'judged'), 1n);
      assert.deepEqual(await storage.refs.executionListIds('repo', task, inputs), []);
    });

    it('is pruned by a job its backend runs, on the runner the backend gives the repository', async () => {
      const transfer = new InMemoryTransferBackend({ storage, getRepoPath: (repo) => repo, getRunner: (repoPath) => new LocalTaskRunner(repoPath) });
      await transfer.repoGc.create('ran', { repo: 'repo', request, status: running, createdAt: new Date() });
      await transfer.repoGc.execute('ran', 'repo');
      // The backend runs the job in the background, as a poll finds it
      while ((await transfer.repoGc.get('ran'))!.status.status.type === 'running') await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(await deleted(transfer.repoGc, 'ran'), 1n);
      assert.deepEqual(await storage.refs.executionListIds('repo', task, inputs), []);
    });
  });
});
