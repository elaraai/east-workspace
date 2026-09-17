/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Concurrency regression tests for LocalRefStore execution status.
 *
 * A single execution rewrites executions/<task>/<inputs>/<id>/status.beast2
 * several times over its lifetime (running → success/failed). The dataflow
 * orchestrator does this while a workspace-status poll concurrently reads the
 * same file via executionGet. A non-atomic overwrite truncates the file to 0
 * bytes mid-write, which the reader decodes as "Data too short for Beast2
 * format: 0 bytes" → ExecutionCorruptError → API "internal" — the macOS CI
 * flake in the "dataflowStart triggers execution (non-blocking)" suite.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { variant, some, none } from '@elaraai/east';
import type { ExecutionStatus, DataflowRun } from '@elaraai/e3-types';
import { LocalRefStore } from './LocalRefStore.js';
import { createTestRepo, removeTestRepo } from '../../test-helpers.js';

describe('LocalRefStore execution status (concurrent read/write)', () => {
  let repo: string;
  beforeEach(() => { repo = createTestRepo(); });
  afterEach(() => { removeTestRepo(repo); });

  const taskHash = 'a'.repeat(64);
  const inputsHash = 'b'.repeat(64);
  const executionId = '0190a0b0-0000-7000-8000-000000000000';

  // Thousands of input hashes so the encoded status spans many write() chunks:
  // this is what turns a non-atomic overwrite into an observable truncation
  // window. A bare fs.writeFile makes the read-side throw reliably here.
  const bigInputs = Array.from({ length: 3000 }, (_, i) => i.toString(16).padStart(64, '0'));

  // variant() is constructed inline (not via a shared helper) so the East
  // diagnostics don't read these as authoring-time macros.
  const running: ExecutionStatus = variant('running', {
    executionId,
    inputHashes: bigInputs,
    startedAt: new Date(0),
    pid: 1234n,
    pidStartTime: 5678n,
    bootId: 'boot-id',
  });
  const success: ExecutionStatus = variant('success', {
    executionId,
    inputHashes: bigInputs,
    outputHash: 'c'.repeat(64),
    startedAt: new Date(0),
    completedAt: new Date(1000),
  });

  it('executionGet never tears while executionWrite overwrites status in place', async () => {
    const store = new LocalRefStore();
    await store.executionWrite(repo, taskHash, inputsHash, executionId, running); // seed

    let stop = false;
    const reader = (async () => {
      const errors: string[] = [];
      while (!stop) {
        try {
          const s = await store.executionGet(repo, taskHash, inputsHash, executionId);
          assert.ok(s !== null, 'the seeded status is always present');
        } catch (err) {
          errors.push((err as Error).message);
        }
        // Yield: a tight read loop would hold the file open ~continuously and on
        // Windows starve the writer's rename (EPERM). A real status poll is periodic.
        await new Promise((r) => setTimeout(r, 1));
      }
      return errors;
    })();

    try {
      for (let i = 0; i < 250; i++) {
        await store.executionWrite(repo, taskHash, inputsHash, executionId, i % 2 === 0 ? success : running);
      }
    } finally {
      stop = true; // always release the reader, even if a write throws, or it spins forever
    }

    const errors = await reader;
    assert.deepStrictEqual(errors, [], `executionGet must never observe a torn write; saw: ${errors.slice(0, 3).join(' | ')}`);
  });
});

describe('LocalRefStore dataflow run (concurrent read/write)', () => {
  let repo: string;
  beforeEach(() => { repo = createTestRepo(); });
  afterEach(() => { removeTestRepo(repo); });

  const workspace = 'main';
  const runId = '0190a0b0-1111-7000-8000-000000000000';

  // A large inputVersions map so the encoded run spans many write() chunks — the
  // same widening that makes a non-atomic overwrite tear a concurrent read.
  // dataflowRunGet decodes Beast2 with no corruption wrapper, so a torn read
  // would surface a raw "Data too short for Beast2 format" error here.
  const bigVersions = new Map<string, string>(
    Array.from({ length: 3000 }, (_, i) => [`inputs/p${i}`, i.toString(16).padStart(64, '0')] as const)
  );
  const summary = { total: 0n, completed: 0n, cached: 0n, failed: 0n, skipped: 0n, reexecuted: 0n };

  const runningRun: DataflowRun = {
    runId,
    workspaceName: workspace,
    packageRef: 'pkg@1.0.0',
    startedAt: new Date(0),
    completedAt: none,
    status: variant('running', {}),
    inputVersions: bigVersions,
    outputVersions: none,
    taskExecutions: new Map(),
    summary,
  };
  const completedRun: DataflowRun = {
    ...runningRun,
    completedAt: some(new Date(1000)),
    status: variant('completed', {}),
    outputVersions: some(bigVersions),
  };

  it('dataflowRunGet never tears while dataflowRunWrite overwrites the run in place', async () => {
    const store = new LocalRefStore();
    await store.dataflowRunWrite(repo, workspace, runningRun); // seed

    let stop = false;
    const reader = (async () => {
      const errors: string[] = [];
      while (!stop) {
        try {
          const run = await store.dataflowRunGet(repo, workspace, runId);
          assert.ok(run !== null, 'the seeded run is always present');
        } catch (err) {
          errors.push((err as Error).message);
        }
        // Yield: a tight read loop would hold the file open ~continuously and on
        // Windows starve the writer's rename (EPERM). A real status poll is periodic.
        await new Promise((r) => setTimeout(r, 1));
      }
      return errors;
    })();

    try {
      for (let i = 0; i < 250; i++) {
        await store.dataflowRunWrite(repo, workspace, i % 2 === 0 ? completedRun : runningRun);
      }
    } finally {
      stop = true; // always release the reader, even if a write throws, or it spins forever
    }

    const errors = await reader;
    assert.deepStrictEqual(errors, [], `dataflowRunGet must never observe a torn write; saw: ${errors.slice(0, 3).join(' | ')}`);
  });
});

