/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Record route tests: the audit actor is derived from the verified identity
 * (a forged request actor is ignored) when auth is configured, honoured from
 * the request otherwise; and compaction is gated to an elevated role.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { IntegerType, encodeBeast2For, decodeBeast2For, toEastTypeValue, variant, some, none } from '@elaraai/east';
import { MockTaskRunner, BEAST2_CONTENT_TYPE, recordHistory } from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import {
  PackageObjectType,
  RecordObjectType,
  MutationObjectType,
  RecordCommitType,
  WorkspaceStateType,
} from '@elaraai/e3-types';
import { createWorkspaceRecordRoutes } from '../routes/records.js';
import { ResponseType, MutationResultType, MutationCallRequestType } from '../types.js';

const REPO = 'test-repo';
const WS = 'main';
const encodeInt = encodeBeast2For(IntegerType);
const encodeMutationCall = encodeBeast2For(MutationCallRequestType);

async function decodeResponse<T>(response: Response, type: any): Promise<{ type: string; value: T }> {
  const body = new Uint8Array(await response.arrayBuffer());
  return decodeBeast2For(ResponseType(type))(body) as { type: string; value: T };
}

/** Seed an InMemoryStorage with a deployed `counter` record + `increment` mutation. */
async function seedDeployedRecord(storage: InMemoryStorage): Promise<void> {
  await storage.repos.create(REPO);

  const stateHash = await storage.objects.write(REPO, encodeInt(0n));
  const genesisHash = await storage.objects.write(REPO, encodeBeast2For(RecordCommitType)({
    parent: none, state: stateHash, mutation: '$init', args: none, actor: 'system:deploy', at: new Date(0),
  }));
  const bodyIrHash = await storage.objects.write(REPO, encodeInt(0n)); // stand-in IR (MockTaskRunner ignores it)
  const mutHash = await storage.objects.write(REPO, encodeBeast2For(MutationObjectType)({
    bodyIr: bodyIrHash,
    argTypes: [toEastTypeValue(IntegerType)],
    runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }),
  }));
  const recHash = await storage.objects.write(REPO, encodeBeast2For(RecordObjectType)({
    path: 'records/counter',
    mutations: new Map([['increment', mutHash]]),
  }));

  const structure = variant('struct', new Map([
    ['records', variant('struct', new Map([
      ['counter', variant('value', { type: toEastTypeValue(IntegerType), writable: false })],
    ]))],
  ]));
  const pkgHash = await storage.objects.write(REPO, encodeBeast2For(PackageObjectType)({
    tasks: new Map(),
    data: { structure, refs: new Map([['records/counter', variant('value', { hash: stateHash, versions: new Map() })]]) },
    functions: new Map(),
    records: new Map([['counter', recHash]]),
  }));

  await storage.refs.workspaceWrite(REPO, WS, encodeBeast2For(WorkspaceStateType)({
    packageName: 'counters', packageVersion: '1.0.0', packageHash: pkgHash, deployedAt: new Date(0), currentRunId: none,
  }));
  await storage.datasets.write(REPO, WS, 'records/counter',
    variant('value', { hash: stateHash, versions: new Map([['.records.counter', genesisHash]]) }));
}

type ActorOption = ReturnType<typeof some<string>> | typeof none;

/** Mount the record routes, optionally injecting an authenticated identity. */
function buildApp(storage: InMemoryStorage, runner: MockTaskRunner, identity?: { sub: string; email?: string; roles?: string[] }): Hono {
  const app = new Hono();
  if (identity) {
    app.use('*', async (c, next) => { (c as any).set('identity', identity); await next(); });
  }
  app.route('/api/repos/:repo/workspaces/:ws/records', createWorkspaceRecordRoutes(storage, () => REPO, () => runner));
  return app;
}

function postMutate(app: Hono, actor: ActorOption): Promise<Response> {
  return Promise.resolve(app.request(`/api/repos/r/workspaces/${WS}/records/counter/mutations/increment`, {
    method: 'POST',
    headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
    body: encodeMutationCall({ args: [encodeInt(5n)], actor, limits: none }),
  }));
}

function postCompact(app: Hono): Promise<Response> {
  return Promise.resolve(app.request(`/api/repos/r/workspaces/${WS}/records/counter/compact`, {
    method: 'POST',
    headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
    body: new Uint8Array(),
  }));
}

describe('record routes', () => {
  let storage: InMemoryStorage;
  let runner: MockTaskRunner;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    runner = new MockTaskRunner();
    runner.setDetachedResult({ kind: 'success', value: encodeInt(5n), stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false });
    await seedDeployedRecord(storage);
  });

  it('records the authenticated identity as the actor, ignoring a forged request actor', async () => {
    const app = buildApp(storage, runner, { sub: 'u1', email: 'alice@x.io', roles: [] });
    const result = await decodeResponse<any>(await postMutate(app, some('cli:attacker')), MutationResultType);
    assert.equal(result.type, 'success');
    assert.equal(result.value.outcome.type, 'committed');

    const history = await recordHistory(storage, REPO, WS, 'counter');
    assert.equal(history[0]!.commit.actor, 'auth:alice@x.io'); // forged 'cli:attacker' ignored
  });

  it('honours the client-supplied actor when no auth is configured', async () => {
    const app = buildApp(storage, runner); // no identity
    assert.equal((await decodeResponse<any>(await postMutate(app, some('cli:bob')), MutationResultType)).value.outcome.type, 'committed');
    assert.equal((await recordHistory(storage, REPO, WS, 'counter'))[0]!.commit.actor, 'cli:bob');
  });

  it('falls back to "api" for an unauthenticated request with no actor', async () => {
    await postMutate(buildApp(storage, runner), none);
    assert.equal((await recordHistory(storage, REPO, WS, 'counter'))[0]!.commit.actor, 'api');
  });

  it('gates compaction behind an elevated role when authenticated', async () => {
    const denied = await decodeResponse<any>(await postCompact(buildApp(storage, runner, { sub: 'u1', roles: ['member'] })), MutationResultType);
    assert.equal(denied.type, 'error');
    assert.equal((denied.value as { type: string }).type, 'permission_denied');

    const allowed = await decodeResponse<any>(await postCompact(buildApp(storage, runner, { sub: 'u1', roles: ['admin'] })), MutationResultType);
    assert.notEqual(allowed.type === 'error' ? (allowed.value as { type: string }).type : 'ok', 'permission_denied');
  });
});
