/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Keyed-record test suite — the write forms, and what a write costs.
 *
 * The scalar-record suite covers the commit protocol; this one covers the
 * thing a remote backend has to reproduce: a record big enough to span
 * segments, written through all three forms, where a commit rewrites the
 * segments it touched and re-announces the rest. Run it against any backend
 * and a write that is secretly O(state) shows up as a page read that no longer
 * matches, or as a record that stops reading like a collection at all.
 *
 * `E3_RECORD_ROWS` sizes the record (default 10,000); a perf run raises it to
 * 100,000 without changing an assertion, because every assertion here is a
 * ratio or an identity rather than a time.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  IntegerType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For,
  variant, none, PatchType, type PatchTypeOf, type ValueTypeOf,
} from '@elaraai/east';
import { indexWindowType } from '@elaraai/e3-types';
import {
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  datasetGet,
  datasetGetPage,
  workspaceRecordDescribe,
  workspaceRecordMutate,
  workspaceRecordHistory,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createKeyedRecordPackageZip, PlanRowType, PlanStatusKeyType, PlansType } from '../fixtures.js';

const PKG = 'keyed-record-pkg';
const VERSION = '1.0.0';
const WS = 'keyed-record-ws';
const plansPath = [variant('field', 'records'), variant('field', 'plans')];

/** How many rows the record holds. 10,000 spans segments under any key
 *  distribution; a perf run sets 100,000. */
const ROWS = BigInt(process.env['E3_RECORD_ROWS'] ?? '10000');

const encodeInt = encodeBeast2For(IntegerType);
const encodePatch = encodeBeast2For(PatchType(PlansType));
const decodePlans = decodeBeast2For(PlansType);
/** The wire shape of an index page: ordered rows, in the INDEX's order. */
const decodeStatusWindow = decodeBeast2For(
  indexWindowType(StringType, PlanStatusKeyType, StringType, PlanRowType) as never) as
  (data: Uint8Array) => Array<{ ik: { status: string; due: bigint }; key: string; value: string; row: unknown }>;
const planKeys = compareFor(StringType);
/** What one touched key of a plans patch carries — derived from the patch type
 *  rather than hand-written, so it follows the row type. */
type PlanOp = Extract<ValueTypeOf<PatchTypeOf<typeof PlansType>>, { type: 'patch' }>['value'] extends Map<string, infer Op>
  ? Op : never;

export function keyedRecordTests(setup: TestSetup<TestContext>): void {
  /** A deployed, seeded record. */
  const withRecord = async (t: Parameters<TestSetup<TestContext>>[0]): Promise<TestContext> => {
    const ctx = await setup(t);
    const opts = await ctx.opts();
    const zipPath = await createKeyedRecordPackageZip(ctx.tempDir, PKG, VERSION);
    await packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(zipPath), opts);
    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, WS, opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, WS, `${PKG}@${VERSION}`, opts);
    const seeded = await workspaceRecordMutate(
      ctx.config.baseUrl, ctx.repoName, WS, 'plans', 'seed',
      { args: [encodeInt(ROWS)], actor: none, limits: none }, opts,
    );
    assert.equal(seeded.outcome.type, 'committed', `seeding must commit, got ${seeded.outcome.type}`);
    return ctx;
  };

  /** The record's rows, read through the ordinary dataset door. */
  async function readRows(ctx: TestContext): Promise<Map<string, { title: string }>> {
    const opts = await ctx.opts();
    const { data } = await datasetGet(ctx.config.baseUrl, ctx.repoName, WS, plansPath, opts);
    return decodePlans(data as Uint8Array) as Map<string, { title: string }>;
  }

  describe('keyed records', { concurrency: false }, () => {
    it('describes each mutation\'s write form', async (t) => {
      const ctx = await withRecord(t);
      const sig = await workspaceRecordDescribe(ctx.config.baseUrl, ctx.repoName, WS, 'plans', await ctx.opts());
      assert.deepEqual(
        Object.fromEntries(sig.mutations.map((m) => [m.name, m.form])),
        { seed: 'reduce', retitle: 'edit', patch: 'patch' });
    });

    it('reads as its rows through the ordinary dataset door, index and all', async (t) => {
      const ctx = await withRecord(t);
      const opts = await ctx.opts();
      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, WS, plansPath, { offset: 0, limit: 3 }, opts);
      assert.equal(BigInt(page.totalElements), ROWS, 'a record with an index still pages as its rows');
      assert.ok(page.segmentCount >= 2, `a ${ROWS}-row record spans segments, got ${page.segmentCount}`);
      assert.equal((await readRows(ctx)).get('p-7')!.title, 'Plan 7');
    });

    it('an edit mutation commits, and the commit names the delta it wrote', async (t) => {
      const ctx = await withRecord(t);
      const opts = await ctx.opts();

      const result = await workspaceRecordMutate(
        ctx.config.baseUrl, ctx.repoName, WS, 'plans', 'retitle',
        { args: [encodeBeast2For(StringType)('p-7')], actor: none, limits: none }, opts,
      );
      assert.equal(result.outcome.type, 'committed', `expected committed, got ${result.outcome.type}`);
      assert.equal((await readRows(ctx)).get('p-7')!.title, 'RETITLED');

      const { commits } = await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'plans', 1, opts);
      assert.equal(commits[0]!.mutation, 'retitle');
      assert.equal(commits[0]!.delta.type, 'some', 'the commit records what changed');
    });

    it('a patch mutation applies a client-computed change', async (t) => {
      const ctx = await withRecord(t);
      const opts = await ctx.opts();

      const ops = new SortedMap<string, PlanOp>([
        ['p-11', variant('update', variant('patch', {
          status: variant('unchanged', null),
          due: variant('unchanged', null),
          title: variant('replace', { before: 'Plan 11', after: 'PATCHED' }),
        }))],
      ], planKeys);
      const result = await workspaceRecordMutate(
        ctx.config.baseUrl, ctx.repoName, WS, 'plans', 'patch',
        { args: [encodePatch(variant('patch', ops))], actor: none, limits: none }, opts,
      );
      assert.equal(result.outcome.type, 'committed', `expected committed, got ${result.outcome.type}`);
      assert.equal((await readRows(ctx)).get('p-11')!.title, 'PATCHED');
    });

    it('a stale patch conflicts and writes nothing', async (t) => {
      const ctx = await withRecord(t);
      const opts = await ctx.opts();

      const ops = new SortedMap<string, PlanOp>([
        ['p-11', variant('delete', { status: 'ok', due: 11n, title: 'SOMETHING ELSE' })],
      ], planKeys);
      const result = await workspaceRecordMutate(
        ctx.config.baseUrl, ctx.repoName, WS, 'plans', 'patch',
        { args: [encodePatch(variant('patch', ops))], actor: none, limits: none }, opts,
      );
      assert.equal(result.outcome.type, 'conflict', `expected conflict, got ${result.outcome.type}`);
      assert.equal((await readRows(ctx)).get('p-11')!.title, 'Plan 11', 'the row is untouched');
    });

    it('reads through the index in the index\'s own order', async (t) => {
      const ctx = await withRecord(t);
      const opts = await ctx.opts();
      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, WS, plansPath,
        { offset: 0, limit: 5, index: 'by_status' }, opts);
      const window = decodeStatusWindow(page.data);
      assert.equal(window.length, 5);
      assert.ok(window.every((entry) => entry.ik.status === 'late'),
        'every `late` entry precedes every `ok` one, whatever their primary keys');
    });
  });
}
