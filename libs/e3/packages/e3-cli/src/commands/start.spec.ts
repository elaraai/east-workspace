/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { none, some, variant } from '@elaraai/east';
import { DataflowAbortedError } from '@elaraai/e3-core';
import type { DataflowEvent, DataflowExecutionState, DataflowStartResult } from '@elaraai/e3-api-client';
import {
  describeDeferral, describeWaits, followRemoteRun, forcedTasks, runCallbacks, runRemote, stoppedLines, waitingLine, type RemoteRunApi,
} from './start.js';

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

const AT = new Date('2026-10-04T00:00:00.000Z');

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
    const ended = await followRemoteRun(poll, 0n, () => false, async () => {
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
    const ended = await followRemoteRun(poll, 0n, () => false, async () => {});
    assert.equal(ended?.status.type, 'completed');
    assert.deepEqual(polls, [0n, 5n]);
  });

  it('follows a run asked to stop until it has stopped, not as it is stopping (#1286)', async () => {
    const statuses = [variant('running', null), variant('stopping', null), variant('stopping', null), variant('aborted', null)] as const;
    let polls = 0;
    const poll = async (): Promise<DataflowExecutionState> => {
      const status = statuses[Math.min(polls++, statuses.length - 1)]!;
      return {
        runId: 'run-1', status, startedAt: AT, completedAt: status.type === 'aborted' ? some(AT) : none, summary: none,
        events: [], nextSeq: 0n, lastSeq: 0n, budget: none, waiting: [], splits: [],
      };
    };
    const ended = await followRemoteRun(poll, 0n, () => false, async () => {});
    assert.equal(ended?.status.type, 'aborted');
    assert.equal(polls, 4);
  });
});

/** What the command printed, a line for each call. */
function printedLines(t: TestContext): () => string[] {
  const printed = t.mock.method(console, 'log', () => {});
  return () => printed.mock.calls.map((call) => String(call.arguments[0] ?? ''));
}

describe('a local run\'s lines', () => {
  it('says a catch-up run as it starts and as it lands, between the tasks\' own lines', (t) => {
    const lines = printedLines(t);
    const run = runCallbacks();
    // forecast lands and starts again; plan reads capacity as of forecast's
    // commit, where capacity never ran, so capacity runs there once
    run.onTaskComplete!({ name: 'forecast', cached: false, state: 'success', duration: 180_030 });
    run.onTaskStart!('forecast');
    run.onCatchUp!('capacity', 'plan', { state: 'started' });
    run.onTaskComplete!({ name: 'capacity', cached: false, state: 'success', duration: 50_090 });
    run.onTaskStart!('capacity');
    run.onCatchUp!('capacity', 'plan', { state: 'completed', duration: 50_120.4 });
    run.onTaskStart!('plan');
    assert.deepEqual(lines(), [
      '  [DONE] forecast [180030ms]',
      '  [START] forecast',
      '  [CATCH-UP] capacity for plan',
      '  [DONE] capacity [50090ms]',
      '  [START] capacity',
      '  [DONE] capacity for plan [50120ms]',
      '  [START] plan',
    ]);
  });

  it('says why a task is deferred: the input its inputs read at two values, and through what', (t) => {
    const lines = printedLines(t);
    runCallbacks().onTaskDeferred!('plan', { kind: 'plain', input: '.inputs.rates', through: ['forecast', 'capacity'] });
    assert.deepEqual(lines(), ['  [DEFER] plan: input \'rates\' is read at two values (through forecast and capacity): it runs once they agree']);

    assert.equal(
      describeDeferral({ kind: 'plain', input: '.inputs.rates', through: ['.inputs.rates', 'forecast'] }),
      'input \'rates\' is read at two values (directly and through forecast): it runs once they agree',
      'a read of the input itself is said first',
    );
    assert.equal(
      describeDeferral({ kind: 'plain', input: '.inputs.rates', through: ['forecast', 'capacity', 'supply'] }),
      'input \'rates\' is read at two values (through forecast, capacity and supply): it runs once they agree',
    );
    assert.equal(
      describeDeferral({ kind: 'plain', input: '.inputs.`unit rates`', through: ['forecast', 'capacity'] }),
      'input \'unit rates\' is read at two values (through forecast and capacity): it runs once they agree',
      'an input is named as it was declared',
    );
  });

  it('R27 — says what a task waits on: a record yet to hear from its sources, once, and the inputs not set, together', (t) => {
    const lines = printedLines(t);
    const run = runCallbacks();
    // The orders wait for the ERP's first delivery; reconcile reads what forecast writes
    run.onTaskWaiting!('forecast', [{ input: '.records.orders', kind: 'pending', sources: ['erp'] }]);
    run.onTaskWaiting!('reconcile', [{ input: '.tasks.forecast.output', kind: 'unset' }]);
    assert.deepEqual(lines(), [
      '  [WAIT] forecast: record \'orders\' waits for the first delivery of erp',
      '  [WAIT] reconcile: input \'.tasks.forecast.output\' not set',
    ]);

    assert.equal(describeWaits([{ input: '.inputs.a', kind: 'unset' }, { input: '.inputs.b', kind: 'unset' }]), 'inputs \'.inputs.a\', \'.inputs.b\' not set',
      'inputs not set are named together, as before');
    // A task that reads the record and an index of it, beside an input nothing has set
    assert.equal(describeWaits([
      { input: '.records.orders', kind: 'pending', sources: ['erp', 'wms'] },
      { input: '.inputs.rates', kind: 'unset' },
      { input: '.records.orders', kind: 'pending', sources: ['erp', 'wms'] },
    ]), 'input \'.inputs.rates\' not set; record \'orders\' waits for the first delivery of erp, wms', 'a record is said once, its sources joined with commas');
  });

  it('says why a run stopped itself, and what it completed first; a run a signal stopped says Aborted, as before', (t) => {
    const lines = printedLines(t);
    const run = runCallbacks();
    run.onTaskStart!('clean');
    run.onTaskComplete!({ name: 'clean', cached: false, state: 'success', duration: 1_840 });
    run.onTaskStart!('forecast');
    run.onTaskComplete!({ name: 'forecast', cached: false, state: 'cancelled', duration: 620 });
    const landed = [{ name: 'clean', cached: false, state: 'success' as const, duration: 1_840 }];
    for (const line of stoppedLines(new DataflowAbortedError(landed, 'a deploy of main started'))) console.log(line);
    assert.deepEqual(lines(), [
      '  [START] clean',
      '  [DONE] clean [1840ms]',
      '  [START] forecast',
      '  [CANCELLED] forecast',
      '',
      'Stopped: a deploy of main started.',
      '  Completed before it stopped: 1',
    ]);

    assert.deepEqual(stoppedLines(new DataflowAbortedError([], 'a deploy of main started')),
      ['', 'Stopped: a deploy of main started.', '  Completed before it stopped: 0'], 'a run stopped before any result landed says so');
    assert.deepEqual(stoppedLines(new DataflowAbortedError(landed)), ['', 'Aborted.', '  Completed before abort: 1']);
    assert.deepEqual(stoppedLines(new DataflowAbortedError()), ['', 'Aborted.']);
  });
});

