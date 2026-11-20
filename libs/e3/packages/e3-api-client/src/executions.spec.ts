/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for reading a run's events through polls that serve at most 1,000
 * each: `dataflowEventsRemain` says whether a poll left any, and
 * `dataflowExecute` reads them all before it answers with the run's end,
 * through a stand-in server given as the `fetch`. And for a start's answer:
 * `dataflowExecuteLaunch` returns it, and `dataflowExecute` follows a run its
 * start was handed to from the cursor it was given.
 */

import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBeast2For, equalFor, none, printFor, some, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import {
  ApiDataflowExecutionStateType, BEAST2_CONTENT_TYPE, DATAFLOW_POLL_EVENTS_MAX, DataflowStartResultType, ResponseType, type DataflowStartResult,
} from '@elaraai/e3-types';
import { dataflowEventsRemain, dataflowExecute, dataflowExecuteLaunch } from './executions.js';

const BASE = 'https://e3.test';
const AT = new Date('2026-10-04T00:00:00.000Z');

/** A BEAST2 success envelope, as the server sends one. */
function success<T extends EastType>(type: T, value: ValueTypeOf<T>, status = 200): globalThis.Response {
  const body = encodeBeast2For(ResponseType(type))(variant('success', value) as never);
  return new Response(body, { status, headers: { 'Content-Type': BEAST2_CONTENT_TYPE } });
}

/**
 * A server whose run has ended with `held` task completions, each its own
 * event, and which answers a poll as e3's does: at most its limit past its
 * cursor, and never more than the cap. Its summary names `last` as the run's
 * last event, `held` unless a test has it run ahead of the events. A start is
 * answered `started`, as one that began the run, unless a test has it handed
 * to the run.
 *
 * @returns Each poll's query, and the `fetch` the server answers
 */
function endedRun(
  held: number, last = held, start: DataflowStartResult = variant('started', null),
): { polls: string[]; fetch: typeof globalThis.fetch } {
  const polls: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if ((init?.method ?? 'GET') === 'POST' && url.pathname === '/api/repos/r/workspaces/ws/dataflow') {
      return success(DataflowStartResultType, start, 202);
    }
    if (url.pathname !== '/api/repos/r/workspaces/ws/dataflow/execution') return new Response(`unexpected ${url.href}`, { status: 500 });
    polls.push(url.search);
    if (polls.length > 10) return new Response('the client polled on past the run\'s end', { status: 500 });
    const since = Number(url.searchParams.get('since') ?? '0');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? DATAFLOW_POLL_EVENTS_MAX), DATAFLOW_POLL_EVENTS_MAX);
    const events = Array.from({ length: Math.max(0, Math.min(limit, held - since)) }, (_, i) =>
      variant('complete', { task: `t${since + i + 1}`, timestamp: AT, duration: 1, peakBytes: none }));
    return success(ApiDataflowExecutionStateType, {
      runId: 'run-1', status: variant('completed', null), startedAt: AT, completedAt: some(AT),
      summary: some({ executed: BigInt(held), cached: 0n, failed: 0n, skipped: 0n, waiting: 0n, duration: 1_000 }),
      events, nextSeq: BigInt(since + events.length), lastSeq: BigInt(last),
      budget: none, waiting: [], splits: [],
    });
  }) as typeof globalThis.fetch;
  return { polls, fetch };
}

/** Counts the client's waits between polls, each answered at once. */
function countWaits(t: TestContext): () => number {
  const realSetTimeout = globalThis.setTimeout;
  const waits = t.mock.method(globalThis, 'setTimeout', ((callback: () => void) => realSetTimeout(callback, 0)) as never);
  return () => waits.mock.callCount();
}

describe('reading a run\'s events', () => {
  it('says whether a poll left events for the next', () => {
    assert.deepEqual(
      [{ nextSeq: 3n, lastSeq: 7n }, { nextSeq: 7n, lastSeq: 7n }, { nextSeq: 0n, lastSeq: 0n }].map(dataflowEventsRemain),
      [true, false, false],
    );
  });

  it('reads every event of a run that ended before its first poll, polling again at once, before it answers', async (t) => {
    const waits = countWaits(t);
    const server = endedRun(2_500);
    const result = await dataflowExecute(BASE, 'r', 'ws', {}, { token: null, fetch: server.fetch });
    assert.equal(result.tasks.length, 2_500);
    assert.deepEqual([result.tasks[0]!.name, result.tasks.at(-1)!.name], ['t1', 't2500']);
    assert.deepEqual(server.polls, ['?since=0', '?since=1000', '?since=2000']);
    assert.equal(waits(), 0, 'no wait between polls that left events');
  });

  it('answers once a poll serves nothing past its cursor, whatever the summary names, rather than poll again at once', async () => {
    // A store whose summary has run ahead of the events it holds.
    const server = endedRun(5, 10);
    const result = await dataflowExecute(BASE, 'r', 'ws', {}, { token: null, fetch: server.fetch });
    assert.equal(result.tasks.length, 5);
    assert.deepEqual(server.polls, ['?since=0', '?since=5']);
  });
});

describe('a start\'s answer', () => {
  const sameAnswer = equalFor(DataflowStartResultType);
  const print = printFor(DataflowStartResultType);

  it('is what the server answered: a run begun, or a run in flight that took the start in, with its cursor', async () => {
    for (const answer of [variant('started', null), variant('handed', { since: 1_842n })] satisfies DataflowStartResult[]) {
      const got = await dataflowExecuteLaunch(BASE, 'r', 'ws', {}, { token: null, fetch: endedRun(0, 0, answer).fetch });
      assert.ok(sameAnswer(got, answer), `answered ${print(got)}, not ${print(answer)}`);
    }
  });

  it('is followed from its cursor when the start was handed to a run in flight: the tasks from then on, and the run\'s own counts', async () => {
    const server = endedRun(1_200, 1_200, variant('handed', { since: 1_100n }));
    const result = await dataflowExecute(BASE, 'r', 'ws', {}, { token: null, fetch: server.fetch });
    assert.deepEqual(server.polls, ['?since=1100'], 'no event before the cursor is read');
    assert.deepEqual([result.tasks.length, result.tasks[0]!.name, result.tasks.at(-1)!.name], [100, 't1101', 't1200']);
    assert.equal(result.executed, 1_200n, 'the summary is the run\'s');
  });
});
