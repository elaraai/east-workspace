/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { ArrayType, East, IntegerType, StringType, some } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { Budget, LocalStorage, LocalTaskRunner, datasetWrite, inputsHash, packageImport, packageRead, repoInit } from '@elaraai/e3-core';
import { RackHub } from '../hub/hub.js';
import { defaultHubConfig, saveHubConfig } from '../hub/config.js';
import { HubClient } from '../client/hub-client.js';
import { connectHub } from '../client/connect.js';
import { TestRackAgent } from '../testing/test-rack-agent.js';
import { DEFAULT_RACK_POLICY, setMode } from '../routing/policy.js';
import { openRackRunner } from './rack-runner.js';
import type { RackPlacementEvent } from './rack-body.js';
import type { RackLeaseEvent } from '../protocol/task-envelope.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(background = false) {
  const home = await mkdtemp(join(tmpdir(), 'e3s-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  await saveHubConfig({ ...defaultHubConfig(), listen: some({ host: '127.0.0.1', port: 0n }) }, home);
  const client = new HubClient(home);
  if (background) {
    await connectHub({ home });
    cleanup.push(() => client.stop().catch(() => {}));
  } else {
    const hub = new RackHub({ foreground: true, home }); assert(await hub.start()); cleanup.push(() => hub.stop());
  }
  const mint = await client.enroll();
  const agent = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, { tiers: ['node', 'py'] });
  cleanup.push(() => agent.close());
  const repo = join(home, 'repo'); assert(repoInit(repo).success);
  const storage = new LocalStorage();
  const budget = new Budget({ cores: 2, memory: 1024 ** 3 }, { sampler: null });
  const placements: RackPlacementEvent[] = [];
  const rack = await openRackRunner({ repoPath: repo, workspace: 'dev', storage, label: 'split test', home, budget,
    policy: setMode(DEFAULT_RACK_POLICY, 'auto'), rackOnly: true, waitForRackMs: 0, onPlacement: (event) => { placements.push(event); } });
  cleanup.push(() => rack.close());
  return { home, client, agent, repo, storage, rack, budget, placements };
}

for (const kind of ['array', 'set', 'dict', 'fold'] as const) it(`delegates split ${kind} pieces and merges, keeping planning and the logical record local`, async () => {
  const original = process.env.E3_TEST_PIECE_BYTES;
  process.env.E3_TEST_PIECE_BYTES = '64';
  cleanup.push(() => { if (original === undefined) delete process.env.E3_TEST_PIECE_BYTES; else process.env.E3_TEST_PIECE_BYTES = original; return Promise.resolve(); });
  const f = await fixture();
  const type = ArrayType(IntegerType);
  const input = e3.input('rows', type);
  const task = kind === 'array'
    ? e3.streamTask('split', { inputs: [e3.partition(input)], output: e3.output.array(IntegerType) }, ($, rows, emit) => { $.for(rows, ($, row) => { $(emit(row)); }); })
    : kind === 'set'
      ? e3.streamTask('split', { inputs: [e3.partition(input)], output: e3.output.set(IntegerType) }, ($, rows, emit) => { $.for(rows, ($, row) => { $(emit(row)); }); })
      : kind === 'dict'
        ? e3.streamTask('split', { inputs: [e3.partition(input)], output: e3.output.dict(IntegerType, IntegerType, { merge: (_$, _key, a, b) => a.add(b) }) }, ($, rows, emit) => { $.for(rows, ($, row) => { $(emit(0n, row)); }); })
    : e3.streamTask('split', { inputs: [e3.partition(input)], output: e3.output.fold(IntegerType, { zero: 0n, combine: (_$, a, b) => a.add(b) }) }, ($, rows, emit) => { $.for(rows, ($, row) => { $(emit(row)); }); });
  const zip = join(f.home, 'split.zip');
  await e3.export(e3.package('split', '1.0.0', task), zip);
  await packageImport(f.storage, f.repo, zip);
  const hash = (await packageRead(f.storage, f.repo, 'split', '1.0.0')).tasks.get('split')!;
  const inputs = [await datasetWrite(f.storage, f.repo, Array.from({ length: 8000 }, (_, i) => BigInt(i)), type)];
  const events: RackLeaseEvent[] = [];
  let ended = false;
  const pump = async () => {
    while (!ended) {
      if (Number((await f.client.status()).capacity.queued) === 0) { await delay(10); continue; }
      const grant = await f.agent.claim(); assert(grant);
      events.push(JSON.parse(grant.eventJson) as RackLeaseEvent);
      assert.equal(f.budget.inFlight, 0);
      const result = await f.agent.execute(grant); assert.equal(result.status, 'success', result.error);
    }
  };
  const agentLoop = pump();
  const [remote] = await Promise.all([
    f.rack.runner.execute(f.storage, hash, inputs, { taskName: 'split' }).finally(() => { ended = true; }),
    agentLoop,
  ]);
  assert.equal(remote.state, 'success', remote.error); assert.equal(f.budget.peak, 0);
  assert(events.length > 1); assert(events.every((event) => event.runnerEvent.mode === 'unit'));
  if (kind === 'fold' || kind === 'dict') assert(events.some((event) => event.runnerEvent.mode === 'unit' && event.runnerEvent.unit.merge !== null));
  const record = await f.storage.refs.executionGet(f.repo, hash, inputsHash(inputs), remote.executionId);
  assert(record?.type === 'success' && !record.value.unit);
  if (kind === 'fold') {
    // Keep every successful map in cache, but remove the merge and logical
    // records: a resumed run must delegate only its missing merge bodies.
    for (const event of events) {
      if (event.runnerEvent.mode !== 'unit' || event.runnerEvent.unit.merge === null) continue;
      const inHash = inputsHash([...event.runnerEvent.unit.inputs]);
      for (const id of await f.storage.refs.executionListIds(f.repo, hash, inHash)) {
        await f.storage.refs.executionDelete(f.repo, hash, inHash, id);
      }
    }
    await f.storage.refs.executionDelete(f.repo, hash, inputsHash(inputs), remote.executionId);
    events.length = 0; ended = false;
    const resumedRun = f.rack.runner.execute(f.storage, hash, inputs, { taskName: 'split' }).finally(() => { ended = true; });
    const [resumed] = await Promise.all([resumedRun, pump()]);
    assert.equal(resumed.state, 'success', resumed.error); assert.equal(resumed.outputHash, remote.outputHash);
    assert(events.length > 0);
    assert(events.every((event) => event.runnerEvent.mode === 'unit' && event.runnerEvent.unit.merge !== null));
  }
  const local = await new LocalTaskRunner(f.repo, f.budget).execute(f.storage, hash, inputs, { force: true });
  assert.equal(local.state, 'success', local.error); assert.equal(local.outputHash, remote.outputHash);
  assert(f.placements.every((placement) => placement.where === 'rack' && placement.role === 'unit'));
});

