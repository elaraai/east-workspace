/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A deploy's intent over a local repository: what a deploy that has announced
 * itself refuses, how long a deploy waits for its workspace, and what a plan,
 * a removal and an export do beside one.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DateTimeType, East, StringType, encodeBeast2For, none, printFor, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { LockStateType, type LockOperation, type LockState } from '@elaraai/e3-types';
import { acquireForDeploy, acquireWorkspaceShared, deployAnnounced, deployIntentLock } from './deploy-lock.js';
import { WorkspaceLockError } from './errors.js';
import { LocalOrchestrator } from './execution/local-orchestrator.js';
import { MockTaskRunner } from './execution/MockTaskRunner.js';
import { packageImport } from './package-files.js';
import { withSharedWorkspaceLock } from './records.js';
import { LocalStorage } from './storage/local/index.js';
import { workspaceLockPath } from './storage/local/LocalLockService.js';
import type { StorageBackend } from './storage/interfaces.js';
import { createTempDir, createTestRepo, removeTempDir, removeTestRepo } from './test-helpers.js';
import { workspaceSetDataset } from './trees.js';
import { workspaceBundleExport } from './workspace-bundle.js';
import { workspaceDeploy, workspaceExport } from './workspace-files.js';
import { workspaceCopy, workspaceGetState, workspaceRemove } from './workspaces.js';

const WS = 'main';
const NOTE = [variant('field', 'inputs'), variant('field', 'note')];

