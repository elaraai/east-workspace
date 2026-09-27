/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The records a local repository keeps.
 *
 * Every file a repository holds is an East value in beast2 of the type its
 * path says, but a log, which is its runner's own text, and an object, which
 * is named by its hash. A workspace's records go with it when it is removed.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import {
  ArrayType, East, IntegerType, StringType, StructType, decodeBeast2For, encodeBeast2For, isTypeValueEqual, none,
  readBeast2Type, toEastTypeValue, variant, type EastType,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import {
  DataflowExecutionStateType, DataflowRunType, DatasetRefType, ExecutionOwnerType, ExecutionStatusType,
  LockStateType, UNIT_PLAN_KIND, WorkspaceRecordType, encodeUnitPlan,
} from '@elaraai/e3-types';
import { datasetAdoptFile } from './dataset-adopt.js';
import { LocalOrchestrator } from './dataflow/orchestrator/LocalOrchestrator.js';
import { FileStateStore } from './dataflow/state-store/FileStateStore.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import { getBootId } from './execution/processHelpers.js';
import { packageImport } from './packages.js';
import { recordMutate } from './records.js';
import { repoGc } from './storage/local/gc.js';
import { LocalStorage } from './storage/local/index.js';
import { RepositoryRecordType } from './storage/local/repository.js';
import { workspaceCreate, workspaceDeploy, workspaceRemove } from './workspaces.js';
import { createTempDir, createTestRepo, deadPid, removeTempDir, removeTestRepo } from './test-helpers.js';
import type { StorageBackend } from './storage/interfaces.js';

/** Each record a repository keeps: what it is, where, and its East type. */
const RECORDS: ReadonlyArray<readonly [name: string, path: RegExp, type: EastType]> = [
  ['the repository record', /^repository\.beast2$/, RepositoryRecordType],
  ['a package ref', /^packages\/[^/]+\/[^/]+\.beast2$/, StringType],
  ['a workspace record', /^workspaces\/[^/]+\.beast2$/, WorkspaceRecordType],
  ['a workspace\'s execution state', /^workspaces\/[^/]+\/execution\.beast2$/, DataflowExecutionStateType],
  ['a dataset ref', /^workspaces\/[^/]+\/data\/.+\.beast2$/, StructType({ revision: StringType, ref: DatasetRefType })],
  ['a run record', /^dataflows\/[^/]+\/[0-9a-f-]{36}\.beast2$/, DataflowRunType],
  ['a plan pointer', /^executions\/[0-9a-f]{64}\/[0-9a-f]{64}\/plan\.beast2$/, StringType],
  ['an execution status', /^executions\/[0-9a-f]{64}\/[0-9a-f]{64}\/[0-9a-f-]{36}\/status\.beast2$/, ExecutionStatusType],
  ['an execution owner', /^executions\/[0-9a-f]{64}\/[0-9a-f]{64}\/[0-9a-f-]{36}\/owner\.beast2$/, ExecutionOwnerType],
  ['an adoption memo entry', /^adoptions\/[0-9a-f]{2}\/[0-9a-f]{62}\.beast2$/, StringType],
  ['an exclusive lock', /^locks\/[^/]+\/exclusive\.beast2$/, LockStateType],
  ['a shared lock', /^locks\/[^/]+\/shared\.\d+\.[0-9a-f]+\.beast2$/, LockStateType],
];

