/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { availableParallelism, totalmem } from 'node:os';
import { none, some, variant } from '@elaraai/east';
import { Budget, type StorageBackend, type TierManifest } from '@elaraai/e3-core';
import type { RackSession } from '../client/session.js';
import { DEFAULT_RACK_POLICY } from '../routing/policy.js';
import { E3_RACK_VERSION } from '../version.js';
import type { SnapshotRack } from './capacity.js';
import type { RackPlacementEvent } from '../protocol/placement.js';
import { RACK_ONLY_WAIT_MS, RackFleet, RackLayerBuilds, RackPlacementReport, fallbackReason, fitsHere, hereMs, hostBound, leaveLease, outgrownCap, readDelegation, thrownFallback,
  transferFailed, wholeResources, type RackLayerBuild, type RackTierImage, type RackVerdict } from './rack-lease.js';

const GiB = 1024 ** 3;
const needs = { kind: 'task' as const, cores: 8, memoryBytes: 16 * GiB, gpu: false };

it('reads a run\'s delegation options once: its defaults, the layer builds it is given, and when its work may spill here', () => {
  const defaults = readDelegation({ policy: DEFAULT_RACK_POLICY });
  assert.equal(defaults.rackOnly, false);
  assert.equal(defaults.unreachableWaitMs, RACK_ONLY_WAIT_MS);
  assert.equal(defaults.spills(undefined), DEFAULT_RACK_POLICY.spill, 'with no budget, this machine always could');

  const builds = new RackLayerBuilds();
  const kept = readDelegation({ policy: DEFAULT_RACK_POLICY, rackOnly: true, unreachableWaitMs: 5, layerBuilds: builds });
  assert.equal(kept.builds, builds);
  assert.equal(kept.unreachableWaitMs, 5);
  assert.equal(kept.spills(undefined), false, 'work kept for a rack never spills');
  assert.equal(readDelegation({ policy: { ...DEFAULT_RACK_POLICY, spill: false } }).spills(undefined), false);
  // Nothing is weighed for what it would fetch unless the policy turns it on; work kept for a rack never is
  assert.equal(DEFAULT_RACK_POLICY.weighFetch, false);
  assert.equal(defaults.weighsFetch, false, 'off by default');
  assert.equal(readDelegation({ policy: { ...DEFAULT_RACK_POLICY, weighFetch: true } }).weighsFetch, true, 'a policy that turns it on');
  assert.equal(readDelegation({ policy: { ...DEFAULT_RACK_POLICY, weighFetch: true }, rackOnly: true }).weighsFetch, false, 'work kept for a rack is not weighed');
  // A rack keeps what work wrote for a split task alone, unless the policy keeps it for the session
  assert.equal(defaults.keepsSession, false);
  assert.equal(kept.keepsSession, false);
  assert.equal(readDelegation({ policy: { ...DEFAULT_RACK_POLICY, keep: variant('session', null) } }).keepsSession, true);

  // A budget with no core free does not take the work
  const budget = new Budget({ cores: 1, memory: GiB }, { sampler: null });
  const spilling = readDelegation({ policy: { ...DEFAULT_RACK_POLICY, spill: true } });
  assert.equal(spilling.spills(budget), true);
  assert.equal(spilling.spills(budget, 2 * GiB), true, 'work larger than the budget runs alone on an idle machine');
});

it('says work is bound to this machine by the process settings its runner was configured with, or variables of its own', () => {
  assert.equal(hostBound({}, undefined), false);
  assert.equal(hostBound({}, {}), false);
  assert.equal(hostBound({ env: { PATH: '/bin' } }, undefined), true);
  assert.equal(hostBound({ uid: 1000 }, undefined), true);
  assert.equal(hostBound({ gid: 1000 }, undefined), true);
  assert.equal(hostBound({}, { TOKEN: 'x' }), true);
});

it('words a fallback by the rack\'s reason, with the result\'s words where the reason has none, and by the result alone where it gave none', () => {
  assert.equal(fallbackReason({ code: 'guest-crashed', detail: 'the VM died' }, 'ignored', 'rack execution failed'), 'fallback:guest-crashed: the VM died');
  assert.equal(fallbackReason({ code: 'input-transfer-failed', attempts: 5, cause: 'connection reset' }, undefined, 'rack execution failed'),
    'fallback:input-transfer-failed: connection reset');
  assert.equal(fallbackReason({ code: 'task-error' }, 'exit 3', 'rack execution failed'), 'fallback:task-error: exit 3');
  assert.equal(fallbackReason(undefined, 'the agent is draining', 'the rack stopped the call'), 'fallback:the agent is draining');
  assert.equal(fallbackReason(undefined, undefined, 'the rack answered no outcome of the call'), 'fallback:the rack answered no outcome of the call');
  assert.equal(thrownFallback(new Error('socket closed')), 'fallback:socket closed');
  assert.equal(thrownFallback('refused'), 'fallback:refused');
});

