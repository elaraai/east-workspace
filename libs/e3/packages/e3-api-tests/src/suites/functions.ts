/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Named function + one-shot execution test suite.
 *
 * Exercises the graph-free execution path end-to-end against a real server
 * + real east-node runner: list/describe, sync calls, limits
 * (too_large / timed_out), cancellation, both scopes (package + workspace),
 * runner override — never the custom runtime, and a package the function does
 * not load only for an elevated caller — one-shot with value, dataset and
 * collection-dataset args,
 * the "persists nothing" guarantee, and one-shot for a reader: a platform-free
 * one runs and names the datasets it read, and any other is refused. A split
 * call — a program over a dataset's pieces — is launched, explained and polled
 * by a reader, under the same rule; it is found only through the repository
 * and workspace that launched it, and a reader never polls one only an
 * elevated grant could launch.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  East,
  ArrayType,
  DictType,
  FunctionType,
  IntegerType,
  NullType,
  SortedMap,
  StringType,
  compareFor,
  encodeBeast2For,
  decodeBeast2For,
  encodeEastIR,
  equalFor,
  printFor,
  variant,
  some,
  none,
  type EastType,
  type ValueTypeOf,
} from '@elaraai/east';
import {
  ApiError,
  repoCreate,
  repoRemove,
  repoStatus,
  datasetGetStatus,
  datasetSet,
  functionList,
  functionDescribe,
  functionCall,
  workspaceFunctionCall,
  oneShotExecute,
  splitCall,
  splitCallExplain,
  splitCallLaunch,
  splitCallStatus,
  type ExecuteResult,
  type FunctionCallRequest,
  type OneShotRequest,
  type RequestOptions,
  type SplitCallRequest,
  type SplitCallStatus,
} from '@elaraai/e3-api-client';
import { ExecuteResultType, PermissionDeniedErrorType, type TreePath } from '@elaraai/e3-types';
import { Console } from '@elaraai/east-node-std';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createFunctionPackageZip } from '../fixtures.js';

const PKG = 'fn-test-pkg';
const VERSION = '1.0.0';

/** The fixture's inputs: an Integer, a Dict stored as a manifest, and an
 *  unassigned function value. */
const VALUE_PATH: TreePath = [variant('field', 'inputs'), variant('field', 'value')];
const PRICES_PATH: TreePath = [variant('field', 'inputs'), variant('field', 'prices')];
const APPLY_PATH: TreePath = [variant('field', 'inputs'), variant('field', 'apply')];

const ApplyType = FunctionType([IntegerType], IntegerType);
const PricesType = DictType(StringType, IntegerType);
/** What a result names it read. */
const InputsType = ExecuteResultType.fields.inputs;

const encodeInt = encodeBeast2For(IntegerType);
const decodeInt = decodeBeast2For(IntegerType);

function request(args: Uint8Array[], overrides?: Partial<FunctionCallRequest>): FunctionCallRequest {
  return { args, runner: none, limits: none, ...overrides };
}

function successValue(result: ExecuteResult): bigint {
  assert.equal(result.outcome.type, 'success', `expected success, got ${result.outcome.type}: ${result.stderr}`);
  return decodeInt((result.outcome.value as { value: Uint8Array }).value);
}

/** Asserts a result succeeded with `expected`. */
function assertValue<T extends EastType>(result: ExecuteResult, type: T, expected: ValueTypeOf<T>): void {
  if (result.outcome.type !== 'success') assert.fail(`expected success, got ${result.outcome.type}: ${result.stderr}`);
  const value = decodeBeast2For(type)(result.outcome.value.value);
  assert.ok(equalFor(type)(value, expected), `the value is ${printFor(type)(value)}, expected ${printFor(type)(expected)}`);
}

/** Asserts a result names exactly `expected` as what it read. */
function assertInputs(result: ExecuteResult, expected: ValueTypeOf<typeof InputsType>): void {
  const print = printFor(InputsType);
  assert.ok(equalFor(InputsType)(result.inputs, expected), `inputs ${print(result.inputs)}, expected ${print(expected)}`);
}

/** A refusal of what a caller's one-shot grant does not allow:
 *  `permission_denied` on `path`. */
