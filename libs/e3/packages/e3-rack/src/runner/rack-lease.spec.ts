/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { none, some } from '@elaraai/east';
import { Budget } from '@elaraai/e3-core';
import { DEFAULT_RACK_POLICY } from '../routing/policy.js';
import { E3_RACK_VERSION } from '../version.js';
import type { SnapshotRack } from './capacity.js';
import type { RackPlacementEvent } from '../protocol/placement.js';
import { RACK_ONLY_WAIT_MS, RackLayerBuilds, RackPlacementReport, fallbackReason, hostBound, leaveLease, outgrownCap, readDelegation, thrownFallback,
  transferFailed } from './rack-lease.js';

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
    pendingApproval: false, reported: true, features: ['resources'], target: none, problem: none, resources: some(resources(16 * GiB)), free: some(resources(GiB)) };

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
