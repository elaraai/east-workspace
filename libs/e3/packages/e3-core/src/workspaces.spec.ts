/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for workspaces.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StringType, variant, some, none, decodeBeast2For, encodeBeast2For } from '@elaraai/east';
import e3 from '@elaraai/e3';
import {
  E3_RELEASE, EnvironmentSpecType, TASK_OBJECT_KIND, TaskObjectType, PackageObjectType, WorkspaceRecordType,
} from '@elaraai/e3-types';
import type { LockOperation, TaskObject, PackageObject, WorkspaceState } from '@elaraai/e3-types';
import {
  workspaceList,
  workspaceCreate,
  workspaceRemove,
  workspaceGetState,
  workspaceGetPackage,
} from './workspaces.js';
import { workspaceDeploy, workspaceExport } from './workspace-files.js';
import { packageResolve, packageRead } from './packages.js';
import { packageImport } from './package-files.js';
import {
  InvalidNameError,
  WorkspaceLockError,
  WorkspaceNotFoundError,
  WorkspaceNotDeployedError,
  lockStateToHolderInfo,
} from './errors.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir, readZipEntries } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';
import { nameRefusal } from './contract/malformed.js';

/** Names no workspace can have: one a file name cannot hold, one holding the
 *  `#` that joins the parts of a lock's name, and `main#dataflow`, the lock a
 *  run of main's dataflow holds. */
const NO_WORKSPACE_NAMES = ['bad:name', 'a#b', 'main#dataflow'] as const;

