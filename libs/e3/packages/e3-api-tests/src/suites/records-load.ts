/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Record load test suite (§7.11, rulings 26 and 28): a delivery loaded into a
 * composite record's external source, as a job over the API. The job answers
 * what the load did; the record holds the delivery's orders beside its own;
 * its history names the load; and the source waits no more. The same delivery
 * again is answered by the commit that applied it, and an older one is
 * superseded. A cancel asks, and the job ends itself: cancelled with nothing
 * loaded, or completed once its commit wrote (R85). Where the host does not
 * grant a load it is refused `permission_denied`, naming it (R86). A load the
 * workspace cannot take fails, saying why, and loads nothing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DateTimeType, OptionType, SortedMap, StringType, compareFor, decodeBeast2For, equalFor, none, printFor, some, variant, type ValueTypeOf,
} from '@elaraai/east';
import { RecordLoadResultType, type RecordLoadRequest, type RecordLoadResult, type RecordLoadStatus } from '@elaraai/e3-types';
import {
  ApiError, datasetGet, objectUpload, workspaceRecordHistory, workspaceRecordLoad, workspaceRecordLoadCancel, workspaceRecordLoadLaunch,
  workspaceRecordLoadStatus, type RequestOptions,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { COMPOSITE_ORDERS_PATH, CompositeOrderKeyType, CompositeOrdersType } from '../fixtures.js';
import { LOAD_WS, deployLoadedOrders, erpDelivery, erpWaits, type ErpOrder } from './object-upload.js';

const decodeOrders = decodeBeast2For(CompositeOrdersType);
const sameOrders = equalFor(CompositeOrdersType);
const printOrders = printFor(CompositeOrdersType);
const byKey = compareFor(CompositeOrderKeyType);
const sameCommit = equalFor(OptionType(StringType));
const sameTime = equalFor(DateTimeType);
const printResult = printFor(RecordLoadResultType);

const ACME: ErpOrder = { customer: 'Acme', qty: 5n };
const BIRCH: ErpOrder = { customer: 'Birch', qty: 2n };
const CEDAR: ErpOrder = { customer: 'Cedar', qty: 7n };

/** The record's state once the ERP's orders are these: theirs, and the solution's own `P-1`. */
function holding(erp: ReadonlyArray<readonly [string, ErpOrder]>): ValueTypeOf<typeof CompositeOrdersType> {
  type Key = ValueTypeOf<typeof CompositeOrderKeyType>;
  const entries: Array<[Key, ErpOrder]> = erp.map(([id, row]): [Key, ErpOrder] => [variant('erp', id), row]);
  entries.push([variant('own', 'P-1'), BIRCH]);
  return new SortedMap<Key, ErpOrder>(entries, byKey);
}

/** A request to load a delivery, by its hash, with the as-of it says. */
function request(delivery: string, asOf?: Date): RecordLoadRequest {
  return { delivery, actor: none, asOf: asOf === undefined ? none : some(asOf) };
}

/** The as-of of the first delivery, and of an older one. */
const LATER = new Date('2026-11-02T03:00:00.000Z');
const EARLIER = new Date('2026-11-01T03:00:00.000Z');

/**
 * Register the record load tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function recordLoadTests(setup: TestSetup<TestContext>): void {
  /** Uploads a delivery of these orders, answering its hash. */
  const upload = async (ctx: TestContext, orders: ReadonlyArray<readonly [string, ErpOrder]>): Promise<string> =>
    objectUpload(ctx.config.baseUrl, ctx.repoName, LOAD_WS, erpDelivery(orders), await ctx.opts());
  /** A load of a delivery into `orders.erp`, or another source, followed to its end. */
  const load = async (ctx: TestContext, asked: RecordLoadRequest, opts?: RequestOptions, source = 'erp', record = 'orders'): Promise<RecordLoadResult> =>
    workspaceRecordLoad(ctx.config.baseUrl, ctx.repoName, LOAD_WS, record, source, asked, opts ?? await ctx.opts());
  /** The record's commits, newest first, by name. */
  const chain = async (ctx: TestContext): Promise<string[]> =>
    (await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, LOAD_WS, 'orders', undefined, await ctx.opts())).commits.map((commit) => commit.mutation);
  /** Asserts the record holds these orders of the ERP's, beside its own. */
  const holds = async (ctx: TestContext, erp: ReadonlyArray<readonly [string, ErpOrder]>): Promise<void> => {
    const { data } = await datasetGet(ctx.config.baseUrl, ctx.repoName, LOAD_WS, COMPOSITE_ORDERS_PATH, await ctx.opts());
    const held = decodeOrders(data);
    assert.ok(sameOrders(held, holding(erp)), `the record holds ${printOrders(held)}`);
  };
  /** A load's job followed from how it stood to its end. */
  const ended = async (ctx: TestContext, id: string, from: RecordLoadStatus): Promise<RecordLoadStatus> => {
    let status = from;
    while (status.type === 'processing') {
      await new Promise((resolve) => setTimeout(resolve, 50));
      status = await workspaceRecordLoadStatus(ctx.config.baseUrl, ctx.repoName, LOAD_WS, 'orders', 'erp', id, await ctx.opts());
    }
    return status;
  };

  describe('record loads', { concurrency: false }, () => {
    it('a delivery loads into orders.erp as a job: it answers what it did, the record holds the delivery beside its own orders, its history names the load, and the source waits no more', async (t) => {
      const ctx = await setup(t);
      await deployLoadedOrders(ctx);
      const orders = [['SO-1001', ACME], ['SO-1002', CEDAR]] as const;
      const delivery = await upload(ctx, orders);

      const loaded = await load(ctx, request(delivery));
      assert.ok(loaded.outcome.type === 'loaded' && loaded.commit.type === 'some', `the load answered ${printResult(loaded)}`);
      assert.deepEqual([loaded.set, loaded.deleted, loaded.unchanged], [2n, 0n, 0n]);
      await holds(ctx, orders);
      const { commits } = await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, LOAD_WS, 'orders', undefined, await ctx.opts());
      assert.deepEqual(commits.map((commit) => commit.mutation), ['$load:erp', '$init']);
      assert.equal(commits[0]!.hash, loaded.commit.value, 'the commit it answered is the history\'s');
      assert.equal(await erpWaits(ctx), false, 'the source has delivered');
    });

    it('R10, R11 — the same delivery again is answered by the commit that applied it, and one older than the source\'s as-of is superseded; neither commits', async (t) => {
      const ctx = await setup(t);
      await deployLoadedOrders(ctx);
      const delivery = await upload(ctx, [['SO-1001', ACME]]);
      const first = await load(ctx, request(delivery, LATER));

      const again = await load(ctx, request(delivery));
      assert.equal(again.outcome.type, 'again');
      assert.ok(sameCommit(again.commit, first.commit), 'answered by the commit that applied it');
      const superseded = await load(ctx, request(await upload(ctx, [['SO-1001', BIRCH]]), EARLIER));
      assert.ok(superseded.outcome.type === 'superseded' && sameTime(superseded.outcome.value, LATER), `naming the source's as-of: ${printResult(superseded)}`);
      assert.deepEqual(await chain(ctx), ['$load:erp', '$init'], 'nothing more committed');
      await holds(ctx, [['SO-1001', ACME]]);
    });

    it('R85 — a cancel asks, and the job ends itself: cancelled with nothing loaded, or completed once its commit wrote; asked again, it is answered as the job ended', async (t) => {
      const ctx = await setup(t);
      await deployLoadedOrders(ctx);
      const opts = await ctx.opts();
      const orders = [['SO-8501', ACME]] as const;
      const { id } = await workspaceRecordLoadLaunch(ctx.config.baseUrl, ctx.repoName, LOAD_WS, 'orders', 'erp', request(await upload(ctx, orders)), opts);

      // Asked at once: where the job has got by then is the server's, so either end is right, each with what it says
      const end = await ended(ctx, id, await workspaceRecordLoadCancel(ctx.config.baseUrl, ctx.repoName, LOAD_WS, 'orders', 'erp', id, opts));
      if (end.type === 'cancelled') {
        assert.deepEqual(await chain(ctx), ['$init'], 'cancelled: nothing committed');
        assert.equal(await erpWaits(ctx), true, 'and the source still waits');
      } else {
        assert.ok(end.type === 'completed' && end.value.outcome.type === 'loaded', `the cancel came too late, and the load landed: ${end.type}`);
        assert.deepEqual(await chain(ctx), ['$load:erp', '$init']);
        await holds(ctx, orders);
      }
      const again = await workspaceRecordLoadCancel(ctx.config.baseUrl, ctx.repoName, LOAD_WS, 'orders', 'erp', id, opts);
      assert.equal(again.type, end.type, 'a cancel after its end is answered as it ended');
    });

    it('R86 — a reader loads where the host grants it, and is refused permission_denied, naming orders.erp, where it does not, with nothing loaded', async (t) => {
      const ctx = await setup(t);
      await deployLoadedOrders(ctx);
      const delivery = await upload(ctx, [['SO-8601', CEDAR]]);
      const reader = await ctx.readerOpts();

      let refused = false;
      try {
        assert.equal((await load(ctx, request(delivery), reader)).outcome.type, 'loaded', 'a reader the host grants a load loads');
      } catch (err) {
        assert.ok(err instanceof ApiError && err.code === 'permission_denied', `refused, or loaded: ${String(err)}`);
        assert.equal((err.details as { path: string }).path, 'orders.erp', 'the refusal names the load');
        refused = true;
      }
      if (refused) {
        assert.deepEqual(await chain(ctx), ['$init'], 'refused: nothing committed');
        assert.equal(await erpWaits(ctx), true);
      } else {
        await holds(ctx, [['SO-8601', CEDAR]]);
      }
    });

    it('a load into a source the solution writes, or into a record or source the workspace does not hold, fails, saying why, and loads nothing', async (t) => {
      const ctx = await setup(t);
      await deployLoadedOrders(ctx);
      const delivery = await upload(ctx, [['SO-1001', ACME]]);
      for (const [record, source, words] of [
        ['orders', 'own', 'source \'own\' of record \'orders\' is the solution\'s: its mutations write it, and no delivery is loaded into it'],
        ['nope', 'erp', 'record \'nope\' not found'],
        ['orders', 'ftp', 'record \'orders\' has no source \'ftp\''],
      ] as const) {
        await assert.rejects(load(ctx, request(delivery), undefined, source, record), { message: words });
      }
      assert.deepEqual(await chain(ctx), ['$init'], 'nothing committed');
    });

    it('R22 — a delivery the repository does not hold fails the load, naming it', async (t) => {
      const ctx = await setup(t);
      await deployLoadedOrders(ctx);
      const gone = 'f'.repeat(64);
      await assert.rejects(load(ctx, request(gone)), { message: `delivery ${gone} is not in the repository: upload it again` });
      assert.equal(await erpWaits(ctx), true);
    });

    it('a load is found only through the workspace, record and source that launched it', async (t) => {
      const ctx = await setup(t);
      await deployLoadedOrders(ctx);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;
      const launched = await workspaceRecordLoadLaunch(base, ctx.repoName, LOAD_WS, 'orders', 'erp', request(await upload(ctx, [['SO-1001', ACME]])), opts);
      for (const [ws, source] of [[LOAD_WS, 'own'], ['other-ws', 'erp']] as const) {
        await assert.rejects(workspaceRecordLoadStatus(base, ctx.repoName, ws, 'orders', source, launched.id, opts),
          (err: unknown) => err instanceof ApiError && err.code === 'internal');
      }
      const end = await ended(ctx, launched.id, await workspaceRecordLoadStatus(base, ctx.repoName, LOAD_WS, 'orders', 'erp', launched.id, opts));
      assert.equal(end.type, 'completed', 'through its own, it is found, and ends');
    });
  });
}
