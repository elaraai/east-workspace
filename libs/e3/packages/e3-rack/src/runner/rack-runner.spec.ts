/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { East, IntegerType, StringType, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { Budget, InMemoryStateStore, LocalOrchestrator, LocalStorage, LocalTaskRunner, datasetWrite, inputsHash,
  packageImport, packageRead, repoInit, unitCap, workspaceCreate, workspaceDeploy, type UnitRequeue } from '@elaraai/e3-core';
import { RackHub, type RackHubOptions } from '../hub/hub.js';
import { defaultHubConfig, saveHubConfig } from '../hub/config.js';
import { HubClient } from '../client/hub-client.js';
import { TestRackAgent, type TestRackAgentOptions } from '../testing/test-rack-agent.js';
import { pinnedFetch } from '../tls/tls.js';
import { DEFAULT_RACK_POLICY, setMode, setRule, type RackPolicy } from '../routing/policy.js';
import { openRackRunner, type OpenRackRunnerOptions } from './rack-runner.js';
import type { RackPlacementEvent } from './rack-body.js';
import type { RackLeaseEvent } from '../protocol/task-envelope.js';
import { describeRackSummary } from './summary.js';

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
  const agent = async (as: Pick<TestRackAgentOptions, 'timings' | 'faults' | 'resources' | 'capacity' | 'peak'> = {}) => {
    const mint = await client.enroll();
    const peer = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, { certificateSha256: mint.certificateSha256.type === 'some' ? mint.certificateSha256.value : undefined, ...as });
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
  const unselected = await f.open({ policy: setRule(DEFAULT_RACK_POLICY, 'other_*', 'rack') });
  assert.equal((await unselected.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length', force: true })).state, 'success');
  assert(f.placements.some((event) => event.where === 'local' && event.reason === 'not-selected'));
});

it('starts at once with no rack enrolled, and opens no session under a policy that selects no task for a rack', async () => {
  const f = await fixture();
  const started = Date.now();
  const unenrolled = await f.open({ waitForRackMs: 5000 });
  assert(Date.now() - started < 1000, 'nothing to wait for without an enrolled rack');
  assert.equal(unenrolled.rackSlots, 0); assert.match(unenrolled.describe(), /No connected rack/);
  const unselected = await f.open({ policy: DEFAULT_RACK_POLICY, waitForRackMs: 5000 });
  assert(Date.now() - started < 1000); assert.match(unselected.describe(), /selects no task for a rack/);
  assert.equal((await f.client.status()).sessions.length, 1, 'the unselected policy opened no session');
  assert.equal((await unselected.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length' })).state, 'success');
  assert.equal(f.budget.peak, 1);
});

for (const failure of [
  { state: 'error' as const, exitCode: -1, error: 'VM boot failed', retry: false, expected: 'success' },
  { state: 'failed' as const, exitCode: 7, error: 'task refused input', retry: false, expected: 'failed' },
  { state: 'failed' as const, exitCode: -1, error: 'runner killed by signal', retry: false, expected: 'failed' },
  { state: 'failed' as const, exitCode: 7, error: 'task refused input', retry: true, expected: 'success' },
  { state: 'error' as const, exitCode: -1, error: 'timed out: e3 stopped the runner', retry: true, expected: 'error' },
  // An infrastructure error that mentions a timeout is the rack's, not the task's time used up
  { state: 'error' as const, exitCode: -1, error: 'connect ETIMEDOUT 10.0.0.2:7331', retry: false, expected: 'success' },
  // A task's own failure is its verdict whatever its message mentions, unless the policy retries failures locally
  { state: 'failed' as const, exitCode: 1, error: 'fetch timed out after 30 s', retry: false, expected: 'failed' },
  { state: 'failed' as const, exitCode: 1, error: 'fetch timed out after 30 s', retry: true, expected: 'success' },
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
  assert.equal((await f.client.status()).capacity.queued, 0n, 'a spill queues no lease a rack could claim first');
  const waiting = await f.open({ rackOnly: true });
  let finished = false;
  const pending = waiting.runner.execute(f.storage, f.hash, extra, { taskName: 'length', force: true }).then((value) => { finished = true; return value; });
  await until(async () => (await f.client.status()).capacity.queued === 1n);
  assert.equal(finished, false);
  await agent.execute(grant); assert.equal((await firstRun).state, 'success');
  assert.equal((await agent.runOne())?.status, 'success');
  assert.equal((await pending).state, 'success');
});

it('runs locally when the rack stops an attempt the run did not abort, instead of launching it again', async () => {
  const f = await fixture(); const agent = await f.agent(); const rack = await f.open();
  const orchestrator = new LocalOrchestrator(new InMemoryStateStore());
  const run = await orchestrator.start(f.storage, f.repo, 'dev', { runner: rack.runner, width: f.budget.cores + rack.rackSlots });
  const grant = await agent.claim(); assert(grant);
  await agent.complete(grant, { taskName: 'length', status: 'failed', state: 'error', cancelled: true, error: 'the agent is draining' });
  await orchestrator.wait(run);
  assert.equal((await orchestrator.getStatus(run)).state, 'completed');
  assert.equal(f.placements.filter((event) => event.where === 'rack').length, 1, 'offered to the rack once, not again after its stop');
  assert(f.placements.some((event) => event.where === 'local' && event.reason.includes('draining')));
  assert.equal(f.budget.peak, 1);
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
  assert(enrollment.certificateSha256.type === 'some');
  const pinned = pinnedFetch(enrollment.certificateSha256.value);
  let requests = 0;
  const agent = new TestRackAgent({ apiUrl: enrollment.apiUrl, workDir: join(f.home, 'peer'), capacity: 2,
    timings: { heartbeatMs: 20, extendMs: 20 }, faults: { claimDelayMs: 5 },
    fetch: (input, init) => { requests++; return pinned(input, init); } });
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
    const agent = await TestRackAgent.enroll(enrollment.apiUrl, enrollment.enrollmentToken, { faults: { [fault]: 1 },
      certificateSha256: enrollment.certificateSha256.type === 'some' ? enrollment.certificateSha256.value : undefined });
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

it('says a transfer\'s retry, places work by the reason its rack gave, and sums the run up', async () => {
  const f = await fixture(); const agent = await f.agent({ timings: { retryMs: 1 }, faults: {} }); const rack = await f.open();
  // Inputs too large to travel inline, however well they compress, so each lease has a transfer to retry.
  const text = () => randomBytes(60_000).toString('base64');
  const large = [await datasetWrite(f.storage, f.repo, text(), StringType)];
  const retried = (events: RackPlacementEvent[]) => events.flatMap((event) => event.kind === 'retried' ? [event.retry] : []);

  // One try fails and the next succeeds: the work stays on the rack.
  agent.faults.failTransferNext = 1;
  const running = rack.runner.execute(f.storage, f.hash, large, { taskName: 'length' });
  const done = await agent.runOne(); assert.equal(done?.status, 'success', done?.error);
  assert.deepEqual(done.retries, [{ transfer: 'input', attempt: 2, of: 5, cause: 'injected transfer failure' }]);
  assert.equal((await running).state, 'success');
  assert.deepEqual(retried(f.placements), [{ transfer: 'input', attempt: 2, of: 5, cause: 'injected transfer failure' }]);
  assert.equal(f.budget.peak, 0, 'nothing ran locally');
  assert.equal(describeRackSummary(rack.takeSummary()), 'Rack summary: 1 task on test rack · 0 waited for capacity · 0 ran again (cap) · 1 transfer retried · 0 ran locally');

  // Every try fails: the rack ends the lease with its reason, and the work runs locally by it.
  f.placements.length = 0;
  agent.faults.failTransferNext = 1000;
  const other = [await datasetWrite(f.storage, f.repo, text(), StringType)];
  const falling = rack.runner.execute(f.storage, f.hash, other, { taskName: 'length' });
  const failed = await agent.runOne(); assert.equal(failed?.status, 'failed');
  assert.deepEqual(failed.reason, { code: 'input-transfer-failed', attempts: 5, cause: 'injected transfer failure' });
  const result = await falling; assert.equal(result.state, 'success', result.error);
  assert.equal(f.budget.peak, 1, 'it ran locally');
  const local = f.placements.find((event) => event.kind === 'placed' && event.where === 'local');
  assert(local?.kind === 'placed' && local.where === 'local');
  assert.equal(local.reason, 'fallback:input-transfer-failed: injected transfer failure');
  assert.deepEqual(local.detail, { code: 'input-transfer-failed', attempts: 5, cause: 'injected transfer failure' });
  assert(retried(f.placements).length >= 4, 'each failed try that was followed by another is said');
  assert.match((await f.storage.logs.read(f.repo, f.hash, inputsHash(other), result.executionId, 'stderr')).data,
    /e3: rack attempt failed on test rack: input-transfer-failed: injected transfer failure — running locally/);
  assert.match(describeRackSummary(rack.takeSummary())!, /^Rack summary: 1 task on test rack · 0 waited for capacity · 0 ran again \(cap\) · \d+ transfers retried · 1 ran locally$/);

  // The hub's status lists how its last leases ended, the latest first, each with its reason.
  const outcomes = (await f.client.status()).outcomes;
  assert.deepEqual(outcomes.map(({ workspace, taskName, rackLabel, outcome, reason }) => ({ workspace, taskName, rackLabel, outcome, reason })), [
    { workspace: 'dev', taskName: 'length', rackLabel: 'test rack', outcome: 'error', reason: some('input-transfer-failed: injected transfer failure') },
    { workspace: 'dev', taskName: 'length', rackLabel: 'test rack', outcome: 'success', reason: none },
  ]);
});

it('asks of a rack what the task\'s rule stands for: its size\'s cores, and its memory limit as its cap', async () => {
  const f = await fixture(); const agent = await f.agent();
  const rack = await f.open({ policy: setRule(f.policy, 'length', 'rack', { size: 'small', memoryLimit: 1024 ** 3 }) });
  const running = rack.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length' });
  const grant = await agent.claim(); assert(grant);
  assert.deepEqual((JSON.parse(grant.eventJson) as RackLeaseEvent).resources, { kind: 'task', cores: 2, memoryBytes: 1024 ** 3, gpu: false });
  const done = await agent.execute(grant); assert.equal(done.status, 'success', done.error);
  assert.equal((await running).state, 'success');
});

it('widens a run by a rack\'s cores, queues work the rack has no room for and says it waits, and runs locally what no rack could ever hold', async () => {
  const GiB = 1024 ** 3;
  // A rack of 2 cores and 4 GiB, whose agent would run five things at once: its cores are what a run counts.
  const f = await fixture(); const agent = await f.agent({ resources: { cores: 2, memoryBytes: 4 * GiB, gpus: 0 }, capacity: 5 });
  // A `small` task asks 2 cores and 4 GiB: the rack holds one at a time. Nothing spills, so the second waits.
  const rack = await f.open({ policy: { ...setRule(f.policy, 'length', 'rack', { size: 'small' }), spill: false } });
  assert.equal(rack.rackSlots, 2, 'a run is as much wider as the rack has cores');
  assert.match(rack.describe(), /^test rack \(2 cores, 4 GiB, e3 /);
  assert.match(rack.describe((bytes) => `${bytes} B`), /^test rack \(2 cores, 4294967296 B, e3 /);
  const first = rack.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length' });
  const grant = await agent.claim(); assert(grant);
  await rack.refreshSlots();
  assert.deepEqual((await f.client.status()).capacity.racks[0]!.free, some({ cores: 0n, memoryBytes: 0n, gpus: 0n }), 'the rack\'s whole resources are booked');
  const other = [await datasetWrite(f.storage, f.repo, 'another', StringType)];
  const second = rack.runner.execute(f.storage, f.hash, other, { taskName: 'length' });
  await until(async () => f.placements.some((event) => event.kind === 'waiting'));
  const waiting = f.placements.find((event) => event.kind === 'waiting'); assert(waiting?.kind === 'waiting');
  assert.deepEqual([waiting.rackLabel, waiting.needs, waiting.free], ['test rack', { kind: 'task', cores: 2, memoryBytes: 4 * GiB, gpu: false }, { cores: 0, memoryBytes: 0, gpus: 0 }]);
  assert.equal((await f.client.status()).capacity.queued, 1n, 'it waits in the queue');
  const ran = await agent.execute(grant); assert.equal(ran.status, 'success', ran.error); assert.equal((await first).state, 'success');
  const next = await agent.runOne(); assert.equal(next?.status, 'success', next?.error); assert.equal((await second).state, 'success');
  const claims = f.placements.flatMap((event) => event.kind === 'placed' && event.where === 'rack' ? [event.waitedMs] : []);
  assert.equal(claims.length, 2); assert.equal(claims[0], undefined); assert(claims[1] !== undefined && claims[1] >= 0, 'the lease that waited says for how long');
  assert.match(describeRackSummary(rack.takeSummary())!, /^Rack summary: 2 tasks on test rack · 1 waited for capacity \(longest \d+ s\) · 0 ran again \(cap\) · 0 transfers retried · 0 ran locally$/);
  assert.equal(f.budget.peak, 0, 'nothing ran locally');

  // An `xlarge` task asks 32 GiB, which this rack does not have at all: it is not queued, and runs locally.
  f.placements.length = 0;
  const large = await f.open({ policy: setRule(f.policy, 'length', 'rack', { size: 'xlarge' }) });
  const third = [await datasetWrite(f.storage, f.repo, 'a third', StringType)];
  assert.equal((await large.runner.execute(f.storage, f.hash, third, { taskName: 'length' })).state, 'success');
  const local = f.placements.find((event) => event.kind === 'placed' && event.where === 'local');
  assert(local?.kind === 'placed' && local.where === 'local');
  assert.deepEqual([local.reason, local.detail], ['memory-limit-exceeded', { code: 'memory-limit-exceeded', needsBytes: 32 * GiB, limitBytes: 4 * GiB }]);
  assert.equal((await f.client.status()).capacity.queued, 0n);
  assert.equal(f.budget.peak, 1);
});

it('leases a unit its rack stopped at its cap again under a larger one, tells the run it was requeued, and leaves no failure in its history', async () => {
  const MiB = 1024 ** 2;
  // A unit expected to need 100 MiB is capped as a local one is, and peaks just past its cap.
  const cap = unitCap(100 * MiB); const again = unitCap(cap);
  const f = await fixture();
  const agent = await f.agent({ resources: { cores: 2, memoryBytes: 4 * 1024 ** 3, gpus: 0 }, peak: () => cap + 1 });
  const rack = await f.open({ policy: { ...f.policy, spill: false } });
  const requeues: UnitRequeue[] = [];
  const unit = { inputs: f.inputs, merge: null, own: false };
  const running = rack.runner.executeUnit(f.storage, f.hash, unit, { taskName: 'length', expectedPeakBytes: 100 * MiB, onRequeued: (requeue) => { requeues.push(requeue); } });
  const stopped = await agent.runOne();
  assert.deepEqual(stopped?.reason, { code: 'outgrew-cap', capBytes: cap, peakBytes: cap + 1 });
  assert.equal(stopped.outputHash, undefined, 'nothing a stopped unit wrote is sent');
  const ran = await agent.runOne(); assert.equal(ran?.status, 'success', ran?.error);
  const result = await running; assert.equal(result.state, 'success', result.error);
  assert.deepEqual(requeues, [{ reason: 'cap', peak: cap, reserves: cap }], 'the run hears it as it hears a local unit its cap killed');
  assert.deepEqual(f.placements.flatMap((event) => event.kind === 'placed' && event.where === 'rack' ? [event.needs?.memoryBytes] : []), [cap, again], 'the next lease asks half as much again');
  const outgrew = f.placements.find((event) => event.kind === 'outgrew'); assert(outgrew?.kind === 'outgrew');
  assert.deepEqual([outgrew.capBytes, outgrew.againBytes, outgrew.rackLabel], [cap, again, 'test rack']);
  // The stopped attempt is no failure of the task's: it was stopped, and says why in its log.
  const attempts = await f.storage.refs.executionListAttempts(f.repo, f.hash, inputsHash(f.inputs));
  assert.deepEqual(attempts.map((attempt) => attempt.status?.type), ['interrupted', 'success']);
  assert.match((await f.storage.logs.read(f.repo, f.hash, inputsHash(f.inputs), attempts[0]!.executionId, 'stderr')).data,
    new RegExp(`e3: the runner outgrew its cap of ${Math.round(cap / MiB)} MiB on its rack: it runs again under a cap of ${Math.round(again / MiB)} MiB`));
  assert.equal(f.budget.peak, 0, 'nothing ran locally');
  assert.equal(describeRackSummary(rack.takeSummary()), 'Rack summary: 2 units on test rack · 0 waited for capacity · 1 ran again (cap) · 0 transfers retried · 0 ran locally');

  // A unit whose next cap would pass its rule's memory limit runs locally instead, under the local budget.
  f.placements.length = 0;
  const limited = await f.open({ policy: { ...setRule(f.policy, 'length', 'rack', { memoryLimit: cap }), spill: false } });
  const other = [await datasetWrite(f.storage, f.repo, 'another', StringType)];
  const second = limited.runner.executeUnit(f.storage, f.hash, { inputs: other, merge: null, own: false }, { taskName: 'length', expectedPeakBytes: 100 * MiB });
  assert.equal((await agent.runOne())?.reason?.code, 'outgrew-cap');
  assert.equal((await second).state, 'success');
  const local = f.placements.find((event) => event.kind === 'placed' && event.where === 'local'); assert(local?.kind === 'placed' && local.where === 'local');
  assert.deepEqual([local.reason, local.detail], ['memory-limit-exceeded', { code: 'memory-limit-exceeded', needsBytes: again, limitBytes: cap }]);
  assert.equal(f.budget.peak, 1);
});

it('fails a whole task its rack stopped at its cap, by name, and does not run it again unless the policy retries failures locally', async () => {
  const GiB = 1024 ** 3;
  const f = await fixture();
  // A `small` task's cap is 4 GiB, and its runner is taken to pass it.
  const agent = await f.agent({ resources: { cores: 4, memoryBytes: 8 * GiB, gpus: 0 }, peak: () => 4 * GiB + 1 });
  const policy = { ...setRule(f.policy, 'length', 'rack', { size: 'small' }), spill: false };
  const rack = await f.open({ policy });
  const running = rack.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length' });
  assert.equal((await agent.runOne())?.reason?.code, 'outgrew-cap');
  const result = await running;
  assert.equal(result.state, 'failed');
  assert.equal(result.error, 'memory-limit-exceeded: the task outgrew its cap of 4096 MiB on rack test rack; raise --memory-limit or --size');
  const outgrew = f.placements.find((event) => event.kind === 'outgrew'); assert(outgrew?.kind === 'outgrew');
  assert.deepEqual([outgrew.capBytes, outgrew.againBytes], [4 * GiB, undefined]);
  const attempts = await f.storage.refs.executionListAttempts(f.repo, f.hash, inputsHash(f.inputs));
  assert.deepEqual(attempts.map((attempt) => attempt.status?.type), ['failed'], 'its cap is its failure, as the local guard\'s stop is');
  assert.equal((await f.client.status()).capacity.queued, 0n, 'it is not leased again');
  assert.equal(f.budget.peak, 0, 'nor run locally');
  assert.equal(describeRackSummary(rack.takeSummary()), 'Rack summary: 1 task on test rack · 0 waited for capacity · 0 ran again (cap) · 0 transfers retried · 0 ran locally');

  // Under a policy that retries failures locally it runs here, where nothing caps it.
  const retrying = await f.open({ policy: { ...policy, retryTaskFailuresLocally: true } });
  const other = [await datasetWrite(f.storage, f.repo, 'another', StringType)];
  const again = retrying.runner.execute(f.storage, f.hash, other, { taskName: 'length' });
  assert.equal((await agent.runOne())?.reason?.code, 'outgrew-cap');
  assert.equal((await again).state, 'success'); assert.equal(f.budget.peak, 1);
});
