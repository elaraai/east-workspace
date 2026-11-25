/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A lease's split scope through the hub — a split task's execution: a task's
 * or a unit's lease that names one is granted with it only to a rack whose
 * report names `split-scopes`, and a call's never; the rack is told once the
 * scope ended — by its session, or as its session ends or expires; and a
 * lease of a scope goes first to a rack that holds some of what it reads, as
 * the scope's completed leases wrote it, when that rack could take it. The
 * hub's own scope is `hub-keyed-scopes.spec.ts`'.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { uuidv7 } from '@elaraai/e3-core';
import { IntegerType, encodeBeast2For } from '@elaraai/east';
import { EmptyType, EndScopeType } from '../protocol/control.js';
import { RACK_SCOPES_ENDED_BYTES, RACK_SPLIT_SCOPES } from '../protocol/rack-json.js';
import type { RackLeaseEvent, RackLeaseScope } from '../protocol/task-envelope.js';
import { splitUnitToWire } from '../runner-event.js';
import { socketRequest } from '../client/local-http.js';
import { SCOPE_AFFINITY_MS } from './hub.js';
import { call, closeAll, fixture, type HubFixture, type HubSession } from './hub.test-utils.js';
import type { TestRackAgent } from '../testing/test-rack-agent.js';

afterEach(closeAll);

const GiB = 1024 ** 3;
const resources = { cores: 4, memoryBytes: 8 * GiB, gpus: 0 };
const failed = { taskName: 'task', status: 'failed' as const };

/** A unit's lease event, named by its one input, in the scope given. */
function unit(name: string, scope?: RackLeaseScope): RackLeaseEvent {
  return { version: 2, taskName: 'task', workspace: 'dev', closure: { hashes: [] },
    resources: { kind: 'unit', cores: 1, memoryBytes: GiB, gpu: false }, ...(scope !== undefined && { scope }),
    runnerEvent: { mode: 'unit', repo: 'replaced-by-hub', taskHash: 'a'.repeat(64), launchId: uuidv7(), timeoutMs: 30000,
      unit: splitUnitToWire({ inputs: [name.repeat(64)], merge: null, own: false }) } };
}

/** A whole task's lease event, reading the inputs given, in the scope given. */
function task(inputs: string[], scope?: RackLeaseScope): RackLeaseEvent {
  return { version: 2, taskName: 'task', workspace: 'dev', closure: { hashes: inputs },
    resources: { kind: 'task', cores: 1, memoryBytes: GiB, gpu: false }, ...(scope !== undefined && { scope }),
    runnerEvent: { mode: 'task', repo: 'replaced-by-hub', taskHash: 'a'.repeat(64), inputHashes: inputs, launchId: uuidv7(), timeoutMs: 30000 } };
}

/** A merge unit's lease event, merging the parts given, in the scope given. */
function merge(parts: string[], scope: RackLeaseScope): RackLeaseEvent {
  return { version: 2, taskName: 'task', workspace: 'dev', closure: { hashes: parts }, scope,
    resources: { kind: 'unit', cores: 1, memoryBytes: GiB, gpu: false },
    runnerEvent: { mode: 'unit', repo: 'replaced-by-hub', taskHash: 'a'.repeat(64), launchId: uuidv7(), timeoutMs: 30000,
      unit: splitUnitToWire({ inputs: ['merge', ...parts], merge: { parts, range: null }, own: false }) } };
}

let written = 0n;
/** Claims the next lease the rack is granted, and completes it with an output
 *  of its own, written to the session's repository as the rack's upload would:
 *  the output's hash. */
async function runs(f: HubFixture, agent: TestRackAgent, leaseId?: string): Promise<string> {
  const grant = await agent.claim(); assert(grant);
  if (leaseId !== undefined) assert.equal(grant.leaseId, leaseId);
  const outputHash = await f.storage.objects.write(f.repo, encodeBeast2For(IntegerType)(++written));
  assert.equal((await agent.complete(grant, { taskName: 'task', status: 'success', outputHash })).disposition.type, 'recorded');
  return outputHash;
}