describe('workspaces', () => {
  let testRepo: string;
  let tempDir: string;
  let storage: StorageBackend;

  beforeEach(() => {
    testRepo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(testRepo);
    removeTempDir(tempDir);
  });

  /**
   * Holds a workspace's lock exclusively for an operation, as another
   * operation of this process's would, while `refused` runs, and asserts the
   * refusal names the holder as `lockStateToHolderInfo` gives it: the process
   * that holds the lock, and since when.
   */
  async function assertRefusalNamesHolder(ws: string, operation: LockOperation, refused: () => Promise<unknown>): Promise<void> {
    const held = await storage.locks.acquire(testRepo, ws, operation);
    assert.ok(held !== null, 'the workspace is free to hold');
    try {
      const state = await storage.locks.getState(testRepo, ws);
      assert.ok(state !== null, 'the lock records its holder');
      const holder = lockStateToHolderInfo(state);
      assert.strictEqual(holder.pid, process.pid, 'this process holds the lock');
      await assert.rejects(refused(), (err: unknown) => {
        assert.ok(err instanceof WorkspaceLockError, `a WorkspaceLockError, not ${String(err)}`);
        assert.deepStrictEqual(err.holder, holder, 'the refusal names the holder lockStateToHolderInfo gives');
        assert.strictEqual(err.message, `Workspace '${ws}' is locked by process ${process.pid} (since ${holder.acquiredAt})`);
        return true;
      });
    } finally {
      await held.release();
    }
  }

  /**
   * Holds main's dataflow lock, as a run of main's dataflow holds it, while
   * `refused` runs with `main#dataflow`, and asserts that name is refused as no
   * workspace's, not as a workspace the run holds: a lock's name may hold `#`,
   * so `main#dataflow` names main's dataflow lock.
   */
  async function assertRefusedWhileMainRuns(refused: (name: string) => Promise<unknown>): Promise<void> {
    await workspaceCreate(storage, testRepo, 'main');
    const held = await storage.locks.acquire(testRepo, 'main#dataflow', variant('dataflow', null));
    assert.ok(held !== null, 'main\'s dataflow lock is free to hold');
    try {
      await assert.rejects(refused('main#dataflow'), nameRefusal('workspace', 'main#dataflow'));
    } finally {
      await held.release();
    }
  }

  describe('workspaceCreate', () => {
    it('creates workspace file', async () => {
      await workspaceCreate(storage, testRepo, 'myworkspace');

      const wsFile = join(testRepo, 'workspaces', 'myworkspace.beast2');
      assert.ok(existsSync(wsFile), 'Workspace file should exist');
    });

    it('throws if workspace already exists', async () => {
      await workspaceCreate(storage, testRepo, 'existing');

      await assert.rejects(
        async () => await workspaceCreate(storage, testRepo, 'existing'),
        /already exists/
      );
    });

    it('allows workspace names with dashes', async () => {
      await workspaceCreate(storage, testRepo, 'my-workspace');

      const wsFile = join(testRepo, 'workspaces', 'my-workspace.beast2');
      assert.ok(existsSync(wsFile));
    });

    it('creates an undeployed workspace, whose record is none', async () => {
      await workspaceCreate(storage, testRepo, 'empty');

      const state = await workspaceGetState(storage, testRepo, 'empty');
      assert.strictEqual(state, null);
      const record = decodeBeast2For(WorkspaceRecordType)(readFileSync(join(testRepo, 'workspaces', 'empty.beast2')));
      assert.strictEqual(record.type, 'none');
    });
  });

  describe('workspaceRemove', () => {
    it('removes workspace file', async () => {
      await workspaceCreate(storage, testRepo, 'toremove');
      const wsFile = join(testRepo, 'workspaces', 'toremove.beast2');
      assert.ok(existsSync(wsFile));

      await workspaceRemove(storage, testRepo, 'toremove');

      assert.ok(!existsSync(wsFile), 'Workspace file should be removed');
    });

    it('throws for non-existent workspace', async () => {
      await assert.rejects(
        async () => await workspaceRemove(storage, testRepo, 'nonexistent'),
        WorkspaceNotFoundError
      );
    });

    it('removes deployed workspace', async () => {
      // Create and deploy a package
      const pkg = e3.package('remove-test', '1.0.0') as any;
      const zipPath = join(tempDir, 'remove-test.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);

      await workspaceDeploy(storage, testRepo, 'wsremove', 'remove-test', '1.0.0');
      await workspaceRemove(storage, testRepo, 'wsremove');

      const wsFile = join(testRepo, 'workspaces', 'wsremove.beast2');
      assert.ok(!existsSync(wsFile));
    });

    it('names the holder of the workspace\'s lock when a deploy holds it, as lockStateToHolderInfo gives it', async () => {
      await workspaceCreate(storage, testRepo, 'held');

      await assertRefusalNamesHolder('held', variant('deployment', null), () => workspaceRemove(storage, testRepo, 'held'));
      assert.ok(existsSync(join(testRepo, 'workspaces', 'held.beast2')), 'the workspace is still there');
    });

    it('refuses a name no workspace can have before it takes the lock', async () => {
      // A lock's name may hold `#`, and a backend's stores may take any name,
      // so the removal checks the name as a workspace's itself. A storage with
      // no stores fails a removal that asks one otherwise than with the name's
      // refusal.
      const noStores = {} as StorageBackend;
      for (const name of NO_WORKSPACE_NAMES) {
        await assert.rejects(workspaceRemove(noStores, testRepo, name), nameRefusal('workspace', name));
      }
    });

    it('refuses main#dataflow as no workspace\'s name while main\'s dataflow runs, not as a workspace that run holds', async () => {
      await assertRefusedWhileMainRuns((name) => workspaceRemove(storage, testRepo, name));
      assert.ok(existsSync(join(testRepo, 'workspaces', 'main.beast2')), 'main is still there');
    });
  });

  describe('workspaceList', () => {
    it('returns empty array for no workspaces', async () => {
      const workspaces = await workspaceList(storage, testRepo);

      assert.deepStrictEqual(workspaces, []);
    });

    it('lists single workspace', async () => {
      await workspaceCreate(storage, testRepo, 'single');

      const workspaces = await workspaceList(storage, testRepo);

      assert.deepStrictEqual(workspaces, ['single']);
    });

    it('lists multiple workspaces', async () => {
      await workspaceCreate(storage, testRepo, 'ws-a');
      await workspaceCreate(storage, testRepo, 'ws-b');
      await workspaceCreate(storage, testRepo, 'ws-c');

      const workspaces = await workspaceList(storage, testRepo);

      assert.strictEqual(workspaces.length, 3);
      assert.ok(workspaces.includes('ws-a'));
      assert.ok(workspaces.includes('ws-b'));
      assert.ok(workspaces.includes('ws-c'));
    });
  });

  describe('workspaceDeploy', () => {
    it('creates workspace and deploys package', async () => {
      // Create and import a package
      const myInput = e3.input('greeting', StringType, variant('value', 'hello'));
      const pkg = e3.package('deploy-test', '1.0.0', myInput);
      const zipPath = join(tempDir, 'deploy-test.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);

      // Deploy to workspace
      await workspaceDeploy(storage, testRepo, 'production', 'deploy-test', '1.0.0');

      // Verify workspace file exists
      const wsFile = join(testRepo, 'workspaces', 'production.beast2');
      assert.ok(existsSync(wsFile));

      // Verify state content
      const state = await workspaceGetState(storage, testRepo, 'production');
      assert.ok(state !== null);
      assert.strictEqual(state.packageName, 'deploy-test');
      assert.strictEqual(state.packageVersion, '1.0.0');
      assert.strictEqual(state.packageHash.length, 64);
      assert.ok(state.deployedAt instanceof Date);
    });

    it('initializes per-dataset refs from package', async () => {
      const myInput = e3.input('value', StringType, variant('value', 'test'));
      const pkg = e3.package('root-test', '1.0.0', myInput);
      const zipPath = join(tempDir, 'root-test.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);

      await workspaceDeploy(storage, testRepo, 'ws', 'root-test', '1.0.0');

      // Verify per-dataset ref files were created
      const refs = await storage.datasets.list(testRepo, 'ws');
      assert.ok(refs.length > 0, 'Expected per-dataset refs to be created');
    });

    it('stores package hash at deploy time', async () => {
      const pkg = e3.package('hash-test', '1.0.0') as any;
      const zipPath = join(tempDir, 'hash-test.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);

      const expectedHash = await packageResolve(storage, testRepo, 'hash-test', '1.0.0');
      await workspaceDeploy(storage, testRepo, 'ws', 'hash-test', '1.0.0');

      const { hash } = await workspaceGetPackage(storage, testRepo, 'ws');
      assert.strictEqual(hash, expectedHash);
    });

    it('can deploy to existing undeployed workspace', async () => {
      await workspaceCreate(storage, testRepo, 'preexisting');

      const pkg = e3.package('deploy-existing', '1.0.0') as any;
      const zipPath = join(tempDir, 'deploy-existing.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);

      // Should not throw
      await workspaceDeploy(storage, testRepo, 'preexisting', 'deploy-existing', '1.0.0');

      const { name, version } = await workspaceGetPackage(storage, testRepo, 'preexisting');
      assert.strictEqual(name, 'deploy-existing');
      assert.strictEqual(version, '1.0.0');
    });

    it('names the holder of the workspace\'s lock when an export holds it, as lockStateToHolderInfo gives it', async () => {
      const pkg = e3.package('deploy-held', '1.0.0', e3.input('deploy_note', StringType, variant('value', 'kept')));
      const zipPath = join(tempDir, 'deploy-held.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);
      await workspaceCreate(storage, testRepo, 'held');

      await assertRefusalNamesHolder('held', variant('export', null), () => workspaceDeploy(storage, testRepo, 'held', 'deploy-held', '1.0.0'));
      assert.strictEqual(await workspaceGetState(storage, testRepo, 'held'), null, 'nothing was deployed');
    });

    it('refuses a name no workspace can have before it takes the lock', async () => {
      // A lock's name may hold `#`, and a backend's stores may take any name,
      // so the deploy checks the name as a workspace's itself. A storage with
      // no stores fails a deploy that asks one otherwise than with the name's
      // refusal.
      const noStores = {} as StorageBackend;
      for (const name of ['bad:name', 'a#b']) {
        await assert.rejects(workspaceDeploy(noStores, testRepo, name, 'deploy-test', '1.0.0'), (err: unknown) => {
          assert.ok(err instanceof InvalidNameError, `${name}: an InvalidNameError, not ${String(err)}`);
          assert.strictEqual(err.kind, 'workspace', name);
          assert.strictEqual(err.value, name, name);
          return true;
        });
      }
    });
  });

  describe('workspaceGetPackage', () => {
    it('returns deployed package info', async () => {
      const pkg = e3.package('getpkg-test', '2.0.0') as any;
      const zipPath = join(tempDir, 'getpkg-test.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);
      await workspaceDeploy(storage, testRepo, 'ws', 'getpkg-test', '2.0.0');

      const { name, version, hash } = await workspaceGetPackage(storage, testRepo, 'ws');

      assert.strictEqual(name, 'getpkg-test');
      assert.strictEqual(version, '2.0.0');
      assert.strictEqual(hash.length, 64);
    });

    it('throws for undeployed workspace', async () => {
      await workspaceCreate(storage, testRepo, 'empty');

      await assert.rejects(
        async () => await workspaceGetPackage(storage, testRepo, 'empty'),
        WorkspaceNotDeployedError
      );
    });
  });

  // workspaceGetRoot/workspaceSetRoot were removed — workspace state no longer
  // has rootHash. Per-dataset refs are used instead.

  describe('workspaceExport', () => {
    it('exports workspace as package zip', async () => {
      // Create and deploy a package
      const myInput = e3.input('data', StringType, variant('value', 'initial'));
      const pkg = e3.package('export-test', '1.0.0', myInput);
      const importZip = join(tempDir, 'export-test.zip');
      await e3.export(pkg, importZip);
      await packageImport(storage, testRepo, importZip);
      await workspaceDeploy(storage, testRepo, 'ws', 'export-test', '1.0.0');

      // Export workspace
      const exportZip = join(tempDir, 'exported.zip');
      const result = await workspaceExport(storage, testRepo, 'ws', exportZip);

      assert.ok(existsSync(exportZip));
      assert.strictEqual(result.name, 'export-test');
      assert.ok(result.version.startsWith('1.0.0-'));
      assert.ok(result.objectCount >= 1);
    });

    it('round-trips a workspace holding tools + workspace_node envs into a fresh repo (#281g)', async () => {
      // Build a deployed workspace whose tasks carry the NEW env kinds (tools,
      // workspace_node), writing every referenced blob into the object store,
      // then export the bundle and import it into a FRESH repo. If the export
      // walker misses a new-kind env blob, that blob is absent after import —
      // this is the regression guard that the walkers carry new-kind blobs.
      const put = (s: string) => storage.objects.write(testRepo, Buffer.from(s));

      // env blobs (leaves the walker must carry) + a dummy commandIr (the walker
      // hash-scans it leniently, so it only has to exist).
      const toolsBinary = await put('#!/bin/sh\necho solver\n');
      const wnPackageJson = await put('{"name":"@acme/pricing","version":"1.0.0"}');
      const wnLock = await put('lockfileVersion: 9\n');
      const wnConfig = await put('node-linker=hoisted\n');
      const wnTarball = await put('\x1f\x8b fake tarball bytes');
      const commandIr = await put('dummy-command-ir');

      // env-spec objects
      const specEnc = encodeBeast2For(EnvironmentSpecType);
      const toolsEnv = await storage.objects.write(testRepo, specEnc(variant('tools', {
        files: [{ path: 'bin/solver', hash: toolsBinary }],
      })));
      const wnEnv = await storage.objects.write(testRepo, specEnc(variant('workspace_node', {
        packageJson: wnPackageJson, lock: wnLock, config: some(wnConfig), subject: 'packages/pricing',
        members: [{ path: 'packages/pricing', name: '@acme/pricing', tarball: wnTarball }],
      })));

      // tasks referencing the env specs
      const taskEnc = encodeBeast2For(TaskObjectType);
      const mkTask = (envHash: string, out: string): TaskObject => ({
        kind: TASK_OBJECT_KIND,
        body: variant('command', { commandIr }),
        runner: variant('custom', { command: [] }),
        inputs: [],
        output: { path: [variant('field', out)], kind: variant('value', null) },
        role: variant('data', null),
        environment: some(envHash),
      });
      const toolsTask = await storage.objects.write(testRepo, taskEnc(mkTask(toolsEnv, 'tools_out')));
      const wnTask = await storage.objects.write(testRepo, taskEnc(mkTask(wnEnv, 'wn_out')));

      // package + a deployed workspace state pointing at it (bypasses deploy
      // validation — export reads state.packageHash → the package's tasks).
      const pkg: PackageObject = {
        tasks: new Map([['tools_task', toolsTask], ['wn_task', wnTask]]),
        data: { structure: variant('struct', new Map()), refs: new Map() },
        functions: new Map(), records: new Map(), sources: new Map(),
      };
      const pkgHash = await storage.objects.write(testRepo, encodeBeast2For(PackageObjectType)(pkg));

      const wsDir = join(testRepo, 'workspaces');
      mkdirSync(wsDir, { recursive: true });
      const state: WorkspaceState = {
        packageName: 'envbundle', packageVersion: '1.0.0', packageHash: pkgHash,
        deployedAt: new Date(), currentRunId: none,
      };
      writeFileSync(join(wsDir, 'envws.beast2'), encodeBeast2For(WorkspaceRecordType)(some(state)));

      // export → import into a FRESH repo
      const exportZip = join(tempDir, 'envbundle.zip');
      await workspaceExport(storage, testRepo, 'envws', exportZip);
      assert.ok(existsSync(exportZip));

      const freshRepo = createTestRepo();
      const freshStorage = new LocalStorage();
      try {
        await packageImport(freshStorage, freshRepo, exportZip);
        // Every env-spec object AND its blobs must have travelled in the bundle.
        for (const [label, hash] of [
          ['tools env spec', toolsEnv], ['tools binary', toolsBinary],
          ['workspace_node env spec', wnEnv], ['wn package.json', wnPackageJson],
          ['wn lockfile', wnLock], ['wn config', wnConfig], ['wn member tarball', wnTarball],
        ] as const) {
          const data = await freshStorage.objects.read(freshRepo, hash);
          assert.ok(data && data.length > 0, `${label} (${hash.slice(0, 8)}…) missing from the imported bundle`);
        }
      } finally {
        removeTestRepo(freshRepo);
      }
    });

    it('uses custom name and version', async () => {
      const pkg = e3.package('custom-export', '1.0.0') as any;
      const importZip = join(tempDir, 'custom-export.zip');
      await e3.export(pkg, importZip);
      await packageImport(storage, testRepo, importZip);
      await workspaceDeploy(storage, testRepo, 'ws', 'custom-export', '1.0.0');

      const exportZip = join(tempDir, 'custom.zip');
      const result = await workspaceExport(storage, testRepo, 'ws', exportZip, 'new-name', '2.0.0');

      assert.strictEqual(result.name, 'new-name');
      assert.strictEqual(result.version, '2.0.0');
    });

    it('exported package can be imported', async () => {
      const myInput = e3.input('value', StringType, variant('value', 'test'));
      const pkg = e3.package('reimport-test', '1.0.0', myInput);
      const importZip = join(tempDir, 'reimport.zip');
      await e3.export(pkg, importZip);
      await packageImport(storage, testRepo, importZip);
      await workspaceDeploy(storage, testRepo, 'ws', 'reimport-test', '1.0.0');

      // Export and reimport
      const exportZip = join(tempDir, 'reimport-exported.zip');
      await workspaceExport(storage, testRepo, 'ws', exportZip, 'reimported', '2.0.0');

      // Create second repo and import
      const testRepo2 = createTestRepo();
      const storage2 = new LocalStorage();
      try {
        const importResult = await packageImport(storage2, testRepo2, exportZip);

        assert.strictEqual(importResult.name, 'reimported');
        assert.strictEqual(importResult.version, '2.0.0');
      } finally {
        removeTestRepo(testRepo2);
      }
    });

    it('exports workspace with per-dataset refs', async () => {
      const myInput = e3.input('value', StringType, variant('value', 'initial'));
      const pkg = e3.package('modified-export', '1.0.0', myInput);
      const importZip = join(tempDir, 'modified-export.zip');
      await e3.export(pkg, importZip);
      await packageImport(storage, testRepo, importZip);
      await workspaceDeploy(storage, testRepo, 'ws', 'modified-export', '1.0.0');

      // Export
      const exportZip = join(tempDir, 'modified.zip');
      const result = await workspaceExport(storage, testRepo, 'ws', exportZip);

      // Import to new repo and verify package structure
      const testRepo2 = createTestRepo();
      const storage2 = new LocalStorage();
      try {
        await packageImport(storage2, testRepo2, exportZip);
        const exportedPkg = await packageRead(storage2, testRepo2, result.name, result.version);

        // Package data has structure but no root hash
        assert.ok(exportedPkg.data.structure, 'Exported package should have structure');
      } finally {
        removeTestRepo(testRepo2);
      }
    });

    it('preserves tasks from original package', async () => {
      // For now, test with empty tasks since e3.package doesn't easily add tasks
      const pkg = e3.package('tasks-preserve', '1.0.0') as any;
      const importZip = join(tempDir, 'tasks-preserve.zip');
      await e3.export(pkg, importZip);
      await packageImport(storage, testRepo, importZip);
      await workspaceDeploy(storage, testRepo, 'ws', 'tasks-preserve', '1.0.0');

      const exportZip = join(tempDir, 'tasks-exported.zip');
      await workspaceExport(storage, testRepo, 'ws', exportZip, 'tasks-out', '1.0.0');

      const testRepo2 = createTestRepo();
      const storage2 = new LocalStorage();
      try {
        await packageImport(storage2, testRepo2, exportZip);
        const originalPkg = await packageRead(storage, testRepo, 'tasks-preserve', '1.0.0');
        const exportedPkg = await packageRead(storage2, testRepo2, 'tasks-out', '1.0.0');

        // Tasks should be the same
        assert.strictEqual(exportedPkg.tasks.size, originalPkg.tasks.size);
      } finally {
        removeTestRepo(testRepo2);
      }
    });

    it('carries the release that exported it, first, the executions its current run used, and no record of the run', async () => {
      const pkg = e3.package('run-export', '1.0.0', e3.input('value', StringType, variant('value', 'initial')));
      const importZip = join(tempDir, 'run-export.zip');
      await e3.export(pkg, importZip);
      await packageImport(storage, testRepo, importZip);
      await workspaceDeploy(storage, testRepo, 'ws', 'run-export', '1.0.0');

      // A run that used one execution, as the workspace's current run.
      const taskHash = 'a'.repeat(64);
      const inputsHash = 'b'.repeat(64);
      const executionId = '0190a0b0-5555-7000-8000-000000000000';
      const runId = '0190a0b0-6666-7000-8000-000000000000';
      await storage.refs.executionWrite(testRepo, taskHash, inputsHash, executionId, variant('cancelled', {
        executionId, inputHashes: [], startedAt: new Date(0), completedAt: new Date(0), unit: false,
        reason: { kind: variant('aborted', null), message: 'cancelled' },
      }));
      await storage.refs.dataflowRunWrite(testRepo, 'ws', {
        runId, workspaceName: 'ws', packageRef: 'run-export@1.0.0', startedAt: new Date(0), completedAt: none,
        status: variant('completed', {}), inputVersions: new Map(), outputVersions: none,
        taskExecutions: new Map([['task', {
          executionId, taskHash, inputsHash, cached: false, outputVersions: new Map(), executionCount: 1n,
        }]]),
        summary: { total: 1n, completed: 1n, cached: 0n, failed: 0n, skipped: 0n, reexecuted: 0n },
      });
      const state = (await workspaceGetState(storage, testRepo, 'ws'))!;
      await storage.refs.workspaceWrite(testRepo, 'ws',
        encodeBeast2For(WorkspaceRecordType)(some({ ...state, currentRunId: some(runId) })));

      const exportZip = join(tempDir, 'run-exported.zip');
      await workspaceExport(storage, testRepo, 'ws', exportZip, 'run-exported', '1.0.0');
      const entries = await readZipEntries(exportZip);
      const names = [...entries.keys()];
      assert.strictEqual(names[0], 'release.beast2');
      assert.strictEqual(decodeBeast2For(StringType)(entries.get('release.beast2')!), E3_RELEASE);
      assert.deepStrictEqual(names.filter((name) => name.startsWith('dataflows/')), [], 'no run record');
      assert.ok(names.includes(`executions/${taskHash}/${inputsHash}/${executionId}/status.beast2`), 'the execution travels');

      // The importing repository gets the execution, and no run.
      const testRepo2 = createTestRepo();
      const storage2 = new LocalStorage();
      try {
        await packageImport(storage2, testRepo2, exportZip);
        assert.ok(await storage2.refs.executionGet(testRepo2, taskHash, inputsHash, executionId));
        assert.deepStrictEqual(await storage2.refs.dataflowRunList(testRepo2, 'ws'), []);
      } finally {
        removeTestRepo(testRepo2);
      }
    });

    it('throws for undeployed workspace', async () => {
      await workspaceCreate(storage, testRepo, 'empty');
      const exportZip = join(tempDir, 'empty.zip');

      await assert.rejects(
        async () => await workspaceExport(storage, testRepo, 'empty', exportZip),
        WorkspaceNotDeployedError
      );
    });

    it('names the holder of the workspace\'s lock when a deploy holds it, as lockStateToHolderInfo gives it', async () => {
      const pkg = e3.package('export-held', '1.0.0', e3.input('export_note', StringType, variant('value', 'kept')));
      const importZip = join(tempDir, 'export-held.zip');
      await e3.export(pkg, importZip);
      await packageImport(storage, testRepo, importZip);
      await workspaceDeploy(storage, testRepo, 'held', 'export-held', '1.0.0');
      const exportZip = join(tempDir, 'export-held-out.zip');

      await assertRefusalNamesHolder('held', variant('deployment', null), () => workspaceExport(storage, testRepo, 'held', exportZip));
      assert.ok(!existsSync(exportZip), 'no zip was written');
    });

    it('refuses a name no workspace can have before it takes a lock or writes a file', async () => {
      // The export holds the repository's running work, then the workspace's
      // lock: a storage with no stores fails one that asks either otherwise
      // than with the name's refusal.
      const noStores = {} as StorageBackend;
      const exportZip = join(tempDir, 'refused.zip');
      for (const name of NO_WORKSPACE_NAMES) {
        await assert.rejects(workspaceExport(noStores, testRepo, name, exportZip), nameRefusal('workspace', name));
        assert.ok(!existsSync(exportZip) && !existsSync(`${exportZip}.partial`), `${name}: no file was written`);
      }
    });

    it('refuses main#dataflow as no workspace\'s name while main\'s dataflow runs, not as a workspace that run holds', async () => {
      const exportZip = join(tempDir, 'main.zip');
      await assertRefusedWhileMainRuns((name) => workspaceExport(storage, testRepo, name, exportZip));
      assert.ok(!existsSync(exportZip) && !existsSync(`${exportZip}.partial`), 'no file was written');
    });
  });
});
