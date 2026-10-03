/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Record route tests: the audit actor is derived from the verified identity
 * (a forged request actor is ignored) when auth is configured, honoured from
 * the request otherwise; compaction is gated to an elevated role; and the
 * routes keep to the host's limits — a mutation's run and a compaction's
 * retries stop under its deadline, a history request that names no limit is
 * answered with its page, and a limit no request could meet is refused when
 * the routes are mounted.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { IntegerType, compareFor, encodeBeast2For, decodeBeast2For, equalFor, printFor, toEastTypeValue, variant, some, none } from '@elaraai/east';
import { MockTaskRunner, recordHistory, uuidv7 } from '@elaraai/e3-core';
import type { MutationOutcome, StorageBackend, TaskExecuteOptions, TaskResult } from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import {
  BEAST2_CONTENT_TYPE,
  PackageObjectType,
  RecordObjectType,
  MutationObjectType,
  RecordCommitType,
  WorkspaceRecordType,
} from '@elaraai/e3-types';
import { createWorkspaceRecordRoutes, type RecordRoutesOptions } from '../routes/records.js';
import { effectiveBudgetMs } from './records.js';
// Through the handlers entry, as a host reaches it.
import { mutationResultOf } from './index.js';
import {
  ResponseType,
  MutationResultType,
  MutationCallRequestType,
  RecordHistoryResultType,
  type MutationResult,
  type RecordHistoryResult,
} from '../types.js';

describe('effectiveBudgetMs', () => {
  it('returns undefined when no budget is supplied (local default: no gateway, no cap)', () => {
    assert.equal(effectiveBudgetMs(undefined), undefined);
  });

  it('subtracts the commit/encode headroom from the budget', () => {
    // HEADROOM_MS is 2000; a 30s gateway budget leaves 28s for the CAS loop.
    assert.equal(effectiveBudgetMs(30_000), 28_000);
  });

  it('floors at 1ms when the budget is at or below the headroom', () => {
    assert.equal(effectiveBudgetMs(2_000), 1);
    assert.equal(effectiveBudgetMs(500), 1);
    assert.equal(effectiveBudgetMs(0), 1);
  });
});

const REPO = 'test-repo';
const WS = 'main';
const encodeInt = encodeBeast2For(IntegerType);
const encodeMutationCall = encodeBeast2For(MutationCallRequestType);

/** Seed an InMemoryStorage with a deployed `counter` record + `increment` mutation. */
async function seedDeployedRecord(storage: InMemoryStorage): Promise<void> {
  await storage.repos.create(REPO);

  const stateHash = await storage.objects.write(REPO, encodeInt(0n));
  const genesisHash = await storage.objects.write(REPO, encodeBeast2For(RecordCommitType)({
    parent: none, state: stateHash, mutation: '$init', args: none, actor: 'system:deploy', at: new Date(0), delta: none,
  }));
  const bodyIrHash = await storage.objects.write(REPO, encodeInt(0n)); // stand-in IR (MockTaskRunner ignores it)
  const mutHash = await storage.objects.write(REPO, encodeBeast2For(MutationObjectType)({
    bodyIr: bodyIrHash,
    argTypes: [toEastTypeValue(IntegerType)],
    runner: variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) }),
    form: variant('reduce', null),
    programIr: '',
  }));
  const recHash = await storage.objects.write(REPO, encodeBeast2For(RecordObjectType)({
    path: 'records/counter',
    mutations: new Map([['increment', mutHash]]),
    indexes: new Map(),
    migrations: [],
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
    sources: new Map(),
  }));

  await storage.refs.workspaceWrite(REPO, WS, encodeBeast2For(WorkspaceRecordType)(some({
    packageName: 'counters', packageVersion: '1.0.0', packageHash: pkgHash, deployedAt: new Date(0), currentRunId: none,
  })));
  await storage.datasets.write(REPO, WS, 'records/counter',
    variant('value', { hash: stateHash, versions: new Map([['.records.counter', genesisHash]]) }));
}

type ActorOption = ReturnType<typeof some<string>> | typeof none;

