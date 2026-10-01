/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The package e3-web's runner cases run, authored with the e3 SDK and
 * exported as `e3.export` writes it: Node only.
 *
 * The SDK is a test dependency of e3-web, and only this module reaches it:
 * the tasks the cases run are the task objects an app's `e3.export` writes,
 * not hand-made ones. Node exports the package to a zip and reads its
 * objects and its package ref out, as plain data the cases install
 * (`runner-cases.ts`) — in Node, and in a Chromium page, which is handed the
 * data and never the SDK.
 *
 * @packageDocumentation
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ArrayType,
  DictType,
  East,
  IntegerType,
  SortedMap,
  StringType,
  compareFor,
  decodeBeast2For,
} from '@elaraai/east';
import e3, { type Runner } from '@elaraai/e3';
import { Console, Time } from '@elaraai/east-web-std';
import { readZipEntries } from '@elaraai/e3-core/test';
import { TEST_PLATFORM, test_greet, test_tick, test_wait } from './test-platform.js';
import { FIXTURE_PACKAGE, FIXTURE_VERSION, type RunnerFixtures } from './runner-cases.js';

const WordsType = ArrayType(StringType);
const EventsType = ArrayType(IntegerType);
const SalesType = DictType(IntegerType, IntegerType);
const CountsType = DictType(StringType, IntegerType);

/**
 * `FileSystem.readFile`, as east-node-std declares it: a task written for
 * east-node that reads a file, which a browser has no file system for.
 * east-node-std is not a dependency of e3-web, and the declaration is all a
 * task's IR records of it — its name and its types.
 */
const fs_read_file = East.platform('fs_read_file', [StringType], StringType);

/** east-node, with the specs' own platform package beside east-node-std's. */
const WITH_TEST_PLATFORM: Runner = { runtime: 'east-node', platforms: ['@elaraai/east-node-std', { custom: TEST_PLATFORM }] };

/** Emissions enough for a dict to close two runs, so its unit's output needs
 *  a merge: one more than a run holds. */
const PAST_ONE_RUN = 131_072 + 1_000;

/**
 * Defines the fixture package: a task of every output kind, a task that
 * fails, one that logs, one split over its input, one of each kind a browser
 * refuses or cannot serve, one an app's package answers, and a record with a
 * mutation and an index.
 *
 * @returns The package
 */
