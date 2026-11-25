/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What a rack keeps of a hub's work, through a real hub, racks and runner: a
 * rack that keeps the hub's scope under its key (`hub-keyed-scopes`) is
 * granted every task's and unit's lease of every session with the one hub
 * scope, which no split task's end, no cancel and no session's close ends; a
 * later run's task goes to the rack that made or fetched its input and reads
 * it there; a rack that keeps split scopes alone is granted a unit's split
 * scope as before and a whole task's none; and a rack that keeps neither is
 * granted none.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ArrayType, East, IntegerType, StringType, some } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { Budget, LocalStorage, datasetWrite, packageImport, packageRead, repoInit } from '@elaraai/e3-core';
import { RackHub } from '../hub/hub.js';
import { defaultHubConfig, saveHubConfig } from '../hub/config.js';
import { HubClient } from '../client/hub-client.js';
import { TestRackAgent } from '../testing/test-rack-agent.js';
import { DEFAULT_RACK_POLICY, setMode, type RackPolicy } from '../routing/policy.js';
import { openRackRunner } from './rack-runner.js';
import type { RackLeaseEvent } from '../protocol/task-envelope.js';
import type { RackPlacementEvent } from '../protocol/placement.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

/** Every task on a rack. */
const AUTO: RackPolicy = setMode(DEFAULT_RACK_POLICY, 'auto');

/** A hub, racks of the labels given (each keeping split scopes, and the hub's
 *  scope, unless said), and a runner under the policy given, rack-only. */