it('executes an east-py task through the same rack wire', { skip: spawnSync('east-py', ['--version']).error !== undefined }, async () => {
  const f = await fixture();
  const input = e3.input('python_text', StringType);
  const task = e3.task('python', [input], East.function([StringType], IntegerType, (_$, text) => text.length()), { runner: { runtime: 'east-py' } });
  const zip = join(f.home, 'python.zip'); await e3.export(e3.package('python', '1.0.0', task), zip);
  await packageImport(f.storage, f.repo, zip);
  const hash = (await packageRead(f.storage, f.repo, 'python', '1.0.0')).tasks.get('python')!;
  const inputs = [await datasetWrite(f.storage, f.repo, 'python on the rack', StringType)];
  const running = f.rack.runner.execute(f.storage, hash, inputs, { taskName: 'python' });
  assert.equal((await f.agent.runOne())?.status, 'success');
  const remote = await running; assert.equal(remote.state, 'success', remote.error);
  const local = await new LocalTaskRunner(f.repo).execute(f.storage, hash, inputs, { force: true });
  assert.equal(local.outputHash, remote.outputHash); assert.equal(f.budget.peak, 0);
});

it('finishes locally when the actual hub process is killed during a claimed task', async () => {
  const f = await fixture(true);
  const input = e3.input('crash_text', StringType);
  const task = e3.task('length', [input], East.function([StringType], IntegerType, (_$, text) => text.length()));
  const zip = join(f.home, 'crash.zip'); await e3.export(e3.package('crash', '1.0.0', task), zip);
  await packageImport(f.storage, f.repo, zip);
  const hash = (await packageRead(f.storage, f.repo, 'crash', '1.0.0')).tasks.get('length')!;
  const inputs = [await datasetWrite(f.storage, f.repo, 'crash recovery', StringType)];
  const running = f.rack.runner.execute(f.storage, hash, inputs, { taskName: 'length' });
  assert(await f.agent.claim());
  process.kill(Number((await f.client.hello()).pid), 'SIGKILL');
  const result = await running;
  assert.equal(result.state, 'success', result.error); assert.equal(f.budget.peak, 1);
  assert(f.placements.some((event) => event.where === 'local' && event.reason.includes('hub unreachable')));
});


it('delegates a split task with one owning unit and keeps its success as the logical record', async () => {
  const f = await fixture();
  const type = ArrayType(IntegerType); const input = e3.input('small', type);
  const task = e3.streamTask('small_split', { inputs: [e3.partition(input)], output: e3.output.array(IntegerType) },
    ($, rows, emit) => { $.for(rows, ($, row) => { $(emit(row)); }); });
  const zip = join(f.home, 'small.zip'); await e3.export(e3.package('small', '1.0.0', task), zip);
  await packageImport(f.storage, f.repo, zip);
  const hash = (await packageRead(f.storage, f.repo, 'small', '1.0.0')).tasks.get('small_split')!;
  const inputs = [await datasetWrite(f.storage, f.repo, [1n, 2n], type)];
  const running = f.rack.runner.execute(f.storage, hash, inputs, { taskName: 'small_split' });
  const lease = await f.agent.claim(); assert(lease);
  const event = JSON.parse(lease.eventJson) as RackLeaseEvent;
  assert(event.runnerEvent.mode === 'unit'); assert.equal(event.runnerEvent.unit.own, true);
  await f.agent.execute(lease);
  const result = await running; assert.equal(result.state, 'success', result.error);
  const record = await f.storage.refs.executionGet(f.repo, hash, inputsHash(inputs), result.executionId);
  assert(record?.type === 'success' && !record.value.unit);
  assert.equal(f.budget.peak, 0);
  assert.equal((await f.rack.runner.execute(f.storage, hash, inputs, { taskName: 'small_split' })).cached, true);
});
