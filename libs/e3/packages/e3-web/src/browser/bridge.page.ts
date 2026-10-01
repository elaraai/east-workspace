/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The bridge specs' test page: it runs `e3.fetch`'s contract over dedicated
 * workers — each a `bridge.worker.ts`, answering with the contract's plain
 * handler — and what only a browser shows: a 64 MiB body each way, a worker
 * that closes itself, an error a worker raises, and what the browser answers
 * `navigator.storage.persist()`.
 *
 * The harness bundles it for Chromium; `bridge.spec.ts` drives it.
 *
 * @packageDocumentation
 */

import { createWebE3 } from '../bridge/page.js';
import { caseNamed, runAdapterCase, type AdapterSetup } from '../testing/adapter-contract.js';
import { bridgeContract, browserBridgeContract, recordPosts, type BridgeCase, type BridgeSetup } from '../testing/bridge-contract.js';
import { servePage } from './page.js';

const setup: AdapterSetup<BridgeSetup> = (cleanup) => Promise.resolve({
  // The worker's refused boot takes it away: see bridge.worker.ts.
  missing: 'FileSystemFileHandle.move',
  start: (boot) => {
    const worker = new Worker(`/bridge-worker.js?boot=${boot}`, { type: 'module' });
    cleanup(() => worker.terminate());
    return { endpoint: worker, posted: recordPosts(worker), kill: () => worker.terminate() };
  },
  persistAsks: () => {
    // The browser's own answers, recorded as the page asks.
    const answers: boolean[] = [];
    const storage = navigator.storage;
    const persist = storage.persist.bind(storage);
    Object.defineProperty(storage, 'persist', {
      configurable: true,
      value: async () => {
        const answer = await persist();
        answers.push(answer);
        return answer;
      },
    });
    cleanup(() => {
      Reflect.deleteProperty(storage, 'persist');
    });
    return answers;
  },
});

/** The cases the page runs, by the contract they are of. */
const contracts: Record<string, readonly BridgeCase[]> = { contract: bridgeContract, browser: browserBridgeContract };

/** What the page's e3 says of the browser's keeping its repositories. */
export interface Persistence {
  /** `persisted`, as `createWebE3` answered it */
  readonly persisted: boolean;
  /** How many times the page asked `navigator.storage.persist()` */
  readonly asked: number;
}

servePage({
  /** Runs a case of a contract over dedicated workers. */
  runCase(contract: string, name: string): Promise<void> {
    const cases = contracts[contract];
    if (cases === undefined) throw new Error(`no contract '${contract}'`);
    return runAdapterCase(caseNamed(cases, name), setup);
  },

  /** Raises an error once the call has answered: what the harness keeps for
   *  a spec to see, though no call reports it. */
  raiseLater(message: string): void {
    setTimeout(() => {
      throw new Error(message);
    });
  },

  /** Connects to a worker that keeps repositories, and answers what its e3
   *  says of the browser's keeping them. */
  async persistence(): Promise<Persistence> {
    let found: Persistence | undefined;
    await runAdapterCase({
      name: 'persistence',
      run: async ({ start, persistAsks }) => {
        const answers = persistAsks();
        const e3 = await createWebE3(start('persist').endpoint);
        found = { persisted: e3.persisted, asked: answers.length };
      },
    }, setup);
    return found!;
  },
});
