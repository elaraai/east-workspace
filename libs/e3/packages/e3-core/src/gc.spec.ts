/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for gc.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { East, ArrayType, BlobType, DateTimeType, DictType, EastTypeType, IntegerType, OptionType, StringType, StructType, VariantType, SEGMENT_RULE_KEYED, decodeBeast2For, encodeBeast2For, fromEastTypeValue, variant, some, none, toEastTypeValue } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { WorkspaceStateType, PackageObjectType, PackageDataType, TASK_OBJECT_KIND, TaskObjectType, FunctionObjectType, DataRefType, DatasetRefType, RecordCommitType, RecordIndexObjectType, MutationObjectType, EnvironmentSpecType, PythonEnvironmentType, NodeEnvironmentType, ImageEnvironmentType, PartitionPlanType, RunnerType, TreePathType, COLLECTION_MANIFEST_KIND, CollectionManifestType, RECORD_STATE_KIND, RecordStateType, UNIT_PLAN_KIND, UnitPlanType, encodeCollectionManifest, decodeCollectionManifest, encodePartitionPlan, encodeUnitPlan } from '@elaraai/e3-types';
import type { WorkspaceState, PackageObject, TaskObject } from '@elaraai/e3-types';
import { repoGc, collectAllRoots, markReachable, sweepBatch } from './storage/local/gc.js';
import { readDatasetWhole } from './dataset-open.js';
import { transferStagingPath } from './storage/local/localHelpers.js';
import { objectWrite, objectRead } from './storage/local/LocalObjectStore.js';
import { packageImport, packageRemove, packageRead } from './packages.js';
import { ObjectNotFoundError } from './errors.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';
import type { GcObjectEntry } from './storage/interfaces.js';

