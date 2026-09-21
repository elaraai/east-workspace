/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getBootId, getPidStartTime, isProcessAlive } from './processHelpers.js';
import { deadPid } from '../test-helpers.js';

describe('isProcessAlive', () => {
  it('answers for a live process and a dead one', async () => {
    const bootId = await getBootId();
    const startTime = await getPidStartTime(process.pid);
    assert.equal(await isProcessAlive(process.pid, startTime, bootId), true);
    // A process that has exited — not a fabricated start time for a live pid:
    // where the platform reports none (Windows) both sides read 0 and the
    // check falls through to the pid's existence, which answers `true`.
    const dead = deadPid();
    assert.equal(await isProcessAlive(dead, await getPidStartTime(dead), bootId), false);
  });

  it('refuses a pid below 1 instead of asking the kernel', async () => {
    // A spawn that produced no pid records -1, and POSIX reads `kill(-1, 0)`
    // as "every process I may signal" and `kill(0, 0)` as this process group
    // — both answer "alive", so the record would be reported running forever
    // and never repaired as interrupted.
    const bootId = await getBootId();
    for (const pid of [-1, 0, -12345]) {
      assert.equal(await isProcessAlive(pid, 0, bootId), false, `pid ${pid}`);
    }
  });
});