/** Ends a scope through a session's control route, as its session does once its split task has ended. */
function endScope(f: HubFixture, session: HubSession, scope: string): Promise<unknown> {
  return socketRequest(f.socket, 'POST', `/v1/sessions/${session.sessionId}/scopes/end`, { requestType: EndScopeType, body: { scope }, responseType: EmptyType });
}

it('grants a unit\'s lease with its scope only to a rack that keeps scopes, and tells that rack once, with its next heartbeat, that the scope ended', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const session = await f.session();
  const keeps = await f.agent({ resources, splitScopes: true, label: 'keeps' });
  const older = await f.agent({ resources, label: 'older' });
  assert.ok((await f.status()).capacity.racks.find((rack) => rack.label === 'keeps')?.features.includes(RACK_SPLIT_SCOPES));
  const scope = { id: uuidv7(), feeds: true };

  await session.create(unit('1', scope));
  const kept = await keeps.claim(); assert(kept);
  assert.deepEqual((JSON.parse(kept.eventJson) as RackLeaseEvent).scope, scope, 'a rack that keeps scopes is told the lease\'s');
  // Another scope's, which no rack holds yet, so any rack may take it
  const another = { id: uuidv7(), feeds: true };
  await session.create(unit('2', another));
  const told = await older.claim(); assert(told);
  assert.equal((JSON.parse(told.eventJson) as RackLeaseEvent).scope, undefined, 'one that does not is granted the same lease without it');
  assert.equal('scope' in (JSON.parse(told.eventJson) as object), false);
  await keeps.complete(kept, failed); await older.complete(told, failed);

  await keeps.heartbeat(); await older.heartbeat();
  assert.deepEqual([keeps.scopesEnded, older.scopesEnded], [[], []], 'no scope has ended yet');
  await endScope(f, session, scope.id);
  await endScope(f, session, another.id);
  await keeps.heartbeat(); await older.heartbeat();
  assert.deepEqual(keeps.scopesEnded, [scope.id], 'the rack that holds it is told it ended');
  assert.deepEqual(older.scopesEnded, [], 'a rack it was never granted to is told nothing');
  await keeps.heartbeat();
  assert.deepEqual(keeps.scopesEnded, [scope.id], 'and is told once');

  // A lease that still names an ended scope is granted without it
  await session.create(unit('3', scope));
  const late = await keeps.claim(); assert(late);
  assert.equal((JSON.parse(late.eventJson) as RackLeaseEvent).scope, undefined);
});

it('ends every scope a session\'s leases named as the session ends, and keeps no scope another session named', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const first = await f.session();
  const second = await f.session();
  const keeps = await f.agent({ resources, splitScopes: true });
  const scope = { id: uuidv7(), feeds: false };
  await first.create(unit('1', scope));
  const granted = await keeps.claim(); assert(granted);
  assert.deepEqual((JSON.parse(granted.eventJson) as RackLeaseEvent).scope, scope);

  // Another session's lease that names the first's scope is the same work without it
  await second.create(unit('2', scope));
  const other = await keeps.claim(); assert(other);
  assert.equal((JSON.parse(other.eventJson) as RackLeaseEvent).scope, undefined);
  // Nor does another session end it
  await endScope(f, second, scope.id);
  await keeps.heartbeat();
  assert.deepEqual(keeps.scopesEnded, []);

  await keeps.complete(granted, failed); await keeps.complete(other, failed);
  await first.close();
  await keeps.heartbeat();
  assert.deepEqual(keeps.scopesEnded, [scope.id], 'its session ended: so did its scope');
});