function refusalOn(path: string, what: string): (err: unknown) => boolean {
  return (err) => {
    assert.ok(err instanceof ApiError, `${what}: expected an ApiError`);
    assert.equal(err.code, 'permission_denied', what);
    const details = err.details as ValueTypeOf<typeof PermissionDeniedErrorType>;
    assert.ok(equalFor(PermissionDeniedErrorType)(details, { path }), `${what}: ${printFor(PermissionDeniedErrorType)(details)}`);
    return true;
  };
}

/** The refusal a caller whose one-shot grant does not run a call gets:
 *  `permission_denied` on `one-shot`. */
function oneShotRefusal(what: string): (err: unknown) => boolean {
  return refusalOn('one-shot', what);
}

/** A split call on east-node, given no platform package, with no `then`. */
function splitOf(body: { toIR(): unknown }, args: SplitCallRequest['args'], output: SplitCallRequest['output']): SplitCallRequest {
  return { bodyIr: encodeEastIR(body.toIR() as never), args, output, then: none, runner: variant('east_node', { platforms: [] }), limits: none };
}

/** A dataset argument as a result names it: its path, and the hash the
 *  dataset holds. */
async function pinnedAt(ctx: TestContext, workspace: string, path: TreePath, opts: RequestOptions): Promise<ValueTypeOf<typeof InputsType>[number]> {
  const status = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, workspace, path, opts);
  if (status.hash.type === 'none') assert.fail(`${status.path} holds no value`);
  return { path, hash: status.hash.value };
}

/** A body that calls an east-node-std platform function. */
const logging = East.function([IntegerType], IntegerType, ($, x) => {
  $(Console.error('called'));
  return x;
});

/** A split call's program that emits each price of the piece it is given. */
const emitEachPrice = East.function([PricesType, FunctionType([IntegerType], NullType)], NullType, ($, prices, emit) => {
  $.for(prices, ($, price) => {
    $(emit(price));
  });
});

/** `prices`, as a split call's argument cut into pieces. */
const PRICES_PIECES: SplitCallRequest['args'][number] = { arg: variant('dataset', PRICES_PATH), partition: some({ by: [] }) };

/** A split call's status once its job has ended, polled as the client's
 *  `splitCall` polls it. */
