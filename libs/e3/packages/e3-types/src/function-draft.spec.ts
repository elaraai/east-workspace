/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How a call says which of its drafts ended it (east-workspace#1619): the
 * lines its stderr says it in, for people to read, and the end its result
 * names, which a caller reads it from — never the line, which a function's own
 * stderr may say too (#1680's review).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { equalFor, none, some, variant } from '@elaraai/east';
import { FunctionDraftFailureType, type ExecuteResult, type FunctionDraftFailure } from './api.js';
import { functionDraftEndLine, functionDraftEnded, functionDraftLabel, functionDraftsLaidLine, functionDraftsOutlasted } from './function-draft.js';

const sameFailure = equalFor(FunctionDraftFailureType);

/** A draft that ended a call, as its result names it. */
function draft(record: string, mutation: string, place: bigint, of: bigint, how: 'failed' | 'timed_out'): FunctionDraftFailure {
  return { record, mutation, place, of, how: how === 'failed' ? variant('failed', null) : variant('timed_out', null) };
}

/** A call's result, as far as the readers read it: what ended it, its outcome and its stderr. */
type Ended = Pick<ExecuteResult, 'outcome' | 'stderr' | 'draftEnd'>;

const failed = variant('failed', { exitCode: 3n });
const timedOut = variant('timed_out', { ms: 600_000n });

describe('the lines a call says what of its drafts ended it in', () => {
  it("names a draft by its record, its mutation and its place among the call's, and how many were laid", () => {
    assert.equal(functionDraftLabel({ record: 'jobs', mutation: 'patch' }, 2, 3), 'draft jobs.patch (2 of 3)');
    assert.equal(functionDraftEndLine(draft('jobs', 'patch', 2n, 3n, 'failed')), 'draft jobs.patch (2 of 3) failed');
    assert.equal(functionDraftEndLine(draft('jobs', 'patch', 1n, 1n, 'timed_out')), 'draft jobs.patch (1 of 1) timed out');
    assert.equal(functionDraftsLaidLine(3), 'drafts laid (3 of 3), and the call\'s timeout ended before its function ran');
  });
});

describe('what of its drafts ended a call, as its result names it', () => {
  it('reads back the draft a call names as its end, whatever its record\'s name holds', () => {
    const ends = [draft('jobs', 'patch', 2n, 3n, 'failed'), draft('jobs', 'move', 12n, 12n, 'timed_out'), draft('plant.jobs', 'patch', 1n, 1n, 'failed')];
    for (const end of ends) {
      const result: Ended = { outcome: end.how.type === 'failed' ? failed : timedOut, stderr: `${functionDraftEndLine(end)}\n`, draftEnd: some(variant('draft', end)) };
      const read = functionDraftEnded(result);
      assert.ok(read !== null && sameFailure(read, end), functionDraftEndLine(end));
      assert.equal(functionDraftsOutlasted(result), false, 'a draft that ended it is no timeout once every draft was laid');
    }
  });

  it('reads that a call\'s timeout ended once its drafts were all laid, naming no draft', () => {
    const result: Ended = { outcome: timedOut, stderr: `${functionDraftsLaidLine(3)}\n`, draftEnd: some(variant('laid', { of: 3n })) };
    assert.equal(functionDraftsOutlasted(result), true);
    assert.equal(functionDraftEnded(result), null);
  });

  it('names no end for a call its drafts did not end, whatever its stderr says: a function that ran and wrote the lines itself (#1680\'s review)', () => {
    const line = functionDraftEndLine(draft('jobs', 'patch', 1n, 1n, 'failed'));
    const mimic: Ended = { outcome: failed, stderr: `${line}\nError: refused\n`, draftEnd: none };
    assert.equal(functionDraftEnded(mimic), null, 'a function whose own stderr begins with a draft\'s end');
    const outlasting: Ended = { outcome: timedOut, stderr: `${functionDraftsLaidLine(2)}\n`, draftEnd: none };
    assert.equal(functionDraftsOutlasted(outlasting), false, 'a function whose own stderr says its drafts were laid');
    const success: Ended = { outcome: variant('success', { value: new Uint8Array() }), stderr: `${line}\n`, draftEnd: none };
    assert.deepEqual([functionDraftEnded(success), functionDraftsOutlasted(success)], [null, false], 'a call whose function ran to its end');
    const conflict: Ended = { outcome: variant('conflict', { record: 'jobs', mutation: 'patch', place: 1n, of: 1n, message: 'gone' }), stderr: '', draftEnd: none };
    assert.equal(functionDraftEnded(conflict), null, 'a conflict, whose outcome names its draft');
  });
});
