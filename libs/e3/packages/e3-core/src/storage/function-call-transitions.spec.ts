/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The transitions every function call store makes of a kept call, as pure rules (east-workspace#1554, #1619): the first
 * end stands, a cancel is asked once, only a running call's inputs are pinned, a call past its lifetime is gone, and a
 * list takes a call of its function and its state. How each backend keeps them is `functionCallStoreTests`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { equalFor, none, some, variant } from '@elaraai/east';
import { FunctionCallJobType, type FunctionCallJob } from '@elaraai/e3-types';
import type { FunctionCallEnd } from './interfaces.js';
import { applyCallTransition, callCancelAsked, callEnded, callExpired, callInputsPinned, callListed } from './function-call-transitions.js';

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.parse('2026-11-16T07:00:00Z');
const jobEqual = equalFor(FunctionCallJobType);

/** A call as it starts: running, of `quote` unless it names none, kept for an hour. */
function running(fn: string | null = 'quote'): FunctionCallJob {
  return {
    call: {
      id: '019a8d2e-6f00-7000-8000-000000000001',
      function: fn === null ? none : some(fn),
      caller: some('ada@example.com'),
      startedAt: new Date(NOW),
      endedAt: none,
      state: variant('running', null),
      package: fn === null ? none : some({ name: 'calls-pkg', version: '1.0.0' }),
      args: [],
      inputs: [],
      drafts: [],
      limits: { timeoutMs: 60_000n, maxResultBytes: 1024n, maxLogBytes: 1024n },
      expiresAt: new Date(NOW + HOUR_MS),
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    },
    workspace: 'calls-ws',
    functionObject: 'f'.repeat(64),
    runner: variant('east_node', { platforms: [], decode: variant('lazy', null) }),
    verbose: false,
    deadline: new Date(NOW + 60_000),
    cancel: none,
    keep: { succeeded: BigInt(HOUR_MS), failed: BigInt(7 * 24 * HOUR_MS) },
    drafted: [],
  };
}

/** How a call ended, kept for an hour. */
const succeeded: FunctionCallEnd = {
  state: variant('succeeded', { value: 'a'.repeat(64) }),
  endedAt: new Date(NOW + 1000),
  expiresAt: new Date(NOW + 1000 + HOUR_MS),
  stdout: 'out\n',
  stderr: 'err\n',
  stdoutTruncated: false,
  stderrTruncated: true,
};

describe('the function call transitions', () => {
  it('ends a running call with its end, and leaves an ended one: the first end stands', () => {
    const ended = callEnded(running(), succeeded);
    assert.ok(ended !== undefined);
    assert.ok(jobEqual(ended, {
      ...running(),
      call: {
        ...running().call, state: succeeded.state, endedAt: some(succeeded.endedAt), expiresAt: succeeded.expiresAt,
        stdout: 'out\n', stderr: 'err\n', stdoutTruncated: false, stderrTruncated: true,
      },
    }), 'its state, times and logs, and nothing else of it');
    assert.equal(callEnded(ended, { ...succeeded, state: variant('failed', { exitCode: 1n }) }), undefined);
  });

  it('asks a running call to cancel once, and no call that has ended', () => {
    const at = new Date(NOW + 500);
    const asked = callCancelAsked(running(), { by: some('grace@example.com'), at });
    assert.ok(asked !== undefined && jobEqual(asked, { ...running(), cancel: some({ by: some('grace@example.com'), at }) }));
    assert.equal(callCancelAsked(asked, { by: none, at }), undefined, 'the first request stands');
    assert.equal(callCancelAsked(callEnded(running(), succeeded)!, { by: none, at }), undefined, 'an ended call is left as it is');
  });

  it("pins a running call's inputs whole, and no input of a call that has ended", () => {
    const inputs: FunctionCallJob['call']['inputs'] = [{ path: [variant('field', 'records'), variant('field', 'jobs')], hash: '2'.repeat(64) }];
    const pinned = callInputsPinned(running(), inputs);
    assert.ok(pinned !== undefined && jobEqual(pinned, { ...running(), call: { ...running().call, inputs } }), 'its inputs, and nothing else of it');
    assert.equal(callInputsPinned(callEnded(running(), succeeded)!, inputs), undefined);
  });

  it('applies a transition through the store\'s write, or answers the call as it is where it does not apply', async () => {
    const written: FunctionCallJob[] = [];
    const write = (moved: FunctionCallJob) => { written.push(moved); };
    const ended = await applyCallTransition(running(), (job) => callEnded(job, succeeded), write);
    assert.ok(ended !== null && written.length === 1 && jobEqual(written[0]!, ended), 'the call it leaves, written once and answered');
    const again = await applyCallTransition(ended, (job) => callEnded(job, succeeded), write);
    assert.ok(again !== null && jobEqual(again, ended) && written.length === 1, 'one it does not apply to, answered as it is, nothing written');
    assert.equal(await applyCallTransition(null, (job) => callEnded(job, succeeded), write), null, 'and no call, none');
  });

  it('a call is gone at its expiry, and not before', () => {
    assert.equal(callExpired(running(), NOW + HOUR_MS - 1), false);
    assert.equal(callExpired(running(), NOW + HOUR_MS), true);
  });

  it("a list takes a call of the function and the state it names; a one-shot is no function's", () => {
    assert.equal(callListed(running(), {}), true);
    assert.equal(callListed(running(), { function: 'quote', state: 'running' }), true);
    assert.equal(callListed(running(), { function: 'price' }), false);
    assert.equal(callListed(running(), { state: 'succeeded' }), false);
    assert.equal(callListed(running(null), { function: 'quote' }), false, 'a one-shot names no function');
    assert.equal(callListed(callEnded(running(), succeeded)!, { state: 'succeeded' }), true);
  });
});
