/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A run lease through the hub (`RACK_RUNS`): granted only to a rack that
 * hosts runs and boots its tiers, recording no attempt; its asks reach its
 * rack once each, in order, and its answers its asker as one event each; a
 * task's log is teed to the asker and stored by no one else; its reads keep
 * to its closure, and its writes are bounded by what is in flight; and it
 * ends with its session, or its rack's silence, as any lease does.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { inputsHash, uuidv7 } from '@elaraai/e3-core';
import { randomBytes } from 'node:crypto';
import { computeHash } from '@elaraai/e3-core';
import { OpenSessionResultType, OpenSessionType, RunAskResultType, RunAskType } from '../protocol/control.js';
import type { RackLeaseEvent } from '../protocol/task-envelope.js';
import type { RackLeaseGrant } from '../protocol/rack-wire.js';
import { socketRequest } from '../client/local-http.js';
import { encodeClosure } from '../lease/closure.js';
import { E3_RACK_VERSION } from '../version.js';
import { closeAll, event, fixture, type HubFixture, type HubSession } from './hub.test-utils.js';
import type { TestRackAgent } from '../testing/test-rack-agent.js';
import { processOwner } from '@elaraai/e3-core';

afterEach(closeAll);

/** A run lease's event, of a description and a closure object. */
function run(description: string, closure: string, count: number, tiers = ['node']): RackLeaseEvent {
  return { version: 2, taskName: 'run', workspace: 'dev', closure: { object: closure, count },
    runnerEvent: { mode: 'run', repo: 'replaced-by-hub', launchId: uuidv7(), timeoutMs: 60_000, description, force: false, tiers, verdicts: {} } };
}

/** A description and a closure object in the fixture's repository. */
async function described(f: HubFixture): Promise<{ description: string; closure: string; count: number; outside: string }> {
  const objects = [...(await f.objects(3, 64)).keys()];
  const outside = [...(await f.objects(1, 64)).keys()][0]!;
  const closure = await f.storage.objects.write(f.repo, encodeClosure(objects));
  return { description: objects[0]!, closure, count: objects.length, outside };
}

/** Asks a session's run lease for a task's result. */
function ask(f: HubFixture, session: HubSession, leaseId: string, name: string, executionId = uuidv7()): Promise<bigint> {
  return socketRequest(f.socket, 'POST', `/v1/sessions/${session.sessionId}/leases/${encodeURIComponent(leaseId)}/asks`, {
    requestType: RunAskType, responseType: RunAskResultType,
    body: { taskName: name, taskHash: computeHash(new TextEncoder().encode(name)), inputsHash: inputsHash([]), executionId },
  }).then(({ seq }) => seq);
}

/** The asks a rack is given, after a cursor. */
async function asks(agent: TestRackAgent, grant: RackLeaseGrant, after = 0, waitMs = 0): Promise<{ asks: Array<{ seq: number; taskName: string }>; cancelled: boolean }> {
  return await agent.runRequest('asks', { repo: grant.repo, leaseId: grant.leaseId, after, waitMs }) as { asks: Array<{ seq: number; taskName: string }>; cancelled: boolean };
}

/** A rack's claim, after its heartbeat has told the hub what it is. */
async function claim(agent: TestRackAgent): Promise<RackLeaseGrant | null> {
  await agent.heartbeat();
  return agent.claim();
}

it('grants a run lease only to a rack that hosts runs and boots every tier it needs, and records no attempt for it', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const session = await f.session();
  const { description, closure, count } = await described(f);
  const created = await session.create(run(description, closure, count, ['node', 'py']));

  assert.equal(await claim(await f.agent({ tiers: ['node', 'py'] })), null, 'not to a rack that hosts no run');
  assert.equal(await claim(await f.agent({ rackRuns: true, tiers: ['node'] })), null, 'nor to one missing a tier');
  const grant = await claim(await f.agent({ rackRuns: true, tiers: ['node', 'py'] }));
  assert.ok(grant !== null && grant.leaseId === created.leaseId);
  assert.deepEqual(await f.storage.refs.executionListIds(f.repo, description, inputsHash([])), [], 'no attempt is recorded');
  const claimed = (await session.events()).events.find((each) => each.event.type === 'claimed');
  assert.ok(claimed?.event.type === 'claimed' && claimed.event.value.attempt.type === 'none');
});

it('gives its rack each ask once, in order, and its asker each answer as one event, a repeated answer dropped', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const session = await f.session();
  const { description, closure, count } = await described(f);
  const { leaseId } = await session.create(run(description, closure, count));
  const agent = await f.agent({ rackRuns: true });
  const grant = (await claim(agent))!;

  assert.equal(await ask(f, session, leaseId, 'first'), 1n);
  assert.equal(await ask(f, session, leaseId, 'second'), 2n);
  const given = await asks(agent, grant);
  assert.deepEqual(given.asks.map(({ seq, taskName }) => [seq, taskName]), [[1, 'first'], [2, 'second']]);
  assert.equal(given.cancelled, false);
  assert.deepEqual((await asks(agent, grant, 2)).asks, [], 'none after the last');

  await agent.runRequest('answers', { repo: grant.repo, leaseId, answers: [{ seq: 2, answer: { kind: 'unknown' } }, { seq: 1, answer: { kind: 'handed-back', reason: 'no-room' } }] });
  await agent.runRequest('answers', { repo: grant.repo, leaseId, answers: [{ seq: 1, answer: { kind: 'unknown' } }] });
  const answered = (await session.events()).events.filter((each) => each.event.type === 'answered')
    .map((each) => each.event.type === 'answered' ? [each.event.value.seq, JSON.parse(each.event.value.answerJson) as unknown] : []);
  assert.deepEqual(answered, [[2n, { kind: 'unknown' }], [1n, { kind: 'handed-back', reason: 'no-room' }]]);
  assert.deepEqual((await asks(agent, grant)).asks, [], 'an answered ask is not given again');
});

