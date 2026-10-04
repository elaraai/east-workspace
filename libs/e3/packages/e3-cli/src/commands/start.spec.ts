/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { none, some, variant } from '@elaraai/east';
import type { DataflowExecutionState } from '@elaraai/e3-api-client';
import { followRemoteRun, forcedTasks } from './start.js';

describe('forcedTasks', () => {
  it('forces nothing unless told: --force every task, --force-task the tasks it names', () => {
    assert.equal(forcedTasks({}), undefined);
    assert.equal(forcedTasks({ force: false }), undefined);
    assert.equal(forcedTasks({ force: true }), true);
    assert.deepEqual(forcedTasks({ forceTask: ['import_sales', 'import_stock'] }), ['import_sales', 'import_stock']);
  });

  it('refuses --force with --force-task, which say different things', () => {
    assert.throws(() => forcedTasks({ force: true, forceTask: ['import_sales'] }), {
      message: '--force forces every task the run runs, and --force-task only the tasks it names: give one or the other',
    });
  });
});

const AT = '2026-10-04T00:00:00.000Z';

/**
 * A remote run that has ended with `held` task completions, each its own
 * event, polled as e3 serves it: at most 1,000 past a cursor, its summary
 * naming `last` as its last event, `held` unless a test has it run ahead.
 *
 * @returns Each poll's cursor, and the poll
 */
function endedRun(held: number, last = held): { polls: bigint[]; poll: (since: bigint) => Promise<DataflowExecutionState> } {
  const polls: bigint[] = [];
  const poll = async (since: bigint): Promise<DataflowExecutionState> => {
    polls.push(since);
    if (polls.length > 10) throw new Error('polled on past the run\'s end');
    const from = Number(since);
    const events = Array.from({ length: Math.max(0, Math.min(1_000, held - from)) }, (_, i) =>
      variant('complete', { task: `t${from + i + 1}`, timestamp: AT, duration: 1, peakBytes: none }));
    return {
      runId: 'run-1', status: variant('completed', null), startedAt: AT, completedAt: some(AT), summary: none,
      events, nextSeq: BigInt(from + events.length), lastSeq: BigInt(last), budget: none, waiting: [], splits: [],
    };
  };
  return { polls, poll };
}

describe('followRemoteRun', () => {
  it('prints every event of a run that ended before its first poll, polling again at once, before it answers', async (t) => {
    const printed = t.mock.method(console, 'log', () => {});
    let waits = 0;
    const { polls, poll } = endedRun(2_500);
    const ended = await followRemoteRun(poll, () => false, async () => {
      waits++;
    });
    assert.equal(ended?.status.type, 'completed');
    assert.equal(printed.mock.callCount(), 2_500);
    assert.deepEqual(printed.mock.calls.at(-1)?.arguments, ['  [DONE] t2500 [1ms]']);
    assert.deepEqual(polls, [0n, 1_000n, 2_000n]);
    assert.equal(waits, 0, 'no wait between polls that left events');
  });

  it('answers once a poll serves nothing past its cursor, whatever the summary names, rather than poll again at once', async (t) => {
    t.mock.method(console, 'log', () => {});
    // A store whose summary has run ahead of the events it holds.
    const { polls, poll } = endedRun(5, 10);
    const ended = await followRemoteRun(poll, () => false, async () => {});
    assert.equal(ended?.status.type, 'completed');
    assert.deepEqual(polls, [0n, 5n]);
  });
});
