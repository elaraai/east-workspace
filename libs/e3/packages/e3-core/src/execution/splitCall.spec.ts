/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Split calls (#1032): a caller's program over a dataset's pieces, run as a
 * split task on the engine and assembled by its output kind, then `then`.
 * `E3_TEST_PIECE_BYTES` makes the pieces small, so a few thousand rows are
 * many pieces; the units run on east-node.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  ArrayType, DictType, East, FunctionType, IntegerType, NullType, OptionType, SetType, SortedMap, SortedSet, StringType,
  compareFor, decodeBeast2For, encodeBeast2For, encodeEastIR, equalFor, none, printFor, some, variant,
  type EastType, type ValueTypeOf,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import type { ExecuteResult, PartitionProgress, SplitCallRequest } from '@elaraai/e3-types';
import { readManifest } from '../dataset-open.js';
import { PermissionDeniedError } from '../errors.js';
import { inputsHash } from '../executions.js';
import { packageImport } from '../package-files.js';
import { datasetWrite, workspaceSetDataset } from '../trees.js';
import { workspaceDeploy } from '../workspace-files.js';
import { createTempDir, createTestRepo, removeTempDir, removeTestRepo } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { TaskResult, TaskRunner } from './interfaces.js';
import { LocalTaskRunner } from './LocalTaskRunner.js';
import type { OneShotGrant } from './oneShot.js';
import { splitCallExplain, splitCallPrepare, splitCallResult, splitCallRun, type SplitCallOutcome } from './splitCall.js';

const WS = 'ws';
const SalesType = DictType(IntegerType, IntegerType);
const EventsType = ArrayType(IntegerType);
const RowsType = DictType(IntegerType, StringType);
const CountsType = DictType(IntegerType, IntegerType);
const EmitInteger = FunctionType([IntegerType], NullType);
const EmitEntry = FunctionType([IntegerType, IntegerType], NullType);

type Arg = SplitCallRequest['args'][number];

/** `n` rows keyed `0 … n-1`, each valued its key. */
function salesOf(n: number): SortedMap<bigint, bigint> {
  return new SortedMap(Array.from({ length: n }, (_, i) => [BigInt(i), BigInt(i)] as [bigint, bigint]), compareFor(IntegerType));
}

const ir = (fn: { toIR(): unknown }): Uint8Array => encodeEastIR(fn.toIR() as never);
const dataset = (name: string): Arg['arg'] => variant('dataset', [variant('field', 'inputs'), variant('field', name)]);
const partitioned = (arg: Arg['arg']): Arg => ({ arg, partition: some({ by: [] }) });
const whole = (arg: Arg['arg']): Arg => ({ arg, partition: none });

/** A call on east-node, given no platform package, with no `then`. */
function call(bodyIr: Uint8Array, args: Arg[], output: SplitCallRequest['output'], extra: Partial<SplitCallRequest> = {}): SplitCallRequest {
  return { bodyIr, args, output, then: none, runner: variant('east_node', { platforms: [], decode: variant('lazy', null) }), limits: none, ...extra };
}

/** Each sale's key modulo 97, counted, merged by adding. */
const countByRemainder = call(
  ir(East.function([SalesType, EmitEntry], NullType, ($, sales, emit) => {
    $.for(sales, ($, _amount, key) => {
      $(emit(key.remainder(97n), 1n));
    });
  })),
  [partitioned(dataset('sales'))],
  variant('dict', { merge: some(ir(East.function([IntegerType, IntegerType, IntegerType], IntegerType, ($, _key, a, b) => a.add(b)))) }),
);

/** The local runner, with every unit's progress heard. */
function tapped(inner: TaskRunner, heard: PartitionProgress[]): TaskRunner {
  return {
    execute: (storage, taskHash, inputHashes, options) => inner.execute(storage, taskHash, inputHashes, {
      ...options,
      onPartitionProgress: (progress) => {
        heard.push(progress);
        options?.onPartitionProgress?.(progress);
      },
    }),
    executeUnit: (storage, taskHash, unit, options) => inner.executeUnit(storage, taskHash, unit, options),
    executionAlive: (storage, taskHash, inHash, running) => inner.executionAlive(storage, taskHash, inHash, running),
    runDetached: (spec, options) => inner.runDetached(spec, options),
    wholeIntakeLimit: inner.wholeIntakeLimit,
    intake: (storage, spec, options) => inner.intake(storage, spec, options),
  };
}

describe('split calls', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  let runner: TaskRunner;
  let heard: PartitionProgress[];
  let pieceBytes: string | undefined;

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage();
    heard = [];
    runner = tapped(new LocalTaskRunner(repo), heard);
    pieceBytes = process.env.E3_TEST_PIECE_BYTES;
    // Pieces of 16 to 256 stored bytes: a piece a segment.
    process.env.E3_TEST_PIECE_BYTES = '64';

    const zip = join(tempDir, 'split.zip');
    await e3.export(e3.package('split', '1.0.0',
      e3.input('sales', SalesType),
      e3.input('events', EventsType),
      e3.input('rows', RowsType),
      e3.input('offset', IntegerType, variant('value', 1000n)),
      e3.input('unset', SalesType)), zip);
    await packageImport(storage, repo, zip);
    await workspaceDeploy(storage, repo, WS, 'split', '1.0.0');
    await set('sales', salesOf(8000), SalesType);
  });

  afterEach(() => {
    if (pieceBytes === undefined) delete process.env.E3_TEST_PIECE_BYTES;
    else process.env.E3_TEST_PIECE_BYTES = pieceBytes;
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** Sets an input of the workspace. */
  async function set(name: string, value: unknown, type: EastType): Promise<void> {
    await workspaceSetDataset(storage, repo, WS, [variant('field', 'inputs'), variant('field', name)], value, type);
  }

  /** Launches a call and runs its job, as its server would: its outcome, and
   *  its result as a poll answers it. */
  async function run(request: SplitCallRequest, grant: OneShotGrant = 'any'): Promise<{ outcome: SplitCallOutcome; result: ExecuteResult }> {
    const launched = await splitCallPrepare(storage, repo, WS, request, { grant });
    if ('outcome' in launched) {
      const diagnostics = launched.outcome.type === 'invalid' ? launched.outcome.value.diagnostics : [];
      assert.fail(`the call was refused: ${diagnostics.map((diagnostic) => diagnostic.message).join('; ')}`);
    }
    const outcome = await splitCallRun(storage, runner, repo, launched);
    return { outcome, result: await splitCallResult(storage, repo, outcome, launched.read, 64 * 1024 * 1024) };
  }

  /** Asserts a call succeeded with `value`, and assembled the output the value
   *  path writes for `assembled`. */
  async function assertValue<T extends EastType>(
    ran: { outcome: SplitCallOutcome; result: ExecuteResult },
    type: T,
    value: ValueTypeOf<T>,
    assembled?: { type: EastType; value: unknown },
  ): Promise<void> {
    const { outcome, result } = ran;
    if (result.outcome.type !== 'success') assert.fail(`the call ended ${result.outcome.type}: ${result.stderr}`);
    const got = decodeBeast2For(type)(result.outcome.value.value);
    assert.ok(equalFor(type)(got, value), `the value is ${printFor(type)(got)}`);
    if (assembled !== undefined) {
      assert.equal(outcome.output.type === 'some' && outcome.output.value, await datasetWrite(storage, repo, assembled.value, assembled.type),
        'the assembled output is the manifest the value path writes');
    }
  }

  /** How many pieces ran: the stage's total, as its first unit told it. */
  const pieces = (): number => heard.find((progress) => progress.phase === 'partition')?.total ?? 0;

  describe('gives what one unit over the whole dataset gives', () => {
    it('an array, its pieces concatenated in order', async () => {
      const events = Array.from({ length: 9000 }, (_, i) => BigInt((i * 7919) % 9000));
      await set('events', events, EventsType);
      const shifted = events.map((value) => value + 1n);
      const ran = await run(call(
        ir(East.function([EventsType, EmitInteger], NullType, ($, events, emit) => {
          $.for(events, ($, value) => {
            $(emit(value.add(1n)));
          });
        })),
        [partitioned(dataset('events'))],
        variant('array', null),
      ));
      await assertValue(ran, EventsType, shifted, { type: EventsType, value: shifted });
      assert.ok(pieces() > 4, `the input ran as many pieces, not ${pieces()}`);
    });

    it('a set, its pieces united', async () => {
      const ran = await run(call(
        ir(East.function([SalesType, EmitInteger], NullType, ($, sales, emit) => {
          $.for(sales, ($, _amount, key) => {
            $(emit(key.remainder(100n)));
          });
        })),
        [partitioned(dataset('sales'))],
        variant('set', null),
      ));
      const expected = new SortedSet(Array.from({ length: 100 }, (_, i) => BigInt(i)), compareFor(IntegerType));
      await assertValue(ran, SetType(IntegerType), expected, { type: SetType(IntegerType), value: expected });
      assert.ok(pieces() > 4);
    });

    it('a dict, its pieces\' equal keys folded with its merge', async () => {
      const expected = new SortedMap<bigint, bigint>([], compareFor(IntegerType));
      for (let i = 0n; i < 8000n; i++) expected.set(i % 97n, (expected.get(i % 97n) ?? 0n) + 1n);
      await assertValue(await run(countByRemainder), CountsType, expected, { type: CountsType, value: expected });
      assert.ok(pieces() > 4);
      assert.ok(heard.some((progress) => progress.phase === 'merge'), 'the pieces\' outputs overlap, so they merged');
    });

    it('a fold, its pieces\' partials combined from its zero', async () => {
      const ran = await run(call(
        ir(East.function([SalesType, EmitInteger], NullType, ($, sales, emit) => {
          $.for(sales, ($, amount) => {
            $(emit(amount));
          });
        })),
        [partitioned(dataset('sales'))],
        variant('fold', {
          combine: ir(East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b))),
          zero: encodeBeast2For(IntegerType)(0n),
        }),
      ));
      await assertValue(ran, IntegerType, (7999n * 8000n) / 2n);
      assert.ok(heard.some((progress) => progress.phase === 'combine'), 'the partials were combined');
    });
  });

  it('runs `then` over the assembled output, and then the arguments', async () => {
    const counted = await run({
      ...countByRemainder,
      then: some(ir(East.function([CountsType, SalesType], IntegerType, ($, counts, sales) =>
        counts.size().multiply(100_000n).add(sales.size())))),
    });
    await assertValue(counted, IntegerType, 97n * 100_000n + 8000n);
    assert.equal(counted.outcome.output.type, 'some', 'the result names the assembled output');
  });

  it('hands an argument it does not partition to every piece whole', async () => {
    const OffsetType = IntegerType;
    const ran = await run(call(
      ir(East.function([SalesType, OffsetType, EmitEntry], NullType, ($, sales, offset, emit) => {
        $.for(sales, ($, amount, key) => {
          $(emit(key, amount.add(offset)));
        });
      })),
      [partitioned(dataset('sales')), whole(dataset('offset'))],
      variant('dict', { merge: none }),
    ));
    const expected = new SortedMap(Array.from({ length: 8000 }, (_, i) => [BigInt(i), BigInt(i) + 1000n] as [bigint, bigint]), compareFor(IntegerType));
    await assertValue(ran, CountsType, expected);
    assert.ok(pieces() > 4, 'every one of many pieces had it');
  });

  it('takes an earlier call\'s output by its hash, which chains a plan\'s stages', async () => {
    const doubled = await run(call(
      ir(East.function([SalesType, EmitEntry], NullType, ($, sales, emit) => {
        $.for(sales, ($, amount, key) => {
          $(emit(key, amount.multiply(2n)));
        });
      })),
      [partitioned(dataset('sales'))],
      variant('dict', { merge: none }),
    ));
    if (doubled.outcome.output.type !== 'some') assert.fail('the first call assembled no output');
    const total = await run(call(
      ir(East.function([CountsType, EmitInteger], NullType, ($, doubledSales, emit) => {
        $.for(doubledSales, ($, amount) => {
          $(emit(amount));
        });
      })),
      [partitioned(variant('object', doubled.outcome.output.value))],
      variant('fold', {
        combine: ir(East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b))),
        zero: encodeBeast2For(IntegerType)(0n),
      }),
    ));
    await assertValue(total, IntegerType, 7999n * 8000n);
  });

  describe('leaves what an object argument names to its job', () => {
    /** A call summing the values of the collection an object argument names. */
    const summing = (hash: string): SplitCallRequest => call(
      ir(East.function([SalesType, EmitInteger], NullType, ($, sales, emit) => {
        $.for(sales, ($, amount) => {
          $(emit(amount));
        });
      })),
      [partitioned(variant('object', hash))],
      variant('fold', {
        combine: ir(East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => a.add(b))),
        zero: encodeBeast2For(IntegerType)(0n),
      }),
    );

    /** A collection of many segments nothing names, and its segments. */
    async function unnamed(): Promise<{ hash: string; segments: string[] }> {
      const hash = await datasetWrite(storage, repo, salesOf(8000), SalesType);
      const manifest = await readManifest(storage, repo, hash);
      if (manifest === null) assert.fail('the collection was stored whole');
      assert.ok(manifest.entries.length > 4, `a collection of many segments, not ${manifest.entries.length}`);
      return { hash, segments: manifest.entries.map((entry) => entry.hash) };
    }

    it('launches reading none of its segments, and re-references every one before the job\'s first unit', async () => {
      const { hash, segments } = await unnamed();
      // Every hash the object store is asked about
      const objects = storage.objects;
      const [exists, read, readRange, touch] = [objects.exists, objects.read, objects.readRange, objects.touch];
      const asked: string[] = [];
      objects.exists = (at, object) => {
        asked.push(object);
        return exists.call(objects, at, object);
      };
      objects.read = (at, object) => {
        asked.push(object);
        return read.call(objects, at, object);
      };
      objects.readRange = (at, object, offset, length) => {
        asked.push(object);
        return readRange.call(objects, at, object, offset, length);
      };
      objects.touch = (at, hashes) => {
        asked.push(...hashes);
        return touch.call(objects, at, hashes);
      };
      try {
        const launched = await splitCallPrepare(storage, repo, WS, summing(hash), { grant: 'any' });
        if ('outcome' in launched) assert.fail('the call was refused');
        assert.ok(asked.includes(hash), 'the launch found the argument\'s own object');
        assert.deepEqual(segments.filter((segment) => asked.includes(segment)), [], 'and asked about none of its segments');

        asked.length = 0;
        const first: { asked: string[] | null } = { asked: null };
        const watched: TaskRunner = {
          ...runner,
          execute: (at, task, inputs, options) => {
            first.asked ??= [...asked];
            return runner.execute(at, task, inputs, options);
          },
        };
        const outcome = await splitCallRun(storage, watched, repo, launched);
        assert.equal(outcome.outcome.type, 'success');
        const before = new Set<string>(first.asked ?? []);
        assert.deepEqual(segments.filter((segment) => !before.has(segment)), [], 'every segment was touched before the first unit');
      } finally {
        Object.assign(objects, { exists, read, readRange, touch });
      }
    });

    it('ends the job invalid, naming the argument, once the store no longer holds what it names, and runs nothing', async () => {
      const { hash, segments } = await unnamed();
      const launched = await splitCallPrepare(storage, repo, WS, summing(hash), { grant: 'any' });
      if ('outcome' in launched) assert.fail('the call was refused');
      // A segment gone between the launch and the job
      await storage.repos.gcDeleteObjects(repo, [segments[1]!]);

      const outcome = await splitCallRun(storage, runner, repo, launched);
      if (outcome.outcome.type !== 'invalid') assert.fail(`the job ended ${outcome.outcome.type}`);
      assert.match(outcome.outcome.value.diagnostics[0]!.message, new RegExp(`^Object argument 0 names ${hash}, which the repository does not hold whole$`));
      assert.deepEqual(heard, [], 'no unit ran');
    });
  });

  it('serves a relaunch from the cache, and reruns only the pieces an append touches', async () => {
    const lengths = call(
      ir(East.function([RowsType, EmitEntry], NullType, ($, rows, emit) => {
        $.for(rows, ($, text, key) => {
          $(emit(key, text.length()));
        });
      })),
      [partitioned(dataset('rows'))],
      variant('dict', { merge: none }),
    );
    const before = new SortedMap<bigint, string>(
      Array.from({ length: 8000 }, (_, i) => [BigInt(2 * i), `row-${2 * i}`] as [bigint, string]), compareFor(IntegerType));
    await set('rows', before, RowsType);
    const first = await run(lengths);
    assert.equal(first.result.outcome.type, 'success', first.result.stderr);
    assert.ok(pieces() > 4);

    heard.length = 0;
    const again = await run(lengths);
    assert.equal(heard.length, 0, 'no unit ran: the task was served whole from the cache');
    assert.ok(first.outcome.output.type === 'some' && equalFor(OptionType(StringType))(again.outcome.output, first.outcome.output),
      'and assembled the same output');

    const after = new SortedMap<bigint, string>([...before], compareFor(IntegerType));
    for (let key = 8001n; key < 8041n; key += 2n) after.set(key, `row-${key}`);
    await set('rows', after, RowsType);
    heard.length = 0;
    const appended = await run(lengths);
    assert.equal(appended.result.outcome.type, 'success', appended.result.stderr);
    const settled = heard.filter((progress) => progress.phase === 'partition' && progress.state === 'completed');
    const ran = settled.filter((progress) => progress.cached !== true);
    assert.ok(settled.length > 4, 'the input is many pieces');
    assert.ok(ran.length >= 1 && ran.length <= 3, `only the pieces around the append ran: ${ran.length} of ${settled.length}`);
  });

  it('explains the pieces the run cuts in the job, leaving the launch — an explain\'s request — to store none, and runs no unit', async () => {
    // Every object written, and how many of them are manifests: a piece is one.
    const objects = storage.objects;
    const write = objects.write.bind(objects);
    const written: string[] = [];
    objects.write = async (at: string, data: Uint8Array): Promise<string> => {
      const hash = await write(at, data);
      written.push(hash);
      return hash;
    };
    const manifests = async (): Promise<number> =>
      (await Promise.all(written.map((hash) => readManifest(storage, repo, hash)))).filter((manifest) => manifest !== null).length;

    const launched = await splitCallPrepare(storage, repo, WS, countByRemainder, { grant: 'any' });
    if ('outcome' in launched) assert.fail('the call was refused');
    assert.equal(await manifests(), 0, 'the launch stored no piece');

    const plan = await splitCallExplain(storage, repo, launched);
    objects.write = write;
    assert.equal(plan.over, 0n, 'cut over its one partitioned argument');
    assert.ok(plan.bytes > 0n);
    assert.ok(plan.pieces > 4n, `the input is many pieces, not ${plan.pieces}`);
    assert.ok(await manifests() >= Number(plan.pieces), 'the explain\'s job stored every piece');
    assert.deepEqual(await storage.refs.executionList(repo), [], 'nothing ran');

    await run(countByRemainder);
    assert.equal(BigInt(pieces()), plan.pieces, 'as many pieces as the run cut');
  });

  it('refuses a reader\'s call a program of which, or whose runner, reaches a platform', async () => {
    const log = East.platform('e3_test_log', [StringType], NullType);
    const logged = ir(East.function([IntegerType, IntegerType, IntegerType], IntegerType, ($, _key, a, b) => {
      const message = $.const('merging');
      $(log(message));
      return a.add(b);
    }));
    const refused: [string, SplitCallRequest][] = [
      ['its body', call(ir(East.function([SalesType, EmitEntry], NullType, ($, sales, emit) => {
        const message = $.const('piece');
        $(log(message));
        $.for(sales, ($, amount, key) => {
          $(emit(key, amount));
        });
      })), [partitioned(dataset('sales'))], variant('dict', { merge: none }))],
      ['its then', { ...countByRemainder, then: some(ir(East.function([CountsType, SalesType], IntegerType, ($, counts) => {
        const message = $.const('then');
        $(log(message));
        return counts.size();
      }))) }],
      ['its merge', { ...countByRemainder, output: variant('dict', { merge: some(logged) }) }],
      ['its combine', call(countByRemainder.bodyIr, countByRemainder.args, variant('fold', { combine: logged, zero: encodeBeast2For(IntegerType)(0n) }))],
      ['its runner', { ...countByRemainder, runner: variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) }) }],
    ];
    for (const [what, request] of refused) {
      await assert.rejects(splitCallPrepare(storage, repo, WS, request, { grant: 'platform_free' }),
        (err: unknown) => err instanceof PermissionDeniedError && err.path === 'one-shot', what);
    }
    await assert.rejects(splitCallPrepare(storage, repo, WS, countByRemainder, { grant: 'none' }), PermissionDeniedError);
    assert.ok(!('outcome' in await splitCallPrepare(storage, repo, WS, countByRemainder, { grant: 'platform_free' })),
      'a platform-free call is launched');
  });

  it('answers invalid for a call it cannot run, and runs nothing', async () => {
    const invalid: [string, SplitCallRequest, RegExp][] = [
      ['no argument partitioned', { ...countByRemainder, args: [whole(dataset('sales'))] }, /partitions at least one/],
      ['a custom runner', { ...countByRemainder, runner: variant('custom', { command: ['sh'] }) }, /stock runner/],
      ['a partitioned scalar', { ...countByRemainder, args: [partitioned(dataset('offset'))] }, /not a collection/],
      ['an unassigned dataset', { ...countByRemainder, args: [partitioned(dataset('unset'))] }, /not assigned/],
      ['an object the store does not hold', { ...countByRemainder, args: [partitioned(variant('object', '0'.repeat(64)))] }, /does not hold/],
    ];
    for (const [what, request, message] of invalid) {
      const launched = await splitCallPrepare(storage, repo, WS, request, { grant: 'any' });
      if (!('outcome' in launched) || launched.outcome.type !== 'invalid') assert.fail(`${what}: launched`);
      assert.match(launched.outcome.value.diagnostics[0]!.message, message, what);
    }
    assert.deepEqual(await storage.refs.executionList(repo), []);
  });

  it('ends the job timed_out once its timeout passes', async () => {
    const spinning = call(
      ir(East.function([SalesType, EmitInteger], NullType, ($, _sales, emit) => {
        $(emit(1n));
        const turns = $.let(0n);
        $.while(true, ($) => {
          $.assign(turns, turns.add(1n));
        });
      })),
      [partitioned(dataset('sales'))],
      variant('set', null),
      { limits: some({ timeoutMs: some(1_500n), maxResultBytes: none, maxLogBytes: none }) },
    );
    // The program never ends on its own: only its timeout ends the job
    const ran = await run(spinning);
    assert.equal(ran.outcome.outcome.type, 'timed_out');
    assert.equal(ran.result.outcome.type, 'timed_out');
    // What the task recorded is cancelled, not its own failure.
    const task = await splitCallPrepare(storage, repo, WS, spinning, { grant: 'any' });
    if ('outcome' in task) assert.fail('refused');
    assert.equal((await storage.refs.executionGetLatest(repo, task.task, inputsHash([...task.inputs])))?.type, 'cancelled');
  });

  it('counts the job\'s timeout from its launch, so a job handed over gets what is left of it, never a fresh one', async (t) => {
    const launched = await splitCallPrepare(storage, repo, WS, {
      ...countByRemainder,
      limits: some({ timeoutMs: some(4_000n), maxResultBytes: none, maxLogBytes: none }),
    }, { grant: 'any' });
    if ('outcome' in launched) assert.fail('refused');
    const launchedAt = new Date();
    /** The clock of a run `ms` into the job. */
    const at = (ms: number) => (): number => launchedAt.getTime() + ms;
    // A runner that runs nothing, so a run arms its deadline and returns
    let units = 0;
    const failed: TaskResult = { state: 'failed', cached: false, executionId: '', exitCode: 1 };
    const idle: TaskRunner = {
      ...runner,
      execute: () => {
        units++;
        return Promise.resolve(failed);
      },
    };
    const armed = t.mock.method(globalThis, 'setTimeout');

    // A run its caller stops at 2 s, as compute with a time limit stops at its
    // deadline, hands over; the run that goes on at 3 s gets the 1 s left.
    const stop = new AbortController();
    stop.abort();
    await assert.rejects(splitCallRun(storage, idle, repo, launched, { signal: stop.signal, launchedAt, now: at(2_000) }));
    await splitCallRun(storage, idle, repo, launched, { launchedAt, now: at(3_000) });
    assert.deepEqual(armed.mock.calls.map((armedAt) => armedAt.arguments[1]), [2_000, 1_000], 'each run armed what was left of the job\'s timeout');

    // One that starts with nothing left ends timed_out, running no unit.
    const late = await splitCallRun(storage, idle, repo, launched, { launchedAt, now: at(4_000) });
    assert.equal(late.outcome.type, 'timed_out');
    assert.equal(units, 2, 'the run with nothing left ran no unit');
  });

  it('keeps the last maxLogBytes of a failed task\'s error, cut and read back as Node\'s own UTF-8 reads them', async () => {
    const launched = await splitCallPrepare(storage, repo, WS, countByRemainder, { grant: 'any' });
    if ('outcome' in launched) assert.fail('refused');
    // Characters of one to four bytes, a byte order mark, and a lone surrogate,
    // which UTF-8 writes as U+FFFD: every cut below lands before, inside or
    // after one of them.
    const error = 'fail: ünïcødé ☃ ﻿mark 😀 lone \uD800 end';
    const failing: TaskRunner = {
      ...runner,
      execute: () => Promise.resolve({ state: 'failed', cached: false, executionId: '', exitCode: 1, error }),
    };
    /** The tail as the Buffer this replaced cut it. */
    const nodeTail = (limit: number): { text: string; truncated: boolean } => {
      const bytes = Buffer.from(error, 'utf-8');
      return bytes.length <= limit
        ? { text: error, truncated: false }
        : { text: bytes.subarray(bytes.length - limit).toString('utf-8'), truncated: true };
    };
    const byteLength = Buffer.byteLength(error, 'utf-8');
    for (let limit = 0; limit <= byteLength + 1; limit++) {
      const outcome = await splitCallRun(storage, failing, repo, { ...launched, limits: { ...launched.limits, maxLogBytes: limit } });
      assert.equal(outcome.outcome.type, 'failed');
      assert.deepEqual({ text: outcome.stderr, truncated: outcome.stderrTruncated }, nodeTail(limit), `the last ${limit} bytes`);
    }
  });
});