it('tees a task\'s log to its asker under its attempt, and stores it nowhere else', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const session = await f.session();
  const { description, closure, count } = await described(f);
  const { leaseId } = await session.create(run(description, closure, count));
  const agent = await f.agent({ rackRuns: true });
  const grant = (await claim(agent))!;
  const executionId = uuidv7();
  const seq = await ask(f, session, leaseId, 'first', executionId);
  await agent.runRequest('logs', { repo: grant.repo, leaseId, seq: Number(seq), chunks: [{ stream: 'stdout', text: 'one\n' }, { stream: 'stderr', text: 'two\n' }] });
  assert.deepEqual(session.logs, ['one\n', 'two\n']);
  const taskHash = computeHash(new TextEncoder().encode('first'));
  assert.equal((await f.storage.logs.read(f.repo, taskHash, inputsHash([]), executionId, 'stdout')).size, 0, 'nothing was stored here');
  await assert.rejects(agent.runRequest('logs', { repo: grant.repo, leaseId, seq: 9, chunks: [] }), /403/);
});

it('keeps a run lease\'s reads to its closure, and its routes to a run lease its rack holds', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const session = await f.session();
  const { description, closure, count, outside } = await described(f);
  await session.create(run(description, closure, count));
  const agent = await f.agent({ rackRuns: true });
  const grant = (await claim(agent))!;
  assert.equal((await agent.storageRequest(grant, { need: [description] })).objects.length, 1);
  await assert.rejects(agent.storageRequest(grant, { need: [outside] }), /403/);

  // A task's lease is no run's
  await session.create(event([]));
  const task = (await agent.claim())!;
  assert.deepEqual(await asks(agent, task), { asks: [], cancelled: true });
  await assert.rejects(agent.runRequest('answers', { repo: task.repo, leaseId: task.leaseId, answers: [] }), /403/);
  // Nor is one another rack holds
  const other = await f.agent({ rackRuns: true });
  await other.heartbeat();
  await assert.rejects(other.runRequest('answers', { repo: grant.repo, leaseId: grant.leaseId, answers: [] }), /403/);
});

it('holds a poll of the asks open without holding back the lease\'s reads', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const session = await f.session();
  const { description, closure, count } = await described(f);
  await session.create(run(description, closure, count));
  const agent = await f.agent({ rackRuns: true });
  const grant = (await claim(agent))!;
  let polled = false;
  const poll = asks(agent, grant, 0, 1500).finally(() => { polled = true; });
  const started = Date.now();
  await agent.storageRequest(grant, { need: [description] });
  assert.ok(Date.now() - started < 1000, 'the read was not held behind the poll');
  assert.equal(polled, false, 'while the poll still waits');
  assert.deepEqual((await poll).asks, []);
});

it('writes more objects through one run lease than a lease may be issued targets for at once', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const session = await f.session();
  const { description, closure, count } = await described(f);
  await session.create(run(description, closure, count));
  const agent = await f.agent({ rackRuns: true });
  const grant = (await claim(agent))!;
  // Held here already: each leaves its target as it is declared
  const held = await f.objects(4200, 16);
  const fresh = new Map(Array.from({ length: 3 }, () => { const bytes = randomBytes(32); return [computeHash(bytes), bytes] as const; }));
  const written = await agent.writeObjects(grant, new Map([...held, ...fresh]));
  assert.deepEqual(written, { held: 4200, sent: 3 });
  for (const hash of fresh.keys()) assert.ok(await f.storage.objects.exists(f.repo, hash));
});

it('ends a run lease with its session, and tells its rack at its next poll', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const session = await f.session();
  const { description, closure, count } = await described(f);
  await session.create(run(description, closure, count));
  const agent = await f.agent({ rackRuns: true });
  const grant = (await claim(agent))!;
  const waiting = asks(agent, grant, 0, 5000);
  await session.close();
  assert.equal((await waiting).cancelled, true);
});

it('gives a run lease whose rack went quiet to another rack, with every ask not yet answered; with none, its session is told it is lost', async () => {
  const f = await fixture({ leaseWindowMs: 40, visibilityMs: 300 });
  const session = await f.session();
  const { description, closure, count } = await described(f);
  const { leaseId } = await session.create(run(description, closure, count));
  const quiet = await f.agent({ rackRuns: true });
  const grant = (await claim(quiet))!;
  await ask(f, session, leaseId, 'first');
  await ask(f, session, leaseId, 'second');
  await quiet.runRequest('answers', { repo: grant.repo, leaseId, answers: [{ seq: 1, answer: { kind: 'unknown' } }] });

  await new Promise((resolve) => setTimeout(resolve, 400));
  const next = await f.agent({ rackRuns: true });
  const taken = await claim(next);
  assert.ok(taken !== null && taken.leaseId === leaseId, 'another rack took it up');
  assert.deepEqual((await asks(next, taken)).asks.map(({ seq }) => seq), [2]);

  await new Promise((resolve) => setTimeout(resolve, 700));
  await f.hub.sweep();
  assert.ok((await session.events()).events.some((each) => each.event.type === 'lost'), 'its session is told it is lost');
});

it('refuses a session of the protocol before it', async () => {
  const f = await fixture();
  await assert.rejects(socketRequest(f.socket, 'POST', '/v1/sessions', { requestType: OpenSessionType, responseType: OpenSessionResultType, body: {
    protocol: 7n, e3Version: E3_RACK_VERSION, owner: await processOwner(), repoPath: f.repo,
    workspace: 'dev', label: 'old session', dataSocket: '/nowhere', dataToken: 'x'.repeat(32),
  } }));
});
