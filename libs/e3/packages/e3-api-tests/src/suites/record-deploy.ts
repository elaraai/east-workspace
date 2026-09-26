/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Record deploy test suite.
 *
 * A deploy decides for each record whether it mints, keeps, migrates, resets,
 * drops or refuses it, and a server runs the deploy as a job the client polls.
 * This takes each decision through the API against a real server and runner:
 * what the job reports, the commits it leaves, and the state it carries.
 */

import { describe, it, type TestContext as NodeTestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { StringType, decodeBeast2For, encodeBeast2For, variant, none } from '@elaraai/east';
import {
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  datasetGet,
  workspaceRecordMutate,
  workspaceRecordHistory,
  type WorkspaceDeployOptions,
  type WorkspaceDeployResult,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { TasksV2Type, createMigrationPackageZip, type MigrationFixtureVersion } from '../fixtures.js';

const PKG = 'migrating-pkg';
const WS = 'migrating-ws';
const RECORD = 'records/tasks';
const tasksPath = [variant('field', 'records'), variant('field', 'tasks')];
const encodeStr = encodeBeast2For(StringType);
const decodeTasks = decodeBeast2For(TasksV2Type);

export function recordDeployTests(setup: TestSetup<TestContext>): void {
  /** A fresh repository holding `versions` of the package, and a workspace to
   *  deploy them to. */
  async function holding(t: NodeTestContext, versions: MigrationFixtureVersion[]): Promise<TestContext> {
    const ctx = await setup(t);
    const opts = await ctx.opts();
    for (const version of versions) {
      const zip = await createMigrationPackageZip(ctx.tempDir, PKG, version);
      await packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(zip), opts);
    }
    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, WS, opts);
    return ctx;
  }

  /** Deploy a version of the package: what the deploy decided. */
  async function deploy(
    ctx: TestContext,
    version: MigrationFixtureVersion,
    options: WorkspaceDeployOptions = {},
  ): Promise<WorkspaceDeployResult> {
    return workspaceDeploy(ctx.config.baseUrl, ctx.repoName, WS, `${PKG}@${version}`, await ctx.opts(), options);
  }

  /** The record's commits, newest first, each by what made it. */
  async function history(ctx: TestContext): Promise<string[]> {
    const { commits } = await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'tasks', undefined, await ctx.opts());
    return commits.map((commit) => commit.mutation);
  }

  /** The record's state, as its bytes. */
  async function state(ctx: TestContext): Promise<Uint8Array> {
    return (await datasetGet(ctx.config.baseUrl, ctx.repoName, WS, tasksPath, await ctx.opts())).data as Uint8Array;
  }

  describe('record deploys', { concurrency: false }, () => {
    it('mints, plans, migrates and keeps a record, and says which it did', async (t) => {
      const ctx = await holding(t, ['1.0.0', '2.0.0', '2.1.0']);
      assert.deepEqual((await deploy(ctx, '1.0.0')).records, [{ record: RECORD, action: variant('mint', null) }]);
      const added = await workspaceRecordMutate(ctx.config.baseUrl, ctx.repoName, WS, 'tasks', 'add',
        { args: [encodeStr('b'), encodeStr('B')], actor: none, limits: none }, await ctx.opts());
      assert.equal(added.outcome.type, 'committed');

      // A plan says what the deploy would do, and writes nothing.
      const migrate = [{ record: RECORD, action: variant('migrate', { steps: ['add_owner'] }) }];
      const before = await state(ctx);
      assert.deepEqual((await deploy(ctx, '2.0.0', { plan: true })).records, migrate);
      assert.deepEqual(await history(ctx), ['add', '$init']);
      assert.deepEqual(await state(ctx), before);

      // The migration carries the workspace's rows, the one added since the
      // deploy among them.
      assert.deepEqual((await deploy(ctx, '2.0.0')).records, migrate);
      assert.deepEqual(await history(ctx), ['$migrate:add_owner', 'add', '$init']);
      assert.deepEqual([...decodeTasks(await state(ctx))], [
        ['a', { title: 'A', owner: 'nobody' }],
        ['b', { title: 'B', owner: 'nobody' }],
      ]);

      // The same package again keeps the record as it is, and another package
      // over it says so in the record's history.
      assert.deepEqual((await deploy(ctx, '2.0.0')).records, [{ record: RECORD, action: variant('keep', { deploy: false }) }]);
      assert.deepEqual((await deploy(ctx, '2.1.0')).records, [{ record: RECORD, action: variant('keep', { deploy: true }) }]);
      assert.deepEqual(await history(ctx), ['$deploy', '$migrate:add_owner', 'add', '$init']);
    });

    it('refuses a type change with no migration, naming the fix, and resets the record when told to', async (t) => {
      const ctx = await holding(t, ['1.0.0', '3.0.0']);
      await deploy(ctx, '1.0.0');
      await assert.rejects(deploy(ctx, '3.0.0'),
        /record 'records\/tasks' changed type with no migration[\s\S]*--schema=reset/);
      assert.deepEqual(await history(ctx), ['$init'], 'a refused deploy writes nothing');

      assert.deepEqual((await deploy(ctx, '3.0.0', { schema: 'reset' })).records.map((plan) => plan.action.type), ['reset']);
      assert.deepEqual(await history(ctx), ['$reset'], 'a root commit: the reset is in the history, which starts over');
      assert.equal(decodeTasks(await state(ctx)).size, 0, 'the record holds the package\'s initial value');
    });

    it('refuses migrations its policy runs none of, and a package older than the workspace', async (t) => {
      const ctx = await holding(t, ['1.0.0', '2.0.0']);
      await deploy(ctx, '1.0.0');
      await assert.rejects(deploy(ctx, '2.0.0', { schema: 'fail' }),
        /record 'records\/tasks' has migrations 'add_owner' to run, and this deploy runs none/);
      await deploy(ctx, '2.0.0');
      await assert.rejects(deploy(ctx, '1.0.0'),
        /record 'records\/tasks' has had migrations 'add_owner' applied, and the package declares none: [\s\S]*the package is older than the workspace/);
      assert.deepEqual(await history(ctx), ['$migrate:add_owner', '$init']);
    });

    it('refuses to drop a record the package no longer declares, and drops it when allowed', async (t) => {
      const ctx = await holding(t, ['1.0.0', '4.0.0']);
      await deploy(ctx, '1.0.0');
      await assert.rejects(deploy(ctx, '4.0.0'),
        /record 'records\/tasks' is not declared by the package[\s\S]*--allow-drop-records/);
      assert.deepEqual(await history(ctx), ['$init'], 'the record is still there');

      assert.deepEqual((await deploy(ctx, '4.0.0', { allowDropRecords: true })).records,
        [{ record: RECORD, action: variant('drop', null) }]);
      await assert.rejects(state(ctx));
    });
  });
}
