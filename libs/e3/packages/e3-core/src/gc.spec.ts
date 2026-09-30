/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * gc over e3-core's own backends: the contract suite every backend runs, over a
 * local repository and the in-memory backend; what a local repository's own
 * sweep removes; and the mark and the sweep's decision, which read no backend.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { DictType, IntegerType, StringType, StructType, SEGMENT_RULE_KEYED, encodeBeast2For, fromEastTypeValue, variant, some, none, toEastTypeValue } from '@elaraai/east';
import { PackageObjectType, PackageDataType, TASK_OBJECT_KIND, TaskObjectType, DataRefType, RecordCommitType, RecordIndexObjectType, RecordObjectType, MigrationObjectType, MutationObjectType, EnvironmentSpecType, COLLECTION_MANIFEST_KIND, CollectionManifestType, RECORD_STATE_KIND, RecordStateType, UNIT_PLAN_KIND, UnitPlanType, WorkspaceRecordType, encodeCollectionManifest, encodeUnitPlan } from '@elaraai/e3-types';
import type { PackageObject, TaskObject } from '@elaraai/e3-types';
import { gcTests } from './contract/index.js';
import { GcReadError } from './errors.js';
import { repoGc, markReachable, sweepBatch } from './gc.js';
import { executionPath, packageStagingPath, transferStagingPath } from './storage/local/localHelpers.js';
import { objectWrite } from './storage/local/LocalObjectStore.js';
import { sweepEnvironments } from './execution/environment.js';
import { getPidStartTime } from './execution/processHelpers.js';
import { createTestRepo, removeTestRepo, deadPid } from './test-helpers.js';
import { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';
import type { GcObjectEntry } from './storage/interfaces.js';

describe('over a local repository', () => {
  // Without the directory the repositories are in: gc needs none.
  gcTests(async (t) => {
    const repo = createTestRepo();
    t.after(() => removeTestRepo(repo));
    return {
      storage: new LocalStorage(),
      repo,
      damage: {
        execution: (taskHash, inputsHash, executionId) => {
          const dir = executionPath(repo, taskHash, inputsHash, executionId);
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'status.beast2'), 'not a record');
          return Promise.resolve();
        },
      },
    };
  });
});

describe('over the in-memory backend', () => {
  gcTests(async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create('repo');
    return {
      storage,
      repo: 'repo',
      damage: {
        execution: (taskHash, inputsHash, executionId) => {
          storage.refs.damageExecution('repo', taskHash, inputsHash, executionId);
          return Promise.resolve();
        },
      },
    };
  });
});

