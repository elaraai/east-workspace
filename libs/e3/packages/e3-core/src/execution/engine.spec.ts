/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A task split into pieces (engine.ts): a unit per piece, assembled by the
 * task's output kind, with every output the manifest the value path writes
 * for the same value. `E3_TEST_PIECE_BYTES` makes the pieces small, so a
 * few thousand rows are many pieces.
 *
 * The tasks are real SDK definitions, exported and imported as packages, run
 * by east-node.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  ArrayType, DictType, IntegerType, SetType, StringType, StructType,
  East, SortedMap, SortedSet, compareFor,
  type EastType,
} from '@elaraai/east';
import e3, { type TaskDef } from '@elaraai/e3';
import { decodeTaskObject, decodeUnitPlan, type PartitionProgress } from '@elaraai/e3-types';
import { taskExecute, taskExecuteBody, type ExecuteOptions, type ExecutionResult } from './LocalTaskRunner.js';
import { executeSplitTask } from './engine.js';
import { JobSlots } from './jobs.js';
import { executionReadLog, inputsHash } from '../executions.js';
import { uuidv7 } from '../uuid.js';
import { datasetWrite } from '../trees.js';
import { packageImport, packageRead } from '../packages.js';
import { createTempDir, createTestRepo, removeTempDir, removeTestRepo } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/interfaces.js';

const SalesType = DictType(IntegerType, IntegerType);
const CountsType = DictType(IntegerType, IntegerType);
const sales = e3.input('sales', SalesType);

/** `n` rows keyed `0 … n-1`, each valued its key. */
function salesOf(n: number): SortedMap<bigint, bigint> {
  return new SortedMap(Array.from({ length: n }, (_, i) => [BigInt(i), BigInt(i)] as [bigint, bigint]), compareFor(IntegerType));
}

