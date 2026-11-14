/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { unitCap } from '@elaraai/e3-core';
import { leaseResources } from './rack-body.js';

const GiB = 1024 ** 3;
const rule = { eligible: true as const, tier: 'node' as const, size: 'large' as const, timeoutMinutes: 1440, memoryLimit: null, gpu: false, environment: null };
const unit = { inputs: ['a'.repeat(64)], merge: null, own: false };

it('asks of a rack what a whole task\'s size stands for, capped at its rule\'s memory limit', () => {
  assert.deepEqual(leaseResources({ options: {} }, rule), { kind: 'task', cores: 8, memoryBytes: 16 * GiB, gpu: false });
  assert.deepEqual(leaseResources({ options: {} }, { ...rule, size: 'small', gpu: true }), { kind: 'task', cores: 2, memoryBytes: 4 * GiB, gpu: true });
  assert.deepEqual(leaseResources({ options: {} }, { ...rule, memoryLimit: 6 * GiB }), { kind: 'task', cores: 8, memoryBytes: 6 * GiB, gpu: false });
  // What a task was measured to use is no part of its cap: e3 does not run a whole task again.
  assert.deepEqual(leaseResources({ options: { expectedPeakBytes: GiB } }, rule), { kind: 'task', cores: 8, memoryBytes: 16 * GiB, gpu: false });
});

it('asks one core for a unit of a split task, and the cap a local unit expecting the same peak is given', () => {
  assert.equal(unitCap(2 * GiB), 3 * GiB);
  assert.deepEqual(leaseResources({ unit, options: { expectedPeakBytes: 2 * GiB } }, rule), { kind: 'unit', cores: 1, memoryBytes: 3 * GiB, gpu: false });
  assert.deepEqual(leaseResources({ unit, options: { expectedPeakBytes: 2 * GiB } }, { ...rule, memoryLimit: 3 * GiB }), { kind: 'unit', cores: 1, memoryBytes: 3 * GiB, gpu: false },
    'a cap of exactly the limit is within it');
  // A unit nothing has measured yet: its rule's limit, else its size's memory.
  assert.deepEqual(leaseResources({ unit, options: {} }, rule), { kind: 'unit', cores: 1, memoryBytes: 16 * GiB, gpu: false });
  assert.deepEqual(leaseResources({ unit, options: {} }, { ...rule, memoryLimit: 8 * GiB }), { kind: 'unit', cores: 1, memoryBytes: 8 * GiB, gpu: false });
  // A guess from what the unit holds of its rows is no measurement: e3-core caps no local unit by one, and no lease is capped by one.
  assert.deepEqual(leaseResources({ unit, options: { expectedPeakBytes: 2 * GiB, expectedPeakGuessed: true } }, { ...rule, memoryLimit: 8 * GiB }),
    { kind: 'unit', cores: 1, memoryBytes: 8 * GiB, gpu: false });
  assert.deepEqual(leaseResources({ unit, options: { expectedPeakBytes: 0 } }, rule), { kind: 'unit', cores: 1, memoryBytes: 16 * GiB, gpu: false });
});

it('refuses a rack a unit whose cap would pass its rule\'s memory limit, with what it needs and the limit', () => {
  assert.deepEqual(leaseResources({ unit, options: { expectedPeakBytes: 2 * GiB } }, { ...rule, memoryLimit: 3 * GiB - 1 }),
    { code: 'memory-limit-exceeded', needsBytes: 3 * GiB, limitBytes: 3 * GiB - 1 });
});
