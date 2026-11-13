/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Calls of named functions through a workspace (#1554), over the in-memory
 * backend and a mock runner, on a clock each case sets: a call filed as it
 * starts, with its deadline, its lifetimes and what it pinned; refused as an
 * invalid call kept as a failure is; run, its value stored and its end
 * recorded with the lifetime that end gives it, the first end standing;
 * stopped by a request to cancel it, before it runs or as its run finds the
 * request in its record; and recorded lost once a read finds it running past
 * its deadline and a grace.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { East, IntegerType, OptionType, StringType, encodeBeast2For, encodeEastIR, equalFor, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import {
  ExecuteResultType, decodeFunctionObject, type FunctionCallJob, type FunctionCallRequest, type OneShotRequest, type RunnerValue,
} from '@elaraai/e3-types';
import { packageImport } from '../package-files.js';
import { workspaceDeploy } from '../workspaces.js';
import { workspaceGetDatasetHash } from '../trees.js';
import { InMemoryStorage } from '../storage/in-memory/InMemoryStorage.js';
import { createTempDir, removeTempDir } from '../test-helpers.js';
import { InvalidNameError, PermissionDeniedError } from '../errors.js';
import { isUuidv7, uuidv7Generator } from '../uuid.js';
import { MockTaskRunner } from './MockTaskRunner.js';
import type { DetachedResult, DetachedRunOptions, DetachedSpec } from './interfaces.js';
import {
  FUNCTION_CALL_GRACE_MS,
  functionCallLost,
  functionCallRead,
  functionCallRun,
  functionCallStart,
  functionCallStatus,
  oneShotCallStart,
  type FunctionCallLifetimes,
  type OneShotCallStartOptions,
} from './functionCall.js';

const REPO = 'r';
const WS = 'ws';
const VALUE = [variant('field', 'inputs'), variant('field', 'value')];

/** The clock each case runs on, stopped at the time the case starts: the
 *  store measures a call's expiry by the real clock, which every lifetime
 *  here outlasts. */
let T = 0;
const now = (): number => T;

/** An hour for a success or a cancel, a day for any other end. */
const SUCCEEDED_MS = 60 * 60_000;
const FAILED_MS = 24 * 60 * 60_000;
const LIFETIMES: FunctionCallLifetimes = { succeededMs: SUCCEEDED_MS, failedMs: FAILED_MS };

const encodeInt = encodeBeast2For(IntegerType);
const sameCaller = equalFor(OptionType(StringType));

/** A call of value arguments, each one's bytes. */
function request(args: Uint8Array[]): FunctionCallRequest {
  return { args: args.map((arg) => variant('value', arg)), runner: none, limits: none, drafts: [] };
}

/** A runner's end, its value and its log tails. */
function ran(result: Partial<DetachedResult> & Pick<DetachedResult, 'kind'>): DetachedResult {
  return { stdout: 'out\n', stderr: 'err\n', stdoutTruncated: false, stderrTruncated: false, ...result } as DetachedResult;
}

/** A runner whose run lasts until its signal aborts: a call its cancel stops. */
class HeldRunner extends MockTaskRunner {
  override runDetached(spec: DetachedSpec, options?: DetachedRunOptions): Promise<DetachedResult> {
    void super.runDetached(spec, options);
    return new Promise((resolve) => {
      options?.signal?.addEventListener('abort', () => resolve(ran({ kind: 'failed', exitCode: 137 })), { once: true });
    });
  }
}

describe('functionCall', () => {
  let dir: string;
  let storage: InMemoryStorage;
  let runner: MockTaskRunner;

  beforeEach(async () => {
    T = Date.now();
    dir = createTempDir();
    storage = new InMemoryStorage();
    runner = new MockTaskRunner();
    await storage.repos.create(REPO);
    const value = e3.input('value', IntegerType, variant('value', 10n));
    const scaled = e3.function('scaled', { inputs: [value], args: [IntegerType], output: IntegerType }, ($, value, by) => value.multiply(by));
    const twice = e3.function('twice', East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n)));
    const zip = join(dir, 'calls.zip');
    await e3.export(e3.package('calls', '1.0.0', value, scaled, twice), zip);
    await packageImport(storage, REPO, zip);
    await workspaceDeploy(storage, REPO, WS, 'calls', '1.0.0');
  });

  afterEach(() => removeTempDir(dir));

  const start = (fn: string, args: Uint8Array[], options: Partial<Parameters<typeof functionCallStart>[5]> = {}): Promise<FunctionCallJob> =>
    functionCallStart(storage, REPO, WS, fn, request(args), { caller: 'ada@example.com', lifetimes: LIFETIMES, now, ...options });

  it('files a call running, with its deadline, its lifetimes, its caller, and the inputs and arguments it pinned', async () => {
    const job = await start('scaled', [encodeInt(3n)]);
    const { call } = job;
    assert.equal(call.state.type, 'running');
    assert.equal(call.endedAt.type, 'none');
    assert.ok(sameCaller(call.caller, some('ada@example.com')));
    // A job's timeout is the ceiling's, 10 minutes, unless it asks for less
    assert.equal(call.limits.timeoutMs, 600_000n);
    assert.equal(job.deadline.getTime(), T + 600_000);
    assert.equal(call.expiresAt.getTime(), T + 600_000 + FUNCTION_CALL_GRACE_MS + FAILED_MS, 'kept past its deadline and a grace as long as a failure');
    assert.equal(job.keep.succeeded, BigInt(SUCCEEDED_MS));
    assert.equal(job.keep.failed, BigInt(FAILED_MS));

    const pinned = await workspaceGetDatasetHash(storage, REPO, WS, VALUE);
    assert.deepEqual(call.inputs.map((input) => input.hash), [pinned.hash]);
    const [by] = call.args;
    if (by?.type !== 'value') assert.fail('its argument is a value');
    assert.deepEqual(await storage.objects.read(REPO, by.value), encodeInt(3n), 'stored as the object it names');

    const kept = await storage.calls.get(REPO, WS, call.id);
    assert.ok(kept !== null && equalFor(ExecuteResultType.fields.inputs)(kept.call.inputs, call.inputs), 'and filed in the store');
  });

  it('files a call under the id its caller chose, sets aside one far from now for its own, and refuses one not a UUIDv7 or already kept', async () => {
    const chosen = uuidv7Generator(() => T)();
    assert.equal((await start('twice', [encodeInt(1n)], { id: chosen })).call.id, chosen);
    const stale = uuidv7Generator(() => T - 60 * 60_000)();
    const replaced = await start('twice', [encodeInt(1n)], { id: stale });
    assert.notEqual(replaced.call.id, stale, 'an hour off the server\'s clock: the server names it');
    assert.ok(isUuidv7(replaced.call.id));
    await assert.rejects(start('twice', [encodeInt(1n)], { id: 'not-an-id' }), (err: unknown) => err instanceof InvalidNameError);
    await assert.rejects(start('twice', [encodeInt(1n)], { id: chosen }), /keeps a call/, 'a second call of one id is refused');
  });

  it('gives a sync call the sync deadline\'s timeout, and a job the ceiling\'s', async () => {
    assert.equal((await start('twice', [encodeInt(1n)], { sync: { deadlineMs: 25_000 } })).call.limits.timeoutMs, 25_000n);
    assert.equal((await start('twice', [encodeInt(1n)], { sync: {} })).call.limits.timeoutMs, 60_000n, 'a sync call\'s default');
    assert.equal((await start('twice', [encodeInt(1n)], { ceilings: { timeoutMs: 90_000 } })).call.limits.timeoutMs, 90_000n);
  });

  it('files a call found wrong ended invalid, kept as a failure is, naming nothing it would have read', async () => {
    const job = await start('scaled', []);
    assert.equal(job.call.state.type, 'invalid');
    assert.equal(job.call.endedAt.type, 'some');
    assert.equal(job.call.expiresAt.getTime(), T + FAILED_MS);
    assert.equal(job.call.args.length + job.call.inputs.length, 0);
    const status = await functionCallStatus(storage, REPO, job);
    assert.ok(status.type === 'completed' && status.value.outcome.type === 'invalid');
  });

  it('refuses a draft passed to a function that lists no record a call may draft: filed invalid, and nothing runs', async () => {
    // What a call's drafts do where its function takes them: functionDrafts.spec.ts
    const drafted: FunctionCallRequest = { ...request([encodeInt(3n)]), drafts: [{ record: 'jobs', mutation: 'patch', args: [] }] };
    const job = await functionCallStart(storage, REPO, WS, 'scaled', drafted, { caller: 'ada@example.com', lifetimes: LIFETIMES, now });
    if (job.call.state.type !== 'invalid') assert.fail(`filed ${job.call.state.type}`);
    assert.equal(job.call.state.value.diagnostics[0]!.message, 'draft jobs.patch (1 of 1): the function lists no record a call may draft');
    assert.equal(job.call.inputs.length + job.call.drafts.length, 0, 'it read nothing, and keeps no draft');
    assert.equal((await functionCallRun(storage, runner, REPO, WS, job.call.id, { now })).result, null);
    assert.equal(runner.getDetachedCalls().length, 0);
  });

  it('names in a result each record its call drafted once, in the order its drafts first name them, and none for a call refused', async () => {
    const filed = await start('twice', [encodeInt(1n)]);
    const hash = (digit: string): string => digit.repeat(64);
    const drafts: FunctionCallJob['call']['drafts'] = [
      { record: 'presses', mutation: 'patch', args: some(hash('1')), commit: hash('a') },
      { record: 'jobs', mutation: 'clear', args: none, commit: hash('b') },
      { record: 'presses', mutation: 'patch', args: some(hash('2')), commit: hash('a') },
    ];
    const ended = (state: FunctionCallJob['call']['state']): FunctionCallJob => ({ ...filed, call: { ...filed.call, drafts, state } });
    const sameDrafts = equalFor(ExecuteResultType.fields.drafts);

    const conflict = await functionCallStatus(storage, REPO, ended(variant('conflict', { record: 'presses', mutation: 'patch', message: 'the row changed under the edit' })));
    if (conflict.type !== 'completed' || conflict.value.outcome.type !== 'conflict') assert.fail(`the status is ${conflict.type}`);
    assert.equal(conflict.value.outcome.value.message, 'the row changed under the edit');
    assert.ok(sameDrafts(conflict.value.drafts, [{ record: 'presses', commit: hash('a') }, { record: 'jobs', commit: hash('b') }]));

    const failed = await functionCallStatus(storage, REPO, ended(variant('failed', { exitCode: 1n })));
    assert.ok(failed.type === 'completed' && sameDrafts(failed.value.drafts, conflict.value.drafts), 'whatever its end');
    const refused = await functionCallStatus(storage, REPO, ended(variant('invalid', { diagnostics: [] })));
    assert.ok(refused.type === 'completed' && refused.value.drafts.length === 0, 'a call refused laid none');
  });

  it('runs a call on its inputs and arguments as stored objects, stores its value, and keeps it as long as a success', async () => {
    runner.setDetachedResult(ran({ kind: 'success', value: encodeInt(30n) }));
    const filed = await start('scaled', [encodeInt(3n)]);
    const { job, result } = await functionCallRun(storage, runner, REPO, WS, filed.call.id, { now });

    const [spec] = runner.getDetachedCalls();
    const [by] = filed.call.args;
    if (by?.type !== 'value') assert.fail('its argument is a value');
    assert.deepEqual(spec!.args, [{ dataset: filed.call.inputs[0]!.hash }, { dataset: by.value }], 'its input, then its argument, each the object it is');
    if (job?.call.state.type !== 'succeeded') assert.fail(`the call ended ${job?.call.state.type}`);
    assert.deepEqual(await storage.objects.read(REPO, job.call.state.value.value), encodeInt(30n), 'its value, stored');
    assert.equal(job.call.expiresAt.getTime(), T + SUCCEEDED_MS);
    assert.equal(job.call.stdout, 'out\n');
    assert.equal(job.call.stderr, 'err\n');
    assert.ok(result?.outcome.type === 'success', 'the run answers its result as it had it');

    // Read back, the status answers the stored value inline
    const status = await functionCallStatus(storage, REPO, job);
    assert.ok(status.type === 'completed' && result !== null && equalFor(ExecuteResultType)(status.value, result));

    // Run again, the call is left as it ended
    const again = await functionCallRun(storage, runner, REPO, WS, filed.call.id, { now });
    assert.equal(again.job?.call.state.type, 'succeeded');
    assert.equal(again.result, null);
    assert.equal(runner.getDetachedCalls().length, 1, 'and nothing runs');
  });

  it('keeps a call that failed as long as a failure', async () => {
    runner.setDetachedResult(ran({ kind: 'failed', exitCode: 1 }));
    const filed = await start('twice', [encodeInt(1n)]);
    const { job } = await functionCallRun(storage, runner, REPO, WS, filed.call.id, { now });
    assert.equal(job?.call.state.type, 'failed');
    assert.equal(job?.call.expiresAt.getTime(), T + FAILED_MS);
  });

  it('ends a call asked to stop before it runs cancelled, naming who asked, and runs nothing', async () => {
    const filed = await start('twice', [encodeInt(1n)]);
    await storage.calls.requestCancel(REPO, WS, filed.call.id, { by: some('grace@example.com'), at: new Date(T) });
    const { job } = await functionCallRun(storage, runner, REPO, WS, filed.call.id, { now });
    if (job?.call.state.type !== 'cancelled') assert.fail(`the call ended ${job?.call.state.type}`);
    assert.ok(sameCaller(job.call.state.value.by, some('grace@example.com')));
    assert.equal(job.call.expiresAt.getTime(), T + SUCCEEDED_MS, 'kept as long as a success');
    assert.equal(runner.getDetachedCalls().length, 0);
  });

  it('stops a running call\'s runner once its run finds a request to cancel it in its record', async () => {
    const held = new HeldRunner();
    const filed = await start('twice', [encodeInt(1n)]);
    const running = functionCallRun(storage, held, REPO, WS, filed.call.id, { now, watchMs: 10 });
    await storage.calls.requestCancel(REPO, WS, filed.call.id, { by: none, at: new Date(T) });
    const { job } = await running;
    assert.equal(job?.call.state.type, 'cancelled');
    assert.equal(held.getDetachedCalls().length, 1, 'it ran, and was stopped');
  });

  it('stops a running call at once when its host tells the run it was asked to stop', async () => {
    const held = new HeldRunner();
    const filed = await start('twice', [encodeInt(1n)]);
    const cancel = new AbortController();
    // A watch that would not look again before the test ends
    const running = functionCallRun(storage, held, REPO, WS, filed.call.id, { now, watchMs: 60_000, cancel: cancel.signal });
    await storage.calls.requestCancel(REPO, WS, filed.call.id, { by: some('grace@example.com'), at: new Date(T) });
    cancel.abort();
    const { job } = await running;
    assert.equal(job?.call.state.type, 'cancelled');
  });

  it('records a call lost once a read finds it running past its deadline and a grace, on the clock its store keeps, and leaves one within the grace', async () => {
    // Filed its timeout, a grace and a moment ago, by the clock the store
    // measures expiry by too: its host stopped, and nothing recorded its end
    T = Date.now() - 600_000 - FUNCTION_CALL_GRACE_MS - 1;
    const filed = await start('twice', [encodeInt(1n)]);
    const graceEnds = filed.deadline.getTime() + FUNCTION_CALL_GRACE_MS;
    assert.equal((await functionCallRead(storage, REPO, WS, filed.call.id, graceEnds))?.call.state.type, 'running', 'within the grace');
    const before = Date.now();
    const lost = await functionCallRead(storage, REPO, WS, filed.call.id);
    if (lost?.call.state.type !== 'lost') assert.fail(`read ${lost?.call.state.type ?? 'no call: the store had forgotten it'}`);
    const kept = lost.call.expiresAt.getTime();
    assert.ok(kept >= before + FAILED_MS && kept <= Date.now() + FAILED_MS, 'kept as long as a failure, from when it was found lost');
    assert.equal((await storage.calls.get(REPO, WS, filed.call.id))?.call.state.type, 'lost', 'and recorded so');
  });

  it('records a call no compute will run lost, and leaves a call that has ended as it is', async () => {
    const filed = await start('twice', [encodeInt(1n)]);
    const lost = await functionCallLost(storage, REPO, filed, 'the dispatch refused it', T);
    if (lost.call.state.type !== 'lost') assert.fail(`the call is ${lost.call.state.type}`);
    assert.equal(lost.call.state.value.message, 'the dispatch refused it');
    const status = await functionCallStatus(storage, REPO, lost);
    assert.equal(status.type, 'lost');

    runner.setDetachedResult(ran({ kind: 'success', value: encodeInt(2n) }));
    const done = await start('twice', [encodeInt(1n)]);
    const { job } = await functionCallRun(storage, runner, REPO, WS, done.call.id, { now });
    const left = await functionCallLost(storage, REPO, job!, 'too late', T);
    assert.equal(left.call.state.type, 'succeeded');
  });

  describe('a one-shot started as a call', () => {
    /** A program of two integers, their sum: what a query builder's run sends, in small. */
    const sum = encodeEastIR(East.function([IntegerType, IntegerType], IntegerType, ($, x, y) => x.add(y)).toIR() as never);
    const stock = (platforms: string[] = []): RunnerValue => variant('east_node', { platforms, decode: variant('lazy', null) });
    const oneShot = (bodyIr: Uint8Array, args: OneShotRequest['args'], runner: RunnerValue = stock()): OneShotRequest =>
      ({ bodyIr, args, runner, limits: none });
    const startOneShot = (req: OneShotRequest, options: Partial<OneShotCallStartOptions> = {}): Promise<FunctionCallJob> =>
      oneShotCallStart(storage, REPO, WS, req, { caller: 'ada@example.com', grant: 'platform_free', lifetimes: LIFETIMES, now, ...options });

    it('files it running, naming no function and no package, its program stored as the anonymous function it runs, and its arguments pinned', async () => {
      const job = await startOneShot(oneShot(sum, [variant('dataset', VALUE), variant('value', encodeInt(5n))]));
      const { call } = job;
      assert.equal(call.state.type, 'running');
      assert.equal(call.function.type, 'none');
      assert.equal(call.package.type, 'none');
      assert.equal(call.inputs.length, 0, 'it reads only what its caller passed');
      assert.equal(call.limits.timeoutMs, 600_000n, 'its timeout the ceiling\'s, as a started call\'s');
      assert.equal(call.expiresAt.getTime(), T + 600_000 + FUNCTION_CALL_GRACE_MS + FAILED_MS);

      const pinned = await workspaceGetDatasetHash(storage, REPO, WS, VALUE);
      const [dataset, value] = call.args;
      assert.ok(dataset?.type === 'dataset' && dataset.value.hash === pinned.hash, 'its dataset argument, at the hash it holds now');
      if (value?.type !== 'value') assert.fail('its second argument is a value');
      assert.deepEqual(await storage.objects.read(REPO, value.value), encodeInt(5n));

      const fnObj = decodeFunctionObject(await storage.objects.read(REPO, job.functionObject));
      assert.deepEqual(await storage.objects.read(REPO, fnObj.bodyIr), sum, 'its program, as sent');
      assert.equal(fnObj.inputs.length, 0);
      assert.equal(fnObj.argTypes.length, 2);
      assert.equal(fnObj.outputType.type, 'Integer');
      assert.equal(job.runner.type, 'east_node', 'it runs on its own runner');
      assert.ok((await storage.calls.get(REPO, WS, call.id)) !== null, 'and is kept in the store');
    });

    it('runs as a named function\'s call runs: its program, on its arguments as stored objects, its value kept', async () => {
      runner.setDetachedResult(ran({ kind: 'success', value: encodeInt(15n) }));
      const filed = await startOneShot(oneShot(sum, [variant('dataset', VALUE), variant('value', encodeInt(5n))]));
      const { job, result } = await functionCallRun(storage, runner, REPO, WS, filed.call.id, { now });
      const [spec] = runner.getDetachedCalls();
      assert.deepEqual(spec!.bodyIr, sum);
      const [dataset, value] = filed.call.args;
      assert.ok(dataset?.type === 'dataset' && value?.type === 'value');
      assert.deepEqual(spec!.args, [{ dataset: dataset.value.hash }, { dataset: value.value }]);
      if (job?.call.state.type !== 'succeeded') assert.fail(`the call ended ${job?.call.state.type}`);
      assert.deepEqual(await storage.objects.read(REPO, job.call.state.value.value), encodeInt(15n));
      assert.ok(result?.outcome.type === 'success');
      assert.equal(result.inputs.length, 1, 'its result names the dataset it read');
    });

    it('holds it to its caller\'s grant before anything is filed, as a one-shot run within a request is held', async () => {
      const withPackage = oneShot(sum, [variant('value', encodeInt(1n)), variant('value', encodeInt(2n))], stock(['@elaraai/east-node-std']));
      await assert.rejects(startOneShot(oneShot(sum, []), { grant: 'none' }), (err: unknown) => err instanceof PermissionDeniedError);
      await assert.rejects(startOneShot(withPackage), (err: unknown) => err instanceof PermissionDeniedError, 'a platform package under a platform-free grant');
      assert.equal((await storage.calls.list(REPO, WS, { limit: 10 })).calls.length, 0, 'nothing filed');
      assert.equal((await startOneShot(withPackage, { grant: 'any' })).call.state.type, 'running', 'the elevated grant starts it');
    });

    it('files one found wrong ended invalid: a program that is no function, or a wrong arity', async () => {
      const garbled = new Uint8Array([1, 2, 3]);
      const notAFunction = await startOneShot(oneShot(garbled, []));
      if (notAFunction.call.state.type !== 'invalid') assert.fail(`filed ${notAFunction.call.state.type}`);
      assert.match(notAFunction.call.state.value.diagnostics[0]!.message, /does not decode as a function/);
      assert.deepEqual(await storage.objects.read(REPO, notAFunction.functionObject), garbled, 'naming the program as sent');

      const arity = await startOneShot(oneShot(sum, [variant('value', encodeInt(1n))]));
      if (arity.call.state.type !== 'invalid') assert.fail(`filed ${arity.call.state.type}`);
      assert.equal(arity.call.state.value.diagnostics[0]!.message, 'Expected 2 argument(s), got 1');
      assert.equal(arity.call.expiresAt.getTime(), T + FAILED_MS, 'kept as a failure is');
      const status = await functionCallStatus(storage, REPO, arity);
      assert.ok(status.type === 'completed' && status.value.outcome.type === 'invalid');
    });
  });
});