it('leases work once more only for a transfer that failed its tries', () => {
  assert.equal(transferFailed({ code: 'input-transfer-failed', attempts: 5, cause: 'reset' }), true);
  assert.equal(transferFailed({ code: 'output-transfer-failed', attempts: 5, cause: 'reset' }), true);
  assert.equal(transferFailed({ code: 'guest-crashed', detail: 'the VM died' }), false);
  assert.equal(transferFailed(undefined), false);
});

it('takes the cap a rack stopped work at from its reason, or from what the lease asked when the reason names none', () => {
  assert.equal(outgrownCap({ code: 'outgrew-cap', capBytes: 4 * GiB }, needs), 4 * GiB);
  assert.equal(outgrownCap({ code: 'outgrew-cap' }, needs), 16 * GiB);
});

it('leaves a lease the work holds, whatever the hub answers, and nothing when it holds none', async () => {
  let left = 0;
  await leaveLease(undefined);
  await leaveLease({ cancel: () => { left++; return Promise.resolve(); } });
  await leaveLease({ cancel: () => { left++; return Promise.reject(new Error('the hub is gone')); } });
  assert.equal(left, 2);
});

it('tells a run where work is placed lease by lease: its wait, its claims, what its rack said of it, and where it ran after all', () => {
  const events: RackPlacementEvent[] = [];
  const work = { taskName: 'fn:score', role: 'call' as const };
  const report = new RackPlacementReport((event) => { events.push(event); }, work);
  const resources = (memoryBytes: number) => ({ cores: 8n, memoryBytes: BigInt(memoryBytes), gpus: 0n });
  const rack: SnapshotRack = { rackId: 'r1', label: 'rack-a', tiers: ['node'], capacity: 4n, busy: 0n, healthy: true, bundledE3: some(E3_RACK_VERSION),
    pendingApproval: false, reported: true, features: ['resources'], target: none, problem: none, resources: some(resources(16 * GiB)), free: some(resources(GiB)),
    tierManifests: [] };

  assert.equal(report.rackLabel, 'rack', 'until a rack claims it');
  report.waiting(needs)(rack, { cores: 0, memoryBytes: GiB, gpus: 0 }, 'L1');
  report.queued({ waitingSince: Date.now() - 1000 });
  report.claimed('rack-a', 'L1', needs);
  assert.equal(report.rackLabel, 'rack-a');
  // Its transfer was retried, and its rack gave a reason
  const reason = report.reason('L1', { retries: [{ transfer: 'input', attempt: 2, of: 5, cause: 'connection reset' }], reason: { code: 'outgrew-cap', capBytes: 16 * GiB } });
  assert.deepEqual(reason, { code: 'outgrew-cap', capBytes: 16 * GiB });
  report.outgrew('L1', 16 * GiB, 24 * GiB);
  // Leased again: it did not wait this time, and a run counts it once
  report.queued({});
  report.claimed('rack-b', 'L2', needs);
  report.outgrew('L2', 24 * GiB);
  report.stopped('L2', 2 * GiB, 2 * GiB);
  report.local('fallback:guest-crashed: the VM died', { code: 'guest-crashed', detail: 'the VM died' });
  report.local('spill');

  const [waiting, claimed, ...rest] = events;
  assert.deepEqual(waiting, { kind: 'waiting', ...work, where: 'rack', rackLabel: 'rack-a', leaseId: 'L1', needs, free: { cores: 0, memoryBytes: GiB, gpus: 0 } });
  assert(claimed?.kind === 'placed' && claimed.where === 'rack');
  assert.ok(claimed.waitedMs !== undefined && claimed.waitedMs >= 1000, 'it says how long it waited for room');
  assert.deepEqual({ ...claimed, waitedMs: undefined }, { kind: 'placed', ...work, where: 'rack', rackLabel: 'rack-a', leaseId: 'L1', needs, waitedMs: undefined });
  assert.deepEqual(rest, [
    { kind: 'retried', ...work, where: 'rack', rackLabel: 'rack-a', leaseId: 'L1', retry: { transfer: 'input', attempt: 2, of: 5, cause: 'connection reset' } },
    { kind: 'outgrew', ...work, where: 'rack', rackLabel: 'rack-a', leaseId: 'L1', capBytes: 16 * GiB, againBytes: 24 * GiB },
    { kind: 'placed', ...work, where: 'rack', rackLabel: 'rack-b', leaseId: 'L2', needs, again: true },
    { kind: 'outgrew', ...work, where: 'rack', rackLabel: 'rack-b', leaseId: 'L2', capBytes: 24 * GiB },
    { kind: 'stopped', ...work, where: 'rack', rackLabel: 'rack-b', leaseId: 'L2', peakBytes: 2 * GiB, againBytes: 2 * GiB },
    { kind: 'placed', ...work, where: 'local', reason: 'fallback:guest-crashed: the VM died', detail: { code: 'guest-crashed', detail: 'the VM died' } },
    { kind: 'placed', ...work, where: 'local', reason: 'spill' },
  ]);
  // A run that does not listen is told nothing, and the report still keeps its rack
  const silent = new RackPlacementReport(undefined, work);
  silent.claimed('rack-a', 'L1', needs);
  assert.equal(silent.rackLabel, 'rack-a');
});

