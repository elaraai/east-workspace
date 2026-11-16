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
import { ArrayType, East, IntegerType, StringType, decodeBeast2For, encodeBeast2For, encodeEastIR, none, some, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { TaskObjectType, decodeTaskObject } from '@elaraai/e3-types';
import { Budget, InMemoryStateStore, LocalOrchestrator, LocalStorage, LocalTaskRunner, datasetWrite, inputsHash,
  packageImport, packageRead, repoInit, unitCap, workspaceCreate, workspaceDeploy, type DetachedArg, type DetachedResult, type DetachedSpec,
  type UnitRequeue } from '@elaraai/e3-core';
import { RackHub, type RackHubOptions } from '../hub/hub.js';
import { defaultHubConfig, saveHubConfig } from '../hub/config.js';
import { HubClient } from '../client/hub-client.js';
import { RackHubError } from '../client/local-http.js';
import { RackSession } from '../client/session.js';
import { TestRackAgent, type TestRackAgentOptions } from '../testing/test-rack-agent.js';
import { pinnedFetch } from '../tls/tls.js';
import { DEFAULT_RACK_POLICY, setMode, setRule, type RackPolicy } from '../routing/policy.js';
import { openRackRunner, type OpenRackRunnerOptions } from './rack-runner.js';
import { createRackBody, ranLocally, type RackPlacementEvent } from './rack-body.js';
import { RACK_INLINE_ARGS_MAX, RACK_INLINE_VALUE_MAX, type RackLeaseEvent } from '../protocol/task-envelope.js';
import { RackHeartbeatRequestType, type RackLeaseGrant } from '../protocol/rack-wire.js';
import { E3_RACK_VERSION } from '../version.js';
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
  const agent = async (as: Pick<TestRackAgentOptions, 'timings' | 'faults' | 'resources' | 'capacity' | 'peak' | 'tiers'> = {}) => {
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
  assert.equal(describeRackSummary(rack.takeSummary()), 'Rack summary: 1 task on test rack · 0 waited for capacity · 0 ran again · 1 transfer retried · 0 ran locally');

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
  assert.match(describeRackSummary(rack.takeSummary())!, /^Rack summary: 1 task on test rack · 0 waited for capacity · 0 ran again · \d+ transfers retried · 1 ran locally$/);

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
  assert.match(describeRackSummary(rack.takeSummary())!, /^Rack summary: 2 tasks on test rack · 1 waited for capacity \(longest \d+ s\) · 0 ran again · 0 transfers retried · 0 ran locally$/);
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
  assert.deepEqual(f.placements.flatMap((event) => event.kind === 'placed' && event.where === 'rack' ? [[event.needs?.memoryBytes, event.needs?.reserveBytes]] : []),
    [[cap, 100 * MiB], [again, cap]], 'the next lease asks half as much again, reserving what the unit reached');
  const outgrew = f.placements.find((event) => event.kind === 'outgrew'); assert(outgrew?.kind === 'outgrew');
  assert.deepEqual([outgrew.capBytes, outgrew.againBytes, outgrew.rackLabel], [cap, again, 'test rack']);
  // The stopped attempt is no failure of the task's: it was stopped, and says why in its log.
  const attempts = await f.storage.refs.executionListAttempts(f.repo, f.hash, inputsHash(f.inputs));
  assert.deepEqual(attempts.map((attempt) => attempt.status?.type), ['interrupted', 'success']);
  assert.match((await f.storage.logs.read(f.repo, f.hash, inputsHash(f.inputs), attempts[0]!.executionId, 'stderr')).data,
    new RegExp(`e3: the runner outgrew its cap of ${Math.round(cap / MiB)} MiB on its rack: it runs again under a cap of ${Math.round(again / MiB)} MiB`));
  assert.equal(f.budget.peak, 0, 'nothing ran locally');
  assert.equal(describeRackSummary(rack.takeSummary()), 'Rack summary: 1 unit on test rack · 0 waited for capacity · 1 ran again · 0 transfers retried · 0 ran locally',
    'one unit, leased twice');

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

it('books a unit at what it reserves, so a rack holds as many as a local run would, and runs again reserving what it reached a unit its rack stopped for its host\'s memory', async () => {
  const MiB = 1024 ** 2;
  const f = await fixture();
  // Two cores and 200 MiB: two units reserving 100 MiB each fit, where the first's cap (164 MiB) would leave room for no second.
  const agent = await f.agent({ resources: { cores: 2, memoryBytes: 200 * MiB, gpus: 0 }, peak: () => 120 * MiB, faults: { pressureNext: 1 } });
  const rack = await f.open({ policy: { ...f.policy, spill: false } });
  const requeues: UnitRequeue[] = [];
  const unit = (inputs: string[]) => ({ inputs, merge: null, own: false });
  const other = [await datasetWrite(f.storage, f.repo, 'another', StringType)];
  const options = { taskName: 'length', expectedPeakBytes: 100 * MiB, onRequeued: (requeue: UnitRequeue) => { requeues.push(requeue); } };
  const first = rack.runner.executeUnit(f.storage, f.hash, unit(f.inputs), options);
  const second = rack.runner.executeUnit(f.storage, f.hash, unit(other), options);
  const a = await agent.claim(); const b = await agent.claim(); assert(a && b, 'both units are held at once');
  assert.deepEqual(agent.bookedFor(a.leaseId), { kind: 'unit', cores: 1, memoryBytes: unitCap(100 * MiB), reserveBytes: 100 * MiB, gpu: false });
  assert.equal(agent.bookedMost.memoryBytes, 200 * MiB, 'the rack books what they reserve');

  // The rack's host runs short, and it stops the newest: it runs again reserving what it reached, once the rack has room for that.
  const stopped = await agent.execute(b);
  assert.deepEqual(stopped.reason, { code: 'requeued-pressure', peakBytes: 120 * MiB });
  assert.equal((await agent.execute(a)).status, 'success');
  const again = await agent.runOne(); assert.equal(again?.status, 'success', again?.error);
  for (const result of await Promise.all([first, second])) assert.equal(result.state, 'success', result.error ?? '');
  assert.deepEqual(requeues, [{ reason: 'budget', peak: 120 * MiB, reserves: 120 * MiB }], 'the run hears it as it hears a unit the local guard stopped');
  const event = f.placements.find((placed) => placed.kind === 'stopped'); assert(event?.kind === 'stopped');
  assert.deepEqual([event.peakBytes, event.againBytes, event.rackLabel], [120 * MiB, 120 * MiB, 'test rack']);
  const leases = f.placements.flatMap((placed) => placed.kind === 'placed' && placed.where === 'rack' ? [placed.needs] : []);
  assert.deepEqual(leases.at(-1), { kind: 'unit', cores: 1, memoryBytes: unitCap(120 * MiB), reserveBytes: 120 * MiB, gpu: false });
  // The stopped attempt is no failure of the task's; whichever unit was the newest, the other ran once.
  const histories = await Promise.all([f.inputs, other].map(async (inputs) => {
    const attempts = await f.storage.refs.executionListAttempts(f.repo, f.hash, inputsHash(inputs));
    return { inputs, attempts, statuses: attempts.map((attempt) => attempt.status?.type) };
  }));
  const stoppedUnit = histories.find((history) => history.statuses.length === 2); assert(stoppedUnit, 'one unit ran again');
  assert.deepEqual(histories.map((history) => history.statuses).sort((x, y) => x.length - y.length), [['success'], ['interrupted', 'success']]);
  assert.match((await f.storage.logs.read(f.repo, f.hash, inputsHash(stoppedUnit.inputs), stoppedUnit.attempts[0]!.executionId, 'stderr')).data,
    /e3: its rack stopped the runner at 120 MiB, its host short of memory: it runs again reserving 120 MiB/);
  assert.equal(f.budget.peak, 0, 'nothing ran locally');
  assert.match(describeRackSummary(rack.takeSummary())!, /^Rack summary: 2 units on test rack · 1 waited for capacity \(longest \d+ s\) · 1 ran again · 0 transfers retried · 0 ran locally$/,
    'two units, one of them leased twice');
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
  assert.equal(describeRackSummary(rack.takeSummary()), 'Rack summary: 1 task on test rack · 0 waited for capacity · 0 ran again · 0 transfers retried · 0 ran locally');

  // Under a policy that retries failures locally it runs here, where nothing caps it.
  const retrying = await f.open({ policy: { ...policy, retryTaskFailuresLocally: true } });
  const other = [await datasetWrite(f.storage, f.repo, 'another', StringType)];
  const again = retrying.runner.execute(f.storage, f.hash, other, { taskName: 'length' });
  assert.equal((await agent.runOne())?.reason?.code, 'outgrew-cap');
  assert.equal((await again).state, 'success'); assert.equal(f.budget.peak, 1);
});

it('waits, under rack-only, for a rack that runs the work\'s tier to be healthy before the work runs locally, and runs it locally at once otherwise', async () => {
  const f = await fixture(); const agent = await f.agent();
  const local = () => f.placements.flatMap((event) => event.kind === 'placed' && event.where === 'local' ? [event.reason] : []);
  const unhealthy = async () => {
    const response = await agent.raw('heartbeat', RackHeartbeatRequestType, { healthy: false, freeCapacity: 0n, runningLeases: [],
      agentVersion: `0.5.0+e3.${E3_RACK_VERSION}`, bootId: agent.bootId, cacheBytes: 0n, report: JSON.stringify({ features: [] }) });
    assert.equal(response.status, 200); await response.arrayBuffer();
  };
  const input = async (text: string) => [await datasetWrite(f.storage, f.repo, text, StringType)];

  // The one rack that runs the tier is not healthy. A run that may run its work locally does so at once, by name.
  await unhealthy();
  const plain = await f.open();
  assert.equal((await plain.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length' })).state, 'success');
  assert.deepEqual(local(), ['source-unreachable']);
  assert.equal(f.budget.peak, 1);

  // A run that keeps its work for a rack waits for it, and the rack comes back within the wait.
  f.placements.length = 0;
  const waiting = await f.open({ rackOnly: true, unreachableWaitMs: 30_000 });
  const running = waiting.runner.execute(f.storage, f.hash, await input('for the rack'), { taskName: 'length' });
  await delay(150);
  assert.deepEqual(f.placements, [], 'the work is neither leased nor run while the run waits');
  await agent.heartbeat();
  const ran = await agent.runOne(); assert.equal(ran?.status, 'success', ran?.error);
  assert.equal((await running).state, 'success');
  assert.deepEqual(local(), []);

  // It stays away past the wait: the work runs locally, since a rack's fault never fails a run.
  await unhealthy();
  f.placements.length = 0;
  const short = await f.open({ rackOnly: true, unreachableWaitMs: 300 });
  const started = Date.now();
  assert.equal((await short.runner.execute(f.storage, f.hash, await input('after the wait'), { taskName: 'length' })).state, 'success');
  assert(Date.now() - started >= 300, 'it waited as long as it was given');
  assert.deepEqual(local(), ['source-unreachable']);
});

it('keeps a queued lease when its hub does not answer one ask for the fleet', async () => {
  const f = await fixture(); const agent = await f.agent();
  const session = await RackSession.open(f.client, { storage: f.storage, repoPath: f.repo, workspace: 'dev', label: 'fleet ask test' });
  cleanup.push(() => session.close());
  // The first ask for the fleet goes unanswered: the leases of a stage share one, so it is every one's
  const status = f.client.status.bind(f.client);
  let unanswered = 0;
  f.client.status = () => unanswered++ === 0 ? Promise.reject(new RackHubError('timeout', 'Rack request GET /v1/status timed out')) : status();
  // A body given to a runner as its own documentation gives it: no rack claims its lease within a second, and it asks for the fleet
  const runner = new LocalTaskRunner(f.repo, f.budget, { body: createRackBody({ session, workspace: 'dev', rackOnly: true,
    policy: { ...f.policy, claimTimeoutSeconds: 1n }, onPlacement: (event) => { f.placements.push(event); } }) });
  const running = runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length' });
  for (let waited = 0; unanswered === 0 && waited < 30_000; waited += 10) await delay(10);
  assert.equal(unanswered, 1, 'the lease waited its second, and asked for the fleet');
  // An ask that fails is no verdict on the lease: it stands, and its rack runs it
  const ran = await agent.runOne(); assert.equal(ran?.status, 'success', ran?.error);
  assert.equal((await running).state, 'success');
  assert.deepEqual(f.placements.map((event) => [event.kind, event.where]), [['placed', 'rack']], 'nothing ran here');
  assert.equal(f.budget.peak, 0);
});

it('leases work whose transfer failed once more under rack-only, and runs it locally only when that lease fails too', async () => {
  const f = await fixture(); const agent = await f.agent({ timings: { retryMs: 1 }, faults: {} });
  const rack = await f.open({ rackOnly: true });
  const large = async () => [await datasetWrite(f.storage, f.repo, randomBytes(60_000).toString('base64'), StringType)];
  const claims = () => f.placements.filter((event) => event.kind === 'placed' && event.where === 'rack').length;

  // The link fails every try of the first lease, and is whole again for the second.
  agent.faults.failTransferNext = 1000;
  const running = rack.runner.execute(f.storage, f.hash, await large(), { taskName: 'length' });
  assert.equal((await agent.runOne())?.reason?.code, 'input-transfer-failed');
  agent.faults.failTransferNext = 0;
  const again = await agent.runOne(); assert.equal(again?.status, 'success', again?.error);
  assert.equal((await running).state, 'success');
  assert.equal(claims(), 2, 'leased once more');
  assert.equal(f.budget.peak, 0, 'and not run locally');

  // It fails the second lease too: the work runs locally, by the rack's reason.
  f.placements.length = 0;
  agent.faults.failTransferNext = 100_000;
  const falling = rack.runner.execute(f.storage, f.hash, await large(), { taskName: 'length' });
  assert.equal((await agent.runOne())?.reason?.code, 'input-transfer-failed');
  assert.equal((await agent.runOne())?.reason?.code, 'input-transfer-failed');
  assert.equal((await falling).state, 'success');
  assert.equal(claims(), 2); assert.equal(f.budget.peak, 1);
  const local = f.placements.find((event) => event.kind === 'placed' && event.where === 'local'); assert(local?.kind === 'placed' && local.where === 'local');
  assert.equal(local.detail?.code, 'input-transfer-failed');
});

it('leases a task whose size names more cores than any rack has for the most a rack has, runs locally by name work that asks a GPU no rack has, and leases a GPU task on the tier a rack gives its GPU to', async () => {
  const GiB = 1024 ** 3;
  const f = await fixture();
  const local = () => f.placements.flatMap((event) => event.kind === 'placed' && event.where === 'local' ? [event] : []);
  // A `large` task's size names eight cores, more than the rack has: it asks the rack's four, whose VM it is given.
  const four = await f.agent({ resources: { cores: 4, memoryBytes: 64 * GiB, gpus: 0 }, tiers: ['node', 'py-datascience'] });
  const large = await f.open({ policy: setRule(f.policy, 'length', 'rack', { size: 'large' }) });
  const whole = large.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length' });
  const held = await four.claim(); assert(held);
  assert.deepEqual(four.bookedFor(held.leaseId), { kind: 'task', cores: 4, memoryBytes: 16 * GiB, gpu: false });
  assert.equal((await four.execute(held)).status, 'success');
  assert.equal((await whole).state, 'success');
  assert.deepEqual(local(), [], 'its cores are never why it runs here');

  // The same task as east-py's, whose rule asks for a GPU: its tier is the one a rack gives its GPU to.
  const base = decodeTaskObject(await f.storage.objects.read(f.repo, f.hash));
  const python = await f.storage.objects.write(f.repo, encodeBeast2For(TaskObjectType)({ ...base,
    runner: variant('east_py', { platforms: ['east-py-std'], decode: variant('lazy', null) }) }));
  const gpu = await f.open({ policy: setRule(f.policy, 'length', 'rack', { size: 'small', gpu: true }) });
  // No rack has one: the work is this machine's, by that name. Whether this machine's east-py then runs it is not this test's.
  f.placements.length = 0;
  await gpu.runner.execute(f.storage, python, f.inputs, { taskName: 'length' });
  assert.deepEqual(local().map((event) => [event.reason, event.detail]), [['no-rack-holds:gpu', undefined]]);
  assert(ranLocally(local()[0]!), 'a rack\'s work that this machine ran');
  assert.equal((await f.client.status()).capacity.queued, 0n, 'it is not queued to wait for ever');

  // A rack with one: the lease asks for it, on the tier that has it, and the rack books it.
  const withGpu = await f.agent({ resources: { cores: 4, memoryBytes: 64 * GiB, gpus: 1 }, tiers: ['py-datascience'] });
  await gpu.refreshSlots();
  f.placements.length = 0;
  const other = [await datasetWrite(f.storage, f.repo, 'a GPU task', StringType)];
  const running = gpu.runner.execute(f.storage, python, other, { taskName: 'length' });
  const grant = await withGpu.claim(); assert(grant);
  assert.equal(grant.tier, 'py-datascience');
  assert.deepEqual(withGpu.bookedFor(grant.leaseId), { kind: 'task', cores: 2, memoryBytes: 4 * GiB, gpu: true });
  // The task's own failure is its verdict: nothing of it runs here.
  await withGpu.complete(grant, { taskName: 'length', status: 'failed', state: 'failed', exitCode: 1, error: 'the task failed', reason: { code: 'task-error' } });
  assert.equal((await running).state, 'failed');
  assert.deepEqual(local(), []);
});

// ── Function calls ─────────────────────────────────────────────────────────

const encodeInt = encodeBeast2For(IntegerType);
const Numbers = ArrayType(IntegerType);
const node = variant('east_node', { platforms: [] as string[], decode: variant('lazy', null) });
const callLimits = { timeoutMs: 60_000, maxResultBytes: 64 * 1024 ** 2, maxLogBytes: 64 * 1024 };
const double = encodeEastIR(East.function([IntegerType], IntegerType, (_$, n) => n.multiply(2n)).toIR());
/** A call of a program on east-node. */
const callOf = (bodyIr: Uint8Array, args: DetachedArg[], limits = callLimits): DetachedSpec => ({ bodyIr, args, runner: node, limits });
/** A call's value, read as its type. */
const valueOf = <T extends EastType>(result: DetachedResult, type: T): ValueTypeOf<T> => {
  assert(result.kind === 'success', `the call ended ${result.kind}: ${result.stderr}`);
  return decodeBeast2For(type)(result.value);
};
const leaseOf = (grant: RackLeaseGrant) => JSON.parse(grant.eventJson) as RackLeaseEvent;
const placed = (events: RackPlacementEvent[]) => events.flatMap((event) => event.kind === 'placed' ? [[event.where, event.role, event.taskName, event.where === 'local' ? event.reason : event.rackLabel]] : []);

it('runs a call on a rack with no local grant, as its own lease naming its program by hash, records nothing of it, and returns its value', async () => {
  const f = await fixture(); const agent = await f.agent(); const rack = await f.open({ selected: true });
  const running = rack.runner.runDetached(callOf(double, [encodeInt(21n)]), { storage: f.storage, functionName: 'double' });
  const grant = await agent.claim(); assert(grant);
  const event = leaseOf(grant);
  assert.equal(event.taskName, 'fn:double');
  assert(event.runnerEvent.mode === 'run-detached');
  assert.equal(event.runnerEvent.spec.bodyIr, '', 'the program travels by its hash');
  const program = await f.storage.objects.write(f.repo, double);
  assert.equal(event.program, program);
  assert('hashes' in event.closure && event.closure.hashes.includes(program), 'its closure stages its program');
  assert.deepEqual(event.resources, { kind: 'task', cores: 8, memoryBytes: 16 * 1024 ** 3, gpu: false }, 'sized as a whole task of the policy\'s default size');
  const done = await agent.execute(grant); assert.equal(done.status, 'success', done.error);
  assert.equal(valueOf(await running, IntegerType), 42n);
  assert.equal(f.budget.peak, 0, 'nothing of it ran here');
  assert.deepEqual(placed(f.placements), [['rack', 'call', 'fn:double', 'test rack']]);
  assert.deepEqual(await f.storage.refs.executionListIds(f.repo, program, inputsHash([])), [], 'a call is recorded nowhere');
  assert.equal(describeRackSummary(rack.takeSummary()), 'Rack summary: 1 call on test rack · 0 waited for capacity · 0 ran again · 0 transfers retried · 0 ran locally');
});

it('makes two calls of one function, made at once, two leases that each return their own value', async () => {
  const f = await fixture(); const agent = await f.agent({ capacity: 2 });
  const rack = await f.open({ selected: true, policy: { ...f.policy, spill: false } });
  const options = { storage: f.storage, functionName: 'double' };
  const calls = [rack.runner.runDetached(callOf(double, [encodeInt(1n)]), options), rack.runner.runDetached(callOf(double, [encodeInt(2n)]), options)];
  const a = await agent.claim(); const b = await agent.claim(); assert(a && b, 'both are leased');
  assert.notEqual(a.leaseId, b.leaseId);
  for (const done of await Promise.all([agent.execute(a), agent.execute(b)])) assert.equal(done.status, 'success', done.error);
  assert.deepEqual((await Promise.all(calls)).map((result) => valueOf(result, IntegerType)), [2n, 4n]);
  assert.equal(f.budget.peak, 0);
});

it('stages a dataset argument, and a value argument past what a lease carries inline, through the call\'s closure', async () => {
  const f = await fixture(); const agent = await f.agent(); const rack = await f.open({ selected: true });
  const total = encodeEastIR(East.function([Numbers, Numbers, IntegerType], IntegerType, (_$, stored, sent, times) =>
    stored.reduce((_$, sum, value) => sum.add(value), 0n).add(sent.reduce((_$, sum, value) => sum.add(value), 0n)).multiply(times)).toIR());
  const stored = Array.from({ length: 1000 }, (_, i) => BigInt(i));
  const sent = Array.from({ length: 60_000 }, (_, i) => BigInt(i) * 1_000_003n);
  const dataset = await datasetWrite(f.storage, f.repo, stored, Numbers);
  const large = encodeBeast2For(Numbers)(sent);
  assert(large.length > RACK_INLINE_ARGS_MAX);
  const running = rack.runner.runDetached(callOf(total, [{ dataset }, large, encodeInt(2n)]), { storage: f.storage, functionName: 'total' });
  const grant = await agent.claim(); assert(grant);
  const event = leaseOf(grant); assert(event.runnerEvent.mode === 'run-detached');
  const [first, second, third] = event.runnerEvent.spec.args;
  assert.deepEqual(first, { dataset });
  assert(typeof second === 'object' && 'dataset' in second, 'a value past the inline budget is staged as a dataset argument is');
  assert.equal(second.dataset, await f.storage.objects.write(f.repo, large));
  assert.equal(third, Buffer.from(encodeInt(2n)).toString('base64'), 'a small value rides inline');
  assert('hashes' in event.closure && event.closure.hashes.includes(dataset) && event.closure.hashes.includes(second.dataset));
  const done = await agent.execute(grant); assert.equal(done.status, 'success', done.error);
  const sum = (values: bigint[]) => values.reduce((a, b) => a + b, 0n);
  assert.equal(valueOf(await running, IntegerType), (sum(stored) + sum(sent)) * 2n);
});

it('returns a value of several MiB from the object its completion commits', async () => {
  const f = await fixture(); const agent = await f.agent(); const rack = await f.open({ selected: true });
  const many = encodeEastIR(East.function([IntegerType], Numbers, (_$, n) => East.Array.generate(n, IntegerType, (_$, i) => i.multiply(1_000_003n))).toIR());
  const running = rack.runner.runDetached(callOf(many, [encodeInt(500_000n)]), { storage: f.storage, functionName: 'many' });
  const done = await agent.runOne(); assert.equal(done?.status, 'success', done?.error);
  const hash = done.detached?.valueHash;
  assert(hash !== undefined && done.detached?.valueB64 === undefined, 'the value travelled as an object, not inline');
  assert.equal(done.outputHash, hash, 'committed as the completion\'s output');
  const { size } = await f.storage.objects.stat(f.repo, hash);
  assert(size > 2 * 1024 ** 2 && size > RACK_INLINE_VALUE_MAX, `the value is ${size} bytes`);
  const values = valueOf(await running, Numbers);
  assert.equal(values.length, 500_000);
  assert.equal(values[499_999], 499_999n * 1_000_003n);
  assert.equal(f.budget.peak, 0);
});

it('takes a call to a rack by its flag whatever the policy selects, sized by a rule that names it; without the flag, a policy that selects nothing opens no session', async () => {
  const f = await fixture(); const agent = await f.agent();
  const unselected = await f.open({ policy: DEFAULT_RACK_POLICY });
  assert.equal(unselected.unattached, 'the rack policy selects no task for a rack');
  assert.equal(valueOf(await unselected.runner.runDetached(callOf(double, [encodeInt(1n)]), { storage: f.storage, functionName: 'double' }), IntegerType), 2n);
  assert.equal(f.budget.peak, 1, 'it ran here');
  const flagged = await f.open({ policy: setRule(DEFAULT_RACK_POLICY, 'fn:double', 'local', { size: 'small' }), selected: true });
  assert.equal(flagged.unattached, undefined);
  const running = flagged.runner.runDetached(callOf(double, [encodeInt(2n)]), { storage: f.storage, functionName: 'double' });
  const grant = await agent.claim(); assert(grant);
  assert.deepEqual(leaseOf(grant).resources, { kind: 'task', cores: 2, memoryBytes: 4 * 1024 ** 3, gpu: false }, 'the rule that names it sizes it');
  assert.equal((await agent.execute(grant)).status, 'success');
  assert.equal(valueOf(await running, IntegerType), 4n);
});

it('runs here, by name, a call no rack can run, taking its local grant as a call with no rack does', async () => {
  const f = await fixture(); await f.agent(); const rack = await f.open({ selected: true });
  const custom = await rack.runner.runDetached({ bodyIr: new Uint8Array([1]), args: [encodeBeast2For(StringType)('the value')],
    runner: variant('custom', { command: [process.execPath, '-e', 'const a = process.argv; require("node:fs").copyFileSync(a[a.indexOf("-i") + 1], a[a.indexOf("-o") + 1])', '--'] }),
    limits: callLimits }, { storage: f.storage, functionName: 'copy' });
  assert.equal(valueOf(custom, StringType), 'the value');
  assert.deepEqual(placed(f.placements), [['local', 'call', 'fn:copy', 'custom-runner']]);
  assert.equal(f.budget.peak, 1, 'it took the local budget\'s core');
  assert.equal((await f.client.status()).capacity.queued, 0n, 'nothing was leased');
});

it('admits a task and a call by one rule: work bound to its runner\'s process settings, and a call given no repository, run here by name', async () => {
  const f = await fixture(); await f.agent();
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const bound = await f.open({ selected: true, settings: { env } });
  assert.equal((await bound.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'length' })).state, 'success');
  assert.equal(valueOf(await bound.runner.runDetached(callOf(double, [encodeInt(5n)]), { storage: f.storage, functionName: 'double' }), IntegerType), 10n);
  const rack = await f.open({ selected: true });
  assert.equal(valueOf(await rack.runner.runDetached(callOf(double, [encodeInt(6n)]), { functionName: 'double' }), IntegerType), 12n);
  assert.deepEqual(placed(f.placements), [['local', 'task', 'length', 'host-process-settings'], ['local', 'call', 'fn:double', 'host-process-settings'],
    ['local', 'call', 'fn:double', 'no-repository']]);
  assert.equal((await f.client.status()).capacity.queued, 0n, 'nothing was leased');
});

for (const outcome of [
  { name: 'the function\'s own failure, its answer with its exit code and log tails', expected: 'rack' as const,
    result: { status: 'failed' as const, reason: { code: 'task-error' }, detached: { kind: 'failed' as const, exitCode: 3, stdout: 'out', stderr: 'err', stdoutTruncated: false, stderrTruncated: true } },
    answer: { kind: 'failed', exitCode: 3, stdout: 'out', stderr: 'err', stdoutTruncated: false, stderrTruncated: true } },
  { name: 'a value over its limit, as a local run answers it', expected: 'rack' as const,
    result: { status: 'failed' as const, detached: { kind: 'too_large' as const, bytes: 9000, limit: 1024, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false } },
    answer: { kind: 'too_large', bytes: 9000, limit: 1024, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false } },
  { name: 'its own time used up, as a local run answers it', expected: 'rack' as const,
    result: { status: 'failed' as const, detached: { kind: 'timed_out' as const, ms: 50, stdout: '', stderr: 'slow', stdoutTruncated: false, stderrTruncated: false } },
    answer: { kind: 'timed_out', ms: 50, stdout: '', stderr: 'slow', stdoutTruncated: false, stderrTruncated: false } },
  { name: 'a value the rack could not relay, run here', expected: 'fallback:value-too-large-to-relay',
    result: { status: 'failed' as const, detached: { kind: 'failed' as const, rackResultTooLarge: true, stdout: '', stderr: 'too large', stdoutTruncated: true, stderrTruncated: true } } },
  { name: 'no outcome of the call, the rack\'s fault, run here', expected: 'fallback:guest-crashed: the VM died',
    result: { status: 'failed' as const, state: 'error' as const, reason: { code: 'guest-crashed', detail: 'the VM died' } } },
  { name: 'a stop of the rack\'s own, run here', expected: 'fallback:the agent is draining',
    result: { status: 'failed' as const, state: 'error' as const, cancelled: true, error: 'the agent is draining' } },
]) it(`ends a call whose rack answered ${outcome.name}`, async () => {
  const f = await fixture(); const agent = await f.agent(); const rack = await f.open({ selected: true });
  const running = rack.runner.runDetached(callOf(double, [encodeInt(5n)]), { storage: f.storage, functionName: 'double' });
  const grant = await agent.claim(); assert(grant);
  await agent.complete(grant, { taskName: 'fn:double', ...outcome.result });
  const result = await running;
  if (outcome.expected === 'rack') {
    assert.deepEqual(result, outcome.answer);
    assert.equal(f.budget.peak, 0, 'nothing of it ran here');
  } else {
    assert.equal(valueOf(result, IntegerType), 10n, 'it ran here instead');
    assert.equal(f.budget.peak, 1);
    assert.deepEqual(placed(f.placements).at(-1), ['local', 'call', 'fn:double', outcome.expected]);
  }
});

it('fails a call its rack stopped at its cap, by name, and runs it here only under a policy that retries failures locally', async () => {
  const f = await fixture(); const agent = await f.agent({ peak: () => 4 * 1024 ** 3 + 1 });
  const policy = setRule(f.policy, 'fn:double', 'rack', { size: 'small' });
  const rack = await f.open({ selected: true, policy });
  const running = rack.runner.runDetached(callOf(double, [encodeInt(5n)]), { storage: f.storage, functionName: 'double' });
  assert.equal((await agent.runOne())?.reason?.code, 'outgrew-cap');
  const result = await running;
  assert.equal(result.kind, 'failed');
  assert.equal(result.stderr, 'e3: memory-limit-exceeded: the call outgrew its cap of 4096 MiB on rack test rack; raise --memory-limit or --size\n');
  assert.equal(f.budget.peak, 0);
  const retrying = await f.open({ selected: true, policy: { ...policy, retryTaskFailuresLocally: true } });
  const again = retrying.runner.runDetached(callOf(double, [encodeInt(6n)]), { storage: f.storage, functionName: 'double' });
  assert.equal((await agent.runOne())?.reason?.code, 'outgrew-cap');
  assert.equal(valueOf(await again, IntegerType), 12n);
  assert.equal(f.budget.peak, 1);
});

it('runs here a call no rack claims within the claim timeout, and leaves its lease', async () => {
  const f = await fixture(); await f.agent();
  const rack = await f.open({ selected: true, policy: { ...f.policy, claimTimeoutSeconds: 1n } });
  const result = await rack.runner.runDetached(callOf(double, [encodeInt(7n)]), { storage: f.storage, functionName: 'double' });
  assert.equal(valueOf(result, IntegerType), 14n);
  assert.deepEqual(placed(f.placements), [['local', 'call', 'fn:double', 'fallback:not-claimed']]);
  assert.equal((await f.client.status()).capacity.queued, 0n, 'its lease is left');
});

it('runs here a call whose lease was lost', async () => {
  let time = Date.now();
  const f = await fixture({ now: () => time, visibilityMs: 100 }); const agent = await f.agent(); const rack = await f.open({ selected: true });
  const running = rack.runner.runDetached(callOf(double, [encodeInt(8n)]), { storage: f.storage, functionName: 'double' });
  assert(await agent.claim());
  time += 201; await f.hub.sweep();
  assert.equal(valueOf(await running, IntegerType), 16n);
  assert.deepEqual(placed(f.placements).at(-1)?.slice(0, 3), ['local', 'call', 'fn:double']);
  assert.equal(f.budget.peak, 1);
});

it('answers a call timed_out once its own timeout has passed on a rack that has not answered, and leaves its lease', async () => {
  const f = await fixture(); const agent = await f.agent(); const rack = await f.open({ selected: true });
  const started = Date.now();
  const running = rack.runner.runDetached(callOf(double, [encodeInt(9n)], { ...callLimits, timeoutMs: 500 }), { storage: f.storage, functionName: 'double' });
  const grant = await agent.claim(); assert(grant);
  assert.deepEqual(await running, { kind: 'timed_out', ms: 500, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false });
  assert(Date.now() - started >= 500);
  assert.deepEqual((await agent.heartbeat([grant])).stop, [{ repo: grant.repo, leaseId: grant.leaseId }], 'its rack is told to stop it');
  assert.equal(f.budget.peak, 0);
});

it('leaves the lease of a call its caller aborts, which ends as an aborted local call ends', async () => {
  const f = await fixture(); const agent = await f.agent(); const rack = await f.open({ selected: true });
  const abort = new AbortController();
  const running = rack.runner.runDetached(callOf(double, [encodeInt(10n)]), { storage: f.storage, functionName: 'double', signal: abort.signal });
  const grant = await agent.claim(); assert(grant);
  abort.abort();
  assert.deepEqual(await running, { kind: 'failed', exitCode: -1, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false });
  assert.deepEqual((await agent.heartbeat([grant])).stop, [{ repo: grant.repo, leaseId: grant.leaseId }]);
  assert.equal(f.budget.peak, 0);
});
