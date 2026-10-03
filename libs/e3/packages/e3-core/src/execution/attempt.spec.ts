/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * An execution attempt's ends (attempt.ts), over a log store that holds
 * appends until they are flushed: each end is recorded once the log is
 * flushed, so a reader that finds the attempt ended reads its whole log.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { equalFor, variant } from '@elaraai/east';
import { StopReasonType } from '@elaraai/e3-types';
import { ExecutionAttempt } from './attempt.js';
import { inputsHash } from '../executions.js';
import { uuidv7 } from '../uuid.js';
import { InMemoryStorage } from '../storage/in-memory/InMemoryStorage.js';
import { HeldLogStore, logsAtEachEnd, withLogStore, type LogAtEnd } from '../test-helpers.js';

const REPO = 'repo';
const TASK = 'c'.repeat(64);
const INPUT = 'd'.repeat(64);
const OUTPUT = 'e'.repeat(64);

/** An attempt over a store that holds its log's appends until they are
 *  flushed, and what a reader elsewhere reads of its log as each end is
 *  recorded. */
async function heldAttempt() {
  const storage = new InMemoryStorage();
  await storage.repos.create(REPO);
  const logs = new HeldLogStore(storage.logs);
  const ends = logsAtEachEnd(storage.refs, logs);
  const ids = { inHash: inputsHash([INPUT]), executionId: uuidv7(), startTime: Date.now() };
  const attempt = new ExecutionAttempt(withLogStore(storage, logs), REPO, TASK, [INPUT], ids, false);
  /** A stream of the attempt's log, as everything appended to it reads once flushed. */
  const whole = (stream: 'stdout' | 'stderr'): string => logs.appended(REPO, TASK, ids.inHash, ids.executionId, stream);
  return { storage, logs, ends, ids, attempt, whole };
}

/** Each end an attempt records, and what its record says. */
const ENDS: ReadonlyArray<readonly [string, (attempt: ExecutionAttempt) => Promise<unknown>, LogAtEnd['status']]> = [
  ['a success', (attempt) => attempt.recordSuccess(OUTPUT), 'success'],
  ['the task\'s own failure', (attempt) => attempt.recordFailed(1, 'Exit code: 1'), 'failed'],
  ['an error e3 met', (attempt) => attempt.recordError('the runner exited 0 without recording an ok result for its unit', 0), 'error'],
  ['a cancel', (attempt) => attempt.recordStopped('cancelled', 'cancelled: e3 stopped the runner because the run was aborted'), 'cancelled'],
  ['a timeout', (attempt) => attempt.recordStopped('error', 'timed out: e3 stopped the runner after 10 ms'), 'error'],
  ['a signal', (attempt) => attempt.recordStopped('failed', 'runner killed by SIGKILL'), 'failed'],
];

describe('an execution attempt', () => {
  for (const [what, end, status] of ENDS) {
    it(`records ${what} once its log is flushed, so a reader that finds the attempt ended reads its whole log`, async () => {
      const { ends, ids, attempt, whole } = await heldAttempt();
      const stdout = attempt.log('stdout');
      const stderr = attempt.log('stderr');
      await Promise.all([stdout.push('one\n'), stderr.push('oops\n'), stdout.push('two\n')]);
      await Promise.all([stdout.idle(), stderr.idle()]);
      await end(attempt);

      assert.equal(whole('stdout'), 'one\ntwo\n');
      assert.match(whole('stderr'), /^oops\n/, 'and a stop\'s cause after what the runner wrote');
      assert.deepEqual(ends, [{
        taskHash: TASK, inputsHash: ids.inHash, executionId: ids.executionId, status, stdout: whole('stdout'), stderr: whole('stderr'),
      }]);
    });
  }

  it('records why a cancelled attempt stopped: aborted, the cause its log\'s last line names', async () => {
    const { storage, ids, attempt, whole } = await heldAttempt();
    const cause = 'cancelled: e3 stopped the runner because the run was aborted';
    const result = await attempt.recordStopped('cancelled', cause);
    assert.equal(result.cancelled, true);
    const record = await storage.refs.executionGet(REPO, TASK, ids.inHash, ids.executionId);
    assert.ok(record?.type === 'cancelled', `the record is ${record?.type}`);
    assert.ok(equalFor(StopReasonType)(record.value.reason, { kind: variant('aborted', null), message: cause }));
    assert.equal(whole('stderr'), `e3: ${cause}\n`);
  });

  it('records an attempt whose owner cannot be recorded error once its log is flushed, and throws what the owner\'s write threw', async () => {
    const { storage, ends, ids, attempt, whole } = await heldAttempt();
    storage.refs.executionOwnerWrite = () => Promise.reject(new Error('the store failed the write'));
    await attempt.log('stdout').push('early\n');

    await assert.rejects(attempt.recordOwner({ pid: 1n, pidStartTime: 0n, bootId: 'boot' }, new Date()), /^Error: the store failed the write$/);
    assert.deepEqual(ends, [{
      taskHash: TASK, inputsHash: ids.inHash, executionId: ids.executionId, status: 'error', stdout: 'early\n', stderr: '',
    }]);
    assert.equal(whole('stdout'), 'early\n');
  });

  it('warns of a log it cannot flush, and records the end all the same', async (t) => {
    const { logs, ends, attempt } = await heldAttempt();
    logs.flush = () => Promise.reject(new Error('the store failed the flush'));
    const warned = t.mock.method(console, 'warn', () => undefined);
    await attempt.log('stdout').push('unflushed\n');

    const result = await attempt.recordSuccess(OUTPUT);
    assert.equal(result.state, 'success');
    assert.deepEqual(ends.map(({ status }) => status), ['success']);
    assert.deepEqual(warned.mock.calls.map((call) => call.arguments), [['Failed to flush the log: the store failed the flush']]);
  });
});
