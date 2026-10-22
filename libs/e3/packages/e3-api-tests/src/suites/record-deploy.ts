/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Record deploy test suite.
 *
 * A deploy decides for each record whether it mints, keeps, migrates, resets,
 * drops or refuses it — or, for one declared with no initial value, leaves it
 * unassigned until its first state is committed, its dependents waiting — and
 * a server runs the deploy as a job the client polls.
 * This takes each decision through the API against a real server and runner:
 * what the job reports, the commits it leaves, the state it carries and what
 * the record's describe says of each step it applied — and, while the job
 * runs, how far it has got, which its status and the workspace's lock both
 * say.
 */

import { describe, it, type TestContext as NodeTestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';

import {
  OptionType, StringType, decodeBeast2For, encodeBeast2For, equalFor, variant, none, some, type EastType, type ValueTypeOf,
} from '@elaraai/east';
import {
  BEAST2_CONTENT_TYPE,
  PackageJobResponseType,
  RecordMigrationAppliedType,
  ResponseType,
  WorkspaceDeployRequestType,
  WorkspaceDeployStatusType,
  type RecordMigrationApplied,
} from '@elaraai/e3-types';
import {
  ApiError,
  dataflowExecute,
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  workspaceLockStatus,
  workspaceStatus,
  datasetGet,
  workspaceRecordDescribe,
  workspaceRecordMutate,
  workspaceRecordHistory,
  requestFetch,
  type DeployProgress,
  type LockStatus,
  type RequestOptions,
  type WorkspaceDeployOptions,
  type WorkspaceDeployResult,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import {
  TasksV2Type, createMigrationPackageZip, createPendingRecordPackageZip, type MigrationFixtureVersion, type PendingFixtureVersion,
} from '../fixtures.js';

const PKG = 'migrating-pkg';
const WS = 'migrating-ws';
const RECORD = 'records/tasks';
const tasksPath = [variant('field', 'records'), variant('field', 'tasks')];
/** The pending-record fixture: its package, its record and the task over it. */
const PENDING_PKG = 'pending-pkg';
const CUSTOMERS = 'records/customers';
const customersPath = [variant('field', 'records'), variant('field', 'customers')];
const encodeStr = encodeBeast2For(StringType);
const decodeTasks = decodeBeast2For(TasksV2Type);

/**
 * One request made the way a client without e3-api-client makes it, through
 * the options' `fetch`: the success value, failing the test on an API error.
 */
async function call<T extends EastType>(
  url: string,
  method: 'GET' | 'POST',
  type: T,
  opts: RequestOptions,
  body?: Uint8Array,
): Promise<ValueTypeOf<T>> {
  const response = await requestFetch(opts)(url, {
    method,
    headers: {
      'Accept': BEAST2_CONTENT_TYPE,
      ...(body ? { 'Content-Type': BEAST2_CONTENT_TYPE } : {}),
      ...(opts.token ? { 'Authorization': `Bearer ${opts.token}` } : {}),
    },
    ...(body ? { body } : {}),
  });
  assert.ok(response.ok, `${method} ${url}: ${response.status} ${response.statusText}`);
  const answer = decodeBeast2For(ResponseType(type))(new Uint8Array(await response.arrayBuffer())) as
    | { type: 'success'; value: ValueTypeOf<T> }
    | { type: 'error'; value: unknown };
  if (answer.type !== 'success') assert.fail(`${method} ${url} was refused: ${inspect(answer.value, { depth: 4 })}`);
  return answer.value;
}

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

  /** A fresh repository holding `versions` of the pending-record package, and
   *  a workspace to deploy them to. */
  async function holdingPending(t: NodeTestContext, versions: PendingFixtureVersion[]): Promise<TestContext> {
    const ctx = await setup(t);
    const opts = await ctx.opts();
    for (const version of versions) {
      const zip = await createPendingRecordPackageZip(ctx.tempDir, PENDING_PKG, version);
      await packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(zip), opts);
    }
    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, WS, opts);
    return ctx;
  }

  /** Deploy a version of the pending-record package: what the deploy decided. */
  async function deployPending(
    ctx: TestContext,
    version: PendingFixtureVersion,
    options: WorkspaceDeployOptions = {},
  ): Promise<WorkspaceDeployResult> {
    return workspaceDeploy(ctx.config.baseUrl, ctx.repoName, WS, `${PENDING_PKG}@${version}`, await ctx.opts(), options);
  }

  /** The pending record's commits, newest first, each by what made it. */
  async function customersHistory(ctx: TestContext): Promise<string[]> {
    const { commits } = await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'customers', undefined, await ctx.opts());
    return commits.map((commit) => commit.mutation);
  }

  /** Whether the pending record is unassigned: a read of it says so. */
  async function customersUnassigned(ctx: TestContext): Promise<boolean> {
    try {
      await datasetGet(ctx.config.baseUrl, ctx.repoName, WS, customersPath, await ctx.opts());
      return false;
    } catch (err) {
      assert.ok(err instanceof ApiError, String(err));
      assert.equal(err.code, 'dataset_unassigned');
      return true;
    }
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

      // Its describe says when the step was applied, and by the commit the
      // history shows, without reading the history
      const [migrated] = (await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'tasks', 1, await ctx.opts())).commits;
      const { migrations } = await workspaceRecordDescribe(ctx.config.baseUrl, ctx.repoName, WS, 'tasks', await ctx.opts());
      assert.deepEqual(migrations.map(({ name, form }) => [name, form]), [['add_owner', 'rows']]);
      assert.ok(equalFor(OptionType(RecordMigrationAppliedType))(migrations[0]!.applied,
        some<RecordMigrationApplied>({ at: some(migrated!.at), commit: some(migrated!.hash) })),
      'applied by its $migrate commit, when it was made');

      // The same package again keeps the record as it is, and another package
      // over it says so in the record's history.
      assert.deepEqual((await deploy(ctx, '2.0.0')).records, [{ record: RECORD, action: variant('keep', { deploy: false }) }]);
      assert.deepEqual((await deploy(ctx, '2.1.0')).records, [{ record: RECORD, action: variant('keep', { deploy: true }) }]);
      assert.deepEqual(await history(ctx), ['$deploy', '$migrate:add_owner', 'add', '$init']);
    });

    it('says how far it has got while it runs, in the job and through the workspace\'s lock', async (t) => {
      const ctx = await holding(t, ['1.0.0', '2.0.0']);
      await deploy(ctx, '1.0.0');
      const opts = await ctx.opts();
      const base = `${ctx.config.baseUrl}/api/repos/${encodeURIComponent(ctx.repoName)}/workspaces/${WS}`;

      // Started here rather than through workspaceDeploy, so the job is polled
      // as often as it moves; the migration runs on the runner, which takes a
      // while to start.
      const { id } = await call(`${base}/deploy`, 'POST', PackageJobResponseType, opts, encodeBeast2For(WorkspaceDeployRequestType)({
        packageRef: `${PKG}@2.0.0`, schema: variant('migrate', null), inputs: variant('reset', null), allowDropRecords: false, plan: false,
      }));
      const reported: DeployProgress[] = [];
      const held: LockStatus[] = [];
      for (;;) {
        const [status, lock] = await Promise.all([
          call(`${base}/deploy/${encodeURIComponent(id)}`, 'GET', WorkspaceDeployStatusType, opts),
          workspaceLockStatus(ctx.config.baseUrl, ctx.repoName, WS, opts),
        ]);
        if (lock !== null) held.push(lock);
        if (status.type !== 'processing') {
          assert.equal(status.type, 'completed', inspect(status, { depth: 4 }));
          break;
        }
        if (status.value.type === 'deploying' && status.value.value.type === 'some') reported.push(status.value.value.value);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      assert.ok(reported.length > 0, 'the job said how far it had got while it ran');
      for (const progress of reported) {
        assert.deepEqual(progress.package, { name: PKG, version: '2.0.0' });
        assert.deepEqual(progress.files, [], 'a server leaves a file source to the client, so it takes in none');
        assert.deepEqual(progress.records.map((record) => [record.plan, record.indexes]),
          [[{ record: RECORD, action: variant('migrate', { steps: ['add_owner'] }) }, []]]);
      }
      // The record's step only moves on: waiting, its migration, then done.
      const steps = reported.map((progress) => progress.records[0]!.step);
      const order = steps.map((step) => ['waiting', 'migrating', 'done'].indexOf(step.type));
      assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at >= order[i - 1]!)), inspect(steps, { depth: 3 }));
      for (const step of steps) {
        if (step.type === 'migrating') assert.deepEqual(step.value, { name: 'add_owner', step: 1n, steps: 1n });
      }

      assert.ok(held.every((lock) => lock.state.operation.type === 'deployment'), 'only the deploy held the workspace');
      assert.ok(held.some((lock) => lock.progress.type === 'some' && lock.progress.value.type === 'deployment'
        && lock.progress.value.value.package.version === '2.0.0'), 'its lock said how far it had got too');
      assert.equal(await workspaceLockStatus(ctx.config.baseUrl, ctx.repoName, WS, opts), null,
        'nothing holds the workspace once the deploy has finished');
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

    it('leaves a record declared with no initial value unassigned, refusing its writes, and a run leaves its dependents waiting', async (t) => {
      const ctx = await holdingPending(t, ['2.0.0']);
      const opts = await ctx.opts();
      assert.deepEqual((await deployPending(ctx, '2.0.0')).records, [{ record: CUSTOMERS, action: variant('unassigned', null) }]);
      assert.equal(await customersUnassigned(ctx), true);
      assert.deepEqual(await customersHistory(ctx), [], 'no commit was written');

      const added = await workspaceRecordMutate(ctx.config.baseUrl, ctx.repoName, WS, 'customers', 'add',
        { args: [encodeStr('b'), encodeStr('B')], actor: none, limits: none }, opts);
      assert.equal(added.outcome.type, 'invalid', inspect(added, { depth: 4 }));
      assert.match(added.outcome.type === 'invalid' ? added.outcome.value.message : '', /has no state yet: it is unassigned until its first state is committed/);

      // Its dependent waits, as it waits on an unset input: a run leaves it
      // waiting and completes without it, so nothing runs on an empty state
      const status = await workspaceStatus(ctx.config.baseUrl, ctx.repoName, WS, opts);
      assert.equal(status.tasks.find((task) => task.name === 'count')?.status.type, 'waiting');
      const run = await dataflowExecute(ctx.config.baseUrl, ctx.repoName, WS, {}, opts);
      assert.equal(run.success, true, inspect(run, { depth: 3 }));
      assert.deepEqual([run.executed, run.waiting, run.failed, run.skipped], [0n, 1n, 0n, 0n]);
      assert.deepEqual(run.tasks, [], 'a task left waiting has no event');
      assert.equal((await workspaceStatus(ctx.config.baseUrl, ctx.repoName, WS, opts)).tasks.find((task) => task.name === 'count')?.status.type, 'waiting');
    });

    it('sends a record declared with no initial value back to unassigned under --schema=reset, and says so', async (t) => {
      const ctx = await holdingPending(t, ['1.0.0', '2.0.0']);
      assert.deepEqual((await deployPending(ctx, '1.0.0')).records, [{ record: CUSTOMERS, action: variant('mint', null) }]);
      const added = await workspaceRecordMutate(ctx.config.baseUrl, ctx.repoName, WS, 'customers', 'add',
        { args: [encodeStr('b'), encodeStr('B')], actor: none, limits: none }, await ctx.opts());
      assert.equal(added.outcome.type, 'committed');

      // A type change with no migration, and no initial value to reset to
      await assert.rejects(deployPending(ctx, '2.0.0'),
        /record 'records\/customers' changed type with no migration[\s\S]*--schema=reset to unassign it, for its first state to be committed again/);
      assert.deepEqual(await customersHistory(ctx), ['add', '$init'], 'a refused deploy writes nothing');

      const { records } = await deployPending(ctx, '2.0.0', { schema: 'reset' });
      assert.deepEqual(records.map((plan) => plan.action.type), ['unassign'], 'the plan says the record goes back to unassigned, not that it is reset to a value');
      const action = records[0]!.action;
      assert.ok(action.type === 'unassign' && /changed type with no migration/.test(action.value.reason), inspect(action, { depth: 3 }));
      assert.equal(await customersUnassigned(ctx), true);
      assert.deepEqual(await customersHistory(ctx), [], 'the chain went with the state');
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
