/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3.fetch` in Chromium, over a dedicated worker: the contract
 * `bridge/bridge.spec.ts` holds a `MessageChannel` to, each case a test of its
 * own, run in a page whose workers answer with the contract's plain handler —
 * its worker that stops mid-request is terminated — and what only a browser
 * shows: a 64 MiB body each way, a worker that closes itself, an error a
 * worker raises, and `persisted` as the browser answers
 * `navigator.storage.persist()`. Each case ends asserting the page raised
 * nothing, and the harness keeps an error a page raises after its last call
 * for that to see.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { bridgeContract, browserBridgeContract } from '../testing/bridge-contract.js';
import type { Persistence } from './bridge.page.js';
import { Harness, type HarnessPage } from './harness.js';

const entries = {
  bridge: fileURLToPath(new URL('./bridge.page.js', import.meta.url)),
  'bridge-worker': fileURLToPath(new URL('./bridge.worker.js', import.meta.url)),
};

/**
 * Grants a page's origin durable storage, as a browser grants it to a site it
 * keeps, until the grant is reset.
 *
 * @returns What resets the page's browser context's permissions
 */
async function grantDurableStorage(page: HarnessPage, origin: string): Promise<() => Promise<void>> {
  const context = page.page.context();
  const browser = context.browser();
  if (browser === null) throw new Error('the page has no browser to grant durable storage');
  const target = await context.newCDPSession(page.page);
  const { targetInfo } = await target.send('Target.getTargetInfo');
  await target.detach();
  const { browserContextId } = targetInfo;
  const session = await browser.newBrowserCDPSession();
  await session.send('Browser.grantPermissions', { permissions: ['durableStorage'], origin, browserContextId });
  return async () => {
    await session.send('Browser.resetPermissions', { browserContextId });
    await session.detach();
  };
}

describe('e3.fetch in Chromium, over a dedicated worker', () => {
  let harness: Harness | undefined;
  /** The page each case runs in */
  let page: HarnessPage;

  /** Runs a case in the page, which then has raised nothing. */
  async function runCase(contract: string, name: string): Promise<void> {
    await page.call('runCase', contract, name);
    assert.deepEqual(page.raisedErrors.map((error) => error.stack ?? error.message), [], 'the page raised nothing');
  }

  before(async () => {
    harness = await Harness.open({ entries });
    page = await harness.newPage('bridge');
  });

  after(async () => {
    await harness?.close();
  });

  describe('its contract', () => {
    for (const { name } of bridgeContract) it(name, () => runCase('contract', name));
  });

  describe('what only a browser shows', () => {
    for (const { name } of browserBridgeContract) it(name, () => runCase('browser', name));

    it('reports as persisted what the browser answers navigator.storage.persist(), asking once', async () => {
      assert.deepEqual(await page.call<Persistence>('persistence'), { persisted: false, asked: 1 },
        'a browser that does not keep the origin\'s storage answers no');
      const reset = await grantDurableStorage(page, harness!.origin);
      try {
        assert.deepEqual(await page.call<Persistence>('persistence'), { persisted: true, asked: 1 },
          'a browser that keeps it answers yes');
      } finally {
        await reset();
      }
      assert.deepEqual(page.raisedErrors.map((error) => error.message), [], 'the page raised nothing');
    });
  });

  describe('the harness', () => {
    it('keeps an error a page raises after its last call, which no later call reports, and through a call whose answer nobody reads', async (t) => {
      const raising = await harness!.newPage('bridge');
      t.after(() => raising.close());
      /** Waits until the page has raised as many errors as named. */
      const raised = async (count: number): Promise<void> => {
        for (let waited = 0; raising.raisedErrors.length < count && waited < 10_000; waited += 10) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      };
      await raising.call('raiseLater', 'raised after its call answered');
      await raised(1);
      // A call whose answer nobody reads, as a forwarded request's abort is,
      // neither reports the error before it nor loses it.
      raising.tell('raiseLater', 'raised after a call whose answer nobody reads');
      await raised(2);
      assert.deepEqual(raising.raisedErrors.map((error) => error.message), [
        'raised after its call answered',
        'raised after a call whose answer nobody reads',
      ]);
    });
  });
});