/** A python runtime image's manifest, which names no distribution. */
const TIER: TierManifest = { python: { version: '3.11.2', executable: '/opt/venv/bin/python', base: '/usr/bin/python3',
  site: '/opt/venv/lib/python3.11/site-packages', namespaces: [], distributions: [] } };

it('builds an environment\'s layers once for each tier over an image, though two tiers boot one image, as their manifests\' keys name the tier', async () => {
  // A repository that holds no environment: a build fails at once, having asked for its spec
  let asked = 0;
  const storage = { objects: { read: () => { asked++; return Promise.reject(new Error('no such object')); } } } as unknown as StorageBackend;
  const builds = new RackLayerBuilds();
  const over = { digest: `sha256:${'a'.repeat(64)}`, manifest: TIER };
  const target = (tier: string) => ({ platform: 'x86_64-manylinux_2_28', tier, e3Version: E3_RACK_VERSION, over });
  assert.equal((await builds.publish(storage, '/repo', 'e'.repeat(64), target('py'))).reason, 'build-failed');
  await builds.publish(storage, '/repo', 'e'.repeat(64), target('py'));
  assert.equal(asked, 1, 'asked again for one tier, it is answered what the first build came to');
  await builds.publish(storage, '/repo', 'e'.repeat(64), target('py-datascience'));
  assert.equal(asked, 2, 'another tier over the same image is its own build');
});

it('tries an environment whole for a platform whose build over a rack\'s tier image failed, and leases the work to that rack when it is kept', async () => {
  const digest = `sha256:${'b'.repeat(64)}`;
  const resources = (cores: number, memoryBytes: number) => ({ cores: BigInt(cores), memoryBytes: BigInt(memoryBytes), gpus: 0n });
  const rack: SnapshotRack = { rackId: 'r1', label: 'rack-a', tiers: ['py'], capacity: 4n, busy: 0n, healthy: true, bundledE3: some(E3_RACK_VERSION),
    pendingApproval: false, reported: true, features: ['environments'], target: some('x86_64-manylinux_2_28'), problem: none,
    resources: some(resources(8, 64 * GiB)), free: some(resources(8, 64 * GiB)), tierManifests: [{ tier: 'py', manifest: digest }] };
  const session = { capacity: () => ({ racks: [rack], queued: 0n, mine: { pending: 0n, claimed: 0n } }), hubLost: false } as unknown as RackSession;
  const verdict: RackVerdict = { eligible: true, tier: 'py', size: 'small', timeoutMinutes: 60, memoryLimit: null, gpu: false, environment: 'e'.repeat(64) };
  const built: Array<string | undefined> = [];
  const place = (outcome: (image?: RackTierImage) => RackLayerBuild) => new RackFleet(session, verdict, false).place({
    rackOnly: false, unreachableWaitMs: 0, asks: (cores) => wholeResources(verdict, cores),
    layers: (_environment, _platform, image) => { built.push(image?.digest); return Promise.resolve(outcome(image)); } });

  // No wheel of a dependency for the image's Python, which the whole build's own Python has
  const placed = await place((image) => image === undefined ? {} : { reason: 'no-wheel:onlyfor312', said: 'onlyfor312 has no wheel for it' });
  assert.deepEqual(placed, { kind: 'rack', resources: wholeResources(verdict, 8) });
  assert.deepEqual(built, [digest, undefined], 'built over the image, then whole');

  // Neither is kept: the work runs here, by the whole build's reason and words
  built.length = 0;
  assert.deepEqual(await place((image) => image === undefined ? { reason: 'build-failed', said: 'the whole build failed' } : { reason: 'no-wheel:x', said: 'over it' }),
    { kind: 'local', why: { reason: 'environment:build-failed', said: 'the whole build failed' } });
  assert.deepEqual(built, [digest, undefined]);

  // Kept over the image: nothing is built whole
  built.length = 0;
  assert.equal((await place(() => ({ over: true }))).kind, 'rack');
  assert.deepEqual(built, [digest]);
});

