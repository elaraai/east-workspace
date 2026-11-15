/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The line a call says which of its drafts ended it in (east-workspace#1619),
 * and the line a call whose timeout ended once its drafts were all laid says so
 * in: each written and read back alike, and read only from a call it can be
 * of.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { variant } from '@elaraai/east';
import type { ExecuteResult } from './api.js';
import {
  functionDraftEndLine, functionDraftEnded, functionDraftLabel, functionDraftsLaidLine, functionDraftsOutlasted, type FunctionDraftEnd,
} from './function-draft.js';

/** A call's result, as far as the line's reader reads it. */
function ended(outcome: ExecuteResult['outcome'], stderr: string, drafted = ['jobs']): Pick<ExecuteResult, 'outcome' | 'stderr' | 'drafts'> {
  return { outcome, stderr, drafts: drafted.map((record) => ({ record, commit: 'c'.repeat(64) })) };
}

const failed = variant('failed', { exitCode: 3n });
const timedOut = variant('timed_out', { ms: 600_000n });

describe('the line a call names the draft that ended it in', () => {
  it('names a draft by its record, its mutation and its place among the call\'s', () => {
    assert.equal(functionDraftLabel({ record: 'jobs', mutation: 'patch' }, 2, 3), 'draft jobs.patch (2 of 3)');
    assert.equal(functionDraftEndLine({ record: 'jobs', mutation: 'patch', place: 2, of: 3, how: 'failed' }), 'draft jobs.patch (2 of 3) failed');
    assert.equal(functionDraftEndLine({ record: 'jobs', mutation: 'patch', place: 1, of: 1, how: 'timed_out' }), 'draft jobs.patch (1 of 1) timed out');
  });

  it('reads back the draft each end names, with the mutation\'s own stderr after it or none', () => {
    const ends: FunctionDraftEnd[] = [
      { record: 'jobs', mutation: 'patch', place: 2, of: 3, how: 'failed' },
      { record: 'jobs', mutation: 'move', place: 12, of: 12, how: 'timed_out' },
      // A record's name is all before the mutation's dot
      { record: 'plant.jobs', mutation: 'patch', place: 1, of: 1, how: 'failed' },
    ];
    for (const end of ends) {
      const outcome = end.how === 'failed' ? failed : timedOut;
      const line = functionDraftEndLine(end);
      assert.deepEqual(functionDraftEnded(ended(outcome, `${line}\nError: refused\n  at somewhere\n`)), end);
      assert.deepEqual(functionDraftEnded(ended(outcome, `${line}\n`)), end, 'a draft that did not start has no stderr of its own');
      assert.deepEqual(functionDraftEnded(ended(outcome, line)), end);
    }
  });

  it('names no draft for a call none can have ended, or whose first line says no such thing', () => {
    const line = 'draft jobs.patch (1 of 1) failed';
    assert.equal(functionDraftEnded(ended(failed, `${line}\n`, [])), null, 'a call that passed no draft');
    assert.equal(functionDraftEnded(ended(variant('success', { value: new Uint8Array() }), `${line}\n`)), null, 'a call whose function ran to its end');
    assert.equal(functionDraftEnded(ended(variant('conflict', { record: 'jobs', mutation: 'patch', message: 'gone' }), '')), null,
      'a conflict, whose outcome names its draft');
    assert.equal(functionDraftEnded(ended(timedOut, `${line}\n`)), null, 'a line of another end than the call\'s');
    assert.equal(functionDraftEnded(ended(timedOut, `${functionDraftsLaidLine(1)}\n`)), null, 'a timeout that ended once every draft was laid');
    assert.equal(functionDraftEnded(ended(failed, 'Error: the function failed\n')), null, 'the function\'s own failure');
    assert.equal(functionDraftEnded(ended(failed, `warming up\n${line}\n`)), null, 'the words on a later line');
    assert.equal(functionDraftEnded(ended(failed, 'draft jobs.patch (1 of 1) failed, again\n')), null);
  });
});

describe('the line a call whose drafts outlasted its timeout says so in', () => {
  it('says how many drafts were laid, every one of them, and is read back from a timed-out call that passed drafts', () => {
    assert.equal(functionDraftsLaidLine(3), 'drafts laid (3 of 3), and the call\'s timeout ended before its function ran');
    assert.equal(functionDraftsOutlasted(ended(timedOut, `${functionDraftsLaidLine(3)}\n`)), true);
    assert.equal(functionDraftsOutlasted(ended(timedOut, functionDraftsLaidLine(1))), true, 'with no line end');
  });

  it('is read from no other call: one that passed no draft, one that did not time out, one whose first line says another thing', () => {
    const line = `${functionDraftsLaidLine(2)}\n`;
    assert.equal(functionDraftsOutlasted(ended(timedOut, line, [])), false, 'a call that passed no draft');
    assert.equal(functionDraftsOutlasted(ended(failed, line)), false, 'a call that failed');
    assert.equal(functionDraftsOutlasted(ended(timedOut, '')), false, 'a function that ran out of the time');
    assert.equal(functionDraftsOutlasted(ended(timedOut, 'draft jobs.patch (2 of 2) timed out\n')), false, 'a draft that did not start');
    assert.equal(functionDraftsOutlasted(ended(timedOut, `warming up\n${line}`)), false, 'the words on a later line');
    assert.equal(functionDraftsOutlasted(ended(timedOut, 'drafts laid (1 of 2), and the call\'s timeout ended before its function ran\n')), false,
      'a count that is not every draft');
  });
});
