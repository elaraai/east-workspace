/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The workspace status over e3-core's own backends: its contract, over a local
 * repository and the in-memory backend with a mock runner; and the local
 * runner's own answer, crash detection. A task whose latest execution is
 * recorded `running` reads `in-progress` while its runner process, or the
 * orchestrator recorded as its owner, is alive, and `stale-running` once
 * neither is.
 *
 * These are the dataflow engine's recovery edge cases: a runner SIGKILLed
 * mid-task, an e3 host crash, or a reboot between `running` being written
 * and the task completing. Fast and deterministic — no real task processes,
 * just hand-written execution records against a deployed workspace.
 */

import { describe, it, before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { variant, East, IntegerType } from '@elaraai/east';
import e3 from '@elaraai/e3';
import type { ExecutionStatus, TreePath } from '@elaraai/e3-types';
import { workspaceStatusTests } from './contract/index.js';
import { workspaceStatus } from './workspaceStatus.js';
import { packageRead } from './packages.js';
import { packageImport } from './package-files.js';
import { workspaceCreate } from './workspaces.js';
import { workspaceDeploy } from './workspace-files.js';
import { workspaceGetDatasetHash } from './trees.js';
import { workspaceGetTask } from './tasks.js';
import { inputsHash } from './executions.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import { MockTaskRunner } from './execution/MockTaskRunner.js';
import { OBJECT_CONCURRENCY } from './concurrency.js';
import { getBootId, getPidStartTime, processOwner } from './execution/processHelpers.js';
import { uuidv7 } from './uuid.js';
import { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir, deadPid } from './test-helpers.js';

describe('over a local repository', () => {
  workspaceStatusTests(async (t) => {
    const repo = createTestRepo();
    t.after(() => removeTestRepo(repo));
    return { storage: new LocalStorage(), repo };
  });
});

describe('over the in-memory backend', () => {
  workspaceStatusTests(async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create('repo');
    return { storage, repo: 'repo' };
  });
});

describe('workspaceStatus\'s reads', () => {
  // One after another, a backend whose reads are requests pays its latency
  // once per object; all at once, a wide workspace's poll floods it.

  /** A workspace the package of `items` is deployed to, over the in-memory
   *  backend. */
  const deployedWith = async (t: TestContext, items: Parameters<typeof e3.package>[2][]): Promise<InMemoryStorage> => {
    const dir = createTempDir();
    t.after(() => removeTempDir(dir));
    const zip = join(dir, 'wide.zip');
    await e3.export(e3.package('wide', '1.0.0', ...items), zip);
    const storage = new InMemoryStorage();
    await storage.repos.create('repo');
    await packageImport(storage, 'repo', zip);
    await workspaceCreate(storage, 'repo', 'ws');
    await workspaceDeploy(storage, 'repo', 'ws', 'wide', '1.0.0');
    return storage;
  };

  /** Watches a method of `target`: how many calls of it were made, and the
   *  most in flight at once. */
  const peakOf = (target: object, method: string): { calls: number; peak: number } => {
    const original = (target as Record<string, (...args: unknown[]) => Promise<unknown>>)[method]!.bind(target);
    const seen = { calls: 0, peak: 0 };
    let inFlight = 0;
    (target as Record<string, unknown>)[method] = async (...args: unknown[]) => {
      seen.calls++;
      inFlight++;
      seen.peak = Math.max(seen.peak, inFlight);
      try {
        return await original(...args);
      } finally {
        inFlight--;
      }
    };
    return seen;
  };

  it('read the task objects and the tasks\' statuses a few at a time, never more than 16 at once', async (t) => {
    const seed = e3.input('seed', IntegerType, variant('value', 1n));
    const storage = await deployedWith(t, Array.from({ length: 40 }, (_, i) =>
      e3.task(`t${i}`, [seed], East.function([IntegerType], IntegerType, ($, x) => x.add(1n)))));
    const objects = peakOf(storage.objects, 'read');
    const statuses = peakOf(storage.refs, 'executionListRunning');

    const status = await workspaceStatus(storage, new MockTaskRunner(), 'repo', 'ws');
    assert.equal(status.tasks.length, 40);
    for (const [name, { peak }] of [['task objects', objects], ['tasks\' statuses', statuses]] as const) {
      assert.ok(peak > 1 && peak <= OBJECT_CONCURRENCY, `${name}: ${peak} at once`);
    }
  });

  it('read a whole workspace\'s dataset refs in one call, and named datasets\' a few at a time, never more than 16 at once', async (t) => {
    // One task beside forty inputs: what reads refs side by side is the
    // datasets' own pass.
    const inputs = Array.from({ length: 40 }, (_, i) => e3.input(`in${i}`, IntegerType, variant('value', 0n)));
    const storage = await deployedWith(t, [...inputs,
      e3.task('one', [inputs[0]!], East.function([IntegerType], IntegerType, ($, x) => x.add(1n)))]);
    const wholes = peakOf(storage.datasets, 'readAll');
    const refs = peakOf(storage.datasets, 'read');

    const status = await workspaceStatus(storage, new MockTaskRunner(), 'repo', 'ws');
    assert.equal(status.datasets.length, 41);
    assert.deepEqual([wholes.calls, refs.calls], [1, 0], 'the whole workspace\'s refs, in one call');

    const paths: TreePath[] = Array.from({ length: 40 }, (_, i) => [variant('field', 'inputs'), variant('field', `in${i}`)]);
    const named = await workspaceStatus(storage, new MockTaskRunner(), 'repo', 'ws', { paths });
    assert.equal(named.datasets.length, 40);
    assert.deepEqual([wholes.calls, refs.calls], [1, 40], 'the named datasets\' refs, each once');
    assert.ok(refs.peak > 1 && refs.peak <= OBJECT_CONCURRENCY, `dataset refs: ${refs.peak} at once`);
  });
});

