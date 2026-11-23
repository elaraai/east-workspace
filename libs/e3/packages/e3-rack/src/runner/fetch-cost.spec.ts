/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { none, variant } from '@elaraai/east';
import { LocalStorage, repoInit, uuidv7 } from '@elaraai/e3-core';
import { RACK_LINK_ASSUMED_BYTES_PER_SECOND, RecordedRunTimes, fetchBound, rackRanMs, weighFetch } from './fetch-cost.js';

const MB = 1024 * 1024;

it('is fetch-bound only when every rack would fetch the work for longer than it ran, and names the one that would fetch it soonest', () => {
  const objects = [{ size: 900 * MB }, { size: 3 * MB }];
  const links = new Map([
    ['slow', { bytesPerSecond: 10 * MB, held: [false, false] }],
    ['holding', { bytesPerSecond: 10 * MB, held: [true, false] }],
  ]);
  // On the rack that holds the large object, 3 MB at 10 MB/s: 0.3 s, under the 19 s the work ran
  assert.equal(fetchBound(objects, ['slow', 'holding'], links, 19_000), null);
  // On the slow one alone: 903 MB at 10 MB/s, 90.3 s
  assert.deepEqual(fetchBound(objects, ['slow'], links, 19_000), { bytes: 903 * MB, fetchMs: 90_300, ranMs: 19_000, measured: true });
  // Work that ran longer than its fetch stays on the rack
  assert.equal(fetchBound(objects, ['slow'], links, 120_000), null);
  // Nothing could take it: nothing to weigh
  assert.equal(fetchBound(objects, [], links, 1), null);
});

it('takes a rack whose link the hub has not measured to carry a gigabit, and to hold nothing', () => {
  const objects = [{ size: 1_250_000_000 }];
  assert.equal(RACK_LINK_ASSUMED_BYTES_PER_SECOND, 125_000_000);
  assert.deepEqual(fetchBound(objects, ['new'], new Map(), 2_000), { bytes: 1_250_000_000, fetchMs: 10_000, ranMs: 2_000, measured: false });
  assert.equal(fetchBound(objects, ['new'], new Map([['new', { bytesPerSecond: null, held: [false] }]]), 10_000), null, 'no longer than it ran');
});

it('reads how long work last ran from its execution records: the same inputs, else a task\'s latest and a unit\'s median, else nothing', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'e3fc-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repo = join(home, 'repo'); assert(repoInit(repo).success);
  const storage = new LocalStorage();
  const task = 'a'.repeat(64);
  let inputs = 0;
  const record = async (unit: boolean, ms: number, endedAt: number, state: 'success' | 'failed' = 'success') => {
    const inHash = (++inputs).toString(16).padStart(64, '0');
    const executionId = uuidv7();
    const times = { startedAt: new Date(endedAt - ms), completedAt: new Date(endedAt) };
    await storage.refs.executionWrite(repo, task, inHash, executionId, state === 'success'
      ? variant('success', { executionId, inputHashes: [], outputHash: 'f'.repeat(64), ...times, peakBytes: none, plan: none, unit })
      : variant('failed', { executionId, inputHashes: [], ...times, exitCode: 1n, peakBytes: none, unit }));
    return inHash;
  };
  const unknown = 'e'.repeat(64);
  assert.equal(await new RecordedRunTimes().ranMs(storage, repo, task, unknown, false), null, 'a first run');

  const older = await record(false, 5_000, 1_000_000);
  await record(false, 7_000, 2_000_000);
  await record(false, 1, 3_000_000, 'failed');
  for (const ms of [3_000, 1_000, 30_000, 2_000]) await record(true, ms, 1_500_000);
  const times = new RecordedRunTimes();
  assert.equal(await times.ranMs(storage, repo, task, older, false), 5_000, 'the same inputs ran 5 s');
  assert.equal(await times.ranMs(storage, repo, task, unknown, false), 7_000, 'the task\'s latest success, not a failure after it');
  assert.equal(await times.ranMs(storage, repo, task, unknown, true), 2_500, 'the median of its units');
  assert.equal(await times.ranMs(storage, repo, 'b'.repeat(64), unknown, true), null, 'a task that never ran');

  // A unit's closure is weighed by the sizes of its objects in the store
  const object = await storage.objects.write(repo, new Uint8Array(5000));
  const asked: string[][] = [];
  const cost = await weighFetch({ links: (hashes) => { asked.push([...hashes]); return Promise.resolve(new Map([['rack-a', { bytesPerSecond: 1000, held: [false] }]])); },
    racks: ['rack-a'], storage, repo, hashes: [object], ranMs: 2_000, times });
  assert.deepEqual(cost, { bytes: 5000, fetchMs: 5000, ranMs: 2_000, measured: true });
  assert.deepEqual(asked, [[object]]);
  // A hub that does not answer, or an object the store does not hold, weighs nothing: the work follows its policy
  assert.equal(await weighFetch({ links: () => Promise.resolve(null), racks: ['rack-a'], storage, repo, hashes: [object], ranMs: 1, times }), null);
  assert.equal(await weighFetch({ links: () => Promise.resolve(new Map()), racks: ['rack-a'], storage, repo, hashes: ['d'.repeat(64)], ranMs: 1, times }), null);
});

it('weighs work this process saw run on a rack by its rack\'s ran phase, not its record\'s span with the fetch before it (#1723)', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'e3fc-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repo = join(home, 'repo'); assert(repoInit(repo).success);
  const storage = new LocalStorage();
  const task = 'a'.repeat(64);
  const record = async (inHash: string, unit: boolean, ms: number) => {
    const executionId = uuidv7();
    const completedAt = new Date();
    await storage.refs.executionWrite(repo, task, inHash, executionId,
      variant('success', { executionId, inputHashes: [], outputHash: 'f'.repeat(64), startedAt: new Date(completedAt.getTime() - ms), completedAt, peakBytes: none, plan: none, unit }));
  };
  assert.equal(rackRanMs({ marks: { 'booted': 3_000, 'runner-started': 3_200, 'runner-ended': 22_200 } }), 19_000, 'from its runner\'s start to its end');
  assert.equal(rackRanMs({ marks: { 'runner-started': 3_200 } }), undefined, 'a rack that did not mark its end says nothing of it');
  assert.equal(rackRanMs(undefined), undefined);

  // A unit whose record spans a 260 s fetch, and which ran 19 s on its rack
  const [first, second, third] = ['1', '2', '3'].map((digit) => digit.repeat(64)) as [string, string, string];
  await record(first, true, 280_000);
  const times = new RecordedRunTimes();
  assert.equal(await times.ranMs(storage, repo, task, first, true), 280_000, 'the record alone: its fetch among it');
  times.ran(repo, task, first, true, 19_000);
  assert.equal(await times.ranMs(storage, repo, task, first, true), 19_000, 'its rack\'s ran, in place of its record');
  // Units seen on a rack that the records do not name yet count among the task's units
  times.ran(repo, task, second, true, 21_000);
  assert.equal(await times.ranMs(storage, repo, task, third, true), 20_000, 'the median of the units, each at its ran');
  assert.equal(await times.ranMs(storage, repo, task, third, false), null, 'a unit says nothing of its task\'s own execution');
  await record(third, true, 300_000);
  assert.equal(await new RecordedRunTimes().ranMs(storage, repo, task, 'e'.repeat(64), true), 290_000, 'another process sees the records alone');
});
