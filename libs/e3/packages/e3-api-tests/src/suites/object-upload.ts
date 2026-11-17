/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Object upload test suite (§7.11, R21): a file a load delivers is uploaded
 * as an object by the dataset upload's protocol with no dataset, writing no
 * ref, and a load then names it by its hash. Its bytes are sent only when the
 * repository does not hold them, and bytes that do not hash to the digest the
 * upload named are refused at its commit, and stored by no hash.
 *
 * It holds what the load suite shares: a delivery of the composite fixture's
 * ERP, and the workspace that loads one.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { encodeBeast2For, equalFor, none, type ValueTypeOf } from '@elaraai/east';
import { computeHash } from '@elaraai/e3-core';
import { DatasetStatusDetailType } from '@elaraai/e3-types';
import {
  ApiError, datasetGetStatus, objectGet, objectUpload, workspaceRecordDescribe, workspaceRecordLoad, type DatasetTransferSource,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { COMPOSITE_ORDERS_PATH, CompositeOrderRowType, ErpOrdersType, createCompositeRecordPackageZip } from '../fixtures.js';

/** An order of the ERP's: its customer, and how many it asks for. */
export type ErpOrder = ValueTypeOf<typeof CompositeOrderRowType>;

const encodeDelivery = encodeBeast2For(ErpOrdersType);
const sameStatus = equalFor(DatasetStatusDetailType);

/** The package the load suites deploy: the composite fixture. */
const PKG = 'record-load-pkg';

/** The workspace each case of the load suites deploys. */
export const LOAD_WS = 'load-ws';

/**
 * A delivery of the ERP's whole order book, as a file of it holds its bytes,
 * every range the upload reads of it kept.
 *
 * @param orders - The ERP's orders, by its own id
 * @returns The delivery, as an upload sends it
 */
export function erpDelivery(orders: ReadonlyArray<readonly [string, ErpOrder]>): DatasetTransferSource & { readonly reads: string[] } {
  const bytes = encodeDelivery(new Map(orders));
  const reads: string[] = [];
  return {
    size: bytes.byteLength,
    hash: computeHash(bytes),
    reads,
    slice(start, end) {
      reads.push(`${start}-${end}`);
      return bytes.subarray(start, end);
    },
  };
}

/**
 * A workspace of the composite fixture's `2.0.0`, deployed fresh: `orders.erp`
 * is loaded, and waits for its first delivery; `orders.own` holds `P-1`.
 *
 * @param ctx - The test's context
 */
export async function deployLoadedOrders(ctx: TestContext): Promise<void> {
  await ctx.importPackage(await createCompositeRecordPackageZip(ctx.tempDir, PKG, '2.0.0'));
  await ctx.createWorkspace(LOAD_WS);
  await ctx.deployPackage(LOAD_WS, `${PKG}@2.0.0`);
}

/** Whether the workspace's `orders` waits for the first delivery of `erp`. */
export async function erpWaits(ctx: TestContext): Promise<boolean | undefined> {
  const { sources } = await workspaceRecordDescribe(ctx.config.baseUrl, ctx.repoName, LOAD_WS, 'orders', await ctx.opts());
  return sources.find((source) => source.name === 'erp')?.pending;
}

const ACME: ErpOrder = { customer: 'Acme', qty: 5n };
const CEDAR: ErpOrder = { customer: 'Cedar', qty: 7n };

/**
 * Register the object upload tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function objectUploadTests(setup: TestSetup<TestContext>): void {
  describe('object upload', { concurrency: false }, () => {
    it('R21 — a delivery uploaded as an object writes no ref: the repository holds its bytes by their hash, and a load names it', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;
      await deployLoadedOrders(ctx);
      const before = await datasetGetStatus(base, ctx.repoName, LOAD_WS, COMPOSITE_ORDERS_PATH, opts);

      const delivery = erpDelivery([['SO-1001', ACME], ['SO-1002', CEDAR]]);
      assert.equal(await objectUpload(base, ctx.repoName, LOAD_WS, delivery, opts), delivery.hash, 'the upload answers the bytes\' hash');
      assert.equal(computeHash(await objectGet(base, ctx.repoName, delivery.hash, opts)), delivery.hash, 'the repository holds them by it');
      assert.ok(sameStatus(await datasetGetStatus(base, ctx.repoName, LOAD_WS, COMPOSITE_ORDERS_PATH, opts), before), 'no ref was written');
      assert.equal(await erpWaits(ctx), true, 'and the record still waits for its first delivery');

      const loaded = await workspaceRecordLoad(base, ctx.repoName, LOAD_WS, 'orders', 'erp', { delivery: delivery.hash, actor: none, asOf: none }, opts);
      assert.deepEqual([loaded.outcome.type, loaded.set], ['loaded', 2n], 'a load names the object by its hash');
    });

    it('sends no byte of a delivery the repository holds already, and answers its hash', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();
      await deployLoadedOrders(ctx);
      const orders = [['SO-1001', ACME]] as const;

      const first = erpDelivery(orders);
      await objectUpload(ctx.config.baseUrl, ctx.repoName, LOAD_WS, first, opts);
      assert.ok(first.reads.length > 0, 'the first upload sent the bytes');
      const again = erpDelivery(orders);
      assert.equal(await objectUpload(ctx.config.baseUrl, ctx.repoName, LOAD_WS, again, opts), again.hash);
      assert.deepEqual(again.reads, [], 'the second read none of them');
    });

    it('refuses bytes that do not hash to the digest the upload named, at its commit, and stores nothing by that digest', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();
      await deployLoadedOrders(ctx);
      const named = 'e'.repeat(64);

      const delivery = erpDelivery([['SO-1001', ACME]]);
      await assert.rejects(objectUpload(ctx.config.baseUrl, ctx.repoName, LOAD_WS, { ...delivery, hash: named }, opts), /^Error: Transfer failed: /);
      await assert.rejects(objectGet(ctx.config.baseUrl, ctx.repoName, named, opts), ApiError);
    });
  });
}