function fixturePackage(): ReturnType<typeof e3.package> {
  const words = e3.input('words', WordsType);
  const events = e3.input('events', EventsType);
  const sales = e3.input('sales', SalesType);

  const lengths = e3.task('lengths', [words], East.function([WordsType], CountsType, ($, list) =>
    list.toDict(($, w) => w, ($, w) => w.length(), ($, _existing, _value, key) => $.error(East.str`duplicate word ${key}`))));
  const count = e3.task('count', [words], East.function([WordsType], IntegerType, ($, list) => list.size()));
  const sums = e3.streamTask('sums', { inputs: [events], output: e3.output.array(IntegerType) }, ($, list, emit) => {
    const acc = $.let(0n);
    $.for(list, ($, v) => {
      $.assign(acc, acc.add(v));
      $(emit(acc));
    });
  });
  const distinct = e3.streamTask('distinct', { inputs: [events], output: e3.output.set(IntegerType) }, ($, list, emit) => {
    $.for(list, ($, v) => {
      $(emit(v.remainder(5n)));
    });
  });
  const tallies = e3.streamTask('tallies', {
    inputs: [],
    output: e3.output.dict(IntegerType, IntegerType, { merge: (_$, _key, a, b) => a.add(b) }),
  }, ($, emit) => {
    const i = $.let(0n);
    $.while(East.less(i, BigInt(PAST_ONE_RUN)), ($) => {
      $(emit(i.remainder(1000n), 1n));
      $.assign(i, i.add(1n));
    });
  });
  const doubled = e3.streamTask('doubled', { inputs: [sales], output: e3.output.dict(IntegerType, IntegerType) }, ($, rows, emit) => {
    $.for(rows, ($, amount, key) => {
      $(emit(key, amount.multiply(2n)));
    });
  });
  const total = e3.streamTask('total', {
    inputs: [events],
    output: e3.output.fold(IntegerType, { zero: 0n, combine: (_$, a, b) => a.add(b) }),
  }, ($, list, emit) => {
    $.for(list, ($, v) => {
      $(emit(v));
    });
  });
  const nothing = e3.streamTask('nothing', { inputs: [], output: e3.output.dict(IntegerType, IntegerType) }, () => {});
  const fails = e3.task('fails', [words], East.function([WordsType], IntegerType, ($, list) => {
    $(Console.log('checking the words'));
    $.if(East.greater(list.size(), 1n), ($) => $.error(East.str`too many words: ${list.size()}`));
    return list.size();
  }));
  const chatty = e3.task('chatty', [words], East.function([WordsType], IntegerType, ($, list) => {
    $(Console.log(East.str`counting ${list.size()} words`));
    $(Console.error('a line to stderr'));
    return list.size();
  }));
  const splitCounts = e3.streamTask('split_counts', {
    inputs: [e3.partition(sales)],
    output: e3.output.dict(IntegerType, IntegerType, { merge: (_$, _key, a, b) => a.add(b) }),
  }, ($, rows, emit) => {
    $.for(rows, ($, _amount, key) => {
      $(emit(key.remainder(97n), 1n));
    });
  });
  const command = e3.customTask('command', [words], StringType, ($, _inputs, output) => East.str`echo hi > ${output}`);
  const customRuntime = e3.task('custom_runtime', [words], East.function([WordsType], IntegerType, ($, list) => list.size()), {
    runner: { runtime: 'custom', command: ['east-node', 'run', '-p', '@elaraai/east-node-std'] },
  });
  const ioTask = e3.task('io_task', [words], East.function([WordsType], IntegerType, ($, list) => list.size()), {
    runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-std', '@elaraai/east-node-io'] },
  });
  const readsFile = e3.task('reads_file', [words], East.function([WordsType], StringType, ($, _list) => fs_read_file('config.txt')));
  const greets = e3.task('greets', [words], East.function([WordsType], StringType, ($, list) => test_greet(list.get(0n))), {
    runner: WITH_TEST_PLATFORM,
  });
  const waits = e3.task('waits', [words], East.asyncFunction([WordsType], IntegerType, ($, list) => {
    $(Console.log('waiting for the host'));
    $(test_wait());
    return list.size();
  }), { runner: WITH_TEST_PLATFORM });
  const ticking = e3.task('ticking', [words], East.asyncFunction([WordsType], IntegerType, ($, list) => {
    $.while(true, ($) => {
      $(test_tick());
      $(Time.sleep(5n));
    });
    return list.size();
  }), { runner: WITH_TEST_PLATFORM });

  const counts = e3.record('counts', CountsType, new SortedMap<string, bigint>([], compareFor(StringType)));
  const add = e3.mutation.reduce('add', counts, East.function([CountsType, StringType, IntegerType], CountsType, ($, state, key, n) => {
    const next = $.let(state.copy());
    $(next.insertOrUpdate(key, n, ($, existing, added) => existing.add(added)));
    return next;
  }));
  const byCount = e3.recordIndex('by_count', counts, {
    key: East.function([StringType, IntegerType], IntegerType, ($, _key, n) => n),
  });

  return e3.package(FIXTURE_PACKAGE, FIXTURE_VERSION,
    lengths, count, sums, distinct, tallies, doubled, total, nothing, fails, chatty, splitCounts, command, customRuntime, ioTask,
    readsFile, greets, waits, ticking, counts, add, byCount);
}

/**
 * Exports the fixture package as `e3.export` writes it, and reads its objects
 * and its ref out of the zip.
 *
 * @returns The fixtures, as plain data
 */
export async function buildRunnerFixtures(): Promise<RunnerFixtures> {
  const dir = mkdtempSync(join(tmpdir(), 'e3-web-fixtures-'));
  try {
    const zip = join(dir, `${FIXTURE_PACKAGE}.zip`);
    await e3.export(fixturePackage(), zip);
    const objects: Array<readonly [string, Uint8Array]> = [];
    let packageHash: string | null = null;
    for (const [name, bytes] of await readZipEntries(zip)) {
      const object = /^objects\/([0-9a-f]{2})\/([0-9a-f]{62})\.beast2$/.exec(name);
      if (object !== null) objects.push([`${object[1]}${object[2]}`, new Uint8Array(bytes)]);
      if (name === `packages/${FIXTURE_PACKAGE}/${FIXTURE_VERSION}.beast2`) packageHash = decodeBeast2For(StringType)(new Uint8Array(bytes));
    }
    if (packageHash === null) throw new Error('the fixture package\'s zip holds no package ref');
    return { objects, packageHash };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
