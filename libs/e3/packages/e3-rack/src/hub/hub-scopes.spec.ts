/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A split task's scope through the hub: a unit's lease is granted with it only
 * to a rack whose report names `split-scopes`, the rack is told once the
 * scope ended — by its session, or as its session ends — and a unit of a
 * scope goes first to a rack that holds some of it.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { uuidv7 } from '@elaraai/e3-core';
import { EmptyType, EndScopeType } from '../protocol/control.js';
import { RACK_SPLIT_SCOPES } from '../protocol/rack-json.js';
import type { RackLeaseEvent, RackLeaseScope } from '../protocol/task-envelope.js';
import { splitUnitToWire } from '../runner-event.js';
import { socketRequest } from '../client/local-http.js';
import { SCOPE_AFFINITY_MS } from './hub.js';
import { closeAll, fixture, type HubFixture, type HubSession } from './hub.test-utils.js';

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

it('grants a unit of a scope first to a rack that holds some of it, and to another once it has waited', async () => {
  let time = Date.now();
  const f = await fixture({ now: () => time, leaseWindowMs: 40 });
  const session = await f.session();
  const holder = await f.agent({ resources, splitScopes: true, label: 'holder' });
  const other = await f.agent({ resources, splitScopes: true, label: 'other' });
  const scope = { id: uuidv7(), feeds: true };
  await session.create(unit('1', scope));
  const piece = await holder.claim(); assert(piece);
  await holder.complete(piece, failed);

  // The merge waits for the rack that holds the piece; work of no scope does not
  const merge = await session.create(unit('2', { id: scope.id, feeds: false }));
  const unscoped = await session.create(unit('3'));
  assert.equal((await other.claim())?.leaseId, unscoped.leaseId, 'another rack is granted the work behind it');
  assert.equal(await other.claim(), null, 'and not the merge, while the rack that holds its pieces may take it');
  const there = await holder.claim();
  assert.equal(there?.leaseId, merge.leaseId);
  await holder.complete(there, failed);

  // One the holding rack has not taken once it has waited goes to another
  const next = await session.create(unit('4', scope));
  assert.equal(await other.claim(), null);
  time += SCOPE_AFFINITY_MS + 1;
  await holder.heartbeat(); await other.heartbeat();
  assert.equal((await other.claim())?.leaseId, next.leaseId);
});