describe('gc', () => {
  let testRepoPath: string;
  let storage: StorageBackend;

  beforeEach(() => {
    testRepoPath = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(testRepoPath);
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

    it('removes a package zip a transfer staged in the repository and never finished', async () => {
      const stagingPath = packageStagingPath(testRepoPath, 'abc');
      assert.strictEqual(stagingPath, join(testRepoPath, 'tmp', 'transfers', 'abc.zip.partial'), 'the server stages exactly here');
      mkdirSync(dirname(stagingPath), { recursive: true });
      writeFileSync(stagingPath, 'a zip nobody downloaded');

      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedPartials, 1);
      assert.ok(!existsSync(stagingPath));
    });

    it('removes orphaned staging files from every record tree, and the repository record\'s at the root', async () => {
      const partials = [
        'repository.beast2.x1y2z3.partial',
        join('adoptions', 'ab', `${'c'.repeat(62)}.beast2.x1y2z3.partial`),
        join('locks', 'main', 'exclusive.beast2.4242.abcdef.partial'),
        join('workspaces', 'main', 'data', 'inputs', 'sales.beast2.x1y2z3.partial'),
        join('dataflows', 'main', '0190a0b0-5555-7000-8000-000000000000.beast2.x1y2z3.partial'),
      ];
      for (const partial of partials) {
        mkdirSync(dirname(join(testRepoPath, partial)), { recursive: true });
        writeFileSync(join(testRepoPath, partial), 'a crashed write');
      }

      const result = await repoGc(storage, testRepoPath, { minAge: 0 });

      assert.strictEqual(result.deletedPartials, partials.length);
      for (const partial of partials) assert.ok(!existsSync(join(testRepoPath, partial)), partial);
    });
  });

  describe('built environments', () => {
    it('keeps a built environment while a package names its spec, and removes it once none does', async () => {
      const spec = await objectWrite(testRepoPath, encodeBeast2For(EnvironmentSpecType)(variant('tools', { files: [] })));
      const task = await objectWrite(testRepoPath, encodeBeast2For(TaskObjectType)({
        kind: TASK_OBJECT_KIND,
        body: variant('command', { commandIr: 'c'.repeat(64) }),
        runner: variant('custom', { command: [] }),
        inputs: [],
        output: { path: [variant('field', 'y')], kind: variant('value', null) },
        role: variant('data', null),
        environment: some(spec),
      } as TaskObject));
      const pkg = await objectWrite(testRepoPath, encodeBeast2For(PackageObjectType)({
        tasks: new Map([['t', task]]),
        data: { structure: variant('struct', new Map()), refs: new Map() },
        functions: new Map(),
        records: new Map(), sources: new Map(),
      } as PackageObject));
      await storage.refs.packageWrite(testRepoPath, 'env-test', '1.0.0', pkg);
      const built = join(testRepoPath, 'envs', spec);
      mkdirSync(join(built, 'bin'), { recursive: true });

      await repoGc(storage, testRepoPath, { minAge: 0 });
      assert.ok(existsSync(built), 'a package still names the spec');

      await storage.refs.packageRemove(testRepoPath, 'env-test', '1.0.0');
      await repoGc(storage, testRepoPath, { minAge: 0, dryRun: true });
      assert.ok(existsSync(built), 'a dry run removes nothing');
      await repoGc(storage, testRepoPath, { minAge: 0 });
      assert.ok(!existsSync(built), 'nothing names the spec any more');
    });

    it('removes the build of a builder that has exited, and keeps a live one\'s', async () => {
      const envs = join(testRepoPath, 'envs');
      const reached = 'a'.repeat(64);
      const unreached = 'b'.repeat(64);
      const deadBuild = `${'c'.repeat(64)}.building-${deadPid()}-1`;
      const liveBuild = `${'d'.repeat(64)}.building-${process.pid}-${await getPidStartTime(process.pid)}`;
      for (const dir of [reached, unreached, deadBuild, liveBuild]) mkdirSync(join(envs, dir, 'bin'), { recursive: true });

      assert.strictEqual(await sweepEnvironments(testRepoPath, new Set([reached])), 2);
      assert.deepStrictEqual(readdirSync(envs).sort(), [reached, liveBuild].sort());
    });
  });

  describe('its root scans', () => {
    it('stop, sweeping nothing, when a deployed workspace\'s dataset ref cannot be read', async () => {
      // Skipped, the workspace would root nothing, and the sweep delete the
      // values its datasets name.
      const value = await objectWrite(testRepoPath, encodeBeast2For(StringType)('a value only a dataset names'));
      const pkg = await objectWrite(testRepoPath, encodeBeast2For(PackageObjectType)({
        tasks: new Map(),
        data: { structure: variant('struct', new Map()), refs: new Map() },
        functions: new Map(),
        records: new Map(), sources: new Map(),
      } as PackageObject));
      await storage.refs.workspaceWrite(testRepoPath, 'main', encodeBeast2For(WorkspaceRecordType)(some({
        packageName: 'scan', packageVersion: '1.0.0', packageHash: pkg, deployedAt: new Date(), currentRunId: none,
      })));
      await storage.datasets.write(testRepoPath, 'main', 'inputs/x', variant('value', { hash: value, versions: new Map() }));

      const datasets = storage.datasets;
      const read = datasets.read;
      datasets.read = () => Promise.reject(new Error('the ref store is throttling'));
      try {
        await assert.rejects(repoGc(storage, testRepoPath, { minAge: 0 }),
          /^Error: gc sweeps nothing while it cannot read what workspace 'main' names: the ref store is throttling$/);
      } finally {
        datasets.read = read;
      }
      assert.ok(await storage.objects.exists(testRepoPath, value), 'the value is still there');
      assert.strictEqual((await repoGc(storage, testRepoPath, { minAge: 0 })).deletedObjects, 0, 'read, the workspace roots its value');
    });
  });

  describe('dryRun option', () => {
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

  // ==========================================================================
  // Unit tests for shared algorithm functions
  // ==========================================================================

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

    it('stops at an object whose read fails for any reason but its absence, naming it', async () => {
      // Read as absence, the mark would stop here and a sweep delete what the
      // object names.
      const root = 'a'.repeat(64);
      const readObject = async (hash: string): Promise<Uint8Array | null> => {
        if (hash === root) throw new Error('connection reset by peer');
        return null;
      };
      await assert.rejects(markReachable(readObject, new Set([root])), (err: unknown) => {
        assert.ok(err instanceof GcReadError, `expected a GcReadError, got ${err}`);
        assert.strictEqual(err.hash, root);
        assert.strictEqual(err.undecodable, false);
        assert.match(err.message, /connection reset by peer/);
        return true;
      });
    });

    it('stops at an object whose head read fails for any reason but its absence', async () => {
      const root = 'b'.repeat(64);
      const readHead = async (): Promise<Uint8Array | null> => {
        throw new Error('the request timed out');
      };
      await assert.rejects(markReachable(async () => null, new Set([root]), { readHead }), (err: unknown) => {
        assert.ok(err instanceof GcReadError && err.hash === root && /the request timed out/.test(err.message));
        return true;
      });
    });

    it('stops at an object of a shape that names other objects when it does not decode, and keeps one that is not beast2 a leaf', async () => {
      const whole = encodeBeast2For(PackageObjectType)({
        tasks: new Map([['t', 'e'.repeat(64)]]),
        data: { structure: variant('struct', new Map()), refs: new Map() },
        functions: new Map(),
        records: new Map(), sources: new Map(),
      } as PackageObject);
      const broken = 'c'.repeat(64);
      const junk = 'd'.repeat(64);
      const objects = new Map<string, Uint8Array>([[broken, whole.subarray(0, whole.length - 1)], [junk, new Uint8Array([1, 2, 3])]]);
      const readObject = async (hash: string) => objects.get(hash) ?? null;
      const readHead = async (hash: string, length: number) => objects.get(hash)?.subarray(0, length) ?? null;

      for (const options of [{}, { readHead }]) {
        await assert.rejects(markReachable(readObject, new Set([broken]), options), (err: unknown) => {
          assert.ok(err instanceof GcReadError, `expected a GcReadError, got ${err}`);
          assert.strictEqual(err.hash, broken);
          assert.strictEqual(err.undecodable, true);
          return true;
        });
        assert.deepStrictEqual([...await markReachable(readObject, new Set([junk]), options)], [junk], 'not beast2: a leaf');
      }
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

      it('keeps what a unit plan names reachable: its task, the plan before it, the pieces\' inputs, and the merges\' parts and ranges', async () => {
        const taskHash = 'b'.repeat(64);
        const irHash = 'c'.repeat(64);
        const pieces = [['1'.repeat(64), '2'.repeat(64)], ['3'.repeat(64), '2'.repeat(64)]];
        const parts = ['4'.repeat(64), '5'.repeat(64)];
        const passing = '6'.repeat(64);
        const range = '7'.repeat(64);
        const piecesPlan = 'd'.repeat(64);
        const mergePlan = 'e'.repeat(64);
        const objects = new Map<string, Uint8Array>([
          [piecesPlan, encodeUnitPlan({ kind: UNIT_PLAN_KIND, task: taskHash, inputs: '9'.repeat(64), stage: variant('pieces', pieces), previous: none, peakBytes: none })],
          [mergePlan, encodeUnitPlan({
            kind: UNIT_PLAN_KIND,
            task: taskHash,
            inputs: '9'.repeat(64),
            stage: variant('merge', { level: 1n, levels: 2n, groups: [{ range: some(range), entries: parts }, { range: none, entries: [passing] }] }),
            previous: some(piecesPlan),
            peakBytes: some(1024n),
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

        // The merge level's plan alone, as a success record names its last.
        const reachable = await markReachable(store.readObject, new Set([mergePlan]), { readHead: store.readHead });

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
          kind: '$something-else', task: 'b'.repeat(64), inputs: '9'.repeat(64), stage: variant('pieces', [[input]]), previous: none, peakBytes: none,
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
        { hash: 'a'.repeat(64), lastModified: 0, size: 100, unreachableSince: null },
        { hash: 'b'.repeat(64), lastModified: 0, size: 200, unreachableSince: null },
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
        { hash: hashA, lastModified: 0, size: 100, unreachableSince: null },
      ];
      const reachable = new Set([hashA]);

      const result = sweepBatch(objects, reachable, 0);

      assert.strictEqual(result.toDelete.length, 0);
      assert.strictEqual(result.retained, 1);
    });

    it('skips young objects', () => {
      const objects: GcObjectEntry[] = [
        { hash: 'a'.repeat(64), lastModified: Date.now(), size: 100, unreachableSince: null },
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

    it('a genuine MutationObject IS traversed: its body and its program stay reachable', async () => {
      const BODY = 'c'.repeat(64);
      const PROGRAM = 'd'.repeat(64);
      const root = 'real-mutation'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(MutationObjectType)({ bodyIr: BODY, argTypes: [toEastTypeValue(IntegerType)], runner: variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) }), form: variant('reduce', null), programIr: PROGRAM })]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(BODY), 'a real mutation must keep its bodyIr reachable');
      assert.ok(reachable.has(PROGRAM), 'a real mutation must keep its program reachable');
    });

    it('a genuine RecordObject IS traversed: each migration, its function and a split step\'s program stay reachable', async () => {
      const VALUE_STEP = 'a-value-step'.padEnd(64, '0');
      const ROWS_STEP = 'a-rows-step'.padEnd(64, '0');
      const VALUE_BODY = '5'.repeat(64);
      const ROWS_BODY = '6'.repeat(64);
      const ROWS_PROGRAM = '7'.repeat(64);
      const runner = variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) });
      const counts = toEastTypeValue(DictType(StringType, IntegerType));
      const root = 'real-record'.padEnd(64, '0');
      const objects = new Map([
        [root, encodeBeast2For(RecordObjectType)({
          path: 'records/counts', mutations: new Map(), indexes: new Map(),
          migrations: [{ name: 'repair', migration: VALUE_STEP }, { name: 'relabel', migration: ROWS_STEP }],
        })],
        [VALUE_STEP, encodeBeast2For(MigrationObjectType)({ form: variant('value', null), from: counts, to: counts, bodyIr: VALUE_BODY, programIr: '', runner })],
        [ROWS_STEP, encodeBeast2For(MigrationObjectType)({
          form: variant('rows', null), from: counts, to: toEastTypeValue(DictType(StringType, StringType)), bodyIr: ROWS_BODY, programIr: ROWS_PROGRAM, runner,
        })],
      ]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      // A value step runs its own function, and names no program.
      assert.deepStrictEqual([...reachable].sort(), [root, VALUE_STEP, ROWS_STEP, VALUE_BODY, ROWS_BODY, ROWS_PROGRAM].sort());
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
      runner: variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) }),
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

    it('treats an index object with a field appended as a leaf: an object without a tag is recognised by its current shape alone', async () => {
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
      assert.deepStrictEqual([...reachable], [root]);
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
      runner: variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) }),
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
  });

  // A kind-tagged object is walked by the tag table: its fields begin with the
  // kind's, and it carries the kind's tag. A later version, which appends
  // fields, is walked for the fields this build knows.
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
          runner: variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) }),
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
        previous: none,
        peakBytes: none,
        a_field_appended_later: 0n,
      } as never)]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.ok(reachable.has(piece), 'the piece\'s input must survive');
    });
  });

  // An object without a tag is recognised by its current shape alone: one of
  // an earlier shape is an older e3's, whose repository is re-created
  // (WIRE_MIGRATION.md), and gc walks nothing it names.
  describe('an untagged object of an earlier shape', () => {
    const trace = (objects: Map<string, Uint8Array>) =>
      async (h: string): Promise<Uint8Array | null> => objects.get(h) ?? null;

    it('is a leaf: a package from before sources names nothing gc walks', async () => {
      const value = '1'.repeat(64);
      const root = 'a-records-era-package'.padEnd(64, '0');
      const objects = new Map([[root, encodeBeast2For(StructType({
        tasks: DictType(StringType, StringType),
        data: PackageDataType,
        functions: DictType(StringType, StringType),
        records: DictType(StringType, StringType),
      }))({
        tasks: new Map(),
        data: { structure: variant('struct', new Map()), refs: new Map([['inputs/x', variant('value', { hash: value, versions: new Map() })]]) },
        functions: new Map(),
        records: new Map(),
      })]]);

      const reachable = await markReachable(trace(objects), new Set([root]));
      assert.deepStrictEqual([...reachable], [root]);
    });
  });
});
