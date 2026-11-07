/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The calls a workspace keeps (east-workspace#1554): a call of a named
 * function through a workspace started, polled to its end, cancelled, listed
 * and read whole — who made it, its arguments, the versions of the inputs it
 * read, its value and its logs — and kept for the lifetime its end gives it,
 * the sync route's calls among them.
 *
 * No case leans on a timing a server sets: a start asked to wait no time
 * answers `running` at once; a call of a known length sleeps (`nap`), and one
 * that would outlast the test sleeps 30 s (`slow`) and is cancelled; a poll
 * waits what its server allows; and a lifetime is read from each call's
 * `expiresAt`, never assumed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  IntegerType, OptionType, StringType, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, variant, type ValueTypeOf,
} from '@elaraai/east';
import {
  ApiError,
  datasetGetStatus,
  objectGet,
  workspaceCallGet,
  workspaceCallList,
  workspaceFunctionCallCancel,
  workspaceFunctionCallStatus,
  workspaceFunctionCallSync,
  workspaceFunctionStart,
  type ExecuteResult,
  type FunctionCallRequest,
  type FunctionCallStatus,
  type RequestOptions,
} from '@elaraai/e3-api-client';
import { uuidv7 } from '@elaraai/e3-core';
import { ExecuteResultType, type TreePath } from '@elaraai/e3-types';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createFunctionPackageZip } from '../fixtures.js';

const PKG = 'calls-test-pkg';
const VERSION = '1.0.0';
const WS = 'calls-ws';

/** The fixture's inputs `quote` reads. */
const VALUE_PATH: TreePath = [variant('field', 'inputs'), variant('field', 'value')];
const PRICES_PATH: TreePath = [variant('field', 'inputs'), variant('field', 'prices')];

/** What a result names it read, and a kept call's inputs. */
const InputsType = ExecuteResultType.fields.inputs;

const encodeInt = encodeBeast2For(IntegerType);
const decodeInt = decodeBeast2For(IntegerType);
const encodeString = encodeBeast2For(StringType);
const decodeString = decodeBeast2For(StringType);
const sameCaller = equalFor(OptionType(StringType));

/** A call of value arguments, each one's bytes. */
function request(args: Uint8Array[]): FunctionCallRequest {
  return { args: args.map((arg) => variant('value', arg)), runner: none, limits: none };
}

/** A result's Integer value, once it succeeded. */
function successValue(result: ExecuteResult): bigint {
  if (result.outcome.type !== 'success') assert.fail(`expected success, got ${result.outcome.type}: ${result.stderr}`);
  return decodeInt(result.outcome.value.value);
}

/** A status's result, once the call completed. */
function completed(status: FunctionCallStatus): ExecuteResult {
  if (status.type !== 'completed') assert.fail(`expected completed, got ${status.type}`);
  return status.value;
}

/** Polls a call until it has ended, each poll asking the server to wait for it. */
async function ended(ctx: TestContext, ws: string, id: string, opts: RequestOptions): Promise<FunctionCallStatus> {
  for (;;) {
    const status = await workspaceFunctionCallStatus(ctx.config.baseUrl, ctx.repoName, ws, id, opts, { waitMs: 20_000 });
    if (status.type !== 'running') return status;
  }
}

/** A UUIDv7 of an hour ago: a call's id from a client whose clock is that far off. */
function idOfAnHourAgo(): string {
  const time = (Date.now() - 60 * 60_000).toString(16).padStart(12, '0');
  return `${time.slice(0, 8)}-${time.slice(8, 12)}${uuidv7().slice(13)}`;
}

/** A dataset as a kept call names it: its path, and the hash it holds. */
async function pinnedAt(ctx: TestContext, path: TreePath, opts: RequestOptions): Promise<ValueTypeOf<typeof InputsType>[number]> {
  const status = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, WS, path, opts);
  if (status.hash.type === 'none') assert.fail(`${status.path} holds no value`);
  return { path, hash: status.hash.value };
}

