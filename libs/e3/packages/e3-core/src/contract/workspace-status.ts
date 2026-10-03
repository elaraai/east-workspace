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
import { East, IntegerType, encodeBeast2For, equalFor, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { StopReasonType, type StopReason, type TreePath } from '@elaraai/e3-types';
import { inputsHash } from '../executions.js';
import { MockTaskRunner } from '../execution/MockTaskRunner.js';
import { packageRead } from '../packages.js';
import { packageImport } from '../package-files.js';
import { workspaceGetTask } from '../tasks.js';
import { workspaceGetDatasetHash } from '../trees.js';
import { uuidv7 } from '../uuid.js';
import { workspaceCreate } from '../workspaces.js';
import { workspaceDeploy } from '../workspace-files.js';
import { workspaceStatus } from '../workspaceStatus.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { BackendSetup } from './setup.js';

const WS = 'status-ws';

/** A path of field names. */
const at = (...fields: string[]): TreePath => fields.map((field) => variant('field', field));

/**
 * The backend, with a ref store that records every call made of it, by name,
 * with its arguments.
 */
function recordingRefs(storage: StorageBackend): { storage: StorageBackend; calls: { name: string; args: unknown[] }[] } {
  const calls: { name: string; args: unknown[] }[] = [];
  const refs = new Proxy(storage.refs, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls.push({ name: String(prop), args });
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return {
    storage: {
      upgrades: storage.upgrades,
      objects: storage.objects,
      refs,
      locks: storage.locks,
      logs: storage.logs,
      repos: storage.repos,
      datasets: storage.datasets,
      runStates: (r) => storage.runStates(r),
      validateRepository: (r) => storage.validateRepository(r),
    },
    calls,
  };
}

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
    let chainZip: string;
    let filterZip: string;

    before(async () => {
      dir = mkdtempSync(join(tmpdir(), 'e3-contract-'));
      zip = join(dir, 'status-pkg.zip');
      await e3.export(e3.package('status-pkg', '1.0.0', e3.task(
        'double',
        [e3.input('x', IntegerType, variant('value', 10n))],
        East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)),
      )), zip);
      // A task over another's output.
      chainZip = join(dir, 'status-chain.zip');
      const first = e3.task('first', [e3.input('y', IntegerType, variant('value', 3n))], East.function([IntegerType], IntegerType, ($, y) => y.add(1n)));
      const second = e3.task('second', [first.output], East.function([IntegerType], IntegerType, ($, z) => z.multiply(3n)));
      await e3.export(e3.package('status-chain', '1.0.0', second), chainZip);
      // The chain, a third task on it, and a task beside it.
      filterZip = join(dir, 'status-filter.zip');
      await e3.export(e3.package('status-filter', '1.0.0',
        e3.task('third', [second.output], East.function([IntegerType], IntegerType, ($, z) => z.add(5n))),
        e3.task('other', [e3.input('z', IntegerType, variant('value', 7n))], East.function([IntegerType], IntegerType, ($, z) => z.negate()))), filterZip);
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

      // A host's own reason says it cannot finish, as `false` does.
      runner.setExecutionAlive(() => ({ kind: variant('host', 'OutOfMemoryError'), message: 'its container ran out of memory' }));
      const stopped = (await workspaceStatus(storage, runner, repo, WS)).tasks.find((task) => task.name === 'double');
      assert.equal(stopped?.status.type, 'stale-running');
    });

    it('reads ready a task whose latest attempt over its inputs was cancelled or interrupted, naming why it stopped', async (t) => {
      const { storage, repo, taskHash, inHash } = await deployed(t);
      const runner = new MockTaskRunner();
      const equal = equalFor(StopReasonType);
      const own = { inputHashes: [], startedAt: new Date(), completedAt: new Date(), unit: false };
      const aborted: StopReason = { kind: variant('aborted', null), message: 'cancelled: e3 stopped the runner because the run was aborted' };
      const cancelled = uuidv7();
      await storage.refs.executionWrite(repo, taskHash, inHash, cancelled, variant('cancelled', { ...own, executionId: cancelled, reason: aborted }));
      let task = (await workspaceStatus(storage, runner, repo, WS)).tasks.find((each) => each.name === 'double');
      assert.equal(task?.status.type, 'ready');
      assert.ok(task?.stopped !== null && task?.stopped !== undefined && equal(task.stopped, aborted), 'it names why its attempt stopped');

      const yielded: StopReason = { kind: variant('yielded', null), message: 'interrupted: the run yielded mid-stage' };
      const interrupted = uuidv7();
      await storage.refs.executionWrite(repo, taskHash, inHash, interrupted, variant('interrupted', { ...own, executionId: interrupted, pid: 0n, reason: yielded }));
      task = (await workspaceStatus(storage, runner, repo, WS)).tasks.find((each) => each.name === 'double');
      assert.equal(task?.status.type, 'ready');
      assert.ok(task?.stopped !== null && task?.stopped !== undefined && equal(task.stopped, yielded), 'the latest attempt\'s, interrupted');

      const failed = uuidv7();
      await storage.refs.executionWrite(repo, taskHash, inHash, failed, variant('failed', { ...own, executionId: failed, exitCode: 1n, peakBytes: none }));
      task = (await workspaceStatus(storage, runner, repo, WS)).tasks.find((each) => each.name === 'double');
      assert.equal(task?.status.type, 'failed');
      assert.equal(task?.stopped, null, 'an attempt that failed did not stop');
    });

    it('names no stopped attempt of a task that waits for a stale one upstream', async (t) => {
      const { storage, repo } = await setup(t);
      await packageImport(storage, repo, chainZip);
      await workspaceCreate(storage, repo, WS);
      await workspaceDeploy(storage, repo, WS, 'status-chain', '1.0.0');
      // The first task's output is set, and nothing ran it over its input, so
      // it is stale; the second's attempt over that output was cancelled.
      const output = await storage.objects.write(repo, encodeBeast2For(IntegerType)(4n));
      await storage.datasets.write(repo, WS, 'tasks/first/output', variant('value', { hash: output, versions: new Map() }));
      const second = (await packageRead(storage, repo, 'status-chain', '1.0.0')).tasks.get('second')!;
      const cancelled = uuidv7();
      await storage.refs.executionWrite(repo, second, inputsHash([output]), cancelled, variant('cancelled', {
        executionId: cancelled, inputHashes: [output], startedAt: new Date(), completedAt: new Date(), unit: false,
        reason: { kind: variant('aborted', null), message: 'cancelled' },
      }));

      const tasks = (await workspaceStatus(storage, new MockTaskRunner(), repo, WS)).tasks;
      assert.equal(tasks.find((each) => each.name === 'first')?.status.type, 'ready');
      const waiting = tasks.find((each) => each.name === 'second');
      assert.equal(waiting?.status.type, 'waiting');
      assert.equal(waiting?.stopped, null, 'it reads waiting for the task upstream, not ready for its stopped attempt');
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
      const { storage: counting, calls } = recordingRefs(storage);
      const count = (name: string): number => calls.filter((call) => call.name === name).length;

      await workspaceStatus(counting, new MockTaskRunner(), repo, WS);

      assert.equal(count('executionListLatest'), 1, 'one latest-listing per task');
      assert.ok(count('executionGetLatest') <= 1,
        `per-history lookups crept back in: executionGetLatest called ${count('executionGetLatest')} times`);
      assert.equal(count('executionListForTask'), 0, 'status lists no history without statuses');
    });

    /** A workspace the filter package is deployed to, in which `first`'s
     *  output is set and nothing ran it: `first` is stale, and `second`, over
     *  its output, waits for it. */
    const filtered = async (t: TestContext): Promise<{ storage: StorageBackend; repo: string; tasks: ReadonlyMap<string, string> }> => {
      const { storage, repo } = await setup(t);
      await packageImport(storage, repo, filterZip);
      await workspaceCreate(storage, repo, WS);
      await workspaceDeploy(storage, repo, WS, 'status-filter', '1.0.0');
      const output = await storage.objects.write(repo, encodeBeast2For(IntegerType)(4n));
      await storage.datasets.write(repo, WS, 'tasks/first/output', variant('value', { hash: output, versions: new Map() }));
      return { storage, repo, tasks: (await packageRead(storage, repo, 'status-filter', '1.0.0')).tasks };
    };

    it('answers the datasets it is asked for, and the tasks that produce them, as the whole workspace\'s answer does', async (t) => {
      const { storage, repo } = await filtered(t);
      const runner = new MockTaskRunner();
      const whole = await workspaceStatus(storage, runner, repo, WS);
      // Two outputs and an input, and a path no dataset has, and a tree.
      const asked = await workspaceStatus(storage, runner, repo, WS, {
        paths: [at('tasks', 'second', 'output'), at('inputs', 'y'), at('tasks', 'first', 'output'), at('inputs', 'nope'), at('tasks')],
      });

      const named = ['.inputs.y', '.tasks.first.output', '.tasks.second.output'];
      assert.deepEqual(asked.datasets, whole.datasets.filter((dataset) => named.includes(dataset.path)),
        'the datasets named that the workspace has, each as the whole answer gives it');
      assert.deepEqual(asked.tasks, whole.tasks.filter((task) => task.name === 'first' || task.name === 'second'),
        'the tasks producing them, each as the whole answer gives it');
      assert.deepEqual(asked.datasets.map((dataset) => [dataset.path, dataset.status.type]),
        [['.inputs.y', 'up-to-date'], ['.tasks.first.output', 'stale'], ['.tasks.second.output', 'unset']]);
      assert.deepEqual(asked.tasks.map((task) => [task.name, task.status.type]), [['first', 'ready'], ['second', 'waiting']]);
      assert.deepEqual(asked.summary, {
        datasets: { total: 3, unset: 1, stale: 1, upToDate: 1 },
        tasks: { total: 2, upToDate: 0, ready: 1, waiting: 1, inProgress: 0, failed: 0, error: 0, staleRunning: 0 },
      });
      assert.equal(asked.lock, whole.lock);
    });

    it('reads the executions of the tasks producing what it is asked for, and of their upstream, and of no other', async (t) => {
      const { storage, repo, tasks } = await filtered(t);
      const { storage: recording, calls } = recordingRefs(storage);

      const asked = await workspaceStatus(recording, new MockTaskRunner(), repo, WS, { paths: [at('tasks', 'second', 'output')] });
      assert.deepEqual(asked.tasks.map((task) => [task.name, task.status.type]), [['second', 'waiting']],
        'second waits for first, whose staleness was read');

      const read = new Set(calls.filter((call) => call.name.startsWith('execution')).map((call) => call.args[1]));
      assert.deepEqual(read, new Set([tasks.get('first'), tasks.get('second')]),
        'the producer\'s executions and its upstream\'s, and neither third\'s nor other\'s');
    });
  });
}
