/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Record mutation + history test suite.
 *
 * Exercises the record write path end-to-end against a real server + real
 * east-node runner: describe, deploy genesis, committed mutations (with the
 * state readable back), arity/unknown rejection, a reducer that aborts, and
 * the commit history.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { IntegerType, encodeBeast2For, decodeBeast2For, variant, none } from '@elaraai/east';
import {
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  datasetGet,
  workspaceRecordDescribe,
  workspaceRecordMutate,
  workspaceRecordHistory,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createRecordPackageZip } from '../fixtures.js';

const PKG = 'record-test-pkg';
const VERSION = '1.0.0';
const WS = 'record-ws';

const encodeInt = encodeBeast2For(IntegerType);
const decodeInt = decodeBeast2For(IntegerType);
const counterPath = [variant('field', 'records'), variant('field', 'counter')];

/** Read the counter record's current state over the API. */
async function readCounter(ctx: TestContext): Promise<bigint> {
  const opts = await ctx.opts();
  const { data } = await datasetGet(ctx.config.baseUrl, ctx.repoName, WS, counterPath, opts);
  return decodeInt(data as Uint8Array);
}

export function recordTests(setup: TestSetup<TestContext>): void {
  const withRecords: TestSetup<TestContext> = async (t) => {
    const ctx = await setup(t);
    const opts = await ctx.opts();
    const zipPath = await createRecordPackageZip(ctx.tempDir, PKG, VERSION);
    await packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(zipPath), opts);
    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, WS, opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, WS, `${PKG}@${VERSION}`, opts);
    return ctx;
  };

  describe('records', { concurrency: false }, () => {
    it('describe returns the record mutations', async (t) => {
      const ctx = await withRecords(t);
      const opts = await ctx.opts();

      const sig = await workspaceRecordDescribe(ctx.config.baseUrl, ctx.repoName, WS, 'counter', opts);
      assert.equal(sig.name, 'counter');
      const names = sig.mutations.map((m) => m.name).sort();
      assert.deepEqual(names, ['add_positive', 'increment']);
      assert.equal(sig.mutations.find((m) => m.name === 'increment')!.argTypes.length, 1);
    });

    it('deploy mints a $init genesis and the initial state', async (t) => {
      const ctx = await withRecords(t);
      const opts = await ctx.opts();

      assert.equal(await readCounter(ctx), 0n);
      const { commits } = await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'counter', undefined, opts);
      assert.equal(commits.length, 1);
      assert.equal(commits[0]!.mutation, '$init');
    });

    it('a committed mutation advances state and appends a commit', async (t) => {
      const ctx = await withRecords(t);
      const opts = await ctx.opts();

      const result = await workspaceRecordMutate(
        ctx.config.baseUrl, ctx.repoName, WS, 'counter', 'increment',
        { args: [encodeInt(5n)], actor: none, limits: none }, opts,
      );
      assert.equal(result.outcome.type, 'committed', `expected committed, got ${result.outcome.type}`);
      assert.equal(await readCounter(ctx), 5n);

      const { commits } = await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'counter', undefined, opts);
      assert.equal(commits.length, 2);
      assert.equal(commits[0]!.mutation, 'increment'); // newest first
    });

    it('rejects an arity mismatch without writing', async (t) => {
      const ctx = await withRecords(t);
      const opts = await ctx.opts();

      const result = await workspaceRecordMutate(
        ctx.config.baseUrl, ctx.repoName, WS, 'counter', 'increment',
        { args: [], actor: none, limits: none }, opts,
      );
      assert.equal(result.outcome.type, 'invalid');
      assert.equal(await readCounter(ctx), 0n);
    });

    it('an aborting reducer fails and writes nothing', async (t) => {
      const ctx = await withRecords(t);
      const opts = await ctx.opts();

      const result = await workspaceRecordMutate(
        ctx.config.baseUrl, ctx.repoName, WS, 'counter', 'add_positive',
        { args: [encodeInt(-5n)], actor: none, limits: none }, opts,
      );
      assert.equal(result.outcome.type, 'failed', `expected failed, got ${result.outcome.type}`);
      assert.equal(await readCounter(ctx), 0n);
      const { commits } = await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'counter', undefined, opts);
      assert.equal(commits.length, 1); // only $init
    });

    it('unknown mutation is invalid', async (t) => {
      const ctx = await withRecords(t);
      const opts = await ctx.opts();

      const result = await workspaceRecordMutate(
        ctx.config.baseUrl, ctx.repoName, WS, 'counter', 'nope',
        { args: [], actor: none, limits: none }, opts,
      );
      assert.equal(result.outcome.type, 'invalid');
    });
  });
}