/** Mount the record routes under the host's options, optionally injecting an
 *  authenticated identity. */
function buildApp(
  storage: InMemoryStorage,
  runner: MockTaskRunner,
  identity?: { sub: string; email?: string; roles?: string[] },
  options: RecordRoutesOptions = {},
): Hono {
  const app = new Hono();
  if (identity) {
    app.use('*', async (c, next) => { (c as any).set('identity', identity); await next(); });
  }
  app.route('/api/repos/:repo/workspaces/:ws/records', createWorkspaceRecordRoutes(storage, () => REPO, () => runner, options));
  return app;
}

const decodeMutationAnswer = decodeBeast2For(ResponseType(MutationResultType));
const printMutationAnswer = printFor(ResponseType(MutationResultType));
const decodeHistoryAnswer = decodeBeast2For(ResponseType(RecordHistoryResultType));
const printHistoryAnswer = printFor(ResponseType(RecordHistoryResultType));
const mutationResultEqual = equalFor(MutationResultType);
const printMutationResult = printFor(MutationResultType);
const compareInt = compareFor(IntegerType);
const printInt = printFor(IntegerType);

/** A mutation route's answer as the client decodes it: its result, or its
 *  error. */
async function mutationAnswer(response: Response) {
  return decodeMutationAnswer(new Uint8Array(await response.arrayBuffer()));
}

/** A mutation route's result, as the client decodes it: the route must have
 *  answered one, not an error. */
async function mutationResult(response: Response): Promise<MutationResult> {
  const answer = await mutationAnswer(response);
  if (answer.type !== 'success') assert.fail(`the route answered ${printMutationAnswer(answer)}`);
  return answer.value;
}

/** A history route's page, as the client decodes it. */
async function historyResult(response: Response): Promise<RecordHistoryResult> {
  const answer = decodeHistoryAnswer(new Uint8Array(await response.arrayBuffer()));
  if (answer.type !== 'success') assert.fail(`the route answered ${printHistoryAnswer(answer)}`);
  return answer.value;
}

/** A runner whose every run ends only when it is aborted, as a program that
 *  outruns its limit does. */
class StalledRunner extends MockTaskRunner {
  override execute(_storage: StorageBackend, _taskHash: string, _inputs: string[], options?: TaskExecuteOptions): Promise<TaskResult> {
    return new Promise((resolve) => {
      options!.signal!.addEventListener('abort', () => resolve({ state: 'error', cached: false, cancelled: true, executionId: uuidv7() }), { once: true });
    });
  }
}

