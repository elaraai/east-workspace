/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * gc's contract: the history it keeps and the objects it keeps, over any
 * backend.
 */

import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DictType, East, IntegerType, StringType, StructType, decodeBeast2For, encodeBeast2For, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import {
  FunctionObjectType, PackageObjectType, UNIT_PLAN_KIND, WorkspaceRecordType, decodeCollectionManifest, decodeMigrationObject,
  decodeRecordObject, encodeUnitPlan, type PackageObject, type WorkspaceState,
} from '@elaraai/e3-types';
import { readDatasetWhole } from '../dataset-open.js';
import { ObjectNotFoundError } from '../errors.js';
import { inputsHash } from '../executions.js';
import { collectAllRoots, repoGc } from '../gc.js';
import { pruneHistory } from '../history.js';
import { packageImport, packageRead, packageRemove } from '../packages.js';
import { uuidv7 } from '../uuid.js';
import type { BackendSetup } from './setup.js';

const DAY = 24 * 60 * 60 * 1000;

/** A UUIDv7 minted at `ms`, the `n`th of that moment: an id of a given age. */
function idAt(ms: number, n: number): string {
  const time = ms.toString(16).padStart(12, '0');
  return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-${n.toString(16).padStart(12, '0')}`;
}

/** A directory for one test's package zips, removed when the test ends. */
function zipDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'e3-contract-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Registers gc's contract suite over a backend.
 *
 * @remarks
 * Every case goes through the storage interfaces, so a backend runs it over its
 * own stores by giving its own setup: the history its ref stores hold, the
 * objects its object store holds, the roots its `RepoStore` scans find, and
 * the locks gc holds the repository still with. What a backend keeps beside
 * its objects and records, which its own `gcSweepBackend` sweeps, is its own
 * suite's.
 *
 * @param setup - Makes a fresh backend and a repository in it for each test
 */
export function gcTests(setup: BackendSetup): void {
  describe('gc', () => {
    describe('the history it keeps', () => {
      const now = Date.now();
      const old = now - 30 * DAY;
      const summary = { total: 0n, completed: 0n, cached: 0n, failed: 0n, skipped: 0n, reexecuted: 0n };

      it('keeps each workspace\'s last runs, its recent ones and the run its state came from', async (t) => {
        const { storage, repo } = await setup(t);
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

      it('keeps what a kept run used and what is recent or running, with each kept task\'s latest attempt, and deletes the rest with its owner and logs', async (t) => {
        const { storage, repo } = await setup(t);
        const task = 'a'.repeat(64);
        const [ran, failedSince, gone, recent, running] = [idAt(old, 1), idAt(old + 1, 2), idAt(old, 3), idAt(now - 60_000, 4), idAt(old, 5)];
        const [kept, dropped, recently, stillRunning] = ['1', '2', '3', '4'].map((c) => c.repeat(64));
        // A success a kept run used, and a failure after it, the latest.
        await storage.refs.executionWrite(repo, task, kept, ran, variant('success', {
          executionId: ran, inputHashes: [], outputHash: 'e'.repeat(64), startedAt: new Date(old), completedAt: new Date(old), peakBytes: none, plan: none, unit: false,
        }));
        await storage.refs.executionWrite(repo, task, kept, failedSince, variant('failed', {
          executionId: failedSince, inputHashes: [], startedAt: new Date(old), completedAt: new Date(old), exitCode: 1n, peakBytes: none, unit: false,
        }));
        // A success only a deleted run used, with its owner and logs.
        await storage.refs.executionWrite(repo, task, dropped, gone, variant('success', {
          executionId: gone, inputHashes: [], outputHash: 'f'.repeat(64), startedAt: new Date(old), completedAt: new Date(old), peakBytes: none, plan: none, unit: false,
        }));
        await storage.refs.executionOwnerWrite(repo, task, dropped, gone, { pid: 1n, pidStartTime: 1n, bootId: 'boot-id' });
        await storage.logs.append(repo, task, dropped, gone, 'stdout', 'what it printed\n');
        // A recent failure, and an old record still running.
        await storage.refs.executionWrite(repo, task, recently, recent, variant('failed', {
          executionId: recent, inputHashes: [], startedAt: new Date(now), completedAt: new Date(now), exitCode: 1n, peakBytes: none, unit: false,
        }));
        await storage.refs.executionWrite(repo, task, stillRunning, running, variant('running', {
          executionId: running, inputHashes: [], startedAt: new Date(old), pid: 1n, pidStartTime: 1n, bootId: 'boot-id', unit: false,
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
        assert.ok(!(await storage.refs.executionList(repo)).some(({ inputsHash: inputs }) => inputs === dropped), 'nothing of it is left');
        assert.ok(result.roots.has('e'.repeat(64)) && !result.roots.has('f'.repeat(64)), 'what is kept roots its output; what goes does not');
      });

      it('keeps the units a split task\'s success names through its plans, and those of an execution that can resume', async (t) => {
        const { storage, repo } = await setup(t);
        const split = 'b'.repeat(64);
        const [inputs, resumable, abandoned] = ['c', 'd', 'e'].map((c) => c.repeat(64));
        const [x1, x2, o1, o2, y1, z1] = ['5', '6', '7', '8', '9', '0'].map((c) => c.repeat(64));
        const pieces = await storage.objects.write(repo, encodeUnitPlan({
          kind: UNIT_PLAN_KIND, task: split, inputs, stage: variant('pieces', [[x1], [x2]]), previous: none, peakBytes: none,
        }));
        const merge = await storage.objects.write(repo, encodeUnitPlan({
          kind: UNIT_PLAN_KIND, task: split, inputs, stage: variant('merge', { level: 1n, levels: 1n, groups: [{ range: none, entries: [o1, o2] }] }),
          previous: some(pieces), peakBytes: none,
        }));
        const [resumes, abandons] = await Promise.all([[resumable, y1], [abandoned, z1]].map(([over, piece]) => storage.objects.write(repo, encodeUnitPlan({
          kind: UNIT_PLAN_KIND, task: split, inputs: over!, stage: variant('pieces', [[piece!]]), previous: none, peakBytes: none,
        }))));
        // The task's success, which a kept run used, names the merge level's plan.
        const succeeded = idAt(old, 1);
        await storage.refs.executionWrite(repo, split, inputs, succeeded, variant('success', {
          executionId: succeeded, inputHashes: [], outputHash: 'e'.repeat(64), startedAt: new Date(old), completedAt: new Date(old), peakBytes: none,
          plan: some(merge), unit: false,
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
            executionId: interrupted, inputHashes: [], startedAt: new Date(old), completedAt: new Date(old), pid: 1n, unit: false,
          }));
          await storage.refs.executionPlanWrite(repo, split, over, plan);
        }
        // Each unit's success, long ago, and a unit of nothing kept.
        const units = [inputsHash([x1]), inputsHash([x2]), inputsHash(['merge', o1, o2]), inputsHash([y1])];
        const unkept = inputsHash([z1]);
        for (const [n, unit] of [...units, unkept].entries()) {
          const id = idAt(old, 10 + n);
          await storage.refs.executionWrite(repo, split, unit, id, variant('success', {
            executionId: id, inputHashes: [], outputHash: 'f'.repeat(64), startedAt: new Date(old), completedAt: new Date(old), peakBytes: none, plan: none, unit: true,
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

      it('decides the same in a dry run, and deletes nothing, marking as if it had', async (t) => {
        const { storage, repo } = await setup(t);
        const task = 'a'.repeat(64);
        const inputs = '1'.repeat(64);
        const gone = idAt(old, 1);
        // The output only the execution keeps, as an object.
        const output = await storage.objects.write(repo, encodeBeast2For(IntegerType)(42n));
        await storage.refs.executionWrite(repo, task, inputs, gone, variant('success', {
          executionId: gone, inputHashes: [], outputHash: output, startedAt: new Date(old), completedAt: new Date(old), peakBytes: none, plan: none, unit: false,
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

      it('refuses a history it cannot count', async (t) => {
        const { storage, repo } = await setup(t);
        await assert.rejects(repoGc(storage, repo, { keepRuns: -1 }), {
          name: 'RangeError', message: 'gc: keepRuns must be a whole number of zero or more, got -1',
        });
        await assert.rejects(repoGc(storage, repo, { keepDays: 1.5 }), {
          name: 'RangeError', message: 'gc: keepDays must be a whole number of zero or more, got 1.5',
        });
      });
    });

    describe('the objects it keeps', () => {
      it('returns zero counts for an empty repository', async (t) => {
        const { storage, repo } = await setup(t);
        const result = await repoGc(storage, repo);

        assert.equal(result.deletedObjects, 0);
        assert.equal(result.deletedPartials, 0);
        assert.equal(result.retainedObjects, 0);
        assert.equal(result.bytesFreed, 0);
      });

      it('deletes an object nothing names, once it is old enough', async (t) => {
        const { storage, repo } = await setup(t);
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const hash = await storage.objects.write(repo, data);
        assert.deepEqual(new Uint8Array(await storage.objects.read(repo, hash)), data);

        const result = await repoGc(storage, repo, { minAge: 0 });

        assert.equal(result.deletedObjects, 1);
        assert.equal(result.retainedObjects, 0);
        assert.ok(result.bytesFreed > 0);
        await assert.rejects(storage.objects.read(repo, hash), ObjectNotFoundError);
      });

      it('deletes every object nothing names', async (t) => {
        const { storage, repo } = await setup(t);
        for (const byte of [1, 2, 3]) await storage.objects.write(repo, new Uint8Array([byte]));

        const result = await repoGc(storage, repo, { minAge: 0 });

        assert.equal(result.deletedObjects, 3);
        assert.equal(result.retainedObjects, 0);
      });

      it('skips an object younger than the age gate', async (t) => {
        const { storage, repo } = await setup(t);
        const hash = await storage.objects.write(repo, new Uint8Array([42]));

        const result = await repoGc(storage, repo, { minAge: 60000 });

        assert.equal(result.deletedObjects, 0);
        assert.equal(result.skippedYoung, 1);
        assert.deepEqual(new Uint8Array(await storage.objects.read(repo, hash)), new Uint8Array([42]));
      });

      it('reports but deletes nothing in a dry run', async (t) => {
        const { storage, repo } = await setup(t);
        const data = new Uint8Array([10, 20, 30]);
        const hash = await storage.objects.write(repo, data);

        const result = await repoGc(storage, repo, { minAge: 0, dryRun: true });

        assert.equal(result.deletedObjects, 1);
        assert.ok(result.bytesFreed > 0);
        assert.deepEqual(new Uint8Array(await storage.objects.read(repo, hash)), data);
      });

      it('retains what a package names', async (t) => {
        const { storage, repo } = await setup(t);
        const zip = join(zipDir(t), 'gc-test.zip');
        await e3.export(e3.package('gc-test', '1.0.0', e3.input('greeting', StringType, variant('value', 'hello'))), zip);
        const imported = await packageImport(storage, repo, zip);

        const result = await repoGc(storage, repo, { minAge: 0 });

        assert.equal(result.deletedObjects, 0);
        assert.ok(result.retainedObjects >= 2, `Expected at least 2 retained objects, got ${result.retainedObjects}`);
        assert.ok((await storage.objects.read(repo, imported.packageHash)).length > 0);
      });

      it('deletes what only a removed package named', async (t) => {
        const { storage, repo } = await setup(t);
        const zip = join(zipDir(t), 'remove-gc.zip');
        await e3.export(e3.package('remove-gc', '1.0.0') as any, zip);
        const imported = await packageImport(storage, repo, zip);
        await packageRemove(storage, repo, 'remove-gc', '1.0.0');

        const result = await repoGc(storage, repo, { minAge: 0 });

        assert.equal(result.deletedObjects, imported.objectCount);
        assert.equal(result.retainedObjects, 0);
      });

      it('retains what a removed package shares with a kept one', async (t) => {
        const { storage, repo } = await setup(t);
        const dir = zipDir(t);
        for (const name of ['shared-a', 'shared-b']) {
          await e3.export(e3.package(name, '1.0.0') as any, join(dir, `${name}.zip`));
          await packageImport(storage, repo, join(dir, `${name}.zip`));
        }
        await packageRemove(storage, repo, 'shared-a', '1.0.0');

        const result = await repoGc(storage, repo, { minAge: 0 });

        assert.ok(result.retainedObjects >= 1);
      });

      it('keeps a function\'s body while its package is kept (PackageObject → FunctionObject → bodyIr)', async (t) => {
        const { storage, repo } = await setup(t);
        const zip = join(zipDir(t), 'fn-gc.zip');
        const double = e3.function('double', East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)));
        await e3.export(e3.package('fn-gc', '1.0.0', double), zip);
        await packageImport(storage, repo, zip);

        const result = await repoGc(storage, repo, { minAge: 0 });
        assert.equal(result.deletedObjects, 0);

        const pkg = await packageRead(storage, repo, 'fn-gc', '1.0.0');
        const fnHash = pkg.functions.get('double');
        assert.ok(fnHash, 'functions map lost');
        const fn = decodeBeast2For(FunctionObjectType)(Buffer.from(await storage.objects.read(repo, fnHash)));
        assert.ok((await storage.objects.read(repo, fn.bodyIr)).length > 0, 'bodyIr object lost');
      });

      it('deletes a function once its package is removed', async (t) => {
        const { storage, repo } = await setup(t);
        const zip = join(zipDir(t), 'fn-gc-rm.zip');
        const triple = e3.function('triple', East.function([IntegerType], IntegerType, ($, x) => x.multiply(3n)));
        await e3.export(e3.package('fn-gc-rm', '1.0.0', triple), zip);
        const imported = await packageImport(storage, repo, zip);
        await packageRemove(storage, repo, 'fn-gc-rm', '1.0.0');

        const result = await repoGc(storage, repo, { minAge: 0 });
        assert.equal(result.deletedObjects, imported.objectCount);
      });

      it('keeps a record\'s migrations, their functions and a split step\'s program (PackageObject → RecordObject → MigrationObject → IR)', async (t) => {
        const { storage, repo } = await setup(t);
        const RowType = StructType({ title: StringType });
        const plans = e3.record('plans', DictType(StringType, RowType), new Map());
        const retitle = e3.migration.rows('retitle', plans,
          East.function([StringType, RowType], RowType, ($, _id, row) => ({ title: row.title })));
        const zip = join(zipDir(t), 'migration-gc.zip');
        await e3.export(e3.package('migration-gc', '1.0.0', retitle), zip);
        await packageImport(storage, repo, zip);

        const result = await repoGc(storage, repo, { minAge: 0 });
        assert.equal(result.deletedObjects, 0);

        const pkg = await packageRead(storage, repo, 'migration-gc', '1.0.0');
        const record = decodeRecordObject(await storage.objects.read(repo, pkg.records.get('plans')!));
        const step = decodeMigrationObject(await storage.objects.read(repo, record.migrations[0]!.migration));
        assert.ok((await storage.objects.read(repo, step.bodyIr)).length > 0, 'the function survives');
        assert.ok((await storage.objects.read(repo, step.programIr)).length > 0, 'the program a split step runs survives');
      });

      it('retains what a package names through its refs (PackageObject → value)', async (t) => {
        const { storage, repo } = await setup(t);
        const value = await storage.objects.write(repo, encodeBeast2For(StringType)('hello world'));
        const pkg = await storage.objects.write(repo, encodeBeast2For(PackageObjectType)({
          tasks: new Map(),
          data: {
            structure: variant('struct', new Map()),
            refs: new Map([['data', variant('value', { hash: value, versions: new Map() })]]),
          },
          functions: new Map(),
          records: new Map(), sources: new Map(),
        } as PackageObject));
        await storage.refs.packageWrite(repo, 'transitive', '1.0.0', pkg);

        const result = await repoGc(storage, repo, { minAge: 0 });

        assert.equal(result.deletedObjects, 0);
        assert.equal(result.retainedObjects, 2);
        await storage.objects.read(repo, pkg);
        await storage.objects.read(repo, value);
      });

      it('deletes what no package names beside what one does', async (t) => {
        const { storage, repo } = await setup(t);
        const pkg = await storage.objects.write(repo, encodeBeast2For(PackageObjectType)({
          tasks: new Map(),
          data: { structure: variant('struct', new Map()), refs: new Map() },
          functions: new Map(),
          records: new Map(), sources: new Map(),
        } as PackageObject));
        const orphan = await storage.objects.write(repo, new Uint8Array([77, 88, 99]));
        await storage.refs.packageWrite(repo, 'graph-test', '1.0.0', pkg);

        const result = await repoGc(storage, repo, { minAge: 0 });

        assert.equal(result.deletedObjects, 1);
        assert.equal(result.retainedObjects, 1);
        await storage.objects.read(repo, pkg);
        await assert.rejects(storage.objects.read(repo, orphan), ObjectNotFoundError);
      });

      it('retains what an execution it keeps names', async (t) => {
        const { storage, repo } = await setup(t);
        const data = new Uint8Array([11, 22, 33]);
        const hash = await storage.objects.write(repo, data);
        // A recent success, which the history keeps.
        const executionId = uuidv7();
        await storage.refs.executionWrite(repo, 'a'.repeat(64), 'b'.repeat(64), executionId, variant('success', {
          executionId,
          inputHashes: ['b'.repeat(64)],
          outputHash: hash,
          startedAt: new Date(),
          completedAt: new Date(),
          peakBytes: none,
          plan: none,
          unit: false,
        }));

        const result = await repoGc(storage, repo, { minAge: 0 });

        assert.equal(result.deletedObjects, 0);
        assert.equal(result.retainedObjects, 1);
        assert.deepEqual(new Uint8Array(await storage.objects.read(repo, hash)), data);
      });

      it('roots a split task\'s plan through its sidecar until the execution clears it', async (t) => {
        const { storage, repo } = await setup(t);
        const taskHash = 'a'.repeat(64);
        const inputs = 'b'.repeat(64);
        // The execution was interrupted mid-task, and can resume.
        const interrupted = uuidv7();
        await storage.refs.executionWrite(repo, taskHash, inputs, interrupted, variant('interrupted', {
          executionId: interrupted, inputHashes: [], startedAt: new Date(), completedAt: new Date(), pid: 1n, unit: false,
        }));
        const piece = await storage.objects.write(repo, encodeBeast2For(StringType)('a piece of the input'));
        const plan = await storage.objects.write(repo, encodeUnitPlan({
          kind: UNIT_PLAN_KIND,
          task: taskHash,
          inputs,
          stage: variant('pieces', [[piece]]),
          previous: none,
          peakBytes: none,
        }));
        await storage.refs.executionPlanWrite(repo, taskHash, inputs, plan);

        const kept = await repoGc(storage, repo, { minAge: 0 });
        assert.equal(kept.deletedObjects, 0, 'a plan the execution can resume from keeps what it names');
        await storage.objects.read(repo, plan);
        await storage.objects.read(repo, piece);

        await storage.refs.executionPlanWrite(repo, taskHash, inputs, null);
        assert.equal(await storage.refs.executionPlanRead(repo, taskHash, inputs), null);
        const swept = await repoGc(storage, repo, { minAge: 0 });
        assert.equal(swept.deletedObjects, 2, 'the plan and its piece go once the execution has ended');
      });

      it('refuses while a dataflow holds a workspace\'s dataflow lock, releasing the locks it took', async (t) => {
        const { storage, repo } = await setup(t);
        for (const ws of ['first', 'second']) await storage.refs.workspaceWrite(repo, ws, encodeBeast2For(WorkspaceRecordType)(none));

        const run = await storage.locks.acquire(repo, 'second#dataflow', variant('dataflow', null));
        assert.ok(run, 'the run holds its dataflow lock');
        try {
          await assert.rejects(
            repoGc(storage, repo, { minAge: 0 }),
            { message: "gc: a dataflow is running in workspace 'second' — retry when it finishes" },
          );
          const first = await storage.locks.acquire(repo, 'first#dataflow', variant('dataflow', null));
          assert.ok(first, 'gc released the lock it had taken before refusing');
          await first.release();
        } finally {
          await run.release();
        }

        await repoGc(storage, repo, { minAge: 0 });
        for (const ws of ['first', 'second']) {
          const lock = await storage.locks.acquire(repo, `${ws}#dataflow`, variant('dataflow', null));
          assert.ok(lock, `gc released ${ws}'s dataflow lock`);
          await lock.release();
        }
      });

      it('marks a workspace dataset header-first: retained, never read whole', async (t) => {
        const { storage, repo } = await setup(t);
        const datasetHash = await storage.objects.write(repo, encodeBeast2For(StructType({ name: StringType }))({ name: 'y'.repeat(100_000) }));
        const pkgHash = await storage.objects.write(repo, encodeBeast2For(PackageObjectType)({
          tasks: new Map(), data: { structure: variant('struct', new Map()), refs: new Map() },
          functions: new Map(), records: new Map(), sources: new Map(),
        } as PackageObject));
        await storage.refs.workspaceWrite(repo, 'reader', encodeBeast2For(WorkspaceRecordType)(some({
          packageName: 'test-pkg',
          packageVersion: '1.0.0',
          packageHash: pkgHash,
          deployedAt: new Date(),
          currentRunId: none,
        })));
        await storage.datasets.write(repo, 'reader', 'big', variant('value', { hash: datasetHash, versions: new Map() }));

        const objects = storage.objects;
        const read = objects.read.bind(objects);
        let datasetReads = 0;
        objects.read = (r: string, hash: string) => {
          if (hash === datasetHash) datasetReads++;
          return read(r, hash);
        };

        const result = await repoGc(storage, repo, { minAge: 0 });

        assert.equal(result.deletedObjects, 0);
        assert.equal(result.retainedObjects, 2);
        assert.equal(datasetReads, 0, 'the dataset is classified from its head');
      });

      it('retains what a deployed workspace\'s state and dataset refs name', async (t) => {
        const { storage, repo } = await setup(t);
        const valueHash = await storage.objects.write(repo, new Uint8Array([44, 55, 66]));
        const pkgHash = await storage.objects.write(repo, encodeBeast2For(PackageObjectType)({
          tasks: new Map(), data: { structure: variant('struct', new Map()), refs: new Map() },
          functions: new Map(), records: new Map(), sources: new Map(),
        } as PackageObject));
        const state: WorkspaceState = {
          packageName: 'test-pkg',
          packageVersion: '1.0.0',
          packageHash: pkgHash,
          deployedAt: new Date(),
          currentRunId: none,
        };
        await storage.refs.workspaceWrite(repo, 'myworkspace', encodeBeast2For(WorkspaceRecordType)(some(state)));
        await storage.datasets.write(repo, 'myworkspace', 'some-dataset', variant('value', { hash: valueHash, versions: new Map() }));

        const result = await repoGc(storage, repo, { minAge: 0 });

        assert.equal(result.deletedObjects, 0);
        assert.equal(result.retainedObjects, 2);
        await storage.objects.read(repo, valueHash);
        await storage.objects.read(repo, pkgHash);
      });

      it('deletes nothing while it cannot read what a deployed workspace is served from', async (t) => {
        // A deployed workspace whose package does not read: what its state is
        // served from cannot be known, so no history is pruned, and no object
        // swept, rather than on a guess.
        const { storage, repo } = await setup(t);
        const junk = await storage.objects.write(repo, new Uint8Array([77, 88, 99]));
        await storage.refs.workspaceWrite(repo, 'broken', encodeBeast2For(WorkspaceRecordType)(some({
          packageName: 'test-pkg',
          packageVersion: '1.0.0',
          packageHash: junk,
          deployedAt: new Date(),
          currentRunId: none,
        })));
        const orphan = await storage.objects.write(repo, new Uint8Array([1, 2, 3]));

        await assert.rejects(repoGc(storage, repo, { minAge: 0 }),
          /^Error: gc deletes nothing while it cannot read what workspace 'broken' is served from: /);
        await storage.objects.read(repo, orphan);
      });

      it('passes over a workspace nothing is deployed to', async (t) => {
        const { storage, repo } = await setup(t);
        await storage.objects.write(repo, new Uint8Array([11, 22, 33]));
        await storage.refs.workspaceWrite(repo, 'undeployed', encodeBeast2For(WorkspaceRecordType)(none));

        const result = await repoGc(storage, repo, { minAge: 0 });

        assert.equal(result.deletedObjects, 1);
        assert.equal(result.retainedObjects, 0);
      });

      it('keeps every segment a collection dataset names', async (t) => {
        const { storage, repo } = await setup(t);
        const type = DictType(StringType, IntegerType);
        const rows = new Map<string, bigint>();
        for (let i = 0; i < 20_000; i++) rows.set(`k${String(i).padStart(7, '0')}`, BigInt(i));
        const zip = join(zipDir(t), 'gc-manifest.zip');
        await e3.export(e3.package('gc-manifest', '1.0.0', e3.input('rows', type, variant('value', rows))), zip);
        await packageImport(storage, repo, zip);

        const pkg = await packageRead(storage, repo, 'gc-manifest', '1.0.0');
        const ref = pkg.data.refs.get('inputs/rows');
        assert.ok(ref && ref.type === 'value');
        const hash = ref.type === 'value' ? ref.value.hash : '';
        const manifest = decodeCollectionManifest(await storage.objects.read(repo, hash));
        assert.ok(manifest.entries.length > 1, 'a 20k-row dict must hold more than one segment');

        const result = await repoGc(storage, repo, { minAge: 0 });
        assert.equal(result.deletedObjects, 0);

        // Every object the manifest names must still be readable, and the value
        // must still decode — a sweep that took a segment would show up here.
        await storage.objects.read(repo, manifest.header);
        for (const entry of manifest.entries) await storage.objects.read(repo, entry.hash);
        const whole = decodeBeast2For(type)(await readDatasetWhole(storage, repo, hash)) as Map<string, bigint>;
        assert.equal(whole.size, 20_000);
      });
    });

    describe('its roots', () => {
      it('finds none in an empty repository', async (t) => {
        const { storage, repo } = await setup(t);
        assert.equal((await collectAllRoots(storage.repos, repo)).size, 0);
      });

      it('finds the object a package ref names', async (t) => {
        const { storage, repo } = await setup(t);
        const hash = 'a'.repeat(64);
        await storage.refs.packageWrite(repo, 'test-pkg', '1.0.0', hash);
        assert.ok((await collectAllRoots(storage.repos, repo)).has(hash));
      });
    });
  });
}
