/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A rack policy that keeps what work wrote on a rack for the whole session
 * (`keep` `session`), through a real hub, racks and runner: every task's and
 * unit's lease of the session names one scope; a split task's end does not
 * end it, the session's close does; a later task goes to the rack that made
 * its input and reads it there; and under the default (`split`) a whole
 * task's lease names none, as before.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ArrayType, East, IntegerType, StringType, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { Budget, LocalStorage, datasetWrite, packageImport, packageRead, repoInit } from '@elaraai/e3-core';
import { RackHub } from '../hub/hub.js';
import { RackLinkMeter } from '../hub/link-meter.js';
import { defaultHubConfig, saveHubConfig } from '../hub/config.js';
import { HubClient } from '../client/hub-client.js';
import { TestRackAgent } from '../testing/test-rack-agent.js';
import { DEFAULT_RACK_POLICY, setMode, type RackPolicy } from '../routing/policy.js';
import { openRackRunner } from './rack-runner.js';
import type { RackLeaseEvent } from '../protocol/task-envelope.js';
import type { RackPlacementEvent } from '../protocol/placement.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

/** Every task on a rack, kept for the session. */
const SESSION: RackPolicy = { ...setMode(DEFAULT_RACK_POLICY, 'auto'), keep: variant('session', null) };

/** A hub that measures its links (with the meter given), racks of the labels
 *  given (each keeping scopes unless said), and a runner under the policy
 *  given, rack-only unless said. */
async function fixture(policy: RackPolicy, racks: Array<{ label: string; splitScopes?: boolean }>, options: { rackOnly?: boolean; meter?: RackLinkMeter } = {}) {
  const { rackOnly = true, meter = new RackLinkMeter() } = options;
  const home = await mkdtemp(join(tmpdir(), 'e3ss-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  await saveHubConfig({ ...defaultHubConfig(), listen: some({ host: '127.0.0.1', port: 0n }) }, home);
  // A rack's poll that finds no work it may take answers soon
  const hub = new RackHub({ foreground: true, home, leaseWindowMs: 40, linkMeter: meter }); assert(await hub.start()); cleanup.push(() => hub.stop());
  const client = new HubClient(home);
  const agents: TestRackAgent[] = [];
  for (const { label, splitScopes = true } of racks) {
    const mint = await client.enroll();
    const agent = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, { label, tiers: ['node'], resources: { cores: 8, memoryBytes: 16 * 1024 ** 3, gpus: 0 },
      splitScopes, certificateSha256: mint.certificateSha256.type === 'some' ? mint.certificateSha256.value : undefined });
    cleanup.push(() => agent.close());
    agents.push(agent);
  }
  const repo = join(home, 'repo'); assert(repoInit(repo).success);
  const storage = new LocalStorage();
  const budget = new Budget({ cores: 2, memory: 1024 ** 3 }, { sampler: null });
  const placements: RackPlacementEvent[] = [];
  const open = async (as: RackPolicy) => {
    const opened = await openRackRunner({ repoPath: repo, workspace: 'dev', storage, label: 'session scope test', home, budget,
      policy: as, rackOnly, waitForRackMs: 0, onPlacement: (event) => { placements.push(event); } });
    cleanup.push(() => opened.close());
    return opened;
  };
  const rack = await open(policy);
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await rack.close(); } };
  // The tasks: a text's length, a number doubled, which reads the length, and a text shouted
  const text = e3.input('text', StringType);
  const number = e3.input('number', IntegerType);
  const length = e3.task('length', [text], East.function([StringType], IntegerType, (_$, value) => value.length()));
  const double = e3.task('double', [number], East.function([IntegerType], IntegerType, (_$, value) => value.add(value)));
  const shout = e3.task('shout', [text], East.function([StringType], StringType, (_$, value) => value.concat('!')));
  const zip = join(home, 'chain.zip'); await e3.export(e3.package('chain', '1.0.0', length, double, shout), zip);
  await packageImport(storage, repo, zip);
  const tasks = (await packageRead(storage, repo, 'chain', '1.0.0')).tasks;
  return { home, client, meter, agents, repo, storage, rack, open, close, placements,
    length: tasks.get('length')!, double: tasks.get('double')!, shout: tasks.get('shout')! };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Waits for work to be queued on the hub. */
async function queued(f: Fixture): Promise<void> {
  for (const until = Date.now() + 10_000; Number((await f.client.status()).capacity.queued) === 0;) {
    if (Date.now() > until) assert.fail(`no work was queued: ${JSON.stringify(f.placements.at(-1))}`);
    await delay(10);
  }
}

