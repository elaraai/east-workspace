/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The records a local repository keeps.
 *
 * Every file a repository holds is an East value in beast2 of the type its
 * path says, but a log, which is its runner's own text, and an object, which
 * is named by its hash. A workspace's records go with it when it is removed,
 * and a repository an older release wrote is upgraded in place, its records
 * keeping their states and histories.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  ArrayType, East, IntegerType, NullType, StringType, StructType, decodeBeast2For, encodeBeast2For, isTypeValueEqual, none,
  readBeast2Type, toEastTypeValue, variant, type EastType,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import {
  DataflowExecutionStateType, DataflowRunType, DatasetRefType, E3_RELEASE, ExecutionEventType, ExecutionOwnerType, ExecutionStatusType,
  LockStateType, RepoMetadataType, RepositoryRecordType, RepositoryUpgradeProgressType, UNIT_PLAN_KIND, WorkspaceRecordType,
  encodeUnitPlan,
} from '@elaraai/e3-types';
import { datasetAdoptFile } from './dataset-adopt-file.js';
import { LocalOrchestrator } from './execution/local-orchestrator.js';
import { FileStateStore } from './dataflow/state-store/FileStateStore.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import { getBootId } from './execution/processHelpers.js';
import { packageImport } from './package-files.js';
import { recordMutate } from './records.js';
import { repositoryOpen } from './repository-record.js';
import { repoGc } from './gc.js';
import { LocalStorage } from './storage/local/index.js';
import { LockProgressRecordType } from './storage/local/LocalLockService.js';
import { REPOSITORY_RECORD_FILE, encodeRepositoryRecord } from './storage/local/LocalRefStore.js';
import { LOCAL_REPOSITORY_UPGRADES } from './storage/local/upgrades.js';
import { workspaceCreate, workspaceRemove } from './workspaces.js';
import { workspaceDeploy } from './workspace-files.js';
import { createTempDir, createTestRepo, deadPid, removeTempDir, removeTestRepo } from './test-helpers.js';
import { uuidv7 } from './uuid.js';
import type { RepositoryUpgrade, StorageBackend } from './storage/interfaces.js';

