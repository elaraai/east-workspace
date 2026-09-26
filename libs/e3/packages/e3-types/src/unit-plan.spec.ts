/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBeast2For, equalFor, none, some, variant } from '@elaraai/east';
import { UNIT_PLAN_KIND, UnitPlanType, decodeUnitPlan, encodeUnitPlan, type UnitPlan } from './unit-plan.js';

describe('unit plans', () => {
  it('round-trips each stage', () => {
    const plans: UnitPlan[] = [
      { kind: UNIT_PLAN_KIND, task: 'a1', inputs: 'b2', stage: variant('pieces', [['c3', 'd4'], ['e5', 'd4']]), previous: none, peakBytes: none },
      {
        kind: UNIT_PLAN_KIND, task: 'a1', inputs: 'b2',
        stage: variant('merge', { level: 1n, levels: 2n, groups: [{ range: some('f6'), entries: ['g7', 'h8'] }, { range: none, entries: ['i9'] }] }),
        previous: some('j0'),
        peakBytes: some(52_428_800n),
      },
    ];
    for (const plan of plans) {
      assert.ok(equalFor(UnitPlanType)(decodeUnitPlan(encodeUnitPlan(plan)), plan));
    }
  });

  it('refuses an object of another kind', () => {
    const other = encodeBeast2For(UnitPlanType)({ kind: 'task', task: 'a1', inputs: 'b2', stage: variant('pieces', []), previous: none, peakBytes: none });
    assert.throws(() => decodeUnitPlan(other), { message: "the object is not a unit plan: its kind is 'task', not '$plan'" });
  });
});
