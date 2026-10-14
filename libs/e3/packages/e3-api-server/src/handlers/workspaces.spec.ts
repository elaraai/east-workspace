/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Deploy route tests: a deploy runs as a job the client polls, on the runner
 * the job's store was given — an embedder mounts these routes with a store and
 * a runner of its own — and without one, a deploy that owes an index build
 * fails before it writes anything. While it runs, the job and the workspace's
 * lock say how far it has got. A deploy refused at its start files no job.
 *
 * Workspace route tests: a list reads the records in one call, a get reads
 * the one record and never the list, and a status is answered conditionally:
 * with an `ETag`, and `304 Not Modified` to a poll that holds it, reading
 * nothing of the workspace but its revision, each `no-store`.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import {
  ArrayType, DictType, IntegerType, NullType, OptionType, StringType, StructType, encodeBeast2For, decodeBeast2For, toEastTypeValue, variant,
  none, some,
} from '@elaraai/east';
import {
  InMemoryTransferBackend, MockTaskRunner, readRecordState, storeDatasetBytes, workspaceCreate, workspaceGetState,
  type TaskRunner,
} from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import {
  BEAST2_CONTENT_TYPE, E3_RELEASE, PackageJobResponseType, PackageObjectType, RecordObjectType, RecordIndexObjectType,
  WorkspaceDeployRequestType, WorkspaceDeployStatusType, WorkspaceInfoType, WorkspaceRecordType, WorkspaceStateType, dataflowForce,
  type WorkspaceDeployStatus,
} from '@elaraai/e3-types';
import { createWorkspaceRoutes } from '../routes/workspaces.js';
import { LockStatusType, ResponseType, WorkspaceStatusResultType, type LockStatus } from '../types.js';

const REPO = 'test-repo';
const WS = 'main';
const PlansType = DictType(StringType, StringType);
const decodeStarted = decodeBeast2For(ResponseType(PackageJobResponseType));
const decodeStatus = decodeBeast2For(ResponseType(WorkspaceDeployStatusType));
const decodeLock = decodeBeast2For(ResponseType(OptionType(LockStatusType)));

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
    runner: variant('east_node', { platforms: [], decode: variant('lazy', null) }),
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

/** The workspace routes, whose deploy jobs run on `getRunner`'s runner and are
 *  filed with `transfer`, when given. */
function routes(storage: InMemoryStorage, getRunner?: () => TaskRunner, transfer?: InMemoryTransferBackend): Hono {
  const app = new Hono();
  app.route('/api/repos/:repo/workspaces', createWorkspaceRoutes(storage, () => REPO, transfer ?? new InMemoryTransferBackend({
    storage,
    getRepoPath: () => REPO,
    ...(getRunner !== undefined && { getRunner }),
  }), getRunner ?? (() => new MockTaskRunner())));
  return app;
}

/** Start a deploy of `packageRef` to `ws`: the job's id, or why the server
 *  started none. */
