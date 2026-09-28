/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The workspace status's contract: what it reports of a task over any backend,
 * asking the runner whether an execution recorded running can still finish.
 */

import { describe, it, before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { East, IntegerType, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { inputsHash } from '../executions.js';
import { MockTaskRunner } from '../execution/MockTaskRunner.js';
import { packageImport, packageRead } from '../packages.js';
import { workspaceGetTask } from '../tasks.js';
import { workspaceGetDatasetHash } from '../trees.js';
import { uuidv7 } from '../uuid.js';
import { workspaceCreate, workspaceDeploy } from '../workspaces.js';
import { workspaceStatus } from '../workspaceStatus.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { BackendSetup } from './setup.js';

const WS = 'status-ws';

/**
 * Registers the workspace status's contract suite over a backend.
 *
 * @remarks
 * Every case goes through the storage interfaces, and a mock runner says
 * whether an execution recorded running can still finish, so a backend runs it
 * over its own stores by giving its own setup. Whether a backend's own runner
 * answers truly is that runner's suite's.
 *
 * @param setup - Makes a fresh backend and a repository in it for each test
 */
export function workspaceStatusTests(setup: BackendSetup): void {
  describe('the workspace status', () => {
    let dir: string;
    let zip: string;

    before(async () => {
      dir = mkdtempSync(join(tmpdir(), 'e3-contract-'));
      zip = join(dir, 'status-pkg.zip');
      await e3.export(e3.package('status-pkg', '1.0.0', e3.task(
        'double',
        [e3.input('x', IntegerType, variant('value', 10n))],
        East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)),
      )), zip);
    });

    after(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    /** A workspace the package is deployed to, and its one task: its hash, and
     *  the hash of its current inputs. */
    const deployed = async (t: TestContext): Promise<{ storage: StorageBackend; repo: string; taskHash: string; inHash: string }> => {
      const { storage, repo } = await setup(t);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, WS);
      await workspaceDeploy(storage, repo, WS, 'status-pkg', '1.0.0');
      const taskHash = (await packageRead(storage, repo, 'status-pkg', '1.0.0')).tasks.get('double')!;
      const hashes: string[] = [];
      for (const { path } of (await workspaceGetTask(storage, repo, WS, 'double')).inputs) {
        hashes.push((await workspaceGetDatasetHash(storage, repo, WS, path)).hash!);
      }
      return { storage, repo, taskHash, inHash: inputsHash(hashes) };
    };

    it('reports a task in progress while the runner says its execution can still finish, and stale once it cannot', async (t) => {
      const { storage, repo, taskHash, inHash } = await deployed(t);
      const executionId = uuidv7();
      await storage.refs.executionWrite(repo, taskHash, inHash, executionId, variant('running', {
        executionId, inputHashes: [], startedAt: new Date(), pid: 4242n, pidStartTime: 1n, bootId: 'boot-id', unit: false,
      }));
      const runner = new MockTaskRunner();
      const asked: string[] = [];
      runner.setExecutionAlive((running) => {
        asked.push(running.executionId);
        return true;
      });

      const running = (await workspaceStatus(storage, runner, repo, WS)).tasks.find((task) => task.name === 'double');
      assert.equal(running?.status.type, 'in-progress');
      assert.ok(running?.status.type === 'in-progress' && running.status.pid === 4242);
      assert.deepEqual(asked, [executionId], 'the runner was asked of the execution recorded running');

      runner.setExecutionAlive(false);
      const stale = (await workspaceStatus(storage, runner, repo, WS)).tasks.find((task) => task.name === 'double');
      assert.equal(stale?.status.type, 'stale-running');
    });

    it('reads a unit of a split task running as no run of the task', async (t) => {
      const { storage, repo, taskHash, inHash } = await deployed(t);
      const failed = uuidv7();
      await storage.refs.executionWrite(repo, taskHash, inHash, failed, variant('failed', {
        executionId: failed, inputHashes: [], startedAt: new Date(), completedAt: new Date(), exitCode: 1n, peakBytes: none, unit: false,
      }));
      // A unit is recorded under its task's hash, over its piece's inputs, and
      // the runner says it can still finish.
      const unit = uuidv7();
      await storage.refs.executionWrite(repo, taskHash, 'e'.repeat(64), unit, variant('running', {
        executionId: unit, inputHashes: [], startedAt: new Date(), pid: 4242n, pidStartTime: 1n, bootId: 'boot-id', unit: true,
      }));
      const runner = new MockTaskRunner();
      runner.setExecutionAlive(true);

      const task = (await workspaceStatus(storage, runner, repo, WS)).tasks.find((each) => each.name === 'double');
      assert.equal(task?.status.type, 'failed');
    });

    it('names the peak memory of the execution a task\'s status comes from', async (t) => {
      const { storage, repo, taskHash, inHash } = await deployed(t);
      const executionId = uuidv7();
      await storage.refs.executionWrite(repo, taskHash, inHash, executionId, variant('failed', {
        executionId, inputHashes: [], startedAt: new Date(), completedAt: new Date(), exitCode: 1n, peakBytes: some(48n * 1024n ** 2n), unit: false,
      }));

      const task = (await workspaceStatus(storage, new MockTaskRunner(), repo, WS)).tasks.find((each) => each.name === 'double');
      assert.equal(task?.status.type, 'failed');
      assert.equal(task?.peakBytes, 48 * 1024 ** 2);
    });

    it('costs one listing of a task\'s executions, however long its history', async (t) => {
      // A status request made O(tasks × history) round trips when it listed a
      // task's executions and then read each one's latest: on a remote backend,
      // minutes for a long-lived repository.
      const { storage, repo, taskHash } = await deployed(t);
      for (let i = 0; i < 50; i++) {
        const executionId = uuidv7();
        await storage.refs.executionWrite(repo, taskHash, `${'0'.repeat(60)}${String(i).padStart(4, '0')}`, executionId, variant('failed', {
          executionId, inputHashes: [], startedAt: new Date(), completedAt: new Date(), exitCode: 1n, peakBytes: none, unit: false,
        }));
      }
      const counts: Record<string, number> = {};
      const countingRefs = new Proxy(storage.refs, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            counts[String(prop)] = (counts[String(prop)] ?? 0) + 1;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
      const counting: StorageBackend = {
        upgrades: storage.upgrades,
        objects: storage.objects,
        refs: countingRefs,
        locks: storage.locks,
        logs: storage.logs,
        repos: storage.repos,
        datasets: storage.datasets,
        validateRepository: (r) => storage.validateRepository(r),
      };

      await workspaceStatus(counting, new MockTaskRunner(), repo, WS);

      assert.equal(counts['executionListLatest'] ?? 0, 1, 'one latest-listing per task');
      assert.ok((counts['executionGetLatest'] ?? 0) <= 1,
        `per-history lookups crept back in: executionGetLatest called ${counts['executionGetLatest']} times`);
      assert.equal(counts['executionListForTask'] ?? 0, 0, 'status lists no history without statuses');
    });
  });
}
