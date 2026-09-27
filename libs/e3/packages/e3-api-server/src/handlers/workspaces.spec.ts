/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Deploy route tests: a deploy runs as a job the client polls, on the runner
 * the job's store was given — an embedder mounts these routes with a store and
 * a runner of its own — and without one, a deploy that owes an index build
 * fails before it writes anything.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { DictType, NullType, StringType, StructType, encodeBeast2For, decodeBeast2For, toEastTypeValue, variant, none } from '@elaraai/east';
import {
  InMemoryTransferBackend, MockTaskRunner, readRecordState, storeDatasetBytes, workspaceCreate, workspaceGetState,
  type TaskRunner,
} from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import {
  BEAST2_CONTENT_TYPE, PackageJobResponseType, PackageObjectType, RecordObjectType, RecordIndexObjectType,
  WorkspaceDeployRequestType, WorkspaceDeployStatusType, type WorkspaceDeployStatus,
} from '@elaraai/e3-types';
import { createWorkspaceRoutes } from '../routes/workspaces.js';
import { ResponseType } from '../types.js';

const REPO = 'test-repo';
const WS = 'main';
const PlansType = DictType(StringType, StringType);
const decodeStarted = decodeBeast2For(ResponseType(PackageJobResponseType));
const decodeStatus = decodeBeast2For(ResponseType(WorkspaceDeployStatusType));

/**
 * Seed `planrecords@1.0.0` — an empty `plans` record declaring one index — and
 * an empty workspace to deploy it to.
 *
 * @returns An empty stored index collection: what a build of that index writes
 */
async function seedIndexedPackage(storage: InMemoryStorage): Promise<string> {
  await storage.repos.create(REPO);
  const state = await storeDatasetBytes(storage, REPO, encodeBeast2For(PlansType)(new Map()));
  const ir = await storage.objects.write(REPO, new Uint8Array([0])); // stand-in IR: the mock runner never reads it
  const index = await storage.objects.write(REPO, encodeBeast2For(RecordIndexObjectType)({
    keyIr: ir,
    multi: false,
    valueIr: none,
    keyType: toEastTypeValue(StringType),
    valueType: toEastTypeValue(NullType),
    buildIr: ir,
    runner: variant('east_node', { platforms: [] }),
  }));
  const record = await storage.objects.write(REPO, encodeBeast2For(RecordObjectType)({
    path: 'records/plans', mutations: new Map(), indexes: new Map([['by_value', index]]), migrations: [],
  }));
  const structure = variant('struct', new Map([
    ['records', variant('struct', new Map([
      ['plans', variant('value', { type: toEastTypeValue(PlansType), writable: false })],
    ]))],
  ]));
  const pkg = await storage.objects.write(REPO, encodeBeast2For(PackageObjectType)({
    tasks: new Map(),
    data: { structure, refs: new Map([['records/plans', variant('value', { hash: state, versions: new Map() })]]) },
    functions: new Map(),
    records: new Map([['plans', record]]),
    sources: new Map(),
  }));
  await storage.refs.packageWrite(REPO, 'planrecords', '1.0.0', pkg);
  await workspaceCreate(storage, REPO, WS);
  return storeDatasetBytes(storage, REPO,
    encodeBeast2For(DictType(StructType({ ik: StringType, k: StringType }), NullType))(new Map()));
}

/** The workspace routes, whose deploy jobs run on `getRunner`'s runner. */
function routes(storage: InMemoryStorage, getRunner?: () => TaskRunner): Hono {
  const app = new Hono();
  app.route('/api/repos/:repo/workspaces', createWorkspaceRoutes(storage, () => REPO, new InMemoryTransferBackend({
    storage,
    getRepoPath: () => REPO,
    ...(getRunner !== undefined && { getRunner }),
  })));
  return app;
}

