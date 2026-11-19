/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The client's loads of a composite record's deliveries (§7.12, rulings 24 and
 * 28): `workspaceRecordLoad` launches a load and follows its job to its end,
 * telling each step it reports. Once its signal aborts it asks the job to
 * cancel and follows it to the end the job writes, telling nothing more: a job
 * stopped before its commit wrote ends cancelled, and the load rejects with
 * the signal's reason; one whose commit had written answers what the load
 * did. Through a stand-in server given as the `fetch`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { equalFor, none, printFor, some, variant } from '@elaraai/east';
import {
  PackageJobResponseType, RecordLoadProgressType, RecordLoadResultType, RecordLoadStatusType, type RecordLoadProgress, type RecordLoadResult,
  type RecordLoadStatus,
} from '@elaraai/e3-types';
import { workspaceRecordLoad } from './records.js';
import { success, until } from './test-helpers.js';

const BASE = 'https://e3.test';
const LOADS = '/api/repos/r/workspaces/ws/records/orders/loads/erp';
const LAUNCH = `POST ${LOADS}`;
const POLL = `GET ${LOADS}/load-1`;
const CANCEL = `POST ${LOADS}/load-1/cancel`;
const DELIVERY = 'd'.repeat(64);

const sameResult = equalFor(RecordLoadResultType);
const printProgress = printFor(RecordLoadProgressType);

/** What the stand-in load did: one commit, its counts. */
const LOADED: RecordLoadResult = {
  commit: some('c'.repeat(64)), state: some('s'.repeat(64)), delivery: DELIVERY, set: 3n, deleted: 1n, unchanged: 7n,
  outcome: variant('loaded', null),
};

const QUEUED: RecordLoadProgress = variant('queued', null);
const PIECES: RecordLoadProgress = variant('pieces', { done: 1n, total: 2n, cached: 0n });
const running = (progress: RecordLoadProgress): RecordLoadStatus => variant('processing', some(progress));

/**
 * A server whose load `load-1` answers each poll with the next of `polls`,
 * its last again, and a cancel with `cancelled` — after which each poll
 * answers the next of `afterCancel`, its last again.
 *
 * @returns The requests, as `METHOD /path`, and the `fetch` the server answers
 */
function server(polls: RecordLoadStatus[], afterCancel: RecordLoadStatus[] = []): { requests: string[]; fetch: typeof globalThis.fetch } {
  const requests: string[] = [];
  let polled = 0;
  let cancelled: number | null = null;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    requests.push(key);
    if (requests.length > 40) return new Response('the client asked on and on', { status: 500 });
    if (key === LAUNCH) return success(PackageJobResponseType, { id: 'load-1' });
    if (key === CANCEL) {
      cancelled = 0;
      return success(RecordLoadStatusType, afterCancel[0] ?? polls[Math.min(polled, polls.length - 1)]!);
    }
    if (key === POLL) {
      if (cancelled !== null) return success(RecordLoadStatusType, afterCancel[Math.min(++cancelled, afterCancel.length - 1)]!);
      return success(RecordLoadStatusType, polls[Math.min(polled++, polls.length - 1)]!);
    }
    return new Response(`unexpected ${key}`, { status: 500 });
  }) as typeof globalThis.fetch;
  return { requests, fetch };
}

const request = { delivery: DELIVERY, actor: none, asOf: none };

describe('a load of a delivery, as the client makes it', () => {
  it('launches the load, tells each step its job reports, and answers what the load did', async () => {
    const { requests, fetch } = server([running(QUEUED), running(PIECES), variant('completed', LOADED)]);
    const heard: string[] = [];
    const result = await workspaceRecordLoad(BASE, 'r', 'ws', 'orders', 'erp', request, { token: null, fetch }, {
      onProgress: (progress) => heard.push(printProgress(progress)),
    });
    assert.ok(sameResult(result, LOADED));
    assert.deepEqual(heard, [printProgress(QUEUED), printProgress(PIECES)]);
    assert.deepEqual(requests, [LAUNCH, POLL, POLL, POLL]);
  });

  it('raises a load that failed in its job\'s words, and one another caller cancelled', async () => {
    const failed = server([variant('failed', { message: 'the load of orders.erp failed: a piece ran out of memory' })]);
    await assert.rejects(workspaceRecordLoad(BASE, 'r', 'ws', 'orders', 'erp', request, { token: null, fetch: failed.fetch }),
      { message: 'the load of orders.erp failed: a piece ran out of memory' });
    const elsewhere = server([variant('cancelled', null)]);
    await assert.rejects(workspaceRecordLoad(BASE, 'r', 'ws', 'orders', 'erp', request, { token: null, fetch: elsewhere.fetch }),
      { message: 'the load of orders.erp was cancelled before it committed: nothing loaded' });
  });

  it('asks the job to cancel once its signal aborts, follows it to the end it writes, and rejects with the signal\'s reason when it ends cancelled', async () => {
    const { requests, fetch } = server([running(PIECES)], [running(PIECES), running(PIECES), variant('cancelled', null)]);
    const stop = new AbortController();
    const heard: RecordLoadProgress[] = [];
    const loading = workspaceRecordLoad(BASE, 'r', 'ws', 'orders', 'erp', request, { token: null, fetch }, {
      signal: stop.signal, onProgress: (progress) => heard.push(progress),
    });
    await until(() => heard.length > 0);
    const reason = new Error('Ctrl-C');
    stop.abort(reason);
    await assert.rejects(loading, (err: unknown) => err === reason);
    assert.equal(requests.filter((r) => r === CANCEL).length, 1, 'the job was asked to cancel, once');
    assert.deepEqual(requests.slice(requests.indexOf(CANCEL)), [CANCEL, POLL, POLL], 'and followed to its end');
    assert.equal(heard.length, 1, 'nothing more was told once the cancel was asked');
  });

  it('answers what the load did when its commit had written before the cancel was read', async () => {
    const { requests, fetch } = server([running(PIECES)], [running(variant('commit', null)), variant('completed', LOADED)]);
    const stop = new AbortController();
    let heard = 0;
    const loading = workspaceRecordLoad(BASE, 'r', 'ws', 'orders', 'erp', request, { token: null, fetch }, {
      signal: stop.signal, onProgress: () => { heard++; },
    });
    await until(() => heard > 0);
    stop.abort();
    assert.ok(sameResult(await loading, LOADED), 'the load landed: what it did is answered');
    assert.ok(requests.includes(CANCEL));
  });

  it('launches nothing once its signal has aborted', async () => {
    const { requests, fetch } = server([variant('completed', LOADED)]);
    const stop = new AbortController();
    stop.abort();
    await assert.rejects(workspaceRecordLoad(BASE, 'r', 'ws', 'orders', 'erp', request, { token: null, fetch }, { signal: stop.signal }),
      { name: 'AbortError' });
    assert.deepEqual(requests, []);
  });
});