it('grants a merge of a scope first to a rack that wrote some of its parts, and to another once it has waited', async () => {
  let time = Date.now();
  const f = await fixture({ now: () => time, leaseWindowMs: 40 });
  const session = await f.session();
  const holder = await f.agent({ resources, splitScopes: true, label: 'holder' });
  const other = await f.agent({ resources, splitScopes: true, label: 'other' });
  const scope = { id: uuidv7(), feeds: true };
  await session.create(unit('1', scope));
  const piece = await runs(f, holder);

  // The merge waits for the rack that wrote the piece; work of no scope does not
  const merged = await session.create(merge([piece], { id: scope.id, feeds: false }));
  const unscoped = await session.create(unit('3'));
  assert.equal((await other.claim())?.leaseId, unscoped.leaseId, 'another rack is granted the work behind it');
  assert.equal(await other.claim(), null, 'and not the merge, while the rack that holds its parts may take it');
  const there = await holder.claim();
  assert.equal(there?.leaseId, merged.leaseId);
  await holder.complete(there, failed);

  // A piece of the scope reads nothing it wrote: it waits for no rack
  const fresh = await session.create(unit('4', scope));
  const taken = await other.claim();
  assert.equal(taken?.leaseId, fresh.leaseId);
  await other.complete(taken, failed);

  // One the holding rack has not taken once it has waited goes to another
  const next = await session.create(merge([piece], scope));
  assert.equal(await other.claim(), null);
  time += SCOPE_AFFINITY_MS + 1;
  await holder.heartbeat(); await other.heartbeat();
  assert.equal((await other.claim())?.leaseId, next.leaseId);
});

it('holds a lease of a scope back for no rack that holds what it reads but runs another tier, or could never hold its work', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const session = await f.session();
  // A rack of the node tier alone, and a small one, each holding what a later lease reads
  const nodeOnly = await f.agent({ resources, splitScopes: true, label: 'node-only' });
  const small = await f.agent({ resources: { cores: 4, memoryBytes: 2 * GiB, gpus: 0 }, splitScopes: true, label: 'small' });
  const other = await f.agent({ resources: { cores: 4, memoryBytes: 16 * GiB, gpus: 0 }, splitScopes: true, label: 'other', tiers: ['node', 'py'] });
  const scope = { id: uuidv7(), feeds: true };
  await session.create(task(['b'.repeat(64)], scope));
  const made = await runs(f, nodeOnly);
  await session.create(unit('1', scope));
  const piece = await runs(f, small);

  // A py task reads what the node rack made: that rack never runs it, so another is granted it at once
  const py = await session.create(task([made], scope), [], 'py');
  const onOther = await other.claim();
  assert.equal(onOther?.leaseId, py.leaseId, 'the rack that wrote its input runs no py');
  await other.complete(onOther, failed);
  // A merge capped at 8 GiB reads the small rack's piece: that rack could never hold it
  const merged = await session.create({ ...merge([piece], scope), resources: { kind: 'unit', cores: 1, memoryBytes: 8 * GiB, gpu: false } });
  const mergedOn = await other.claim();
  assert.equal(mergedOn?.leaseId, merged.leaseId, 'the rack that wrote its part has 2 GiB in all');
  await other.complete(mergedOn, failed);
  // A node task reading the node rack's output still waits for that rack, which could take it
  const node = await session.create(task([made], scope));
  assert.equal(await other.claim(), null, 'a holder that could take the lease is still waited for');
  assert.equal((await nodeOnly.claim())?.leaseId, node.leaseId);
});

it('grants a whole task\'s lease with its scope to a rack that keeps scopes, and a call\'s with none', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const session = await f.session();
  const keeps = await f.agent({ resources, splitScopes: true });
  const scope = { id: uuidv7(), feeds: true };
  await session.create(task(['b'.repeat(64)], scope));
  const granted = await keeps.claim(); assert(granted);
  assert.deepEqual((JSON.parse(granted.eventJson) as RackLeaseEvent).scope, scope, 'a scope a whole task\'s lease names rides it');
  await keeps.complete(granted, failed);
  const [program] = (await f.objects(1, 64)).keys();
  await session.create({ ...call(program!, 2n), scope });
  const called = await keeps.claim(); assert(called);
  assert.equal('scope' in (JSON.parse(called.eventJson) as object), false, 'a call writes nothing a later lease reads');
});

