/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { East, StringType, IntegerType, FloatType, StructType, DictType, SetType, ArrayType, NullType, FunctionType, variant, isTypeValueEqual, toEastTypeValue, type EastType } from '@elaraai/east';
import { task, customTask, partition, streamTask } from './task.js';
import { output } from './output.js';
import { input } from './input.js';

/** Whether two East types are the same type. */
const sameType = (a: EastType, b: EastType): boolean =>
  isTypeValueEqual(toEastTypeValue(a), toEastTypeValue(b));

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

    it('accepts four input datasets (tuple type preservation), each an input of the body', () => {
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
      assert.deepStrictEqual(combine_four.inputs, [a_input, b_input, c_input, d_input]);
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
      assert.strictEqual(greet.output.type, StringType);
      assert.strictEqual(greet.body.kind, 'east');
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

    it('carries the function as its program, returning the output, in the data role', () => {
      const name_input = input('name', StringType, variant('value', 'World'));

      const greet = task(
        'greet',
        [name_input],
        East.function([StringType], StringType, ($, name) => $.return(East.str`Hello, ${name}!`))
      );

      // The program is the body itself — no dataset holds it, and the inputs
      // are the datasets alone.
      assert.deepStrictEqual(greet.inputs, [name_input]);
      assert.strictEqual(greet.outputKind, undefined);
      assert.deepStrictEqual(greet.role, variant('data', null));
      assert.strictEqual(greet.body.kind, 'east');
      if (greet.body.kind !== 'east') return;
      const run = greet.body.program.compile([]) as (name: string) => string;
      assert.strictEqual(run('World'), 'Hello, World!');
    });

    it('keeps a custom runner and the role it is given', () => {
      const name_input = input('name', StringType, variant('value', 'World'));
      const role = variant('ui', { paths: [name_input.path], functions: [], records: [], pages: [] });

      const greet = task(
        'greet',
        [name_input],
        East.function([StringType], StringType, ($, name) => $.return(name)),
        {
          runner: { runtime: 'custom', command: ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'] },
          role,
        }
      );

      // A custom runtime runs the same program, with run's arguments.
      assert.strictEqual(greet.body.kind, 'east');
      assert.deepStrictEqual(greet.runner, { runtime: 'custom', command: ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'] });
      assert.strictEqual(greet.role, role);
    });

    it('refuses an input marked with e3.partition, which only a stream task takes', () => {
      const sales = input('sales', DictType(StringType, FloatType));
      const total = East.function([DictType(StringType, FloatType)], FloatType, ($, s) => s.sum());

      // The type refuses it; the runtime check names the task for a caller
      // outside TypeScript's reach.
      // @ts-expect-error a partitioned input is not a dataset
      const typed = () => task('total', [partition(sales)], total);
      assert.ok(typed !== undefined);
      const untypedTask = task as unknown as (name: string, inputs: unknown[], fn: unknown) => unknown;
      assert.throws(
        () => untypedTask('total', [partition(sales)], total),
        /^Error: task 'total': input 'sales' is marked with e3\.partition, which only e3\.streamTask takes — pass the dataset itself$/,
      );
    });
  });
});

describe('customTask', () => {
  it('carries its command as the body, with no runner', () => {
    const name_input = input('name', StringType, variant('value', 'World'));

    const echo = customTask('echo', [name_input], StringType, (_$, inputs, out) =>
      East.str`cp ${inputs.get(0n)} ${out}`);

    assert.strictEqual(echo.runner, undefined);
    assert.deepStrictEqual(echo.inputs, [name_input]);
    assert.strictEqual(echo.body.kind, 'command');
    if (echo.body.kind !== 'command') return;
    assert.deepStrictEqual(
      echo.body.command.compile([])(['in.beast2'], 'out.beast2'),
      ['bash', '-c', 'cp in.beast2 out.beast2'],
    );
  });
});

describe('e3.output', () => {
  it('types each kind\'s output and emit', () => {
    const array = output.array(FloatType);
    assert.ok(sameType(array.type, ArrayType(FloatType)));
    assert.ok(sameType(array.emit, FunctionType([FloatType], NullType)));

    const set = output.set(StringType);
    assert.ok(sameType(set.type, SetType(StringType)));
    assert.ok(sameType(set.emit, FunctionType([StringType], NullType)));

    const dict = output.dict(StringType, IntegerType);
    assert.ok(sameType(dict.type, DictType(StringType, IntegerType)));
    assert.ok(sameType(dict.emit, FunctionType([StringType, IntegerType], NullType)));
    assert.strictEqual(dict.merge, undefined);

    // A fold's output is the folded value, whatever its type.
    const fold = output.fold(ArrayType(IntegerType), { zero: [], combine: ($, a, b) => a.concat(b) });
    assert.ok(sameType(fold.type, ArrayType(IntegerType)));
    assert.ok(sameType(fold.emit, FunctionType([ArrayType(IntegerType)], NullType)));
  });

  it('builds a dict\'s merge over the key and two values, and a fold\'s combine over two values', () => {
    const dict = output.dict(StringType, IntegerType, { merge: (_$, _key, a, b) => a.add(b) });
    assert.strictEqual((dict.merge!.compile([]) as (k: string, a: bigint, b: bigint) => bigint)('x', 2n, 3n), 5n);

    const fold = output.fold(IntegerType, { zero: 0n, combine: (_$, a, b) => a.add(b) });
    assert.strictEqual(fold.zero, 0n);
    assert.strictEqual((fold.combine.compile([]) as (a: bigint, b: bigint) => bigint)(2n, 3n), 5n);
  });

  it('refuses a fold whose zero is not a value of its type', () => {
    assert.throws(
      () => output.fold(IntegerType, { zero: 'none' as never, combine: (_$, a, b) => a.add(b) }),
      /^Error: e3\.output\.fold: zero is not a value of \.Integer$/,
    );
  });
});

describe('streamTask', () => {
  const EventType = StructType({ at: IntegerType, amount: FloatType });

  it('passes the inputs, then emit, to a body whose output kind types the task', () => {
    const events = input('events', ArrayType(EventType));

    const balances = streamTask('balances', {
      inputs: [events],
      output: output.array(FloatType),
    }, ($, events, emit) => {
      const balance = $.let(0.0);
      $.for(events, ($, event) => {
        $.assign(balance, balance.add(event.amount));
        $(emit(balance));
      });
    });

    assert.strictEqual(balances.kind, 'task');
    assert.deepStrictEqual(balances.inputs, [events]);
    assert.strictEqual(balances.outputKind?.kind, 'array');
    assert.ok(sameType(balances.output.type, ArrayType(FloatType)));
    assert.deepStrictEqual(balances.role, variant('data', null));

    // The body's parameters are the inputs and then emit, which the runner
    // passes: here, a sink recording what is emitted.
    assert.strictEqual(balances.body.kind, 'east');
    if (balances.body.kind !== 'east') return;
    const emitted: number[] = [];
    const run = balances.body.program.compile([]) as (events: unknown[], emit: (x: number) => null) => null;
    run([{ at: 1n, amount: 2.5 }, { at: 2n, amount: 1.0 }], (x) => { emitted.push(x); return null; });
    assert.deepStrictEqual(emitted, [2.5, 3.5]);
  });

  it('is a producer with no inputs, emitting keys and values into a dict', () => {
    const producer = streamTask('ingest', {
      inputs: [],
      output: output.dict(IntegerType, StringType),
    }, ($, emit) => {
      const source = $.const([0n, 1n, 2n], ArrayType(IntegerType));
      $.for(source, ($, k) => {
        $(emit(k, East.str`row-${k}`));
      });
    });

    assert.deepStrictEqual(producer.inputs, []);
    assert.strictEqual(producer.outputKind?.kind, 'dict');
    if (producer.body.kind !== 'east') return assert.fail('a stream task runs a program');
    const emitted: [bigint, string][] = [];
    (producer.body.program.compile([]) as (emit: (k: bigint, v: string) => null) => null)((k, v) => { emitted.push([k, v]); return null; });
    assert.deepStrictEqual(emitted, [[0n, 'row-0'], [1n, 'row-1'], [2n, 'row-2']]);
  });

  it('refuses the custom runtime, and an output that is not an output kind', () => {
    const events = input('events', ArrayType(EventType));

    assert.throws(
      () => streamTask('custom_stream', {
        inputs: [events],
        output: output.array(FloatType),
        runner: { runtime: 'custom', command: ['my-runner'] },
      }, () => { /* body never built */ }),
      /^Error: streamTask 'custom_stream': the custom runtime runs only a program that returns its output — use a stock runtime \(east-node, east-py, east-c\)$/,
    );

    // The static types forbid a bare East type; a caller outside TypeScript's
    // reach still gets a message naming the task.
    const untypedStreamTask = streamTask as unknown as (name: string, spec: object, fn: () => void) => unknown;
    assert.throws(
      () => untypedStreamTask('scalar_out', { inputs: [events], output: FloatType }, () => {}),
      /^Error: streamTask 'scalar_out': output is an output kind — e3\.output\.array, set, dict or fold$/,
    );
  });
});

describe('e3.partition', () => {
  const SaleKeyType = StructType({ sku: StringType, period: IntegerType });
  const NestedKeyType = StructType({ head: StructType({ region: StringType, store: IntegerType }), seq: IntegerType });

  it('marks a stream task\'s input, which its body receives typed as the whole dataset', () => {
    const sales = input('sales', DictType(SaleKeyType, IntegerType));
    const rates = input('rates', FloatType, variant('value', 1.0));
    const bySku = partition(sales, { by: ['sku'] });

    const totals = streamTask('totals', {
      inputs: [bySku, rates],
      output: output.dict(StringType, FloatType, { merge: (_$, _sku, a, b) => a.add(b) }),
    }, ($, sales, rate, emit) => {
      $.for(sales, ($, qty, key) => {
        $(emit(key.sku, qty.toFloat().multiply(rate)));
      });
    });

    assert.deepStrictEqual(bySku, { kind: 'partition', dataset: sales, by: ['sku'] });
    assert.deepStrictEqual(totals.inputs, [bySku, rates]);
    // The task depends on the dataset under the mark.
    assert.ok(totals.deps.has(sales));
    assert.ok(totals.deps.has(rates));
  });

  it('accepts leading key fields, the last of which may read first fields into a struct', () => {
    const sales = input('sales', DictType(SaleKeyType, IntegerType));
    const nested = input('nested', DictType(NestedKeyType, IntegerType));
    const body = () => {};
    for (const by of [[], ['sku'], ['sku', 'period']]) {
      streamTask('ok', { inputs: [partition(sales, { by })], output: output.set(StringType) }, body);
    }
    for (const by of [['head'], ['head.region'], ['head', 'seq']]) {
      streamTask('ok', { inputs: [partition(nested, { by })], output: output.set(StringType) }, body);
    }
  });

  it('refuses a by that is not leading key fields, naming the task, the input and the key\'s fields', () => {
    const sales = input('sales', DictType(SaleKeyType, IntegerType));
    const nested = input('nested', DictType(NestedKeyType, IntegerType));
    const body = () => {};

    assert.throws(
      () => streamTask('bad_by', { inputs: [partition(sales, { by: ['period'] })], output: output.set(StringType) }, body),
      /^Error: streamTask 'bad_by': partitioned input 'sales': `by` \(period\) must name leading key fields in order — the key's fields are \(sku, period\), and only the last entry may read into one, as 'at\.day' does$/,
    );
    assert.throws(
      () => streamTask('path_first', { inputs: [partition(nested, { by: ['head.region', 'seq'] })], output: output.set(StringType) }, body),
      /`by` \(head\.region, seq\) must name leading key fields in order/,
    );
    assert.throws(
      () => streamTask('path_step', { inputs: [partition(nested, { by: ['head.store'] })], output: output.set(StringType) }, body),
      /^Error: streamTask 'path_step': partitioned input 'nested': `by` path 'head\.store' reads 'store', which is not the first field of \(region, store\) — rows sort by a struct's first field, so only it groups them$/,
    );
  });

  it('refuses a partitioned input that is not a collection, or a by on an input with no key fields', () => {
    const scalar = input('scalar', IntegerType, variant('value', 1n));
    const rows = input('rows', ArrayType(IntegerType));
    const skus = input('skus', SetType(StringType));
    const body = () => {};

    assert.throws(
      () => streamTask('scalar', { inputs: [partition(scalar as never)], output: output.set(StringType) }, body),
      /^Error: streamTask 'scalar': partitioned input 'scalar' must be a collection \(Array, Set or Dict\), got Integer$/,
    );
    assert.throws(
      () => streamTask('array_by', { inputs: [partition(rows, { by: ['x'] })], output: output.set(StringType) }, body),
      /partitioned input 'rows' is an Array, cut by position, so it has no key for `by` to name/,
    );
    assert.throws(
      () => streamTask('string_by', { inputs: [partition(skus, { by: ['x'] })], output: output.set(StringType) }, body),
      /partitioned input 'skus' has a String key, which has no fields for `by` to name/,
    );
    // An Array cut by position, with no `by`, is a partitioned input.
    streamTask('array', { inputs: [partition(rows)], output: output.array(IntegerType) }, body);
  });

  it('co-partitions inputs cut by keys, or by fields, of the same types — and nothing else', () => {
    const a = input('a', DictType(SaleKeyType, IntegerType));
    const b = input('b', DictType(SaleKeyType, FloatType));
    const bySkuOnly = input('by_sku', DictType(StringType, FloatType));
    const lines = input('lines', DictType(StructType({ sku: StringType, line: IntegerType }), IntegerType));
    const reversed = input('reversed', DictType(StructType({ period: IntegerType, sku: StringType }), IntegerType));
    const rows = input('rows', ArrayType(IntegerType));
    const body = () => {};

    // Identical keys; a key against a `by` field of its type; two `by`s over
    // different keys.
    streamTask('same_keys', { inputs: [partition(a), partition(b)], output: output.set(StringType) }, body);
    streamTask('key_and_by', { inputs: [partition(bySkuOnly), partition(a, { by: ['sku'] })], output: output.set(StringType) }, body);
    streamTask('two_bys', { inputs: [partition(a, { by: ['sku'] }), partition(lines, { by: ['sku'] })], output: output.set(StringType) }, body);

    assert.throws(
      () => streamTask('reordered', { inputs: [partition(a), partition(reversed)], output: output.set(StringType) }, body),
      /^Error: streamTask 'reordered': co-partitioned inputs 'a' and 'reversed' have no common key — they are cut by \(\.Struct \[\(name="sku", type=\.String\), \(name="period", type=\.Integer\)\]\) and \(\.Struct \[\(name="period", type=\.Integer\), \(name="sku", type=\.String\)\]\); give each a `by` naming fields of the same types$/,
    );
    assert.throws(
      () => streamTask('with_array', { inputs: [partition(a), partition(rows)], output: output.set(StringType) }, body),
      /^Error: streamTask 'with_array': co-partitioned inputs are cut at the same keys, so each must be a Set or a Dict — partition one input and pass the others whole$/,
    );
  });
});
