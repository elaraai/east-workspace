/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Task object wire: the typed task object's round trip and its refusals, the
 * partition plan round trip, and the `by` projection shapes read by key field
 * instead of compiled.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayType, BlobType, East, IntegerType, OptionType, StringType, StructType, compareFor, encodeBeast2For, isTypeValueEqual, none, some, toEastTypeValue, variant } from '@elaraai/east';
import type { FunctionIR } from '@elaraai/east';
import {
  TASK_OBJECT_KIND,
  TaskObjectType,
  decodePartitionPlan,
  decodeTaskObject,
  encodePartitionPlan,
  partitionProjectionShape,
  projectKey,
  projectedKeyType,
  type PartitionPlan,
  type ProjectionShape,
  type TaskObject,
} from './task.js';
import { RunnerType } from './runner.js';
import { TreePathType } from './structure.js';

describe('TaskObjectType', () => {
  const sales = [variant('field', 'inputs'), variant('field', 'sales')];
  const rates = [variant('field', 'inputs'), variant('field', 'rates')];
  const totals = [variant('field', 'tasks'), variant('field', 'totals'), variant('field', 'output')];
  const base: TaskObject = {
    kind: TASK_OBJECT_KIND,
    body: variant('east', { program: 'a'.repeat(64) }),
    runner: variant('east_node', { platforms: ['@elaraai/east-node-std'] }),
    inputs: [{ path: sales, partition: none }],
    output: { path: totals, kind: variant('value', null) },
    role: variant('data', null),
    environment: none,
  };

  it('round-trips every body, output kind and role', () => {
    const tasks: TaskObject[] = [
      base,
      {
        ...base,
        body: variant('command', { commandIr: 'b'.repeat(64) }),
        runner: variant('custom', { command: [] }),
        environment: some('c'.repeat(64)),
      },
      {
        ...base,
        inputs: [{ path: sales, partition: some({ by: ['account', 'at.day'] }) }, { path: rates, partition: none }],
        output: { path: totals, kind: variant('dict', { merge: some('d'.repeat(64)) }) },
      },
      { ...base, output: { path: totals, kind: variant('fold', { zero: 'e'.repeat(64), combine: 'f'.repeat(64) }) } },
      { ...base, output: { path: totals, kind: variant('set', null) } },
      { ...base, role: variant('ui', { paths: [sales], functions: ['forecast'], records: ['plans'], pages: [rates] }) },
    ];
    const encode = encodeBeast2For(TaskObjectType);
    for (const original of tasks) assert.deepEqual(decodeTaskObject(encode(original)), original);
  });

  it('refuses a task object an older SDK exported, saying to re-export the package', () => {
    const PreCutoverTaskObjectType = StructType({
      commandIr: StringType,
      inputs: ArrayType(TreePathType),
      output: TreePathType,
      kind: OptionType(StringType),
      metadata: OptionType(BlobType),
      runner: RunnerType,
      environment: OptionType(StringType),
    });
    const older = encodeBeast2For(PreCutoverTaskObjectType)({
      commandIr: 'a'.repeat(64),
      inputs: [[variant('field', 'tasks'), variant('field', 'totals'), variant('field', 'function_ir')], sales],
      output: totals,
      kind: none,
      metadata: none,
      runner: variant('east_node', { platforms: [] }),
      environment: none,
    });
    assert.throws(() => decodeTaskObject(older), /exported by an older e3 SDK — re-export it with the current one/);
  });

  it('refuses an object of the task shape that carries another kind tag', () => {
    assert.throws(() => decodeTaskObject(encodeBeast2For(TaskObjectType)({ ...base, kind: '$plan' })), /its kind is '\$plan', not '\$task'/);
  });

  it('throws for bytes of no known task shape', () => {
    assert.throws(() => decodeTaskObject(encodeBeast2For(IntegerType)(7n)), /re-export/);
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