describe('the repository\'s records', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;

  // A deploy, a transfer, a run and a mutation, each through the store's own
  // doors, so every record kind is written as e3 writes it.
  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    // reposDir = the repository's parent, so gc's repository scans resolve.
    storage = new LocalStorage(dirname(repo));

    const rows = e3.input('rows', ArrayType(IntegerType));
    const total = e3.task('total', [rows], East.function([ArrayType(IntegerType)], IntegerType, ($, rows) =>
      rows.reduce(($, sum, row) => sum.add(row), 0n)));
    const counter = e3.record('counter', IntegerType, 0n);
    const increment = e3.mutation.reduce('increment', counter,
      East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by)));
    const zip = join(tempDir, 'layout.zip');
    await e3.export(e3.package('layout', '1.0.0', rows, total, counter, increment), zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, 'main');
    await workspaceDeploy(storage, repo, 'main', 'layout', '1.0.0');

    // A transfer's commit adopts its delivery: the input's ref, and the memo
    // of the manifest the delivery became.
    const delivery = join(tempDir, 'rows.beast2');
    writeFileSync(delivery, encodeBeast2For(ArrayType(IntegerType))([1n, 2n, 3n]));
    await datasetAdoptFile(storage, repo, 'main', [variant('field', 'inputs'), variant('field', 'rows')], delivery);

    const orchestrator = new LocalOrchestrator(new FileStateStore(join(repo, 'workspaces')));
    const run = await orchestrator.wait(await orchestrator.start(storage, repo, 'main'));
    assert.ok(run.success, 'the run succeeds');

    const mutated = await recordMutate(storage, new LocalTaskRunner(repo), repo, 'main', 'counter', 'increment',
      [encodeBeast2For(IntegerType)(5n)], { actor: 'cli:test' });
    assert.equal(mutated.kind, 'committed', JSON.stringify(mutated));
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  it('holds nothing but East values in beast2 of the types their paths say, a log and an object aside', async () => {
    // An undeployed workspace beside the deployed one, a split task's plan
    // mid-stage, and a lock of each kind, held across a gc.
    await workspaceCreate(storage, repo, 'idle');
    const [execution] = await storage.refs.executionList(repo);
    assert.ok(execution !== undefined, 'the run recorded an execution');
    const plan = await storage.objects.write(repo, encodeUnitPlan({
      kind: UNIT_PLAN_KIND, task: execution.taskHash, inputs: execution.inputsHash, stage: variant('pieces', []), previous: none, peakBytes: none,
    }));
    await storage.refs.executionPlanWrite(repo, execution.taskHash, execution.inputsHash, plan);
    const exclusive = await storage.locks.acquire(repo, 'main', variant('export', null));
    const shared = await storage.locks.acquire(repo, 'idle', variant('dataset_write', null), { mode: 'shared' });
    assert.ok(exclusive !== null && shared !== null, 'the locks are free');

    const found = new Set<string>();
    try {
      await repoGc(storage, repo, { minAge: 0 });

      const files = readdirSync(repo, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(repo, join(entry.parentPath, entry.name)).split(sep).join('/'));
      for (const file of files) {
        // A cache of built environments, and working space.
        if (/^(envs|tmp)\//.test(file)) continue;
        const object = /^objects\/([0-9a-f]{2})\/([0-9a-f]{62})\.beast2$/.exec(file);
        if (object !== null) {
          const hash = createHash('sha256').update(readFileSync(join(repo, file))).digest('hex');
          assert.equal(hash, `${object[1]}${object[2]}`, `${file} is not named by its hash`);
          found.add('an object');
          continue;
        }
        if (/^executions\/[0-9a-f]{64}\/[0-9a-f]{64}\/[0-9a-f-]{36}\/std(out|err)\.txt$/.test(file)) continue;

        const record = RECORDS.find(([, path]) => path.test(file));
        assert.ok(record !== undefined, `${file} is no record the layout names`);
        const [name, , type] = record;
        const data = readFileSync(join(repo, file));
        assert.ok(isTypeValueEqual(readBeast2Type(data), toEastTypeValue(type)), `${file} is not ${name}: its header names another type`);
        decodeBeast2For(type)(data);
        found.add(name);
      }
    } finally {
      await exclusive.release();
      await shared.release();
    }
    assert.deepEqual(
      [...RECORDS.map(([name]) => name), 'an object'].filter((name) => !found.has(name)), [],
      'the repository held a file of every kind',
    );
  });

  it('starts a workspace created under a removed one\'s name with none of its execution state, runs or locks', async () => {
    // A run and a dataset write that exited holding their locks, and a write
    // that holds one still.
    const stale = encodeBeast2For(LockStateType)({
      operation: variant('dataflow', null),
      holder: variant('process', { pid: BigInt(deadPid()), bootId: await getBootId(), startTime: 1n, command: 'a crashed run' }),
      acquiredAt: new Date(),
      expiresAt: none,
    });
    for (const resource of ['main#dataflow', 'main~data~inputs~2frows']) {
      mkdirSync(join(repo, 'locks', resource), { recursive: true });
      writeFileSync(join(repo, 'locks', resource, 'exclusive.beast2'), stale);
    }
    const live = await storage.locks.acquire(repo, 'main~data~records~2fcounter', variant('dataset_write', null));
    assert.ok(live !== null, 'the lock is free');

    const states = new FileStateStore(join(repo, 'workspaces'));
    try {
      assert.notEqual(await states.readLatest(repo, 'main'), null, 'the workspace ran');
      assert.equal((await storage.refs.dataflowRunList(repo, 'main')).length, 1);

      await workspaceRemove(storage, repo, 'main');
      await workspaceCreate(storage, repo, 'main');

      assert.equal(await states.readLatest(repo, 'main'), null, 'no execution state');
      assert.deepEqual(await storage.refs.dataflowRunList(repo, 'main'), [], 'no runs');
      assert.deepEqual(readdirSync(join(repo, 'locks')), ['main~data~records~2fcounter'], 'no locks but the one a live process holds');
    } finally {
      await live.release();
    }
  });
});