it('weighs work once a rack could hold it and before any of its environment\'s layers are built, and builds none for work that runs here', async () => {
  const resources = (cores: number, memoryBytes: number) => ({ cores: BigInt(cores), memoryBytes: BigInt(memoryBytes), gpus: 0n });
  const rack = (rackId: string, memoryBytes: number): SnapshotRack => ({ rackId, label: rackId, tiers: ['py'], capacity: 4n, busy: 0n, healthy: true,
    bundledE3: some(E3_RACK_VERSION), pendingApproval: false, reported: true, features: ['environments'], target: some('x86_64-manylinux_2_28'), problem: none,
    resources: some(resources(8, memoryBytes)), free: some(resources(8, memoryBytes)), tierManifests: [] });
  // One rack could hold the work, and one too small for it could not
  const session = { capacity: () => ({ racks: [rack('large', 64 * GiB), rack('small', GiB)], queued: 0n, mine: { pending: 0n, claimed: 0n } }), hubLost: false } as unknown as RackSession;
  const verdict: RackVerdict = { eligible: true, tier: 'py', size: 'small', timeoutMinutes: 60, memoryLimit: null, gpu: false, environment: 'e'.repeat(64) };
  const built: string[] = [];
  const weighed: string[][] = [];
  const fetch = { bytes: 903 * 1024 ** 2, fetchMs: 90_300, ranMs: 19_000, measured: true };
  const place = (bound: boolean) => new RackFleet(session, verdict, false).place({ rackOnly: false, unreachableWaitMs: 0, asks: (cores) => wholeResources(verdict, cores),
    layers: (_environment, platform) => { built.push(platform); return Promise.resolve({}); },
    weigh: (_asked, racks) => { weighed.push(racks.map((one) => one.rackId)); return Promise.resolve(bound ? { reason: 'fetch-bound', fetch } : null); } });

  assert.deepEqual(await place(true), { kind: 'local', why: { reason: 'fetch-bound', fetch } });
  assert.deepEqual(weighed, [['large']], 'weighed against the rack that could hold it');
  assert.deepEqual(built, [], 'and nothing was built for a rack');
  assert.equal((await place(false)).kind, 'rack');
  assert.deepEqual(built, ['x86_64-manylinux_2_28'], 'work that goes on to a rack is built for then');
});

it('says this machine could run work only when it takes no GPU and expects no more memory than the run\'s budget has, and takes work given more cores there to run longer here', () => {
  const budget = { cores: 8, memory: 16 * GiB };
  assert.equal(fitsHere({ gpu: false, expectedBytes: 4 * GiB }, budget), true);
  assert.equal(fitsHere({ gpu: true, expectedBytes: 4 * GiB }, budget), false, 'a GPU stays on its rack');
  assert.equal(fitsHere({ gpu: false, expectedBytes: 24 * GiB }, budget), false, 'more memory than the budget');
  assert.equal(fitsHere({ gpu: false, expectedBytes: totalmem() + 1 }, undefined), false, 'with no budget, this host\'s');
  assert.equal(hereMs(19_000, 16, budget), 38_000, 'twice the cores there: twice as long here');
  assert.equal(hereMs(19_000, 1, budget), 19_000, 'one core: as long');
  assert.equal(hereMs(19_000, 2 * availableParallelism(), undefined), 38_000, 'with no budget, this host\'s cores');
});