it('sends a lease of a scope first to the rack that wrote some of what it reads, input by input', async () => {
  let time = Date.now();
  const f = await fixture({ now: () => time, leaseWindowMs: 40 });
  const session = await f.session();
  const first = await f.agent({ resources, splitScopes: true, label: 'first' });
  const second = await f.agent({ resources, splitScopes: true, label: 'second' });
  const older = await f.agent({ resources, label: 'older' });
  const scope = { id: uuidv7(), feeds: true };
  // Two tasks of the session, one on each rack; a third's on a rack that keeps
  // no scope, and a fourth's that feeds nothing, so neither rack holds theirs
  const one = await session.create(task(['b'.repeat(64)], scope));
  const a = await runs(f, first, one.leaseId);
  const two = await session.create(task(['c'.repeat(64)], scope));
  const b = await runs(f, second, two.leaseId);
  await session.create(task(['d'.repeat(64)], scope));
  const c = await runs(f, older);
  await session.create(task(['e'.repeat(64)], { id: scope.id, feeds: false }));
  const d = await runs(f, first);

  // Each later task goes to the rack that made its input, not the session's first
  const readsA = await session.create(task([a], scope));
  assert.equal(await second.claim(), null, 'the rack that wrote none of its inputs waits');
  const onFirst = await first.claim();
  assert.equal(onFirst?.leaseId, readsA.leaseId);
  const readsB = await session.create(task([b], scope));
  assert.equal(await first.claim(), null);
  const onSecond = await second.claim();
  assert.equal(onSecond?.leaseId, readsB.leaseId);
  // What no rack that keeps scopes wrote there, or a lease that feeds none wrote, waits for no rack
  const readsC = await session.create(task([c, d], scope));
  const anywhere = await second.claim();
  assert.equal(anywhere?.leaseId, readsC.leaseId);
  await first.complete(onFirst, failed); await second.complete(onSecond, failed); await second.complete(anywhere, failed);
  // Work of no scope reading what the scope wrote waits for no rack
  const unscoped = await session.create(task([a]));
  const unscopedOn = await second.claim();
  assert.equal(unscopedOn?.leaseId, unscoped.leaseId);
  await second.complete(unscopedOn, failed);

  // Once the scope ends, what its racks wrote of it is let go: a lease that
  // names it is the same work of no scope, and waits for no rack
  await endScope(f, session, scope.id);
  const after = await session.create(task([a], scope));
  assert.equal((await second.claim())?.leaseId, after.leaseId);
});

it('ends a session\'s scopes as the hub finds the session silent, and tells each rack once', async () => {
  let time = Date.now();
  const f = await fixture({ now: () => time, leaseWindowMs: 40 });
  const session = await f.session();
  const keeps = await f.agent({ resources, splitScopes: true });
  const scope = { id: uuidv7(), feeds: true };
  await session.create(task(['b'.repeat(64)], scope));
  await runs(f, keeps);
  await keeps.heartbeat();
  assert.deepEqual(keeps.scopesEnded, []);
  // No poll for longer than the hub waits: the sweep ends the session, and its scopes
  time += 46_000;
  await f.hub.sweep();
  await keeps.heartbeat();
  assert.deepEqual(keeps.scopesEnded, [scope.id]);
  await keeps.heartbeat();
  assert.deepEqual(keeps.scopesEnded, [scope.id], 'and once');
});

