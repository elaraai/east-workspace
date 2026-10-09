/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { East, IntegerType, StringType, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { Budget, InMemoryStateStore, LocalOrchestrator, LocalStorage, LocalTaskRunner, datasetWrite, inputsHash,
  packageImport, packageRead, repoInit, workspaceCreate, workspaceDeploy } from '@elaraai/e3-core';
import { RackHub, type RackHubOptions } from '../hub/hub.js';
import { defaultHubConfig, saveHubConfig } from '../hub/config.js';
import { HubClient } from '../client/hub-client.js';
import { TestRackAgent } from '../testing/test-rack-agent.js';
import { DEFAULT_RACK_POLICY, setMode, type RackPolicy } from '../routing/policy.js';
import { openRackRunner, type OpenRackRunnerOptions } from './rack-runner.js';
import type { RackPlacementEvent } from './rack-body.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(options: RackHubOptions = {}) {
  const home = await mkdtemp(join(tmpdir(), 'e3r-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  await saveHubConfig({ ...defaultHubConfig(), listen: some({ host: '127.0.0.1', port: 0n }) }, home);
  const hub = new RackHub({ foreground: true, home, ...options });
  assert(await hub.start()); cleanup.push(() => hub.stop());
  const client = new HubClient(home);
  const repo = join(home, 'repo'); assert(repoInit(repo).success);
  const storage = new LocalStorage();
  const input = e3.input('text', StringType, variant('value', 'four'));
  const task = e3.task('length', [input], East.function([StringType], IntegerType, (_$, text) => text.length()));
  const zip = join(home, 'package.zip');
  await e3.export(e3.package('rack', '1.0.0', task), zip);
  await packageImport(storage, repo, zip);
  await workspaceCreate(storage, repo, 'dev');
  await workspaceDeploy(storage, repo, 'dev', 'rack', '1.0.0');
  const hash = (await packageRead(storage, repo, 'rack', '1.0.0')).tasks.get('length')!;
  const inputs = [await datasetWrite(storage, repo, 'four', StringType)];
  const budget = new Budget({ cores: 1, memory: 512 * 1024 ** 2 }, { sampler: null });
  const placements: RackPlacementEvent[] = [];
  const policy = setMode({ ...DEFAULT_RACK_POLICY, enabled: true }, 'auto');
  const open = async (options: Partial<OpenRackRunnerOptions> = {}) => {
    const rack = await openRackRunner({ repoPath: repo, workspace: 'dev', storage, label: 'runner test', budget,
      policy, home, waitForRackMs: 0, onPlacement: (event) => { placements.push(event); }, ...options });
    cleanup.push(() => rack.close());
    return rack;
  };
  const agent = async () => {
    const mint = await client.enroll();
    const peer = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken);
    cleanup.push(() => peer.close()); return peer;
  };
  return { home, hub, client, repo, storage, hash, inputs, budget, placements, policy, open, agent };
}

async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 200; i++) { if (await check()) return; await delay(10); }
  assert.fail('Timed out waiting for rack state');
}

it('runs a real dataflow on the rack with no local grant, caches it, and matches a local run', async () => {
  const f = await fixture(); const agent = await f.agent(); const rack = await f.open();
  assert.equal(rack.rackSlots, 1); assert.match(rack.describe(), /test rack.*1 slots/);
  const orchestrator = new LocalOrchestrator(new InMemoryStateStore());
  const run = await orchestrator.start(f.storage, f.repo, 'dev', { runner: rack.runner, width: f.budget.cores + rack.rackSlots });
  const grant = await agent.claim(); assert(grant);
  assert.equal(f.budget.inFlight, 0);
  const remote = await agent.execute(grant); assert.equal(remote.status, 'success', remote.error);
  await orchestrator.wait(run);
  assert.equal((await orchestrator.getStatus(run)).state, 'completed');
  assert.equal(f.budget.peak, 0);
  const record = await f.storage.refs.executionGetLatest(f.repo, f.hash, inputsHash(f.inputs));
  assert(record?.type === 'success');
  assert.match((await f.storage.logs.read(f.repo, f.hash, inputsHash(f.inputs), record.value.executionId, 'stdout')).data, /e3: running on rack test rack/);
  const cached = await rack.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length' });
  assert.equal(cached.cached, true); assert.equal(cached.executionId, record.value.executionId);
  assert.equal(f.placements.filter((event) => event.where === 'rack').length, 1);
  const local = await new LocalTaskRunner(f.repo, f.budget).execute(f.storage, f.hash, f.inputs, { force: true });
  assert.equal(local.state, 'success', local.error); assert.equal(local.outputHash, remote.outputHash);
});