async function splitCallEnded(ctx: TestContext, ws: string, id: string, opts: RequestOptions): Promise<SplitCallStatus> {
  for (;;) {
    const status = await splitCallStatus(ctx.config.baseUrl, ctx.repoName, ws, id, opts);
    if (status.type !== 'processing') return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}


/**
 * Register named-function and one-shot tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function functionTests(setup: TestSetup<TestContext>): void {
  const withFunctions: TestSetup<TestContext> = async (t) => {
    const ctx = await setup(t);
    const zipPath = await createFunctionPackageZip(ctx.tempDir, PKG, VERSION);
    await ctx.importPackage(zipPath);
    return ctx;
  };

  describe('functions', { concurrency: false }, () => {
    it('functionList returns the package signatures', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();

      const fns = await functionList(ctx.config.baseUrl, ctx.repoName, PKG, VERSION, opts);
      const names = fns.map((f) => f.name).sort();
      assert.deepEqual(names, ['add', 'slow']);
      const add = fns.find((f) => f.name === 'add')!;
      assert.equal(add.inputTypes.length, 2);
      assert.equal(add.outputType.type, 'Integer');
      assert.equal(add.runner.type, 'east_node');
    });

    it('functionDescribe returns a single signature', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();

      const sig = await functionDescribe(ctx.config.baseUrl, ctx.repoName, PKG, VERSION, 'add', opts);
      assert.equal(sig.name, 'add');
      assert.equal(sig.inputTypes.length, 2);
    });

    it('sync call computes inline, reads no dataset and persists nothing', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();

      const before = await repoStatus(ctx.config.baseUrl, ctx.repoName, opts);

      const result = await functionCall(
        ctx.config.baseUrl, ctx.repoName, PKG, VERSION, 'add',
        request([encodeInt(2n), encodeInt(3n)]),
        opts
      );
      assert.equal(successValue(result), 5n);
      // A named function's arguments are values: the result names no dataset
      assertInputs(result, []);

      // Nothing durable was written: object count is unchanged
      const after = await repoStatus(ctx.config.baseUrl, ctx.repoName, opts);
      assert.equal(after.objectCount, before.objectCount);
    });

    it('arity mismatch is invalid and nothing runs', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();

      const result = await functionCall(
        ctx.config.baseUrl, ctx.repoName, PKG, VERSION, 'add',
        request([encodeInt(2n)]),
        opts
      );
      assert.equal(result.outcome.type, 'invalid');
    });

    it('a wrong-typed argument surfaces as a runtime failure with stderr', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();

      const badArg = encodeBeast2For(StringType)('not a number');
      const result = await functionCall(
        ctx.config.baseUrl, ctx.repoName, PKG, VERSION, 'add',
        request([badArg, encodeInt(3n)]),
        opts
      );
      assert.equal(result.outcome.type, 'failed');
      assert.ok(result.stderr.length > 0, 'expected a runtime diagnostic on stderr');
    });

    it('a result over maxResultBytes fails closed with too_large', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();

      const result = await functionCall(
        ctx.config.baseUrl, ctx.repoName, PKG, VERSION, 'add',
        request([encodeInt(2n), encodeInt(3n)], {
          limits: some({ timeoutMs: none, maxResultBytes: some(8n), maxLogBytes: none }),
        }),
        opts
      );
      assert.equal(result.outcome.type, 'too_large');
    });

    it('a long call is killed at timeoutMs with timed_out', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();

      const result = await functionCall(
        ctx.config.baseUrl, ctx.repoName, PKG, VERSION, 'slow',
        request([encodeInt(1n)], {
          limits: some({ timeoutMs: some(1500n), maxResultBytes: none, maxLogBytes: none }),
        }),
        opts
      );
      assert.equal(result.outcome.type, 'timed_out');
    });

    it('workspace-scoped calls give identical results to package-scoped', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();

      await ctx.createWorkspace('fn-ws');
      await ctx.deployPackage('fn-ws', `${PKG}@${VERSION}`);

      const viaPackage = await functionCall(
        ctx.config.baseUrl, ctx.repoName, PKG, VERSION, 'add',
        request([encodeInt(4n), encodeInt(5n)]),
        opts
      );
      const viaWorkspace = await workspaceFunctionCall(
        ctx.config.baseUrl, ctx.repoName, 'fn-ws', 'add',
        request([encodeInt(4n), encodeInt(5n)]),
        opts
      );
      assert.equal(successValue(viaPackage), 9n);
      assert.equal(successValue(viaWorkspace), 9n);
    });

    it('a runner override in the request is honoured', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();

      const result = await functionCall(
        ctx.config.baseUrl, ctx.repoName, PKG, VERSION, 'add',
        request([encodeInt(2n), encodeInt(3n)], {
          runner: some(variant('east_node', { platforms: ['@elaraai/east-node-std'] })),
        }),
        opts
      );
      assert.equal(successValue(result), 5n);
    });

    it('a call naming the custom runtime is refused whoever makes it, and runs nothing', async (t) => {
      const ctx = await withFunctions(t);
      const custom = request([encodeInt(2n), encodeInt(3n)], { runner: some(variant('custom', { command: ['sh', '-c', 'exit 0'] })) });
      for (const [who, opts] of [['an admin', await ctx.opts()], ['a reader', await ctx.readerOpts()]] as const) {
        const result = await functionCall(ctx.config.baseUrl, ctx.repoName, PKG, VERSION, 'add', custom, opts);
        assert.equal(result.outcome.type, 'invalid', `${who}: ${result.outcome.type}`);
      }
    });

    it('a reader calls a function on its own runner, and is refused a runner that loads a package the function does not', async (t) => {
      const ctx = await withFunctions(t);
      const reader = await ctx.readerOpts();

      assert.equal(successValue(await functionCall(ctx.config.baseUrl, ctx.repoName, PKG, VERSION, 'add', request([encodeInt(2n), encodeInt(3n)]), reader)), 5n);
      await assert.rejects(
        functionCall(ctx.config.baseUrl, ctx.repoName, PKG, VERSION, 'add', request([encodeInt(2n), encodeInt(3n)], {
          runner: some(variant('east_node', { platforms: ['@elaraai/east-node-std', '@elaraai/east-node-io'] })),
        }), reader),
        refusalOn('runner', 'a runner given a package the function does not load'),
      );
    });

    it('one-shot runs anonymous IR with inline value args', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();

      await ctx.createWorkspace('oneshot-ws');
      await ctx.deployPackage('oneshot-ws', `${PKG}@${VERSION}`);

      const triple = East.function([IntegerType], IntegerType, ($, x) => x.multiply(3n));
      const result = await oneShotExecute(
        ctx.config.baseUrl, ctx.repoName, 'oneshot-ws',
        {
          bodyIr: encodeEastIR(triple.toIR()),
          args: [variant('value', encodeInt(7n))],
          runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }),
          limits: none,
        },
        opts
      );
      assert.equal(successValue(result), 21n);
    });

    it('one-shot binds dataset args from the workspace', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();

      await ctx.createWorkspace('oneshot-ds-ws');
      await ctx.deployPackage('oneshot-ds-ws', `${PKG}@${VERSION}`);

      // The package's `value` input dataset defaults to 10
      const triple = East.function([IntegerType], IntegerType, ($, x) => x.multiply(3n));
      const result = await oneShotExecute(
        ctx.config.baseUrl, ctx.repoName, 'oneshot-ds-ws',
        {
          bodyIr: encodeEastIR(triple.toIR()),
          args: [variant('dataset', [variant('field', 'inputs'), variant('field', 'value')])],
          runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }),
          limits: none,
        },
        opts
      );
      assert.equal(successValue(result), 30n);
    });

    it('one-shot binds a collection dataset arg as the value it holds', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();

      await ctx.createWorkspace('oneshot-dict-ws');
      await ctx.deployPackage('oneshot-dict-ws', `${PKG}@${VERSION}`);

      // The dataset's ref names its manifest; the runner is given the dict.
      const total = East.function([DictType(StringType, IntegerType)], IntegerType,
        ($, prices) => prices.reduce(($, sum, price) => sum.add(price), 0n));
      const result = await oneShotExecute(
        ctx.config.baseUrl, ctx.repoName, 'oneshot-dict-ws',
        {
          bodyIr: encodeEastIR(total.toIR()),
          args: [variant('dataset', [variant('field', 'inputs'), variant('field', 'prices')])],
          runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }),
          limits: none,
        },
        opts
      );
      assert.equal(successValue(result), 6n);
    });

    it('a reader runs a platform-free one-shot, and its result names the datasets it read', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();
      const reader = await ctx.readerOpts();

      await ctx.createWorkspace('reader-ws');
      await ctx.deployPackage('reader-ws', `${PKG}@${VERSION}`);

      // `value` holds 10, and `prices` a Dict summing to 6, stored as a manifest
      const total = East.function([IntegerType, DictType(StringType, IntegerType)], IntegerType,
        ($, value, prices) => value.add(prices.reduce(($, sum, price) => sum.add(price), 0n)));
      const result = await oneShotExecute(
        ctx.config.baseUrl, ctx.repoName, 'reader-ws',
        {
          bodyIr: encodeEastIR(total.toIR()),
          args: [variant('dataset', VALUE_PATH), variant('dataset', PRICES_PATH)],
          runner: variant('east_node', { platforms: [] }),
          limits: none,
        },
        reader
      );
      assert.equal(successValue(result), 16n);
      assertInputs(result, [
        await pinnedAt(ctx, 'reader-ws', VALUE_PATH, opts),
        await pinnedAt(ctx, 'reader-ws', PRICES_PATH, opts),
      ]);
    });

    it('a reader is refused a one-shot that is not platform-free', async (t) => {
      const ctx = await withFunctions(t);
      const reader = await ctx.readerOpts();

      await ctx.createWorkspace('refused-ws');
      await ctx.deployPackage('refused-ws', `${PKG}@${VERSION}`);

      const triple = East.function([IntegerType], IntegerType, ($, x) => x.multiply(3n));
      const oneShot = (body: typeof triple, runner: OneShotRequest['runner']): OneShotRequest => ({
        bodyIr: encodeEastIR(body.toIR()),
        args: [variant('value', encodeInt(7n))],
        runner,
        limits: none,
      });
      const refused: [string, OneShotRequest][] = [
        ['a body calling a platform function', oneShot(logging, variant('east_node', { platforms: [] }))],
        ['a runner given a platform package', oneShot(triple, variant('east_node', { platforms: ['@elaraai/east-node-std'] }))],
        ['a custom runner', oneShot(triple, variant('custom', { command: ['sh', '-c', 'exit 0'] }))],
      ];
      for (const [what, body] of refused) {
        await assert.rejects(oneShotExecute(ctx.config.baseUrl, ctx.repoName, 'refused-ws', body, reader), oneShotRefusal(what));
      }
    });

    it('a function value a reader\'s one-shot calls cannot reach a platform function', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();
      const reader = await ctx.readerOpts();

      await ctx.createWorkspace('fn-value-ws');
      await ctx.deployPackage('fn-value-ws', `${PKG}@${VERSION}`);

      // The workspace holds a function that logs through east-node-std
      await datasetSet(
        ctx.config.baseUrl, ctx.repoName, 'fn-value-ws', APPLY_PATH,
        encodeBeast2For(ApplyType)(East.compile(logging, Console.Implementation)),
        opts
      );

      // The body is platform-free, and its runtime loads no platform, so the
      // call it makes to the function cannot reach one
      const call = East.function([ApplyType, IntegerType], IntegerType, ($, apply, value) => apply(value));
      const result = await oneShotExecute(
        ctx.config.baseUrl, ctx.repoName, 'fn-value-ws',
        {
          bodyIr: encodeEastIR(call.toIR()),
          args: [variant('dataset', APPLY_PATH), variant('dataset', VALUE_PATH)],
          runner: variant('east_node', { platforms: [] }),
          limits: none,
        },
        reader
      );
      assert.equal(result.outcome.type, 'failed', `expected failed, got ${result.outcome.type}: ${result.stderr}`);
      assert.match(result.stderr, /console_error/);
    });

    it('a reader launches split calls and polls each output kind\'s value, and what each read', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();
      const reader = await ctx.readerOpts();

      await ctx.createWorkspace('split-ws');
      await ctx.deployPackage('split-ws', `${PKG}@${VERSION}`);
      const run = (request: SplitCallRequest) => splitCall(ctx.config.baseUrl, ctx.repoName, 'split-ws', request, reader);
      // `prices` is {a: 1, b: 2, c: 3}, split into however many pieces the
      // server cuts; `value`, 10, reaches every piece whole.
      const prices = { arg: variant('dataset', PRICES_PATH), partition: some({ by: [] }) };
      const pinnedPrices = await pinnedAt(ctx, 'split-ws', PRICES_PATH, opts);

      const tenfold = await run(splitOf(
        East.function([PricesType, FunctionType([IntegerType], NullType)], NullType, ($, prices, emit) => {
          $.for(prices, ($, price) => {
            $(emit(price.multiply(10n)));
          });
        }),
        [prices],
        variant('array', null),
      ));
      assertValue(tenfold.result, ArrayType(IntegerType), [10n, 20n, 30n]);
      assertInputs(tenfold.result, [pinnedPrices]);
      assert.notEqual(tenfold.output, null, 'the result names the assembled output');

      const plus = await run(splitOf(
        East.function([PricesType, IntegerType, FunctionType([StringType, IntegerType], NullType)], NullType, ($, prices, value, emit) => {
          $.for(prices, ($, price, key) => {
            $(emit(key, price.add(value)));
          });
        }),
        [prices, { arg: variant('dataset', VALUE_PATH), partition: none }],
        variant('dict', { merge: none }),
      ));
      assertValue(plus.result, PricesType, new SortedMap([['a', 11n], ['b', 12n], ['c', 13n]], compareFor(StringType)));
      assertInputs(plus.result, [pinnedPrices, await pinnedAt(ctx, 'split-ws', VALUE_PATH, opts)]);

      const total = await run(splitOf(
        East.function([PricesType, FunctionType([IntegerType], NullType)], NullType, ($, prices, emit) => {
          $.for(prices, ($, price) => {
            $(emit(price));
          });
        }),
        [prices],
        variant('fold', {
          combine: encodeEastIR(East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b)).toIR()),
          zero: encodeInt(0n),
        }),
      ));
      assert.equal(successValue(total.result), 6n);
    });

    it('a reader is refused a split call whose runner is given a platform package', async (t) => {
      const ctx = await withFunctions(t);
      const reader = await ctx.readerOpts();

      await ctx.createWorkspace('split-refused-ws');
      await ctx.deployPackage('split-refused-ws', `${PKG}@${VERSION}`);
      const request = splitOf(
        East.function([PricesType, FunctionType([IntegerType], NullType)], NullType, ($, prices, emit) => {
          $.for(prices, ($, price) => {
            $(emit(price));
          });
        }),
        [{ arg: variant('dataset', PRICES_PATH), partition: some({ by: [] }) }],
        variant('array', null),
      );
      await assert.rejects(
        splitCallLaunch(ctx.config.baseUrl, ctx.repoName, 'split-refused-ws',
          { ...request, runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }) }, reader),
        oneShotRefusal('a runner given a platform package'),
      );
    });

    it('a reader explains a split call through its job, which plans the pieces its run cuts and runs no unit', async (t) => {
      const ctx = await withFunctions(t);
      const reader = await ctx.readerOpts();

      await ctx.createWorkspace('split-explain-ws');
      await ctx.deployPackage('split-explain-ws', `${PKG}@${VERSION}`);
      const request = splitOf(emitEachPrice, [PRICES_PIECES], variant('array', null));

      const plan = await splitCallExplain(ctx.config.baseUrl, ctx.repoName, 'split-explain-ws', request, reader);
      assert.equal(plan.over, 0n, 'cut over its one partitioned argument');
      assert.ok(plan.pieces >= 1n, `planned ${plan.pieces} pieces`);
      assert.ok(plan.bytes > 0n, 'and names what that argument weighs');

      // The run takes the pieces up.
      const ran = await splitCall(ctx.config.baseUrl, ctx.repoName, 'split-explain-ws', request, reader);
      assertValue(ran.result, ArrayType(IntegerType), [1n, 2n, 3n]);
    });

    it('a split call is found only through the repository and workspace that launched it', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;

      await ctx.createWorkspace('split-own-ws');
      await ctx.deployPackage('split-own-ws', `${PKG}@${VERSION}`);
      await ctx.createWorkspace('split-other-ws');
      await ctx.deployPackage('split-other-ws', `${PKG}@${VERSION}`);
      const other = `split-jobs-other-${Date.now()}`;
      await repoCreate(base, other, opts);
      t.after(async () => {
        try {
          await repoRemove(base, other, opts);
        } catch {
          // Ignore cleanup errors
        }
      });

      const { id } = await splitCallLaunch(base, ctx.repoName, 'split-own-ws', splitOf(emitEachPrice, [PRICES_PIECES], variant('array', null)), opts);
      // Through another workspace of the repository, and through another
      // repository, it is a job that does not exist.
      for (const [repo, ws] of [[ctx.repoName, 'split-other-ws'], [other, 'split-own-ws']] as const) {
        await assert.rejects(splitCallStatus(base, repo, ws, id, opts), (err: unknown) => {
          assert.ok(err instanceof ApiError, `${repo}/${ws}: expected an ApiError`);
          assert.equal(err.code, 'internal', `${repo}/${ws}`);
          assert.equal((err.details as { message: string }).message, `workspace '${ws}' has no split call '${id}'`);
          return true;
        });
      }

      // Through its own it answers.
      const ended = await splitCallEnded(ctx, 'split-own-ws', id, opts);
      if (ended.type !== 'completed') assert.fail(`the call ended ${ended.type}`);
      assertValue(ended.value.result, ArrayType(IntegerType), [1n, 2n, 3n]);
    });

    it('a reader is refused the poll of a split call only an elevated grant could launch, which its launcher polls', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();
      const reader = await ctx.readerOpts();

      await ctx.createWorkspace('split-elevated-ws');
      await ctx.deployPackage('split-elevated-ws', `${PKG}@${VERSION}`);
      // An admin's call, on a runner given a platform package
      const request = splitOf(emitEachPrice, [PRICES_PIECES], variant('array', null));
      const { id } = await splitCallLaunch(ctx.config.baseUrl, ctx.repoName, 'split-elevated-ws',
        { ...request, runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }) }, opts);

      await assert.rejects(splitCallStatus(ctx.config.baseUrl, ctx.repoName, 'split-elevated-ws', id, reader),
        oneShotRefusal('a reader polling a call on a runner given a platform package'));
      const ended = await splitCallEnded(ctx, 'split-elevated-ws', id, opts);
      if (ended.type !== 'completed') assert.fail(`the call ended ${ended.type}`);
      assertValue(ended.value.result, ArrayType(IntegerType), [1n, 2n, 3n]);
    });

  });
}
