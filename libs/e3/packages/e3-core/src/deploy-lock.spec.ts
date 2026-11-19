/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A workspace's intent over a local repository: what a deploy that has
 * announced itself refuses, how long a deploy waits for its workspace, what a
 * plan does beside one, and a removal, a copy onto the workspace and an export
 * of it, which take it whole as a deploy does.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DateTimeType, East, StringType, encodeBeast2For, none, printFor, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { LockStateType, type LockOperation, type LockState } from '@elaraai/e3-types';
import { untilAnnounced } from './contract/support.js';
import { acquireWorkspaceExclusive, acquireWorkspaceShared, announcedIntent, workspaceIntentLock } from './deploy-lock.js';
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

describe('a workspace\'s intent', () => {
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

  /** Asserts a refusal names what has announced itself on the workspace's
   *  intent, in the words a caller reads: `a deploy`, `a removal`, `a copy`
   *  or `an export`. */
  async function assertRefusedBy(holder: string, refused: () => Promise<unknown>, what: string): Promise<void> {
    const intent = await storage.locks.getState(repo, workspaceIntentLock(WS));
    assert.ok(intent !== null, `${holder} has announced itself`);
    await assert.rejects(refused(), (err: unknown) => {
      assert.ok(err instanceof WorkspaceLockError, `${what}: a WorkspaceLockError, not ${String(err)}`);
      assert.equal(
        err.message,
        `Workspace '${WS}' is locked by ${holder} in process ${process.pid} (since ${printFor(DateTimeType)(intent.acquiredAt)})`,
        what,
      );
      return true;
    });
  }
  const assertRefusedByDeploy = (refused: () => Promise<unknown>, what: string): Promise<void> => assertRefusedBy('a deploy', refused, what);

  it('refuses a write, a record\'s write, an export, a copy and a run start at once, naming the deploy, while a deploy has announced itself', async () => {
    // A run holds the workspace shared, as people's edits keep one running: the
    // deploy has announced itself and waits for it
    const running = await acquireWorkspaceShared(storage, repo, WS, variant('dataflow', null));
    assert.ok(running !== null);
    const deploying = acquireWorkspaceExclusive(storage, repo, WS, variant('deployment', null), { waitMs: 20_000 });
    try {
      // Whether the deploy's wait is over: it waits for the run, which holds
      // the workspace until this case lets it go
      const settled = await untilAnnounced(storage, repo, WS, deploying);

      await assertRefusedByDeploy(() => workspaceSetDataset(storage, repo, WS, NOTE, 'during', StringType), 'a dataset write');
      await assertRefusedByDeploy(() => withSharedWorkspaceLock(storage, repo, WS, undefined, () => Promise.resolve()), 'a record write');
      await assertRefusedByDeploy(() => workspaceBundleExport(storage, repo, WS, new WritableStream<Uint8Array>()), 'a bundle export');
      await assertRefusedByDeploy(() => workspaceCopy(storage, repo, WS, 'staging'), 'a copy of it');
      await assertRefusedByDeploy(() => new LocalOrchestrator().start(storage, repo, WS, { runner: new MockTaskRunner() }), 'a run start');
      assert.equal(settled(), false, 'each was refused while the deploy still waited: none waited for it');
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
    let released = false;
    setTimeout(() => {
      released = true;
      void writing.release();
    }, 300);

    await workspaceDeploy(storage, repo, WS, 'notes', '2.0.0', { lockWaitMs: 20_000 });
    assert.equal(released, true, 'the deploy waited for the write');
    assert.equal((await workspaceGetState(storage, repo, WS))?.packageVersion, '2.0.0');
    assert.equal(await announcedIntent(storage, repo, WS), null, 'the intent went with the deploy');
  });

  it('is refused once its wait is over, naming what still holds the workspace, and leaves no intent behind', async () => {
    const operation: LockOperation = variant('export', null);
    const held = await storage.locks.acquire(repo, WS, operation);
    assert.ok(held !== null);
    // How the deploy asked for the workspace's lock: to share it, without
    // waiting, to decide before it announced itself; then whole, waiting for
    // what was left of its wait
    const asked: Array<{ mode?: string; wait?: boolean; timeout?: number }> = [];
    const acquire = storage.locks.acquire.bind(storage.locks);
    storage.locks.acquire = (lockRepo, resource, lockOperation, options) => {
      if (resource === WS) asked.push({ mode: options?.mode, wait: options?.wait, timeout: options?.timeout });
      return acquire(lockRepo, resource, lockOperation, options);
    };
    try {
      const holder = await storage.locks.getState(repo, WS);
      assert.ok(holder !== null);
      await assert.rejects(workspaceDeploy(storage, repo, WS, 'notes', '2.0.0', { lockWaitMs: 300 }), (err: unknown) => {
        assert.ok(err instanceof WorkspaceLockError, `a WorkspaceLockError, not ${String(err)}`);
        assert.equal(err.message, `Workspace '${WS}' is locked by an export in process ${process.pid} (since ${printFor(DateTimeType)(holder.acquiredAt)})`);
        return true;
      });
      assert.deepEqual(asked.map((each) => each.mode ?? 'exclusive'), ['shared', 'exclusive'], 'it asked to share the workspace, then for the workspace whole, once each');
      assert.equal(asked[0]!.wait, undefined, 'it did not wait to share a workspace something holds whole');
      assert.equal(asked[1]!.wait, true, 'it waited before it was refused');
      assert.ok(asked[1]!.timeout !== undefined && asked[1]!.timeout > 0 && asked[1]!.timeout <= 300, `for what was left of its wait, not ${asked[1]!.timeout}`);
      assert.equal(await announcedIntent(storage, repo, WS), null);
      assert.equal((await workspaceGetState(storage, repo, WS))?.packageVersion, '1.0.0', 'nothing was deployed');
    } finally {
      storage.locks.acquire = acquire;
      await held.release();
    }
  });

  it('lets its intent go though the workspace\'s lock failed to release: nothing is refused for a deploy that is over', async () => {
    const acquire = storage.locks.acquire.bind(storage.locks);
    storage.locks.acquire = async (lockRepo, resource, operation, options) => {
      const handle = await acquire(lockRepo, resource, operation, options);
      if (handle === null || resource !== WS) return handle;
      // The workspace's lock: it lets go, and its release then fails
      return {
        resource: handle.resource,
        report: (progress) => handle.report(progress),
        release: async () => {
          await handle.release();
          throw new Error('the lock store went away');
        },
      };
    };
    try {
      const deploy = await acquireWorkspaceExclusive(storage, repo, WS, variant('deployment', null));
      await assert.rejects(deploy.release(), /the lock store went away/);
    } finally {
      storage.locks.acquire = acquire;
    }
    assert.equal(await announcedIntent(storage, repo, WS), null, 'the intent went with the deploy');
    await workspaceSetDataset(storage, repo, WS, NOTE, 'after', StringType);
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
      assert.ok(!taken.includes(`${workspaceIntentLock(WS)}:exclusive`), `the plan announced nothing: ${taken.join(', ')}`);
      assert.ok(taken.includes(`${WS}:shared`), 'it shared the workspace');
      assert.equal((await workspaceGetState(storage, repo, WS))?.packageVersion, '1.0.0', 'a plan writes nothing');
    } finally {
      storage.locks.acquire = acquire;
      await running.release();
    }

    const deploy = await acquireWorkspaceExclusive(storage, repo, WS, variant('deployment', null));
    try {
      await assertRefusedByDeploy(() => workspaceDeploy(storage, repo, WS, 'notes', '2.0.0', { plan: true }), 'a plan');
    } finally {
      await deploy.release();
    }
  });

  it('takes the workspace whole for an export, a copy onto it and a removal, as for a deploy: each announces itself, refuses a write and a run start meanwhile, naming itself, and goes through once the run lets go', async () => {
    await workspaceDeploy(storage, repo, 'staging', 'notes', '2.0.0');
    const cases: Array<{ holder: string; take: () => Promise<unknown>; done: () => Promise<void> }> = [
      {
        holder: 'an export',
        take: () => workspaceExport(storage, repo, WS, join(tempDir, 'out.zip')),
        done: async () => { await fs.access(join(tempDir, 'out.zip')); },
      },
      {
        holder: 'a copy',
        take: () => workspaceCopy(storage, repo, 'staging', WS),
        done: async () => { assert.equal((await workspaceGetState(storage, repo, WS))?.packageVersion, '2.0.0', 'main is a copy of staging'); },
      },
      {
        holder: 'a removal',
        take: () => workspaceRemove(storage, repo, WS),
        done: async () => { assert.equal(await workspaceGetState(storage, repo, WS), null, 'main is gone'); },
      },
    ];
    for (const { holder, take, done } of cases) {
      // A run holds the workspace shared: what takes it whole announces itself, and waits for it
      const running = await acquireWorkspaceShared(storage, repo, WS, variant('dataflow', null));
      assert.ok(running !== null);
      const taking = take();
      try {
        const settled = await untilAnnounced(storage, repo, WS, taking);
        await assertRefusedBy(holder, () => workspaceSetDataset(storage, repo, WS, NOTE, 'during', StringType), `a dataset write during ${holder}`);
        await assertRefusedBy(holder, () => new LocalOrchestrator().start(storage, repo, WS, { runner: new MockTaskRunner() }), `a run start during ${holder}`);
        assert.equal(settled(), false, `${holder} waits for the run`);
      } finally {
        await running.release();
      }
      await taking;
      await done();
      assert.equal(await announcedIntent(storage, repo, WS), null, `the intent went with ${holder}`);
    }
  });

  it('reads the intent of a deploy whose process has died as nothing announced, and cleans it', async () => {
    const lockPath = workspaceLockPath(repo, workspaceIntentLock(WS));
    await fs.mkdir(dirname(lockPath), { recursive: true });
    const dead: LockState = {
      operation: variant('deployment', null),
      holder: variant('process', { pid: 99999999n, bootId: 'gone', startTime: 0n, command: 'e3 workspace deploy' }),
      acquiredAt: new Date(),
      expiresAt: none,
    };
    await fs.writeFile(lockPath, encodeBeast2For(LockStateType)(dead));

    assert.equal(await announcedIntent(storage, repo, WS), null);
    await assert.rejects(fs.access(lockPath), { code: 'ENOENT' });
    await workspaceSetDataset(storage, repo, WS, NOTE, 'after', StringType);
  });
});
