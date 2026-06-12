/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for workspace status — in particular crash detection: a task whose
 * latest execution is marked `running` but whose process is gone must be
 * reported as `stale-running` (and a live process as `in-progress`).
 *
 * These are the dataflow engine's recovery edge cases: a runner SIGKILLed
 * mid-task, an e3 host crash, or a reboot between `running` being written
 * and the task completing. Fast and deterministic — no real task processes,
 * just hand-written execution records against a deployed workspace.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { variant, East, IntegerType } from '@elaraai/east';
import e3 from '@elaraai/e3';
import type { ExecutionStatus } from '@elaraai/e3-types';
import { workspaceStatus } from './workspaceStatus.js';
import { packageImport, packageRead } from './packages.js';
import { workspaceCreate, workspaceDeploy } from './workspaces.js';
import { workspaceGetDatasetHash } from './trees.js';
import { workspaceGetTask } from './tasks.js';
import { inputsHash } from './executions.js';
import { getBootId, getPidStartTime } from './execution/processHelpers.js';
import { uuidv7 } from './uuid.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from './test-helpers.js';

const WS = 'status-ws';
const PKG = 'status-pkg';

describe('workspaceStatus crash detection', () => {
  let repoPath: string;
  let tempDir: string;
  let storage: StorageBackend;
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
    });
    await storage.refs.executionWrite(repoPath, taskHash, inHash, executionId, status);
    return executionId;
  };

  before(async () => {
    repoPath = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repoPath));

    // Build + deploy a one-task package
    const input = e3.input('x', IntegerType, 10n);
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
    for (const inputPath of task.inputs) {
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
    const result = await workspaceStatus(storage, repoPath, WS);
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

  it('status cost does not scale with execution history (one listing per task)', async () => {
    // Regression guard for the O(history) N+1: checkInProgress previously did
    // executionListForTask + executionGetLatest per historical inputsHash,
    // making a status request O(tasks x history) backend round trips — on
    // remote backends (DynamoDB) this turned long-lived repos' status pages
    // into multi-minute requests. It must now be one listing call per task,
    // with no per-history lookups.
    const bootId = await getBootId();

    // Seed history: completed executions for 50 distinct past input combos
    for (let i = 0; i < 50; i++) {
      const executionId = uuidv7();
      const status: ExecutionStatus = variant('failed', {
        executionId,
        inputHashes: [],
        startedAt: new Date(),
        completedAt: new Date(),
        exitCode: 1n,
      });
      await storage.refs.executionWrite(repoPath, taskHash, `${'0'.repeat(60)}${String(i).padStart(4, '0')}`, executionId, status);
    }

    // Count ref-store round trips during one status request
    const counts: Record<string, number> = {};
    const refs = storage.refs;
    const countingRefs = new Proxy(refs, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          counts[String(prop)] = (counts[String(prop)] ?? 0) + 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const countingStorage = { ...storage, refs: countingRefs } as StorageBackend;

    await workspaceStatus(countingStorage, repoPath, WS);

    assert.equal(counts['executionListLatest'] ?? 0, 1, 'one latest-listing per task');
    assert.ok(
      (counts['executionGetLatest'] ?? 0) <= 1,
      `per-history lookups crept back in: executionGetLatest called ${counts['executionGetLatest']} times`
    );
    assert.equal(counts['executionListForTask'] ?? 0, 0, 'status no longer lists history without statuses');
  });
});
