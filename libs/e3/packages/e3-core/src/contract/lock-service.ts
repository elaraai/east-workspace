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
import type { BackendSetup } from './setup.js';

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
  });
}
