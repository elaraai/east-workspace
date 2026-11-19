/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Record loads beside edits (ruling 55): a composite record loaded and edited
 * at once, as it is in use. People save edits to the parts of a record the
 * solution writes while deliveries load into the parts a load writes, the
 * loads of different lengths and at different rhythms, the edits steady and in
 * bursts. Every load and every edit lands, each source holds its last
 * delivery, a load keeps no edit waiting for it, and the record's index holds
 * an entry for each row and no other.
 *
 * The cases come from a practical run of the same things by hand, with real
 * commands in separate processes. Each drives the API alone, so a server runs
 * them whatever runs its loads; and each sizes what it does by what the
 * server did, never by a time, so a slow server runs the same cases.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PatchType, SortedMap, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, variant, type ValueTypeOf,
} from '@elaraai/east';
import type { MutationResult, RecordLoadRequest, RecordLoadResult, RecordLoadStatus } from '@elaraai/e3-types';
import {
  datasetGet, objectUpload, workspaceFunctionCall, workspaceRecordDescribe, workspaceRecordHistory, workspaceRecordLoad,
  workspaceRecordLoadCancel, workspaceRecordLoadLaunch, workspaceRecordLoadStatus, workspaceRecordMutate,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { COMPOSITE_ORDERS_PATH, YardByCustomerType, YardKeyType, YardOrdersType, createYardPackageZip } from '../fixtures.js';
import { erpDelivery, type ErpOrder } from './object-upload.js';

const PKG = 'yard-pkg';
const WS = 'yard-ws';

type YardKey = ValueTypeOf<typeof YardKeyType>;
type YardOrders = ValueTypeOf<typeof YardOrdersType>;
/** A source of the yard's record: one a delivery loads, or one its `patch` door writes. */
type LoadedSource = 'erp' | 'wms';
type EditedSource = 'own' | 'notes';

const YardPatchType = PatchType(YardOrdersType);
const encodePatch = encodeBeast2For(YardPatchType);
const decodeOrders = decodeBeast2For(YardOrdersType);
const decodeIndex = decodeBeast2For(YardByCustomerType);
const byKey = compareFor(YardKeyType);
const sameKey = equalFor(YardKeyType);
const sameOrders = equalFor(YardOrdersType);
const sameIndex = equalFor(YardByCustomerType);
const byIndexKey = compareFor(YardByCustomerType.key);

/** How many orders a long load's delivery holds: enough that edits are saved while it runs. */
const LONG = 60_000;
/** How many a load of middling length holds. */
const MIDDLING = 15_000;
/** How many a short one holds. */
const SHORT = 400;

/**
 * A source's whole order book: `count` orders, each for one of 97 customers.
 *
 * @param count - How many orders
 * @param round - Which delivery of the source this is: every order's quantity differs from the round before
 * @returns The orders, by the source's own id, in the ids' order
 */
function book(count: number, round: number): Array<readonly [string, ErpOrder]> {
  return Array.from({ length: count }, (_, i): readonly [string, ErpOrder] =>
    [`K-${String(i).padStart(8, '0')}`, { customer: `C-${String(i % 97).padStart(3, '0')}`, qty: BigInt((i % 50) + round * 100) }]);
}

/** An edit's row: an order for one of nine customers. */
const edited = (n: number): ErpOrder => ({ customer: `C-90${n % 9}`, qty: BigInt(n) });

/**
 * Register the tests of record loads beside edits.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function recordLoadEditTests(setup: TestSetup<TestContext>): void {
  /** A workspace of the yard fixture, deployed fresh: both loaded sources wait, and both edited ones are empty. */
  const deployYard = async (ctx: TestContext): Promise<void> => {
    await ctx.importPackage(await createYardPackageZip(ctx.tempDir, PKG, '1.0.0'));
    await ctx.createWorkspace(WS);
    await ctx.deployPackage(WS, `${PKG}@1.0.0`);
  };
  /** Uploads a delivery of these orders, answering the request that loads it. */
  const delivered = async (ctx: TestContext, orders: ReadonlyArray<readonly [string, ErpOrder]>): Promise<RecordLoadRequest> =>
    ({ delivery: await objectUpload(ctx.config.baseUrl, ctx.repoName, WS, erpDelivery(orders), await ctx.opts()), actor: none, asOf: none });
  /** A load of a delivery into a source, followed to its end. */
  const load = async (ctx: TestContext, source: LoadedSource, asked: RecordLoadRequest): Promise<RecordLoadResult> =>
    workspaceRecordLoad(ctx.config.baseUrl, ctx.repoName, WS, 'orders', source, asked, await ctx.opts());
  /** A load's job, started. */
  const launch = async (ctx: TestContext, source: LoadedSource, asked: RecordLoadRequest): Promise<string> =>
    (await workspaceRecordLoadLaunch(ctx.config.baseUrl, ctx.repoName, WS, 'orders', source, asked, await ctx.opts())).id;
  /** How a load's job stands. */
  const status = async (ctx: TestContext, source: LoadedSource, id: string): Promise<RecordLoadStatus> =>
    workspaceRecordLoadStatus(ctx.config.baseUrl, ctx.repoName, WS, 'orders', source, id, await ctx.opts());
  /** A load's job followed to its end. */
  const ended = async (ctx: TestContext, source: LoadedSource, id: string): Promise<RecordLoadStatus> => {
    for (;;) {
      const now = await status(ctx, source, id);
      if (now.type !== 'processing') return now;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  /** Saves one order of a source the solution writes, through the record's `patch` door. */
  const save = async (ctx: TestContext, source: EditedSource, id: string, row: ErpOrder): Promise<MutationResult> => {
    const key: YardKey = variant(source, id);
    const patch = variant('patch', new SortedMap([[key, variant('insert', row)]], byKey));
    return workspaceRecordMutate(ctx.config.baseUrl, ctx.repoName, WS, 'orders', 'patch',
      { args: [encodePatch(patch as ValueTypeOf<typeof YardPatchType>)], actor: none, limits: none }, await ctx.opts());
  };
  /** The record, read whole. */
  const held = async (ctx: TestContext): Promise<YardOrders> =>
    decodeOrders((await datasetGet(ctx.config.baseUrl, ctx.repoName, WS, COMPOSITE_ORDERS_PATH, await ctx.opts())).data);
  /** The record's commits, newest first, by name. */
  const chain = async (ctx: TestContext): Promise<string[]> =>
    (await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'orders', undefined, await ctx.opts())).commits.map((commit) => commit.mutation);
  /** How many commits of a name the record's history holds. */
  const count = (commits: readonly string[], name: string): number => commits.filter((commit) => commit === name).length;

  /**
   * Asserts what the record holds once the loads and the edits have ended:
   * each loaded source its last delivery, every edit saved, and nothing else;
   * and that its index holds an entry for each row, under the row's customer.
   *
   * @param ctx - The test's context
   * @param books - The last delivery of each loaded source
   * @param edits - Every order saved, with the source it was saved under and its id
   */
  const holdsWithItsIndex = async (
    ctx: TestContext,
    books: Readonly<Record<LoadedSource, ReadonlyArray<readonly [string, ErpOrder]>>>,
    edits: ReadonlyArray<readonly [EditedSource, string, ErpOrder]>,
  ): Promise<void> => {
    const entries: Array<[YardKey, ErpOrder]> = [];
    for (const source of ['erp', 'wms'] as const) for (const [id, row] of books[source]) entries.push([variant(source, id), row]);
    for (const [source, id, row] of edits) entries.push([variant(source, id), row]);
    const expected: YardOrders = new SortedMap(entries, byKey);
    const record = await held(ctx);
    if (!sameOrders(record, expected)) {
      // Named by what differs: the record is tens of thousands of rows
      const strays = [...record.keys()].filter((key) => !expected.has(key)).slice(0, 3);
      const missing = [...expected.keys()].filter((key) => !record.has(key)).slice(0, 3);
      const sources = (['erp', 'notes', 'own', 'wms'] as const).map((source) =>
        `${source} ${[...record.keys()].filter((key) => sameKey(variant(source, key.value), key)).length}`);
      assert.fail(`the record holds ${record.size} orders (${sources.join(', ')}) where ${expected.size} were loaded and saved: ` +
        `${missing.length} it lacks, as ${JSON.stringify(missing)}; ${strays.length} of no delivery or edit, as ${JSON.stringify(strays)}`);
    }

    const answer = await workspaceFunctionCall(ctx.config.baseUrl, ctx.repoName, WS, 'customer_index',
      { args: [], runner: none, limits: none, drafts: [] }, await ctx.opts());
    if (answer.outcome.type !== 'success') assert.fail(`the index could not be read: ${answer.outcome.type}: ${answer.stderr}`);
    const index = decodeIndex(answer.outcome.value.value);
    const rows = new SortedMap([...record].map(([key, row]): [{ ik: string; k: YardKey }, null] => [{ ik: row.customer, k: key }, null]), byIndexKey);
    assert.ok(sameIndex(index, rows), `the index holds ${index.size} entries for the record's ${record.size} rows, and not one for each under its customer`);
  };

  /** Asserts an edit committed, naming it. */
  const committed = (result: MutationResult, what: string): void => {
    assert.equal(result.outcome.type, 'committed', `${what} was answered ${result.outcome.type}`);
  };

  describe('record loads beside edits', { concurrency: false }, () => {
    it('ruling 55 — edits saved while a load runs all land, and so does the load: the record holds the delivery beside every edit, and its index an entry for each row', async (t) => {
      const ctx = await setup(t);
      await deployYard(ctx);
      const wms = book(SHORT, 1);
      assert.equal((await load(ctx, 'wms', await delivered(ctx, wms))).outcome.type, 'loaded');
      const erp = book(LONG, 1);
      const id = await launch(ctx, 'erp', await delivered(ctx, erp));

      // One edit after another, for as long as the load runs
      const edits: Array<readonly [EditedSource, string, ErpOrder]> = [];
      let during = 0;
      while ((await status(ctx, 'erp', id)).type === 'processing' && edits.length < 500) {
        const edit = [edits.length % 2 === 0 ? 'own' : 'notes', `E-${edits.length}`, edited(edits.length)] as const;
        committed(await save(ctx, edit[0], edit[1], edit[2]), `edit ${edit[1]}, saved while the load ran`);
        edits.push(edit);
        if ((await status(ctx, 'erp', id)).type === 'processing') during++;
      }
      const end = await ended(ctx, 'erp', id);
      assert.ok(end.type === 'completed' && end.value.outcome.type === 'loaded', `the load ended ${end.type}`);
      assert.equal(end.value.set, BigInt(LONG));
      assert.ok(during > 0, `an edit was saved and answered while the load still ran: ${edits.length} saved, none before it ended — the delivery is too short for this server`);

      const commits = await chain(ctx);
      assert.deepEqual([count(commits, '$load:erp'), count(commits, '$load:wms'), count(commits, 'patch')], [1, 1, edits.length],
        'the load committed once, and each edit once');
      await holdsWithItsIndex(ctx, { erp, wms }, edits);
    });

    it('ruling 55 — two sources load at their own rhythm while two parts are edited, steadily and in bursts: each source holds its last delivery, every edit is held, and the index matches the rows', async (t) => {
      const ctx = await setup(t);
      await deployYard(ctx);
      const erpBooks = [1, 2, 3].map((round) => book(MIDDLING, round));
      const wmsBooks = [1, 2, 3, 4, 5, 6, 7, 8].map((round) => book(SHORT + round * 10, round));
      const edits: Array<readonly [EditedSource, string, ErpOrder]> = [];
      let erpDone = false;

      // The ERP's deliveries, one after another, each a load of some seconds
      const erpLoads = (async () => {
        for (const orders of erpBooks) assert.equal((await load(ctx, 'erp', await delivered(ctx, orders))).outcome.type, 'loaded', 'a load of the ERP\'s');
        erpDone = true;
      })();
      // The warehouse's, short and often
      const wmsLoads = (async () => {
        for (const orders of wmsBooks) assert.equal((await load(ctx, 'wms', await delivered(ctx, orders))).outcome.type, 'loaded', 'a load of the warehouse\'s');
      })();
      // One person saving their own orders, one after another, until the ERP's loads are done
      const steady = (async () => {
        for (let n = 0; !erpDone && n < 500; n++) {
          const edit = ['own', `S-${n}`, edited(n)] as const;
          committed(await save(ctx, ...edit), `the steady edit ${edit[1]}`);
          edits.push(edit);
        }
      })();
      // And notes saved six at once, three times over
      const bursts = (async () => {
        for (let burst = 0; burst < 3; burst++) {
          const saved = await Promise.all([0, 1, 2, 3, 4, 5].map(async (n) => {
            const edit = ['notes', `B-${burst}-${n}`, edited(burst * 10 + n)] as const;
            committed(await save(ctx, ...edit), `the note ${edit[1]}, one of six saved at once`);
            return edit;
          }));
          edits.push(...saved);
        }
      })();
      await Promise.all([erpLoads, wmsLoads, steady, bursts]);

      const commits = await chain(ctx);
      assert.deepEqual([count(commits, '$load:erp'), count(commits, '$load:wms'), count(commits, 'patch')], [erpBooks.length, wmsBooks.length, edits.length],
        'every load committed once, and every edit once');
      const { sources } = await workspaceRecordDescribe(ctx.config.baseUrl, ctx.repoName, WS, 'orders', await ctx.opts());
      assert.deepEqual(sources.filter((source) => source.pending).map((source) => source.name), [], 'no source waits');
      await holdsWithItsIndex(ctx, { erp: erpBooks.at(-1)!, wms: wmsBooks.at(-1)! }, edits);
    });

    it('ruling 37, ruling 55 — two loads of one source asked one after the other land in the order asked, while edits are saved beside them', async (t) => {
      const ctx = await setup(t);
      await deployYard(ctx);
      const wms = book(SHORT, 1);
      assert.equal((await load(ctx, 'wms', await delivered(ctx, wms))).outcome.type, 'loaded');
      const [first, second] = [book(MIDDLING, 1), book(MIDDLING, 2)];
      const [firstAsked, secondAsked] = [await delivered(ctx, first), await delivered(ctx, second)];

      const firstId = await launch(ctx, 'erp', firstAsked);
      const secondId = await launch(ctx, 'erp', secondAsked);
      const edits: Array<readonly [EditedSource, string, ErpOrder]> = [];
      for (let n = 0; n < 4; n++) {
        const edit = ['own', `O-${n}`, edited(n)] as const;
        committed(await save(ctx, ...edit), `edit ${edit[1]}`);
        edits.push(edit);
      }
      const [firstEnd, secondEnd] = [await ended(ctx, 'erp', firstId), await ended(ctx, 'erp', secondId)];
      assert.ok(firstEnd.type === 'completed' && firstEnd.value.outcome.type === 'loaded' && firstEnd.value.commit.type === 'some', `the first ended ${firstEnd.type}`);
      assert.ok(secondEnd.type === 'completed' && secondEnd.value.outcome.type === 'loaded' && secondEnd.value.commit.type === 'some', `the second ended ${secondEnd.type}`);

      const { commits } = await workspaceRecordHistory(ctx.config.baseUrl, ctx.repoName, WS, 'orders', undefined, await ctx.opts());
      const loads = commits.filter((commit) => commit.mutation === '$load:erp').map((commit) => commit.hash);
      assert.deepEqual(loads, [secondEnd.value.commit.value, firstEnd.value.commit.value], 'the second asked committed after the first');
      await holdsWithItsIndex(ctx, { erp: second, wms }, edits);
    });

    it('R85, ruling 55 — a load cancelled part way holds up no edit, and loads when it is asked again', async (t) => {
      const ctx = await setup(t);
      await deployYard(ctx);
      const wms = book(SHORT, 1);
      assert.equal((await load(ctx, 'wms', await delivered(ctx, wms))).outcome.type, 'loaded');
      const erp = book(LONG, 1);
      const asked = await delivered(ctx, erp);

      const id = await launch(ctx, 'erp', asked);
      await workspaceRecordLoadCancel(ctx.config.baseUrl, ctx.repoName, WS, 'orders', 'erp', id, await ctx.opts());
      // Saved while the job ends itself, and once it has
      const edits: Array<readonly [EditedSource, string, ErpOrder]> = [['own', 'C-0', edited(0)], ['notes', 'C-1', edited(1)]];
      committed(await save(ctx, ...edits[0]!), 'an edit saved as the load was cancelled');
      const end = await ended(ctx, 'erp', id);
      assert.ok(end.type === 'cancelled' || end.type === 'completed', `the cancelled load ended ${end.type}`);
      committed(await save(ctx, ...edits[1]!), 'an edit saved once the load had ended');
      if (end.type === 'cancelled') assert.equal(count(await chain(ctx), '$load:erp'), 0, 'cancelled: nothing loaded');

      // Asked again: it loads, or the delivery is the one a cancel that came too late let land
      const again = await load(ctx, 'erp', asked);
      assert.equal(again.outcome.type, end.type === 'cancelled' ? 'loaded' : 'again', 'the same delivery asked again');
      assert.equal(count(await chain(ctx), '$load:erp'), 1, 'loaded once');
      await holdsWithItsIndex(ctx, { erp, wms }, edits);
    });
  });
}
