/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The API's forms for a composite record: a source as a record's description
 * answers it, a load's request, progress, result and status, and a deploy's
 * plan for an input that feeds a load. Each round-trips through beast2 as a
 * client and a server exchange it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DictType, IntegerType, StringType, StructType, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, toEastTypeValue, variant,
  type EastType, type ValueTypeOf,
} from '@elaraai/east';
import {
  InputPlanType, RecordLoadProgressType, RecordLoadRequestType, RecordLoadResultType, RecordLoadStatusType, RecordSourceInfoType,
  type InputPlan, type RecordLoadProgress, type RecordLoadResult, type RecordLoadStatus, type RecordSourceInfo,
} from './api.js';

/** Asserts a value is the value its beast2 encoding decodes to. */
function roundTrips<T extends EastType>(type: T, value: ValueTypeOf<T>, message?: string): void {
  const decoded = decodeBeast2For(type)(encodeBeast2For(type)(value));
  assert.ok(equalFor(type)(decoded, value), `${message ?? 'the value'} round-trips: ${printFor(type)(decoded)}`);
}

describe('a composite record\'s source, as its description answers it', () => {
  const OrderType = StructType({ customer: StringType, qty: IntegerType });
  const erp: RecordSourceInfo = {
    name: 'erp',
    key: toEastTypeValue(StringType),
    external: true,
    delivery: some(toEastTypeValue(DictType(StringType, OrderType))),
    feed: some([variant('field', 'tasks'), variant('field', 'erp_orders'), variant('field', 'output')]),
    last: some({ delivery: 'a'.repeat(64), commit: some('b'.repeat(64)), asOf: some(new Date(Date.UTC(2026, 10, 17, 9, 0))) }),
    pending: false,
  };
  const own: RecordSourceInfo = {
    name: 'own', key: toEastTypeValue(StringType), external: false, delivery: none, feed: none, last: none, pending: false,
  };

  it('round-trips: an external source with its feed and its last delivery, one yet to deliver, and the solution\'s own', () => {
    roundTrips(RecordSourceInfoType, erp, 'a fed source');
    roundTrips(RecordSourceInfoType, { ...erp, feed: none, last: none, pending: true }, 'a source yet to be delivered');
    roundTrips(RecordSourceInfoType, { ...erp, last: some({ delivery: 'a'.repeat(64), commit: none, asOf: none }) }, 'a delivery whose commit a compaction cut');
    roundTrips(RecordSourceInfoType, own, 'a source of the solution\'s own');
    assert.ok(!equalFor(RecordSourceInfoType)(erp, own));
  });
});

describe('a load, as a client and a server exchange it', () => {
  const loaded: RecordLoadResult = {
    commit: some('a'.repeat(64)), state: some('b'.repeat(64)), delivery: 'c'.repeat(64),
    set: 1_204n, deleted: 3n, unchanged: 58_811n, outcome: variant('loaded', null),
  };

  it('round-trips a request: a stored delivery, who asks, and the time its data is as of', () => {
    roundTrips(RecordLoadRequestType, { delivery: 'c'.repeat(64), actor: some('cli:ada'), asOf: some(new Date(Date.UTC(2026, 10, 17, 9, 0))) });
    roundTrips(RecordLoadRequestType, { delivery: 'c'.repeat(64), actor: none, asOf: none });
  });

  it('round-trips each result: a delivery loaded, one loaded before, and one superseded, which carries the source\'s as-of', () => {
    const again: RecordLoadResult = { ...loaded, set: 0n, deleted: 0n, unchanged: 0n, outcome: variant('again', null) };
    const superseded: RecordLoadResult = {
      commit: none, state: none, delivery: 'c'.repeat(64), set: 0n, deleted: 0n, unchanged: 0n,
      outcome: variant('superseded', new Date(Date.UTC(2026, 10, 17, 12, 0))),
    };
    for (const result of [loaded, again, superseded]) roundTrips(RecordLoadResultType, result, result.outcome.type);
    assert.ok(!equalFor(RecordLoadResultType)(loaded, again));
  });

  it('round-trips each step of its progress', () => {
    const steps: RecordLoadProgress[] = [
      variant('queued', null),
      variant('intake', { path: 'records/orders', step: variant('taking_in', { pieces: 12n, done: 3n }), bytes: 4_096n, total: 16_384n }),
      variant('pieces', { done: 3n, total: 12n, cached: 2n }),
      variant('commit', null),
      variant('restarted', 'the entries of source \'erp\' changed under its load'),
      variant('stopped', 'a deploy of main started. The load goes on once the deploy is done…'),
    ];
    for (const step of steps) roundTrips(RecordLoadProgressType, step, step.type);
  });

  it('round-trips each status: running, with and without its progress, and each end', () => {
    const statuses: RecordLoadStatus[] = [
      variant('processing', none),
      variant('processing', some(variant('pieces', { done: 3n, total: 12n, cached: 2n }))),
      variant('completed', loaded),
      variant('failed', { message: 'load \'erp\' names "SO-9", which is in neither its piece of the delivery nor its entries' }),
      variant('cancelled', null),
    ];
    for (const status of statuses) roundTrips(RecordLoadStatusType, status, status.type);
  });
});

describe('a deploy\'s plan for an input', () => {
  it('round-trips each action, an input kept because it feeds a load among them', () => {
    const plans: InputPlan[] = [
      { input: 'inputs/rates', action: variant('package', null) },
      { input: 'inputs/rates', action: variant('keep', null) },
      { input: 'tasks/erp_orders/output', action: variant('retained', { load: 'orders.erp' }) },
      { input: 'inputs/rates', action: variant('reset', { reason: 'its type changed', policy: false }) },
      { input: 'inputs/rates', action: variant('file', { path: 'rates.beast2', taken: true }) },
      { input: 'inputs/rates', action: variant('drop', null) },
    ];
    for (const plan of plans) roundTrips(InputPlanType, plan, plan.action.type);
  });

  it('sorts `retained` after `reset`, so every case before it keeps its place on the wire', () => {
    assert.deepEqual(Object.keys(InputPlanType.fields.action.cases), ['drop', 'file', 'keep', 'package', 'reset', 'retained']);
  });
});
