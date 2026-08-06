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
      const name_input = input('name', StringType, 'World');

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
      const name_input = input('name', StringType, 'World');
      const count_input = input('count', IntegerType, 1n);

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
      const a_input = input('a', StringType, 'a');
      const b_input = input('b', IntegerType, 1n);
      const c_input = input('c', FloatType, 1.0);

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
      const a_input = input('a', StringType, 'a');
      const b_input = input('b', IntegerType, 1n);
      const c_input = input('c', FloatType, 1.0);
      const d_input = input('d', StringType, 'd');

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

      const person_input = input('person', PersonType, { name: 'Alice', age: 30n });

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
      const name_input = input('name', StringType, 'World');

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
      const name_input = input('name', StringType, 'World');
      const suffix_input = input('suffix', StringType, '!');

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
      const name_input = input('name', StringType, 'World');

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
      const name_input = input('name', StringType, 'World');
      const count_input = input('count', IntegerType, 1n);

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
      const name_input = input('name', StringType, 'World');

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
      const name_input = input('name', StringType, 'World');

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
      const name_input = input('name', StringType, 'World');

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
        $(a.mergeAll(b, ($, v1, v2) => v1.add(v2), ($, _k) => 0n));
        $.return(a);
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

  it('rejects unsupported by projection shapes', () => {
    const sales = input('sales', DictType(SaleKeyType, IntegerType));

    assert.throws(
      () => partitionTask('computed_by', {
        partitions: [sales],
        by: (_$, key) => East.str`${key.sku}-x`,
        output: DictType(SaleKeyType, IntegerType),
      }, ($, slice) => $.return(slice)),
      /`by` must project a leading prefix of the partition key/,
    );
  });

  it('rejects non-collection partitions and mixed-kind co-partitioning', () => {
    const scalar = input('scalar', IntegerType, 1n);
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
  });

  it('supports producer mode (no stream input) and dict emit', () => {
    const limit = input('limit', IntegerType, 3n);

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
});