describe('LocalRefStore execution sidecars (#770)', () => {
  let repo: string;
  beforeEach(() => { repo = createTestRepo(); });
  afterEach(() => { removeTestRepo(repo); });

  const taskHash = 'a'.repeat(64);
  const inputsHash = 'b'.repeat(64);
  const executionId = '0190a0b0-2222-7000-8000-000000000000';

  it('round-trips the owner as JSON beside the execution status', async () => {
    const store = new LocalRefStore();
    assert.strictEqual(await store.executionOwnerRead(repo, taskHash, inputsHash, executionId), null);

    const owner = { pid: 4242, pidStartTime: 987654, bootId: 'boot-1' };
    await store.executionOwnerWrite(repo, taskHash, inputsHash, executionId, owner);
    assert.deepStrictEqual(await store.executionOwnerRead(repo, taskHash, inputsHash, executionId), owner);
    const text = await fs.readFile(join(repo, 'executions', taskHash, inputsHash, executionId, 'owner'), 'utf-8');
    assert.deepStrictEqual(JSON.parse(text), owner);
  });

  it('treats an owner sidecar that does not parse as unrecorded', async () => {
    const store = new LocalRefStore();
    const dir = join(repo, 'executions', taskHash, inputsHash, executionId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, 'owner'), '{"pid":"4242","pidStartTime":1,"bootId":"b"}\n');
    assert.strictEqual(await store.executionOwnerRead(repo, taskHash, inputsHash, executionId), null);
    await fs.writeFile(join(dir, 'owner'), 'not json');
    assert.strictEqual(await store.executionOwnerRead(repo, taskHash, inputsHash, executionId), null);
  });

  it('points the inputs directory at a plan object without disturbing the execution listings', async () => {
    const store = new LocalRefStore();
    assert.strictEqual(await store.executionPlanRead(repo, taskHash, inputsHash), null);

    const running: ExecutionStatus = variant('running', {
      executionId,
      inputHashes: [],
      startedAt: new Date(0),
      pid: 1234n,
      pidStartTime: 5678n,
      bootId: 'boot-id',
    });
    await store.executionWrite(repo, taskHash, inputsHash, executionId, running);
    await store.executionOwnerWrite(repo, taskHash, inputsHash, executionId, { pid: 1, pidStartTime: 2, bootId: 'boot-id' });
    await store.executionPlanWrite(repo, taskHash, inputsHash, 'c'.repeat(64));

    assert.strictEqual(await store.executionPlanRead(repo, taskHash, inputsHash), 'c'.repeat(64));
    assert.strictEqual(await fs.readFile(join(repo, 'executions', taskHash, inputsHash, 'plan'), 'utf-8'), 'c'.repeat(64) + '\n');
    // Neither sidecar reads as an execution.
    assert.deepStrictEqual(await store.executionListIds(repo, taskHash, inputsHash), [executionId]);
    assert.deepStrictEqual(await store.executionListForTask(repo, taskHash), [inputsHash]);
    assert.strictEqual((await store.executionGetLatest(repo, taskHash, inputsHash))?.type, 'running');

    // A later plan replaces the pointer.
    await store.executionPlanWrite(repo, taskHash, inputsHash, 'd'.repeat(64));
    assert.strictEqual(await store.executionPlanRead(repo, taskHash, inputsHash), 'd'.repeat(64));
  });
});

describe('LocalRefStore packageList', () => {
  let repo: string;
  beforeEach(() => { repo = createTestRepo(); });
  afterEach(() => { removeTestRepo(repo); });

  it('ignores atomic-write .partial staging siblings (no phantom versions)', async () => {
    const store = new LocalRefStore();
    await store.packageWrite(repo, 'pkg', '1.0.0', 'a'.repeat(64));

    // Simulate a crash-orphaned staging file left next to the version ref.
    const nameDir = join(repo, 'packages', 'pkg');
    await fs.writeFile(join(nameDir, '1.0.0.abc12345.partial'), 'b'.repeat(64) + '\n');

    const pkgs = await store.packageList(repo);
    assert.deepStrictEqual(pkgs, [{ name: 'pkg', version: '1.0.0' }], 'the .partial sibling must not surface as a phantom version');
  });
});
