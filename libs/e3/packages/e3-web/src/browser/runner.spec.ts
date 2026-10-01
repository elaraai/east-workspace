/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `WebTaskRunner` in Chromium: every runner case, each a test of its own,
 * run in a page over Web Workers, IndexedDB, OPFS and Web Locks — the cases
 * `../execution/WebTaskRunner.spec.ts` runs in Node over the in-process
 * workers — and the cases only workers on threads of their own pass: a call
 * that never yields its thread is ended by terminating its worker.
 *
 * The fixture package is exported here, in Node, with e3's SDK, and handed to
 * the page as data.
 */

import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fixturesToWire, runnerCases, threadCases } from '../testing/runner-cases.js';
import { buildRunnerFixtures } from '../testing/runner-fixtures.js';
import { Harness, type HarnessPage } from './harness.js';

const entries = {
  runner: fileURLToPath(new URL('./runner.page.js', import.meta.url)),
  'unit-worker': fileURLToPath(new URL('./unit.worker.js', import.meta.url)),
};

describe('WebTaskRunner in Chromium, over Web Workers, IndexedDB, OPFS and Web Locks', () => {
  let harness: Harness | undefined;
  /** The page each case runs in */
  let page: HarnessPage;

  before(async () => {
    const fixtures = await buildRunnerFixtures();
    harness = await Harness.open({ entries });
    page = await harness.newPage('runner');
    await page.call('setFixtures', fixturesToWire(fixtures));
  });

  after(async () => {
    await harness?.close();
  });

  for (const { name } of runnerCases) {
    it(name, () => page.call('runCase', name));
  }

  describe('on workers of threads of their own', () => {
    for (const { name } of threadCases) {
      it(name, () => page.call('runThreadCase', name));
    }
  });
});
