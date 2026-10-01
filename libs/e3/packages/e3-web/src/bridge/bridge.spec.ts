/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3.fetch` over a `MessageChannel`, held to its contract: the page's side
 * (`createWebE3`) at one port and the worker's side (`serveBridge`) at the
 * other, in process, the worker answering with the contract's plain handler.
 * The Chromium spec (`browser/bridge.spec.ts`) holds a dedicated worker to the
 * same contract.
 */

import { describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { openWebStorage } from '../storage/WebStorage.js';
import { runAdapterCase, type AdapterSetup } from '../testing/adapter-contract.js';
import { bridgeContract, recordPosts, type BridgeSetup } from '../testing/bridge-contract.js';
import { contractBoot, contractWorker } from '../testing/bridge-handler.js';
import { serveBridge } from './worker.js';

const setup: AdapterSetup<BridgeSetup> = (cleanup) => Promise.resolve({
  // Node has no IndexedDB: openWebStorage refuses it, as a browser without one.
  missing: 'IndexedDB',
  start: (boot) => {
    const { port1, port2 } = new MessageChannel();
    const worker = contractWorker(port2);
    serveBridge(contractBoot(boot, worker, async () => {
      await (await openWebStorage({ name: `e3-web-bridge-${randomUUID()}` })).close();
    }), worker.endpoint);
    // Closing one port closes the channel, and both its ports.
    cleanup(() => port1.close());
    return { endpoint: port1, posted: recordPosts(port1), kill: () => port2.close() };
  },
  persistAsks: () => {
    // Node has no storage manager: one in its place grants each ask, as a
    // browser that keeps the origin's storage does.
    const answers: boolean[] = [];
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persist: () => {
          answers.push(true);
          return Promise.resolve(true);
        },
        persisted: () => Promise.resolve(answers.length > 0),
      },
    });
    cleanup(() => {
      Reflect.deleteProperty(navigator, 'storage');
    });
    return answers;
  },
});

describe('e3.fetch over a MessageChannel', () => {
  for (const bridgeCase of bridgeContract) it(bridgeCase.name, () => runAdapterCase(bridgeCase, setup));
});
