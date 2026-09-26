/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The history gc keeps: which runs and executions survive a prune, what goes
 * with an execution that does not, and — end to end, on real runners — that
 * what is left is what the cache serves from.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DictType, IntegerType, SortedMap, compareFor, decodeBeast2For, encodeBeast2For, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { PackageObjectType, UNIT_PLAN_KIND, WorkspaceRecordType, decodeUnitPlan, encodeUnitPlan } from '@elaraai/e3-types';
import { pruneHistory } from './history.js';
import { repoGc } from './gc.js';
import { LocalStorage } from './index.js';
import { objectWrite } from './LocalObjectStore.js';
import { dataflowExecute } from '../../dataflow.js';
import { inputsHash } from '../../executions.js';
import { packageImport } from '../../packages.js';
import { workspaceSetDataset } from '../../trees.js';
import { workspaceCreate, workspaceDeploy, workspaceGetPackage } from '../../workspaces.js';
import { createTempDir, createTestRepo, removeTempDir, removeTestRepo } from '../../test-helpers.js';
import type { StorageBackend } from '../interfaces.js';

const DAY = 24 * 60 * 60 * 1000;

/** A UUIDv7 minted at `ms`, the `n`th of that moment: an id of a given age. */
function idAt(ms: number, n: number): string {
  const time = ms.toString(16).padStart(12, '0');
  return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-${n.toString(16).padStart(12, '0')}`;
}

describe('the history gc keeps', () => {
  let repo: string;
  let storage: StorageBackend;
  const now = Date.now();
  const old = now - 30 * DAY;
  const summary = { total: 0n, completed: 0n, cached: 0n, failed: 0n, skipped: 0n, reexecuted: 0n };

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage(dirname(repo));
  });

  afterEach(() => {
    removeTestRepo(repo);
  });

  it('keeps each workspace\'s last runs, its recent ones and the run its state came from', async () => {
    const pkg = await storage.objects.write(repo, encodeBeast2For(PackageObjectType)({
      tasks: new Map(), data: { structure: variant('struct', new Map()), refs: new Map() },
      functions: new Map(), records: new Map(), sources: new Map(),
    }));
    const [current, second, third, latest] = [idAt(now - 30 * DAY, 1), idAt(now - 20 * DAY, 2), idAt(now - 10 * DAY, 3), idAt(now - 60_000, 4)];
    await storage.refs.workspaceWrite(repo, 'main', encodeBeast2For(WorkspaceRecordType)(some({
      packageName: 'history', packageVersion: '1.0.0', packageHash: pkg, deployedAt: new Date(now), currentRunId: some(current),
    })));
    for (const runId of [current, second, third, latest]) {
      await storage.refs.dataflowRunWrite(repo, 'main', {
        runId, workspaceName: 'main', packageRef: 'history@1.0.0', startedAt: new Date(now), completedAt: none,
        status: variant('completed', {}), inputVersions: new Map(), outputVersions: none, taskExecutions: new Map(), summary,
      });
    }

    const result = await pruneHistory(storage, repo, { keepRuns: 1, keepDays: 7, dryRun: false }, now);
    assert.equal(result.deletedRuns, 2);
    assert.deepEqual(await storage.refs.dataflowRunList(repo, 'main'), [current, latest]);
  });

  it('keeps what a kept run used and what is recent or running, with each kept task\'s latest attempt, and deletes the rest with its owner and logs', async () => {
    const task = 'a'.repeat(64);
    const [ran, failedSince, gone, recent, running] = [idAt(old, 1), idAt(old + 1, 2), idAt(old, 3), idAt(now - 60_000, 4), idAt(old, 5)];
    const [kept, dropped, recently, stillRunning] = ['1', '2', '3', '4'].map((c) => c.repeat(64));
    // A success a kept run used, and a failure after it, the latest.
    await storage.refs.executionWrite(repo, task, kept, ran, variant('success', {
      executionId: ran, inputHashes: [], outputHash: 'e'.repeat(64), startedAt: new Date(old), completedAt: new Date(old), peakBytes: none, plan: none,
    }));
    await storage.refs.executionWrite(repo, task, kept, failedSince, variant('failed', {
      executionId: failedSince, inputHashes: [], startedAt: new Date(old), completedAt: new Date(old), exitCode: 1n, peakBytes: none,
    }));
    // A success only a deleted run used, with its owner and logs.
    await storage.refs.executionWrite(repo, task, dropped, gone, variant('success', {
      executionId: gone, inputHashes: [], outputHash: 'f'.repeat(64), startedAt: new Date(old), completedAt: new Date(old), peakBytes: none, plan: none,
    }));
    await storage.refs.executionOwnerWrite(repo, task, dropped, gone, { pid: 1n, pidStartTime: 1n, bootId: 'boot-id' });
    await storage.logs.append(repo, task, dropped, gone, 'stdout', 'what it printed\n');
    // A recent failure, and an old record still running.
    await storage.refs.executionWrite(repo, task, recently, recent, variant('failed', {
      executionId: recent, inputHashes: [], startedAt: new Date(now), completedAt: new Date(now), exitCode: 1n, peakBytes: none,
    }));
    await storage.refs.executionWrite(repo, task, stillRunning, running, variant('running', {
      executionId: running, inputHashes: [], startedAt: new Date(old), pid: 1n, pidStartTime: 1n, bootId: 'boot-id',
    }));
    // The kept run, the workspace's latest, used the first; an older one the second.
    await storage.refs.workspaceWrite(repo, 'main', encodeBeast2For(WorkspaceRecordType)(none));
    for (const [runId, executionId, inputs] of [[idAt(old, 6), gone, dropped], [idAt(old, 7), ran, kept]] as const) {
      await storage.refs.dataflowRunWrite(repo, 'main', {
        runId, workspaceName: 'main', packageRef: 'history@1.0.0', startedAt: new Date(old), completedAt: none,
        status: variant('completed', {}), inputVersions: new Map(), outputVersions: none, summary,
        taskExecutions: new Map([['t', { executionId, taskHash: task, inputsHash: inputs, cached: false, outputVersions: new Map(), executionCount: 1n }]]),
      });
    }

    const result = await pruneHistory(storage, repo, { keepRuns: 1, keepDays: 7, dryRun: false }, now);
    assert.deepEqual([result.deletedRuns, result.deletedExecutions], [1, 1]);
    assert.deepEqual(await storage.refs.executionListIds(repo, task, kept), [ran, failedSince], 'the latest attempt stays beside the one the run used');
    assert.deepEqual(await storage.refs.executionListIds(repo, task, recently), [recent]);
    assert.deepEqual(await storage.refs.executionListIds(repo, task, stillRunning), [running]);
    assert.equal(await storage.refs.executionGet(repo, task, dropped, gone), null);
    assert.equal(await storage.refs.executionOwnerRead(repo, task, dropped, gone), null);
    assert.equal((await storage.logs.read(repo, task, dropped, gone, 'stdout')).data, '');
    assert.ok(!existsSync(join(repo, 'executions', task, dropped)), 'nothing of it is left');
    assert.ok(result.roots.has('e'.repeat(64)) && !result.roots.has('f'.repeat(64)), 'what is kept roots its output; what goes does not');
  });

  it('keeps the units a split task\'s success names through its plans, and those of an execution that can resume', async () => {
    const split = 'b'.repeat(64);
    const [inputs, resumable, abandoned] = ['c', 'd', 'e'].map((c) => c.repeat(64));
    const [x1, x2, o1, o2, y1, z1] = ['5', '6', '7', '8', '9', '0'].map((c) => c.repeat(64));
    const pieces = await objectWrite(repo, encodeUnitPlan({
      kind: UNIT_PLAN_KIND, task: split, inputs, stage: variant('pieces', [[x1], [x2]]), previous: none,
    }));
    const merge = await objectWrite(repo, encodeUnitPlan({
      kind: UNIT_PLAN_KIND, task: split, inputs, stage: variant('merge', { level: 1n, levels: 1n, groups: [{ range: none, entries: [o1, o2] }] }),
      previous: some(pieces),
    }));
    const [resumes, abandons] = await Promise.all([[resumable, y1], [abandoned, z1]].map(([over, piece]) => objectWrite(repo, encodeUnitPlan({
      kind: UNIT_PLAN_KIND, task: split, inputs: over!, stage: variant('pieces', [[piece!]]), previous: none,
    }))));
    // The task's success, which a kept run used, names the merge level's plan.
    const succeeded = idAt(old, 1);
    await storage.refs.executionWrite(repo, split, inputs, succeeded, variant('success', {
      executionId: succeeded, inputHashes: [], outputHash: 'e'.repeat(64), startedAt: new Date(old), completedAt: new Date(old), peakBytes: none,
      plan: some(merge),
    }));
    await storage.refs.dataflowRunWrite(repo, 'main', {
      runId: idAt(old, 2), workspaceName: 'main', packageRef: 'history@1.0.0', startedAt: new Date(old), completedAt: none,
      status: variant('completed', {}), inputVersions: new Map(), outputVersions: none, summary,
      taskExecutions: new Map([['split', { executionId: succeeded, taskHash: split, inputsHash: inputs, cached: false, outputVersions: new Map(), executionCount: 1n }]]),
    });
    await storage.refs.workspaceWrite(repo, 'main', encodeBeast2For(WorkspaceRecordType)(none));
    // Two executions interrupted mid-task: one recent, one long ago.
    for (const [over, interrupted, plan] of [[resumable, idAt(now - 60_000, 3), resumes], [abandoned, idAt(old, 4), abandons]] as const) {
      await storage.refs.executionWrite(repo, split, over, interrupted, variant('interrupted', {
        executionId: interrupted, inputHashes: [], startedAt: new Date(old), completedAt: new Date(old), pid: 1n,
      }));
      await storage.refs.executionPlanWrite(repo, split, over, plan);
    }
    // Each unit's success, long ago, and a unit of nothing kept.
    const units = [inputsHash([x1]), inputsHash([x2]), inputsHash(['merge', o1, o2]), inputsHash([y1])];
    const unkept = inputsHash([z1]);
    for (const [n, unit] of [...units, unkept].entries()) {
      const id = idAt(old, 10 + n);
      await storage.refs.executionWrite(repo, split, unit, id, variant('success', {
        executionId: id, inputHashes: [], outputHash: 'f'.repeat(64), startedAt: new Date(old), completedAt: new Date(old), peakBytes: none, plan: none,
      }));
    }

    const result = await pruneHistory(storage, repo, { keepRuns: 1, keepDays: 7, dryRun: false }, now);
    for (const unit of units) assert.equal((await storage.refs.executionListIds(repo, split, unit)).length, 1, `unit ${unit} is kept`);
    assert.deepEqual(await storage.refs.executionListIds(repo, split, unkept), []);
    assert.equal(await storage.refs.executionPlanRead(repo, split, resumable), resumes, 'the recent execution can still resume');
    assert.equal(await storage.refs.executionPlanRead(repo, split, abandoned), null);
    assert.deepEqual(await storage.refs.executionListIds(repo, split, abandoned), []);
    assert.equal(result.deletedExecutions, 2, 'the abandoned execution, and its unit');
    assert.ok(result.roots.has(merge) && result.roots.has(resumes) && !result.roots.has(abandons));
  });

  it('decides the same in a dry run, and deletes nothing, marking as if it had', async () => {
    const task = 'a'.repeat(64);
    const inputs = '1'.repeat(64);
    const gone = idAt(old, 1);
    // The output only the execution keeps, as an object.
    const output = await objectWrite(repo, encodeBeast2For(IntegerType)(42n));
    await storage.refs.executionWrite(repo, task, inputs, gone, variant('success', {
      executionId: gone, inputHashes: [], outputHash: output, startedAt: new Date(old), completedAt: new Date(old), peakBytes: none, plan: none,
    }));

    const dry = await repoGc(storage, repo, { minAge: 0, keepDays: 7, dryRun: true });
    assert.deepEqual([dry.deletedExecutions, dry.deletedObjects], [1, 1], 'the output goes with the execution');
    assert.deepEqual(await storage.refs.executionListIds(repo, task, inputs), [gone]);
    assert.ok(await storage.objects.exists(repo, output));

    const real = await repoGc(storage, repo, { minAge: 0, keepDays: 7 });
    assert.deepEqual([real.deletedExecutions, real.deletedObjects], [1, 1]);
    assert.deepEqual(await storage.refs.executionListIds(repo, task, inputs), []);
    assert.ok(!(await storage.objects.exists(repo, output)));
  });

  it('refuses a history it cannot count', async () => {
    await assert.rejects(repoGc(storage, repo, { keepRuns: -1 }), {
      name: 'RangeError', message: 'gc: keepRuns must be a whole number of zero or more, got -1',
    });
    await assert.rejects(repoGc(storage, repo, { keepDays: 1.5 }), {
      name: 'RangeError', message: 'gc: keepDays must be a whole number of zero or more, got 1.5',
    });
  });
});

describe('bounded history, end to end', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  let pieceBytes: string | undefined;

  beforeEach(() => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    pieceBytes = process.env.E3_TEST_PIECE_BYTES;
    // Pieces of 16 to 256 stored bytes: a piece a segment.
    process.env.E3_TEST_PIECE_BYTES = '64';
  });

  afterEach(() => {
    if (pieceBytes === undefined) delete process.env.E3_TEST_PIECE_BYTES;
    else process.env.E3_TEST_PIECE_BYTES = pieceBytes;
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  it('keeps what the last run used and the current state is served from: a re-run is cached, and an append re-runs only the pieces it touched', async () => {
    const rows = e3.input('rows', DictType(IntegerType, IntegerType), variant('value', new SortedMap(
      Array.from({ length: 4000 }, (_, i) => [BigInt(i), BigInt(i)] as [bigint, bigint]), compareFor(IntegerType))));
    const total = e3.streamTask('total', {
      inputs: [e3.partition(rows)],
      output: e3.output.fold(IntegerType, { zero: 0n, combine: (_$, a, b) => a.add(b) }),
    }, ($, rows, emit) => {
      $.for(rows, ($, value) => {
        $(emit(value));
      });
    });
    const zip = join(tempDir, 'history.zip');
    await e3.export(e3.package('history', '1.0.0', rows, total), zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, 'main');
    await workspaceDeploy(storage, repo, 'main', 'history', '1.0.0');
    const deployed = decodeBeast2For(PackageObjectType)(await storage.objects.read(repo, (await workspaceGetPackage(storage, repo, 'main')).hash));
    const totalHash = deployed.tasks.get('total')!;

    /** Every attempt the repository records. */
    const attempts = async (): Promise<{ taskHash: string; inputs: string; id: string }[]> =>
      (await Promise.all((await storage.refs.executionList(repo)).map(async ({ taskHash, inputsHash: inputs }) =>
        (await storage.refs.executionListIds(repo, taskHash, inputs)).map((id) => ({ taskHash, inputs, id }))))).flat();

    // Two runs, the second forced: each unit and the task run twice.
    const first = await dataflowExecute(storage, repo, 'main', {});
    const second = await dataflowExecute(storage, repo, 'main', { force: true });
    assert.ok(first.success && second.success);
    const recorded = (await attempts()).length;

    const gc = await repoGc(storage, repo, { keepRuns: 1, keepDays: 0 });
    assert.equal(gc.deletedRuns, 1);
    assert.deepEqual(await storage.refs.dataflowRunList(repo, 'main'), [second.runId]);
    const left = await attempts();
    assert.equal(gc.deletedExecutions, recorded / 2, 'the first run\'s attempts went, the task\'s and each unit\'s');
    assert.equal(left.length, recorded / 2, 'and the last run\'s are kept');

    const rerun = await dataflowExecute(storage, repo, 'main', {});
    assert.deepEqual([rerun.cached, rerun.executed], [1, 0], 'the re-run is served from the cache');

    // An append re-runs only the pieces it touched, and the merge after them.
    const kept = new Set(left.map(({ id }) => id));
    await workspaceSetDataset(storage, repo, 'main', [variant('field', 'inputs'), variant('field', 'rows')], new SortedMap(
      Array.from({ length: 4001 }, (_, i) => [BigInt(i), BigInt(i)] as [bigint, bigint]), compareFor(IntegerType)), DictType(IntegerType, IntegerType));
    const appended = await dataflowExecute(storage, repo, 'main', {});
    assert.equal(appended.executed, 1);
    const rowsRef = await storage.datasets.read(repo, 'main', 'inputs/rows');
    assert.ok(rowsRef?.type === 'value');
    const own = inputsHash([rowsRef.value.hash]);
    const ran = [];
    for (const attempt of (await attempts()).filter(({ id }) => !kept.has(id))) {
      const status = await storage.refs.executionGet(repo, attempt.taskHash, attempt.inputs, attempt.id);
      if (attempt.taskHash === totalHash && attempt.inputs !== own && status?.value.inputHashes[0] !== 'merge') ran.push(attempt);
    }
    const success = await storage.refs.executionGetLatest(repo, totalHash, own);
    assert.ok(success?.type === 'success' && success.value.plan.type === 'some');
    let plan = decodeUnitPlan(await storage.objects.read(repo, success.value.plan.value));
    while (plan.previous.type === 'some') plan = decodeUnitPlan(await storage.objects.read(repo, plan.previous.value));
    assert.ok(plan.stage.type === 'pieces' && plan.stage.value.length > 4, 'the input is cut into many pieces');
    assert.ok(ran.length >= 1 && ran.length <= 2, `the append re-ran ${ran.length} of ${plan.stage.value.length} pieces`);
  });
});
