/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Workspace operations test suite.
 *
 * Tests: create, list, get, status, lock, deploy, copy, remove
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ArrayType, IntegerType, decodeBeast2For, encodeBeast2For, equalFor, printFor, some, variant } from '@elaraai/east';
import { DatasetStatusInfoType, TaskStatusInfoType, WorkspaceInfoType, type TreePath } from '@elaraai/e3-types';
import {
  ApiError,
  fetchWithAuth,
  parseErrorBody,
  packageImport,
  workspaceList,
  workspaceCreate,
  workspaceCopy,
  workspaceGet,
  workspaceLockStatus,
  workspaceStatus,
  workspaceRemove,
  workspaceDeploy,
  taskList,
  taskGet,
  dataflowGraph,
  datasetGet,
  datasetSet,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createPackageZip, createRolesPackageZip } from '../fixtures.js';
import { MALFORMED_WORKSPACE_NAMES, refusedAsWorkspaceName } from '../assertions.js';

/**
 * Register workspace operation tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function workspaceTests(setup: TestSetup<TestContext>): void {
  const withDeployedPackage: TestSetup<TestContext> = async (t) => {
    const ctx = await setup(t);
    const opts = await ctx.opts();

    const zipPath = await createPackageZip(ctx.tempDir, 'compute-pkg', '1.0.0');
    const packageZip = readFileSync(zipPath);
    await packageImport(ctx.config.baseUrl, ctx.repoName, packageZip, opts);

    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', 'compute-pkg@1.0.0', opts);

    return ctx;
  };

  describe('workspaces', { concurrency: false }, () => {
    it('workspaceList returns empty initially', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      const workspaces = await workspaceList(ctx.config.baseUrl, ctx.repoName, opts);
      assert.deepStrictEqual(workspaces, []);
    });

    it('workspaceCreate and workspaceList round-trip', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      const info = await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'test-ws', opts);
      assert.strictEqual(info.name, 'test-ws');
      assert.strictEqual(info.deployed, false);

      const workspaces = await workspaceList(ctx.config.baseUrl, ctx.repoName, opts);
      assert.strictEqual(workspaces.length, 1);
      assert.strictEqual(workspaces[0].name, 'test-ws');

      // Clean up
      await workspaceRemove(ctx.config.baseUrl, ctx.repoName, 'test-ws', opts);
    });

    it('workspaceRemove deletes workspace', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'to-delete', opts);

      let workspaces = await workspaceList(ctx.config.baseUrl, ctx.repoName, opts);
      assert.strictEqual(workspaces.length, 1);

      await workspaceRemove(ctx.config.baseUrl, ctx.repoName, 'to-delete', opts);

      workspaces = await workspaceList(ctx.config.baseUrl, ctx.repoName, opts);
      assert.strictEqual(workspaces.length, 0);
    });

    it('workspaceGet names a workspace nothing is deployed to, and one that does not exist', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'empty-ws', opts);
      await assert.rejects(
        workspaceGet(ctx.config.baseUrl, ctx.repoName, 'empty-ws', opts),
        (err: unknown) => err instanceof ApiError && err.code === 'workspace_not_deployed',
      );
      await assert.rejects(
        workspaceGet(ctx.config.baseUrl, ctx.repoName, 'no-such-ws', opts),
        (err: unknown) => err instanceof ApiError && err.code === 'workspace_not_found',
      );
    });

    it('workspaceLockStatus answers none while nothing holds a workspace, deployed or not', async (t) => {
      const ctx = await withDeployedPackage(t);
      const opts = await ctx.opts();

      await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'empty-ws', opts);
      assert.strictEqual(await workspaceLockStatus(ctx.config.baseUrl, ctx.repoName, 'empty-ws', opts), null,
        'a workspace nothing is deployed to');
      assert.strictEqual(await workspaceLockStatus(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', opts), null,
        'a deployed workspace, its deploy done');
    });

    it('workspaceLockStatus refuses a name no workspace can have as invalid_name of a workspace, as every route of a workspace does', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      // No lock is read for any of them: `main#dataflow` in particular is a
      // lock's name, never a workspace's.
      for (const [name, why] of MALFORMED_WORKSPACE_NAMES) {
        await assert.rejects(workspaceLockStatus(ctx.config.baseUrl, ctx.repoName, name, opts), refusedAsWorkspaceName(name, why));
      }
    });

    it('workspaceDeploy refuses a name no workspace can have as invalid_name of a workspace when it starts, not as a failed job', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();
      const zipPath = await createPackageZip(ctx.tempDir, 'compute-pkg', '1.0.0');
      await packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(zipPath), opts);

      // A deploy's job that fails is thrown as an Error: the ApiError is the
      // start's own answer, before a job is filed.
      for (const [name, why] of MALFORMED_WORKSPACE_NAMES) {
        await assert.rejects(workspaceDeploy(ctx.config.baseUrl, ctx.repoName, name, 'compute-pkg@1.0.0', opts), refusedAsWorkspaceName(name, why));
      }
    });

    it('workspaceRemove refuses a name no workspace can have as invalid_name of a workspace, before it takes a lock', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      // Each is refused as a workspace's name before a lock is taken:
      // `bad:name` not as a lock's, and `main#dataflow` without taking the
      // lock a run of main's dataflow holds.
      for (const [name, why] of MALFORMED_WORKSPACE_NAMES) {
        await assert.rejects(workspaceRemove(ctx.config.baseUrl, ctx.repoName, name, opts), refusedAsWorkspaceName(name, why));
      }
    });

    describe('with deployed package', { concurrency: false }, () => {
      it('workspaceGet returns deployed state', async (t) => {
        const ctx = await withDeployedPackage(t);
        const opts = await ctx.opts();

        const state = await workspaceGet(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', opts);
        assert.ok(state !== null);
        assert.strictEqual(state.packageName, 'compute-pkg');
        assert.strictEqual(state.packageVersion, '1.0.0');
      });

      it('workspaceStatus returns datasets and tasks', async (t) => {
        const ctx = await withDeployedPackage(t);
        const opts = await ctx.opts();

        const status = await workspaceStatus(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', opts);

        assert.strictEqual(status.workspace, 'deployed-ws');
        // Should have input and output datasets
        assert.ok(status.datasets.length >= 2);
        // Should have the compute task
        assert.strictEqual(status.tasks.length, 1);
        assert.strictEqual(status.tasks[0].name, 'compute');
        // Summary should match
        assert.strictEqual(status.summary.tasks.total, 1n);
      });

      it('workspaceStatus answers the datasets it is asked for and the tasks producing them, as the whole answer does, leaving out a path no dataset has', async (t) => {
        const ctx = await withDeployedPackage(t);
        const opts = await ctx.opts();
        const at = (...fields: string[]): TreePath => fields.map((field) => variant('field', field));
        const DatasetsType = ArrayType(DatasetStatusInfoType);
        const TasksType = ArrayType(TaskStatusInfoType);
        const whole = await workspaceStatus(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', opts);

        const output = await workspaceStatus(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', opts, {
          paths: [at('tasks', 'compute', 'output'), at('inputs', 'nope')],
        });
        const outputs = whole.datasets.filter((dataset) => dataset.path === '.tasks.compute.output');
        assert.ok(equalFor(DatasetsType)(output.datasets, outputs), `the output alone: ${printFor(DatasetsType)(output.datasets)}`);
        assert.ok(equalFor(TasksType)(output.tasks, whole.tasks), `the task producing it: ${printFor(TasksType)(output.tasks)}`);
        assert.strictEqual(output.summary.datasets.total, 1n);
        assert.strictEqual(output.summary.tasks.total, 1n);

        const input = await workspaceStatus(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', opts, { paths: [at('inputs', 'value')] });
        const inputs = whole.datasets.filter((dataset) => dataset.path === '.inputs.value');
        assert.ok(equalFor(DatasetsType)(input.datasets, inputs), `the input alone: ${printFor(DatasetsType)(input.datasets)}`);
        assert.strictEqual(input.tasks.length, 0, 'no task produces an input');
      });

      it('workspaceStatus refuses a path that is not a keypath as bad_request', async (t) => {
        const ctx = await withDeployedPackage(t);
        const opts = await ctx.opts();
        // The client prints every path it is given as a keypath, so the
        // request is made by hand.
        const response = await fetchWithAuth(
          `${ctx.config.baseUrl}/api/repos/${encodeURIComponent(ctx.repoName)}/workspaces/deployed-ws/status?path=inputs.value`,
          { method: 'GET' },
          opts,
        );
        assert.strictEqual(response.status, 400);
        const refusal = parseErrorBody(await response.text(), 'http_400');
        assert.strictEqual(refusal.code, 'bad_request');
        assert.match(String(refusal.details), /^path must be a dataset's path, as a status names it \(\.inputs\.x\), got "inputs\.value"/);
      });

      it('workspaceCopy makes the target the source as it is now, and a write to either afterwards leaves the other as it was', async (t) => {
        const ctx = await withDeployedPackage(t);
        const opts = await ctx.opts();
        const value: TreePath = [variant('field', 'inputs'), variant('field', 'value')];
        const read = async (ws: string): Promise<bigint> =>
          decodeBeast2For(IntegerType)((await datasetGet(ctx.config.baseUrl, ctx.repoName, ws, value, opts)).data);
        await datasetSet(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', value, encodeBeast2For(IntegerType)(99n), opts);

        const info = await workspaceCopy(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', 'copied-ws', opts);
        const target = { name: 'copied-ws', deployed: true, packageName: some('compute-pkg'), packageVersion: some('1.0.0') };
        assert.ok(equalFor(WorkspaceInfoType)(info, target), `the target, as the list gives it: ${printFor(WorkspaceInfoType)(info)}`);
        assert.strictEqual((await workspaceGet(ctx.config.baseUrl, ctx.repoName, 'copied-ws', opts)).packageVersion, '1.0.0');
        assert.strictEqual(await read('copied-ws'), 99n, 'the input as the source held it');

        await datasetSet(ctx.config.baseUrl, ctx.repoName, 'copied-ws', value, encodeBeast2For(IntegerType)(7n), opts);
        assert.strictEqual(await read('deployed-ws'), 99n, 'a write to the copy leaves the source as it was');
      });

      it('workspaceCopy refuses a source that does not exist, a copy onto itself, and a target no workspace can be named', async (t) => {
        const ctx = await withDeployedPackage(t);
        const opts = await ctx.opts();

        await assert.rejects(
          workspaceCopy(ctx.config.baseUrl, ctx.repoName, 'no-such-ws', 'copied-ws', opts),
          (err: unknown) => err instanceof ApiError && err.code === 'workspace_not_found',
        );
        await assert.rejects(
          workspaceCopy(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', 'deployed-ws', opts),
          refusedAsWorkspaceName('deployed-ws', 'is the workspace copied: a workspace cannot be copied onto itself'),
        );
        for (const [name, why] of MALFORMED_WORKSPACE_NAMES) {
          await assert.rejects(workspaceCopy(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', name, opts), refusedAsWorkspaceName(name, why));
        }
      });

      it('taskList returns task info', async (t) => {
        const ctx = await withDeployedPackage(t);
        const opts = await ctx.opts();

        const tasks = await taskList(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', opts);
        assert.ok(Array.isArray(tasks));
        assert.ok(tasks.length > 0, 'should have at least one task');

        const computeTask = tasks.find(t => t.name === 'compute');
        assert.ok(computeTask, 'should have compute task');
        assert.ok(computeTask.hash.length > 0);
        // A plain task() is a data task
        assert.strictEqual(computeTask.role.type, 'data');
      });

      it('taskList carries each task\'s role', async (t) => {
        const ctx = await setup(t);
        const opts = await ctx.opts();

        const zipPath = await createRolesPackageZip(ctx.tempDir, 'roles-pkg', '1.0.0');
        await packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(zipPath), opts);
        await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'roles-ws', opts);
        await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, 'roles-ws', 'roles-pkg@1.0.0', opts);

        const tasks = await taskList(ctx.config.baseUrl, ctx.repoName, 'roles-ws', opts);
        const byName = new Map(tasks.map(task => [task.name, task]));
        assert.strictEqual(byName.get('display')?.role.type, 'ui');
        assert.strictEqual(byName.get('compute')?.role.type, 'data');
      });

      it('taskGet returns task details', async (t) => {
        const ctx = await withDeployedPackage(t);
        const opts = await ctx.opts();

        const task = await taskGet(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', 'compute', opts);
        assert.strictEqual(task.name, 'compute');
        assert.ok(task.hash.length > 0);
        assert.ok(Array.isArray(task.inputs));
        assert.ok(task.output);
      });

      it('dataflowGraph returns dependency graph', async (t) => {
        const ctx = await withDeployedPackage(t);
        const opts = await ctx.opts();

        const graph = await dataflowGraph(ctx.config.baseUrl, ctx.repoName, 'deployed-ws', opts);
        assert.ok(Array.isArray(graph.tasks));
        assert.ok(graph.tasks.length > 0);

        const computeTask = graph.tasks.find(t => t.name === 'compute');
        assert.ok(computeTask);
        assert.ok(Array.isArray(computeTask.inputs));
        assert.ok(computeTask.output);
        assert.ok(Array.isArray(computeTask.dependsOn));
      });
    });
  });
}
