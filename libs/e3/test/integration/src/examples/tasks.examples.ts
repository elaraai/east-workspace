/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { East, ArrayType, FloatType, IntegerType, NullType, StringType, StructType, DictType, variant } from '@elaraai/east';
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

// ---
// e3.function
// ---

export const namedFunction = example({
  keywords: ['e3', 'function', 'rpc', 'call', 'e3 call', 'named function'],
  description: 'A named function, called by name with arguments (`e3 call <repo> -w <ws> greet \'"Ada"\'`): not in the dataflow; a server keeps a call through a workspace for its lifetime',
  fn: () => {
    const greet = e3.function('greet', East.function([StringType], StringType, ($, n) => East.str`Hello, ${n}!`));
    return e3.package('hello', '1.0.0', greet);
  },
});

export const functionDrafts = example({
  keywords: ['e3', 'function', 'drafts', 'draft', 'unsaved edits', 'record', 'mutation', 'what-if', 'e3 call', '--draft', 'nothing saved'],
  description: 'A function that reads a record with a caller\'s unsaved edits laid over it: `drafts` lists the records a call may draft, each draft a mutation call that is not committed (`e3 call <repo> -w <ws> jobs_on \'"P1"\' --draft jobs.move \'"j2"\' \'"P1"\'`), and nothing is saved',
  fn: () => {
    const JobType = StructType({ press: StringType, hours: IntegerType });
    const JobsType = DictType(StringType, JobType);
    const jobs = e3.record('jobs', JobsType, {
      initial: new Map([['j1', { press: 'P1', hours: 2n }], ['j2', { press: 'P2', hours: 3n }]]),
      mutations: (mutation) => ({
        move: mutation.edit(East.function([JobsType, StringType, StringType, e3.mutation.editType(JobsType)], NullType,
          ($, state, id, press, edit) => { $(edit.set(id, { press, hours: state.get(id).hours })); })),
        patch: mutation.patch(),   // what a page's Save sends, and so what it drafts
      }),
    });
    // `drafts` lists records among `inputs`. A call that passes drafts of one runs them in order as a
    // Save would — each over the state the one before it left — and the body reads the record at the
    // state that leaves. No commit is stored, the record does not move, and no task reruns. Listing a
    // record is the author's word that the body is fit to run over edits nobody saved: a function
    // that sends a message or writes elsewhere lists none.
    const jobsOn = e3.function('jobs_on', { inputs: [jobs], drafts: [jobs], args: [StringType], output: IntegerType },
      ($, jobs, press) => {
        const count = $.let(0n);
        $.for(jobs, ($, job) => {
          $.if(East.equal(job.press, press), ($) => { $.assign(count, count.add(1n)); });
        });
        return count;
      });
    // The result names the drafted state it read (`inputs`) and the commit the record stood at
    // (`drafts`). A draft the record refuses ends the call as its Save would: `failed`, or `conflict`
    // when the record changed under the edit, and the body does not run.
    return e3.package('pressroom', '1.0.0', jobsOn);
  },
});
