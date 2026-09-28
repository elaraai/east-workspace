/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The history gc keeps, end to end on real runners: what is left is what the
 * cache serves from. Which runs and executions a prune keeps, and what goes
 * with one it does not, is gc's contract, which every backend runs
 * (`contract/gc.ts`).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DictType, IntegerType, SortedMap, compareFor, decodeBeast2For, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { PackageObjectType, decodeUnitPlan } from '@elaraai/e3-types';
import { repoGc } from './gc.js';
import { LocalStorage } from './storage/local/index.js';
import { dataflowExecute } from './dataflow.js';
import { inputsHash } from './executions.js';
import { packageImport } from './packages.js';
import { workspaceSetDataset } from './trees.js';
import { workspaceCreate, workspaceDeploy, workspaceGetPackage } from './workspaces.js';
import { createTempDir, createTestRepo, removeTempDir, removeTestRepo } from './test-helpers.js';
import type { StorageBackend } from './storage/interfaces.js';

describe('bounded history, end to end', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  let pieceBytes: string | undefined;

  beforeEach(() => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage();
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