describe('a deploy\'s intent', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage();
    const note = e3.input('note', StringType, variant('value', 'before'));
    const shout = e3.task('shout', [note], East.function([StringType], StringType, ($, text) => text.upperCase()));
    for (const version of ['1.0.0', '2.0.0']) {
      const zip = join(tempDir, `notes-${version}.zip`);
      await e3.export(e3.package('notes', version, shout), zip);
      await packageImport(storage, repo, zip);
    }
    await workspaceDeploy(storage, repo, WS, 'notes', '1.0.0');
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** Asserts a refusal names the deploy that has announced itself, in the
   *  words a caller reads. */
  async function assertRefusedByDeploy(refused: () => Promise<unknown>, what: string): Promise<void> {
    const intent = await storage.locks.getState(repo, deployIntentLock(WS));
    assert.ok(intent !== null, 'a deploy has announced itself');
    await assert.rejects(refused(), (err: unknown) => {
      assert.ok(err instanceof WorkspaceLockError, `${what}: a WorkspaceLockError, not ${String(err)}`);
      assert.equal(
        err.message,
        `Workspace '${WS}' is locked by a deploy in process ${process.pid} (since ${printFor(DateTimeType)(intent.acquiredAt)})`,
        what,
      );
      return true;
    });
  }

  it('refuses a write, a record\'s write, an export, a copy and a run start at once, naming the deploy, while a deploy has announced itself', async () => {
    // A run holds the workspace shared, as people's edits keep one running: the
    // deploy has announced itself and waits for it
    const running = await acquireWorkspaceShared(storage, repo, WS, variant('dataflow', null));
    assert.ok(running !== null);
    const deploying = acquireForDeploy(storage, repo, WS, { waitMs: 20_000 });
    try {
      const announced = Date.now() + 5_000;
      while (!(await deployAnnounced(storage, repo, WS))) {
        assert.ok(Date.now() < announced, 'the deploy announces itself while it waits');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const started = Date.now();
      await assertRefusedByDeploy(() => workspaceSetDataset(storage, repo, WS, NOTE, 'during', StringType), 'a dataset write');
      await assertRefusedByDeploy(() => withSharedWorkspaceLock(storage, repo, WS, undefined, () => Promise.resolve()), 'a record write');
      await assertRefusedByDeploy(() => workspaceBundleExport(storage, repo, WS, new WritableStream<Uint8Array>()), 'a bundle export');
      await assertRefusedByDeploy(() => workspaceCopy(storage, repo, WS, 'staging'), 'a copy of it');
      await assertRefusedByDeploy(() => new LocalOrchestrator().start(storage, repo, WS, { runner: new MockTaskRunner() }), 'a run start');
      assert.ok(Date.now() - started < 5_000, 'each was refused without waiting for the deploy');
      assert.equal(await workspaceGetState(storage, repo, 'staging'), null, 'the copy made nothing');
    } finally {
      await running.release();
      await (await deploying).release();
    }
    // The deploy over, each goes through again
    await workspaceSetDataset(storage, repo, WS, NOTE, 'after', StringType);
  });

  it('waits for a write in progress to let the workspace go, and deploys', async () => {
    const writing = await acquireWorkspaceShared(storage, repo, WS, variant('dataset_write', null));
    assert.ok(writing !== null);
    setTimeout(() => { void writing.release(); }, 300);

    const started = Date.now();
    await workspaceDeploy(storage, repo, WS, 'notes', '2.0.0', { lockWaitMs: 20_000 });
    assert.ok(Date.now() - started >= 250, 'the deploy waited for the write');
    assert.equal((await workspaceGetState(storage, repo, WS))?.packageVersion, '2.0.0');
    assert.equal(await deployAnnounced(storage, repo, WS), false, 'the intent went with the deploy');
  });

  it('is refused once its wait is over, naming what still holds the workspace, and leaves no intent behind', async () => {
    const operation: LockOperation = variant('export', null);
    const held = await storage.locks.acquire(repo, WS, operation);
    assert.ok(held !== null);
    try {
      const holder = await storage.locks.getState(repo, WS);
      assert.ok(holder !== null);
      const started = Date.now();
      await assert.rejects(workspaceDeploy(storage, repo, WS, 'notes', '2.0.0', { lockWaitMs: 300 }), (err: unknown) => {
        assert.ok(err instanceof WorkspaceLockError, `a WorkspaceLockError, not ${String(err)}`);
        assert.equal(err.message, `Workspace '${WS}' is locked by process ${process.pid} (since ${printFor(DateTimeType)(holder.acquiredAt)})`);
        return true;
      });
      assert.ok(Date.now() - started >= 250, 'it waited before it was refused');
      assert.equal(await deployAnnounced(storage, repo, WS), false);
      assert.equal((await workspaceGetState(storage, repo, WS))?.packageVersion, '1.0.0', 'nothing was deployed');
    } finally {
      await held.release();
    }
  });

  it('plans under the workspace shared: a plan announces nothing and stops nothing, and is refused by a deploy that has announced itself', async () => {
    const running = await acquireWorkspaceShared(storage, repo, WS, variant('dataflow', null));
    assert.ok(running !== null);
    const taken: string[] = [];
    const acquire = storage.locks.acquire.bind(storage.locks);
    storage.locks.acquire = (lockRepo, resource, operation, options) => {
      taken.push(`${resource}:${options?.mode ?? 'exclusive'}`);
      return acquire(lockRepo, resource, operation, options);
    };
    try {
      const plans: string[] = [];
      await workspaceDeploy(storage, repo, WS, 'notes', '2.0.0', { plan: true, onInputPlan: (plan) => plans.push(plan.input) });
      assert.deepEqual(plans, ['inputs/note'], 'the plan was made while the run held the workspace');
      assert.ok(!taken.includes(`${deployIntentLock(WS)}:exclusive`), `the plan announced nothing: ${taken.join(', ')}`);
      assert.ok(taken.includes(`${WS}:shared`), 'it shared the workspace');
      assert.equal((await workspaceGetState(storage, repo, WS))?.packageVersion, '1.0.0', 'a plan writes nothing');
    } finally {
      storage.locks.acquire = acquire;
      await running.release();
    }

    const deploy = await acquireForDeploy(storage, repo, WS);
    try {
      await assertRefusedByDeploy(() => workspaceDeploy(storage, repo, WS, 'notes', '2.0.0', { plan: true }), 'a plan');
    } finally {
      await deploy.release();
    }
  });

  it('refuses a workspace\'s removal and its export as a package while a run is in flight, as before: neither stops a run', async () => {
    const run = await acquireWorkspaceShared(storage, repo, WS, variant('dataflow', null));
    assert.ok(run !== null);
    try {
      await assert.rejects(workspaceRemove(storage, repo, WS), WorkspaceLockError);
      await assert.rejects(workspaceExport(storage, repo, WS, join(tempDir, 'out.zip')), WorkspaceLockError);
      assert.equal(await deployAnnounced(storage, repo, WS), false, 'neither announced a deploy');
      assert.equal((await workspaceGetState(storage, repo, WS))?.packageVersion, '1.0.0');
    } finally {
      await run.release();
    }
  });

  it('reads the intent of a deploy whose process has died as no deploy, and cleans it', async () => {
    const lockPath = workspaceLockPath(repo, deployIntentLock(WS));
    await fs.mkdir(dirname(lockPath), { recursive: true });
    const dead: LockState = {
      operation: variant('deployment', null),
      holder: variant('process', { pid: 99999999n, bootId: 'gone', startTime: 0n, command: 'e3 workspace deploy' }),
      acquiredAt: new Date(),
      expiresAt: none,
    };
    await fs.writeFile(lockPath, encodeBeast2For(LockStateType)(dead));

    assert.equal(await deployAnnounced(storage, repo, WS), false);
    await assert.rejects(fs.access(lockPath), { code: 'ENOENT' });
    await workspaceSetDataset(storage, repo, WS, NOTE, 'after', StringType);
  });
});
