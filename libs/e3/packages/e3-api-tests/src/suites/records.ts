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

import { IntegerType, encodeBeast2For, decodeBeast2For, variant, some, none } from '@elaraai/east';
import {
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  datasetGet,
  workspaceRecordDescribe,
  workspaceRecordMutate,
  workspaceRecordCompact,
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

    it('compact resets history to a $compact root, state preserved', async (t) => {
      const ctx = await withRecords(t);
      const opts = await ctx.opts();

      await workspaceRecordMutate(
        ctx.config.baseUrl, ctx.repoName, WS, 'counter', 'increment',
        { args: [encodeInt(4n)], actor: none, limits: none }, opts,
      );
      assert.equal((await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'counter', undefined, opts)).commits.length, 2);

      const compacted = await workspaceRecordCompact(ctx.config.baseUrl, ctx.repoName, WS, 'counter', opts);
      assert.equal(compacted.outcome.type, 'committed', `expected committed, got ${compacted.outcome.type}`);

      const { commits } = await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'counter', undefined, opts);
      assert.equal(commits.length, 1);
      assert.equal(commits[0]!.mutation, '$compact');
      assert.equal(await readCounter(ctx), 4n); // state unchanged
    });

    // The compare-and-swap is the contract a remote backend (e.g. the cloud's
    // DynamoDB conditional write) must satisfy. Exercising it here — not only in
    // the local e3-core unit tests — is what keeps that backend honest: a broken
    // conditional write would surface as a lost update or a forked chain below.
    it('converges N concurrent mutations into a single linear chain with no lost updates', async (t) => {
      const ctx = await withRecords(t);
      const opts = await ctx.opts();

      const N = 5;
      const results = await Promise.all(
        Array.from({ length: N }, () => workspaceRecordMutate(
          ctx.config.baseUrl, ctx.repoName, WS, 'counter', 'increment',
          { args: [encodeInt(1n)], actor: none, limits: none }, opts,
        )),
      );
      assert.ok(results.every((r) => r.outcome.type === 'committed'),
        `every racing mutation must commit, got ${results.map((r) => r.outcome.type).join(',')}`);

      // No lost updates: every +1 landed.
      assert.equal(await readCounter(ctx), BigInt(N));

      // No forks: genesis + N commits, newest-first, each parent pointing at the
      // next commit's hash — a single unbroken chain.
      const { commits } = await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'counter', undefined, opts);
      assert.equal(commits.length, N + 1);
      assert.equal(commits[commits.length - 1]!.mutation, '$init');
      assert.equal(commits[commits.length - 1]!.parent.type, 'none');
      for (let i = 0; i < commits.length - 1; i++) {
        assert.equal(commits[i]!.parent.type, 'some');
        assert.equal((commits[i]!.parent as { value: string }).value, commits[i + 1]!.hash,
          'each commit links to its predecessor — no fork');
      }
    });

    // Records version by COMMIT hash, not state hash, so a mutation that leaves
    // the state byte-identical must still append a commit and advance the
    // version (otherwise a downstream consumer would miss the change — ABA).
    it('appends a commit even when the new state is identical (no ABA)', async (t) => {
      const ctx = await withRecords(t);
      const opts = await ctx.opts();

      const result = await workspaceRecordMutate(
        ctx.config.baseUrl, ctx.repoName, WS, 'counter', 'increment',
        { args: [encodeInt(0n)], actor: none, limits: none }, opts, // +0 → same state
      );
      assert.equal(result.outcome.type, 'committed');
      assert.equal(await readCounter(ctx), 0n); // state unchanged…

      const { commits } = await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'counter', undefined, opts);
      assert.equal(commits.length, 2); // …yet the chain advanced
      assert.equal(commits[0]!.mutation, 'increment');
      assert.notEqual(commits[0]!.hash, commits[1]!.hash);
    });

    it('records the client-supplied actor on the commit, defaulting to "api"', async (t) => {
      const ctx = await withRecords(t);
      const opts = await ctx.opts();

      await workspaceRecordMutate(
        ctx.config.baseUrl, ctx.repoName, WS, 'counter', 'increment',
        { args: [encodeInt(1n)], actor: some('cli:bob'), limits: none }, opts,
      );
      await workspaceRecordMutate(
        ctx.config.baseUrl, ctx.repoName, WS, 'counter', 'increment',
        { args: [encodeInt(1n)], actor: none, limits: none }, opts,
      );

      const { commits } = await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'counter', undefined, opts);
      assert.equal(commits[0]!.actor, 'api'); // no actor → server default
      assert.equal(commits[1]!.actor, 'cli:bob'); // honoured when unauthenticated
    });

    it('pages history with a from cursor and a limit, and ends on an unknown cursor', async (t) => {
      const ctx = await withRecords(t);
      const opts = await ctx.opts();

      for (let i = 0; i < 3; i++) {
        await workspaceRecordMutate(
          ctx.config.baseUrl, ctx.repoName, WS, 'counter', 'increment',
          { args: [encodeInt(1n)], actor: none, limits: none }, opts,
        );
      }

      // Whole chain: genesis + 3.
      const all = (await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'counter', undefined, opts)).commits;
      assert.equal(all.length, 4);

      // First page of 2 (newest-first).
      const page1 = (await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'counter', 2, opts)).commits;
      assert.deepEqual(page1.map((c) => c.hash), all.slice(0, 2).map((c) => c.hash));

      // Resume from the 3rd commit's hash — a contiguous continuation.
      const page2 = (await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'counter', 2, opts, all[2]!.hash)).commits;
      assert.deepEqual(page2.map((c) => c.hash), all.slice(2).map((c) => c.hash));

      // An unknown cursor terminates the walk gracefully (empty, not an error).
      const unknown = (await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'counter', undefined, opts, 'f'.repeat(64))).commits;
      assert.equal(unknown.length, 0);
    });
  });
}
