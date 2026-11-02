/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { East, ArrayType, FloatType, IntegerType, StringType, StructType, DictType, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { example } from './example.js';

// ---
// e3.input and e3.task
// ---

export const inputAndTask = example({
  keywords: ['e3', 'input', 'task', 'package', 'source', 'value', 'variant'],
  description: 'An input with an inline initial value, a task over it, and the package that bundles them (dependencies are collected)',
  fn: () => {
    const name = e3.input('name', StringType, variant('value', 'World'));
    const greet = e3.task('greet', [name], East.function([StringType], StringType, ($, n) => East.str`Hello, ${n}!`));
    return e3.package('hello', '1.0.0', greet);
  },
});

export const unassignedInput = example({
  keywords: ['e3', 'input', 'unassigned', 'no initial value', 'dataset set'],
  description: 'An input with no source: unassigned until something sets it (`e3 dataset set`), its dependents waiting until then',
  fn: () => {
    const count = e3.input('count', IntegerType);
    const doubled = e3.task('doubled', [count], East.function([IntegerType], IntegerType, ($, c) => c.multiply(2n)));
    return e3.package('counts', '1.0.0', doubled);
  },
});

export const taskChain = example({
  keywords: ['e3', 'task', 'chain', 'output', 'dependency', 'pipeline'],
  description: "Chain tasks: a task's output (`task.output`) is another task's input",
  fn: () => {
    const name = e3.input('name', StringType, variant('value', 'World'));
    const greet = e3.task('greet', [name], East.function([StringType], StringType, ($, n) => East.str`Hello, ${n}!`));
    const shout = e3.task('shout', [greet.output], East.function([StringType], StringType, ($, s) => s.upperCase()));
    return e3.package('hello', '1.0.0', shout);
  },
});

export const groupTotals = example({
  keywords: ['e3', 'task', 'group', 'sum', 'dict', 'totals', 'orders'],
  description: "A task computing each customer's total from an input of orders",
  fn: () => {
    const Order = StructType({ customer: StringType, amount: FloatType });
    const orders = e3.input('orders', ArrayType(Order), variant('value', [
      { customer: 'b', amount: 2.5 }, { customer: 'a', amount: 1 }, { customer: 'b', amount: 4 },
    ]));
    const totals = e3.task('totals', [orders], East.function([ArrayType(Order)], DictType(StringType, FloatType),
      ($, os) => os.groupSum(($, o) => o.customer, ($, o) => o.amount)));
    return e3.package('shop', '1.0.0', totals);
  },
});

export const taskRunners = example({
  keywords: ['e3', 'task', 'runner', 'runtime', 'east-py', 'east-c', 'platforms', 'decode', 'whole', 'custom', 'python'],
  description: "Choose a task's runtime and the platforms it loads; decode every input before the program runs; or run a command of your own",
  fn: () => {
    const input = e3.input('input', IntegerType, variant('value', 21n));
    const double = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
    // A stock runtime and the platforms it loads: a typo, or another runtime's platform, is a compile error.
    const onPython = e3.task('on_python', [input], double, { runner: { runtime: 'east-py', platforms: ['east-py-std'] } });
    // A stock runtime reads collection inputs lazily unless `decode: 'whole'`: for reads that land at random.
    const whole = e3.task('whole', [input], double, { runner: { runtime: 'east-c', platforms: ['east-c-std'], decode: 'whole' } });
    // Any other command: e3 appends -i <input> for each input, -o <output>, then the program's file.
    const wrapped = e3.task('wrapped', [input], double,
      { runner: { runtime: 'custom', command: ['uv', 'run', 'east-py', 'run', '-p', 'east-py-std'] } });
    return e3.package('runners', '1.0.0', onPython, whole, wrapped);
  },
});

export const customTask = example({
  keywords: ['e3', 'customTask', 'shell', 'command', 'script', 'bash'],
  description: "A task that runs a shell command, built from the staged inputs' paths and the path it writes its output to",
  fn: () => {
    const rawData = e3.input('raw_data', StringType, variant('value', 'hello'));
    const processed = e3.customTask('process', [rawData], StringType,
      ($, inputPaths, outputPath) => East.str`python script.py -i ${inputPaths.get(0n)} -o ${outputPath}`);
    return e3.package('scripts', '1.0.0', processed);
  },
});

export const namedFunction = example({
  keywords: ['e3', 'function', 'rpc', 'call', 'e3 call', 'named function'],
  description: 'A named function, called by name with arguments (`e3 call <repo> -w <ws> greet \'"Ada"\'`): not in the dataflow, a call persists nothing',
  fn: () => {
    const greet = e3.function('greet', East.function([StringType], StringType, ($, n) => East.str`Hello, ${n}!`));
    return e3.package('hello', '1.0.0', greet);
  },
});