it('tells a rack of more ended scopes than one answer\'s header holds over its next heartbeats, each within its bound, losing none', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const session = await f.session();
  const keeps = await f.agent({ resources, splitScopes: true });
  // Scopes of the longest id a scope may have: a header of all of them would pass what an HTTP client takes
  const ids = Array.from({ length: 250 }, (_, i) => `${uuidv7()}-${String(i).padStart(27, '0')}`);
  assert.equal(ids[0]!.length, 64);
  for (const [i, id] of ids.entries()) {
    await session.create({ ...unit('1', { id, feeds: true }), runnerEvent: { ...unit('1').runnerEvent, unit: splitUnitToWire({ inputs: [i.toString(16).padStart(64, '0')], merge: null, own: false }) } } as RackLeaseEvent);
    const granted = await keeps.claim(); assert(granted);
    await keeps.complete(granted, failed);
  }
  for (const id of ids) await endScope(f, session, id);
  // A heartbeat at a time, until the rack has been told of every one
  for (let beats = 0; keeps.scopesEnded.length < ids.length && beats < 10; beats++) await keeps.heartbeat();
  assert.deepEqual(keeps.scopesEnded, ids, 'every one, once, in the order they ended');
  assert.ok(keeps.scopesEndedHeaderBytes.length >= 2, `told over ${keeps.scopesEndedHeaderBytes.length} answers`);
  assert.ok(keeps.scopesEndedHeaderBytes.every((bytes) => bytes <= RACK_SCOPES_ENDED_BYTES), `${keeps.scopesEndedHeaderBytes.join(', ')}`);
});

it('forgets what a rack that rebooted held of every scope, and tells it of no scope it was granted before', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const session = await f.session();
  const rebooting = await f.agent({ resources, splitScopes: true, label: 'rebooting' });
  const other = await f.agent({ resources, splitScopes: true, label: 'other' });
  await rebooting.heartbeat();
  const scope = { id: uuidv7(), feeds: true };
  await session.create(task(['b'.repeat(64)], scope));
  const wrote = await runs(f, rebooting);
  // Of the same boot, a lease that reads what it wrote waits for it
  const held = await session.create(task([wrote], scope));
  assert.equal(await other.claim(), null);
  const there = await rebooting.claim(); assert.equal(there?.leaseId, held.leaseId);
  await rebooting.complete(there, failed);

  // Its host restarts: its next heartbeat names another boot, and its disk, kept by boot, holds none of it
  rebooting.reboot();
  await rebooting.heartbeat();
  // A lease that reads what it wrote waits for it no more
  const reads = await session.create(task([wrote], scope));
  assert.equal((await other.claim())?.leaseId, reads.leaseId);
  // Nor is it told the end of a scope it was granted before it rebooted, which it no longer keeps
  await endScope(f, session, scope.id);
  await rebooting.heartbeat();
  assert.deepEqual(rebooting.scopesEnded, []);
});

it('keeps at most a session\'s share of the hub\'s scopes open, so one session never takes the scopes of another', async () => {
  const f = await fixture({ leaseWindowMs: 40, scopesPerSession: 2 });
  const greedy = await f.session();
  const another = await f.session();
  const keeps = await f.agent({ resources, splitScopes: true });
  const granted = async (session: HubSession, name: string, scope: RackLeaseScope) => {
    await session.create(unit(name, scope));
    const grant = await keeps.claim(); assert(grant);
    await keeps.complete(grant, failed);
    return (JSON.parse(grant.eventJson) as RackLeaseEvent).scope;
  };
  const [first, second, third] = [uuidv7(), uuidv7(), uuidv7()].map((id) => ({ id, feeds: true }));
  assert.deepEqual(await granted(greedy, '1', first!), first);
  assert.deepEqual(await granted(greedy, '2', second!), second);
  assert.equal(await granted(greedy, '3', third!), undefined, 'past its share, the lease is the same work of no scope');
  assert.deepEqual(await granted(greedy, '4', first!), first, 'a scope it holds open is still named');
  const others = { id: uuidv7(), feeds: true };
  assert.deepEqual(await granted(another, '5', others), others, 'another session is granted its own');
  // Once one of its scopes ends, a new one is the session's again
  await endScope(f, greedy, first!.id);
  assert.deepEqual(await granted(greedy, '6', third!), third);
});