/** Each record a repository keeps: what it is, where, and its East type. */
const RECORDS: ReadonlyArray<readonly [name: string, path: RegExp, type: EastType]> = [
  ['the repository record', /^repository\.beast2$/, RepositoryRecordType],
  ['the store upgrade under way', /^repository-upgrade\.beast2$/, RepositoryUpgradeProgressType],
  ['the repository\'s metadata', /^metadata\.beast2$/, RepoMetadataType],
  ['a package ref', /^packages\/[^/]+\/[^/]+\.beast2$/, StringType],
  ['a workspace record', /^workspaces\/[^/]+\.beast2$/, WorkspaceRecordType],
  ['a workspace\'s execution state', /^workspaces\/[^/]+\/execution\.beast2$/, DataflowExecutionStateType],
  ['a segment of a run\'s events', /^workspaces\/[^/]+\/execution-events\/[0-9a-f-]{36}\/\d{20}\.beast2$/, ArrayType(ExecutionEventType)],
  ['a dataset ref', /^workspaces\/[^/]+\/data\/.+\.beast2$/, StructType({ revision: StringType, ref: DatasetRefType })],
  ['a run record', /^dataflows\/[^/]+\/[0-9a-f-]{36}\.beast2$/, DataflowRunType],
  ['a plan pointer', /^executions\/[0-9a-f]{64}\/[0-9a-f]{64}\/plan\.beast2$/, StringType],
  ['an execution status', /^executions\/[0-9a-f]{64}\/[0-9a-f]{64}\/[0-9a-f-]{36}\/status\.beast2$/, ExecutionStatusType],
  ['an execution owner', /^executions\/[0-9a-f]{64}\/[0-9a-f]{64}\/[0-9a-f-]{36}\/owner\.beast2$/, ExecutionOwnerType],
  ['an attempt\'s place in the index of running attempts', /^running\/[0-9a-f]{64}\/[0-9a-f]{64}\.[0-9a-f-]{36}\.beast2$/, NullType],
  ['an adoption memo entry', /^adoptions\/[0-9a-f]{2}\/[0-9a-f]{62}\.beast2$/, StringType],
  ['an exclusive lock', /^locks\/[^/]+\/exclusive\.beast2$/, LockStateType],
  ['a shared lock', /^locks\/[^/]+\/shared\.\d+\.[0-9a-f]+\.beast2$/, LockStateType],
  ['a lock holder\'s progress report', /^locks\/[^/]+\/progress\.beast2$/, LockProgressRecordType],
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
    storage = new LocalStorage();

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

    // A transfer's commit adopts its delivery, taking it in on the runner: the
    // input's ref, and the memo of the manifest the delivery became.
    const delivery = join(tempDir, 'rows.beast2');
    writeFileSync(delivery, encodeBeast2For(ArrayType(IntegerType))([1n, 2n, 3n]));
    await datasetAdoptFile(storage, repo, 'main', [variant('field', 'inputs'), variant('field', 'rows')], delivery,
      { runner: new LocalTaskRunner(repo) });

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
    // mid-stage, a store upgrade under way, as a part of one leaves it, and a
    // lock of each kind, held across a gc: the exclusive one a deploy's, which
    // has said how far it has got.
    await workspaceCreate(storage, repo, 'idle');
    await storage.refs.repositoryUpgradeWrite(repo, { step: 'a-step', release: E3_RELEASE, cursor: 'here' });
    const [execution] = await storage.refs.executionList(repo);
    assert.ok(execution !== undefined, 'the run recorded an execution');
    // An attempt recorded running, which its task's index of running attempts
    // names.
    const runningId = uuidv7();
    await storage.refs.executionWrite(repo, execution.taskHash, 'f'.repeat(64), runningId, variant('running', {
      executionId: runningId, inputHashes: [], startedAt: new Date(), pid: BigInt(process.pid), pidStartTime: 0n, bootId: 'layout', unit: false,
    }));
    const plan = await storage.objects.write(repo, encodeUnitPlan({
      kind: UNIT_PLAN_KIND, task: execution.taskHash, inputs: execution.inputsHash, stage: variant('pieces', []), previous: none, peakBytes: none,
    }));
    await storage.refs.executionPlanWrite(repo, execution.taskHash, execution.inputsHash, plan);
    const exclusive = await storage.locks.acquire(repo, 'main', variant('deployment', null));
    const shared = await storage.locks.acquire(repo, 'idle', variant('dataset_write', null), { mode: 'shared' });
    assert.ok(exclusive !== null && shared !== null, 'the locks are free');
    await exclusive.report(variant('deployment', { package: { name: 'layout', version: '1.0.0' }, startedAt: new Date(), files: [], records: [] }));

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

  it('opens a repository an older release wrote, applying the layout step it has not had once, every record keeping its state and history', async () => {
    // The local layout's step this test registers: a package ref, which an
    // older layout kept as the hash in text, rewritten as the String this
    // layout keeps. A ref already in this form is left as it is. Only the
    // local backend reads its own files, so the step is its own.
    let applied = 0;
    const upgrade: RepositoryUpgrade = {
      name: 'package-refs-in-beast2',
      async apply(_storage, repoPath) {
        applied++;
        for (const name of readdirSync(join(repoPath, 'packages'))) {
          for (const file of readdirSync(join(repoPath, 'packages', name))) {
            if (file.endsWith('.beast2')) continue;
            const text = join(repoPath, 'packages', name, file);
            writeFileSync(`${text}.beast2`, encodeBeast2For(StringType)(readFileSync(text, 'utf8').trim()));
            rmSync(text);
          }
        }
        return null;
      },
    };

    // What the release before the step left: a record without it, and the
    // package ref in the older form.
    const record = decodeBeast2For(RepositoryRecordType)(readFileSync(join(repo, REPOSITORY_RECORD_FILE)));
    writeFileSync(join(repo, REPOSITORY_RECORD_FILE), encodeRepositoryRecord({ ...record, release: '0.0.1' }));
    const ref = join(repo, 'packages', 'layout', '1.0.0.beast2');
    const packageHash = decodeBeast2For(StringType)(readFileSync(ref));
    writeFileSync(join(repo, 'packages', 'layout', '1.0.0'), `${packageHash}\n`);
    rmSync(ref);

    const states = new FileStateStore(join(repo, 'workspaces'));
    const kept = async () => ({
      workspace: await storage.refs.workspaceRead(repo, 'main'),
      runs: await storage.refs.dataflowRunList(repo, 'main'),
      state: await states.readLatest(repo, 'main'),
      executions: await storage.refs.executionList(repo),
      rows: await storage.datasets.read(repo, 'main', 'inputs/rows'),
      counter: await storage.datasets.read(repo, 'main', 'records/counter'),
    });
    const before = await kept();

    const metadata = readFileSync(join(repo, 'metadata.beast2'));
    LOCAL_REPOSITORY_UPGRADES.push(upgrade);
    try {
      // Opened twice: the step runs once.
      await repositoryOpen(storage, repo);
      await repositoryOpen(storage, repo);
      assert.equal(applied, 1);

      const upgraded = decodeBeast2For(RepositoryRecordType)(readFileSync(join(repo, REPOSITORY_RECORD_FILE)));
      assert.equal(upgraded.release, E3_RELEASE);
      assert.deepEqual(upgraded.upgrades, [...record.upgrades, { name: 'package-refs-in-beast2', release: E3_RELEASE }]);
      assert.deepEqual(readFileSync(join(repo, 'metadata.beast2')), metadata, 'the metadata is left as it is');
      assert.equal(await storage.refs.packageResolve(repo, 'layout', '1.0.0'), packageHash);
      assert.deepEqual(await kept(), before);

      // What the older release ran serves the upgraded repository's next run.
      const orchestrator = new LocalOrchestrator(states);
      const rerun = await orchestrator.wait(await orchestrator.start(storage, repo, 'main'));
      assert.ok(rerun.success, 'the run succeeds');
      assert.deepEqual([rerun.executed, rerun.cached], [0, 1]);
    } finally {
      LOCAL_REPOSITORY_UPGRADES.splice(LOCAL_REPOSITORY_UPGRADES.indexOf(upgrade), 1);
    }
  });
});