describe('a task split into pieces', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  let pieceBytes: string | undefined;

  beforeEach(() => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage();
    pieceBytes = process.env.E3_TEST_PIECE_BYTES;
    // Pieces of 16 to 256 stored bytes: a piece a segment.
    process.env.E3_TEST_PIECE_BYTES = '64';
  });

  afterEach(() => {
    if (pieceBytes === undefined) delete process.env.E3_TEST_PIECE_BYTES;
    else process.env.E3_TEST_PIECE_BYTES = pieceBytes;
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** Exports `task` in a package of its own, imports it, and returns its hash. */
  async function deploy(task: TaskDef): Promise<string> {
    const zip = join(tempDir, `${task.name}.zip`);
    await e3.export(e3.package(task.name, '1.0.0', task), zip);
    await packageImport(storage, repo, zip);
    return (await packageRead(storage, repo, task.name, '1.0.0')).tasks.get(task.name)!;
  }

  /** Runs a deployed task over `inputs`, the values of its inputs in order. */
  async function run(taskHash: string, inputs: [EastType, unknown][], options: ExecuteOptions = {}): Promise<ExecutionResult> {
    const inputHashes: string[] = [];
    for (const [type, value] of inputs) inputHashes.push(await datasetWrite(storage, repo, value, type));
    return taskExecute(storage, repo, taskHash, inputHashes, options);
  }

  /** The lines of a run's log naming its units. */
  async function unitLines(taskHash: string, result: ExecutionResult): Promise<string[]> {
    const log = await executionReadLog(storage, repo, taskHash, result.inputsHash, result.executionId, 'stdout');
    return log.data.split('\n').filter((line) => line !== '');
  }

  /** Asserts a run succeeded with the output the value path writes for `value`. */
  async function assertOutput(result: ExecutionResult, type: EastType, value: unknown): Promise<void> {
    assert.equal(result.state, 'success', result.error ?? '');
    assert.equal(result.outputHash, await datasetWrite(storage, repo, value, type), 'the output is the manifest the value path writes');
  }

  it('merges pieces whose keys overlap, folding their equal keys with the dict\'s merge', async () => {
    const taskHash = await deploy(e3.streamTask('counts', {
      inputs: [e3.partition(sales)],
      output: e3.output.dict(IntegerType, IntegerType, { merge: (_$, _key, a, b) => a.add(b) }),
    }, ($, sales, emit) => {
      $.for(sales, ($, _amount, key) => {
        $(emit(key.remainder(97n), 1n));
      });
    }));

    const result = await run(taskHash, [[SalesType, salesOf(8000)]]);
    const expected = new SortedMap<bigint, bigint>([], compareFor(IntegerType));
    for (let i = 0n; i < 8000n; i++) expected.set(i % 97n, (expected.get(i % 97n) ?? 0n) + 1n);
    await assertOutput(result, CountsType, expected);

    const lines = await unitLines(taskHash, result);
    const pieces = lines.filter((line) => /^piece \d+\/\d+ completed task=/.test(line));
    assert.ok(pieces.length > 4, `the input ran as many pieces:\n${lines.join('\n')}`);
    assert.equal(pieces.length, Number(/^piece \d+\/(\d+)/.exec(pieces[0]!)![1]));
    // Every piece holds every remainder: one group, merged in one range.
    assert.deepEqual(lines.filter((line) => line.startsWith('merge ')).map((line) => line.split(' task=')[0]),
      ['merge level 1/1 unit 1/1 completed']);
  });

  it('concatenates pieces whose keys are disjoint, with no merge', async () => {
    const taskHash = await deploy(e3.streamTask('doubled', {
      inputs: [e3.partition(sales)],
      output: e3.output.dict(IntegerType, IntegerType),
    }, ($, sales, emit) => {
      $.for(sales, ($, amount, key) => {
        $(emit(key, amount.multiply(2n)));
      });
    }));

    const result = await run(taskHash, [[SalesType, salesOf(8000)]]);
    await assertOutput(result, CountsType,
      new SortedMap(Array.from({ length: 8000 }, (_, i) => [BigInt(i), BigInt(2 * i)] as [bigint, bigint]), compareFor(IntegerType)));
    const lines = await unitLines(taskHash, result);
    assert.ok(lines.length > 4 && lines.every((line) => line.startsWith('piece ')), `no merge ran:\n${lines.join('\n')}`);
  });

  it('merges large overlapping parts over key ranges, a unit a range', async () => {
    // Each piece emits four keys a row, scattered over the whole key space, so
    // every part overlaps every other and spans several segments.
    const taskHash = await deploy(e3.streamTask('scattered', {
      inputs: [e3.partition(sales)],
      output: e3.output.dict(IntegerType, IntegerType, { merge: (_$, _key, a, b) => a.add(b) }),
    }, ($, sales, emit) => {
      $.for(sales, ($, _amount, key) => {
        const at = key.multiply(7919n).remainder(8000n).multiply(4n);
        $(emit(at, 1n));
        $(emit(at.add(1n), 1n));
        $(emit(at.add(2n), 1n));
        $(emit(at.add(3n), 1n));
      });
    }));

    const result = await run(taskHash, [[SalesType, salesOf(8000)]]);
    await assertOutput(result, CountsType,
      new SortedMap(Array.from({ length: 32000 }, (_, i) => [BigInt(i), 1n] as [bigint, bigint]), compareFor(IntegerType)));
    // The log names the units as they finish, in any order.
    const merges = (await unitLines(taskHash, result)).filter((line) => line.startsWith('merge '));
    assert.ok(merges.length >= 2, `the group merges over several ranges:\n${merges.join('\n')}`);
    const units = merges.map((line) => /^merge level 1\/1 unit (\d+)\/(\d+) completed /.exec(line));
    assert.ok(units.every((unit) => unit !== null && Number(unit[2]) === merges.length), merges.join('\n'));
    assert.deepEqual(units.map((unit) => Number(unit![1])).sort((a, b) => a - b), Array.from({ length: merges.length }, (_, i) => i + 1));
  });

  it('unites a set\'s pieces', async () => {
    const taskHash = await deploy(e3.streamTask('remainders', {
      inputs: [e3.partition(sales)],
      output: e3.output.set(IntegerType),
    }, ($, sales, emit) => {
      $.for(sales, ($, _amount, key) => {
        $(emit(key.remainder(100n)));
      });
    }));

    await assertOutput(await run(taskHash, [[SalesType, salesOf(8000)]]), SetType(IntegerType),
      new SortedSet(Array.from({ length: 100 }, (_, i) => BigInt(i)), compareFor(IntegerType)));
  });

  it('concatenates an array\'s pieces in input order', async () => {
    const EventsType = ArrayType(IntegerType);
    const events = e3.input('events', EventsType);
    const taskHash = await deploy(e3.streamTask('shifted', {
      inputs: [e3.partition(events)],
      output: e3.output.array(IntegerType),
    }, ($, events, emit) => {
      $.for(events, ($, value) => {
        $(emit(value.add(1n)));
      });
    }));

    const values = Array.from({ length: 9000 }, (_, i) => BigInt((i * 7919) % 9000));
    const result = await run(taskHash, [[EventsType, values]]);
    await assertOutput(result, EventsType, values.map((v) => v + 1n));
    assert.ok((await unitLines(taskHash, result)).length > 4, 'the input ran as many pieces');
  });

  it('folds a fold\'s partials in piece order', async () => {
    const taskHash = await deploy(e3.streamTask('total', {
      inputs: [e3.partition(sales)],
      output: e3.output.fold(IntegerType, { zero: 0n, combine: (_$, a, b) => a.add(b) }),
    }, ($, sales, emit) => {
      $.for(sales, ($, amount) => {
        $(emit(amount));
      });
    }));

    const result = await run(taskHash, [[SalesType, salesOf(8000)]]);
    await assertOutput(result, IntegerType, (7999n * 8000n) / 2n);
    assert.deepEqual((await unitLines(taskHash, result)).filter((line) => line.startsWith('combine ')).map((line) => line.split(' task=')[0]),
      ['combine level 1/1 unit 1/1 completed']);
  });

  it('keeps a `by` group in one piece, so a dict with no merge takes each group\'s total once', async () => {
    const KeyType = StructType({ account: StringType, id: IntegerType });
    type Key = { account: string; id: bigint };
    const LedgerType = DictType(KeyType, IntegerType);
    const ledger = e3.input('ledger', LedgerType);
    // 1500 rows an account, so accounts run across segments.
    const value = new SortedMap<Key, bigint>(
      Array.from({ length: 9000 }, (_, i) => [{ account: `acct-${Math.floor(i / 1500)}`, id: BigInt(i) }, 1n] as [Key, bigint]),
      compareFor(KeyType));
    const totals = (name: string, by: string[]) => e3.streamTask(name, {
      inputs: [e3.partition(ledger, { by })],
      output: e3.output.dict(StringType, IntegerType),
    }, ($, ledger, emit) => {
      const sums = $.let(ledger.toDict(($, _amount, key) => key.account, ($, amount) => amount, ($, a, b) => a.add(b)));
      $.for(sums, ($, total, account) => {
        $(emit(account, total));
      });
    });

    await assertOutput(await run(await deploy(totals('by_account', ['account'])), [[LedgerType, value]]), DictType(StringType, IntegerType),
      new SortedMap(Array.from({ length: 6 }, (_, a) => [`acct-${a}`, 1500n] as [string, bigint]), compareFor(StringType)));

    // Cut anywhere, an account's rows land in two pieces, which both emit it.
    const split = await run(await deploy(totals('by_row', [])), [[LedgerType, value]]);
    assert.equal(split.state, 'failed');
    assert.match(split.error ?? '', /^Merge unit \d+ of \d+ at level 1 of 1 failed \(exit code 1\): .*duplicate Dict key emitted: "acct-\d"/s);
  });

  it('splits co-partitioned inputs at the same keys', async () => {
    const returns = e3.input('returns', SalesType);
    const taskHash = await deploy(e3.streamTask('net', {
      inputs: [e3.partition(sales), e3.partition(returns)],
      output: e3.output.dict(IntegerType, IntegerType),
    }, ($, sales, returns, emit) => {
      $.for(sales, ($, amount, key) => {
        $(emit(key, amount.subtract(returns.get(key, ($, _key) => 0n))));
      });
    }));

    // Every third key returned, in segments of another geometry.
    const returned = new SortedMap<bigint, bigint>(
      Array.from({ length: 2666 }, (_, i) => [BigInt(3 * i), 1n] as [bigint, bigint]), compareFor(IntegerType));
    const result = await run(taskHash, [[SalesType, salesOf(8000)], [SalesType, returned]]);
    await assertOutput(result, CountsType,
      new SortedMap(Array.from({ length: 8000 }, (_, i) => [BigInt(i), BigInt(i) - (i % 3 === 0 && i < 7998 ? 1n : 0n)] as [bigint, bigint]), compareFor(IntegerType)));
    assert.ok((await unitLines(taskHash, result)).length > 4, 'the inputs ran as many pieces');
  });

  it('re-runs only the pieces an insertion touches', async () => {
    const EvenType = DictType(IntegerType, StringType);
    const rows = e3.input('rows', EvenType);
    const taskHash = await deploy(e3.streamTask('lengths', {
      inputs: [e3.partition(rows)],
      output: e3.output.dict(IntegerType, IntegerType),
    }, ($, rows, emit) => {
      $.for(rows, ($, text, key) => {
        $(emit(key, text.length()));
      });
    }));

    const before = new SortedMap<bigint, string>(
      Array.from({ length: 8000 }, (_, i) => [BigInt(2 * i), `row-${2 * i}`] as [bigint, string]), compareFor(IntegerType));
    const first = await run(taskHash, [[EvenType, before]]);
    assert.equal(first.state, 'success', first.error ?? '');
    const after = new SortedMap<bigint, string>([...before], compareFor(IntegerType));
    for (let key = 8001n; key < 8041n; key += 2n) after.set(key, `row-${key}`);
    const second = await run(taskHash, [[EvenType, after]]);
    assert.equal(second.state, 'success', second.error ?? '');

    const lines = await unitLines(taskHash, second);
    const ran = lines.filter((line) => / completed task=/.test(line));
    const cached = lines.filter((line) => / cached task=/.test(line));
    assert.ok(lines.length > 4, `the input ran as many pieces:\n${lines.join('\n')}`);
    assert.ok(ran.length >= 1 && ran.length <= 3, `only the pieces around the insertion ran:\n${lines.join('\n')}`);
    assert.equal(ran.length + cached.length, lines.length);
  });

  it('fails as the lowest-index piece that failed, with the runner\'s message', async () => {
    const taskHash = await deploy(e3.streamTask('picky', {
      inputs: [e3.partition(sales)],
      output: e3.output.dict(IntegerType, IntegerType),
    }, ($, sales, emit) => {
      $.for(sales, ($, amount, key) => {
        $.if(East.equal(key, 1100n), ($) => $.error(East.str`bad row ${key}`));
        $.if(East.equal(key, 2100n), ($) => $.error(East.str`bad row ${key}`));
        $(emit(key, amount));
      });
    }));

    const result = await run(taskHash, [[SalesType, salesOf(8000)]]);
    assert.equal(result.state, 'failed');
    assert.equal(result.exitCode, 1);
    assert.match(result.error ?? '', /^Piece \d+ of \d+ failed \(exit code 1\): .*bad row 1100/s);
    assert.equal((await storage.refs.executionGetLatest(repo, taskHash, result.inputsHash))?.type, 'failed');
  });

  it('records the task cancelled when the run is aborted, and stops its units', async () => {
    const taskHash = await deploy(e3.streamTask('slow', {
      inputs: [e3.partition(sales)],
      output: e3.output.dict(IntegerType, IntegerType),
    }, ($, sales, emit) => {
      $.for(sales, ($, amount, key) => {
        $(emit(key, amount));
      });
    }));

    const controller = new AbortController();
    const result = await run(taskHash, [[SalesType, salesOf(8000)]], {
      signal: controller.signal,
      onPartitionProgress: (progress) => {
        if (progress.state === 'started' && progress.index === 0) setTimeout(() => controller.abort(), 100);
      },
    });
    assert.equal(result.cancelled, true, result.error ?? '');
    assert.equal(result.state, 'error');
    assert.equal((await storage.refs.executionGetLatest(repo, taskHash, result.inputsHash))?.type, 'cancelled');
  });

  it('takes a slot of the jobs budget for each unit, and reports each unit\'s progress', async () => {
    const taskHash = await deploy(e3.streamTask('budgeted', {
      inputs: [e3.partition(sales)],
      output: e3.output.dict(IntegerType, IntegerType, { merge: (_$, _key, a, b) => a.add(b) }),
    }, ($, sales, emit) => {
      $.for(sales, ($, _amount, key) => {
        $(emit(key.remainder(10n), 1n));
      });
    }));

    const jobs = new JobSlots(2);
    const events: PartitionProgress[] = [];
    const result = await run(taskHash, [[SalesType, salesOf(8000)]], { jobs, onPartitionProgress: (progress) => events.push(progress) });
    assert.equal(result.state, 'success', result.error ?? '');
    assert.equal(jobs.peak, 2, 'the units ran two at a time');
    assert.equal(jobs.inFlight, 0);

    const pieces = events.filter((event) => event.phase === 'partition');
    const total = pieces[0]!.total;
    assert.ok(total > 4);
    assert.equal(pieces.filter((event) => event.state === 'started').length, total);
    assert.deepEqual(pieces.filter((event) => event.state === 'completed').map((event) => event.completed), Array.from({ length: total }, (_, i) => i + 1));
    assert.deepEqual(events.filter((event) => event.phase === 'merge').map((event) => event.state), ['started', 'completed']);
  });

  it('roots each stage\'s plan through its sidecar until the task ends, and a later run takes up the stage it names', async () => {
    const taskHash = await deploy(e3.streamTask('staged', {
      inputs: [e3.partition(sales)],
      output: e3.output.dict(IntegerType, IntegerType, { merge: (_$, _key, a, b) => a.add(b) }),
    }, ($, sales, emit) => {
      $.for(sales, ($, _amount, key) => {
        $(emit(key.remainder(97n), 1n));
      });
    }));
    const input = await datasetWrite(storage, repo, salesOf(8000), SalesType);
    const plans: string[] = [];
    const write = storage.refs.executionPlanWrite.bind(storage.refs);
    storage.refs.executionPlanWrite = (repoPath, task, inputs, plan) => {
      plans.push(plan);
      return write(repoPath, task, inputs, plan);
    };

    const first = await taskExecute(storage, repo, taskHash, [input]);
    assert.equal(first.state, 'success', first.error ?? '');
    assert.equal(plans.length, 3, 'the pieces\' plan, the merge level\'s, and the clear');
    assert.equal(plans[2], '');
    assert.equal(await storage.refs.executionPlanRead(repo, taskHash, first.inputsHash), null, 'an execution that ended roots no plan');
    const pieces = decodeUnitPlan(await storage.objects.read(repo, plans[0]!));
    const merges = decodeUnitPlan(await storage.objects.read(repo, plans[1]!));
    assert.deepEqual([pieces.task, pieces.inputs], [taskHash, first.inputsHash]);
    assert.equal(pieces.stage.type, 'pieces');
    assert.ok(pieces.stage.type === 'pieces' && pieces.stage.value.length > 4, 'the input was cut into many pieces');
    assert.ok(merges.stage.type === 'merge' && merges.stage.value.level === 1n && merges.stage.value.levels === 1n);

    // A run that stopped in its merges left the sidecar naming their plan:
    // the next run takes the merges up, and runs none of its units again.
    await write(repo, taskHash, first.inputsHash, plans[1]!);
    const task = decodeTaskObject(await storage.objects.read(repo, taskHash));
    const ran: string[][] = [];
    const events: PartitionProgress[] = [];
    const resumed = await executeSplitTask(storage, repo, taskHash, task, [input],
      { inHash: first.inputsHash, executionId: uuidv7(), startTime: Date.now() },
      { onPartitionProgress: (progress) => events.push(progress) },
      (unitInputs, ids, merge) => {
        ran.push(unitInputs);
        return taskExecuteBody(storage, repo, taskHash, task, unitInputs, ids, {}, merge);
      });
    assert.equal(resumed.state, 'success', resumed.error ?? '');
    assert.equal(resumed.outputHash, first.outputHash);
    assert.deepEqual(ran, [], 'every unit of the stage ran before');
    assert.deepEqual([...new Set(events.map((event) => event.phase))], ['merge'], 'the pieces were neither planned nor run again');
  });

  it('runs a task whose input fits in one piece as one unit, under the task\'s own identity', async () => {
    delete process.env.E3_TEST_PIECE_BYTES;
    const taskHash = await deploy(e3.streamTask('small', {
      inputs: [e3.partition(sales)],
      output: e3.output.dict(IntegerType, IntegerType),
    }, ($, sales, emit) => {
      $.for(sales, ($, amount, key) => {
        $(emit(key, amount));
      });
    }));

    const input = await datasetWrite(storage, repo, salesOf(8000), SalesType);
    const result = await taskExecute(storage, repo, taskHash, [input]);
    assert.equal(result.state, 'success', result.error ?? '');
    assert.equal(result.inputsHash, inputsHash([input]));
    assert.equal(result.outputHash, input, 'the one unit wrote the input back as it was');
    assert.deepEqual(await unitLines(taskHash, result), []);
  });
});