describe('a remote run', () => {
  /**
   * A server whose run records `events`, one for each poll that asks past
   * the one before, and then ends as `status`.
   *
   * `waiting` is how many tasks its summary says it left waiting.
   *
   * @returns What the command asks of it, with each poll's cursor, how many
   *   cancels it was sent and how many times its outputs were listed
   */
  function server(
    start: DataflowStartResult, events: DataflowEvent[], status: 'completed' | 'failed' | 'aborted', from = 0n, waiting = 0n,
  ): { api: RemoteRunApi; polls: bigint[]; asked: { cancels: number; outputs: number } } {
    const polls: bigint[] = [];
    const asked = { cancels: 0, outputs: 0 };
    const last = from + BigInt(events.length);
    const api: RemoteRunApi = {
      launch: async () => start,
      poll: async (since) => {
        polls.push(since);
        if (polls.length > 20) throw new Error('polled on past the run\'s end');
        const next = events[Number(since - from)];
        const ended = next === undefined;
        return {
          runId: 'run-1', status: variant(ended ? status : 'running', null), startedAt: AT, completedAt: ended ? some(AT) : none,
          summary: ended ? some({ executed: 2n, cached: 0n, failed: status === 'failed' ? 1n : 0n, skipped: 0n, waiting, duration: 1_500 }) : none,
          events: ended ? [] : [next], nextSeq: ended ? since : since + 1n, lastSeq: last, budget: none, waiting: [], splits: [],
        };
      },
      cancel: async () => {
        asked.cancels++;
      },
      outputs: async () => {
        asked.outputs++;
      },
    };
    return { api, polls, asked };
  }
  const capacity: DataflowEvent[] = [
    variant('start', { task: 'capacity', timestamp: AT }),
    variant('complete', { task: 'capacity', timestamp: AT, duration: 50_120, peakBytes: none }),
  ];
  const summary = ['', 'Summary:', '  Executed: 2', '  Cached:   0', '  Failed:   0', '  Skipped:  0', '  Waiting:  0', '  Duration: 1500ms'];

  it('follows the run its start began from its first event, prints its summary and its outputs, and exits 0', async (t) => {
    const lines = printedLines(t);
    const { api, polls, asked } = server(variant('started', null), capacity, 'completed');
    assert.equal(await runRemote(api, 'main', () => false, async () => {}), 0);
    assert.deepEqual(lines(), ['  [START] capacity', '  [DONE] capacity [50120ms]', ...summary]);
    assert.deepEqual(polls, [0n, 1n, 2n]);
    assert.deepEqual(asked, { cancels: 0, outputs: 1 });
  });

  it('ruling 54 — the summary of a run that followed edits says how many more times its tasks ran; one handed to the command part way, which it did not see whole, does not', async (t) => {
    // Two tasks, each run once, and one of them three times more as its record was edited
    const followed: DataflowEvent[] = ['capacity', 'forecast', 'forecast', 'forecast', 'forecast'].flatMap((task): DataflowEvent[] => [
      variant('start', { task, timestamp: AT }),
      variant('complete', { task, timestamp: AT, duration: 10, peakBytes: none }),
    ]);
    const lines = printedLines(t);
    const { api } = server(variant('started', null), followed, 'completed');
    assert.equal(await runRemote(api, 'main', () => false, async () => {}), 0);
    assert.deepEqual(lines().slice(-8), [
      'Summary:', '  Executed: 2', '  Re-run:   3 (tasks run again as their inputs changed during the run)',
      '  Cached:   0', '  Failed:   0', '  Skipped:  0', '  Waiting:  0', '  Duration: 1500ms',
    ]);

    // Handed to a run in flight after its first two completions: the command saw the rest alone
    const before = lines().length;
    const handed = server(variant('handed', { since: 4n }), followed.slice(4), 'completed', 4n);
    assert.equal(await runRemote(handed.api, 'main', () => false, async () => {}), 0);
    assert.deepEqual(lines().slice(before).filter((line) => line.startsWith('  Re-run:')), [], 'a run followed from part way is not counted');
  });

  it('R27, ruling 46 — says, after the summary of a run that left tasks waiting, what they wait on and every remedy: set, seed or load', async (t) => {
    const lines = printedLines(t);
    const { api } = server(variant('started', null), capacity, 'completed', 0n, 3n);
    assert.equal(await runRemote(api, 'main', () => false, async () => {}), 0, 'a task left waiting fails nothing');
    assert.deepEqual(lines().slice(-4), [
      '  Waiting:  3',
      '  Duration: 1500ms',
      '',
      '3 tasks wait on an input that is not set, or on a record\'s load: set the input, seed the record, or load the record\'s sources, and run again.',
    ]);
    assert.equal(waitingLine(1),
      '1 task waits on an input that is not set, or on a record\'s load: set the input, seed the record, or load the record\'s sources, and run again.');
  });

  it('says a run in flight took the start in, and follows that run from the cursor the start was given', async (t) => {
    const lines = printedLines(t);
    const { api, polls } = server(variant('handed', { since: 1_842n }), capacity, 'completed', 1_842n);
    assert.equal(await runRemote(api, 'main', () => false, async () => {}), 0);
    assert.deepEqual(lines(), [
      'A run is in flight on main: it takes your changes in now.',
      '  [START] capacity',
      '  [DONE] capacity [50120ms]',
      ...summary,
    ]);
    assert.deepEqual(polls, [1_842n, 1_843n, 1_844n], 'no event before the cursor is read');
  });

  it('stops following a run it was handed to when interrupted, and leaves it running: no cancel is sent', async (t) => {
    const lines = printedLines(t);
    const { api, asked } = server(variant('handed', { since: 1_842n }), capacity, 'completed', 1_842n);
    let interrupted = false;
    const code = await runRemote(api, 'main', () => interrupted, async () => {
      interrupted = true;
    });
    assert.equal(code, 130);
    assert.deepEqual(lines().slice(-1), ['Stopped following the run on main, which goes on.']);
    assert.deepEqual(asked, { cancels: 0, outputs: 0 });
  });

  it('cancels the run its own start began when interrupted, as before', async (t) => {
    const lines = printedLines(t);
    const { api, asked } = server(variant('started', null), capacity, 'completed');
    let interrupted = false;
    const code = await runRemote(api, 'main', () => interrupted, async () => {
      interrupted = true;
    });
    assert.equal(code, 130);
    assert.deepEqual(lines().slice(-2), ['', 'Aborted.']);
    assert.equal(asked.cancels, 1);
  });

  it('says a run someone else stopped was stopped, and exits 130: the run its own start began, and one it was handed to', async (t) => {
    const lines = printedLines(t);
    const stopped = ['', 'Stopped: the run on main was stopped before it finished.'];
    const own = server(variant('started', null), capacity, 'aborted');
    assert.equal(await runRemote(own.api, 'main', () => false, async () => {}), 130);
    assert.deepEqual(lines(), ['  [START] capacity', '  [DONE] capacity [50120ms]', ...summary, ...stopped]);
    assert.deepEqual(own.asked, { cancels: 0, outputs: 0 }, 'it sends no cancel, and lists no outputs');

    const handed = server(variant('handed', { since: 1_842n }), capacity, 'aborted', 1_842n);
    assert.equal(await runRemote(handed.api, 'main', () => false, async () => {}), 130);
    assert.deepEqual(lines().slice(-2), stopped);
    assert.deepEqual(handed.asked, { cancels: 0, outputs: 0 });
  });

  it('exits 1 for a run that failed, and lists no outputs', async (t) => {
    printedLines(t);
    const { api, asked } = server(variant('started', null), capacity, 'failed');
    assert.equal(await runRemote(api, 'main', () => false, async () => {}), 1);
    assert.equal(asked.outputs, 0);
  });
});