/** Runs a task on the rack given, which takes its one lease: the run's result, and the lease's event. */
async function onRack(f: Fixture, agent: TestRackAgent, taskHash: string, inputs: string[], taskName: string) {
  const running = f.rack.runner.execute(f.storage, taskHash, inputs, { taskName });
  await queued(f);
  const grant = await agent.claim(); assert(grant);
  const event = JSON.parse(grant.eventJson) as RackLeaseEvent;
  assert.equal((await agent.execute(grant)).status, 'success');
  const result = await running;
  assert.equal(result.state, 'success', result.error);
  return { result, event };
}

/** The scopes the rack's heartbeats are told ended, once one is, or none in the time given. */
async function toldEnded(agent: TestRackAgent, ms = 5000): Promise<string[]> {
  for (const until = Date.now() + ms; agent.scopesEnded.length === 0 && Date.now() < until;) { await agent.heartbeat(); await delay(20); }
  return [...agent.scopesEnded];
}

it('names no scope on a whole task\'s lease under the default, as before, and none to a rack that keeps no scopes under keep session', async () => {
  const split = await fixture(setMode(DEFAULT_RACK_POLICY, 'auto'), [{ label: 'keeps' }]);
  assert.equal(DEFAULT_RACK_POLICY.keep.type, 'split', 'the default keeps what work wrote for a split task alone');
  const text = await datasetWrite(split.storage, split.repo, 'scoped', StringType);
  const first = await onRack(split, split.agents[0]!, split.length, [text], 'length');
  const second = await onRack(split, split.agents[0]!, split.double, [first.result.outputHash!], 'double');
  assert.equal(first.event.scope, undefined);
  assert.equal(second.event.scope, undefined);

  const older = await fixture(SESSION, [{ label: 'older', splitScopes: false }]);
  const input = await datasetWrite(older.storage, older.repo, 'scoped', StringType);
  const leased = await onRack(older, older.agents[0]!, older.length, [input], 'length');
  assert.equal('scope' in leased.event, false, 'an agent from before scopes is granted the same lease without one');
});

it('names one session scope on every task\'s and unit\'s lease under keep session, which a split task\'s end does not end, and the session\'s close does', async () => {
  const original = process.env.E3_TEST_PIECE_BYTES;
  process.env.E3_TEST_PIECE_BYTES = '64';
  cleanup.push(() => { if (original === undefined) delete process.env.E3_TEST_PIECE_BYTES; else process.env.E3_TEST_PIECE_BYTES = original; return Promise.resolve(); });
  const f = await fixture(SESSION, [{ label: 'keeps' }]);
  const [agent] = f.agents; assert(agent);
  const text = await datasetWrite(f.storage, f.repo, 'scoped', StringType);
  const first = await onRack(f, agent, f.length, [text], 'length');
  const second = await onRack(f, agent, f.double, [first.result.outputHash!], 'double');
  const id = first.event.scope?.id; assert(id !== undefined);
  assert.deepEqual(first.event.scope, { id, feeds: true }, 'a whole task feeds the session\'s later work');
  assert.deepEqual(second.event.scope, { id, feeds: true }, 'and the next names the same scope');

  // A split task of the session: its units name the session's scope, not an execution's of their own
  const type = ArrayType(IntegerType);
  const rows = e3.input('rows', type);
  const split = e3.streamTask('split', { inputs: [e3.partition(rows)], output: e3.output.dict(IntegerType, IntegerType, { merge: (_$, _key, a, b) => a.add(b) }) },
    ($, values, emit) => { $.for(values, ($, row) => { $(emit(0n, row)); }); });
  const zip = join(f.home, 'split.zip'); await e3.export(e3.package('split', '1.0.0', split), zip);
  await packageImport(f.storage, f.repo, zip);
  const hash = (await packageRead(f.storage, f.repo, 'split', '1.0.0')).tasks.get('split')!;
  const inputs = [await datasetWrite(f.storage, f.repo, Array.from({ length: 8000 }, (_, i) => BigInt(i)), type)];
  const events: RackLeaseEvent[] = [];
  let ended = false;
  const pump = async () => {
    while (!ended) {
      if (Number((await f.client.status()).capacity.queued) === 0) { await delay(10); continue; }
      const grant = await agent.claim(); if (grant === null) continue;
      events.push(JSON.parse(grant.eventJson) as RackLeaseEvent);
      assert.equal((await agent.execute(grant)).status, 'success');
    }
  };
  const [remote] = await Promise.all([f.rack.runner.execute(f.storage, hash, inputs, { taskName: 'split' }).finally(() => { ended = true; }), pump()]);
  assert.equal(remote.state, 'success', remote.error);
  assert(events.some((event) => event.runnerEvent.mode === 'unit' && event.runnerEvent.unit.merge !== null), 'its merges were leased');
  assert(events.every((event) => event.scope?.id === id && event.scope.feeds), JSON.stringify(events.map((event) => event.scope)));

  // The split task ended, and a task of the session was cancelled: the session's scope did not end
  const abort = new AbortController();
  const cancelled = f.rack.runner.execute(f.storage, f.length, [await datasetWrite(f.storage, f.repo, 'cancelled', StringType)], { taskName: 'length', signal: abort.signal });
  await queued(f);
  abort.abort();
  assert.equal((await cancelled).cancelled, true);
  assert.deepEqual(await toldEnded(agent, 500), [], 'no split task\'s end, nor a cancelled task, ends the session\'s scope');

  // The session closed: its scope ended, told once
  await f.close();
  assert.deepEqual(await toldEnded(agent), [id]);
  await agent.heartbeat();
  assert.deepEqual(agent.scopesEnded, [id]);
});