async function fixture(policy: RackPolicy, racks: Array<{ label: string; splitScopes?: boolean; hubKeyedScopes?: boolean }>) {
  const rackOnly = true;
  const home = await mkdtemp(join(tmpdir(), 'e3ss-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  await saveHubConfig({ ...defaultHubConfig(), listen: some({ host: '127.0.0.1', port: 0n }) }, home);
  // A rack's poll that finds no work it may take answers soon
  const hub = new RackHub({ foreground: true, home, leaseWindowMs: 40 }); assert(await hub.start()); cleanup.push(() => hub.stop());
  const client = new HubClient(home);
  const agents: TestRackAgent[] = [];
  for (const { label, splitScopes = true, hubKeyedScopes = true } of racks) {
    const mint = await client.enroll();
    const agent = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, { label, tiers: ['node'], resources: { cores: 8, memoryBytes: 16 * 1024 ** 3, gpus: 0 },
      splitScopes, hubKeyedScopes, certificateSha256: mint.certificateSha256.type === 'some' ? mint.certificateSha256.value : undefined });
    cleanup.push(() => agent.close());
    agents.push(agent);
  }
  const repo = join(home, 'repo'); assert(repoInit(repo).success);
  const storage = new LocalStorage();
  const budget = new Budget({ cores: 2, memory: 1024 ** 3 }, { sampler: null });
  const placements: RackPlacementEvent[] = [];
  // Each runner opened is a session of its own: one `e3 dataflow run`
  const open = async () => {
    const opened = await openRackRunner({ repoPath: repo, workspace: 'dev', storage, label: 'hub scope test', home, budget,
      policy, rackOnly, waitForRackMs: 0, onPlacement: (event) => { placements.push(event); } });
    let closed = false;
    const close = async () => { if (!closed) { closed = true; await opened.close(); } };
    cleanup.push(close);
    return { runner: opened.runner, close };
  };
  // Every rack has heard the hub's answer once, and the hub has its report
  for (const agent of agents) await agent.heartbeat();
  // The tasks: a text's length, a number doubled, which reads the length, and a text shouted
  const text = e3.input('text', StringType);
  const number = e3.input('number', IntegerType);
  const length = e3.task('length', [text], East.function([StringType], IntegerType, (_$, value) => value.length()));
  const double = e3.task('double', [number], East.function([IntegerType], IntegerType, (_$, value) => value.add(value)));
  const shout = e3.task('shout', [text], East.function([StringType], StringType, (_$, value) => value.concat('!')));
  const zip = join(home, 'chain.zip'); await e3.export(e3.package('chain', '1.0.0', length, double, shout), zip);
  await packageImport(storage, repo, zip);
  const tasks = (await packageRead(storage, repo, 'chain', '1.0.0')).tasks;
  return { home, client, agents, repo, storage, open, placements,
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

/** A session's runner, as {@link fixture} opens one. */
type Run = Awaited<ReturnType<Fixture['open']>>;

/** Runs a task of a session on the rack given, which takes its one lease: the run's result, and the lease's event. */
async function onRack(f: Fixture, run: Run, agent: TestRackAgent, taskHash: string, inputs: string[], taskName: string) {
  const running = run.runner.execute(f.storage, taskHash, inputs, { taskName });
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

it('grants a rack that keeps neither scope no scope, and one that keeps split scopes alone none on a whole task\'s lease', async () => {
  const neither = await fixture(AUTO, [{ label: 'neither', splitScopes: false, hubKeyedScopes: false }]);
  const run = await neither.open();
  const input = await datasetWrite(neither.storage, neither.repo, 'scoped', StringType);
  const leased = await onRack(neither, run, neither.agents[0]!, neither.length, [input], 'length');
  assert.equal('scope' in leased.event, false, 'an agent from before scopes is granted the same lease without one');
  assert.deepEqual(neither.agents[0]!.hubKeys.filter((key) => key !== undefined), [], 'and is never told a key');

  const split = await fixture(AUTO, [{ label: 'split', hubKeyedScopes: false }]);
  const runs = await split.open();
  const text = await datasetWrite(split.storage, split.repo, 'scoped', StringType);
  const first = await onRack(split, runs, split.agents[0]!, split.length, [text], 'length');
  const second = await onRack(split, runs, split.agents[0]!, split.double, [first.result.outputHash!], 'double');
  assert.equal(first.event.scope, undefined, 'a whole task names no split scope');
  assert.equal(second.event.scope, undefined);
  assert.deepEqual(split.agents[0]!.hubKeys.filter((key) => key !== undefined), []);
});

it('grants a rack that keeps split scopes alone a split task\'s units with its execution\'s scope, as before', async () => {
  const original = process.env.E3_TEST_PIECE_BYTES;
  process.env.E3_TEST_PIECE_BYTES = '64';
  cleanup.push(() => { if (original === undefined) delete process.env.E3_TEST_PIECE_BYTES; else process.env.E3_TEST_PIECE_BYTES = original; return Promise.resolve(); });
  const f = await fixture(AUTO, [{ label: 'split', hubKeyedScopes: false }]);
  const [agent] = f.agents; assert(agent);
  const run = await f.open();
  const events = await runSplit(f, run, agent);
  const ids = new Set(events.map((event) => event.scope?.id));
  assert.equal(ids.size, 1, JSON.stringify(events.map((event) => event.scope)));
  assert(events.every((event) => event.scope !== undefined && event.scope.keyed === undefined), 'a split scope, not the hub\'s');
  // The split task ended: its scope did too, told to the rack
  assert.deepEqual(await toldEnded(agent), [...ids]);
});

/** Runs a split task of a session, its units on the rack given: the events of the leases the rack was granted. */
async function runSplit(f: Fixture, run: Run, agent: TestRackAgent): Promise<RackLeaseEvent[]> {
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
  const [remote] = await Promise.all([run.runner.execute(f.storage, hash, inputs, { taskName: 'split' }).finally(() => { ended = true; }), pump()]);
  assert.equal(remote.state, 'success', remote.error);
  assert(events.some((event) => event.runnerEvent.mode === 'unit' && event.runnerEvent.unit.merge !== null), 'its merges were leased');
  return events;
}

it('names the hub\'s scope on every task\'s and unit\'s lease of every session to a rack that keeps it, which no split task\'s end, cancel or session\'s close ends', async () => {
  const original = process.env.E3_TEST_PIECE_BYTES;
  process.env.E3_TEST_PIECE_BYTES = '64';
  cleanup.push(() => { if (original === undefined) delete process.env.E3_TEST_PIECE_BYTES; else process.env.E3_TEST_PIECE_BYTES = original; return Promise.resolve(); });
  const f = await fixture(AUTO, [{ label: 'keeps' }]);
  const [agent] = f.agents; assert(agent);
  const key = agent.hubKeys.at(-1); assert(key !== undefined, 'its heartbeat\'s answer gave it the hub\'s key');
  const run = await f.open();
  const text = await datasetWrite(f.storage, f.repo, 'scoped', StringType);
  const first = await onRack(f, run, agent, f.length, [text], 'length');
  const second = await onRack(f, run, agent, f.double, [first.result.outputHash!], 'double');
  assert.deepEqual(first.event.scope, { id: key.id, feeds: true, keyed: true }, 'a whole task feeds the hub\'s scope');
  assert.deepEqual(second.event.scope, first.event.scope, 'and the next names the same scope');
  assert.equal(JSON.stringify(first.event).includes(Buffer.from(key.key).toString('base64')), false, 'the key is in no lease\'s event');

  // A split task: its units name the hub's scope, not an execution's of their own
  const events = await runSplit(f, run, agent);
  assert(events.every((event) => event.scope?.id === key.id && event.scope.feeds && event.scope.keyed === true), JSON.stringify(events.map((event) => event.scope)));

  // A task of the session was cancelled, and the session closed: the hub's scope did not end
  const abort = new AbortController();
  const cancelled = run.runner.execute(f.storage, f.length, [await datasetWrite(f.storage, f.repo, 'cancelled', StringType)], { taskName: 'length', signal: abort.signal });
  await queued(f);
  abort.abort();
  assert.equal((await cancelled).cancelled, true);
  await run.close();
  assert.deepEqual(await toldEnded(agent, 500), [], 'no split task\'s end, cancel or session\'s close ends the hub\'s scope');
  assert.deepEqual(agent.hubKeys.at(-1), key, 'and the rack keeps the same key');

  // Another session's work names the same scope
  const later = await f.open();
  const third = await onRack(f, later, agent, f.shout, [text], 'shout');
  assert.deepEqual(third.event.scope, first.event.scope);
});

it('sends a later run\'s task to the rack that made or fetched its input, which reads it there rather than over its link', async () => {
  const f = await fixture(AUTO, [{ label: 'made' }, { label: 'other' }]);
  const [made, other] = f.agents; assert(made && other);
  const text = await datasetWrite(f.storage, f.repo, 'an input fetched by a rack', StringType);
  // A first run: its task fetches its input, and makes its output, on one rack
  const first = await f.open();
  const length = (await onRack(f, first, made, f.length, [text], 'length')).result.outputHash!;
  assert.ok(made.fetched.includes(text), 'its input crossed the link once');
  await first.close();

  // A second run, another session: a task reading what the first made waits for the rack that made it
  const second = await f.open();
  const fetchedBefore = made.fetched.length;
  const doubling = second.runner.execute(f.storage, f.double, [length], { taskName: 'double' });
  await queued(f);
  assert.equal(await other.claim(), null, 'a rack that holds none of its inputs waits while the one that does may take it');
  const grant = await made.claim(); assert(grant);
  assert.equal((await made.execute(grant)).status, 'success');
  assert.equal((await doubling).state, 'success');
  // And one reading what the first run fetched goes there too
  const shouting = second.runner.execute(f.storage, f.shout, [text], { taskName: 'shout' });
  await queued(f);
  assert.equal(await other.claim(), null, 'the rack that fetched its input is waited for');
  const shout = await made.claim(); assert(shout);
  assert.equal((await made.execute(shout)).status, 'success');
  assert.equal((await shouting).state, 'success');
  assert.deepEqual(made.fetched.slice(fetchedBefore).filter((hash) => hash === length || hash === text), [], 'neither input crossed the link again');
  assert.equal(await other.holds(length), false);
});