it('keeps unselected tasks local and refreshes a previously empty fleet', async () => {
  const f = await fixture();
  const started = Date.now(); const rack = await f.open({ waitForRackMs: 25 });
  assert(Date.now() - started < 1000); assert.equal(rack.rackSlots, 0);
  assert.equal((await rack.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length' })).state, 'success');
  assert(f.placements.some((event) => event.where === 'local' && event.reason === 'no-rack-for-tier:node'));
  await f.agent(); assert.equal(await rack.refreshSlots(), 1);
  const unselected = await f.open({ policy: DEFAULT_RACK_POLICY });
  assert.equal((await unselected.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length', force: true })).state, 'success');
  assert(f.placements.some((event) => event.where === 'local' && event.reason === 'not-selected'));
});

for (const failure of [
  { state: 'error' as const, exitCode: -1, error: 'VM boot failed', retry: false, expected: 'success' },
  { state: 'failed' as const, exitCode: 7, error: 'task refused input', retry: false, expected: 'failed' },
  { state: 'failed' as const, exitCode: -1, error: 'runner killed by signal', retry: false, expected: 'failed' },
  { state: 'failed' as const, exitCode: 7, error: 'task refused input', retry: true, expected: 'success' },
  { state: 'error' as const, exitCode: -1, error: 'timed out: e3 stopped the runner', retry: true, expected: 'error' },
]) it(`classifies ${failure.error} (retry=${failure.retry}) as ${failure.expected}`, async () => {
  const f = await fixture(); const agent = await f.agent();
  const policy: RackPolicy = { ...f.policy, retryTaskFailuresLocally: failure.retry };
  const rack = await f.open({ policy });
  const running = rack.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length' });
  const grant = await agent.claim(); assert(grant);
  await agent.complete(grant, { taskName: 'length', status: 'failed', state: failure.state, exitCode: failure.exitCode, error: failure.error });
  const result = await running;
  assert.equal(result.state, failure.expected, result.error);
  if (result.state === 'success') {
    assert.equal(f.budget.peak, 1);
    assert.match((await f.storage.logs.read(f.repo, f.hash, inputsHash(f.inputs), result.executionId, 'stderr')).data, /rack attempt failed.*running locally/);
    // The retry must sort AFTER the remote attempt or the execution cache
    // would keep serving its failure as the latest execution forever.
    assert.equal((await rack.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length' })).cached, true);
    assert.equal((await f.storage.refs.executionListIds(f.repo, f.hash, inputsHash(f.inputs))).length, 2);
  } else { assert.equal(f.budget.peak, 0); if (result.state === 'failed') assert.equal(result.exitCode, failure.exitCode); }
});

it('shares one claimed execution across sessions even when the rack has no free slot', async () => {
  const f = await fixture(); const agent = await f.agent();
  const first = await f.open(); const firstRun = first.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length' });
  const grant = await agent.claim(); assert(grant);
  const second = await f.open(); const secondRun = second.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length' });
  await until(async () => f.placements.filter((event) => event.where === 'rack').length === 2);
  assert.equal((await f.client.status()).capacity.racks[0]!.busy, 1n);
  await agent.execute(grant);
  const [a, b] = await Promise.all([firstRun, secondRun]);
  assert.equal(a.state, 'success', a.error); assert.equal(b.state, 'success', b.error);
  assert.equal(a.executionId, b.executionId); assert.equal(f.budget.peak, 0);
});

it('spills distinct work locally when full, while rackOnly waits for the same rack', async () => {
  const f = await fixture(); const agent = await f.agent(); const first = await f.open();
  const firstRun = first.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length' });
  const grant = await agent.claim(); assert(grant);
  const extra = [await datasetWrite(f.storage, f.repo, 'another', StringType)];
  const spilling = await f.open();
  assert.equal((await spilling.runner.execute(f.storage, f.hash, extra, { taskName: 'length' })).state, 'success');
  assert(f.placements.some((event) => event.where === 'local' && event.reason === 'spill'));
  const waiting = await f.open({ rackOnly: true });
  let finished = false;
  const pending = waiting.runner.execute(f.storage, f.hash, extra, { taskName: 'length', force: true }).then((value) => { finished = true; return value; });
  await until(async () => (await f.client.status()).capacity.queued === 1n);
  assert.equal(finished, false);
  await agent.execute(grant); assert.equal((await firstRun).state, 'success');
  assert.equal((await agent.runOne())?.status, 'success');
  assert.equal((await pending).state, 'success');
});

it('cancels a claimed dataflow and makes the next heartbeat stop its rack execution', async () => {
  const f = await fixture(); const agent = await f.agent(); const rack = await f.open();
  const abort = new AbortController();
  const orchestrator = new LocalOrchestrator(new InMemoryStateStore());
  const run = await orchestrator.start(f.storage, f.repo, 'dev', { runner: rack.runner, signal: abort.signal });
  const grant = await agent.claim(); assert(grant);
  abort.abort(); await assert.rejects(orchestrator.wait(run), /aborted/);
  assert.equal((await orchestrator.getStatus(run)).state, 'cancelled');
  assert.equal(f.budget.peak, 0);
  assert.deepEqual((await agent.heartbeat([grant])).stop, [{ repo: grant.repo, leaseId: grant.leaseId }]);
});

it('falls back after a lost lease and keeps the interrupted attempt in history', async () => {
  let time = Date.now();
  const f = await fixture({ now: () => time, visibilityMs: 100 }); const agent = await f.agent(); const rack = await f.open();
  const running = rack.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length' });
  assert(await agent.claim());
  time += 201; await f.hub.sweep();
  const result = await running; assert.equal(result.state, 'success', result.error);
  const attempts = await f.storage.refs.executionListAttempts(f.repo, f.hash, inputsHash(f.inputs));
  assert.deepEqual(attempts.map((attempt) => attempt.status?.type), ['interrupted', 'success']);
});

it('automatically polls with an injected transport and drains concurrent real executions', async () => {
  const f = await fixture(); const enrollment = await f.client.enroll();
  let requests = 0;
  const agent = new TestRackAgent({ apiUrl: enrollment.apiUrl, workDir: join(f.home, 'peer'), capacity: 2,
    timings: { heartbeatMs: 20, extendMs: 20 }, faults: { claimDelayMs: 5 },
    fetch: (input, init) => { requests++; return fetch(input, init); } });
  cleanup.push(() => agent.close()); await agent.enroll(enrollment.enrollmentToken);
  const rack = await f.open(); assert.equal(rack.rackSlots, 2);
  agent.start();
  const other = [await datasetWrite(f.storage, f.repo, 'longer input', StringType)];
  const outcomes = await Promise.all([f.inputs, other].map((inputs) => rack.runner.execute(f.storage, f.hash, inputs, { taskName: 'length' })));
  assert(outcomes.every((outcome) => outcome.state === 'success'));
  assert.notEqual(outcomes[0]!.outputHash, outcomes[1]!.outputHash);
  assert.equal(f.budget.peak, 0); assert(requests > 10);
  await agent.stop();
});

for (const fault of ['infraFailNext', 'taskFailNext', 'hangNext', 'dropCompletionNext'] as const) {
  it(`injects ${fault} through the real test agent`, async () => {
    let time = Date.now();
    const f = await fixture({ now: () => time, visibilityMs: 100 });
    const enrollment = await f.client.enroll();
    const agent = await TestRackAgent.enroll(enrollment.apiUrl, enrollment.enrollmentToken, { faults: { [fault]: 1 } });
    cleanup.push(() => agent.close()); const rack = await f.open();
    let finished = false;
    const running = rack.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length' }).then((result) => { finished = true; return result; });
    const lease = await agent.claim(); assert(lease);
    const execution = agent.execute(lease);
    if (fault === 'hangNext' || fault === 'dropCompletionNext') {
      if (fault === 'dropCompletionNext') assert.equal((await execution).state, 'success');
      else await delay(30);
      assert.equal(finished, false);
      time += 201; await f.hub.sweep();
    } else {
      const result = await execution;
      assert.equal(result.exitCode, fault === 'taskFailNext' ? 1 : undefined);
    }
    const outcome = await running;
    assert.equal(outcome.state, fault === 'taskFailNext' ? 'failed' : 'success', outcome.error);
    assert.equal(f.budget.peak, fault === 'taskFailNext' ? 0 : 1);
    await agent.stop(); await execution;
    assert.equal(agent.faults[fault], 0);
  });
}
