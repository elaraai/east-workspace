/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Partition and stream task wire helpers (issue #770): the stream metadata's
 * `merge` mode and its dual decoder, the partition plan round trip, and the
 * `by` projection shapes the orchestrator evaluates by reading key fields
 * instead of compiling the projection.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BooleanType,
  East,
  IntegerType,
  StringType,
  StructType,
  compareFor,
  encodeBeast2For,
  isTypeValueEqual,
  toEastTypeValue,
} from '@elaraai/east';
import type { FunctionIR } from '@elaraai/east';
import {
  decodePartitionPlan,
  decodeStreamTaskMetadata,
  encodePartitionPlan,
  encodeStreamTaskMetadata,
  partitionProjectionShape,
  projectKey,
  projectedKeyType,
  type PartitionPlan,
  type ProjectionShape,
  type StreamTaskMetadata,
} from './task.js';

describe('StreamTaskMetadataType', () => {
  it('round-trips the merge mode', () => {
    const meta: StreamTaskMetadata = { stream: true, emit: 'dict', merge: 'function' };
    assert.deepEqual(decodeStreamTaskMetadata(encodeStreamTaskMetadata(meta)), meta);
  });

  it('decodes metadata exported before merge modes as merge none', () => {
    const legacy = encodeBeast2For(StructType({ stream: BooleanType, emit: StringType }))({ stream: false, emit: 'set' });
    assert.deepEqual(decodeStreamTaskMetadata(legacy), { stream: false, emit: 'set', merge: 'none' });
  });

  it('throws for bytes of no known metadata shape', () => {
    assert.throws(() => decodeStreamTaskMetadata(encodeBeast2For(IntegerType)(7n)));
  });
});

describe('PartitionPlanType', () => {
  it('round-trips a plan, before and after its slices are carved', () => {
    const plan: PartitionPlan = {
      partitions: ['a'.repeat(64), 'b'.repeat(64)],
      boundaries: [0n, 4n, 9n],
      splits: [[{ seg: 0n, offset: 0n }, { seg: 3n, offset: 17n }, { seg: 8n, offset: 0n }, { seg: 12n, offset: 0n }]],
      slices: [],
    };
    assert.deepEqual(decodePartitionPlan(encodePartitionPlan(plan)), plan);

    const carved: PartitionPlan = { ...plan, slices: [['c'.repeat(64), 'd'.repeat(64), 'e'.repeat(64)], ['f'.repeat(64), '0'.repeat(64), '1'.repeat(64)]] };
    assert.deepEqual(decodePartitionPlan(encodePartitionPlan(carved)), carved);
  });
});

describe('partition projections', () => {
  const AtType = StructType({ day: IntegerType, hour: IntegerType });
  const KeyType = StructType({ region: StringType, at: AtType, sku: StringType });
  const keyTypeValue = toEastTypeValue(KeyType);
  type Key = { region: string; at: { day: bigint; hour: bigint }; sku: string };
  const keys: Key[] = [
    { region: 'eu', at: { day: 2n, hour: 7n }, sku: 'b' },
    { region: 'eu', at: { day: 2n, hour: 7n }, sku: 'a' },
    { region: 'eu', at: { day: 1n, hour: 9n }, sku: 'c' },
    { region: 'ap', at: { day: 3n, hour: 0n }, sku: 'a' },
  ];

  /** A `by` projection over the key, compiled, and its shape. */
  function projection(by: ($: any, key: any) => any): { compiled: (key: Key) => unknown; shape: ProjectionShape | null } {
    const bundle = East.function([KeyType], undefined, by).toIR();
    return {
      compiled: bundle.compile([]) as (key: Key) => unknown,
      shape: partitionProjectionShape(bundle.ir as FunctionIR),
    };
  }

  /** Whether two comparisons agree in sign. */
  const sameSign = (a: number, b: number): boolean => Math.sign(a) === Math.sign(b);

  it('reads the identity, a leading field, a struct literal of leading fields and a nested first-field path', () => {
    assert.deepEqual(projection(($, key) => key).shape, { kind: 'fields', names: [] });
    assert.deepEqual(projection(($, key) => key.region).shape, { kind: 'fields', names: ['region'] });
    assert.deepEqual(projection(($, key) => ({ region: key.region, at: key.at })).shape, { kind: 'fields', names: ['region', 'at'] });
    assert.deepEqual(projection(($, key) => key.at.day).shape, { kind: 'path', names: ['at', 'day'] });
  });

  it('returns null for a projection that computes', () => {
    assert.equal(projection(($, key) => key.region.concat('-')).shape, null);
  });

  it('projects the identity to the key itself', () => {
    const shape: ProjectionShape = { kind: 'fields', names: [] };
    assert.ok(isTypeValueEqual(projectedKeyType(shape, keyTypeValue), keyTypeValue));
    assert.equal(projectKey(shape, keys[0]), keys[0]);
  });

  it('projects a struct literal of leading fields exactly as the compiled projection does', () => {
    const { compiled, shape } = projection(($, key) => ({ region: key.region, at: key.at }));
    assert.ok(isTypeValueEqual(projectedKeyType(shape!, keyTypeValue), toEastTypeValue(StructType({ region: StringType, at: AtType }))));
    for (const key of keys) assert.deepEqual(projectKey(shape!, key), compiled(key));
  });

  it('projects a nested first-field path exactly as the compiled projection does', () => {
    const { compiled, shape } = projection(($, key) => key.at.day);
    assert.ok(isTypeValueEqual(projectedKeyType(shape!, keyTypeValue), toEastTypeValue(IntegerType)));
    for (const key of keys) assert.equal(projectKey(shape!, key), compiled(key));
  });

  it('orders a single leading field as the compiled projection does', () => {
    const { compiled, shape } = projection(($, key) => key.region);
    const cmp = compareFor(projectedKeyType(shape!, keyTypeValue) as any) as (a: unknown, b: unknown) => number;
    const cmpCompiled = compareFor(StringType);
    for (const a of keys) {
      for (const b of keys) {
        assert.ok(sameSign(cmp(projectKey(shape!, a), projectKey(shape!, b)), cmpCompiled(compiled(a) as string, compiled(b) as string)));
      }
    }
  });

  it('throws when a shape reads a field the key type does not have', () => {
    assert.throws(() => projectedKeyType({ kind: 'fields', names: ['store'] }, keyTypeValue), /field 'store'/);
    assert.throws(() => projectedKeyType({ kind: 'path', names: ['at', 'minute'] }, keyTypeValue), /field 'minute'/);
  });
});