const WS = 'status-ws';
const PKG = 'status-pkg';

describe('workspaceStatus crash detection, on the local runner', () => {
  let repoPath: string;
  let tempDir: string;
  let storage: StorageBackend;
  let runner: LocalTaskRunner;
  let taskHash: string;
  let inHash: string;

  /** Write a `running` execution record for the deployed task's current inputs. */
  const writeRunning = async (pid: number, pidStartTime: number, bootId: string): Promise<string> => {
    const executionId = uuidv7();
    const status: ExecutionStatus = variant('running', {
      executionId,
      inputHashes: [],
      startedAt: new Date(),
      pid: BigInt(pid),
      pidStartTime: BigInt(pidStartTime),
      bootId,
      unit: false,
    });
    await storage.refs.executionWrite(repoPath, taskHash, inHash, executionId, status);
    return executionId;
  };

  before(async () => {
    repoPath = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage();
    runner = new LocalTaskRunner(repoPath);

    // Build + deploy a one-task package
    const input = e3.input('x', IntegerType, variant('value', 10n));
    const double = e3.task(
      'double',
      [input],
      East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n))
    );
    const pkg = e3.package(PKG, '1.0.0', double);
    const zipPath = join(tempDir, 'status-pkg.zip');
    await e3.export(pkg, zipPath);
    await packageImport(storage, repoPath, zipPath);
    await workspaceCreate(storage, repoPath, WS);
    await workspaceDeploy(storage, repoPath, WS, PKG, '1.0.0');

    // Resolve the task's identity: hash + current inputs hash
    const pkgObject = await packageRead(storage, repoPath, PKG, '1.0.0');
    taskHash = pkgObject.tasks.get('double')!;
    const task = await workspaceGetTask(storage, repoPath, WS, 'double');
    const hashes: string[] = [];
    for (const { path: inputPath } of task.inputs) {
      const { hash } = await workspaceGetDatasetHash(storage, repoPath, WS, inputPath);
      hashes.push(hash!);
    }
    inHash = inputsHash(hashes);
  });

  after(() => {
    removeTestRepo(repoPath);
    removeTempDir(tempDir);
  });

  const taskStatus = async () => {
    const result = await workspaceStatus(storage, runner, repoPath, WS);
    const task = result.tasks.find((t) => t.name === 'double');
    assert.ok(task, 'task missing from status');
    return task.status;
  };

  it('reports stale-running when the recorded process is dead (same boot)', async () => {
    // A pid beyond any plausible live process, with a fabricated start time —
    // exactly what a record looks like after the runner was SIGKILLed.
    const bootId = await getBootId();
    await writeRunning(2 ** 22 + 12345, 1234567, bootId);

    const status = await taskStatus();
    assert.equal(status.type, 'stale-running', `expected stale-running, got ${status.type}`);
  });

  it('reports stale-running when the record is from a previous boot', async () => {
    // Same pid as THIS process (alive!) but a different boot id — the
    // "host rebooted mid-task" recovery case. Boot-id mismatch must win
    // over pid liveness.
    const currentBoot = await getBootId();
    if (currentBoot === 'unknown-boot-id') {
      // Platform can't determine boot ids — the boot-id path is inert here.
      return;
    }
    await writeRunning(process.pid, await getPidStartTime(process.pid) ?? 0, 'a-previous-boot-id');

    const status = await taskStatus();
    assert.equal(status.type, 'stale-running', `expected stale-running, got ${status.type}`);
  });

  it('reports in-progress while the recorded process is alive', async () => {
    // Use this very test process as the "runner": correct pid, start time,
    // and boot id — liveness must be recognised.
    const bootId = await getBootId();
    const pidStartTime = await getPidStartTime(process.pid);
    await writeRunning(process.pid, pidStartTime ?? 0, bootId);

    const status = await taskStatus();
    assert.equal(status.type, 'in-progress', `expected in-progress, got ${status.type}`);
  });

  it('reports in-progress while the owner recorded for it is alive, though its runner has exited', async () => {
    // The orchestrator outlives its runner between the runner's exit and the
    // record's write, where it hashes the output: the execution can still
    // finish, as the cache probe's repair judges it.
    const executionId = await writeRunning(deadPid(), 1, await getBootId());
    await storage.refs.executionOwnerWrite(repoPath, taskHash, inHash, executionId, await processOwner());

    const status = await taskStatus();
    assert.equal(status.type, 'in-progress', `expected in-progress, got ${status.type}`);
  });

  it('reports stale-running once its runner and its owner have both exited', async () => {
    const bootId = await getBootId();
    const executionId = await writeRunning(deadPid(), 1, bootId);
    await storage.refs.executionOwnerWrite(repoPath, taskHash, inHash, executionId, { pid: BigInt(deadPid()), pidStartTime: 1n, bootId });

    const status = await taskStatus();
    assert.equal(status.type, 'stale-running', `expected stale-running, got ${status.type}`);
  });
});
