/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeBeast2For, encodeBeast2For, none, variant } from '@elaraai/east';
import { repoGc } from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import { PackageObjectType, WorkspaceStateType, type DataflowRun } from '@elaraai/e3-types';
import { getDataflowExecution, startDataflow } from './dataflow.js';
import { getActiveExecution, getOrchestrator, getStateStore } from '../orchestrator-manager.js';
import { ResponseType, DataflowExecutionStateType, type DataflowExecutionState } from '../types.js';

const WS = 'finishing-ws';

/** Seeds `repo` with a workspace deployed from a package with no tasks: its dataflow finishes as soon as it starts. */
async function seedWorkspace(storage: InMemoryStorage, repo: string): Promise<void> {
  await storage.repos.create(repo);
  const packageHash = await storage.objects.write(repo, encodeBeast2For(PackageObjectType)({
    tasks: new Map(),
    data: { structure: variant('struct', new Map()), refs: new Map() },
    functions: new Map(),
    records: new Map(), sources: new Map(),
  }));
  await storage.refs.workspaceWrite(repo, WS, encodeBeast2For(WorkspaceStateType)({
    packageName: 'empty', packageVersion: '1.0.0', packageHash, deployedAt: new Date(0), currentRunId: none,
  }));
}

/** What a client polling the workspace's run is told. */
async function poll(repo: string): Promise<DataflowExecutionState> {
  const response = await getDataflowExecution(repo, WS);
  const body = decodeBeast2For(ResponseType(DataflowExecutionStateType))(new Uint8Array(await response.arrayBuffer())) as
    { type: string; value: DataflowExecutionState };
  assert.equal(body.type, 'success');
  return body.value;
}

describe('getDataflowExecution', () => {
  it('reads a run as running until it has let go of the workspace, so a client acting on completed finds the workspace free', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'e3-dataflow-finishing-'));
    try {
      const storage = new InMemoryStorage();
      await seedWorkspace(storage, repo);
      // Hold the run where its record is already terminal but it still holds
      // the workspace: its final run record is written in between. (Its first
      // record takes a while, so the run has a duration to report.)
      let open!: () => void;
      const gate = new Promise<void>((resolve) => { open = resolve; });
      let arrive!: () => void;
      const held = new Promise<void>((resolve) => { arrive = resolve; });
      const writeRun = storage.refs.dataflowRunWrite.bind(storage.refs);
      storage.refs.dataflowRunWrite = async (r: string, ws: string, run: DataflowRun) => {
        if (run.status.type === 'running') {
          await new Promise((resolve) => setTimeout(resolve, 20));
        } else {
          arrive();
          await gate;
        }
        return writeRun(r, ws, run);
      };

      const started = await startDataflow(storage, repo, WS, { jobs: 1, force: false });
      assert.equal(started.status, 202);
      await held;

      // The run's record says completed while the run still holds the
      // workspace: a gc now is refused. The poll says running.
      assert.equal((await getStateStore(repo).readLatest(repo, WS))?.status, 'completed');
      await assert.rejects(repoGc(storage, repo, { dryRun: true }), /a dataflow is running in workspace 'finishing-ws'/);
      const during = await poll(repo);
      assert.equal(during.status.type, 'running');
      assert.equal(during.summary.type, 'none');
      assert.equal(during.completedAt.type, 'none');

      // The run lets go: the poll says completed, with the run's own duration,
      // and the workspace is free.
      open();
      let after = await poll(repo);
      for (let i = 0; i < 100 && after.status.type === 'running'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        after = await poll(repo);
      }
      assert.equal(after.status.type, 'completed');
      assert.equal(after.completedAt.type, 'some');
      assert.equal(after.summary.type, 'some');
      if (after.completedAt.type !== 'some' || after.summary.type !== 'some') return;
      assert.ok(after.summary.value.duration >= 10, `a run that took 20 ms reports ${after.summary.value.duration} ms`);
      assert.equal(after.summary.value.duration, Date.parse(after.completedAt.value) - Date.parse(after.startedAt));
      await repoGc(storage, repo, { dryRun: true });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('a run that has let go clears only its own active execution — a run started after it still reads as running while it holds the workspace', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'e3-dataflow-successor-'));
    try {
      const storage = new InMemoryStorage();
      await seedWorkspace(storage, repo);
      // The second run holds the workspace at its final run record until the
      // test lets it go.
      let terminal = 0;
      let arrive!: () => void;
      const holding = new Promise<void>((resolve) => { arrive = resolve; });
      let finishSecond!: () => void;
      const secondGate = new Promise<void>((resolve) => { finishSecond = resolve; });
      const writeRun = storage.refs.dataflowRunWrite.bind(storage.refs);
      storage.refs.dataflowRunWrite = async (r: string, ws: string, run: DataflowRun) => {
        if (run.status.type !== 'running' && ++terminal === 2) {
          arrive();
          await secondGate;
        }
        return writeRun(r, ws, run);
      };
      // The first run's completion handler is held back past its letting go
      // of the workspace — long enough for the next run to start.
      const orchestrator = getOrchestrator(repo);
      const wait = orchestrator.wait.bind(orchestrator);
      let calls = 0;
      let letGo!: () => void;
      const firstLetGo = new Promise<void>((resolve) => { letGo = resolve; });
      let releaseFirst!: () => void;
      const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve; });
      orchestrator.wait = async (handle) => {
        const n = ++calls;
        const result = await wait(handle);
        if (n === 1) {
          letGo();
          await firstHeld;
        }
        return result;
      };

      assert.equal((await startDataflow(storage, repo, WS, { jobs: 1, force: false })).status, 202);
      await firstLetGo;
      assert.equal((await startDataflow(storage, repo, WS, { jobs: 1, force: false })).status, 202);
      const second = getActiveExecution(repo, WS)?.id;
      assert.notEqual(second, undefined);
      await holding;

      // The first run's handler runs now: the second run is the workspace's
      // active execution, holding it, and reads as running.
      releaseFirst();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(getActiveExecution(repo, WS)?.id, second);
      assert.equal((await poll(repo)).status.type, 'running');

      finishSecond();
      let after = await poll(repo);
      for (let i = 0; i < 100 && after.status.type === 'running'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        after = await poll(repo);
      }
      assert.equal(after.status.type, 'completed');
      assert.equal(getActiveExecution(repo, WS), null);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
