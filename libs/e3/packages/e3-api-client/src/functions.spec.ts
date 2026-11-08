/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for a call of a workspace's function as the client makes it
 * (east-workspace#1554): `workspaceFunctionCall` answers from the start a call
 * that ends within its wait, polls one that outlives it, names each call by an
 * id of its own before it sends it, asks the server to stop one its signal
 * aborts — at once while it is polled, whatever its fetch does with the abort,
 * and at once by its id while its start waits — each ask sent `keepalive` so a
 * closing page's is heard, calls through the sync route on a server that keeps
 * no calls, and raises a call that has no result as the sync route answers it.
 * Through a stand-in server given as the `fetch`, which files a call under the
 * id its start names, as a server does.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IntegerType, encodeBeast2For, equalFor, none, some, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import {
  BEAST2_CONTENT_TYPE, ExecuteResultType, FunctionCallAnswerType, FunctionCallStatusType, ResponseType, type ExecuteResult, type FunctionCallStatus,
} from '@elaraai/e3-types';
import { CALL_POLL_WAIT_MS, workspaceFunctionCall } from './functions.js';
import { ApiError } from './http.js';

const BASE = 'https://e3.test';
const START = 'POST /api/repos/r/workspaces/ws/functions/add/calls';
const SYNC = 'POST /api/repos/r/workspaces/ws/functions/add';
const STATUS = 'GET /api/repos/r/workspaces/ws/calls/c1/status';
const CANCEL = 'POST /api/repos/r/workspaces/ws/calls/c1/cancel';

const sameResult = equalFor(ExecuteResultType);

/** A call's result: its value, 5. */
const FIVE: ExecuteResult = {
  outcome: variant('success', { value: encodeBeast2For(IntegerType)(5n) }),
  stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false, inputs: [],
};

/** A BEAST2 success, as the server sends one. */
function success<T extends EastType>(type: T, value: ValueTypeOf<T>): globalThis.Response {
  const body = encodeBeast2For(ResponseType(type))(variant('success', value) as never);
  return new Response(body, { status: 200, headers: { 'Content-Type': BEAST2_CONTENT_TYPE } });
}

/** An answer to a request, by its URL. */
type Answer = (url: URL) => globalThis.Response | Promise<globalThis.Response>;

/** A start's answer: the call's id — the one its start named, as a server files it under — and how it stood. */
function started(status: FunctionCallStatus): Answer {
  return (url) => success(FunctionCallAnswerType, { id: url.searchParams.get('id') ?? 'c1', status });
}

/** A poll's answer. */
function polled(status: FunctionCallStatus): Answer {
  return () => success(FunctionCallStatusType, status);
}

const RUNNING: FunctionCallStatus = variant('running', null);
const DONE: FunctionCallStatus = variant('completed', FIVE);

/** A UUIDv7, as text. */
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The id a start's query names its call by. */
const idOf = (query: string): string => new URLSearchParams(query).get('id') ?? '';

/** Answers given deaf ({@link deaf}): a request's abort does not cut them. */
const DEAF = new WeakSet<Answer>();

/** An answer its request's abort does not cut, as a host's own fetch may give one. */
function deaf(answer: Answer): Answer {
  DEAF.add(answer);
  return answer;
}

/**
 * A server that answers each request by the first of `routes` it matches —
 * `METHOD /path`, a call's id in it read as `c1` — with that route's answers
 * in turn, its last again.
 *
 * @returns Each request, as `METHOD /path` it matched, with its path as sent,
 *   its query and whether it was sent `keepalive`; and the `fetch` the server
 *   answers
 */
function server(routes: Record<string, Answer[]>): {
  requests: string[]; paths: string[]; queries: string[]; keepalive: boolean[]; fetch: typeof globalThis.fetch;
} {
  const requests: string[] = [];
  const paths: string[] = [];
  const queries: string[] = [];
  const keepalive: boolean[] = [];
  const served = new Map<string, number>();
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname.replace(/(\/calls\/)[^/]+/, '$1c1')}`;
    requests.push(key);
    paths.push(url.pathname);
    queries.push(url.search);
    keepalive.push(init?.keepalive === true);
    if (requests.length > 20) return new Response('the client asked on and on', { status: 500 });
    const answers = routes[key];
    if (answers === undefined) return new Response('404 Not Found', { status: 404 });
    const at = served.get(key) ?? 0;
    served.set(key, at + 1);
    const answer = answers[Math.min(at, answers.length - 1)]!;
    const signal = init?.signal ?? undefined;
    if (signal === undefined || DEAF.has(answer)) return answer(url);
    // A held answer is cut by its request's abort, as a fetch's is
    return new Promise<globalThis.Response>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      void Promise.resolve(answer(url)).then(resolve, reject);
    });
  }) as typeof globalThis.fetch;
  return { requests, paths, queries, keepalive, fetch };
}

/** An answer held until its gate is opened. */
function gated(answer: Answer): { answer: Answer; open: () => void } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { answer: (url) => opened.then(() => answer(url)), open };
}

/** Settles once `requests` holds `count` requests. */
async function requested(requests: readonly string[], count: number): Promise<void> {
  while (requests.length < count) await new Promise((resolve) => setTimeout(resolve, 5));
}

const ADD = { args: [], runner: none, limits: none };

describe('a call of a workspace\'s function (#1554)', () => {
  it('answers a call that ends within its start\'s wait from the start alone, telling no one an id', async () => {
    const { requests, fetch } = server({ [START]: [started(DONE)] });
    let told = 0;
    const result = await workspaceFunctionCall(BASE, 'r', 'ws', 'add', ADD, { token: null, fetch }, { onStarted: () => { told++; } });
    assert.ok(sameResult(result, FIVE));
    assert.deepEqual(requests, [START]);
    assert.equal(told, 0);
  });

  it('polls a call that outlives its start until it ends, each poll asking the server to wait, and tells its caller the call\'s id', async () => {
    const { requests, queries, fetch } = server({ [START]: [started(RUNNING)], [STATUS]: [polled(RUNNING), polled(DONE)] });
    const told: string[] = [];
    const result = await workspaceFunctionCall(BASE, 'r', 'ws', 'add', ADD, { token: null, fetch }, { onStarted: (id) => told.push(id) });
    assert.ok(sameResult(result, FIVE));
    assert.deepEqual(requests, [START, STATUS, STATUS]);
    assert.deepEqual(queries.slice(1), [`?wait=${CALL_POLL_WAIT_MS}`, `?wait=${CALL_POLL_WAIT_MS}`]);
    assert.deepEqual(told, [idOf(queries[0]!)]);
  });

  it('names a call before it sends it: its start carries an id of the client\'s, a UUIDv7 of now, and the next call\'s sorts after it', async () => {
    const { queries, fetch } = server({ [START]: [started(DONE)] });
    const before = Date.now();
    await workspaceFunctionCall(BASE, 'r', 'ws', 'add', ADD, { token: null, fetch });
    await workspaceFunctionCall(BASE, 'r', 'ws', 'add', ADD, { token: null, fetch });
    const [first, second] = queries.map(idOf);
    assert.match(first!, UUIDV7);
    assert.ok(second! > first!, `ids order as calls start: ${first} then ${second}`);
    const at = parseInt(first!.replace(/-/g, '').slice(0, 12), 16);
    assert.ok(at >= before && at <= Date.now(), 'its time is now');
  });

  it('asks the server to stop a call whose signal aborts while a poll is held, and stops waiting at once', async () => {
    const held = gated(polled(DONE));
    const { requests, keepalive, fetch } = server({ [START]: [started(RUNNING)], [STATUS]: [held.answer], [CANCEL]: [polled(variant('cancelled', { by: none }))] });
    const stop = new AbortController();
    const calling = workspaceFunctionCall(BASE, 'r', 'ws', 'add', ADD, { token: null, fetch }, { signal: stop.signal });
    await requested(requests, 2);
    stop.abort();
    await assert.rejects(calling, (err: unknown) => (err as { name?: string }).name === 'AbortError');
    await requested(requests, 3);
    assert.deepEqual(requests, [START, STATUS, CANCEL]);
    assert.deepEqual(keepalive, [false, false, true], 'the ask to stop alone outlives a closing page');
    held.open();
  });

  it('stops waiting at once for a poll whose fetch answers in its own time, as a host\'s may, and asks the server to stop the call', async () => {
    const held = gated(polled(DONE));
    const { requests, fetch } = server({ [START]: [started(RUNNING)], [STATUS]: [deaf(held.answer)], [CANCEL]: [polled(variant('cancelled', { by: none }))] });
    const stop = new AbortController();
    const calling = workspaceFunctionCall(BASE, 'r', 'ws', 'add', ADD, { token: null, fetch }, { signal: stop.signal });
    await requested(requests, 2);
    stop.abort();
    await assert.rejects(calling, (err: unknown) => (err as { name?: string }).name === 'AbortError');
    await requested(requests, 3);
    assert.deepEqual(requests, [START, STATUS, CANCEL], 'the poll, still unanswered, is not waited for');
    held.open();
  });

  it('asks the server to stop a call whose signal aborts while its start waits at once, by the id it named the call by, and again once the start answers', async () => {
    const start = gated(started(RUNNING));
    const { requests, paths, queries, keepalive, fetch } = server({ [START]: [start.answer], [CANCEL]: [polled(variant('cancelled', { by: none }))] });
    const stop = new AbortController();
    const calling = workspaceFunctionCall(BASE, 'r', 'ws', 'add', ADD, { token: null, fetch }, { signal: stop.signal });
    await requested(requests, 1);
    stop.abort();
    await assert.rejects(calling, (err: unknown) => (err as { name?: string }).name === 'AbortError');
    await requested(requests, 2);
    assert.deepEqual(requests, [START, CANCEL], 'the start runs on, never cut: the ask to stop names the call it files');
    assert.equal(paths[1], `/api/repos/r/workspaces/ws/calls/${idOf(queries[0]!)}/cancel`);
    start.open();
    await requested(requests, 3);
    assert.deepEqual(requests, [START, CANCEL, CANCEL]);
    assert.deepEqual(keepalive, [false, true, true]);
  });

  it('calls through the sync route on a server that keeps no calls, which has no route to start one', async () => {
    const { requests, fetch } = server({ [SYNC]: [() => success(ExecuteResultType, FIVE)] });
    const result = await workspaceFunctionCall(BASE, 'r', 'ws', 'add', ADD, { token: null, fetch });
    assert.ok(sameResult(result, FIVE));
    assert.deepEqual(requests, [START, SYNC]);
  });

  it('raises a call cancelled elsewhere, or lost, as the sync route answers one, since it has no result', async () => {
    for (const [status, words] of [
      [variant('cancelled', { by: some('ada@example.com') }), 'was cancelled by ada@example.com, and has no result'],
      [variant('cancelled', { by: none }), 'was cancelled, and has no result'],
      [variant('lost', { message: 'its host stopped' }), 'was lost: its host stopped'],
    ] as const) {
      const { queries, fetch } = server({ [START]: [started(RUNNING)], [STATUS]: [polled(status)] });
      await assert.rejects(workspaceFunctionCall(BASE, 'r', 'ws', 'add', ADD, { token: null, fetch }), (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.code, 'internal');
        assert.equal((err.details as { message: string }).message, `call ${idOf(queries[0]!)} ${words}`);
        return true;
      });
    }
  });
});