/** Start a deploy of `packageRef`: the job's id, or why the server started none. */
async function start(app: Hono, packageRef = 'planrecords@1.0.0'): Promise<ReturnType<typeof decodeStarted>> {
  const response = await app.request(`/api/repos/r/workspaces/${WS}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
    body: encodeBeast2For(WorkspaceDeployRequestType)({
      packageRef, schema: variant('migrate', null), allowDropRecords: false, plan: false,
    }),
  });
  return decodeStarted(new Uint8Array(await response.arrayBuffer()));
}

/** A deploy job's status. */
async function poll(app: Hono, id: string): Promise<WorkspaceDeployStatus> {
  const response = await app.request(`/api/repos/r/workspaces/${WS}/deploy/${id}`);
  const answer = decodeStatus(new Uint8Array(await response.arrayBuffer()));
  if (answer.type !== 'success') assert.fail(`the poll was refused: ${answer.value.type}`);
  return answer.value;
}

/** A deploy job's status once it has finished. */
async function finished(app: Hono, id: string): Promise<WorkspaceDeployStatus> {
  for (;;) {
    const status = await poll(app, id);
    if (status.type !== 'processing') return status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('deploy route', () => {
  let storage: InMemoryStorage;
  let emptyIndex: string;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    emptyIndex = await seedIndexedPackage(storage);
  });

  it("runs a deploy as a job, which builds a record's indexes on the runner its store was given", async () => {
    const runner = new MockTaskRunner();
    runner.setDefaultResult({ state: 'success', cached: false, outputHash: emptyIndex });
    const app = routes(storage, () => runner);

    const started = await start(app);
    if (started.type !== 'success') assert.fail(`the deploy was refused: ${started.value.type}`);
    const status = await finished(app, started.value.id);
    if (status.type !== 'completed') assert.fail(`the deploy did not complete: ${status.type}`);
    assert.deepEqual(status.value.records.map((plan) => [plan.record, plan.action.type]), [['records/plans', 'mint']]);
    assert.deepEqual(status.value.indexes.map((plan) => [plan.record, plan.index, plan.action.type]),
      [['records/plans', 'by_value', 'build']]);

    assert.ok(runner.getCalls().length > 0, 'the index was built on the runner the store was given');
    const ref = await storage.datasets.read(REPO, WS, 'records/plans');
    assert.ok(ref && ref.type === 'value');
    assert.deepEqual([...(await readRecordState(storage, REPO, ref.value.hash)).indexes.keys()], ['by_value']);
  });

  it('answers before the deploy has finished, and the job reports it once it has', async () => {
    // A build that holds until released: a deploy over a large record, which
    // outlasts the request that starts it.
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const runner = {
      execute: async () => {
        await released;
        return { state: 'success', cached: false, executionId: 'held', outputHash: emptyIndex };
      },
    } as unknown as TaskRunner;
    const app = routes(storage, () => runner);

    const started = await start(app);
    if (started.type !== 'success') assert.fail(`the deploy was refused: ${started.value.type}`);
    assert.equal((await poll(app, started.value.id)).type, 'processing');
    assert.equal(await workspaceGetState(storage, REPO, WS), null, 'nothing is deployed while the job runs');

    release();
    assert.equal((await finished(app, started.value.id)).type, 'completed');
    assert.equal((await workspaceGetState(storage, REPO, WS))?.packageName, 'planrecords');
  });

  it('without a runner, fails a deploy that owes an index build, and writes nothing', async () => {
    const app = routes(storage);
    const started = await start(app);
    if (started.type !== 'success') assert.fail(`the deploy was refused: ${started.value.type}`);
    const status = await finished(app, started.value.id);
    if (status.type !== 'failed') assert.fail(`the deploy did not fail: ${status.type}`);
    assert.match(status.value.message, /given no task runner/);
    assert.equal(await workspaceGetState(storage, REPO, WS), null, 'the workspace is still undeployed');
    assert.deepEqual(await storage.datasets.list(REPO, WS), [], 'no ref was written');
  });

  it('refuses a package the repository does not hold at once, starting no job', async () => {
    const started = await start(routes(storage), 'planrecords@9.9.9');
    assert.equal(started.type, 'error');
    assert.equal(started.value.type, 'package_not_found');
  });
});
