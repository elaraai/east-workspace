/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { East, StringType, IntegerType, FloatType, StructType, DictType, SetType, ArrayType, variant, decodeEastIR } from '@elaraai/east';
import { TASK_KIND_PARTITION, TASK_KIND_STREAM, decodePartitionTaskMetadata, decodeStreamTaskMetadata } from '@elaraai/e3-types';
import { task, partitionTask, streamTask } from './task.js';
import { input } from './input.js';

describe('task', () => {
  describe('type inference', () => {
    it('accepts single input dataset', () => {
      const name_input = input('name', StringType, variant('value', 'World'));

      const greet = task(
        'greet',
        [name_input],
        East.function(
          [StringType],
          StringType,
          ($, name) => $.return(East.str`Hello, ${name}!`)
        )
      );

      assert.strictEqual(greet.kind, 'task');
      assert.strictEqual(greet.name, 'greet');
      assert.strictEqual(greet.output.kind, 'dataset');
    });

    it('accepts multiple input datasets with different types', () => {
      const name_input = input('name', StringType, variant('value', 'World'));
      const count_input = input('count', IntegerType, variant('value', 1n));

      const repeat_greet = task(
        'repeat_greet',
        [name_input, count_input],
        East.function(
          [StringType, IntegerType],
          StringType,
          ($, name, _count) => $.return(East.str`Hello, ${name}!`)
        )
      );

      assert.strictEqual(repeat_greet.kind, 'task');
      assert.strictEqual(repeat_greet.name, 'repeat_greet');
    });

    it('accepts three input datasets', () => {
      const a_input = input('a', StringType, variant('value', 'a'));
      const b_input = input('b', IntegerType, variant('value', 1n));
      const c_input = input('c', FloatType, variant('value', 1.0));

      const combine = task(
        'combine',
        [a_input, b_input, c_input],
        East.function(
          [StringType, IntegerType, FloatType],
          StringType,
          ($, a, _b, _c) => $.return(a)
        )
      );

      assert.strictEqual(combine.kind, 'task');
      assert.strictEqual(combine.inputs.length, 4); // 3 inputs + function_ir
    });

    it('accepts four input datasets (tuple type preservation)', () => {
      const a_input = input('a', StringType, variant('value', 'a'));
      const b_input = input('b', IntegerType, variant('value', 1n));
      const c_input = input('c', FloatType, variant('value', 1.0));
      const d_input = input('d', StringType, variant('value', 'd'));

      const combine_four = task(
        'combine_four',
        [a_input, b_input, c_input, d_input],
        East.function(
          [StringType, IntegerType, FloatType, StringType],
          StringType,
          ($, a, _b, _c, _d) => $.return(a)
        )
      );

      assert.strictEqual(combine_four.kind, 'task');
      assert.strictEqual(combine_four.inputs.length, 5); // 4 inputs + function_ir
    });

    it('accepts struct type inputs', () => {
      const PersonType = StructType({
        name: StringType,
        age: IntegerType,
      });

      const person_input = input('person', PersonType, variant('value', { name: 'Alice', age: 30n }));

      const describe_person = task(
        'describe_person',
        [person_input],
        East.function(
          [PersonType],
          StringType,
          ($, person) => $.return(East.str`${person.name} is ${person.age} years old`)
        )
      );

      assert.strictEqual(describe_person.kind, 'task');
    });
  });

  describe('task chaining', () => {
    it('allows using task output as input to another task', () => {
      const name_input = input('name', StringType, variant('value', 'World'));

      const greet = task(
        'greet',
        [name_input],
        East.function(
          [StringType],
          StringType,
          ($, name) => $.return(East.str`Hello, ${name}!`)
        )
      );

      const shout = task(
        'shout',
        [greet.output],
        East.function(
          [StringType],
          StringType,
          ($, greeting) => $.return(East.str`${greeting}!!!`)
        )
      );

      assert.strictEqual(shout.kind, 'task');
      assert.strictEqual(shout.name, 'shout');
      // shout depends on greet's output
      assert.ok(shout.deps.has(greet.output));
    });

    it('allows mixing inputs and task outputs', () => {
      const name_input = input('name', StringType, variant('value', 'World'));
      const suffix_input = input('suffix', StringType, variant('value', '!'));

      const greet = task(
        'greet',
        [name_input],
        East.function(
          [StringType],
          StringType,
          ($, name) => $.return(East.str`Hello, ${name}`)
        )
      );

      const add_suffix = task(
        'add_suffix',
        [greet.output, suffix_input],
        East.function(
          [StringType, StringType],
          StringType,
          ($, greeting, suffix) => $.return(East.str`${greeting}${suffix}`)
        )
      );

      assert.strictEqual(add_suffix.kind, 'task');
      assert.strictEqual(add_suffix.inputs.length, 3); // function_ir + 2 inputs
    });
  });

  describe('async functions', () => {
    it('accepts an async function', () => {
      const name_input = input('name', StringType, variant('value', 'World'));

      const greet = task(
        'greet',
        [name_input],
        East.asyncFunction(
          [StringType],
          StringType,
          ($, name) => $.return(East.str`Hello, ${name}!`)
        )
      );

      assert.strictEqual(greet.kind, 'task');
      assert.strictEqual(greet.name, 'greet');
      assert.strictEqual(greet.output.kind, 'dataset');
      assert.strictEqual(greet.output.type, StringType);
    });

    it('accepts async function with multiple inputs', () => {
      const name_input = input('name', StringType, variant('value', 'World'));
      const count_input = input('count', IntegerType, variant('value', 1n));

      const repeat_greet = task(
        'repeat_greet',
        [name_input, count_input],
        East.asyncFunction(
          [StringType, IntegerType],
          StringType,
          ($, name, _count) => $.return(East.str`Hello, ${name}!`)
        )
      );

      assert.strictEqual(repeat_greet.kind, 'task');
      assert.strictEqual(repeat_greet.inputs.length, 3); // function_ir + 2 inputs
    });
  });

  describe('task structure', () => {
    it('creates correct output path', () => {
      const name_input = input('name', StringType, variant('value', 'World'));

      const greet = task(
        'my_task',
        [name_input],
        East.function(
          [StringType],
          StringType,
          ($, name) => $.return(name)
        )
      );

      assert.deepStrictEqual(greet.output.path, [
        variant('field', 'tasks'),
        variant('field', 'my_task'),
        variant('field', 'output'),
      ]);
    });

    it('includes function_ir as first input', () => {
      const name_input = input('name', StringType, variant('value', 'World'));

      const greet = task(
        'greet',
        [name_input],
        East.function(
          [StringType],
          StringType,
          ($, name) => $.return(name)
        )
      );

      // First input should be the function_ir dataset
      assert.strictEqual(greet.inputs[0].name, 'function_ir');
    });

    it('preserves custom runner config', () => {
      const name_input = input('name', StringType, variant('value', 'World'));

      const greet = task(
        'greet',
        [name_input],
        East.function(
          [StringType],
          StringType,
          ($, name) => $.return(name)
        ),
        {
          runner: { runtime: 'custom', command: ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'] },
        }
      );

      assert.strictEqual(greet.kind, 'task');
      // The runner is encoded in the command, we just verify the task was created
    });
  });
});

describe('partitionTask', () => {
  const SaleType = StructType({ sku: StringType, qty: IntegerType });
  const SaleKeyType = StructType({ sku: StringType, period: IntegerType });

  it('builds a partition-kind task with the metadata spec', () => {
    const sales = input('sales', DictType(SaleKeyType, SaleType));
    const totals = input('rates', DictType(StringType, FloatType));

    const cleaned = partitionTask('cleaned', {
      partitions: [sales],
      inputs: [totals],
      output: DictType(SaleKeyType, SaleType),
      targetPartitionBytes: 1024,
    }, ($, slice, _rates) => $.return(slice));

    assert.strictEqual(cleaned.kind, 'task');
    assert.strictEqual(cleaned.taskKind, TASK_KIND_PARTITION);
    // function_ir + 1 partition + 1 ordinary input
    assert.strictEqual(cleaned.inputs.length, 3);
    assert.strictEqual(cleaned.inputs[0].name, 'function_ir');
    assert.strictEqual(cleaned.inputs[1], sales);
    assert.strictEqual(cleaned.inputs[2], totals);
    assert.deepStrictEqual(cleaned.output.path, [
      variant('field', 'tasks'),
      variant('field', 'cleaned'),
      variant('field', 'output'),
    ]);

    const meta = decodePartitionTaskMetadata(cleaned.metadata!);
    assert.strictEqual(meta.partitions, 1n);
    assert.strictEqual(meta.by.type, 'none');
    assert.strictEqual(meta.combine.type, 'none');
    assert.strictEqual(meta.targetPartitionBytes, 1024n);
  });

  it('carries by and combine as decodable EastIR bundles', () => {
    const sales = input('sales', DictType(SaleKeyType, IntegerType));

    const totals = partitionTask('totals', {
      partitions: [sales],
      by: (_$, key) => key.sku,
      output: DictType(StringType, IntegerType),
      combine: ($, a, b) => {
        // Partials are frozen task inputs — fold into a copy.
        const acc = $.let(a.copy());
        $(acc.mergeAll(b, ($, v1, v2) => v1.add(v2), ($, _k) => 0n));
        $.return(acc);
      },
    }, ($, slice) =>
      slice.toArray(($, v, k) => ({ sku: k.sku, v }))
        .groupReduce(($, x) => x.sku, ($, _k) => 0n, ($, acc, x) => acc.add(x.v)));

    const meta = decodePartitionTaskMetadata(totals.metadata!);
    assert.strictEqual(meta.partitions, 1n);
    assert.strictEqual(meta.by.type, 'some');
    assert.strictEqual(meta.combine.type, 'some');

    // Both blobs decode as free East functions with the declared signatures.
    const byIr = decodeEastIR(meta.by.type === 'some' ? meta.by.value : new Uint8Array());
    assert.strictEqual(byIr.ir.value.parameters.length, 1);
    const combineIr = decodeEastIR(meta.combine.type === 'some' ? meta.combine.value : new Uint8Array());
    assert.strictEqual(combineIr.ir.value.parameters.length, 2);
  });

  it('accepts a whole-key identity by and a leading-prefix struct by', () => {
    const sales = input('sales', DictType(SaleKeyType, IntegerType));

    const identity = partitionTask('by_identity', {
      partitions: [sales],
      by: (_$, key) => key,
      output: DictType(SaleKeyType, IntegerType),
    }, ($, slice) => $.return(slice));
    assert.strictEqual(decodePartitionTaskMetadata(identity.metadata!).by.type, 'some');

    const prefix = partitionTask('by_prefix', {
      partitions: [sales],
      by: (_$, key) => ({ sku: key.sku }),
      output: DictType(SaleKeyType, IntegerType),
    }, ($, slice) => $.return(slice));
    assert.strictEqual(decodePartitionTaskMetadata(prefix.metadata!).by.type, 'some');
  });

  it('rejects a by that is not a leading key prefix, naming the dataset and its field order', () => {
    const sales = input('sales', DictType(SaleKeyType, IntegerType));

    assert.throws(
      () => partitionTask('bad_by', {
        partitions: [sales],
        by: (_$, key) => key.period,
        output: DictType(SaleKeyType, IntegerType),
      }, ($, slice) => $.return(slice)),
      /not a leading prefix of partitioned dataset 'sales' key field order \(sku, period\)/,
    );
  });

  it('rejects unsupported by projection shapes, echoing the accepted shapes', () => {
    const sales = input('sales', DictType(SaleKeyType, IntegerType));

    assert.throws(
      () => partitionTask('computed_by', {
        partitions: [sales],
        by: (_$, key) => East.str`${key.sku}-x`,
        output: DictType(SaleKeyType, IntegerType),
      }, ($, slice) => $.return(slice)),
      /`by` must project a leading prefix of the partition key — accepted shapes: the key itself, a leading field/,
    );
  });

  describe('`by` nested leading-field paths', () => {
    const NestedKeyType = StructType({
      head: StructType({ region: StringType, store: IntegerType }),
      seq: IntegerType,
    });

    it('accepts a nested path that follows the first-field spine', () => {
      const sales = input('nsales', DictType(NestedKeyType, IntegerType));

      // head is the key's first field and region is head's first field, so
      // projecting key.head.region is monotone in canonical key order.
      const nested = partitionTask('by_nested', {
        partitions: [sales],
        by: (_$, key) => key.head.region,
        output: DictType(NestedKeyType, IntegerType),
      }, ($, slice) => $.return(slice));
      assert.strictEqual(decodePartitionTaskMetadata(nested.metadata!).by.type, 'some');

      // One level of the same spine (a whole-struct leading field).
      const oneLevel = partitionTask('by_nested_head', {
        partitions: [sales],
        by: (_$, key) => key.head,
        output: DictType(NestedKeyType, IntegerType),
      }, ($, slice) => $.return(slice));
      assert.strictEqual(decodePartitionTaskMetadata(oneLevel.metadata!).by.type, 'some');
    });

    it('rejects a nested path that leaves the first-field spine, naming the level', () => {
      const sales = input('nsales2', DictType(NestedKeyType, IntegerType));

      assert.throws(
        () => partitionTask('bad_nested', {
          partitions: [sales],
          by: (_$, key) => key.head.store,
          output: DictType(NestedKeyType, IntegerType),
        }, ($, slice) => $.return(slice)),
        /path \(key\.head\.store\) reads 'store', which is not the first field of partitioned dataset 'nsales2' key level \(region, store\)/,
      );

      // A non-leading top-level field stays rejected with the prefix error.
      assert.throws(
        () => partitionTask('bad_nested_top', {
          partitions: [sales],
          by: (_$, key) => key.seq,
          output: DictType(NestedKeyType, IntegerType),
        }, ($, slice) => $.return(slice)),
        /projects \(seq\), which is not a leading prefix of partitioned dataset 'nsales2' key field order \(head, seq\)/,
      );
    });

    it('ByResult rejects non-projection returns at compile time', () => {
      const sales = input('nsales4', DictType(NestedKeyType, IntegerType));
      const out = DictType(NestedKeyType, IntegerType);

      // Thunks only — nothing runs; the @ts-expect-error directives pin the
      // TYPE-level rejections (the build fails if any of them stops erroring).
      const bad1 = () => partitionTask('t_bad1', {
        partitions: [sales],
        // @ts-expect-error a bare host value is not a key projection
        by: () => 42,
        output: out,
      }, ($, s) => $.return(s));
      const bad2 = () => partitionTask('t_bad2', {
        partitions: [sales],
        // @ts-expect-error `r` is not a field of the partition key
        by: (_$, k) => ({ r: k.head }),
        output: out,
      }, ($, s) => $.return(s));
      const bad3 = () => partitionTask('t_bad3', {
        partitions: [sales],
        // @ts-expect-error `seq` requires an integer expression, not the head struct
        by: (_$, k) => ({ seq: k.head }),
        output: out,
      }, ($, s) => $.return(s));
      assert.ok(bad1 !== undefined && bad2 !== undefined && bad3 !== undefined);
    });

    it('rejects a struct literal over nested paths (deliberately unsupported)', () => {
      const sales = input('nsales3', DictType(NestedKeyType, IntegerType));

      assert.throws(
        () => partitionTask('bad_struct_nested', {
          partitions: [sales],
          // ByResult already rejects this shape at COMPILE time (`r` is not
          // a key field) — the cast exercises the build-time backstop that
          // guards untyped/JS callers.
          by: ((_$: unknown, key: { head: { region: unknown } }) => ({ r: key.head.region })) as never,
          output: DictType(NestedKeyType, IntegerType),
        }, ($, slice) => $.return(slice)),
        /accepted shapes: the key itself/,
      );
    });
  });

  it('rejects non-collection partitions and mixed-kind co-partitioning', () => {
    const scalar = input('scalar', IntegerType, variant('value', 1n));
    const sales = input('sales', DictType(SaleKeyType, IntegerType));
    const skus = input('skus', SetType(StringType));
    const rows = input('rows', ArrayType(IntegerType));

    assert.throws(
      () => partitionTask('bad', {
        partitions: [scalar],
        output: IntegerType,
      }, ($, s) => $.return(s)),
      /must be a collection \(Array, Set or Dict\)/,
    );

    assert.throws(
      () => partitionTask('mixed', {
        partitions: [sales, skus],
        output: DictType(SaleKeyType, IntegerType),
      }, ($, a, _b) => $.return(a)),
      /co-partitioning is restricted to Dict\/Set roots/,
    );

    assert.throws(
      () => partitionTask('arrays', {
        partitions: [rows, rows],
        output: ArrayType(IntegerType),
      }, ($, a, _b) => $.return(a)),
      /co-partitioning is restricted to Dict\/Set roots/,
    );
  });

  it('co-partitions same-keyed dicts and types by over the shared key', () => {
    const a = input('a', DictType(SaleKeyType, IntegerType));
    const b = input('b', DictType(SaleKeyType, FloatType));

    const reconcile = partitionTask('reconcile', {
      partitions: [a, b],
      by: (_$, key) => key.sku,
      output: DictType(SaleKeyType, FloatType),
    }, ($, _sliceA, sliceB) => $.return(sliceB));

    assert.strictEqual(reconcile.taskKind, TASK_KIND_PARTITION);
    assert.strictEqual(decodePartitionTaskMetadata(reconcile.metadata!).partitions, 2n);
    // function_ir + 2 partitions
    assert.strictEqual(reconcile.inputs.length, 3);
  });

  describe('heterogeneous co-partition keys (the implicit projection)', () => {
    // Same fields, opposite declared order — the field-wise intersection is
    // non-empty, but the datasets SORT differently, so implicit boundary
    // alignment would silently mis-assign rows at run time.
    const ReversedKeyType = StructType({ period: IntegerType, sku: StringType });

    it('rejects reordered key fields when no `by` is given', () => {
      const a = input('h_a', DictType(SaleKeyType, IntegerType));
      const b = input('h_b', DictType(ReversedKeyType, IntegerType));

      assert.throws(
        () => partitionTask('implicit_misorder', {
          partitions: [a, b],
          output: DictType(SaleKeyType, IntegerType),
        }, ($, sliceA, _sliceB) => $.return(sliceA)),
        /with no `by`, co-partition boundaries align on partitioned dataset 'h_a' key order \(sku, period\), which is not a leading prefix of partitioned dataset 'h_b' key field order \(period, sku\)/,
      );
    });

    it('rejects reordered key fields under an identity `by` too', () => {
      const a = input('h_c', DictType(SaleKeyType, IntegerType));
      const b = input('h_d', DictType(ReversedKeyType, IntegerType));

      assert.throws(
        () => partitionTask('identity_misorder', {
          partitions: [a, b],
          by: (_$, key) => key,
          output: DictType(SaleKeyType, IntegerType),
        }, ($, sliceA, _sliceB) => $.return(sliceA)),
        /the identity `by` projection reads the shared key fields \(sku, period\), which is not a leading prefix of partitioned dataset 'h_d' key field order \(period, sku\)/,
      );
    });

    it('rejects a same-named leading field whose types differ across datasets', () => {
      // `sku` exists in both keys at position 0 but with different types, so
      // the intersection drops it — the primary's comparator would compare
      // string skus against integer skus by kind rank.
      const IntSkuKeyType = StructType({ sku: IntegerType, period: IntegerType });
      const a = input('h_e', DictType(SaleKeyType, IntegerType));
      const b = input('h_f', DictType(IntSkuKeyType, IntegerType));

      assert.throws(
        () => partitionTask('type_mismatch', {
          partitions: [a, b],
          output: DictType(SaleKeyType, IntegerType),
        }, ($, sliceA, _sliceB) => $.return(sliceA)),
        /with no `by`, co-partition boundaries align on partitioned dataset 'h_e' key order/,
      );
    });

    it('accepts a secondary whose key extends the primary key with trailing fields', () => {
      // The primary's full key IS a leading prefix of the secondary's — the
      // implicit alignment (projecting onto the primary's fields) is
      // monotone for both, so this stays legal without `by`.
      const ExtendedKeyType = StructType({ sku: StringType, period: IntegerType, line: IntegerType });
      const a = input('h_g', DictType(SaleKeyType, IntegerType));
      const b = input('h_h', DictType(ExtendedKeyType, IntegerType));

      const extended = partitionTask('extended_ok', {
        partitions: [a, b],
        output: DictType(SaleKeyType, IntegerType),
      }, ($, sliceA, _sliceB) => $.return(sliceA));
      assert.strictEqual(extended.taskKind, TASK_KIND_PARTITION);
    });
  });

  it('rejects a non-collection output in splice mode, and accepts it with combine', () => {
    const sales = input('splice_sales', DictType(SaleKeyType, IntegerType));
    const TotalType = StructType({ total: IntegerType });

    // Without combine, partitions return SHARDS that splice — a struct
    // cannot; this used to surface only at run time, on the first input
    // large enough to carve into two partitions.
    assert.throws(
      () => partitionTask('struct_splice', {
        partitions: [sales],
        output: TotalType,
      }, ($, slice) => $.return({ total: slice.size() })),
      /without `combine`, each partition returns a shard of the output and the shards splice \(or, with `merge`, merge\) in key order — the output must be a collection \(Array, Set or Dict\), got Struct/,
    );

    const folded = partitionTask('struct_combine', {
      partitions: [sales],
      output: TotalType,
      combine: ($, a, b) => $.return({ total: a.total.add(b.total) }),
    }, ($, slice) => $.return({ total: slice.size() }));
    assert.strictEqual(folded.taskKind, TASK_KIND_PARTITION);
  });
});

describe('partitionTask merge', () => {
  const RowType = StructType({ id: IntegerType, name: StringType });
  const events = input('merge_events', DictType(IntegerType, RowType));

  it('encodes a Dict merge function as IR, and the Set union as a flag', () => {
    const byId = partitionTask('merge_by_id', {
      partitions: [events],
      output: DictType(IntegerType, RowType),
      merge: ($, _key, a, _b) => $.return(a),
    }, ($, slice) => $.return(slice));
    const dictMeta = decodePartitionTaskMetadata(byId.metadata!);
    assert.strictEqual(dictMeta.merge.type, 'some');
    assert.strictEqual(dictMeta.mergeSets, false);
    assert.strictEqual(dictMeta.combine.type, 'none');
    // The bundle is the (Key, Value, Value) -> Value the orchestrator compiles.
    const bundle = decodeEastIR(dictMeta.merge.type === 'some' ? dictMeta.merge.value : new Uint8Array());
    const resolve = bundle.compile([]) as (k: bigint, a: unknown, b: unknown) => unknown;
    const left = { id: 1n, name: 'left' };
    assert.deepStrictEqual(resolve(1n, left, { id: 1n, name: 'right' }), left);

    const ids = partitionTask('merge_ids', {
      partitions: [events],
      output: SetType(IntegerType),
      merge: 'union',
    }, ($, slice) => $.return(slice.keys()));
    const setMeta = decodePartitionTaskMetadata(ids.metadata!);
    assert.strictEqual(setMeta.merge.type, 'none');
    assert.strictEqual(setMeta.mergeSets, true);
  });

  it('carries the merge command of the task\'s runner, built at export, and none without merge', () => {
    // The orchestrator's merge units run this command IR as an ordinary
    // execution: `<runner> merge --merge <merge IR> -i <partial>... -o <out>`
    // for a Dict output, `--union` for a Set.
    const byId = partitionTask('merge_cmd_by_id', {
      partitions: [events],
      output: DictType(IntegerType, RowType),
      merge: ($, _key, a, _b) => $.return(a),
      runner: { runtime: 'east-c', platforms: ['east-c-std'] },
    }, ($, slice) => $.return(slice));
    const dictMeta = decodePartitionTaskMetadata(byId.metadata!);
    assert.strictEqual(dictMeta.mergeCommand.type, 'some');
    const dictCommand = decodeEastIR(dictMeta.mergeCommand.type === 'some' ? dictMeta.mergeCommand.value : new Uint8Array());
    assert.deepStrictEqual(
      (dictCommand.compile([]) as (inputs: string[], output: string) => string[])(['merge.beast2', 'p0.beast2', 'p1.beast2'], 'out.beast2'),
      ['east-c', 'merge', '-p', 'east-c-std', '--merge', 'merge.beast2', '-i', 'p0.beast2', '-i', 'p1.beast2', '-o', 'out.beast2'],
    );

    const ids = partitionTask('merge_cmd_ids', {
      partitions: [events],
      output: SetType(IntegerType),
      merge: 'union',
    }, ($, slice) => $.return(slice.keys()));
    const setMeta = decodePartitionTaskMetadata(ids.metadata!);
    const setCommand = decodeEastIR(setMeta.mergeCommand.type === 'some' ? setMeta.mergeCommand.value : new Uint8Array());
    assert.deepStrictEqual(
      (setCommand.compile([]) as (inputs: string[], output: string) => string[])(['p0.beast2', 'p1.beast2'], 'out.beast2'),
      ['east-node', 'merge', '-p', '@elaraai/east-node-std', '--union', '-i', 'p0.beast2', '-i', 'p1.beast2', '-o', 'out.beast2'],
    );

    const spliced = partitionTask('merge_cmd_none', {
      partitions: [events],
      output: DictType(IntegerType, RowType),
    }, ($, slice) => $.return(slice));
    assert.strictEqual(decodePartitionTaskMetadata(spliced.metadata!).mergeCommand.type, 'none');
  });

  it('refuses merge alongside combine, on the wrong output kind, or in the wrong form', () => {
    assert.throws(
      () => partitionTask('merge_and_combine', {
        partitions: [events],
        output: DictType(IntegerType, RowType),
        merge: ($, _k, a, _b) => $.return(a),
        combine: ($, a, _b) => $.return(a),
      }, ($, slice) => $.return(slice)),
      /partitionTask 'merge_and_combine': `merge` and `combine` are two assembly modes — give one/
    );
    // The next three are the shapes the static types already forbid; a caller
    // outside TypeScript's reach (a JS author, an `any`) still gets a message
    // naming the task, so they go through an untyped alias.
    const untypedPartitionTask = partitionTask as unknown as (name: string, spec: object, fn: () => void) => unknown;
    const takeLeft = (_$: unknown, _k: unknown, a: unknown) => a;
    assert.throws(
      () => untypedPartitionTask('merge_array', { partitions: [events], output: ArrayType(RowType), merge: takeLeft }, () => {}),
      /partitionTask 'merge_array': a `merge` FUNCTION resolves a key present in two partials, so the output must be a Dict, got Array/
    );
    assert.throws(
      () => untypedPartitionTask('merge_fn_on_set', { partitions: [events], output: SetType(IntegerType), merge: takeLeft }, () => {}),
      /got Set — a Set output takes `merge: 'union'`/
    );
    assert.throws(
      () => untypedPartitionTask('merge_union_on_dict', { partitions: [events], output: DictType(IntegerType, RowType), merge: 'union' }, () => {}),
      /`merge: 'union'` assembles a Set output, got Dict — a Dict output takes a per-key merge function/
    );
  });

  it('types merge over the output\'s own key and value, not the partition key', () => {
    const SaleKeyType = StructType({ sku: StringType, period: IntegerType });
    const sales = input('merge_sales', DictType(SaleKeyType, IntegerType));

    // Re-keyed by sku: the merge sees the OUTPUT's String key and Integer
    // values (a value-level `add` would not type-check against the whole
    // output), and its IR is the (String, Integer, Integer) -> Integer fold.
    const bySku = partitionTask('merge_by_sku', {
      partitions: [sales],
      output: DictType(StringType, IntegerType),
      merge: (_$, _sku, a, b) => a.add(b),
    }, ($, slice) => slice.toArray(($, v, k) => ({ sku: k.sku, v }))
      .groupReduce(($, x) => x.sku, ($, _k) => 0n, ($, acc, x) => acc.add(x.v)));
    const meta = decodePartitionTaskMetadata(bySku.metadata!);
    const merge = decodeEastIR(meta.merge.type === 'some' ? meta.merge.value : new Uint8Array());
    assert.strictEqual(merge.ir.value.parameters.length, 3);
    assert.strictEqual((merge.compile([]) as (k: string, a: bigint, b: bigint) => bigint)('x', 2n, 3n), 5n);
  });

  it('refuses merge on the custom runtime, which cannot run the merge units', () => {
    assert.throws(
      () => partitionTask('merge_custom', {
        partitions: [events],
        output: DictType(IntegerType, RowType),
        merge: ($, _key, a, _b) => $.return(a),
        runner: { runtime: 'custom', command: ['my-runner'] },
      }, ($, slice) => $.return(slice)),
      /^Error: partitionTask 'merge_custom': merge runs the fan-in on the task's runner, which must be a stock runtime \(east-node, east-py, east-c\) — the custom runtime has no merge command$/
    );
  });
});

describe('streamTask', () => {
  const EventType = StructType({ at: IntegerType, amount: FloatType });

  it('builds a stream-kind task with emit as the trailing body parameter', () => {
    const events = input('events', ArrayType(EventType));

    const balances = streamTask('balances', {
      stream: events,
      output: ArrayType(FloatType),
    }, ($, events, emit) => {
      const balance = $.let(0.0);
      $.for(events, ($, event) => {
        $.assign(balance, balance.add(event.amount));
        $(emit(balance));
      });
    });

    assert.strictEqual(balances.kind, 'task');
    assert.strictEqual(balances.taskKind, TASK_KIND_STREAM);
    // function_ir + stream input; emit is a body parameter, not a dataset
    assert.strictEqual(balances.inputs.length, 2);
    assert.strictEqual(balances.inputs[0].name, 'function_ir');
    assert.strictEqual(balances.inputs[1], events);

    const meta = decodeStreamTaskMetadata(balances.metadata!);
    assert.strictEqual(meta.stream, true);
    assert.strictEqual(meta.emit, 'array');
    assert.strictEqual(meta.merge, 'none');
  });

  it('supports producer mode (no stream input) and dict emit', () => {
    const limit = input('limit', IntegerType, variant('value', 3n));

    const producer = streamTask('ingest', {
      inputs: [limit],
      output: DictType(IntegerType, StringType),
    }, ($, limit, emit) => {
      const source = $.const([0n, 1n, 2n, 3n, 4n], ArrayType(IntegerType));
      $.for(source, ($, k) => {
        $.if(East.less(k, limit), ($) => {
          $(emit(k, East.str`row-${k}`));
        });
      });
    });

    assert.strictEqual(producer.taskKind, TASK_KIND_STREAM);
    // function_ir + 1 ordinary input
    assert.strictEqual(producer.inputs.length, 2);
    const meta = decodeStreamTaskMetadata(producer.metadata!);
    assert.strictEqual(meta.stream, false);
    assert.strictEqual(meta.emit, 'dict');
  });

  it('rejects non-collection outputs and the custom runtime', () => {
    const events = input('events', ArrayType(EventType));

    assert.throws(
      () => streamTask('scalar_out', {
        stream: events,
        output: FloatType,
      }, () => { /* body never built */ }),
      /output must be a collection type/,
    );

    assert.throws(
      () => streamTask('custom_stream', {
        stream: events,
        output: ArrayType(FloatType),
        runner: { runtime: 'custom', command: ['my-runner'] },
      }, () => { /* body never built */ }),
      /custom runtime cannot carry the streaming flags/,
    );

    // Stock non-node runtimes are accepted — they stream the output too.
    const cStream = streamTask('c_stream', {
      stream: events,
      output: ArrayType(FloatType),
      runner: { runtime: 'east-c', platforms: ['east-c-std'] },
    }, ($, events, emit) => {
      $.for(events, ($, event) => {
        $(emit(event.amount));
      });
    });
    assert.strictEqual(cStream.taskKind, TASK_KIND_STREAM);
  });

  describe('merge', () => {
    const TotalsType = DictType(StringType, FloatType);

    it('folds equal Dict keys with a merge function staged as wire input 1', () => {
      const events = input('merge_stream_events', ArrayType(StructType({ account: StringType, amount: FloatType })));
      const rates = input('merge_stream_rates', FloatType, variant('value', 1.0));

      const totals = streamTask('totals', {
        stream: events,
        inputs: [rates],
        output: TotalsType,
        merge: (_$, _account, a, b) => a.add(b),
        runner: { runtime: 'east-c', platforms: ['east-c-std'] },
      }, ($, events, rate, emit) => {
        $.for(events, ($, event) => {
          $(emit(event.account, event.amount.multiply(rate)));
        });
      });

      // function_ir, merge_ir, the stream, then the ordinary input.
      assert.deepStrictEqual(totals.inputs.map((d) => d.name), ['function_ir', 'merge_ir', 'merge_stream_events', 'merge_stream_rates']);
      const mergeIR = totals.inputs[1]!;
      assert.deepStrictEqual(mergeIR.path, [variant('field', 'tasks'), variant('field', 'totals'), variant('field', 'merge_ir')]);
      assert.strictEqual(mergeIR.writable, false);
      const fold = (mergeIR.default as unknown as { compile(p: []): (k: string, a: number, b: number) => number }).compile([]);
      assert.strictEqual(fold('x', 1.5, 2.0), 3.5);

      const meta = decodeStreamTaskMetadata(totals.metadata!);
      assert.deepStrictEqual(meta, { stream: true, emit: 'dict', merge: 'function' });

      // The runner receives the merge IR as --merge and streams the first -i input.
      const argv = totals.command.compile([])(['body.beast2', 'merge.beast2', 'events.beast2', 'rates.beast2'], 'out.beast2');
      assert.deepStrictEqual(argv, [
        'east-c', 'run', '-p', 'east-c-std', '--emit', 'dict', '--merge', 'merge.beast2', '--stream', '0',
        '-i', 'events.beast2', '-i', 'rates.beast2', '-o', 'out.beast2', 'body.beast2',
      ]);
    });

    it('collapses equal Set elements with union, which stages no input', () => {
      const events = input('union_stream_events', ArrayType(StringType));

      const accounts = streamTask('accounts', {
        stream: events,
        output: SetType(StringType),
        merge: 'union',
      }, ($, events, emit) => {
        $.for(events, ($, account) => {
          $(emit(account));
        });
      });

      assert.deepStrictEqual(accounts.inputs.map((d) => d.name), ['function_ir', 'union_stream_events']);
      assert.deepStrictEqual(decodeStreamTaskMetadata(accounts.metadata!), { stream: true, emit: 'set', merge: 'union' });
      const argv = accounts.command.compile([])(['body.beast2', 'events.beast2'], 'out.beast2');
      assert.deepStrictEqual(argv, [
        'east-node', 'run', '-p', '@elaraai/east-node-std', '--emit', 'set', '--union', '--stream', '0',
        '-i', 'events.beast2', '-o', 'out.beast2', 'body.beast2',
      ]);
    });

    it('refuses merge for an Array output and in the wrong form for the output kind', () => {
      // The static types already forbid both; a caller outside TypeScript's
      // reach still gets a message naming the task.
      const untypedStreamTask = streamTask as unknown as (name: string, spec: object, fn: () => void) => unknown;
      const takeLeft = (_$: unknown, _k: unknown, a: unknown) => a;
      assert.throws(
        () => untypedStreamTask('merge_array_out', { output: ArrayType(FloatType), merge: takeLeft }, () => {}),
        /^Error: streamTask 'merge_array_out': merge applies to Dict \(a function\) or Set \('union'\) outputs, got Array$/
      );
      assert.throws(
        () => untypedStreamTask('union_on_dict', { output: TotalsType, merge: 'union' }, () => {}),
        /streamTask 'union_on_dict': merge applies to Dict \(a function\) or Set \('union'\) outputs, got Dict with 'union'/
      );
      assert.throws(
        () => untypedStreamTask('fn_on_set', { output: SetType(StringType), merge: takeLeft }, () => {}),
        /streamTask 'fn_on_set': merge applies to Dict \(a function\) or Set \('union'\) outputs, got Set with a function/
      );
    });
  });
});