describe('gc', () => {
  let testRepoPath: string;
  let tempDir: string;
  let storage: StorageBackend;

  beforeEach(() => {
    testRepoPath = createTestRepo();
    tempDir = createTempDir();
    // Create LocalStorage with the parent of testRepo as reposDir.
    // This allows repoGc to use repoName for repos.* operations,
    // while objects/refs still use testRepoPath (full path).
    storage = new LocalStorage(dirname(testRepoPath));
  });

  afterEach(() => {
    removeTestRepo(testRepoPath);
    removeTempDir(tempDir);
  });

  describe('with no objects', () => {
    it('returns zero counts for empty repository', async () => {
      const result = await repoGc(storage, testRepoPath);

      assert.strictEqual(result.deletedObjects, 0);
      assert.strictEqual(result.deletedPartials, 0);
      assert.strictEqual(result.retainedObjects, 0);
      assert.strictEqual(result.bytesFreed, 0);
    });
  });

  describe('with orphaned objects', () => {
    it('deletes orphaned objects', async () => {
      // Store an object directly without any ref
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const hash = await objectWrite(testRepoPath, data);

      // Verify object exists
      const loaded = await objectRead(testRepoPath, hash);
      assert.deepStrictEqual(new Uint8Array(loaded), data);

      // Run gc with minAge=0 to delete immediately
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 1);
      assert.strictEqual(result.retainedObjects, 0);
      assert.ok(result.bytesFreed > 0);

      // Verify object is gone
      await assert.rejects(
        async () => await objectRead(testRepoPath, hash),
        ObjectNotFoundError
      );
    });

    it('deletes multiple orphaned objects', async () => {
      // Store several objects
      await objectWrite(testRepoPath, new Uint8Array([1]));
      await objectWrite(testRepoPath, new Uint8Array([2]));
      await objectWrite(testRepoPath, new Uint8Array([3]));

      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 3);
      assert.strictEqual(result.retainedObjects, 0);
    });
  });

  describe('with package refs', () => {
    it('retains objects referenced by packages', async () => {
      // Create and import a package
      const myInput = e3.input('greeting', StringType, variant('value', 'hello'));
      const pkg = e3.package('gc-test', '1.0.0', myInput);
      const zipPath = join(tempDir, 'gc-test.zip');
      await e3.export(pkg, zipPath);

      const importResult = await packageImport(storage, testRepoPath, zipPath);

      // Run gc - should not delete anything
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 0);
      assert.ok(result.retainedObjects >= 2, `Expected at least 2 retained objects, got ${result.retainedObjects}`);

      // Verify package object still exists
      const packageData = await objectRead(testRepoPath, importResult.packageHash);
      assert.ok(packageData.length > 0);
    });

    it('deletes objects after package is removed', async () => {
      // Create and import a package
      const pkg = e3.package('remove-gc', '1.0.0') as any;
      const zipPath = join(tempDir, 'remove-gc.zip');
      await e3.export(pkg, zipPath);

      const importResult = await packageImport(storage, testRepoPath, zipPath);
      const objectCount = importResult.objectCount;

      // Remove the package
      await packageRemove(storage, testRepoPath, 'remove-gc', '1.0.0');

      // Run gc - should delete all package objects
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, objectCount);
      assert.strictEqual(result.retainedObjects, 0);
    });

    it('retains shared objects between packages', async () => {
      // Create and import two packages
      const pkg1 = e3.package('shared-a', '1.0.0') as any;
      const pkg2 = e3.package('shared-b', '1.0.0') as any;

      const zip1 = join(tempDir, 'shared-a.zip');
      const zip2 = join(tempDir, 'shared-b.zip');

      await e3.export(pkg1, zip1);
      await e3.export(pkg2, zip2);

      await packageImport(storage, testRepoPath, zip1);
      await packageImport(storage, testRepoPath, zip2);

      // Remove one package
      await packageRemove(storage, testRepoPath, 'shared-a', '1.0.0');

      // Run gc
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      // Some objects may be deleted, but shared-b's objects are retained
      assert.ok(result.retainedObjects >= 1);
    });
  });

  describe('with function objects', () => {
    it('function bodies survive gc (PackageObject -> FunctionObject -> bodyIr)', async () => {
      // Deploy a package containing a function, gc, then verify the
      // FunctionObject and its bodyIr object are retained and decodable.
      const double = e3.function(
        'double',
        East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n))
      );
      const pkg = e3.package('fn-gc', '1.0.0', double);
      const zipPath = join(tempDir, 'fn-gc.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepoPath, zipPath);

      const result = await repoGc(storage, testRepoPath, { minAge: 0 });
      assert.strictEqual(result.deletedObjects, 0);

      // The function body must still be readable after gc
      const pkgObject = await packageRead(storage, testRepoPath, 'fn-gc', '1.0.0');
      const fnHash = pkgObject.functions.get('double');
      assert.ok(fnHash, 'functions map lost');
      const fnObject = decodeBeast2For(FunctionObjectType)(Buffer.from(await objectRead(testRepoPath, fnHash!)));
      const bodyIr = await objectRead(testRepoPath, fnObject.bodyIr);
      assert.ok(bodyIr.length > 0, 'bodyIr object lost');
    });

    it('function objects are deleted once the package is removed', async () => {
      const double = e3.function(
        'double',
        East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n))
      );
      const pkg = e3.package('fn-gc-rm', '1.0.0', double);
      const zipPath = join(tempDir, 'fn-gc-rm.zip');
      await e3.export(pkg, zipPath);
      const importResult = await packageImport(storage, testRepoPath, zipPath);

      await packageRemove(storage, testRepoPath, 'fn-gc-rm', '1.0.0');
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });
      assert.strictEqual(result.deletedObjects, importResult.objectCount);
    });
  });

  describe('with staging files', () => {
    it('deletes orphaned .partial files', async () => {
      // Create a fake .partial staging file
      const partialDir = join(testRepoPath, 'objects', 'ab');
      mkdirSync(partialDir, { recursive: true });
      const partialPath = join(partialDir, 'cdef.beast2.123456.abc123.partial');
      writeFileSync(partialPath, 'orphaned staging data');

      assert.ok(existsSync(partialPath));

      // Run gc
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedPartials, 1);
      assert.ok(!existsSync(partialPath));
    });

    it('skips young .partial files', async () => {
      // Create a .partial file
      const partialDir = join(testRepoPath, 'objects', 'cd');
      mkdirSync(partialDir, { recursive: true });
      const partialPath = join(partialDir, 'efgh.beast2.123456.xyz789.partial');
      writeFileSync(partialPath, 'in-progress data');

      // Run gc with default minAge (60s) - file is brand new
      const result = await repoGc(storage, testRepoPath, { minAge: 60000 });

      assert.strictEqual(result.deletedPartials, 0);
      assert.strictEqual(result.skippedYoung, 1);
      assert.ok(existsSync(partialPath));
    });

    it('deletes orphaned root-level streaming stage files', async () => {
      // Streaming writes stage at the objects/ root (the content path is
      // unknown until the digest names it) — a crashed writer leaves the
      // stage file there, outside every hash-prefix subdir.
      mkdirSync(join(testRepoPath, 'objects'), { recursive: true });
      const stagingPath = join(testRepoPath, 'objects', 'stage.123456.abc123.partial');
      writeFileSync(stagingPath, 'crashed streaming write');

      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedPartials, 1);
      assert.ok(!existsSync(stagingPath));
    });

    it('removes an orphaned dataset transfer staging file', async () => {
      // A dataset upload stages under the repository, not the OS temp dir, so
      // its commit can link or rename — and nothing but gc clears it when the
      // client disconnects mid-upload.
      const stagingPath = join(testRepoPath, 'tmp', 'transfers', 'abc.beast2.partial');
      assert.strictEqual(transferStagingPath(testRepoPath, 'abc'), stagingPath, 'the server stages exactly here');
      mkdirSync(dirname(stagingPath), { recursive: true });
      writeFileSync(stagingPath, 'an upload that never committed');

      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedPartials, 1);
      assert.ok(!existsSync(stagingPath));
    });

    it('keeps a young transfer staging file', async () => {
      // An in-flight upload is young: the default age gate must not race it.
      const stagingPath = join(testRepoPath, 'tmp', 'transfers', 'abc.beast2.partial');
      mkdirSync(dirname(stagingPath), { recursive: true });
      writeFileSync(stagingPath, 'an upload in flight');

      const result = await repoGc(storage, testRepoPath);

      assert.strictEqual(result.deletedPartials, 0);
      assert.strictEqual(result.skippedYoung, 1);
      assert.ok(existsSync(stagingPath));
    });
  });

  describe('minAge option', () => {
    it('skips young objects', async () => {
      // Store an object
      const hash = await objectWrite(testRepoPath, new Uint8Array([42]));

      // Run gc with high minAge - object is too young
      const result = await repoGc(storage, testRepoPath, { minAge: 60000 });

      assert.strictEqual(result.deletedObjects, 0);
      assert.strictEqual(result.skippedYoung, 1);

      // Object should still exist
      const data = await objectRead(testRepoPath, hash);
      assert.deepStrictEqual(new Uint8Array(data), new Uint8Array([42]));
    });

    it('deletes old objects with minAge=0', async () => {
      const hash = await objectWrite(testRepoPath, new Uint8Array([99]));

      // Run gc with minAge=0
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 1);

      await assert.rejects(
        async () => await objectRead(testRepoPath, hash),
        ObjectNotFoundError
      );
    });
  });

  describe('dryRun option', () => {
    it('reports but does not delete in dry run mode', async () => {
      // Store an orphaned object
      const data = new Uint8Array([10, 20, 30]);
      const hash = await objectWrite(testRepoPath, data);

      // Run gc in dry run mode
      const result = await repoGc(storage, testRepoPath, { minAge: 0, dryRun: true });

      assert.strictEqual(result.deletedObjects, 1);
      assert.ok(result.bytesFreed > 0);

      // Object should still exist
      const loaded = await objectRead(testRepoPath, hash);
      assert.deepStrictEqual(new Uint8Array(loaded), data);
    });

    it('reports partials but does not delete in dry run mode', async () => {
      const partialDir = join(testRepoPath, 'objects', 'ef');
      mkdirSync(partialDir, { recursive: true });
      const partialPath = join(partialDir, 'ghij.beast2.999999.dry123.partial');
      writeFileSync(partialPath, 'dry run test');

      const result = await repoGc(storage, testRepoPath, { minAge: 0, dryRun: true });

      assert.strictEqual(result.deletedPartials, 1);
      assert.ok(existsSync(partialPath)); // Still exists
    });
  });

  describe('object graph traversal', () => {
    it('retains transitively referenced objects via tree → value chain', async () => {
      // Create a chain: Package → Tree → Value (leaf)
      // Tree has a 'data' field pointing to a value object

      // Create value leaf object (some arbitrary beast2 data)
      const valueEncoder = encodeBeast2For(StringType);
      const hashValue = await objectWrite(testRepoPath, valueEncoder('hello world'));

      // Create a package object with refs referencing the value
      const pkgEncoder = encodeBeast2For(PackageObjectType);
      const hashPkg = await objectWrite(testRepoPath, pkgEncoder({
        tasks: new Map(),
        data: {
          structure: variant('struct', new Map()),
          refs: new Map([
            ['data', variant('value', { hash: hashValue, versions: new Map() })],
          ]),
        },
        functions: new Map(),
        records: new Map(), sources: new Map(),
      } as PackageObject));

      // Create a package ref pointing to the package
      const refDir = join(testRepoPath, 'packages', 'transitive');
      mkdirSync(refDir, { recursive: true });
      writeFileSync(join(refDir, '1.0.0'), hashPkg + '\n');

      // Run gc
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 0);
      assert.strictEqual(result.retainedObjects, 2); // pkg, value retained

      // All objects should still exist
      await objectRead(testRepoPath, hashPkg);
      await objectRead(testRepoPath, hashValue);
    });

    it('deletes unreachable objects in graph', async () => {
      // Create a reachable package with empty refs, plus an unreachable orphan

      // Reachable package (no children via refs)
      const pkgEncoder = encodeBeast2For(PackageObjectType);
      const hashPkg = await objectWrite(testRepoPath, pkgEncoder({
        tasks: new Map(),
        data: {
          structure: variant('struct', new Map()),
          refs: new Map(),
        },
        functions: new Map(),
        records: new Map(), sources: new Map(),
      } as PackageObject));

      // Unreachable orphan object
      const orphanData = new Uint8Array([77, 88, 99]);
      const hashOrphan = await objectWrite(testRepoPath, orphanData);

      // Only package is a root
      const refDir = join(testRepoPath, 'packages', 'graph-test');
      mkdirSync(refDir, { recursive: true });
      writeFileSync(join(refDir, '1.0.0'), hashPkg + '\n');

      // Run gc
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 1); // orphan deleted
      assert.strictEqual(result.retainedObjects, 1); // pkg retained

      // Package exists, orphan is gone
      await objectRead(testRepoPath, hashPkg);
      await assert.rejects(
        async () => await objectRead(testRepoPath, hashOrphan),
        ObjectNotFoundError
      );
    });
  });

  describe('execution refs', () => {
    it('retains objects referenced by execution refs', async () => {
      // Store an object
      const data = new Uint8Array([11, 22, 33]);
      const hash = await objectWrite(testRepoPath, data);

      // Create an execution ref using the new schema:
      // executions/<taskHash>/<inputsHash>/<executionId>/status.beast2
      const taskHash = 'a'.repeat(64);
      const inputsHash = 'b'.repeat(64);
      const executionId = '01900000-0000-7000-8000-000000000001';
      const execDir = join(testRepoPath, 'executions', taskHash, inputsHash, executionId);
      mkdirSync(execDir, { recursive: true });

      // Write a success execution status with outputHash
      const { encodeBeast2For: encodeFor } = await import('@elaraai/east');
      const { ExecutionStatusType } = await import('@elaraai/e3-types');
      const encoder = encodeFor(ExecutionStatusType);
      const status = variant('success', {
        executionId,
        inputHashes: [inputsHash],
        outputHash: hash,
        startedAt: new Date(),
        completedAt: new Date(),
      });
      writeFileSync(join(execDir, 'status.beast2'), encoder(status));

      // Run gc
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 0);
      assert.strictEqual(result.retainedObjects, 1);

      // Object still exists
      const loaded = await objectRead(testRepoPath, hash);
      assert.deepStrictEqual(new Uint8Array(loaded), data);
    });

    it('roots a split task\'s plan through its sidecar until the execution clears it', async () => {
      const taskHash = 'a'.repeat(64);
      const inputsHash = 'b'.repeat(64);
      const piece = await objectWrite(testRepoPath, encodeBeast2For(StringType)('a piece of the input'));
      const plan = await objectWrite(testRepoPath, encodeUnitPlan({
        kind: UNIT_PLAN_KIND,
        task: taskHash,
        inputs: inputsHash,
        stage: variant('pieces', [[piece]]),
      }));
      await storage.refs.executionPlanWrite(testRepoPath, taskHash, inputsHash, plan);

      const kept = await repoGc(storage, testRepoPath, { minAge: 0 });
      assert.strictEqual(kept.deletedObjects, 0, 'a plan the execution can resume from keeps what it names');
      await objectRead(testRepoPath, plan);
      await objectRead(testRepoPath, piece);

      await storage.refs.executionPlanWrite(testRepoPath, taskHash, inputsHash, '');
      assert.strictEqual(await storage.refs.executionPlanRead(testRepoPath, taskHash, inputsHash), null);
      const swept = await repoGc(storage, testRepoPath, { minAge: 0 });
      assert.strictEqual(swept.deletedObjects, 2, 'the plan and its piece go once the execution has ended');
    });
  });

  describe('dataflow locks', () => {
    it('refuses while a dataflow holds a workspace\'s dataflow lock, releasing the locks it took', async () => {
      const wsDir = join(testRepoPath, 'workspaces');
      mkdirSync(wsDir, { recursive: true });
      writeFileSync(join(wsDir, 'first.beast2'), '');
      writeFileSync(join(wsDir, 'second.beast2'), '');

      const run = await storage.locks.acquire(testRepoPath, 'second#dataflow', variant('dataflow', null));
      assert.ok(run, 'the run holds its dataflow lock');
      try {
        await assert.rejects(
          repoGc(storage, testRepoPath, { minAge: 0 }),
          { message: "gc: a dataflow is running in workspace 'second' — retry when it finishes" },
        );
        const first = await storage.locks.acquire(testRepoPath, 'first#dataflow', variant('dataflow', null));
        assert.ok(first, 'gc released the lock it had taken before refusing');
        await first.release();
      } finally {
        await run.release();
      }

      await repoGc(storage, testRepoPath, { minAge: 0 });
      for (const ws of ['first', 'second']) {
        const lock = await storage.locks.acquire(testRepoPath, `${ws}#dataflow`, variant('dataflow', null));
        assert.ok(lock, `gc released ${ws}'s dataflow lock`);
        await lock.release();
      }
    });
  });

  describe('workspace refs', () => {
    it('marks a workspace dataset header-first: retained, never read whole', async () => {
      const datasetHash = await objectWrite(testRepoPath, encodeBeast2For(StructType({ name: StringType }))({ name: 'y'.repeat(100_000) }));
      const pkgHash = await objectWrite(testRepoPath, new Uint8Array([77, 88, 99]));
      const wsDir = join(testRepoPath, 'workspaces');
      mkdirSync(join(wsDir, 'reader', 'data'), { recursive: true });
      writeFileSync(join(wsDir, 'reader.beast2'), encodeBeast2For(WorkspaceStateType)({
        packageName: 'test-pkg',
        packageVersion: '1.0.0',
        packageHash: pkgHash,
        deployedAt: new Date(),
        currentRunId: none,
      }));
      writeFileSync(join(wsDir, 'reader', 'data', 'big.ref'), encodeBeast2For(DatasetRefType)(variant('value', { hash: datasetHash, versions: new Map() })));

      const objects = storage.objects;
      const read = objects.read.bind(objects);
      let datasetReads = 0;
      objects.read = (repo: string, hash: string) => {
        if (hash === datasetHash) datasetReads++;
        return read(repo, hash);
      };

      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 0);
      assert.strictEqual(result.retainedObjects, 2);
      assert.strictEqual(datasetReads, 0, 'the dataset is classified from its head');
    });

    it('retains objects referenced by workspace state and dataset refs', async () => {
      // Store objects for a dataset value and package
      const valueData = new Uint8Array([44, 55, 66]);
      const valueHash = await objectWrite(testRepoPath, valueData);
      const pkgData = new Uint8Array([77, 88, 99]);
      const pkgHash = await objectWrite(testRepoPath, pkgData);

      // Create workspace state file at workspaces/<name>.beast2
      const wsDir = join(testRepoPath, 'workspaces');
      mkdirSync(wsDir, { recursive: true });

      const state: WorkspaceState = {
        packageName: 'test-pkg',
        packageVersion: '1.0.0',
        packageHash: pkgHash,
        deployedAt: new Date(),
        currentRunId: variant('none', null),
      };
      const encoder = encodeBeast2For(WorkspaceStateType);
      writeFileSync(join(wsDir, 'myworkspace.beast2'), encoder(state));

      // Create a per-dataset ref file that references valueHash
      const refDir = join(testRepoPath, 'workspaces', 'myworkspace', 'data');
      mkdirSync(refDir, { recursive: true });
      const refEncoder = encodeBeast2For(DatasetRefType);
      const ref = variant('value', { hash: valueHash, versions: new Map() });
      writeFileSync(join(refDir, 'some-dataset.ref'), refEncoder(ref));

      // Run gc
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 0);
      assert.strictEqual(result.retainedObjects, 2); // both valueHash and pkgHash

      // Objects still exist
      await objectRead(testRepoPath, valueHash);
      await objectRead(testRepoPath, pkgHash);
    });

    it('ignores undeployed workspaces', async () => {
      // Store an orphaned object
      const data = new Uint8Array([11, 22, 33]);
      await objectWrite(testRepoPath, data);

      // Create empty workspace file (undeployed)
      const wsDir = join(testRepoPath, 'workspaces');
      mkdirSync(wsDir, { recursive: true });
      writeFileSync(join(wsDir, 'undeployed.beast2'), '');

      // Run gc - orphaned object should be deleted
      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedObjects, 1);
      assert.strictEqual(result.retainedObjects, 0);
    });
  });

  // ==========================================================================
  // Unit tests for shared algorithm functions
  // ==========================================================================

  describe('collectAllRoots', () => {
    it('collects roots from all root types', async () => {
      const roots = await collectAllRoots(storage.repos, testRepoPath);
      // Empty repo has no roots
      assert.strictEqual(roots.size, 0);
    });

    it('collects package roots', async () => {
      // Create a package ref
      const hash = 'a'.repeat(64);
      const refDir = join(testRepoPath, 'packages', 'test-pkg');
      mkdirSync(refDir, { recursive: true });
      writeFileSync(join(refDir, '1.0.0'), hash + '\n');

      const roots = await collectAllRoots(storage.repos, testRepoPath);
      assert.ok(roots.has(hash));
    });
  });

  describe('markReachable', () => {
    // Helper: create a tree type with DataRef fields
    const makeTreeType = (fieldNames: string[]) => {
      const fields: Record<string, typeof DataRefType> = {};
      for (const name of fieldNames) {
        fields[name] = DataRefType;
      }
      return StructType(fields);
    };

    it('follows PackageObject → TaskObject → IR chain', async () => {
      const irHash = 'c'.repeat(64);

      // Encode a TaskObject referencing the IR hash
      const taskEncoder = encodeBeast2For(TaskObjectType);
      const taskData = taskEncoder({
        kind: TASK_OBJECT_KIND,
        body: variant('command', { commandIr: irHash }),
        runner: variant('custom', { command: [] }),
        inputs: [{ path: [variant('field', 'x')], partition: none }],
        output: { path: [variant('field', 'y')], kind: variant('value', null) },
        role: variant('data', null),
        environment: none,
      } as TaskObject);
      const taskHash = 'b'.repeat(64);

      // Encode a PackageObject referencing the task
      const pkgEncoder = encodeBeast2For(PackageObjectType);
      const pkgData = pkgEncoder({
        tasks: new Map([['myTask', taskHash]]),
        data: {
          structure: variant('struct', new Map()),
          refs: new Map(),
        },
        functions: new Map(),
        records: new Map(), sources: new Map(),
      } as PackageObject);
      const pkgHash = 'a'.repeat(64);

      const objects = new Map<string, Uint8Array>();
      objects.set(pkgHash, pkgData);
      objects.set(taskHash, taskData);
      // irHash is NOT in the object store — it is a leaf

      const readObject = async (hash: string) => objects.get(hash) ?? null;
      const reachable = await markReachable(readObject, new Set([pkgHash]));

      // Package (read) + task (read) + IR leaf (not read)
      assert.ok(reachable.has(pkgHash), 'package should be reachable');
      assert.ok(reachable.has(taskHash), 'task should be reachable');
      assert.ok(reachable.has(irHash), 'IR leaf should be reachable (marked without reading)');
      assert.strictEqual(reachable.size, 3);
    });

    it('follows TaskObject → EnvironmentSpec → blob chain', async () => {
      const irHash = 'c'.repeat(64);
      const pyprojectHash = 'd'.repeat(64);
      const lockHash = 'e'.repeat(64);
      const sdistHash = 'f'.repeat(64);

      const specEncoder = encodeBeast2For(EnvironmentSpecType);
      const specData = specEncoder(variant('python', {
        pyproject: pyprojectHash,
        lock: lockHash,
        sdists: [{ filename: 'envtest-0.1.0.tar.gz', hash: sdistHash }],
      }));
      const envHash = 'b'.repeat(63) + '1';

      const taskEncoder = encodeBeast2For(TaskObjectType);
      const taskData = taskEncoder({
        kind: TASK_OBJECT_KIND,
        body: variant('command', { commandIr: irHash }),
        runner: variant('custom', { command: [] }),
        inputs: [{ path: [variant('field', 'x')], partition: none }],
        output: { path: [variant('field', 'y')], kind: variant('value', null) },
        role: variant('data', null),
        environment: some(envHash),
      } as TaskObject);
      const taskHash = 'b'.repeat(64);

      const objects = new Map<string, Uint8Array>();
      objects.set(taskHash, taskData);
      objects.set(envHash, specData);
      // the blobs are leaves — not in the store

      const readObject = async (hash: string) => objects.get(hash) ?? null;
      const reachable = await markReachable(readObject, new Set([taskHash]));

      assert.ok(reachable.has(envHash), 'environment spec should be reachable');
      assert.ok(reachable.has(pyprojectHash), 'pyproject blob should be reachable');
      assert.ok(reachable.has(lockHash), 'lockfile blob should be reachable');
      assert.ok(reachable.has(sdistHash), 'sdist blob should be reachable');
      assert.ok(reachable.has(irHash), 'IR leaf should be reachable');
      assert.strictEqual(reachable.size, 6);
    });

    it('follows TaskObject → tools EnvironmentSpec → file blobs', async () => {
      const fileHashA = 'a'.repeat(63) + '1';
      const fileHashB = 'a'.repeat(63) + '2';
      const specData = encodeBeast2For(EnvironmentSpecType)(variant('tools', {
        files: [{ path: 'bin/runner', hash: fileHashA }, { path: 'bin/helper', hash: fileHashB }],
      }));
      const envHash = 'b'.repeat(63) + '3';
      const taskData = encodeBeast2For(TaskObjectType)({
        kind: TASK_OBJECT_KIND,
        body: variant('command', { commandIr: 'c'.repeat(64) }),
        runner: variant('custom', { command: [] }),
        inputs: [{ path: [variant('field', 'x')], partition: none }],
        output: { path: [variant('field', 'y')], kind: variant('value', null) },
        role: variant('data', null),
        environment: some(envHash),
      } as TaskObject);
      const taskHash = 'd'.repeat(64);

      const objects = new Map<string, Uint8Array>([[taskHash, taskData], [envHash, specData]]);
      const reachable = await markReachable(async (h) => objects.get(h) ?? null, new Set([taskHash]));

      assert.ok(reachable.has(envHash), 'tools spec reachable');
      assert.ok(reachable.has(fileHashA), 'tools file A reachable');
      assert.ok(reachable.has(fileHashB), 'tools file B reachable');
    });

    it('follows TaskObject → workspace_node EnvironmentSpec → member + config blobs', async () => {
      const pkgJson = 'e'.repeat(63) + '1';
      const lock = 'e'.repeat(63) + '2';
      const config = 'e'.repeat(63) + '3';
      const tarballA = 'e'.repeat(63) + '4';
      const tarballB = 'e'.repeat(63) + '5';
      const specData = encodeBeast2For(EnvironmentSpecType)(variant('workspace_node', {
        packageJson: pkgJson, lock, config: some(config), subject: 'packages/pricing',
        members: [
          { path: 'packages/common', name: '@acme/common', tarball: tarballA },
          { path: 'packages/pricing', name: '@acme/pricing', tarball: tarballB },
        ],
      }));
      const envHash = 'f'.repeat(63) + '6';
      const taskData = encodeBeast2For(TaskObjectType)({
        kind: TASK_OBJECT_KIND,
        body: variant('command', { commandIr: 'c'.repeat(64) }),
        runner: variant('custom', { command: [] }),
        inputs: [{ path: [variant('field', 'x')], partition: none }],
        output: { path: [variant('field', 'y')], kind: variant('value', null) },
        role: variant('data', null),
        environment: some(envHash),
      } as TaskObject);
      const taskHash = 'a'.repeat(64);

      const objects = new Map<string, Uint8Array>([[taskHash, taskData], [envHash, specData]]);
      const reachable = await markReachable(async (h) => objects.get(h) ?? null, new Set([taskHash]));

      for (const [label, h] of [['packageJson', pkgJson], ['lock', lock], ['config', config], ['member A tarball', tarballA], ['member B tarball', tarballB]] as const) {
        assert.ok(reachable.has(h), `${label} reachable`);
      }
    });

    it('follows TreeObject DataRef children', async () => {
      const subtreeHash = 'b'.repeat(64);
      const valueHash = 'c'.repeat(64);

      // Encode a tree with both a tree ref and a value ref
      const treeType = makeTreeType(['subtree', 'leaf']);
      const treeEncoder = encodeBeast2For(treeType);
      const treeData = treeEncoder({
        subtree: variant('tree', subtreeHash),
        leaf: variant('value', valueHash),
      });
      const treeHash = 'a'.repeat(64);

      const objects = new Map<string, Uint8Array>();
      objects.set(treeHash, treeData);
      // subtreeHash and valueHash not in store

      const readObject = async (hash: string) => objects.get(hash) ?? null;
      const reachable = await markReachable(readObject, new Set([treeHash]));

      assert.ok(reachable.has(treeHash), 'tree should be reachable');
      assert.ok(reachable.has(valueHash), 'value leaf should be reachable (marked without reading)');
      // subtreeHash pushed to stack, readObject returns null
      assert.ok(!reachable.has(subtreeHash), 'subtree should not be reachable when object is missing');
      assert.strictEqual(reachable.size, 2);
    });

    it('skips unassigned and null DataRefs', async () => {
      // Tree with only unassigned/null refs — no children to follow
      const treeType = makeTreeType(['pending', 'empty']);
      const treeEncoder = encodeBeast2For(treeType);
      const treeData = treeEncoder({
        pending: variant('unassigned', null),
        empty: variant('null', null),
      });
      const treeHash = 'a'.repeat(64);

      const objects = new Map<string, Uint8Array>();
      objects.set(treeHash, treeData);

      const readObject = async (hash: string) => objects.get(hash) ?? null;
      const reachable = await markReachable(readObject, new Set([treeHash]));

      assert.strictEqual(reachable.size, 1); // Only the tree itself
      assert.ok(reachable.has(treeHash));
    });

    it('handles non-BEAST2 data gracefully', async () => {
      const hashA = 'a'.repeat(64);

      const objects = new Map<string, Uint8Array>();
      objects.set(hashA, new Uint8Array([1, 2, 3, 4, 5])); // Not BEAST2

      const readObject = async (hash: string) => objects.get(hash) ?? null;
      const reachable = await markReachable(readObject, new Set([hashA]));

      // Object is reachable but treated as leaf (no children)
      assert.strictEqual(reachable.size, 1);
      assert.ok(reachable.has(hashA));
    });

    it('handles missing objects gracefully', async () => {
      const hashA = 'a'.repeat(64);
      const readObject = async (_hash: string) => null;
      const reachable = await markReachable(readObject, new Set([hashA]));

      // Root was not reachable because the object doesn't exist
      assert.strictEqual(reachable.size, 0);
    });

    it('handles DAG deduplication (shared objects)', async () => {
      // Two trees both reference the same value
      const sharedValueHash = 'c'.repeat(64);

      const treeType = makeTreeType(['data']);
      const treeEncoder = encodeBeast2For(treeType);

      const tree1Data = treeEncoder({ data: variant('value', sharedValueHash) });
      const tree1Hash = 'a'.repeat(64);

      const tree2Data = treeEncoder({ data: variant('value', sharedValueHash) });
      const tree2Hash = 'b'.repeat(64);

      const objects = new Map<string, Uint8Array>();
      objects.set(tree1Hash, tree1Data);
      objects.set(tree2Hash, tree2Data);

      const readObject = async (hash: string) => objects.get(hash) ?? null;
      const reachable = await markReachable(readObject, new Set([tree1Hash, tree2Hash]));

      assert.strictEqual(reachable.size, 3); // tree1, tree2, shared value
      assert.ok(reachable.has(sharedValueHash));
    });

    describe('header-first', () => {
      /** An object map with spies on whole reads and head reads. */
      const tracedStore = (objects: Map<string, Uint8Array>) => {
        const wholeReads: string[] = [];
        const headReads: { hash: string; length: number }[] = [];
        return {
          wholeReads,
          headReads,
          readObject: async (hash: string) => {
            wholeReads.push(hash);
            return objects.get(hash) ?? null;
          },
          readHead: async (hash: string, length: number) => {
            headReads.push({ hash, length });
            return objects.get(hash)?.subarray(0, length) ?? null;
          },
        };
      };

      it('reads only structural objects whole and marks every other object from its head', async () => {
        const irHash = 'c'.repeat(64);
        const taskHash = 'b'.repeat(64);
        const pkgHash = 'a'.repeat(64);
        const datasetHash = 'd'.repeat(64);
        const objects = new Map<string, Uint8Array>([
          [pkgHash, encodeBeast2For(PackageObjectType)({
            tasks: new Map([['myTask', taskHash]]),
            data: { structure: variant('struct', new Map()), refs: new Map() },
            functions: new Map(),
            records: new Map(), sources: new Map(),
          } as PackageObject)],
          [taskHash, encodeBeast2For(TaskObjectType)({
            kind: TASK_OBJECT_KIND,
            body: variant('command', { commandIr: irHash }),
            runner: variant('custom', { command: [] }),
            inputs: [{ path: [variant('field', 'x')], partition: none }],
            output: { path: [variant('field', 'y')], kind: variant('value', null) },
            role: variant('data', null),
            environment: none,
          } as TaskObject)],
          // A dataset rooted directly, as a workspace's dataset refs are.
          [datasetHash, encodeBeast2For(StructType({ name: StringType, count: IntegerType }))({ name: 'x'.repeat(200_000), count: 1n })],
        ]);
        const store = tracedStore(objects);

        const reachable = await markReachable(store.readObject, new Set([pkgHash, datasetHash]), { readHead: store.readHead });

        assert.deepStrictEqual([...reachable].sort(), [pkgHash, taskHash, irHash, datasetHash].sort());
        assert.deepStrictEqual(store.wholeReads.sort(), [pkgHash, taskHash].sort(), 'only the package and the task are read whole');
        assert.ok(store.headReads.every((read) => read.length === 64 * 1024), 'every type fits the first head probe');
      });

      it('keeps a partition plan\'s slices and merge ranges reachable', async () => {
        const planHash = 'e'.repeat(64);
        const slices = [['1'.repeat(64), '2'.repeat(64)], ['3'.repeat(64), '4'.repeat(64)]];
        const ranges = ['7'.repeat(64), '8'.repeat(64)];
        const objects = new Map([[planHash, encodePartitionPlan({
          partitions: ['5'.repeat(64), '6'.repeat(64)],
          boundaries: [0n, 3n],
          splits: [[{ seg: 0n, offset: 0n }, { seg: 1n, offset: 2n }, { seg: 4n, offset: 0n }]],
          slices,
          merges: [{ partials: ['a'.repeat(64), 'b'.repeat(64)], ranges }],
        })]]);
        const store = tracedStore(objects);

        const reachable = await markReachable(store.readObject, new Set([planHash]), { readHead: store.readHead });

        // Every partition slice and every range blob is marked, without
        // being read.
        assert.deepStrictEqual([...reachable].sort(), [planHash, ...slices.flat(), ...ranges].sort());
        assert.deepStrictEqual(store.wholeReads, [planHash], 'the slices and ranges are marked without being read');
      });

      it('keeps the plan reachable once the plan type has grown a field', async () => {
        // gc classifies a plan by matching a PREFIX of PartitionPlanType's
        // fields, so appending one — the migration this type is designed for
        // — must keep gc marking the plan's slices and ranges. Getting this
        // wrong loses them silently: an unrecognised plan is a leaf, its
        // children are never extracted, and the sweep deletes them.
        const planFields = (toEastTypeValue(PartitionPlanType).value as { name: string; type: unknown }[]);
        const grown = fromEastTypeValue(variant('Struct', [
          ...planFields,
          { name: 'a_field_appended_later', type: toEastTypeValue(IntegerType) },
        ]) as never);
        const planHash = 'e'.repeat(64);
        const slices = [['1'.repeat(64), '2'.repeat(64)]];
        const ranges = ['7'.repeat(64)];
        const objects = new Map([[planHash, encodeBeast2For(grown as never)({
          partitions: ['5'.repeat(64)],
          boundaries: [0n],
          splits: [[{ seg: 0n, offset: 0n }, { seg: 4n, offset: 0n }]],
          slices,
          merges: [{ partials: ['a'.repeat(64)], ranges }],
          a_field_appended_later: 0n,
        } as never)]]);
        const store = tracedStore(objects);

        const reachable = await markReachable(store.readObject, new Set([planHash]), { readHead: store.readHead });

        assert.deepStrictEqual([...reachable].sort(), [planHash, ...slices.flat(), ...ranges].sort());
      });

      it('pins gc\'s plan prefix to PartitionPlanType\'s field order', () => {
        // The prefix match above only holds while the plan grows by APPENDING.
        // A field inserted or reordered would make older plans stop matching,
        // and gc would quietly stop marking their slices and ranges — so pin
        // the fields every vintage carries to the front, in order.
        const fields = (toEastTypeValue(PartitionPlanType).value as { name: string }[]).map((f) => f.name);
        assert.deepStrictEqual(
          fields.slice(0, 4),
          ['partitions', 'boundaries', 'splits', 'slices'],
          'a plan field must be APPENDED, never inserted or reordered — see isPartitionPlanShape',
        );
      });

      it('keeps what a unit plan names reachable: its task, the pieces\' inputs, and the merges\' parts and ranges', async () => {
        const taskHash = 'b'.repeat(64);
        const irHash = 'c'.repeat(64);
        const pieces = [['1'.repeat(64), '2'.repeat(64)], ['3'.repeat(64), '2'.repeat(64)]];
        const parts = ['4'.repeat(64), '5'.repeat(64)];
        const passing = '6'.repeat(64);
        const range = '7'.repeat(64);
        const piecesPlan = 'd'.repeat(64);
        const mergePlan = 'e'.repeat(64);
        const objects = new Map<string, Uint8Array>([
          [piecesPlan, encodeUnitPlan({ kind: UNIT_PLAN_KIND, task: taskHash, inputs: '9'.repeat(64), stage: variant('pieces', pieces) })],
          [mergePlan, encodeUnitPlan({
            kind: UNIT_PLAN_KIND,
            task: taskHash,
            inputs: '9'.repeat(64),
            stage: variant('merge', { level: 1n, levels: 2n, groups: [{ range: some(range), entries: parts }, { range: none, entries: [passing] }] }),
          })],
          [taskHash, encodeBeast2For(TaskObjectType)({
            kind: TASK_OBJECT_KIND,
            body: variant('command', { commandIr: irHash }),
            runner: variant('custom', { command: [] }),
            inputs: [{ path: [variant('field', 'x')], partition: none }],
            output: { path: [variant('field', 'y')], kind: variant('value', null) },
            role: variant('data', null),
            environment: none,
          } as TaskObject)],
        ]);
        const store = tracedStore(objects);

        const reachable = await markReachable(store.readObject, new Set([piecesPlan, mergePlan]), { readHead: store.readHead });

        assert.deepStrictEqual(
          [...reachable].sort(),
          [...new Set([piecesPlan, mergePlan, taskHash, irHash, ...pieces.flat(), ...parts, passing, range])].sort(),
        );
        assert.deepStrictEqual(store.wholeReads.sort(), [piecesPlan, mergePlan, taskHash].sort(), 'what a plan names is marked without being read');
      });

      it('treats a unit-plan-shaped struct carrying another kind as a leaf', async () => {
        const root = 'f'.repeat(64);
        const input = '1'.repeat(64);
        const store = tracedStore(new Map([[root, encodeUnitPlan({
          kind: '$something-else', task: 'b'.repeat(64), inputs: '9'.repeat(64), stage: variant('pieces', [[input]]),
        })]]));

        const reachable = await markReachable(store.readObject, new Set([root]), { readHead: store.readHead });

        assert.deepStrictEqual([...reachable], [root]);
      });

      it('grows the head while a type section does not fit, and never reads the dataset whole', async () => {
        const WideType = StructType(Object.fromEntries(
          Array.from({ length: 4000 }, (_, i) => [`a_field_with_a_rather_long_name_number_${i}`, IntegerType])));
        const value = Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`a_field_with_a_rather_long_name_number_${i}`, 0n]));
        const datasetHash = 'f'.repeat(64);
        const bytes = encodeBeast2For(WideType)(value);
        assert.ok(bytes.length > 64 * 1024, 'precondition: the type section outgrows the first probe');
        const store = tracedStore(new Map([[datasetHash, bytes]]));

        const reachable = await markReachable(store.readObject, new Set([datasetHash]), { readHead: store.readHead });

        assert.ok(reachable.has(datasetHash));
        assert.deepStrictEqual(store.headReads.map((read) => read.length), [64 * 1024, 1024 * 1024]);
        assert.deepStrictEqual(store.wholeReads, []);
      });

      it('treats an object whose head yields no type as a leaf, and a missing one as unreachable', async () => {
        const junkHash = 'a'.repeat(64);
        const missingHash = 'b'.repeat(64);
        const store = tracedStore(new Map([[junkHash, new Uint8Array(100).fill(7)]]));

        const reachable = await markReachable(store.readObject, new Set([junkHash, missingHash]), { readHead: store.readHead });

        assert.deepStrictEqual([...reachable], [junkHash]);
        assert.deepStrictEqual(store.wholeReads, []);
      });
    });

    it('reads a value to learn its type when the store serves no head reads', async () => {
      // Without ranged reads there is no head to classify a value by, and a
      // value may be a manifest naming segment objects, so it is read whole —
      // a plain one is then marked and names nothing (the manifest recognizer
      // below walks the other kind).
      const valueHash = 'b'.repeat(64);

      const treeType = makeTreeType(['data']);
      const treeEncoder = encodeBeast2For(treeType);
      const treeData = treeEncoder({ data: variant('value', valueHash) });
      const treeHash = 'a'.repeat(64);

      const readCalls: string[] = [];
      const objects = new Map<string, Uint8Array>();
      objects.set(treeHash, treeData);
      objects.set(valueHash, new Uint8Array([99]));

      const readObject = async (hash: string) => {
        readCalls.push(hash);
        return objects.get(hash) ?? null;
      };
      const reachable = await markReachable(readObject, new Set([treeHash]));

      assert.ok(reachable.has(valueHash), 'value should be reachable');
      assert.ok(readCalls.includes(valueHash), 'the value is read to learn its type');
      assert.strictEqual(reachable.size, 2, 'a plain value names nothing');
    });
  });

  describe('sweepBatch', () => {
    it('marks unreachable old objects for deletion', () => {
      const objects: GcObjectEntry[] = [
        { hash: 'a'.repeat(64), lastModified: 0, size: 100 },
        { hash: 'b'.repeat(64), lastModified: 0, size: 200 },
      ];
      const reachable = new Set<string>();

      const result = sweepBatch(objects, reachable, 0);

      assert.strictEqual(result.toDelete.length, 2);
      assert.strictEqual(result.retained, 0);
      assert.strictEqual(result.bytesFreed, 300);
    });

    it('retains reachable objects', () => {
      const hashA = 'a'.repeat(64);
      const objects: GcObjectEntry[] = [
        { hash: hashA, lastModified: 0, size: 100 },
      ];
      const reachable = new Set([hashA]);

      const result = sweepBatch(objects, reachable, 0);

      assert.strictEqual(result.toDelete.length, 0);
      assert.strictEqual(result.retained, 1);
    });

    it('skips young objects', () => {
      const objects: GcObjectEntry[] = [
        { hash: 'a'.repeat(64), lastModified: Date.now(), size: 100 },
      ];
      const reachable = new Set<string>();

      const result = sweepBatch(objects, reachable, 60000);

      assert.strictEqual(result.toDelete.length, 0);
      assert.strictEqual(result.skippedYoung, 1);
    });
  });

  // A record's state blob is an arbitrary user struct that flows through the same
  // reachability dispatch as commits/mutations. The shape guards match an EXACT
  // field set so a user value that merely resembles a commit/mutation is treated
  // as an opaque leaf — its string fields must NOT be probed as child hashes (or
  // GC could mark junk reachable, or read a non-hash as a hash).
  describe('record shape guards do not misclassify user structs', () => {
    const FAKE_CHILD = 'a'.repeat(64);
    const trace = (objects: Map<string, Uint8Array>) =>
      async (h: string): Promise<Uint8Array | null> => objects.get(h) ?? null;

    it('a 6-field struct missing a commit field is a leaf (fields not followed)', async () => {
      // parent/state/mutation/args/actor + 'extra' (not 'at'): size 6, not a commit.
      const NearCommit = StructType({ parent: StringType, state: StringType, mutation: StringType, args: StringType, actor: StringType, extra: StringType });
      const root = 'near-commit'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(NearCommit)({ parent: 'x', state: FAKE_CHILD, mutation: 'x', args: 'x', actor: 'x', extra: 'x' })]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(root));
      assert.ok(!reachable.has(FAKE_CHILD), 'the "state"-named string must not be probed as a child hash');
    });

    it('a 3-field struct missing the mutation runner field is a leaf', async () => {
      // bodyIr/argTypes + 'extra' (not 'runner'): size 3, not a mutation.
      const NearMutation = StructType({ bodyIr: StringType, argTypes: StringType, extra: StringType });
      const root = 'near-mutation'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(NearMutation)({ bodyIr: FAKE_CHILD, argTypes: 'x', extra: 'x' })]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(!reachable.has(FAKE_CHILD), 'the "bodyIr"-named string must not be followed');
    });

    it('a genuine RecordCommit IS traversed: its state blob stays reachable', async () => {
      const STATE = 'b'.repeat(64);
      const root = 'real-commit'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(RecordCommitType)({ parent: none, state: STATE, mutation: '$init', args: none, actor: 'system', at: new Date(0), delta: none })]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(STATE), 'a real commit must keep its state blob reachable');
    });

    it('a genuine MutationObject IS traversed: its bodyIr stays reachable', async () => {
      const BODY = 'c'.repeat(64);
      const root = 'real-mutation'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(MutationObjectType)({ bodyIr: BODY, argTypes: [toEastTypeValue(IntegerType)], runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }), form: 'reduce', programIr: '' })]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(BODY), 'a real mutation must keep its bodyIr reachable');
    });
  });

  // An index object is the only thing naming the programs a rebuild runs, and
  // a state read at an older commit names it long after the package that
  // declared it is gone. Unrecognised, it is a leaf: the bundles go unmarked,
  // the sweep takes them, and the index can never be rebuilt again.
  describe('the record index recognizer', () => {
    const trace = (objects: Map<string, Uint8Array>) =>
      async (h: string): Promise<Uint8Array | null> => objects.get(h) ?? null;
    const KEY_IR = '1'.repeat(64);
    const VALUE_IR = '2'.repeat(64);
    const BUILD_IR = '3'.repeat(64);
    const index = {
      keyIr: KEY_IR,
      multi: false,
      valueIr: some(VALUE_IR),
      keyType: toEastTypeValue(IntegerType),
      valueType: toEastTypeValue(StringType),
      buildIr: BUILD_IR,
      runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }),
    };

    it('keeps every IR bundle an index object names reachable', async () => {
      const root = 'an-index'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(RecordIndexObjectType)(index)]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      for (const [label, hash] of [
        ['the key function', KEY_IR], ['the covering projection', VALUE_IR], ['the build program', BUILD_IR],
      ] as const) {
        assert.ok(reachable.has(hash), `${label} must survive`);
      }
    });

    it('keeps them reachable once the index type has grown a field', async () => {
      // gc classifies an index object by matching a PREFIX of
      // RecordIndexObjectType's fields, so appending one — how this type is
      // designed to grow — must keep the bundles marked. Counting the fields
      // instead does not survive the append.
      const fields = toEastTypeValue(RecordIndexObjectType).value as { name: string; type: unknown }[];
      const grown = fromEastTypeValue(variant('Struct', [
        ...fields,
        { name: 'a_field_appended_later', type: toEastTypeValue(IntegerType) },
      ]) as never);
      const root = 'a-newer-index'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(grown as never)({
        ...index, a_field_appended_later: 0n,
      } as never)]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      for (const hash of [KEY_IR, VALUE_IR, BUILD_IR]) assert.ok(reachable.has(hash));
    });

    it('treats a struct that stops short of the index fields as a leaf', async () => {
      // A struct with all but the last of the index's fields is not an index
      // object, and its hash-shaped strings must not be probed as children.
      const NearIndex = StructType({
        keyIr: StringType, multi: StringType, valueIr: StringType, keyType: StringType,
        valueType: StringType, buildIr: StringType,
      });
      const root = 'near-index'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(NearIndex)({
        keyIr: KEY_IR, multi: 'x', valueIr: 'x', keyType: 'x', valueType: 'x', buildIr: BUILD_IR,
      })]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(root));
      assert.ok(!reachable.has(KEY_IR), 'the "keyIr"-named string must not be followed');
    });
  });

  // A task object names the program a deployed package runs and the functions
  // and value its output folds with. Unrecognised, it is a leaf: they go
  // unmarked, and the sweep deletes what the package runs.
  describe('the task object recognizer', () => {
    const trace = (objects: Map<string, Uint8Array>) =>
      async (h: string): Promise<Uint8Array | null> => objects.get(h) ?? null;
    const PROGRAM = '1'.repeat(64);
    const MERGE = '2'.repeat(64);
    const ZERO = '3'.repeat(64);
    const COMBINE = '4'.repeat(64);
    const ENV = '5'.repeat(64);
    const TOOL = '6'.repeat(64);
    // The environment is read to find the files it names, so it must exist.
    const environment: [string, Uint8Array] = [ENV, encodeBeast2For(EnvironmentSpecType)(variant('tools', {
      files: [{ path: 'bin/solver', hash: TOOL }],
    }))];
    const task: TaskObject = {
      kind: TASK_OBJECT_KIND,
      body: variant('east', { program: PROGRAM }),
      runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }),
      inputs: [{ path: [variant('field', 'x')], partition: some({ by: ['k'] }) }],
      output: { path: [variant('field', 'y')], kind: variant('fold', { zero: ZERO, combine: COMBINE }) },
      role: variant('data', null),
      environment: some(ENV),
    };

    it('keeps the program, what the output folds with, and the environment reachable', async () => {
      const folds = 'a-fold-task'.padEnd(64, '0');
      const merges = 'a-dict-task'.padEnd(64, '0');
      const objects = new Map([
        [folds, encodeBeast2For(TaskObjectType)(task)],
        [merges, encodeBeast2For(TaskObjectType)({ ...task, output: { path: [variant('field', 'y')], kind: variant('dict', { merge: some(MERGE) }) } })],
        environment,
      ]);

      const reachable = await markReachable(trace(objects), new Set([folds, merges]));
      for (const [label, hash] of [
        ['the program', PROGRAM], ['the dict merge', MERGE], ['the fold zero', ZERO],
        ['the fold combine', COMBINE], ['the environment', ENV], ['the environment\'s file', TOOL],
      ] as const) {
        assert.ok(reachable.has(hash), `${label} must survive`);
      }
    });

    it('keeps them reachable once the task object has grown a field', async () => {
      const fields = toEastTypeValue(TaskObjectType).value as { name: string; type: unknown }[];
      const grown = fromEastTypeValue(variant('Struct', [
        ...fields,
        { name: 'a_field_appended_later', type: toEastTypeValue(IntegerType) },
      ]) as never);
      const root = 'a-newer-task'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(grown as never)({ ...task, a_field_appended_later: 0n } as never)], environment]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      for (const hash of [PROGRAM, ZERO, COMBINE, ENV, TOOL]) assert.ok(reachable.has(hash));
    });

    it('treats a task-shaped struct carrying another kind as a leaf', async () => {
      const root = 'not-a-task'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(TaskObjectType)({ ...task, kind: '$something-else' })]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(root));
      assert.ok(!reachable.has(PROGRAM), 'an object carrying another kind must not be traversed as a task');
    });

    it('keeps the command IR and environment of a task object an older SDK wrote', async () => {
      // The shape every task object had before the typed task object. A
      // repository keeps its packages until they are removed, so gc recognises
      // it by its shape for as long as one can be deployed.
      const PreCutoverTaskObjectType = StructType({
        commandIr: StringType,
        inputs: ArrayType(TreePathType),
        output: TreePathType,
        kind: OptionType(StringType),
        metadata: OptionType(BlobType),
        runner: RunnerType,
        environment: OptionType(StringType),
      });
      const root = 'an-older-task'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(PreCutoverTaskObjectType)({
        commandIr: PROGRAM,
        inputs: [[variant('field', 'x')]],
        output: [variant('field', 'y')],
        kind: none,
        metadata: none,
        runner: variant('custom', { command: [] }),
        environment: some(ENV),
      })], environment]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(PROGRAM), 'the command IR must survive');
      assert.ok(reachable.has(ENV) && reachable.has(TOOL), 'the environment and its file must survive');
    });
  });

  describe('the collection manifest recognizer', () => {
    const trace = (objects: Map<string, Uint8Array>) =>
      async (h: string): Promise<Uint8Array | null> => objects.get(h) ?? null;
    const HEADER = 'f'.repeat(64);

    /** A manifest naming `n` segment objects — the shape a collection dataset
     *  ref points at. */
    const manifestOf = (level: bigint, n: number): Uint8Array =>
      encodeCollectionManifest({
        kind: COLLECTION_MANIFEST_KIND,
        level,
        type: toEastTypeValue(DictType(StringType, IntegerType)),
        rule: SEGMENT_RULE_KEYED,
        header: HEADER,
        entries: Array.from({ length: n }, (_, i) => ({
          hash: String(i).repeat(64).slice(0, 64),
          fence: new Uint8Array([i]),
          count: 1000n,
          bytes: 50_000n,
        })),
      });

    it('keeps every segment and the header reachable from a manifest', async () => {
      const root = 'manifest'.padEnd(64, '0');
      const objects = new Map([[root, manifestOf(0n, 3)]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(root));
      assert.ok(reachable.has(HEADER), 'the header bytes every segment is written under must survive');
      for (let i = 0; i < 3; i++) {
        assert.ok(reachable.has(String(i).repeat(64).slice(0, 64)), `segment ${i} must survive`);
      }
    });

    it('walks a manifest reached as a value when the store serves no head reads', async () => {
      // A store without ranged reads — e3-cloud's object store — holds
      // manifests too. A value child is read to learn its type there, and
      // walked when it is a manifest: marked and not walked, the manifest
      // would survive a sweep that took its header and every segment.
      const tree = 'tree'.padEnd(64, '0');
      const manifest = 'manifest'.padEnd(64, '0');
      const objects = new Map([
        [tree, encodeBeast2For(StructType({ rows: DataRefType }))({ rows: variant('value', manifest) })],
        [manifest, manifestOf(0n, 2)],
      ]);

      const reachable = await markReachable(trace(objects), new Set([tree]));
      assert.ok(reachable.has(manifest));
      assert.ok(reachable.has(HEADER), 'the header object must survive');
      for (let i = 0; i < 2; i++) {
        assert.ok(reachable.has(String(i).repeat(64).slice(0, 64)), `segment ${i} must survive`);
      }
    });

    it('walks a level-1 manifest\'s children rather than marking them', async () => {
      // Above level 0 an entry is a child manifest, which names objects of
      // its own: marking it without reading would sweep the segments below.
      const root = 'level-one'.padEnd(64, '0');
      const child = '0'.repeat(64);
      const objects = new Map([[root, manifestOf(1n, 1)], [child, manifestOf(0n, 2)]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(child));
      assert.ok(reachable.has('1'.repeat(64)), 'a grandchild segment must survive');
    });

    it('treats a same-shaped struct with another kind as a leaf', async () => {
      const root = 'not-a-manifest'.padEnd(64, '0');
      const objects = new Map([[root, encodeCollectionManifest({
        kind: '$something-else',
        level: 0n,
        type: toEastTypeValue(DictType(StringType, IntegerType)),
        rule: SEGMENT_RULE_KEYED,
        header: HEADER,
        entries: [{ hash: '0'.repeat(64), fence: new Uint8Array(), count: 1n, bytes: 1n }],
      })]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(root));
      assert.ok(!reachable.has(HEADER), 'an object carrying another kind must not be traversed as segments');
    });

    it('survives a real gc: a collection dataset keeps every segment it names', async () => {
      const type = DictType(StringType, IntegerType);
      const rows = new Map<string, bigint>();
      for (let i = 0; i < 20_000; i++) rows.set(`k${String(i).padStart(7, '0')}`, BigInt(i));

      const pkg = e3.package('gc-manifest', '1.0.0',
        e3.input('rows', type, variant('value', rows)));
      const zipPath = join(tempDir, 'gc-manifest.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepoPath, zipPath);

      const pkgObject = await packageRead(storage, testRepoPath, 'gc-manifest', '1.0.0');
      const ref = pkgObject.data.refs.get('inputs/rows');
      assert.ok(ref && ref.type === 'value');
      const hash = ref.type === 'value' ? ref.value.hash : '';
      const manifest = decodeCollectionManifest(await storage.objects.read(testRepoPath, hash));
      assert.ok(manifest.entries.length > 1, 'a 20k-row dict must hold more than one segment');

      const result = await repoGc(storage, testRepoPath, { minAge: 0 });
      assert.strictEqual(result.deletedObjects, 0);

      // Every object the manifest names must still be readable, and the value
      // must still decode — a sweep that took a segment would show up here.
      await storage.objects.read(testRepoPath, manifest.header);
      for (const entry of manifest.entries) await storage.objects.read(testRepoPath, entry.hash);
      const whole = decodeBeast2For(type)(await readDatasetWhole(storage, testRepoPath, hash)) as Map<string, bigint>;
      assert.strictEqual(whole.size, 20_000);
    });
  });

  // A kind-tagged object is walked by the tag table: its fields begin with a
  // released version of the kind, and it carries the kind's tag. A later
  // version, which appends fields, is walked for the fields this build knows.
  describe('the tag table', () => {
    const trace = (objects: Map<string, Uint8Array>) =>
      async (h: string): Promise<Uint8Array | null> => objects.get(h) ?? null;
    const PRIMARY = '1'.repeat(64);
    const INDEX_MANIFEST = '2'.repeat(64);
    const INDEX_OBJECT = '3'.repeat(64);
    const KEY_IR = '4'.repeat(64);

    it('keeps a record state\'s primary, its index manifests and the index objects they were built under reachable', async () => {
      const root = 'a-record-state'.padEnd(64, '0');
      const objects = new Map([
        [root, encodeBeast2For(RecordStateType)({
          kind: RECORD_STATE_KIND,
          primary: PRIMARY,
          indexes: new Map([['by_status', { manifest: INDEX_MANIFEST, index: INDEX_OBJECT }]]),
        })],
        // The index object is walked for the programs it names, so it exists.
        [INDEX_OBJECT, encodeBeast2For(RecordIndexObjectType)({
          keyIr: KEY_IR,
          multi: false,
          valueIr: none,
          keyType: toEastTypeValue(IntegerType),
          valueType: toEastTypeValue(StringType),
          buildIr: '5'.repeat(64),
          runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }),
        })],
      ]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      for (const [label, hash] of [
        ['the primary', PRIMARY], ['the index manifest', INDEX_MANIFEST],
        ['the index object', INDEX_OBJECT], ['the index\'s key function', KEY_IR],
      ] as const) {
        assert.ok(reachable.has(hash), `${label} must survive`);
      }
    });

    it('treats a record-state-shaped struct carrying another kind as a leaf', async () => {
      const root = 'not-a-state'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(RecordStateType)({
        kind: '$something-else',
        primary: PRIMARY,
        indexes: new Map([['by_status', { manifest: INDEX_MANIFEST, index: INDEX_OBJECT }]]),
      })]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.deepStrictEqual([...reachable], [root]);
    });

    it('walks a later manifest, which appends a field, for the segments it names', async () => {
      const grown = fromEastTypeValue(variant('Struct', [
        ...(toEastTypeValue(CollectionManifestType).value as { name: string; type: unknown }[]),
        { name: 'a_field_appended_later', type: toEastTypeValue(IntegerType) },
      ]) as never);
      const root = 'a-newer-manifest'.padEnd(64, '0');
      const header = 'f'.repeat(64);
      const segment = '7'.repeat(64);
      const objects = new Map([[root, encodeBeast2For(grown as never)({
        kind: COLLECTION_MANIFEST_KIND,
        level: 0n,
        type: toEastTypeValue(DictType(StringType, IntegerType)),
        rule: SEGMENT_RULE_KEYED,
        header,
        entries: [{ hash: segment, fence: new Uint8Array([1]), count: 10n, bytes: 100n }],
        a_field_appended_later: 0n,
      } as never)]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(header) && reachable.has(segment), 'the header and the segment must survive');
    });

    it('walks a later record state, which appends a field, for what it names', async () => {
      const grown = fromEastTypeValue(variant('Struct', [
        ...(toEastTypeValue(RecordStateType).value as { name: string; type: unknown }[]),
        { name: 'a_field_appended_later', type: toEastTypeValue(IntegerType) },
      ]) as never);
      const root = 'a-newer-state'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(grown as never)({
        kind: RECORD_STATE_KIND,
        primary: PRIMARY,
        indexes: new Map([['by_status', { manifest: INDEX_MANIFEST, index: INDEX_OBJECT }]]),
        a_field_appended_later: 0n,
      } as never)]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(PRIMARY) && reachable.has(INDEX_MANIFEST), 'the primary and the index manifest must survive');
    });

    it('walks a later unit plan, which appends a field, for what its stage names', async () => {
      const grown = fromEastTypeValue(variant('Struct', [
        ...(toEastTypeValue(UnitPlanType).value as { name: string; type: unknown }[]),
        { name: 'a_field_appended_later', type: toEastTypeValue(IntegerType) },
      ]) as never);
      const root = 'a-newer-plan'.padEnd(64, '0');
      const piece = '8'.repeat(64);
      const objects = new Map([[root, encodeBeast2For(grown as never)({
        kind: UNIT_PLAN_KIND,
        task: 'b'.repeat(64),
        inputs: '9'.repeat(64),
        stage: variant('pieces', [[piece]]),
        a_field_appended_later: 0n,
      } as never)]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(piece), 'the piece\'s input must survive');
    });
  });

  // An object without a tag is recognised by its shape, and a repository holds
  // every version of it that was ever released: each is pinned here. One gc
  // stops recognising is a leaf, and the next sweep deletes what it names.
  describe('every released version of an untagged shape', () => {
    const trace = (objects: Map<string, Uint8Array>) =>
      async (h: string): Promise<Uint8Array | null> => objects.get(h) ?? null;
    const VALUE = '1'.repeat(64);
    const BODY = '2'.repeat(64);

    it('walks a package from before functions', async () => {
      const root = 'a-legacy-package'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(StructType({ tasks: DictType(StringType, StringType), data: PackageDataType }))({
        tasks: new Map(),
        data: { structure: variant('struct', new Map()), refs: new Map([['inputs/x', variant('value', { hash: VALUE, versions: new Map() })]]) },
      })]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(VALUE), 'the dataset value must survive');
    });

    it('walks a package from before records', async () => {
      const root = 'a-functions-era-package'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(StructType({
        tasks: DictType(StringType, StringType),
        data: PackageDataType,
        functions: DictType(StringType, StringType),
      }))({
        tasks: new Map(),
        data: { structure: variant('struct', new Map()), refs: new Map([['inputs/x', variant('value', { hash: VALUE, versions: new Map() })]]) },
        functions: new Map(),
      })]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(VALUE), 'the dataset value must survive');
    });

    it('walks a package from before sources', async () => {
      const root = 'a-records-era-package'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(StructType({
        tasks: DictType(StringType, StringType),
        data: PackageDataType,
        functions: DictType(StringType, StringType),
        records: DictType(StringType, StringType),
      }))({
        tasks: new Map(),
        data: { structure: variant('struct', new Map()), refs: new Map([['inputs/x', variant('value', { hash: VALUE, versions: new Map() })]]) },
        functions: new Map(),
        records: new Map(),
      })]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(VALUE), 'the dataset value must survive');
    });

    it('walks a function from before environments', async () => {
      const root = 'an-older-function'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(StructType({
        bodyIr: StringType,
        inputTypes: ArrayType(EastTypeType),
        outputType: EastTypeType,
        runner: RunnerType,
      }))({
        bodyIr: BODY,
        inputTypes: [toEastTypeValue(IntegerType)],
        outputType: toEastTypeValue(IntegerType),
        runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }),
      })]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(BODY), 'the function body must survive');
    });

    it('walks a record from before indexes, and the mutations it names', async () => {
      const root = 'an-older-record'.padEnd(64, '0');
      const mutation = 'a-mutation'.padEnd(64, '0');
      const objects = new Map([
        [root, encodeBeast2For(StructType({ path: StringType, mutations: DictType(StringType, StringType) }))({
          path: 'records/orders',
          mutations: new Map([['seed', mutation]]),
        })],
        [mutation, encodeBeast2For(MutationObjectType)({
          bodyIr: BODY,
          argTypes: [],
          runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }),
          form: 'reduce',
          programIr: '',
        })],
      ]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(mutation) && reachable.has(BODY), 'the mutation and its body must survive');
    });

    it('walks a mutation from before the delta', async () => {
      const root = 'an-older-mutation'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(StructType({
        bodyIr: StringType,
        argTypes: ArrayType(EastTypeType),
        runner: RunnerType,
      }))({
        bodyIr: BODY,
        argTypes: [toEastTypeValue(IntegerType)],
        runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }),
      })]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(BODY), 'the mutation body must survive');
    });

    it('walks a commit from before the delta', async () => {
      const root = 'an-older-commit'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(StructType({
        parent: OptionType(StringType),
        state: StringType,
        mutation: StringType,
        args: OptionType(StringType),
        actor: StringType,
        at: DateTimeType,
      }))({
        parent: none,
        state: VALUE,
        mutation: '$init',
        args: none,
        actor: 'system',
        at: new Date(0),
      })]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(VALUE), 'the state the commit produced must survive');
    });

    it('walks an environment spec from before tools', async () => {
      const root = 'an-older-environment'.padEnd(64, '0');
      const tarball = '3'.repeat(64);
      const objects = new Map([[root, encodeBeast2For(VariantType({
        python: PythonEnvironmentType,
        node: NodeEnvironmentType,
        image: ImageEnvironmentType,
      }))(variant('node', { packageJson: '4'.repeat(64), lock: '5'.repeat(64), tarballs: [tarball] }))]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(tarball), 'the project tarball must survive');
    });

    it('walks a partition plan from before merges', async () => {
      const root = 'an-older-plan'.padEnd(64, '0');
      const slice = '6'.repeat(64);
      const objects = new Map([[root, encodeBeast2For(StructType({
        partitions: ArrayType(StringType),
        boundaries: ArrayType(IntegerType),
        splits: ArrayType(ArrayType(StructType({ seg: IntegerType, offset: IntegerType }))),
        slices: ArrayType(ArrayType(StringType)),
      }))({
        partitions: ['7'.repeat(64)],
        boundaries: [0n],
        splits: [],
        slices: [[slice]],
      })]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(slice), 'the carved slice must survive');
    });
  });
});