/**
 * Register the kept-call tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function callTests(setup: TestSetup<TestContext>): void {
  /** A context whose workspace has the function fixture deployed. */
  const withCalls: TestSetup<TestContext> = async (t) => {
    const ctx = await setup(t);
    await ctx.importPackage(await createFunctionPackageZip(ctx.tempDir, PKG, VERSION));
    await ctx.createWorkspace(WS);
    await ctx.deployPackage(WS, `${PKG}@${VERSION}`);
    return ctx;
  };

  describe('calls', { concurrency: false }, () => {
    it('a start asked to wait no time answers running with the call\'s id, and its poll answers the result and the logs once it ends', async (t) => {
      const ctx = await withCalls(t);
      const opts = await ctx.opts();

      const answer = await workspaceFunctionStart(ctx.config.baseUrl, ctx.repoName, WS, 'nap', request([encodeInt(1500n)]), opts, { waitMs: 0 });
      assert.equal(answer.status.type, 'running', 'a start that waits no time answers before the call ends');

      const result = completed(await ended(ctx, WS, answer.id, opts));
      assert.equal(successValue(result), 1500n);
      assert.match(result.stdout, /napping 1500 ms/);
      assert.match(result.stderr, /woke after 1500 ms/);
    });

    it('a poll asked to wait answers as its call ends, not once its wait has passed', async (t) => {
      const ctx = await withCalls(t);
      const opts = await ctx.opts();

      const answer = await workspaceFunctionStart(ctx.config.baseUrl, ctx.repoName, WS, 'nap', request([encodeInt(1000n)]), opts, { waitMs: 0 });
      const asked = Date.now();
      // A server holds a poll at most as long as it allows: one that allows
      // less than the call takes is asked again
      let status = await workspaceFunctionCallStatus(ctx.config.baseUrl, ctx.repoName, WS, answer.id, opts, { waitMs: 60_000 });
      while (status.type === 'running') {
        status = await workspaceFunctionCallStatus(ctx.config.baseUrl, ctx.repoName, WS, answer.id, opts, { waitMs: 60_000 });
      }
      assert.equal(successValue(completed(status)), 1000n);
      assert.ok(Date.now() - asked < 30_000, `a call of a second answered after ${Date.now() - asked} ms of a 60 s wait`);
    });

    it('a cancel stops a running call: it ends cancelled, naming who asked, long before it would have ended, and a second cancel changes nothing', async (t) => {
      const ctx = await withCalls(t);
      const opts = await ctx.opts();

      // `slow` sleeps 30 s
      const answer = await workspaceFunctionStart(ctx.config.baseUrl, ctx.repoName, WS, 'slow', request([encodeInt(1n)]), opts, { waitMs: 0 });
      assert.equal(answer.status.type, 'running');
      const asked = Date.now();
      let status = await workspaceFunctionCallCancel(ctx.config.baseUrl, ctx.repoName, WS, answer.id, opts);
      if (status.type === 'running') status = await ended(ctx, WS, answer.id, opts);
      if (status.type !== 'cancelled') assert.fail(`expected cancelled, got ${status.type}`);
      assert.ok(Date.now() - asked < 20_000, `the call stopped ${Date.now() - asked} ms after the cancel, its 30 s sleep cut short`);

      const call = await workspaceCallGet(ctx.config.baseUrl, ctx.repoName, WS, answer.id, opts);
      assert.equal(call.state.type, 'cancelled');
      const print = printFor(OptionType(StringType));
      assert.ok(sameCaller(status.value.by, call.caller), `cancelled by ${print(status.value.by)}, by the caller who made it, ${print(call.caller)}`);

      const again = await workspaceFunctionCallCancel(ctx.config.baseUrl, ctx.repoName, WS, answer.id, opts);
      assert.equal(again.type, 'cancelled', 'a call that has ended is left as it is');
    });

    it('a start given an id of its own files the call under it, which a cancel by it stops; one already kept, or no UUIDv7, is refused, and one far from the server\'s clock set aside', async (t) => {
      const ctx = await withCalls(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;
      const add = request([encodeInt(2n), encodeInt(3n)]);

      // `slow` sleeps 30 s: its client names it, and stops it by that name
      const id = uuidv7();
      const answer = await workspaceFunctionStart(base, ctx.repoName, WS, 'slow', request([encodeInt(1n)]), opts, { waitMs: 0, id });
      assert.equal(answer.id, id, 'filed under the id its start named');
      let status = await workspaceFunctionCallCancel(base, ctx.repoName, WS, id, opts);
      if (status.type === 'running') status = await ended(ctx, WS, id, opts);
      assert.equal(status.type, 'cancelled');

      await assert.rejects(workspaceFunctionStart(base, ctx.repoName, WS, 'add', add, opts, { id }),
        (err: unknown) => err instanceof ApiError, 'a second call under one id is refused');
      await assert.rejects(workspaceFunctionStart(base, ctx.repoName, WS, 'add', add, opts, { id: 'not-a-uuid' }),
        (err: unknown) => err instanceof ApiError && err.code === 'bad_request');
      // A clock an hour off would order the call among others it did not follow
      const stale = idOfAnHourAgo();
      const named = await workspaceFunctionStart(base, ctx.repoName, WS, 'add', add, opts, { id: stale });
      assert.notEqual(named.id, stale, 'the server names it');
      assert.equal(successValue(completed(named.status)), 5n);
    });

    it('a kept call opens to its package, its arguments, the versions of the inputs it read, its value by hash, and its logs', async (t) => {
      const ctx = await withCalls(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;

      // `quote` reads `value` (10) and `prices` ({a: 1, b: 2, c: 3}), and is given a sku
      const quoted = await workspaceFunctionStart(base, ctx.repoName, WS, 'quote', request([encodeString('b')]), opts);
      assert.equal(successValue(completed(quoted.status)), 12n);
      const quote = await workspaceCallGet(base, ctx.repoName, WS, quoted.id, opts);
      assert.equal(quote.id, quoted.id);
      assert.equal(quote.function, 'quote');
      assert.equal(quote.package.name, PKG);
      assert.equal(quote.package.version, VERSION);
      const read = [await pinnedAt(ctx, VALUE_PATH, opts), await pinnedAt(ctx, PRICES_PATH, opts)];
      assert.ok(equalFor(InputsType)(quote.inputs, read), `the inputs it read, ${printFor(InputsType)(quote.inputs)}`);
      const [sku] = quote.args;
      if (sku?.type !== 'value') assert.fail('its one argument is a value');
      assert.equal(decodeString(await objectGet(base, ctx.repoName, sku.value, opts)), 'b', 'the argument, by the object it was stored as');
      if (quote.state.type !== 'succeeded') assert.fail(`the call ended ${quote.state.type}`);
      assert.equal(decodeInt(await objectGet(base, ctx.repoName, quote.state.value.value, opts)), 12n, 'the value, by its object');
      assert.equal(quote.endedAt.type, 'some');

      // A dataset argument is kept as the hash it was pinned at
      const added = await workspaceFunctionStart(base, ctx.repoName, WS, 'add', { args: [variant('dataset', VALUE_PATH), variant('value', encodeInt(5n))], runner: none, limits: none }, opts);
      assert.equal(successValue(completed(added.status)), 15n);
      const add = await workspaceCallGet(base, ctx.repoName, WS, added.id, opts);
      const [dataset] = add.args;
      if (dataset?.type !== 'dataset') assert.fail('its first argument is a dataset');
      assert.equal(dataset.value.hash, read[0]!.hash, 'the dataset argument, at the hash it was pinned at');

      // Its logs' tails
      const napped = await workspaceFunctionStart(base, ctx.repoName, WS, 'nap', request([encodeInt(10n)]), opts);
      assert.equal(successValue(completed(napped.status)), 10n);
      const nap = await workspaceCallGet(base, ctx.repoName, WS, napped.id, opts);
      assert.match(nap.stdout, /napping 10 ms/);
      assert.match(nap.stderr, /woke after 10 ms/);
    });

    it("a workspace's calls are listed the latest first, a page at a time, a function's or a state's alone", async (t) => {
      const ctx = await withCalls(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;

      const ids: string[] = [];
      for (const [fn, args] of [
        ['add', [encodeInt(2n), encodeInt(3n)]],
        ['twice', [encodeInt(4n)]],
        // A wrong-typed argument fails the call as it runs
        ['add', [encodeString('not a number'), encodeInt(3n)]],
        ['twice', [encodeInt(5n)]],
      ] as const) {
        ids.push((await workspaceFunctionStart(base, ctx.repoName, WS, fn, request([...args]), opts)).id);
      }
      const latestFirst = [...ids].reverse();
      const listed = (page: { calls: readonly { id: string }[] }): string[] => page.calls.map((call) => call.id);

      const all = await workspaceCallList(base, ctx.repoName, WS, opts);
      assert.deepEqual(listed(all), latestFirst);
      assert.equal(all.next.type, 'none', 'one page holds them all');

      const first = await workspaceCallList(base, ctx.repoName, WS, opts, { limit: 3 });
      assert.deepEqual(listed(first), latestFirst.slice(0, 3));
      if (first.next.type !== 'some') assert.fail('a page that is not the last names the next');
      const second = await workspaceCallList(base, ctx.repoName, WS, opts, { limit: 3, before: first.next.value });
      assert.deepEqual(listed(second), latestFirst.slice(3));
      assert.equal(second.next.type, 'none');

      assert.deepEqual(listed(await workspaceCallList(base, ctx.repoName, WS, opts, { function: 'twice' })), [ids[3], ids[1]]);
      assert.deepEqual(listed(await workspaceCallList(base, ctx.repoName, WS, opts, { state: 'failed' })), [ids[2]]);
      const failed = (await workspaceCallList(base, ctx.repoName, WS, opts, { state: 'failed' })).calls[0]!;
      assert.equal(failed.function, 'add');
      assert.equal(failed.endedAt.type, 'some');

      await assert.rejects(
        workspaceCallList(base, ctx.repoName, WS, opts, { state: 'asleep' as never }),
        (err: unknown) => err instanceof ApiError && err.code === 'bad_request',
      );
    });

    it('a call is kept for the lifetime its end gives it, a failure longer than a success, and one running past its deadline as long as a failure, for a read to find it lost', async (t) => {
      const ctx = await withCalls(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;

      const kept = async (fn: string, args: Uint8Array[]): Promise<number> => {
        const { id } = await workspaceFunctionStart(base, ctx.repoName, WS, fn, request(args), opts);
        const call = await workspaceCallGet(base, ctx.repoName, WS, id, opts);
        if (call.endedAt.type !== 'some') assert.fail(`${fn} has not ended`);
        return call.expiresAt.getTime() - call.endedAt.value.getTime();
      };
      const success = await kept('add', [encodeInt(2n), encodeInt(3n)]);
      const failure = await kept('add', [encodeString('not a number'), encodeInt(3n)]);
      assert.ok(success > 0, `a success is kept ${success} ms`);
      assert.ok(failure > success, `a failure is kept ${failure} ms, longer than a success's ${success} ms`);

      const running = await workspaceFunctionStart(base, ctx.repoName, WS, 'slow', request([encodeInt(1n)]), opts, { waitMs: 0 });
      const call = await workspaceCallGet(base, ctx.repoName, WS, running.id, opts);
      assert.equal(call.state.type, 'running');
      // A call whose server stopped is ended by the first read past its
      // deadline and a grace, so it must still be kept then, and for as long
      // as the failure it becomes
      const past = call.expiresAt.getTime() - (call.startedAt.getTime() + Number(call.limits.timeoutMs));
      assert.ok(past >= failure, `a running call is kept ${past} ms past its deadline, less than a failure's ${failure} ms: one its server lost would be forgotten, not found lost`);
      await workspaceFunctionCallCancel(base, ctx.repoName, WS, running.id, opts);
      assert.equal((await ended(ctx, WS, running.id, opts)).type, 'cancelled');
    });

    it('a start found wrong is kept as an invalid call, answered with its result, and nothing runs', async (t) => {
      const ctx = await withCalls(t);
      const opts = await ctx.opts();

      const answer = await workspaceFunctionStart(ctx.config.baseUrl, ctx.repoName, WS, 'add', request([encodeInt(2n)]), opts);
      const outcome = completed(answer.status).outcome;
      if (outcome.type !== 'invalid') assert.fail(`expected invalid, got ${outcome.type}`);
      assert.deepEqual(outcome.value.diagnostics.map((diagnostic) => diagnostic.message), ['Expected 2 argument(s), got 1']);
      const call = await workspaceCallGet(ctx.config.baseUrl, ctx.repoName, WS, answer.id, opts);
      assert.equal(call.state.type, 'invalid');
      assert.equal(call.args.length, 0, 'a call refused names nothing it would have read');
    });

    it('the sync route answers its result within its request, and keeps its call too', async (t) => {
      const ctx = await withCalls(t);
      const opts = await ctx.opts();

      const result = await workspaceFunctionCallSync(ctx.config.baseUrl, ctx.repoName, WS, 'add', request([encodeInt(2n), encodeInt(3n)]), opts);
      assert.equal(successValue(result), 5n);
      const page = await workspaceCallList(ctx.config.baseUrl, ctx.repoName, WS, opts);
      assert.equal(page.calls.length, 1);
      assert.equal(page.calls[0]!.function, 'add');
      assert.equal(page.calls[0]!.state.type, 'succeeded');
    });

    it('a reader starts a call, polls it and finds it in the list', async (t) => {
      const ctx = await withCalls(t);
      const reader = await ctx.readerOpts();

      const answer = await workspaceFunctionStart(ctx.config.baseUrl, ctx.repoName, WS, 'nap', request([encodeInt(500n)]), reader, { waitMs: 0 });
      assert.equal(successValue(completed(await ended(ctx, WS, answer.id, reader))), 500n);
      const page = await workspaceCallList(ctx.config.baseUrl, ctx.repoName, WS, reader);
      assert.deepEqual(page.calls.map((call) => call.id), [answer.id]);
    });

    it('a call is found only through the workspace that made it', async (t) => {
      const ctx = await withCalls(t);
      const opts = await ctx.opts();
      await ctx.createWorkspace('calls-other-ws');
      await ctx.deployPackage('calls-other-ws', `${PKG}@${VERSION}`);

      const { id } = await workspaceFunctionStart(ctx.config.baseUrl, ctx.repoName, WS, 'add', request([encodeInt(2n), encodeInt(3n)]), opts);
      for (const call of [
        () => workspaceFunctionCallStatus(ctx.config.baseUrl, ctx.repoName, 'calls-other-ws', id, opts),
        () => workspaceCallGet(ctx.config.baseUrl, ctx.repoName, 'calls-other-ws', id, opts),
        () => workspaceFunctionCallCancel(ctx.config.baseUrl, ctx.repoName, 'calls-other-ws', id, opts),
      ]) {
        await assert.rejects(call(), (err: unknown) => {
          assert.ok(err instanceof ApiError, 'expected an ApiError');
          assert.equal(err.code, 'internal');
          assert.match((err.details as { message: string }).message, new RegExp(`workspace 'calls-other-ws' keeps no call '${id}'`));
          return true;
        });
      }
      assert.equal((await workspaceCallList(ctx.config.baseUrl, ctx.repoName, 'calls-other-ws', opts)).calls.length, 0);
    });
  });
}
