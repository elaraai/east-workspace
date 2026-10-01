/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * One-shot for readers (#1031): the platform-free test that decides what a
 * reader may run, and the call under each grant, over the in-memory backend
 * and a mock runner.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DictType, East, FunctionType, IntegerType, NullType, StringType, encodeBeast2For, encodeEastIR, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import type { OneShotRequest, RunnerValue } from '@elaraai/e3-types';
import { PermissionDeniedError } from '../errors.js';
import { packageImport } from '../package-files.js';
import { workspaceDeploy } from '../workspaces.js';
import { workspaceGetDatasetHash } from '../trees.js';
import { InMemoryStorage } from '../storage/in-memory/InMemoryStorage.js';
import { createTempDir, removeTempDir } from '../test-helpers.js';
import { MockTaskRunner } from './MockTaskRunner.js';
import { oneShotExecute, oneShotPlatformUse, resolveExecuteLimits, type OneShotGrant } from './oneShot.js';

const REPO = 'r';
const WS = 'ws';

const twice = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
const log = East.platform('e3_test_log', [StringType], NullType);
/** A body that calls a platform function inside a nested function. */
const nestedPlatform = East.function([IntegerType], IntegerType, ($, x) => {
  const inner = $.const(East.function([IntegerType], IntegerType, ($, y) => {
    $(log(East.value('called')));
    return y;
  }));
  return inner(x);
});
/** A body that calls an import no linker resolved. */
const importing = East.function([IntegerType], IntegerType, ($, x) =>
  East.importFunction('pricing', 'score', FunctionType([IntegerType], IntegerType))(x));

const stock = (type: 'east_node' | 'east_py' | 'east_c', platforms: string[] = []): RunnerValue =>
  variant(type, { platforms, decode: variant('lazy', null) });

function request(body: { toIR(): unknown } | Uint8Array, args: OneShotRequest['args'] = [], runner: RunnerValue = stock('east_node'), limits: OneShotRequest['limits'] = none): OneShotRequest {
  const bodyIr = body instanceof Uint8Array ? body : encodeEastIR(body.toIR() as never);
  return { bodyIr, args, runner, limits };
}

const datasetArg = (name: string): OneShotRequest['args'][number] =>
  variant('dataset', [variant('field', 'inputs'), variant('field', name)]);

describe('oneShotPlatformUse', () => {
  it('finds nothing in a platform-free body on each stock runtime given no package', () => {
    for (const type of ['east_node', 'east_py', 'east_c'] as const) {
      assert.equal(oneShotPlatformUse(request(twice, [], stock(type))), null, type);
    }
  });

  it('names a platform call inside a nested function, an unresolved import, a custom runner and a runtime given a package', () => {
    assert.equal(oneShotPlatformUse(request(nestedPlatform)), 'its body calls the platform function e3_test_log');
    assert.equal(oneShotPlatformUse(request(importing)), 'its body holds an unresolved East.importFunction of pricing.score');
    assert.equal(oneShotPlatformUse(request(twice, [], variant('custom', { command: ['sh', '-c', 'true'] }))),
      'its runner is the custom runtime, which runs a command of its own');
    assert.equal(oneShotPlatformUse(request(twice, [], stock('east_py', ['east-py-std']))),
      'its runner, east-py, loads the platform package east-py-std');
  });

  it('throws for a body that does not decode', () => {
    assert.throws(() => oneShotPlatformUse(request(new Uint8Array([1, 2, 3]))));
  });
});

describe('resolveExecuteLimits', () => {
  const limits = (timeoutMs: bigint | null, maxResultBytes: bigint | null, maxLogBytes: bigint | null): OneShotRequest['limits'] => some({
    timeoutMs: timeoutMs === null ? none : some(timeoutMs),
    maxResultBytes: maxResultBytes === null ? none : some(maxResultBytes),
    maxLogBytes: maxLogBytes === null ? none : some(maxLogBytes),
  });

  it('defaults to a server\'s limits, and clamps a request to its ceilings and the sync deadline', () => {
    assert.deepEqual(resolveExecuteLimits(none), { timeoutMs: 60_000, maxResultBytes: 1024 * 1024, maxLogBytes: 64 * 1024 });
    assert.deepEqual(resolveExecuteLimits(limits(3_600_000n, 64n * 1024n * 1024n, 1024n * 1024n)),
      { timeoutMs: 120_000, maxResultBytes: 1024 * 1024, maxLogBytes: 256 * 1024 });
    assert.equal(resolveExecuteLimits(limits(90_000n, null, null), { syncDeadlineMs: 25_000 }).timeoutMs, 25_000);
    assert.equal(resolveExecuteLimits(limits(90_000n, null, null), { syncDeadlineMs: 600_000, ceilings: { timeoutMs: 30_000 } }).timeoutMs, 30_000);
  });

  it('lets a caller with raised ceilings run a request past a server\'s', () => {
    const raised = { syncDeadlineMs: 600_000, ceilings: { timeoutMs: 600_000, maxResultBytes: 64 * 1024 * 1024 } };
    assert.deepEqual(resolveExecuteLimits(none, raised), { timeoutMs: 60_000, maxResultBytes: 64 * 1024 * 1024, maxLogBytes: 64 * 1024 });
    assert.equal(resolveExecuteLimits(limits(300_000n, null, null), raised).timeoutMs, 300_000);
  });
});

describe('oneShotExecute', () => {
  let dir: string;
  let storage: InMemoryStorage;
  let runner: MockTaskRunner;

  beforeEach(async () => {
    dir = createTempDir();
    storage = new InMemoryStorage();
    runner = new MockTaskRunner();
    await storage.repos.create(REPO);
    const pkg = e3.package('oneshot', '1.0.0',
      e3.input('value', IntegerType, variant('value', 10n)),
      e3.input('prices', DictType(StringType, IntegerType), variant('value', new Map([['a', 1n], ['b', 2n]]))),
      e3.input('unset', IntegerType));
    const zip = join(dir, 'oneshot.zip');
    await e3.export(pkg, zip);
    await packageImport(storage, REPO, zip);
    await workspaceDeploy(storage, REPO, WS, 'oneshot', '1.0.0');
  });

  afterEach(() => removeTempDir(dir));

  const run = (req: OneShotRequest, grant: OneShotGrant, options: Partial<Parameters<typeof oneShotExecute>[5]> = {}) =>
    oneShotExecute(storage, runner, REPO, WS, req, { grant, ...options });

  it('refuses a caller with no grant, and a reader\'s request that is not platform-free, running nothing', async () => {
    const refused = [
      [request(twice), 'none'],
      [request(nestedPlatform), 'platform_free'],
      [request(importing), 'platform_free'],
      [request(twice, [], variant('custom', { command: ['sh'] })), 'platform_free'],
      [request(twice, [], stock('east_node', ['@elaraai/east-node-std'])), 'platform_free'],
    ] as const;
    for (const [req, grant] of refused) {
      await assert.rejects(run(req, grant), (err: unknown) => err instanceof PermissionDeniedError && err.path === 'one-shot');
    }
    assert.equal(runner.getDetachedCalls().length, 0, 'nothing ran');
  });

  it('answers invalid for a reader\'s body that does not decode, and hands an elevated caller\'s to the runner as it is', async () => {
    const junk = request(new Uint8Array([1, 2, 3]));
    const answered = await run(junk, 'platform_free');
    assert.equal(answered.outcome.type, 'invalid');
    assert.equal(runner.getDetachedCalls().length, 0);

    await run(junk, 'any');
    assert.deepEqual(runner.getDetachedCalls()[0]!.bodyIr, junk.bodyIr);
  });

  it('pins dataset arguments at their hashes, hands them to the runner in order, and names each in what the call read', async () => {
    runner.setDetachedResult({ kind: 'success', value: encodeBeast2For(IntegerType)(13n), stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false });
    const value = await workspaceGetDatasetHash(storage, REPO, WS, [variant('field', 'inputs'), variant('field', 'value')]);
    const prices = await workspaceGetDatasetHash(storage, REPO, WS, [variant('field', 'inputs'), variant('field', 'prices')]);
    const result = await run(request(twice, [datasetArg('prices'), variant('value', encodeBeast2For(IntegerType)(3n)), datasetArg('value')]), 'platform_free');

    assert.equal(result.outcome.type, 'success');
    const spec = runner.getDetachedCalls()[0]!;
    assert.deepEqual(spec.args, [{ dataset: prices.hash }, encodeBeast2For(IntegerType)(3n), { dataset: value.hash }]);
    assert.deepEqual(result.inputs, [
      { path: [variant('field', 'inputs'), variant('field', 'prices')], hash: prices.hash },
      { path: [variant('field', 'inputs'), variant('field', 'value')], hash: value.hash },
    ]);
  });

  it('answers invalid for an unassigned dataset argument, running nothing', async () => {
    const result = await run(request(twice, [datasetArg('unset')]), 'platform_free');
    assert.equal(result.outcome.type, 'invalid');
    assert.deepEqual(result.inputs, []);
    assert.equal(runner.getDetachedCalls().length, 0);
  });

  it('runs under the sync deadline and the ceilings, and a caller with raised ceilings gets a result past 1 MiB', async () => {
    const asked = some({ timeoutMs: some(300_000n), maxResultBytes: some(8n * 1024n * 1024n), maxLogBytes: none });
    await run(request(twice, [], stock('east_node'), asked), 'any', { syncDeadlineMs: 25_000 });
    assert.deepEqual(runner.getDetachedCalls()[0]!.limits, { timeoutMs: 25_000, maxResultBytes: 1024 * 1024, maxLogBytes: 64 * 1024 });

    const big = new Uint8Array(2 * 1024 * 1024);
    runner.setDetachedResult({ kind: 'success', value: big, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false });
    const result = await run(request(twice, [], stock('east_node'), asked), 'any', { syncDeadlineMs: 600_000, ceilings: { maxResultBytes: 64 * 1024 * 1024 } });
    assert.equal(runner.getDetachedCalls()[1]!.limits.maxResultBytes, 8 * 1024 * 1024);
    assert.equal(result.outcome.type === 'success' ? result.outcome.value.value.byteLength : 0, big.byteLength);
  });
});
