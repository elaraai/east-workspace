/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The lock service's contract: the shared and exclusive holds e3-core relies
 * on to keep a deploy, a dataflow and a write off each other, over any
 * backend.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { variant } from '@elaraai/east';
import type { LockProgress } from '@elaraai/e3-types';
import { InvalidNameError } from '../errors.js';
import { workspaceLockStatus } from '../workspaces.js';
import { MALFORMED_NAMES, nameRefusal } from './malformed.js';
import type { BackendSetup } from './setup.js';

/** A deploy's progress: `done` of its three file sources taken in, the next
 *  one under way, and its one record waiting. */
const deploying = (done: number): LockProgress => variant('deployment', {
  package: { name: 'pkg', version: '1.0.0' },
  startedAt: new Date('2026-09-28T00:00:00.000Z'),
  files: [0, 1, 2].map((i) => ({
    path: `inputs/s${i}`,
    step: i < done ? variant('done', variant('taken', ['east-c'])) : i === done ? variant('taking_in', { pieces: 5n, done: 2n }) : variant('waiting', null),
    bytes: i < done ? 100n : i === done ? 40n : 0n,
    total: 100n,
  })),
  records: [{ plan: { record: 'records/r', action: variant('mint', null) }, indexes: ['by_key'], step: variant('waiting', null) }],
});

/**
 * Registers the lock service's contract suite over a backend.
 *
 * @param setup - Makes a fresh backend and a repository in it for each test
 */
export function lockServiceTests(setup: BackendSetup): void {
  describe('the lock service', () => {
    it('holds a resource exclusively against every other holder until it is released', async (t) => {
      const { storage, repo } = await setup(t);
      const held = await storage.locks.acquire(repo, 'resource', variant('deployment', null));
      assert.ok(held !== null);
      assert.equal(await storage.locks.acquire(repo, 'resource', variant('deployment', null)), null, 'a second exclusive holder is refused');
      assert.equal(await storage.locks.acquire(repo, 'resource', variant('dataflow', null), { mode: 'shared' }), null, 'a shared holder is refused');

      const other = await storage.locks.acquire(repo, 'other', variant('deployment', null));
      assert.ok(other !== null, 'another resource is held apart');
      await other.release();

      const state = await storage.locks.getState(repo, 'resource');
      assert.deepEqual(state?.operation, variant('deployment', null));
      assert.equal(await storage.locks.isHolderAlive(state!.holder), true);

      await held.release();
      assert.equal(await storage.locks.getState(repo, 'resource'), null);
      const again = await storage.locks.acquire(repo, 'resource', variant('deployment', null));
      assert.ok(again !== null, 'a released resource is taken again');
      await again.release();
    });

    it('lets shared holders share a resource, holding it against an exclusive one until the last has released, each once', async (t) => {
      const { storage, repo } = await setup(t);
      const first = await storage.locks.acquire(repo, 'resource', variant('dataflow', null), { mode: 'shared' });
      const second = await storage.locks.acquire(repo, 'resource', variant('dataset_write', null), { mode: 'shared' });
      assert.ok(first !== null && second !== null);
      assert.equal(await storage.locks.acquire(repo, 'resource', variant('deployment', null)), null);

      // A holder that releases twice releases its own share alone.
      await first.release();
      await first.release();
      assert.equal(await storage.locks.acquire(repo, 'resource', variant('deployment', null)), null, 'the other share still holds it');

      await second.release();
      const exclusive = await storage.locks.acquire(repo, 'resource', variant('deployment', null));
      assert.ok(exclusive !== null);
      await exclusive.release();
    });

    it("reads back what the exclusive holder reports of its progress while it holds the resource, and nothing once it releases", async (t) => {
      const { storage, repo } = await setup(t);
      const held = await storage.locks.acquire(repo, 'resource', variant('deployment', null));
      assert.ok(held !== null);
      assert.equal(await storage.locks.getProgress(repo, 'resource'), null, 'nothing reported yet');

      await held.report(deploying(0));
      assert.deepEqual(await storage.locks.getProgress(repo, 'resource'), deploying(0));
      await held.report(deploying(2));
      assert.deepEqual(await storage.locks.getProgress(repo, 'resource'), deploying(2), 'each report replaces the last');
      assert.equal(await storage.locks.getProgress(repo, 'other'), null, 'another resource has its own');

      await held.release();
      assert.equal(await storage.locks.getProgress(repo, 'resource'), null, 'the progress goes with the lock');
      const again = await storage.locks.acquire(repo, 'resource', variant('deployment', null));
      assert.ok(again !== null);
      assert.equal(await storage.locks.getProgress(repo, 'resource'), null, 'a new holder has reported nothing');
      await again.release();
    });

    it("keeps nothing a shared holder reports: progress is the exclusive holder's", async (t) => {
      const { storage, repo } = await setup(t);
      const shared = await storage.locks.acquire(repo, 'resource', variant('dataflow', null), { mode: 'shared' });
      assert.ok(shared !== null);
      await shared.report(deploying(1));
      assert.equal(await storage.locks.getProgress(repo, 'resource'), null);
      await shared.release();
    });

    it('waits, when asked, for a resource its holder releases, and gives up once its time is up', async (t) => {
      const { storage, repo } = await setup(t);
      const held = await storage.locks.acquire(repo, 'resource', variant('deployment', null));
      assert.ok(held !== null);

      const started = Date.now();
      assert.equal(await storage.locks.acquire(repo, 'resource', variant('deployment', null), { wait: true, timeout: 300 }), null);
      assert.ok(Date.now() - started >= 250, 'it waited before it gave up');

      const waiting = storage.locks.acquire(repo, 'resource', variant('deployment', null), { wait: true, timeout: 10_000 });
      setTimeout(() => { void held.release(); }, 200);
      const taken = await waiting;
      assert.ok(taken !== null, 'the waiter takes the resource once it is released');
      await taken.release();
    });

    it("reads a workspace's lock by a workspace's name: a lock's resource no workspace can have is refused, even while it is held", async (t) => {
      const { storage, repo } = await setup(t);
      // What a run of main's dataflow holds
      const held = await storage.locks.acquire(repo, 'main#dataflow', variant('dataflow', null));
      assert.ok(held !== null);
      try {
        for (const name of ['main#dataflow', 'a#b', 'a~b']) {
          await assert.rejects(workspaceLockStatus(storage, repo, name), (err: unknown) => {
            assert.ok(err instanceof InvalidNameError, `${name}: ${String(err)}`);
            assert.equal(err.kind, 'workspace');
            assert.equal(err.value, name);
            return true;
          });
        }
        assert.equal(await workspaceLockStatus(storage, repo, 'main'), null, "main's dataflow lock is no lock of main's own");
      } finally {
        await held.release();
      }
    });

    it('refuses a resource whose name cannot be one path segment, naming it, before it takes or reads anything', async (t) => {
      const { storage, repo } = await setup(t);
      for (const resource of MALFORMED_NAMES['lock']) {
        const refused = nameRefusal('lock', resource);
        await assert.rejects(storage.locks.acquire(repo, resource, variant('deployment', null)), refused);
        await assert.rejects(storage.locks.acquire(repo, resource, variant('dataflow', null), { mode: 'shared' }), refused);
        await assert.rejects(storage.locks.getState(repo, resource), refused);
        await assert.rejects(storage.locks.getProgress(repo, resource), refused);
      }
    });
  });
}