it('sends a later task to the rack that made its input under keep session, which reads it there rather than over its link', async () => {
  const f = await fixture(SESSION, [{ label: 'made' }, { label: 'other' }]);
  const [made, other] = f.agents; assert(made && other);
  const text = await datasetWrite(f.storage, f.repo, 'an input made on a rack', StringType);
  const first = await onRack(f, made, f.length, [text], 'length');
  const output = first.result.outputHash!;
  assert.equal(await made.holds(output), true, 'the rack that made it has it');

  // The task that reads it waits for the rack that made it: the other is given nothing
  const running = f.rack.runner.execute(f.storage, f.double, [output], { taskName: 'double' });
  await queued(f);
  assert.equal(await other.claim(), null, 'a rack that holds none of its inputs waits while the one that does may take it');
  const grant = await made.claim(); assert(grant);
  assert.equal((JSON.parse(grant.eventJson) as RackLeaseEvent).scope?.id, first.event.scope?.id);
  assert.equal((await made.execute(grant)).status, 'success');
  assert.equal((await running).state, 'success');
  // Its input was read where it was made: the hub never served it to either rack
  const alias = (await f.client.status()).sessions[0]!.repoAlias;
  assert.equal(f.meter.link(made.rackId).holds(alias, output), false, 'the rack that made it was never sent it');
  assert.equal(await other.holds(output), false);
});

it('weighs a task under keep session as fetching nothing of what its scope wrote on a rack, where the same task of no scope is fetch-bound', async () => {
  // The hub's link meter on a clock the test sets, so the link can be measured slow
  let now = 0;
  const f = await fixture(SESSION, [{ label: 'made' }], { rackOnly: false, meter: new RackLinkMeter(() => now) });
  const [made] = f.agents; assert(made);
  const fetchBound = () => f.placements.filter((event) => event.kind === 'placed' && event.where === 'local' && event.reason === 'fetch-bound');
  // A first run of the length, on the rack, records how long it runs
  await onRack(f, made, f.length, [await datasetWrite(f.storage, f.repo, 'four', StringType)], 'length');
  // The link measures slow: 1 MiB over 1000 s, about 1 KB/s
  const transfer = f.meter.begin(made.rackId); now += 1_000_000; transfer.add(1024 * 1024); transfer.end();
  assert.ok(f.meter.link(made.rackId).bytesPerSecond! < 1100);

  // A text of about 100 KB, shouted on the rack (its first run follows its policy), whose length is then asked
  const big = await datasetWrite(f.storage, f.repo, randomBytes(50_000).toString('hex'), StringType);
  const shouted = (await onRack(f, made, f.shout, [big], 'shout')).result.outputHash!;
  const kept = await onRack(f, made, f.length, [shouted], 'length');
  assert.equal(kept.event.scope?.feeds, true);
  assert.deepEqual(fetchBound(), [], 'the rack holds what it made: nothing to fetch');

  // The same run again under the default: its lease would name no scope, and the rack is not known to hold the input
  const split = await f.open({ ...SESSION, keep: variant('split', null) });
  const here = await split.runner.execute(f.storage, f.length, [shouted], { taskName: 'length', force: true });
  assert.equal(here.state, 'success', here.error);
  const [event] = fetchBound();
  assert(event?.kind === 'placed' && event.where === 'local' && event.fetch !== undefined, JSON.stringify(f.placements));
  assert.ok(event.fetch.bytes >= (await f.storage.objects.stat(f.repo, shouted)).size, 'the shouted text, made on the rack, fetched back over the link');
});
