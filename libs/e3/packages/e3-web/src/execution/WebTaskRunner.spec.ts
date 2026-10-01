/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `WebTaskRunner` in Node: every runner case over the in-process unit workers
 * and the adapters in memory, as `../browser/runner.spec.ts` runs them in
 * Chromium over Web Workers, IndexedDB, OPFS and Web Locks; and what the
 * in-process host does in place of terminating a thread, which it shares with
 * the test: a unit whose run is aborted stops at its next platform call.
 *
 * The thread cases (`threadCases`) run in Chromium only: a unit that never
 * yields its thread is ended by terminating the thread, and in process it is
 * the test's.
 */

import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayType, StringType } from '@elaraai/east';
import { datasetWrite, packageRead } from '@elaraai/e3-core/portable';
import { MemoryBlobs, MemoryFiles, MemoryLockSpace, MemoryRecordStore, openMemoryRecords } from '../storage/memory.js';
import { WebStorage } from '../storage/WebStorage.js';
import { runAdapterCase, type AdapterCase } from '../testing/adapter-contract.js';
import {
  FIXTURE_PACKAGE,
  FIXTURE_VERSION,
  runnerCases,
  runnerSetup,
  type RunnerEnvironment,
  type RunnerFixtures,
  type RunnerSetup,
} from '../testing/runner-cases.js';
import { buildRunnerFixtures } from '../testing/runner-fixtures.js';
import { TEST_PLATFORM, testPlatform, testTicks } from '../testing/test-platform.js';
import { inProcessUnits } from './in-process.js';

/**
 * A tab's storage over the adapters in memory, its origin's other sessions
 * opened over the same lock space, and workers in this thread serving the
 * specs' platform package beside the standard one.
 */
function environment(fixtures: RunnerFixtures): RunnerEnvironment {
  return {
    fixtures,
    units: inProcessUnits({ platforms: { [TEST_PLATFORM]: testPlatform } }),
    openStorage: async (cleanup) => {
      const space = new MemoryLockSpace();
      const storage = new WebStorage({
        records: openMemoryRecords(new MemoryRecordStore()),
        blobs: new MemoryBlobs(),
        locks: await space.open(),
        files: new MemoryFiles(),
      });
      cleanup(() => storage.close());
      return { storage, openSession: () => space.open() };
    },
  };
}

/** Waits until `holds` does, checking every few milliseconds. */
async function until(what: string, holds: () => boolean): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!holds()) {
    if (Date.now() > deadline) throw new Error(`waited 30 s for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** What the in-process host does in place of terminating a thread. */
const inProcessCase: AdapterCase<RunnerSetup> = {
  name: 'stops a unit in process at its next platform call once its run is aborted, calling none after',
  run: async (setup) => {
    const runner = setup.runner(setup.pool({ width: 1 }));
    const pkg = await packageRead(setup.storage, setup.repo, FIXTURE_PACKAGE, FIXTURE_VERSION);
    const taskHash = pkg.tasks.get('ticking');
    assert.ok(taskHash !== undefined);
    const inputHashes = [await datasetWrite(setup.storage, setup.repo, ['a'], ArrayType(StringType))];
    const from = testTicks();
    const controller = new AbortController();
    const running = runner.execute(setup.storage, taskHash, inputHashes, { signal: controller.signal });
    // The unit ticks, a platform call every few milliseconds, until it is
    // stopped.
    await until('the unit to tick', () => testTicks() >= from + 3n);
    controller.abort();
    const result = await running;
    assert.equal(result.cancelled, true);
    const stopped = testTicks();
    // Running, it would tick a score of times in this wait.
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(testTicks(), stopped, 'the unit made no platform call once its run was aborted');
  },
};

describe('WebTaskRunner over in-process unit workers and the adapters in memory', () => {
  let fixtures: RunnerFixtures;

  before(async () => {
    fixtures = await buildRunnerFixtures();
  });

  for (const runnerCase of [...runnerCases, inProcessCase]) {
    it(runnerCase.name, () => runAdapterCase(runnerCase, runnerSetup(environment(fixtures))));
  }
});
