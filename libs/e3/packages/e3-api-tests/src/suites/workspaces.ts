/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Workspace operations test suite.
 *
 * Tests: create, list, get, status, lock, deploy, remove
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { equalFor, isValueOf, printFor, type ValueTypeOf } from '@elaraai/east';
import { InvalidNameErrorType } from '@elaraai/e3-types';
import {
  ApiError,
  packageImport,
  workspaceList,
  workspaceCreate,
  workspaceGet,
  workspaceLockStatus,
  workspaceStatus,
  workspaceRemove,
  workspaceDeploy,
  taskList,
  taskGet,
  dataflowGraph,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createPackageZip, createRolesPackageZip } from '../fixtures.js';

/** Why no workspace's name may hold `c`: it joins the parts of a lock's name. */
const joinsLockNames = (c: string) => `holds ${JSON.stringify(c)}, which joins the parts of a lock's name`;

/**
 * Names no workspace can have, each with why, as a refusal says it: a lock's
 * name (`main#dataflow`, the lock a run of main's dataflow holds), the
 * characters that join a lock's parts, and one a file name cannot hold.
 */
const MALFORMED_WORKSPACE_NAMES = [
  ['main#dataflow', joinsLockNames('#')],
  ['a#b', joinsLockNames('#')],
  ['a~b', joinsLockNames('~')],
  ['bad:name', `holds ":", which a file name cannot`],
] as const;

/**
 * Checks an error is the API's refusal of `name` as no workspace's:
 * `invalid_name`, whose details name the kind, the name and why.
 *
 * @param name - The name refused
 * @param why - Why, as the refusal's message ends
 * @returns An `assert.rejects` validator
 */
function refusedAsWorkspaceName(name: string, why: string): (err: unknown) => true {
  return (err) => {
    assert.ok(err instanceof ApiError, `${name}: expected ApiError, got ${err}`);
    assert.strictEqual(err.code, 'invalid_name');
    assert.ok(isValueOf(err.details, InvalidNameErrorType), `${name}: the refusal names the name and why`);
    const said = err.details as ValueTypeOf<typeof InvalidNameErrorType>;
    const expected: ValueTypeOf<typeof InvalidNameErrorType> = {
      kind: 'workspace', name, message: `the workspace name ${JSON.stringify(name)} ${why}`,
    };
    assert.ok(equalFor(InvalidNameErrorType)(said, expected), `${name}: refused as ${printFor(InvalidNameErrorType)(said)}`);
    return true;
  };
}

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