async function start(app: Hono, packageRef = 'planrecords@1.0.0', ws = WS): Promise<ReturnType<typeof decodeStarted>> {
  const response = await app.request(`/api/repos/r/workspaces/${encodeURIComponent(ws)}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
    body: encodeBeast2For(WorkspaceDeployRequestType)({
      packageRef, schema: variant('migrate', null), inputs: variant('reset', null), allowDropRecords: false, plan: false,
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

/** What holds the workspace, and how far it says it has got; null when nothing does. */
async function lockStatus(app: Hono): Promise<LockStatus | null> {
  const response = await app.request(`/api/repos/r/workspaces/${WS}/lock`);
  const answer = decodeLock(new Uint8Array(await response.arrayBuffer()));
  if (answer.type !== 'success') assert.fail(`the lock was refused: ${answer.value.type}`);
  return answer.value.type === 'some' ? answer.value.value : null;
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

  it('says how far it has got while it runs, in the job and through the workspace lock', async () => {
    // A build that holds until released, and says when it has started.
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let begin!: () => void;
    const building = new Promise<void>((resolve) => { begin = resolve; });
    const runner = {
      execute: async () => {
        begin();
        await released;
        return { state: 'success', cached: false, executionId: 'held', outputHash: emptyIndex };
      },
    } as unknown as TaskRunner;
    const app = routes(storage, () => runner);

    const started = await start(app);
    if (started.type !== 'success') assert.fail(`the deploy was refused: ${started.value.type}`);
    await building;

    // The deploy is building the record's index: the job says so.
    const status = await poll(app, started.value.id);
    if (status.type !== 'processing' || status.value.type !== 'deploying' || status.value.value.type !== 'some') {
      assert.fail(`the job says nothing of how far it has got: ${status.type}`);
    }
    const progress = status.value.value.value;
    assert.deepEqual(progress.package, { name: 'planrecords', version: '1.0.0' });
    assert.deepEqual(progress.files, [], 'a server leaves a file source to the client, so it takes in none');
    assert.deepEqual(progress.records, [{
      plan: { record: 'records/plans', action: variant('mint', null) },
      indexes: ['by_value'],
      step: variant('indexing', { index: 'by_value', build: 1n, builds: 1n }),
    }]);

    // So does its lock, for a watcher that knows no job: a first deploy has no
    // status to read.
    const lock = await lockStatus(app);
    assert.equal(lock?.state.operation.type, 'deployment');
    assert.deepEqual(lock?.progress, some(variant('deployment', progress)));

    release();
    assert.equal((await finished(app, started.value.id)).type, 'completed');
    assert.equal(await lockStatus(app), null, 'nothing holds the workspace once the deploy has finished');
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

  it('refuses a deploy while a run that is stopping still holds the workspace, with a Retry-After, filing no job (#1286)', async () => {
    const transfer = new InMemoryTransferBackend({ storage, getRepoPath: () => REPO });
    const filed = mock.method(transfer.workspaceDeploy, 'create');
    const app = routes(storage, undefined, transfer);
    // A run that has ended, and still holds the dataflow lock it took as it started.
    const lock = await storage.locks.acquire(REPO, `${WS}#dataflow`, variant('dataflow', null));
    await storage.runStates(REPO).create({
      release: E3_RELEASE, id: 'run-1', repo: REPO, workspace: WS, startedAt: new Date(Date.now() - 60_000), force: dataflowForce(false),
      filter: none, graph: none, graphHash: none, tasks: new Map(), executed: 0n, cached: 0n, failed: 0n, skipped: 0n, status: 'cancelled',
      completedAt: some(new Date(Date.now() + 1_000)), error: none, versionVectors: new Map(), inputSnapshot: new Map(), taskOutputPaths: [],
      reexecuted: 0n, events: [], eventSeq: 0n,
    });

    const response = await app.request(`/api/repos/r/workspaces/${WS}/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
      body: encodeBeast2For(WorkspaceDeployRequestType)({
        packageRef: 'planrecords@1.0.0', schema: variant('migrate', null), inputs: variant('reset', null), allowDropRecords: false, plan: false,
      }),
    });
    const refused = decodeStarted(new Uint8Array(await response.arrayBuffer()));
    assert.equal(refused.type === 'error' && refused.value.type, 'workspace_locked');
    assert.equal(response.headers.get('retry-after'), '1');
    assert.equal(filed.mock.callCount(), 0, 'no job was filed');

    await lock!.release();
    assert.equal((await start(app)).type, 'success', 'the deploy starts once the run has let go');
  });

  it('refuses a package the repository does not hold at once, starting no job', async () => {
    const started = await start(routes(storage), 'planrecords@9.9.9');
    assert.equal(started.type, 'error');
    assert.equal(started.value.type, 'package_not_found');
  });

  it('refuses a name no workspace can have at once, as invalid_name of a workspace, filing no job', async () => {
    const transfer = new InMemoryTransferBackend({ storage, getRepoPath: () => REPO });
    const filed = mock.method(transfer.workspaceDeploy, 'create');
    const app = routes(storage, undefined, transfer);

    for (const [name, why] of [
      ['bad:name', 'holds ":", which a file name cannot'],
      ['a#b', 'holds "#", which joins the parts of a lock\'s name'],
    ] as const) {
      assert.deepEqual(await start(app, 'planrecords@1.0.0', name), variant('error', variant('invalid_name', {
        kind: 'workspace', name, message: `the workspace name ${JSON.stringify(name)} ${why}`,
      })), name);
    }
    assert.equal(filed.mock.callCount(), 0, 'no job was filed');
  });
});

/**
 * A repository holding `main`, with a package of one input, `inputs/x`,
 * deployed to it, and `empty`, nothing deployed to it.
 */
async function seedStatusWorkspaces(storage: InMemoryStorage): Promise<void> {
  await storage.repos.create(REPO);
  const x = await storeDatasetBytes(storage, REPO, encodeBeast2For(IntegerType)(1n));
  const structure = variant('struct', new Map([
    ['inputs', variant('struct', new Map([['x', variant('value', { type: toEastTypeValue(IntegerType), writable: true })]]))],
  ]));
  const pkg = await storage.objects.write(REPO, encodeBeast2For(PackageObjectType)({
    tasks: new Map(),
    data: { structure, refs: new Map([['inputs/x', variant('value', { hash: x, versions: new Map() })]]) },
    functions: new Map(),
    records: new Map(),
    sources: new Map(),
  }));
  await storage.refs.workspaceWrite(REPO, WS, encodeBeast2For(WorkspaceRecordType)(some({
    packageName: 'one', packageVersion: '1.0.0', packageHash: pkg, deployedAt: new Date(0), currentRunId: none,
  })));
  await storage.datasets.write(REPO, WS, 'inputs/x', variant('value', { hash: x, versions: new Map() }));
  await workspaceCreate(storage, REPO, 'empty');
}

/** Counts the calls of a method of `target`. */
function countOf(target: object, method: string): { calls: number } {
  const original = (target as Record<string, (...args: unknown[]) => unknown>)[method]!.bind(target);
  const seen = { calls: 0 };
  (target as Record<string, unknown>)[method] = (...args: unknown[]) => {
    seen.calls++;
    return original(...args);
  };
  return seen;
}

describe('workspace routes', () => {
  let storage: InMemoryStorage;
  let app: Hono;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    await seedStatusWorkspaces(storage);
    app = routes(storage);
  });

  it('list every workspace with what is deployed to it, reading the records in one call and none on its own', async () => {
    const all = countOf(storage.refs, 'workspaceReadAll');
    const each = countOf(storage.refs, 'workspaceRead');
    const response = await app.request('/api/repos/r/workspaces');
    const answer = decodeBeast2For(ResponseType(ArrayType(WorkspaceInfoType)))(new Uint8Array(await response.arrayBuffer()));
    if (answer.type !== 'success') assert.fail(`the list was refused: ${answer.value.type}`);
    assert.deepEqual(answer.value.map(({ name, deployed, packageName }) => [name, deployed, packageName.type === 'some' ? packageName.value : null]).sort(),
      [['empty', false, null], [WS, true, 'one']]);
    assert.deepEqual([all.calls, each.calls], [1, 0]);
  });

  it('get a workspace from its record alone: its state, that nothing is deployed to it, or that there is none, never listing the repository', async () => {
    const lists = countOf(storage.refs, 'workspaceList');
    const decode = decodeBeast2For(ResponseType(WorkspaceStateType));
    const get = async (ws: string) => decode(new Uint8Array(await (await app.request(`/api/repos/r/workspaces/${ws}`)).arrayBuffer()));
    const deployed = await get(WS);
    assert.equal(deployed.type === 'success' && deployed.value.packageName, 'one');
    const empty = await get('empty');
    assert.equal(empty.type === 'error' && empty.value.type, 'workspace_not_deployed');
    const missing = await get('nope');
    assert.equal(missing.type === 'error' && missing.value.type, 'workspace_not_found');
    assert.equal(lists.calls, 0, 'the record says which, so the repository is never listed');
  });

  it('answer a status with its ETag, 304 to a poll holding it without reading the workspace, each no-store, and the status again once anything moved', async () => {
    const decode = decodeBeast2For(ResponseType(WorkspaceStatusResultType));
    const status = async (headers: Record<string, string> = {}, ws = WS) => {
      const response = await app.request(`/api/repos/r/workspaces/${ws}/status`, { headers });
      const body = new Uint8Array(await response.arrayBuffer());
      return { code: response.status, etag: response.headers.get('etag'), cache: response.headers.get('cache-control'), body: body.length === 0 ? null : decode(body) };
    };
    const first = await status();
    assert.equal(first.code, 200);
    assert.match(first.etag ?? '', /^"[0-9a-f]{64}"$/, 'the ETag names the status revision');
    assert.equal(first.cache, 'no-store', 'no cache keeps a status');
    assert.equal(first.body?.type, 'success');
    const etag = first.etag!;

    // The poll holds the answer: nothing of the workspace is read but its revision.
    const refs = countOf(storage.datasets, 'readAll');
    const manys = countOf(storage.datasets, 'readMany');
    const objects = countOf(storage.objects, 'read');
    for (const held of [etag, `W/${etag}`, `"other", ${etag}`, '*']) {
      assert.deepEqual(await status({ 'If-None-Match': held }), { code: 304, etag, cache: 'no-store', body: null }, held);
    }
    assert.deepEqual([refs.calls, manys.calls, objects.calls], [0, 0, 0], 'no ref and no object read for a 304');
    const other = await status({ 'If-None-Match': '"not-it"' });
    assert.deepEqual([other.code, other.etag, other.body?.type], [200, etag, 'success'], 'a tag the answer does not have is answered the status');

    // A dataset written: the status again, with a new tag
    const x = await storage.datasets.read(REPO, WS, 'inputs/x');
    assert.ok(x !== null);
    await storage.datasets.write(REPO, WS, 'inputs/x', x);
    const moved = await status({ 'If-None-Match': etag });
    assert.equal(moved.code, 200);
    assert.notEqual(moved.etag, etag, 'the revision moved');
    assert.equal(moved.body?.type, 'success');
    // The workspace held: a status that says so has a tag of its own
    const lock = await storage.locks.acquire(REPO, WS, variant('deployment', null));
    assert.ok(lock !== null);
    try {
      const held = await status({ 'If-None-Match': moved.etag! });
      assert.equal(held.code, 200);
      assert.notEqual(held.etag, moved.etag, 'the lock moves the tag');
    } finally {
      await lock.release();
    }

    // No such workspace: the error, however the poll asks, and no tag
    const polls: Record<string, string>[] = [{}, { 'If-None-Match': etag }];
    for (const headers of polls) {
      const missing = await status(headers, 'nope');
      assert.deepEqual([missing.code, missing.etag, missing.body?.type === 'error' && missing.body.value.type], [200, null, 'workspace_not_found']);
    }
  });
});
