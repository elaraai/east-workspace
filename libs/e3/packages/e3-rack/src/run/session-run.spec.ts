/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A rack's run through a session, over a session that answers as the test
 * says: what its asks answer when the ask's signal aborts, when the run is
 * cancelled, and when its lease ends; how long it waits for a claim; and
 * where it says the run was placed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { variant } from '@elaraai/east';
import { InMemoryStorage } from '@elaraai/e3-core';
import { E3_RELEASE, type SyncDescription } from '@elaraai/e3-types';
import type { RackSession } from '../client/session.js';
import { sessionReplicaRun } from './session-run.js';

/** A description of no tasks: what a grant writes, and nothing it reaches. */
const description: SyncDescription = {
  release: E3_RELEASE,
  origin: { name: 'flow', version: '1.0.0', hash: '0'.repeat(64) },
  package: { tasks: new Map(), data: { structure: variant('struct', new Map()), refs: new Map() }, functions: new Map(), records: new Map(), sources: new Map() },
  deployedAt: new Date('2026-01-01T00:00:00Z'),
  datasets: new Map(),
  executions: [],
};

type Update = { kind: 'claimed'; rackId: string; rackLabel: string; attempt: null } | { kind: 'lost'; reason: string } | { kind: 'cancelled' } | { kind: 'completed' };

/** A session whose lease's updates, and whose asks' numbers and answers, the test gives. */
function scripted() {
  const updates: Update[] = [];
  const nexts: Array<(update: Update) => void> = [];
  const posted: Array<(seq: bigint) => void> = [];
  let answered: ((seq: bigint, answerJson: string) => void) | undefined;
  let cancelled = 0;
  const lease = {
    leaseId: 'lease-1',
    next: () => (updates.length > 0 ? Promise.resolve(updates.shift()!) : new Promise<Update>((resolve) => { nexts.push(resolve); })),
    cancel: () => { cancelled++; return Promise.resolve(); },
  };
  const session = {
    repoAlias: 'repo',
    createLease: () => Promise.resolve(lease),
    onAnswer: (_leaseId: string, listener: (seq: bigint, answerJson: string) => void) => { answered = listener; return () => { answered = undefined; }; },
    askRun: () => new Promise<bigint>((resolve) => { posted.push(resolve); }),
    onLog: () => () => undefined,
  } as unknown as RackSession;
  const storage = new InMemoryStorage();
  return {
    session,
    storage,
    /** Gives the lease an update */
    update(update: Update): void {
      const next = nexts.shift();
      if (next !== undefined) next(update);
      else updates.push(update);
    },
    /** Gives the oldest ask posted its number */
    number(seq: bigint): void { posted.shift()?.(seq); },
    /** Answers an ask by its number */
    answer(seq: bigint, answer: unknown): void { answered?.(seq, JSON.stringify(answer)); },
    posted: () => posted.length,
    cancelled: () => cancelled,
  };
}

const ask = (signal?: AbortSignal) => ({ taskName: 'first', taskHash: 'a'.repeat(64), inputsHash: 'b'.repeat(64), ...(signal !== undefined && { signal }) });

async function granted(s: ReturnType<typeof scripted>, signal?: AbortSignal) {
  await s.storage.repos.create('repo');
  const run = sessionReplicaRun(s.session, {
    storage: s.storage, repo: 'repo', workspace: 'dev', verdicts: new Map(), claimTimeoutMs: 5000, timeoutMs: 60_000,
    ...(signal !== undefined && { signal }),
  });
  return run;
}

describe('a rack\'s run through a session', () => {
  it('says the rack that took the run up, and its lease', async () => {
    const s = scripted();
    const run = await granted(s);
    s.update({ kind: 'claimed', rackId: 'r1', rackLabel: 'rack one', attempt: null });
    await run.grant({ description, force: false });
    assert.deepEqual(run.placedOn(), { rackLabel: 'rack one', leaseId: 'lease-1' });
  });

  it('answers an ask unknown at once when its signal aborts while it is being posted', async () => {
    const s = scripted();
    const run = await granted(s);
    s.update({ kind: 'claimed', rackId: 'r1', rackLabel: 'rack one', attempt: null });
    await run.grant({ description, force: false });
    const controller = new AbortController();
    const asking = run.ask(ask(controller.signal));
    for (let i = 0; i < 100 && s.posted() === 0; i++) await delay(5);
    assert.equal(s.posted(), 1, 'the ask is being posted');
    controller.abort();
    assert.deepEqual(await asking, { kind: 'unknown' }, 'answered before its post came back');
    assert.deepEqual(await run.ask(ask(controller.signal)), { kind: 'unknown' }, 'and one asked once it aborted, at once');
  });

  it('answers the asks still waiting unknown when it is cancelled, or its lease ends but lost, and fails them when it is lost', async () => {
    for (const ending of ['cancel', 'completed', 'lost'] as const) {
      const s = scripted();
      const run = await granted(s);
      s.update({ kind: 'claimed', rackId: 'r1', rackLabel: 'rack one', attempt: null });
      await run.grant({ description, force: false });
      const asking = run.ask(ask());
      for (let i = 0; i < 100 && s.posted() === 0; i++) await delay(5);
      s.number(1n);
      await delay(10);
      if (ending === 'cancel') await run.cancel();
      else s.update(ending === 'lost' ? { kind: 'lost', reason: 'its rack went quiet' } : { kind: 'completed' });
      if (ending === 'lost') await assert.rejects(asking, /lost: its rack went quiet/);
      else assert.deepEqual(await asking, { kind: 'unknown' }, `${ending}: unknown`);
    }
  });

  it('gives up waiting for a rack to take the run up when its signal aborts, and cancels its lease', async () => {
    const s = scripted();
    const controller = new AbortController();
    const run = await granted(s, controller.signal);
    const granting = run.grant({ description, force: false });
    await delay(20);
    controller.abort();
    await assert.rejects(granting, /stopped before a rack took it up/);
    assert.equal(s.cancelled(), 1);
  });
});
