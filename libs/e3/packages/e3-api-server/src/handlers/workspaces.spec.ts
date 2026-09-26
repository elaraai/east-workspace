/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Deploy route tests: a record's index builds run on the runner the server
 * injects — an embedder mounts these routes with a runner of its own — and
 * without one, a deploy that owes a build is refused before it writes anything.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { DictType, NullType, StringType, StructType, encodeBeast2For, decodeBeast2For, toEastTypeValue, variant, none } from '@elaraai/east';
import { MockTaskRunner, readRecordState, storeDatasetBytes, workspaceCreate, workspaceGetState } from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import { BEAST2_CONTENT_TYPE, PackageObjectType, RecordObjectType, RecordIndexObjectType, WorkspaceDeployRequestType } from '@elaraai/e3-types';
import { createWorkspaceRoutes } from '../routes/workspaces.js';
import { ResponseType } from '../types.js';

const REPO = 'test-repo';
const WS = 'main';
const PlansType = DictType(StringType, StringType);

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

/** Deploy `planrecords@1.0.0` through the routes, mounted with `getRunner`. */
async function deploy(storage: InMemoryStorage, getRunner?: () => MockTaskRunner): Promise<{ type: string; value: unknown }> {
  const app = new Hono();
  app.route('/api/repos/:repo/workspaces', createWorkspaceRoutes(storage, () => REPO, undefined, getRunner));
  const response = await app.request(`/api/repos/r/workspaces/${WS}/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
    body: encodeBeast2For(WorkspaceDeployRequestType)({ packageRef: 'planrecords@1.0.0' }),
  });
  return decodeBeast2For(ResponseType(NullType))(new Uint8Array(await response.arrayBuffer())) as { type: string; value: unknown };
}

describe('deploy route', () => {
  let storage: InMemoryStorage;
  let emptyIndex: string;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    emptyIndex = await seedIndexedPackage(storage);
  });

  it("builds a record's indexes on the runner the server injects", async () => {
    const runner = new MockTaskRunner();
    runner.setDefaultResult({ state: 'success', cached: false, outputHash: emptyIndex });

    const response = await deploy(storage, () => runner);
    assert.equal(response.type, 'success', JSON.stringify(response));
    assert.ok(runner.getCalls().length > 0, 'the index was built on the injected runner');
    const ref = await storage.datasets.read(REPO, WS, 'records/plans');
    assert.ok(ref && ref.type === 'value');
    assert.deepEqual([...(await readRecordState(storage, REPO, ref.value.hash)).indexes.keys()], ['by_value']);
  });

  it('without a runner, refuses a deploy that owes an index build, and writes nothing', async () => {
    const response = await deploy(storage);
    assert.equal(response.type, 'error');
    const error = response.value as { type: string; value: { message: string } };
    assert.equal(error.type, 'internal');
    assert.match(error.value.message, /given no task runner/);
    assert.equal(await workspaceGetState(storage, REPO, WS), null, 'the workspace is still undeployed');
    assert.deepEqual(await storage.datasets.list(REPO, WS), [], 'no ref was written');
  });
});
