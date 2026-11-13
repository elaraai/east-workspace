/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A server's call limits (#1103). A server made with them runs its calls
 * under them, on the real east-node runner: a result is answered inline up to
 * its result limit and `too_large` past it, a function's through its package
 * as through a workspace, a split call's job ends `timed_out` at its job
 * limit, and a one-shot or function call `timed_out` at its deadline. A limit
 * that becomes a timer is at most what a timer waits. The CLI's flags resolve
 * to them, and a malformed one is refused, naming the flag.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  ArrayType, BlobType, East, FunctionType, IntegerType, NullType, decodeBeast2For, encodeBeast2For, encodeEastIR, equalFor, none,
  some, toEastTypeValue, variant, type EastType, type ValueTypeOf,
} from '@elaraai/east';
import { LocalStorage, datasetWrite, workspaceCreate, workspaceDeploy } from '@elaraai/e3-core';
import { createTestRepo, removeTestRepo } from '@elaraai/e3-core/test';
import { BEAST2_CONTENT_TYPE, FunctionObjectType, PackageObjectType, type RunnerValue, type TreePath } from '@elaraai/e3-types';
import { checkCallLimits, resolveCallLimits, type CallLimits } from './call-limits.js';
import { createServer } from './server.js';
import {
  ExecuteResultType, FunctionCallRequestType, OneShotRequestType, PackageJobResponseType, ResponseType, SplitCallRequestType,
  SplitCallStatusType,
} from './types.js';

const MiB = 1024 * 1024;

const NumbersType = ArrayType(IntegerType);
const NUMBERS: TreePath = [variant('field', 'inputs'), variant('field', 'numbers')];
const EAST_NODE: RunnerValue = variant('east_node', { platforms: [], decode: variant('lazy', null) });

/** Answers the bytes it is given. */
const echo = East.function([BlobType], BlobType, ($, bytes) => bytes);

/** Bytes that encode to as many: beast2 compresses what repeats. */
function noise(bytes: number): Uint8Array {
  return new Uint8Array(randomBytes(bytes));
}

/** Counts for ever: only a limit ends it. */
const spin = East.function([], IntegerType, ($) => {
  const count = $.let(0n);
  $.while(true, ($) => {
    $.assign(count, count.add(1n));
  });
  return count;
});

/** A split call's program that counts for ever over its piece. */
const spinEach = East.function([NumbersType, FunctionType([IntegerType], NullType)], NullType, ($, _numbers, _emit) => {
  const count = $.let(0n);
  $.while(true, ($) => {
    $.assign(count, count.add(1n));
  });
});

/**
 * Deploys to workspace `main` of the repository at `repo` a package of one
 * input, `numbers` ([1, 2, 3]), and two functions, `spin` and `echo`.
 */
async function deploy(repo: string): Promise<void> {
  const storage = new LocalStorage();
  const numbers = await datasetWrite(storage, repo, [1n, 2n, 3n], NumbersType);
  const spinning = await storage.objects.write(repo, encodeBeast2For(FunctionObjectType)({
    bodyIr: await storage.objects.write(repo, encodeEastIR(spin.toIR())),
    inputs: [],
    drafts: [],
    argTypes: [],
    outputType: toEastTypeValue(IntegerType),
    runner: EAST_NODE,
    environment: none,
  }));
  const echoing = await storage.objects.write(repo, encodeBeast2For(FunctionObjectType)({
    bodyIr: await storage.objects.write(repo, encodeEastIR(echo.toIR())),
    inputs: [],
    drafts: [],
    argTypes: [toEastTypeValue(BlobType)],
    outputType: toEastTypeValue(BlobType),
    runner: EAST_NODE,
    environment: none,
  }));
  const pkg = await storage.objects.write(repo, encodeBeast2For(PackageObjectType)({
    tasks: new Map(),
    data: {
      structure: variant('struct', new Map([
        ['inputs', variant('struct', new Map([['numbers', variant('value', { type: toEastTypeValue(NumbersType), writable: true })]]))],
      ])),
      refs: new Map([['inputs/numbers', variant('value', { hash: numbers, versions: new Map() })]]),
    },
    functions: new Map([['echo', echoing], ['spin', spinning]]),
    records: new Map(),
    sources: new Map(),
  }));
  await storage.refs.packageWrite(repo, 'limits', '1.0.0', pkg);
  await workspaceCreate(storage, repo, 'main');
  await workspaceDeploy(storage, repo, 'main', 'limits', '1.0.0');
}