function postMutate(app: Hono, actor: ActorOption, extraHeaders?: Record<string, string>): Promise<Response> {
  return Promise.resolve(app.request(`/api/repos/r/workspaces/${WS}/records/counter/mutations/increment`, {
    method: 'POST',
    headers: { 'Content-Type': BEAST2_CONTENT_TYPE, ...extraHeaders },
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

function getHistory(app: Hono, query = ''): Promise<Response> {
  return Promise.resolve(app.request(`/api/repos/r/workspaces/${WS}/records/counter/history${query}`));
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

  it('threads the Idempotency-Key header through the route so a retry dedups (no double-apply)', async () => {
    const app = buildApp(storage, runner); // no auth
    const first = await mutationResult(await postMutate(app, none, { 'Idempotency-Key': 'k1' }));
    const second = await mutationResult(await postMutate(app, none, { 'Idempotency-Key': 'k1' }));
    assert.equal(first.outcome.type, 'committed');
    assert.ok(mutationResultEqual(second, first), `the retry returns the original commit, not ${printMutationResult(second)}`);
    // genesis + exactly one commit: the keyed retry did not append a duplicate.
    assert.equal((await recordHistory(storage, REPO, WS, 'counter')).length, 2);
  });

  it('without the header a normal mutation still commits', async () => {
    const app = buildApp(storage, runner);
    assert.equal((await mutationResult(await postMutate(app, none))).outcome.type, 'committed');
    assert.equal((await recordHistory(storage, REPO, WS, 'counter')).length, 2);
  });

  it('records the authenticated identity as the actor, ignoring a forged request actor', async () => {
    const app = buildApp(storage, runner, { sub: 'u1', email: 'alice@x.io', roles: [] });
    assert.equal((await mutationResult(await postMutate(app, some('cli:attacker')))).outcome.type, 'committed');

    const history = await recordHistory(storage, REPO, WS, 'counter');
    assert.equal(history[0]!.commit.actor, 'auth:alice@x.io'); // forged 'cli:attacker' ignored
  });

  it('honours the client-supplied actor when no auth is configured', async () => {
    const app = buildApp(storage, runner); // no identity
    assert.equal((await mutationResult(await postMutate(app, some('cli:bob')))).outcome.type, 'committed');
    assert.equal((await recordHistory(storage, REPO, WS, 'counter'))[0]!.commit.actor, 'cli:bob');
  });

  it('falls back to "api" for an unauthenticated request with no actor', async () => {
    await postMutate(buildApp(storage, runner), none);
    assert.equal((await recordHistory(storage, REPO, WS, 'counter'))[0]!.commit.actor, 'api');
  });

  it('gates compaction behind an elevated role when authenticated', async () => {
    const denied = await mutationAnswer(await postCompact(buildApp(storage, runner, { sub: 'u1', roles: ['member'] })));
    if (denied.type !== 'error') assert.fail(`the compaction answered ${printMutationAnswer(denied)}`);
    assert.equal(denied.value.type, 'permission_denied');

    const allowed = await mutationResult(await postCompact(buildApp(storage, runner, { sub: 'u1', roles: ['admin'] })));
    assert.equal(allowed.outcome.type, 'committed', 'an elevated role compacts');
  });

  it('stops a mutation\'s run under the host\'s deadline, answering timed_out rather than outlasting it', async () => {
    // The run ends only when its limit aborts it. Under a 2.1 s deadline the
    // route keeps 2 s for the commit and the answer, so the run's limit is
    // what remains of the other 100 ms, not the request's 60 s default.
    const app = buildApp(storage, new StalledRunner(), undefined, { syncDeadlineMs: 2_100 });
    const { outcome } = await mutationResult(await postMutate(app, none));
    if (outcome.type !== 'timed_out') assert.fail(`the mutation answered ${printMutationResult({ outcome })}`);
    assert.ok(compareInt(outcome.value.ms, 1n) >= 0 && compareInt(outcome.value.ms, 100n) <= 0,
      `the run's limit was the deadline's rest, ${printInt(outcome.value.ms)} ms`);
    assert.equal((await recordHistory(storage, REPO, WS, 'counter')).length, 1, 'nothing was committed');
  });

  it('stops a contended compaction\'s retries under the host\'s deadline, answering conflict', async (t) => {
    const genesis = await storage.datasets.read(REPO, WS, 'records/counter');
    assert.ok(genesis && genesis.type === 'value');
    const stateHash = genesis.value.hash;

    // Every attempt loses its swap to a writer that commits between its read
    // and its write, and takes a tenth of a second of a clock that moves only
    // as the test moves it. Under a 2.2 s deadline the route keeps 2 s for the
    // commit and the answer, so two attempts spend the rest, where the
    // compaction's own 30 s window would take three hundred.
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const datasets = storage.datasets;
    const readVersioned = datasets.readVersioned.bind(datasets);
    let attempts = 0;
    datasets.readVersioned = async (repo: string, ws: string, path: string) => {
      const read = await readVersioned(repo, ws, path);
      attempts++;
      t.mock.timers.tick(100);
      await datasets.write(repo, ws, path, variant('value', {
        hash: stateHash, versions: new Map([['.records.counter', attempts.toString(16).padEnd(64, '0')]]),
      }));
      return read;
    };
    let result: MutationResult;
    try {
      result = await mutationResult(await postCompact(buildApp(storage, runner, undefined, { syncDeadlineMs: 2_200 })));
    } finally {
      datasets.readVersioned = readVersioned;
    }
    const conflicted: MutationResult = { outcome: variant('conflict', { attempts: 2n, detail: none }) };
    assert.ok(mutationResultEqual(result, conflicted), `the compaction answered ${printMutationResult(result)}`);
    assert.equal(attempts, 2, 'no attempt was made once the deadline was spent');
  });

  it('answers a history request that names no limit with the host\'s page, and one that names a limit with that', async () => {
    const app = buildApp(storage, runner, undefined, { historyLimit: 2 });
    // Each run's output is a stored state, which the next mutation reads.
    runner.setDefaultResult({ state: 'success', cached: false, outputHash: await storage.objects.write(REPO, encodeInt(5n)) });
    for (let i = 0; i < 3; i++) {
      assert.equal((await mutationResult(await postMutate(app, none))).outcome.type, 'committed');
    }
    const all = (await recordHistory(storage, REPO, WS, 'counter')).map((entry) => entry.hash);
    assert.equal(all.length, 4, '$init and three commits');

    const page = await historyResult(await getHistory(app));
    assert.deepEqual(page.commits.map((commit) => commit.hash), all.slice(0, 2), 'the newest page');
    const asked = await historyResult(await getHistory(app, '?limit=3'));
    assert.deepEqual(asked.commits.map((commit) => commit.hash), all.slice(0, 3), 'a request\'s own limit wins');

    // The client pages on from the page's last commit's parent.
    const last = page.commits.at(-1)!;
    if (last.parent.type !== 'some') assert.fail('the page ended at the root');
    const next = await historyResult(await getHistory(app, `?from=${last.parent.value}`));
    assert.deepEqual(next.commits.map((commit) => commit.hash), all.slice(2), 'the rest of the chain');
  });

  it('refuses a deadline or a history page no request could meet when the routes are mounted', () => {
    for (const syncDeadlineMs of [0, -1, NaN]) {
      assert.throws(() => createWorkspaceRecordRoutes(storage, () => REPO, () => runner, { syncDeadlineMs }),
        { name: 'RangeError', message: `syncDeadlineMs must be a positive number of milliseconds, got ${syncDeadlineMs}` });
    }
    for (const historyLimit of [0, 1.5, NaN]) {
      assert.throws(() => createWorkspaceRecordRoutes(storage, () => REPO, () => runner, { historyLimit }),
        { name: 'RangeError', message: `historyLimit must be a positive whole number of commits, got ${historyLimit}` });
    }
  });
});

describe('mutationResultOf', () => {
  it('answers every outcome as the mutation and compact routes answer it', () => {
    // A host answers a record operation no route serves — a rollback through
    // recordSystemCommit, say — with it, so a client reads the answer as it
    // reads a mutation's.
    const commitHash = 'a'.repeat(64);
    const stateHash = 'b'.repeat(64);
    const stale = 'update of "p-7", whose row no longer matches the patch';
    const cases: Array<[MutationOutcome, MutationResult]> = [
      [{ kind: 'committed', commitHash, stateHash }, { outcome: variant('committed', { commitHash, stateHash }) }],
      [{ kind: 'invalid', message: 'record \'nope\' not found' }, { outcome: variant('invalid', { message: 'record \'nope\' not found' }) }],
      [{ kind: 'failed', exitCode: 3, stderr: 'the tail' }, { outcome: variant('failed', { exitCode: 3n, stderr: 'the tail' }) }],
      [{ kind: 'timed_out', ms: 50, stderr: 'slow reducer' }, { outcome: variant('timed_out', { ms: 50n, stderr: 'slow reducer' }) }],
      [{ kind: 'conflict', attempts: 2 }, { outcome: variant('conflict', { attempts: 2n, detail: none }) }],
      [{ kind: 'conflict', attempts: 1, detail: stale }, { outcome: variant('conflict', { attempts: 1n, detail: some(stale) }) }],
    ];
    for (const [outcome, expected] of cases) {
      const result = mutationResultOf(outcome);
      assert.ok(mutationResultEqual(result, expected), `${outcome.kind}: ${printMutationResult(result)}`);
    }
  });
});
