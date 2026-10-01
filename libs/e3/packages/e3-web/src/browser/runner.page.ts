/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The runner specs' test page: `WebTaskRunner`'s cases over Web Workers —
 * each starting the specs' unit worker script (`unit.worker.ts`) — and e3's
 * storage over IndexedDB, OPFS and Web Locks, as a page of an app runs it.
 *
 * The fixture package is handed to the page as data, which the Node side
 * exported with e3's SDK: the page never reaches the SDK.
 *
 * The harness bundles it for Chromium; `runner.spec.ts` drives it.
 *
 * @packageDocumentation
 */

import type { UnitWorker } from '../execution/protocol.js';
import { deleteIndexedDbRecords } from '../storage/indexeddb.js';
import { openWebLocks } from '../storage/web-locks.js';
import { openWebStorage } from '../storage/WebStorage.js';
import { caseNamed, runAdapterCase } from '../testing/adapter-contract.js';
import {
  fixturesFromWire,
  runnerCases,
  runnerSetup,
  threadCases,
  type RunnerEnvironment,
  type RunnerFixtures,
  type RunnerFixturesWire,
} from '../testing/runner-cases.js';
import { servePage } from './page.js';

/** The fixture package, once the Node side has handed it over. */
let fixtures: RunnerFixtures | undefined;

/** Starts a unit worker: a Web Worker running the specs' unit worker script. */
function units(): UnitWorker {
  return new Worker('/unit-worker.js', { type: 'module' });
}

/** Removes what a storage of a name kept: its IndexedDB database and its OPFS
 *  directory. */
async function clear(name: string): Promise<void> {
  await deleteIndexedDbRecords(name);
  await (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true }).catch((err: unknown) => {
    if (!(err instanceof DOMException && err.name === 'NotFoundError')) throw err;
  });
}

/**
 * What a case's setup is made of in a page: a tab's storage over IndexedDB,
 * OPFS and Web Locks under a name no other case's has, removed once the case
 * has run, its origin's other sessions over Web Locks of the same name, and
 * Web Workers.
 */
function environment(): RunnerEnvironment {
  if (fixtures === undefined) throw new Error('the page was handed no fixture package: call setFixtures first');
  return {
    fixtures,
    units,
    openStorage: async (cleanup) => {
      const name = `e3-web-runner-${crypto.randomUUID()}`;
      // Registered first, so it runs last: once the storage has closed.
      cleanup(() => clear(name));
      const storage = await openWebStorage({ name });
      cleanup(() => storage.close());
      return { storage, openSession: () => openWebLocks({ prefix: `${name}:` }) };
    },
  };
}

servePage({
  /** Takes the fixture package the Node side exported. */
  setFixtures(wire: RunnerFixturesWire): void {
    fixtures = fixturesFromWire(wire);
  },

  /** Runs a runner case. */
  runCase(name: string): Promise<void> {
    return runAdapterCase(caseNamed(runnerCases, name), runnerSetup(environment()));
  },

  /** Runs a case only workers on threads of their own pass. */
  runThreadCase(name: string): Promise<void> {
    return runAdapterCase(caseNamed(threadCases, name), runnerSetup(environment()));
  },
});