/** A server of a repository with the package deployed, under `calls`. */
interface Serving {
  /** Sends a request to the server, at a path under `/api/repos/default`. */
  send(path: string, body?: Uint8Array): Promise<Uint8Array>;
  stop(): Promise<void>;
}

async function serving(calls: CallLimits): Promise<Serving> {
  const repo = createTestRepo();
  await deploy(repo);
  const server = await createServer({ singleRepoPath: repo, port: 0, host: '127.0.0.1', calls });
  await server.start();
  return {
    async send(path, body) {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/repos/default${path}`, body === undefined ? {} : {
        method: 'POST',
        headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
        body,
      });
      return new Uint8Array(await response.arrayBuffer());
    },
    async stop() {
      await server.stop();
      removeTestRepo(repo);
    },
  };
}

/** The success an answer of `type` holds, failing the test on an error. */
function success<T extends EastType>(type: T, bytes: Uint8Array): ValueTypeOf<T> {
  const answer = decodeBeast2For(ResponseType(type))(bytes);
  if (answer.type !== 'success') assert.fail(`the request was refused: ${answer.value.type}`);
  return answer.value as ValueTypeOf<T>;
}

/** A one-shot call of `body` on east-node over the values given. */
function oneShot(body: { toIR(): unknown }, args: Uint8Array[]): Uint8Array {
  return encodeBeast2For(OneShotRequestType)({
    bodyIr: encodeEastIR(body.toIR() as never),
    args: args.map((arg) => variant('value', arg)),
    runner: EAST_NODE,
    limits: none,
  });
}

describe('a server\'s call limits (#1103)', () => {
  describe('a result limit of 2 MiB', () => {
    let server: Serving;
    before(async () => {
      server = await serving({ ceilings: { maxResultBytes: 2 * MiB } });
    });
    after(async () => {
      await server.stop();
    });

    it('answers a result of 1.5 MiB inline, over the default limit of 1 MiB', async () => {
      const bytes = noise(1.5 * MiB);
      const result = success(ExecuteResultType, await server.send('/workspaces/main/one-shot', oneShot(echo, [encodeBeast2For(BlobType)(bytes)])));
      if (result.outcome.type !== 'success') assert.fail(`expected success, got ${result.outcome.type}: ${result.stderr}`);
      assert.ok(equalFor(BlobType)(decodeBeast2For(BlobType)(result.outcome.value.value), bytes), 'the result is the bytes given');
    });

    it('answers a result of 3 MiB too_large, naming the limit', async () => {
      const result = success(ExecuteResultType, await server.send('/workspaces/main/one-shot', oneShot(echo, [encodeBeast2For(BlobType)(noise(3 * MiB))])));
      if (result.outcome.type !== 'too_large') assert.fail(`expected too_large, got ${result.outcome.type}: ${result.stderr}`);
      assert.equal(result.outcome.value.limit, BigInt(2 * MiB));
      assert.ok(Number(result.outcome.value.bytes) > 3 * MiB, `the result is ${result.outcome.value.bytes} bytes`);
    });

    it('answers a function call of 1.5 MiB inline too, through the package as through the workspace', async () => {
      const bytes = noise(1.5 * MiB);
      const call = encodeBeast2For(FunctionCallRequestType)({ args: [variant('value', encodeBeast2For(BlobType)(bytes))], runner: none, limits: none });
      for (const path of ['/workspaces/main/functions/echo', '/packages/limits/1.0.0/functions/echo']) {
        const result = success(ExecuteResultType, await server.send(path, call));
        if (result.outcome.type !== 'success') assert.fail(`${path}: expected success, got ${result.outcome.type}: ${result.stderr}`);
        assert.ok(equalFor(BlobType)(decodeBeast2For(BlobType)(result.outcome.value.value), bytes), `${path}: the result is the bytes given`);
      }
    });
  });

  describe('a job limit of 2 s and a deadline of 1 s', () => {
    let server: Serving;
    before(async () => {
      server = await serving({ syncDeadlineMs: 1_000, ceilings: { timeoutMs: 2_000 } });
    });
    after(async () => {
      await server.stop();
    });

    it('ends a slower split call timed_out at the job limit', { timeout: 60_000 }, async () => {
      const { id } = success(PackageJobResponseType, await server.send('/workspaces/main/one-shot/split', encodeBeast2For(SplitCallRequestType)({
        bodyIr: encodeEastIR(spinEach.toIR() as never),
        args: [{ arg: variant('dataset', NUMBERS), partition: some({ by: [] }) }],
        output: variant('array', null),
        then: none,
        runner: EAST_NODE,
        limits: none,
      })));
      let status = success(SplitCallStatusType, await server.send(`/workspaces/main/one-shot/split/${id}`));
      while (status.type === 'processing') {
        await new Promise((resolve) => setTimeout(resolve, 100));
        status = success(SplitCallStatusType, await server.send(`/workspaces/main/one-shot/split/${id}`));
      }
      if (status.type !== 'completed') assert.fail(`expected the call completed, got ${status.type}`);
      const { outcome } = status.value.result;
      if (outcome.type !== 'timed_out') assert.fail(`expected timed_out, got ${outcome.type}: ${status.value.result.stderr}`);
      assert.equal(outcome.value.ms, 2_000n);
    });

    it('ends a slower one-shot call timed_out at the deadline', { timeout: 60_000 }, async () => {
      const result = success(ExecuteResultType, await server.send('/workspaces/main/one-shot', oneShot(spin, [])));
      if (result.outcome.type !== 'timed_out') assert.fail(`expected timed_out, got ${result.outcome.type}: ${result.stderr}`);
      assert.equal(result.outcome.value.ms, 1_000n);
    });

    it('ends a slower function call timed_out at the deadline, through the workspace and through the package', { timeout: 60_000 }, async () => {
      const call = encodeBeast2For(FunctionCallRequestType)({ args: [], runner: none, limits: none });
      for (const path of ['/workspaces/main/functions/spin', '/packages/limits/1.0.0/functions/spin']) {
        const result = success(ExecuteResultType, await server.send(path, call));
        if (result.outcome.type !== 'timed_out') assert.fail(`${path}: expected timed_out, got ${result.outcome.type}: ${result.stderr}`);
        assert.equal(result.outcome.value.ms, 1_000n, path);
      }
    });
  });

  it('refuses a limit that is not positive, naming it', async () => {
    await assert.rejects(
      createServer({ singleRepoPath: '/nonexistent', calls: { syncDeadlineMs: 0 } }),
      { name: 'RangeError', message: 'calls.syncDeadlineMs must be a positive number of milliseconds, got 0' },
    );
    await assert.rejects(
      createServer({ singleRepoPath: '/nonexistent', calls: { ceilings: { maxResultBytes: 1.5 } } }),
      { name: 'RangeError', message: 'calls.ceilings.maxResultBytes must be a positive whole number of bytes, got 1.5' },
    );
  });

  it('refuses a deadline, a timeout, a window or a wait longer than a timer waits, naming it, and takes a lifetime as long', async () => {
    const days30 = 30 * 24 * 60 * 60_000;
    const refused: [CallLimits, string][] = [
      [{ syncDeadlineMs: days30 }, 'syncDeadlineMs'],
      [{ ceilings: { timeoutMs: days30 } }, 'ceilings.timeoutMs'],
      [{ windowMs: days30 }, 'windowMs'],
      [{ pollWaitMs: days30 }, 'pollWaitMs'],
    ];
    for (const [calls, name] of refused) {
      await assert.rejects(createServer({ singleRepoPath: '/nonexistent', calls }), {
        name: 'RangeError',
        message: `calls.${name} must be at most 2147483647 ms (about 24.8 days), the longest a timer waits, got ${days30}`,
      });
    }
    const longest = 2 ** 31 - 1;
    const kept: CallLimits = { syncDeadlineMs: longest, ceilings: { timeoutMs: longest }, windowMs: longest, pollWaitMs: longest };
    assert.deepEqual(checkCallLimits(kept), kept, 'the longest a timer waits is taken');
    const lifetimes = { succeededMs: days30, failedMs: days30 };
    assert.deepEqual(checkCallLimits({ lifetimes }), { lifetimes }, 'a lifetime is no timer');
  });
});

describe('the CLI\'s call limit flags (#1103)', () => {
  it('resolves each flag, and leaves a limit no flag gives to the server\'s default', () => {
    assert.deepEqual(resolveCallLimits({ callDeadline: '90s', jobTimeout: '2h', maxResult: '8M', maxLog: '1M' }), {
      syncDeadlineMs: 90_000,
      ceilings: { timeoutMs: 7_200_000, maxResultBytes: 8 * MiB, maxLogBytes: MiB },
    });
    assert.deepEqual(resolveCallLimits({ jobTimeout: '30m' }), { ceilings: { timeoutMs: 1_800_000 } });
    assert.deepEqual(resolveCallLimits({ jobTimeout: '24d' }), { ceilings: { timeoutMs: 24 * 24 * 3_600_000 } }, 'days are taken, up to what a timer waits');
    assert.deepEqual(resolveCallLimits({}), {});
  });

  it('refuses a malformed value, naming its flag', () => {
    const refusals: [Parameters<typeof resolveCallLimits>[0], string][] = [
      [{ callDeadline: 'soon' }, "--call-deadline must be a duration, as 90s, 15m or 2h, got 'soon'"],
      [{ callDeadline: '0s' }, "--call-deadline must be a duration, as 90s, 15m or 2h, got '0s'"],
      [{ jobTimeout: '90' }, "--job-timeout must be a duration, as 90s, 15m or 2h, got '90'"],
      // A timer waits at most 2^31 - 1 ms, and fires at once past it
      [{ jobTimeout: '30d' }, "--job-timeout must be at most about 24.8 days (2147483647 ms), the longest a timer waits, got '30d'"],
      [{ callDeadline: '597h' }, "--call-deadline must be at most about 24.8 days (2147483647 ms), the longest a timer waits, got '597h'"],
      [{ maxResult: 'big' }, "--max-result must be a size in bytes, or with a K, M, G or T suffix (binary units, as 8M), got 'big'"],
      [{ maxLog: '0' }, "--max-log must be a size in bytes, or with a K, M, G or T suffix (binary units, as 8M), got '0'"],
    ];
    for (const [settings, message] of refusals) {
      assert.throws(() => resolveCallLimits(settings), { name: 'RangeError', message });
    }
  });

  it('e3-api-server refuses a malformed flag before it serves anything, naming it', () => {
    const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
    for (const [flag, value] of [['--call-deadline', 'soon'], ['--job-timeout', '2x'], ['--max-result', 'big'], ['--max-log', '-1K']]) {
      const run = spawnSync(process.execPath, [cli, '--repo', '/nonexistent', flag!, value!], { encoding: 'utf8' });
      assert.equal(run.status, 1, `${flag}: ${run.stderr}`);
      assert.match(run.stderr, new RegExp(`^Error: ${flag} must be a .*, got '${value}'$`, 'm'));
    }
  });
});
