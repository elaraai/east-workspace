/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A task's East body run through `exec` (units.ts): the unit a task object
 * becomes, the spawned runner, and its output stored through the store's
 * door — for every output kind, as the manifest the value path writes for the
 * same value.
 *
 * The tasks are real SDK definitions, exported and imported as packages, so
 * the task objects are the ones `e3.export` writes. The east-py case doubles
 * as a cross-runtime pin: what east-py writes through the protocol is what
 * TypeScript writes for the same value.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import {
  ArrayType, DictType, IntegerType, SetType, StringType,
  East, SortedMap, SortedSet, compareFor, RUN_MAX_COUNT,
  type EastType,
} from '@elaraai/east';
import e3, { type Runner, type TaskDef } from '@elaraai/e3';
import { taskExecute, type ExecutionResult } from './LocalTaskRunner.js';
import { datasetWrite } from '../trees.js';
import { packageImport, packageRead } from '../packages.js';
import { createTempDir, createTestRepo, removeTempDir, removeTestRepo } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/interfaces.js';

const EAST_NODE: Runner = { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] };

/** Whether an `east-py` CLI resolves on PATH — the e3 CI workflow installs
 *  it (uv tool) on every leg; locally the east-py case skips when absent. */
const eastPyAvailable = (() => {
  const probe = spawnSync('east-py', ['version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return probe.status === 0;
})();

describe('a task body run through exec', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** Exports `task` in a package of its own, imports it, and runs it over
   *  `inputs`, the values of its input datasets in order. */
  async function run(task: TaskDef, inputs: [EastType, unknown][] = []): Promise<ExecutionResult> {
    const zip = join(tempDir, `${task.name}.zip`);
    await e3.export(e3.package(task.name, '1.0.0', task), zip);
    await packageImport(storage, repo, zip);
    const taskHash = (await packageRead(storage, repo, task.name, '1.0.0')).tasks.get(task.name)!;
    const inputHashes: string[] = [];
    for (const [type, value] of inputs) inputHashes.push(await datasetWrite(storage, repo, value, type));
    return taskExecute(storage, repo, taskHash, inputHashes);
  }

  /** Asserts a run succeeded with the output the value path writes for `value`. */
  async function assertOutput(result: ExecutionResult, type: EastType, value: unknown): Promise<void> {
    assert.equal(result.state, 'success', result.error ?? '');
    assert.equal(result.outputHash, await datasetWrite(storage, repo, value, type), 'the output is the manifest the value path writes');
  }

  const WordsType = ArrayType(StringType);
  const LengthsType = DictType(StringType, IntegerType);
  const CountsType = DictType(IntegerType, IntegerType);
  const words = e3.input('words', WordsType);
  const events = e3.input('events', ArrayType(IntegerType));

  it('stores an e3.task\'s collection result as the value\'s manifest, and serves a re-run from the cache', async () => {
    const lengths = e3.task('lengths', [words], East.function([WordsType], LengthsType, ($, words) =>
      words.toDict(($, w) => w, ($, w) => w.length(), ($, _existing, _value, key) => $.error(East.str`duplicate word ${key}`))));

    const inputs: [EastType, unknown][] = [[WordsType, ['pear', 'fig', 'apple']]];
    const result = await run(lengths, inputs);
    await assertOutput(result, LengthsType, new SortedMap([['apple', 5n], ['fig', 3n], ['pear', 4n]], compareFor(StringType)));

    const again = await run(lengths, inputs);
    assert.equal(again.cached, true);
    assert.equal(again.outputHash, result.outputHash);
  });

  it('records a body\'s failure as the task\'s, with the runner\'s message', async () => {
    const fails = e3.task('fails', [words], East.function([WordsType], IntegerType, ($, words) => {
      $.if(East.greater(words.size(), 1n), ($) => $.error(East.str`too many words: ${words.size()}`));
      return words.size();
    }));

    const result = await run(fails, [[WordsType, ['a', 'b']]]);
    assert.equal(result.state, 'failed');
    assert.equal(result.exitCode, 1);
    assert.match(result.error ?? '', /too many words: 2/);
  });

  /** A running sum over `events`, emitted as it goes. */
  const sums = (name: string, runner: Runner) =>
    e3.streamTask(name, {
      inputs: [events],
      output: e3.output.array(IntegerType),
      runner,
    }, ($, events, emit) => {
      const acc = $.let(0n);
      $.for(events, ($, v) => {
        $.assign(acc, acc.add(v));
        $(emit(acc));
      });
    });
  const eventValues = Array.from({ length: 2500 }, (_, i) => BigInt(i));
  const expectedSums = eventValues.map((_, i) => (BigInt(i) * BigInt(i + 1)) / 2n);

  it('stores an array output as the emitted elements, in emission order', async () => {
    await assertOutput(await run(sums('sums', EAST_NODE), [[ArrayType(IntegerType), eventValues]]), ArrayType(IntegerType), expectedSums);
  });

  it('stores an array output east-py wrote as TypeScript writes it',
    { skip: eastPyAvailable ? false : 'east-py CLI not on PATH' }, async () => {
      const runner: Runner = { runtime: 'east-py', platforms: ['east-py-std'] };
      await assertOutput(await run(sums('sums_py', runner), [[ArrayType(IntegerType), eventValues]]), ArrayType(IntegerType), expectedSums);
    });

  it('sorts a dict emitted out of order and folds its equal keys with merge', async () => {
    const counts = e3.streamTask('counts', {
      inputs: [],
      output: e3.output.dict(IntegerType, IntegerType, { merge: (_$, _key, a, b) => a.add(b) }),
    }, ($, emit) => {
      const i = $.let(0n);
      $.while(East.less(i, 1000n), ($) => {
        $(emit(i.remainder(7n), 1n));
        $.assign(i, i.add(1n));
      });
    });

    const expected = new SortedMap<bigint, bigint>([], compareFor(IntegerType));
    for (let i = 0n; i < 1000n; i++) expected.set(i % 7n, (expected.get(i % 7n) ?? 0n) + 1n);
    await assertOutput(await run(counts), CountsType, expected);
  });

  it('refuses a key emitted twice into a dict with no merge, naming it', async () => {
    const twice = e3.streamTask('twice', {
      inputs: [],
      output: e3.output.dict(IntegerType, StringType),
    }, ($, emit) => {
      $(emit(1n, 'a'));
      $(emit(1n, 'b'));
    });

    const result = await run(twice);
    assert.equal(result.state, 'failed');
    assert.match(result.error ?? '', /duplicate Dict key emitted: 1/);
  });

  it('merges the runs of a dict emitted past one run, folding the keys they share', async () => {
    // RUN_MAX_COUNT emissions close a run, so these fill two, and every key
    // is in both: the merge unit folds each across them.
    const n = BigInt(RUN_MAX_COUNT + 1000);
    const counts = e3.streamTask('counts_runs', {
      inputs: [],
      output: e3.output.dict(IntegerType, IntegerType, { merge: (_$, _key, a, b) => a.add(b) }),
    }, ($, emit) => {
      const i = $.let(0n);
      $.while(East.less(i, n), ($) => {
        $(emit(i.remainder(1000n), 1n));
        $.assign(i, i.add(1n));
      });
    });

    const expected = new SortedMap<bigint, bigint>([], compareFor(IntegerType));
    for (let key = 0n; key < 1000n; key++) expected.set(key, n / 1000n + (key < n % 1000n ? 1n : 0n));
    await assertOutput(await run(counts), CountsType, expected);
  });

  it('stores a set output as the distinct elements emitted', async () => {
    const distinct = e3.streamTask('distinct', {
      inputs: [],
      output: e3.output.set(IntegerType),
    }, ($, emit) => {
      const i = $.let(20n);
      $.while(East.greater(i, 0n), ($) => {
        $.assign(i, i.subtract(1n));
        $(emit(i.remainder(5n)));
      });
    });

    await assertOutput(await run(distinct), SetType(IntegerType), new SortedSet([0n, 1n, 2n, 3n, 4n], compareFor(IntegerType)));
  });

  it('stores the empty collection when nothing is emitted', async () => {
    const none = e3.streamTask('none', {
      inputs: [],
      output: e3.output.dict(IntegerType, IntegerType),
    }, () => {});

    await assertOutput(await run(none), CountsType, new SortedMap([], compareFor(IntegerType)));
  });

  it('stores a fold output as the value its emissions fold to', async () => {
    const total = e3.streamTask('total', {
      inputs: [e3.input('amounts', ArrayType(IntegerType))],
      output: e3.output.fold(IntegerType, { zero: 0n, combine: (_$, a, b) => a.add(b) }),
    }, ($, amounts, emit) => {
      $.for(amounts, ($, amount) => {
        $(emit(amount));
      });
    });

    await assertOutput(await run(total, [[ArrayType(IntegerType), eventValues]]), IntegerType, (2499n * 2500n) / 2n);
  });

  it('runs a partitioned task as one unit, over its whole input', async () => {
    const SalesType = DictType(StringType, IntegerType);
    const sales = e3.input('sales', SalesType);
    const doubled = e3.streamTask('doubled', {
      inputs: [e3.partition(sales)],
      output: e3.output.dict(StringType, IntegerType),
    }, ($, sales, emit) => {
      $.for(sales, ($, amount, account) => {
        $(emit(account, amount.multiply(2n)));
      });
    });

    const input = new SortedMap([['a', 1n], ['b', 2n], ['c', 3n]], compareFor(StringType));
    await assertOutput(await run(doubled, [[SalesType, input]]), SalesType,
      new SortedMap([['a', 2n], ['b', 4n], ['c', 6n]], compareFor(StringType)));
  });

  it('runs an e3.task on the custom runtime with run\'s arguments', async () => {
    const count = e3.task('count', [words], East.function([WordsType], IntegerType, ($, words) => words.size()), {
      runner: { runtime: 'custom', command: ['east-node', 'run', '-p', '@elaraai/east-node-std'] },
    });

    await assertOutput(await run(count, [[WordsType, ['a', 'b', 'c']]]), IntegerType, 3n);
  });
});
