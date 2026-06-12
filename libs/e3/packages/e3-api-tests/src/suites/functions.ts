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
 * runner override, one-shot with value and dataset args, and the
 * "persists nothing" guarantee.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  East,
  IntegerType,
  StringType,
  encodeBeast2For,
  decodeBeast2For,
  encodeEastIR,
  variant,
  some,
  none,
} from '@elaraai/east';
import {
  repoStatus,
  functionList,
  functionDescribe,
  functionCall,
  workspaceFunctionCall,
  oneShotExecute,
  type ExecuteResult,
  type FunctionCallRequest,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createFunctionPackageZip } from '../fixtures.js';

const PKG = 'fn-test-pkg';
const VERSION = '1.0.0';

const encodeInt = encodeBeast2For(IntegerType);
const decodeInt = decodeBeast2For(IntegerType);

function request(args: Uint8Array[], overrides?: Partial<FunctionCallRequest>): FunctionCallRequest {
  return { args, runner: none, limits: none, ...overrides };
}

function successValue(result: ExecuteResult): bigint {
  assert.equal(result.outcome.type, 'success', `expected success, got ${result.outcome.type}: ${result.stderr}`);
  return decodeInt((result.outcome.value as { value: Uint8Array }).value);
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

    it('sync call computes inline and persists nothing', async (t) => {
      const ctx = await withFunctions(t);
      const opts = await ctx.opts();

      const before = await repoStatus(ctx.config.baseUrl, ctx.repoName, opts);

      const result = await functionCall(
        ctx.config.baseUrl, ctx.repoName, PKG, VERSION, 'add',
        request([encodeInt(2n), encodeInt(3n)]),
        opts
      );
      assert.equal(successValue(result), 5n);

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
      // The decode failure's diagnostic lands on stderr on POSIX; on Windows
      // the runner's .cmd shim doesn't reliably propagate it (no pre-existing
      // Windows test asserts stderr CONTENT, only exit codes — same here).
      if (process.platform !== 'win32') {
        assert.ok(result.stderr.length > 0, 'expected a runtime diagnostic on stderr');
      }
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

  });
}
