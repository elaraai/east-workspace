/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Partition and stream task wire helpers (issue #770): the partition
 * metadata's merge fields and its triple decoder, the stream metadata's
 * `merge` mode and its dual decoder, the partition plan round trip, and the
 * `by` projection shapes the orchestrator evaluates by reading key fields
 * instead of compiling the projection.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayType, BlobType, BooleanType, East, IntegerType, OptionType, StringType, StructType, compareFor, encodeBeast2For, encodeEastIR, isTypeValueEqual, none, some, toEastTypeValue, variant } from '@elaraai/east';
import type { FunctionIR } from '@elaraai/east';
import {
  decodePartitionPlan,
  decodePartitionTaskMetadata,
  decodeStreamTaskMetadata,
  encodePartitionPlan,
  encodePartitionTaskMetadata,
  encodeStreamTaskMetadata,
  partitionProjectionShape,
  projectKey,
  projectedKeyType,
  type PartitionPlan,
  type PartitionTaskMetadata,
  type ProjectionShape,
  type StreamTaskMetadata,
} from './task.js';
import { mergeCommandIr } from './stream.js';

describe('PartitionTaskMetadataType', () => {
  const mergeIr = encodeEastIR(East.function([IntegerType, StringType, StringType], StringType, (_$, _key, acc, value) => acc.concat(value)).toIR());
  const mergeCommand = encodeEastIR(mergeCommandIr(variant('east_c', { platforms: ['east-c-std'] }), 'function'));

  /** The metadata with every blob as a plain Uint8Array — the decoder hands
   *  back Buffers, whose prototype strict deep equality would reject. */
  function plain(meta: PartitionTaskMetadata): PartitionTaskMetadata {
    const blob = (option: { type: string; value: unknown }) =>
      option.type === 'some' ? some(new Uint8Array(option.value as Uint8Array)) : none;
    return { ...meta, by: blob(meta.by), combine: blob(meta.combine), merge: blob(meta.merge), mergeCommand: blob(meta.mergeCommand) };
  }

  it('round-trips the merge fields and the merge command', () => {
    const meta: PartitionTaskMetadata = {
      partitions: 1n, by: none, combine: none, targetPartitionBytes: 1024n,
      merge: some(mergeIr), mergeSets: false, mergeCommand: some(mergeCommand),
    };
    assert.deepEqual(plain(decodePartitionTaskMetadata(encodePartitionTaskMetadata(meta))), meta);
  });

  it('decodes v1.0.77 metadata, exported before merge commands, with mergeCommand none', () => {
    const shape = StructType({
      partitions: IntegerType, by: OptionType(BlobType), combine: OptionType(BlobType), targetPartitionBytes: IntegerType,
      merge: OptionType(BlobType), mergeSets: BooleanType,
    });
    const legacy = encodeBeast2For(shape)({ partitions: 2n, by: none, combine: none, targetPartitionBytes: 512n, merge: some(mergeIr), mergeSets: false });
    assert.deepEqual(plain(decodePartitionTaskMetadata(legacy)), {
      partitions: 2n, by: none, combine: none, targetPartitionBytes: 512n, merge: some(mergeIr), mergeSets: false, mergeCommand: none,
    });
  });

  it('decodes metadata exported before merge assembly with every merge field off', () => {
    const shape = StructType({ partitions: IntegerType, by: OptionType(BlobType), combine: OptionType(BlobType), targetPartitionBytes: IntegerType });
    const legacy = encodeBeast2For(shape)({ partitions: 1n, by: none, combine: none, targetPartitionBytes: 256n });
    assert.deepEqual(decodePartitionTaskMetadata(legacy), {
      partitions: 1n, by: none, combine: none, targetPartitionBytes: 256n, merge: none, mergeSets: false, mergeCommand: none,
    });
  });

  it('throws for bytes of no known metadata shape', () => {
    assert.throws(() => decodePartitionTaskMetadata(encodeBeast2For(IntegerType)(7n)));
  });
});

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
  it('round-trips a plan, before and after its slices are carved and its merge ranges planned', () => {
    const plan: PartitionPlan = {
      partitions: ['a'.repeat(64), 'b'.repeat(64)],
      boundaries: [0n, 4n, 9n],
      splits: [[{ seg: 0n, offset: 0n }, { seg: 3n, offset: 17n }, { seg: 8n, offset: 0n }, { seg: 12n, offset: 0n }]],
      slices: [],
      merges: [],
    };
    assert.deepEqual(decodePartitionPlan(encodePartitionPlan(plan)), plan);

    const carved: PartitionPlan = { ...plan, slices: [['c'.repeat(64), 'd'.repeat(64), 'e'.repeat(64)], ['f'.repeat(64), '0'.repeat(64), '1'.repeat(64)]] };
    assert.deepEqual(decodePartitionPlan(encodePartitionPlan(carved)), carved);

    const merged: PartitionPlan = {
      ...carved,
      merges: [{ partials: ['2'.repeat(64), '3'.repeat(64)], ranges: ['4'.repeat(64), '5'.repeat(64)] }],
    };
    assert.deepEqual(decodePartitionPlan(encodePartitionPlan(merged)), merged);
  });

  it('decodes a plan recorded before merge ranges existed, with none', () => {
    // The pre-`merges` wire shape, encoded directly.
    const PreMergesPlanType = StructType({
      partitions: ArrayType(StringType),
      boundaries: ArrayType(IntegerType),
      splits: ArrayType(ArrayType(StructType({ seg: IntegerType, offset: IntegerType }))),
      slices: ArrayType(ArrayType(StringType)),
    });
    const older = encodeBeast2For(PreMergesPlanType)({
      partitions: ['a'.repeat(64)],
      boundaries: [0n, 2n],
      splits: [],
      slices: [['b'.repeat(64), 'c'.repeat(64)]],
    });
    assert.deepEqual(decodePartitionPlan(older), {
      partitions: ['a'.repeat(64)],
      boundaries: [0n, 2n],
      splits: [],
      slices: [['b'.repeat(64), 'c'.repeat(64)]],
      merges: [],
    });
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
