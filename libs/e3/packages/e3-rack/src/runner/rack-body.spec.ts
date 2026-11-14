/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { unitCap } from '@elaraai/e3-core';
import { RackLayerBuilds, leaseResources } from './rack-body.js';

const GiB = 1024 ** 3;
const rule = { eligible: true as const, tier: 'node' as const, size: 'large' as const, timeoutMinutes: 1440, memoryLimit: null, gpu: false, environment: null };
const unit = { inputs: ['a'.repeat(64)], merge: null, own: false };

it('asks of a rack what a whole task\'s size stands for, capped at its rule\'s memory limit', () => {
  assert.deepEqual(leaseResources({ options: {} }, rule), { kind: 'task', cores: 8, memoryBytes: 16 * GiB, gpu: false });
  assert.deepEqual(leaseResources({ options: {} }, { ...rule, size: 'small', gpu: true }), { kind: 'task', cores: 2, memoryBytes: 4 * GiB, gpu: true });
  assert.deepEqual(leaseResources({ options: {} }, { ...rule, memoryLimit: 6 * GiB }), { kind: 'task', cores: 8, memoryBytes: 6 * GiB, gpu: false });
  // What a task was measured to use is no part of its cap: e3 does not run a whole task again.
  assert.deepEqual(leaseResources({ options: { expectedPeakBytes: GiB } }, rule), { kind: 'task', cores: 8, memoryBytes: 16 * GiB, gpu: false });
  // No more cores than the rack with the most has: its VM is given those.
  assert.deepEqual(leaseResources({ options: {} }, rule, 4), { kind: 'task', cores: 4, memoryBytes: 16 * GiB, gpu: false });
  assert.deepEqual(leaseResources({ options: {} }, rule, 32), { kind: 'task', cores: 8, memoryBytes: 16 * GiB, gpu: false });
  // A unit takes one core, whatever the racks have.
  assert.deepEqual(leaseResources({ unit, options: {} }, rule, 4), { kind: 'unit', cores: 1, memoryBytes: 16 * GiB, gpu: false });
});

it('asks one core for a unit of a split task, and the cap a local unit expecting the same peak is given', () => {
  assert.equal(unitCap(2 * GiB), 3 * GiB);
  // It reserves what it expects, as a local unit does, and is capped half as much again.
  assert.deepEqual(leaseResources({ unit, options: { expectedPeakBytes: 2 * GiB } }, rule), { kind: 'unit', cores: 1, memoryBytes: 3 * GiB, reserveBytes: 2 * GiB, gpu: false });
  assert.deepEqual(leaseResources({ unit, options: { expectedPeakBytes: 2 * GiB } }, { ...rule, memoryLimit: 3 * GiB }), { kind: 'unit', cores: 1, memoryBytes: 3 * GiB, reserveBytes: 2 * GiB, gpu: false },
    'a cap of exactly the limit is within it');
  // A first run's estimate is booked as a measured peak is: the first run is as wide as a later one.
  assert.deepEqual(leaseResources({ unit, options: { expectedPeakBytes: 2 * GiB, expectedPeakGuessed: true } }, { ...rule, memoryLimit: 8 * GiB }),
    { kind: 'unit', cores: 1, memoryBytes: 3 * GiB, reserveBytes: 2 * GiB, gpu: false });
  // A unit that expects nothing at all: its rule's limit, else its size's memory.
  assert.deepEqual(leaseResources({ unit, options: {} }, rule), { kind: 'unit', cores: 1, memoryBytes: 16 * GiB, gpu: false });
  assert.deepEqual(leaseResources({ unit, options: {} }, { ...rule, memoryLimit: 8 * GiB }), { kind: 'unit', cores: 1, memoryBytes: 8 * GiB, gpu: false });
  assert.deepEqual(leaseResources({ unit, options: { expectedPeakBytes: 0 } }, rule), { kind: 'unit', cores: 1, memoryBytes: 16 * GiB, gpu: false });
});

it('builds an environment\'s layers for a platform once in a session, and tries one that failed again in the next run, but not one refused', async () => {
  const builds = new RackLayerBuilds();
  let made = 0;
  const failing = () => { made++; return Promise.resolve({ reason: 'build-failed', said: 'the download failed' }); };
  const [a, b] = await Promise.all([builds.get('env', 'x86_64-manylinux_2_28', failing), builds.get('env', 'x86_64-manylinux_2_28', failing)]);
  assert.deepEqual([a, b, made], [{ reason: 'build-failed', said: 'the download failed' }, { reason: 'build-failed', said: 'the download failed' }, 1],
    'the work of a run asks once, and is answered what the build came to');
  await builds.get('env', 'x86_64-manylinux_2_28', failing);
  assert.equal(made, 1, 'not again in the same run');
  builds.forgetFailures();
  assert.deepEqual(await builds.get('env', 'x86_64-manylinux_2_28', () => { made++; return Promise.resolve({}); }), {});
  assert.equal(made, 2, 'the next run tries it again');

  let refusals = 0;
  const refused = () => { refusals++; return Promise.resolve({ reason: 'no-wheel:fastfit', said: 'no wheel' }); };
  await builds.get('other', 'x86_64-manylinux_2_28', refused);
  builds.forgetFailures();
  await builds.get('other', 'x86_64-manylinux_2_28', refused);
  assert.equal(refusals, 1, 'an environment no install makes for the platform is not tried again');
});

it('refuses a rack a unit whose cap would pass its rule\'s memory limit, with what it needs and the limit', () => {
  for (const expectedPeakGuessed of [false, true]) {
    assert.deepEqual(leaseResources({ unit, options: { expectedPeakBytes: 2 * GiB, expectedPeakGuessed } }, { ...rule, memoryLimit: 3 * GiB - 1 }),
      { code: 'memory-limit-exceeded', needsBytes: 3 * GiB, limitBytes: 3 * GiB - 1 });
  }
});
