/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `WebTaskRunner`'s cases: what it does, whichever workers its units run on.
 *
 * A case is a plain function over a setup, asserting with `./assert.js`, as
 * the adapters' contract is, so it runs where its workers are: in Node over the
 * in-process workers and the adapters in memory, and in a Chromium page over
 * Web Workers, IndexedDB, OPFS and Web Locks, where the page runs it by name.
 *
 * The tasks a case runs are the fixture package's (`runner-fixtures.ts`),
 * which e3's SDK authored and `e3.export` wrote, handed to the setup as data:
 * its objects and its package ref, installed in the case's repository. The
 * programs a call runs are written here, in East.
 *
 * @packageDocumentation
 */

import {
  ArrayType,
  DictType,
  East,
  FunctionType,
  IntegerType,
  NullType,
  SetType,
  SortedMap,
  SortedSet,
  StringType,
  compareFor,
  decodeBeast2For,
  encodeBeast2For,
  encodeBeast2PagedFor,
  encodeEastIR,
  equalFor,
  none,
  printFor,
  some,
  toEastTypeValue,
  variant,
  type AsyncEastIR,
  type EastIR,
  type EastType,
  type ValueTypeOf,
} from '@elaraai/east';
import {
  ExecutionOwnerType,
  decodeTaskObject,
  manifestByteSize,
  manifestElementCount,
  type ExecutionOwner,
  type ExecutionStatus,
  type OneShotRequest,
  type RunnerValue,
  type SplitCallRequest,
  type TreePath,
} from '@elaraai/e3-types';
import {
  ExecutionAttempt,
  datasetWrite,
  inputsHash,
  intakeDelivery,
  mergeTreeGroups,
  mergeTreeLevels,
  oneShotExecute,
  packageRead,
  pieceSizes,
  planPieces,
  readDatasetWhole,
  readManifest,
  readRecordState,
  readTestPieceBytesFrom,
  recordIndexNames,
  recordMutate,
  splitCallPrepare,
  splitCallRun,
  uuidv7,
  workspaceCreate,
  workspaceDeploy,
  workspaceSetDataset,
  type DetachedSpec,
  type ObjectStore,
  type RunningExecution,
  type StorageBackend,
  type TaskResult,
} from '@elaraai/e3-core/portable';
import { Console } from '@elaraai/east-web-std';
import {
  DEFAULT_WHOLE_INTAKE_LIMIT,
  NO_COMMANDS,
  WEB_RUNNER,
  WebTaskRunner,
  type WebTaskRunnerOptions,
} from '../execution/WebTaskRunner.js';
import { UnitPool } from '../execution/pool.js';
import type { UnitWorker } from '../execution/protocol.js';
import type { LocksAdapter } from '../storage/adapters.js';
import type { WebStorage } from '../storage/WebStorage.js';
import type { AdapterCase, AdapterSetup } from './adapter-contract.js';
import { AssertionError, deepEqual, equal, ok, rejects } from './assert.js';
import { TEST_PLATFORM, test_exit, test_host_echo, test_wait, testHost, type TestHost } from './test-platform.js';

// =============================================================================
// The fixtures
// =============================================================================

/** The fixture package's name and version. */
export const FIXTURE_PACKAGE = 'web_runner';
export const FIXTURE_VERSION = '1.0.0';

/**
 * The fixture package as data: every object `e3.export` wrote for it, by its
 * hash, and the package object's hash its ref names.
 */
export interface RunnerFixtures {
  readonly objects: ReadonlyArray<readonly [hash: string, bytes: Uint8Array]>;
  readonly packageHash: string;
}

/**
 * The fixtures as a page is handed them: each object's bytes as base64, which
 * a call into a page carries.
 */
export interface RunnerFixturesWire {
  readonly objects: ReadonlyArray<readonly [hash: string, base64: string]>;
  readonly packageHash: string;
}

/** Bytes as base64, a chunk of characters at a time. */
function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(text);
}

/** Base64 as its bytes. */
function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

/**
 * The fixtures as a page is handed them.
 *
 * @param fixtures - The fixtures
 * @returns Their wire form
 */
export function fixturesToWire(fixtures: RunnerFixtures): RunnerFixturesWire {
  return { objects: fixtures.objects.map(([hash, bytes]) => [hash, toBase64(bytes)] as const), packageHash: fixtures.packageHash };
}

/**
 * The fixtures a page was handed.
 *
 * @param wire - Their wire form
 * @returns The fixtures
 */
export function fixturesFromWire(wire: RunnerFixturesWire): RunnerFixtures {
  return { objects: wire.objects.map(([hash, text]) => [hash, fromBase64(text)] as const), packageHash: wire.packageHash };
}

// =============================================================================
// Setups
// =============================================================================

/** The repository a case runs in. */
const REPO = 'default';

/** The workspace a case deploys the fixture package to. */
const WORKSPACE = 'main';

/**
 * What a runner case runs over: a repository with the fixture package
 * installed, and the workers a runner's pool starts.
 */
export interface RunnerSetup {
  /** The storage, a tab's */
  readonly storage: WebStorage;
  /** The repository, with the fixture package installed */
  readonly repo: string;
  /** The host the setup's pools hand each worker's port to, which answers a
   *  unit's echo and holds its wait until released */
  readonly host: TestHost;
  /**
   * A pool of the setup's workers — in process in Node, Web Workers in a page
   * — handed the host's ports, terminated once the case ends.
   *
   * @param options - Its width, four unless given, and what wraps each worker
   *   the setup starts
   */
  pool(options?: { width?: number; units?: (start: () => UnitWorker) => UnitWorker }): UnitPool;
  /** A runner over a pool, owned by the tab's session */
  runner(pool: UnitPool, options?: Partial<WebTaskRunnerOptions>): WebTaskRunner;
  /** Opens another tab's session over the storage's origin, closed once the
   *  case ends */
  openSession(): Promise<LocksAdapter>;
  /** Sets the piece size planning reads, as `E3_TEST_PIECE_BYTES` does, until
   *  the case ends */
  pieceBytes(bytes: number): void;
}

/**
 * What a setup is made of where it runs: the storage of a tab, and its
 * workers.
 */
export interface RunnerEnvironment {
  /** Opens a tab's storage, fresh, registering what removes it */
  openStorage(cleanup: (undo: () => Promise<void> | void) => void): Promise<{ storage: WebStorage; openSession: () => Promise<LocksAdapter> }>;
  /** Starts a unit worker that serves the specs' platform package beside the
   *  standard one */
  readonly units: () => UnitWorker;
  /** The fixture package */
  readonly fixtures: RunnerFixtures;
}

/**
 * Installs the fixture package in a repository: its objects, and its ref.
 *
 * @param storage - The storage
 * @param repo - The repository
 * @param fixtures - The fixture package
 * @throws {Error} When an object is not the bytes its hash names.
 */
async function installFixtures(storage: WebStorage, repo: string, fixtures: RunnerFixtures): Promise<void> {
  for (const [hash, bytes] of fixtures.objects) {
    const stored = await storage.objects.write(repo, bytes);
    if (stored !== hash) throw new Error(`the fixture object ${hash} holds bytes whose hash is ${stored}`);
  }
  await storage.refs.packageWrite(repo, FIXTURE_PACKAGE, FIXTURE_VERSION, fixtures.packageHash);
}

/**
 * Makes the setup a runner case runs over, from what a setup is made of where
 * it runs.
 *
 * @param environment - The tab's storage, its workers, and the fixtures
 * @returns The setup
 */
export function runnerSetup(environment: RunnerEnvironment): AdapterSetup<RunnerSetup> {
  return async (cleanup) => {
    const { storage, openSession } = await environment.openStorage(cleanup);
    await storage.repos.create(REPO);
    await installFixtures(storage, REPO, environment.fixtures);
    const host = testHost();
    cleanup(() => host.close());
    // Pieces are planned at the platform's sizes unless a case sets its own.
    let pieceBytes: string | undefined;
    readTestPieceBytesFrom(() => pieceBytes);
    cleanup(() => {
      pieceBytes = undefined;
    });
    return {
      storage,
      repo: REPO,
      host,
      pool: (options = {}) => {
        const start = environment.units;
        const wrap = options.units;
        const pool = new UnitPool({
          units: wrap === undefined ? start : () => wrap(start),
          width: options.width ?? 4,
          connect: host.connect,
        });
        cleanup(() => pool.close());
        return pool;
      },
      runner: (pool, options = {}) => new WebTaskRunner({ repo: REPO, pool, locks: storage.adapters.locks, ...options }),
      openSession: async () => {
        const session = await openSession();
        cleanup(() => session.close());
        return session;
      },
      pieceBytes: (bytes) => {
        pieceBytes = `${bytes}`;
      },
    };
  };
}

// =============================================================================
// Helpers
// =============================================================================

const WordsType = ArrayType(StringType);
const EventsType = ArrayType(IntegerType);
const SalesType = DictType(IntegerType, IntegerType);
const CountsType = DictType(StringType, IntegerType);
const IntDictType = DictType(IntegerType, IntegerType);

/** A stock runner with east-node-std, as a task's default is. */
const STANDARD: RunnerValue = variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) });
/** A stock runner with the specs' own package beside east-node-std's. */
const WITH_TEST: RunnerValue = variant('east_node', { platforms: ['@elaraai/east-node-std', TEST_PLATFORM], decode: variant('lazy', null) });
/** A stock runner given no platform package. */
const PLATFORM_FREE: RunnerValue = variant('east_node', { platforms: [], decode: variant('lazy', null) });

/** The limits a call runs under unless a case sets its own. */
const LIMITS = { timeoutMs: 60_000, maxResultBytes: 1024 * 1024, maxLogBytes: 64 * 1024 };

const encodeInteger = encodeBeast2For(IntegerType);
const decodeInteger = decodeBeast2For(IntegerType);
const encodeString = encodeBeast2For(StringType);
const decodeString = decodeBeast2For(StringType);
const utf8 = new TextEncoder();

/** The path of an input of the fixture package. */
function inputPath(name: string): TreePath {
  return [variant('field', 'inputs'), variant('field', name)];
}

/**
 * Asserts two East values of a type are equal, as East compares them.
 *
 * @throws {AssertionError} When they are not
 */
function same<T extends EastType>(type: T, actual: ValueTypeOf<T>, expected: ValueTypeOf<T>, message: string): void {
  if (!equalFor(type)(actual, expected)) {
    const print = printFor(type);
    throw new AssertionError(`${message}: expected ${print(expected)}, found ${print(actual)}`);
  }
}

/** The hash of a fixture task. */
async function taskHashOf(setup: RunnerSetup, name: string): Promise<string> {
  const pkg = await packageRead(setup.storage, setup.repo, FIXTURE_PACKAGE, FIXTURE_VERSION);
  const hash = pkg.tasks.get(name);
  if (hash === undefined) throw new Error(`the fixture package has no task '${name}'`);
  return hash;
}

/** Writes values as datasets, and answers their hashes. */
async function datasets(setup: RunnerSetup, values: ReadonlyArray<readonly [EastType, unknown]>): Promise<string[]> {
  const hashes: string[] = [];
  for (const [type, value] of values) hashes.push(await datasetWrite(setup.storage, setup.repo, value, type));
  return hashes;
}

/** One stream of an execution's log, whole. */
async function logOf(setup: RunnerSetup, taskHash: string, inputs: readonly string[], result: TaskResult, stream: 'stdout' | 'stderr'): Promise<string> {
  return (await setup.storage.logs.read(setup.repo, taskHash, inputsHash([...inputs]), result.executionId, stream, { offset: 0, limit: 1 << 24 })).data;
}

/** An execution's record. */
function recordOf(setup: RunnerSetup, taskHash: string, inputs: readonly string[], executionId: string): Promise<ExecutionStatus | null> {
  return setup.storage.refs.executionGet(setup.repo, taskHash, inputsHash([...inputs]), executionId);
}

/** An execution's owner. */
function ownerOf(setup: RunnerSetup, taskHash: string, inputs: readonly string[], executionId: string): Promise<ExecutionOwner | null> {
  return setup.storage.refs.executionOwnerRead(setup.repo, taskHash, inputsHash([...inputs]), executionId);
}

/**
 * Records an attempt of a task over inputs running, owned as given, as a
 * runner records one, and answers its record.
 */
async function runningAs(setup: RunnerSetup, taskHash: string, inputHashes: string[], owner: ExecutionOwner | null): Promise<RunningExecution> {
  const ids = { inHash: inputsHash(inputHashes), executionId: uuidv7(), startTime: Date.now() };
  const attempt = new ExecutionAttempt(setup.storage, setup.repo, taskHash, inputHashes, ids, false);
  const startedAt = new Date();
  await attempt.recordOwner(owner, startedAt);
  await attempt.recordRunning(owner ?? { pid: 0n, pidStartTime: 0n, bootId: '' }, startedAt);
  const record = await recordOf(setup, taskHash, inputHashes, ids.executionId);
  if (record?.type !== 'running') throw new AssertionError(`the attempt is recorded ${record?.type}, not running`);
  return record.value;
}

/** Waits until `holds` does, checking every few milliseconds. */
async function until(what: string, holds: () => boolean | Promise<boolean>, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await holds())) {
    if (Date.now() > deadline) throw new AssertionError(`waited ${ms / 1000} s for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** What a promise settles to, or a failure naming what was awaited once it
 *  has not settled in time: a run that ignores what should end it fails its
 *  case, rather than holding it. */
async function settled<T>(what: string, promise: Promise<T>, ms = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new AssertionError(`waited ${ms / 1000} s for ${what}`)), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** A program's IR bundle, as a call is given it. */
function ir(fn: { toIR(): EastIR<any[], any> | AsyncEastIR<any[], any> }): Uint8Array {
  return encodeEastIR(fn.toIR());
}

/** A detached call of a program over values, on a runner, under limits. */
function call(
  fn: { toIR(): EastIR<any[], any> | AsyncEastIR<any[], any> },
  args: DetachedSpec['args'],
  runner: RunnerValue = PLATFORM_FREE,
  limits: Partial<DetachedSpec['limits']> = {},
): DetachedSpec {
  return { bodyIr: ir(fn), args, runner, limits: { ...LIMITS, ...limits } };
}

/** Creates the case's workspace and deploys the fixture package to it, its
 *  records' indexes built on the runner. */
async function deploy(setup: RunnerSetup, runner: WebTaskRunner): Promise<void> {
  await workspaceCreate(setup.storage, setup.repo, WORKSPACE);
  await workspaceDeploy(setup.storage, setup.repo, WORKSPACE, FIXTURE_PACKAGE, FIXTURE_VERSION, { runner });
}

/**
 * Wraps the workers a pool starts to count their starts and their
 * terminations, handing everything else through.
 */
function counting(counts: { started: number; terminated: number }): (start: () => UnitWorker) => UnitWorker {
  return (start) => {
    const worker = start();
    counts.started++;
    return {
      postMessage: (message, transfer) => worker.postMessage(message, transfer),
      get onmessage() {
        return worker.onmessage;
      },
      set onmessage(handler) {
        worker.onmessage = handler;
      },
      get onerror() {
        return worker.onerror;
      },
      set onerror(handler) {
        worker.onerror = handler;
      },
      terminate: () => {
        counts.terminated++;
        worker.terminate();
      },
    };
  };
}

/**
 * The storage, its object store telling `heard` of each object read whole:
 * what shows a delivery staged by ranges, never whole.
 */
function readsWhole(storage: WebStorage, heard: (hash: string) => void): StorageBackend {
  const objects = new Proxy(storage.objects, {
    get(target, property): unknown {
      if (property === 'read') {
        return (repo: string, hash: string) => {
          heard(hash);
          return target.read(repo, hash);
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) satisfies ObjectStore;
  return { ...storage, objects, validateRepository: (repo) => storage.validateRepository(repo) };
}

/** How many of a split task's pieces' rows fall at each key's remainder of
 *  97, as `split_counts` counts them: the rows decoded from each piece. */
async function countedByRemainder(setup: RunnerSetup, pieces: readonly string[]): Promise<SortedMap<bigint, bigint>> {
  const counts = new SortedMap<bigint, bigint>([], compareFor(IntegerType));
  for (const piece of pieces) {
    for (const [key] of decodeBeast2For(SalesType)(await readDatasetWhole(setup.storage, setup.repo, piece))) {
      const remainder = key % 97n;
      counts.set(remainder, (counts.get(remainder) ?? 0n) + 1n);
    }
  }
  return counts;
}

/** `n` rows keyed `0 … n-1`, each valued its key. */
function salesOf(n: number): SortedMap<bigint, bigint> {
  return new SortedMap(Array.from({ length: n }, (_, i) => [BigInt(i), BigInt(i)] as [bigint, bigint]), compareFor(IntegerType));
}

/** How many of `0 … n-1` fall at each remainder of `by`, as a task that
 *  counts them by remainder counts them. */
function remainders(n: number, by: number): SortedMap<bigint, bigint> {
  const counts = new SortedMap<bigint, bigint>([], compareFor(IntegerType));
  for (let i = 0; i < n; i++) {
    const key = BigInt(i % by);
    counts.set(key, (counts.get(key) ?? 0n) + 1n);
  }
  return counts;
}

// =============================================================================
// The programs a call runs
// =============================================================================

/** `x × 2`. */
const double = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));

/** Each element doubled: a collection the call returns. */
const doubleEach = East.function([EventsType], EventsType, ($, xs) => xs.map(($, x) => x.multiply(2n)));

/** The numbers `0 … n-1` written one after another: a String that does not
 *  compress to nothing. */
const digits = East.function([IntegerType], StringType, ($, n) => {
  const out = $.let('');
  const i = $.let(0n);
  $.while(East.less(i, n), ($) => {
    $.assign(out, East.str`${out}${i}`);
    $.assign(i, i.add(1n));
  });
  return out;
});

/** Writes a line to stdout for each number below `n`, then `done` to stderr. */
const lines = East.function([IntegerType], IntegerType, ($, n) => {
  const i = $.let(0n);
  $.while(East.less(i, n), ($) => {
    $(Console.log(East.str`line ${i}`));
    $.assign(i, i.add(1n));
  });
  $(Console.error('done'));
  return n;
});

/** Refuses whatever it is given. */
const refusing = East.function([IntegerType], IntegerType, ($, n) => $.error(East.str`refused ${n}`));

/** Waits for its host to say it may go on: until its time runs out, or its
 *  host releases it. */
const waiting = East.asyncFunction([], NullType, ($) => {
  $(test_wait());
});

/** Its text, echoed by its host through the port its worker was handed. */
const echoing = East.asyncFunction([StringType], StringType, ($, text) => test_host_echo(text));

/** Closes its own worker, as a worker closes itself, and never returns. */
const exiting = East.asyncFunction([], NullType, ($) => {
  $(test_exit());
});

/** How many words. */
const countWords = East.function([WordsType], IntegerType, ($, words) => words.size());

/** Counts for ever, never yielding its thread. */
const runaway = East.function([], IntegerType, ($) => {
  const i = $.let(0n);
  $.while(true, ($) => {
    $.assign(i, i.add(1n));
  });
  return i;
});

// =============================================================================
// The cases
// =============================================================================

/**
 * The runner's cases.
 */
export const runnerCases: readonly AdapterCase<RunnerSetup>[] = [
  {
    name: 'runs a task of every output kind, owned by the tab\'s session, storing each output as the value path writes it',
    run: async (setup) => {
      const runner = setup.runner(setup.pool());
      const events = Array.from({ length: 2500 }, (_, i) => BigInt(i));
      const cases: Array<{ task: string; inputs: Array<readonly [EastType, unknown]>; type: EastType; value: unknown }> = [
        {
          task: 'lengths', inputs: [[WordsType, ['pear', 'fig', 'apple']]], type: CountsType,
          value: new SortedMap([['apple', 5n], ['fig', 3n], ['pear', 4n]], compareFor(StringType)),
        },
        { task: 'count', inputs: [[WordsType, ['pear', 'fig', 'apple']]], type: IntegerType, value: 3n },
        { task: 'sums', inputs: [[EventsType, events]], type: EventsType, value: events.map((_, i) => (BigInt(i) * BigInt(i + 1)) / 2n) },
        { task: 'distinct', inputs: [[EventsType, events]], type: SetType(IntegerType), value: new SortedSet([0n, 1n, 2n, 3n, 4n], compareFor(IntegerType)) },
        {
          task: 'doubled', inputs: [[SalesType, salesOf(300)]], type: IntDictType,
          value: new SortedMap([...salesOf(300)].map(([key, amount]) => [key, amount * 2n] as [bigint, bigint]), compareFor(IntegerType)),
        },
        { task: 'total', inputs: [[EventsType, events]], type: IntegerType, value: (2499n * 2500n) / 2n },
        { task: 'nothing', inputs: [], type: IntDictType, value: new SortedMap([], compareFor(IntegerType)) },
      ];
      for (const { task, inputs, type, value } of cases) {
        const taskHash = await taskHashOf(setup, task);
        const inputHashes = await datasets(setup, inputs);
        const result = await runner.execute(setup.storage, taskHash, inputHashes);
        equal(result.state, 'success', `${task}: ${result.error ?? ''}`);
        equal(result.outputHash, await datasetWrite(setup.storage, setup.repo, value, type), `${task}'s output is what the value path stores for the same value`);
        equal(result.cached, false, task);
        equal(result.peakBytes, undefined, `${task}: a browser measures no memory`);
        const record = await recordOf(setup, taskHash, inputHashes, result.executionId);
        ok(record?.type === 'success', `${task} is recorded success, not ${record?.type}`);
        equal(record.value.outputHash, result.outputHash);
        equal(record.value.unit, false, `${task} is a task's own execution`);
        equal(record.value.peakBytes.type, 'none', `${task}'s record names no peak`);
        const owner = await ownerOf(setup, taskHash, inputHashes, result.executionId);
        ok(owner !== null && equalFor(ExecutionOwnerType)(owner, { pid: 0n, pidStartTime: 0n, bootId: setup.storage.adapters.locks.session }),
          `${task}'s owner is the tab's session`);
      }

      // Served from the execution cache when it ran before.
      const taskHash = await taskHashOf(setup, 'count');
      const inputHashes = await datasets(setup, [[WordsType, ['pear', 'fig', 'apple']]]);
      const again = await runner.execute(setup.storage, taskHash, inputHashes);
      equal(again.cached, true, 'a run over inputs it ran before is served from the cache');
      equal(again.outputHash, await datasetWrite(setup.storage, setup.repo, 3n, IntegerType));
      const forced = await runner.execute(setup.storage, taskHash, inputHashes, { force: true });
      equal(forced.cached, false, 'a forced run runs again');
      equal(forced.outputHash, again.outputHash);
    },
  },
  {
    name: 'merges a dict its unit left in several runs into one, folding the keys they share',
    run: async (setup) => {
      const runner = setup.runner(setup.pool());
      const result = await runner.execute(setup.storage, await taskHashOf(setup, 'tallies'), []);
      equal(result.state, 'success', result.error ?? '');
      // 132 072 emissions of i % 1000: past the 131 072 a run holds.
      equal(result.outputHash, await datasetWrite(setup.storage, setup.repo, remainders(131_072 + 1_000, 1000), IntDictType),
        'the output is the one run the merge wrote');
    },
  },
  {
    name: 'records a failing program failed, exit code 1, its message and locations ending its stderr',
    run: async (setup) => {
      const runner = setup.runner(setup.pool());
      const taskHash = await taskHashOf(setup, 'fails');
      const inputHashes = await datasets(setup, [[WordsType, ['a', 'b']]]);
      const result = await runner.execute(setup.storage, taskHash, inputHashes);
      equal(result.state, 'failed');
      equal(result.exitCode, 1, 'a failed outcome exits 1, as the runner protocol has it');
      ok(/^Exit code: 1\nstderr:\nError: too many words: 2\n {2}at /.test(result.error ?? ''), `the error names the failure: ${result.error}`);
      const record = await recordOf(setup, taskHash, inputHashes, result.executionId);
      ok(record?.type === 'failed', `recorded ${record?.type}`);
      same(IntegerType, record.value.exitCode, 1n, 'the record\'s exit code');
      equal(record.value.peakBytes.type, 'none');
      equal(await logOf(setup, taskHash, inputHashes, result, 'stdout'), 'checking the words\n', 'what it wrote before it failed is in its log');
      const stderr = await logOf(setup, taskHash, inputHashes, result, 'stderr');
      ok(/^Error: too many words: 2\n( {2}at [^\n]+\n)+$/.test(stderr), `its stderr log is the failure and its locations, as east-node's exec writes them: ${JSON.stringify(stderr)}`);
    },
  },
  {
    name: 'writes what a unit\'s console writes to the execution\'s logs, and to its listeners, as it writes it',
    run: async (setup) => {
      const runner = setup.runner(setup.pool());
      const taskHash = await taskHashOf(setup, 'chatty');
      const inputHashes = await datasets(setup, [[WordsType, ['a', 'b']]]);
      const heard = { stdout: '', stderr: '' };
      const result = await runner.execute(setup.storage, taskHash, inputHashes, {
        onStdout: (text) => {
          heard.stdout += text;
        },
        onStderr: (text) => {
          heard.stderr += text;
        },
      });
      equal(result.state, 'success', result.error ?? '');
      equal(await logOf(setup, taskHash, inputHashes, result, 'stdout'), 'counting 2 words\n');
      equal(await logOf(setup, taskHash, inputHashes, result, 'stderr'), 'a line to stderr\n');
      deepEqual(heard, { stdout: 'counting 2 words\n', stderr: 'a line to stderr\n' });
    },
  },
  {
    name: 'refuses a command — a custom task, or a task on the custom runtime — recording it error: a browser runs no commands',
    run: async (setup) => {
      const runner = setup.runner(setup.pool());
      for (const task of ['command', 'custom_runtime']) {
        const taskHash = await taskHashOf(setup, task);
        const inputHashes = await datasets(setup, [[WordsType, ['a']]]);
        const result = await runner.execute(setup.storage, taskHash, inputHashes);
        equal(result.state, 'error', task);
        equal(result.error, NO_COMMANDS, task);
        equal(result.exitCode, undefined, `${task} ran nothing that exited`);
        const record = await recordOf(setup, taskHash, inputHashes, result.executionId);
        ok(record?.type === 'error' && record.value.message === NO_COMMANDS, `${task} is recorded error, naming why: ${record?.type}`);
        equal(await ownerOf(setup, taskHash, inputHashes, result.executionId), null, `${task} never ran, so no owner is recorded`);
      }
    },
  },
  {
    name: 'fails a unit that lists a platform package its worker does not serve, naming the package',
    run: async (setup) => {
      const runner = setup.runner(setup.pool());
      const result = await runner.execute(setup.storage, await taskHashOf(setup, 'io_task'), await datasets(setup, [[WordsType, ['a']]]));
      equal(result.state, 'failed');
      equal(result.exitCode, 1);
      ok(/the platform package @elaraai\/east-node-io is not served to units in this browser/.test(result.error ?? ''),
        `the failure names the package: ${result.error}`);
    },
  },
  {
    name: 'fails a unit that calls a platform function its packages do not provide — FileSystem.readFile — naming the function',
    run: async (setup) => {
      const runner = setup.runner(setup.pool());
      const result = await runner.execute(setup.storage, await taskHashOf(setup, 'reads_file'), await datasets(setup, [[WordsType, ['a']]]));
      equal(result.state, 'failed');
      equal(result.exitCode, 1);
      ok(/Platform function 'fs_read_file' not found/.test(result.error ?? ''), `the failure names FileSystem.readFile's platform function: ${result.error}`);
    },
  },
  {
    name: 'runs a task an app\'s own platform package answers, beside east-node-std\'s',
    run: async (setup) => {
      const runner = setup.runner(setup.pool());
      const result = await runner.execute(setup.storage, await taskHashOf(setup, 'greets'), await datasets(setup, [[WordsType, ['world']]]));
      equal(result.state, 'success', result.error ?? '');
      equal(result.outputHash, await datasetWrite(setup.storage, setup.repo, 'hello, world', StringType));
    },
  },
  {
    name: 'splits a task over its input into pieces and two levels of merges, and serves its relaunch from the cache',
    run: async (setup) => {
      setup.pieceBytes(64);
      const runner = setup.runner(setup.pool());
      const taskHash = await taskHashOf(setup, 'split_counts');
      const rows = 40_000;
      const inputHashes = await datasets(setup, [[SalesType, salesOf(rows)]]);
      const expected = await datasetWrite(setup.storage, setup.repo, remainders(rows, 97), IntDictType);
      const progress: string[] = [];
      const result = await runner.execute(setup.storage, taskHash, inputHashes, {
        onPartitionProgress: (p) => progress.push(`${p.phase} ${p.state}`),
      });
      equal(result.state, 'success', result.error ?? '');
      equal(result.outputHash, expected, 'the assembled output is what the value path stores');

      const log = (await logOf(setup, taskHash, inputHashes, result, 'stdout')).split('\n');
      const pieces = log.filter((line) => /^piece \d+\/\d+ completed task=/.test(line)).length;
      equal(mergeTreeLevels([pieces]), 2, `the input ran as more pieces than one merge unit takes: ${pieces}`);
      // The pieces' outputs all overlap, so they merge in one group: runs of
      // 32 at the first level, and their outputs at the second.
      const first = mergeTreeGroups(Array.from({ length: pieces }, (_, i) => i)).filter((run) => run.length >= 2).length;
      const merges = log.filter((line) => line.startsWith('merge ')).map((line) => line.split(' task=')[0]!).sort();
      deepEqual(merges, [
        ...Array.from({ length: first }, (_, i) => `merge level 1/2 unit ${i + 1}/${first} completed`),
        'merge level 2/2 unit 1/1 completed',
      ].sort(), 'the pieces merged in two levels');
      ok(progress.includes('partition started') && progress.includes('partition completed') && progress.includes('merge completed'),
        `each unit's progress is reported: ${[...new Set(progress)].join(', ')}`);
      const own = await recordOf(setup, taskHash, inputHashes, result.executionId);
      ok(own?.type === 'success' && own.value.plan.type === 'some', 'the task\'s own record names its last stage');

      // Its relaunch is served from the cache: the task's own execution, and,
      // with that record gone, every unit it ran.
      const again = await runner.execute(setup.storage, taskHash, inputHashes);
      equal(again.cached, true);
      equal(again.outputHash, expected);
      await setup.storage.refs.executionDelete(setup.repo, taskHash, inputsHash(inputHashes), result.executionId);
      const relaunch = await runner.execute(setup.storage, taskHash, inputHashes);
      equal(relaunch.state, 'success', relaunch.error ?? '');
      equal(relaunch.cached, false, 'the task runs again');
      equal(relaunch.outputHash, expected);
      const relaunched = (await logOf(setup, taskHash, inputHashes, relaunch, 'stdout')).split('\n').filter((line) => /^(piece|merge) /.test(line));
      equal(relaunched.length, pieces + first + 1, 'every unit settles again');
      ok(relaunched.every((line) => / cached task=/.test(line)), `every unit is served from the cache:\n${relaunched.join('\n')}`);
    },
  },
  {
    name: 'runs a split task\'s units as the dataflow runs each — pieces, and a merge of their outputs — recorded as units and served from the cache',
    run: async (setup) => {
      setup.pieceBytes(64);
      const runner = setup.runner(setup.pool());
      const { storage, repo } = setup;
      const taskHash = await taskHashOf(setup, 'split_counts');
      const inputHashes = await datasets(setup, [[SalesType, salesOf(5_000)]]);
      const task = decodeTaskObject(await storage.objects.read(repo, taskHash));
      const plan = await planPieces(storage, repo, task.inputs, inputHashes, pieceSizes());
      ok(plan.pieces.length >= 2, `the input is ${plan.pieces.length} pieces`);
      const pieces = plan.pieces.slice(0, 2);
      const outputs: string[] = [];
      for (const inputs of pieces) {
        const result = await runner.executeUnit(storage, taskHash, { inputs, merge: null, own: false });
        equal(result.state, 'success', result.error ?? '');
        equal(result.outputHash, await datasetWrite(storage, repo, await countedByRemainder(setup, inputs), IntDictType), 'a piece counts its own rows');
        const record = await recordOf(setup, taskHash, inputs, result.executionId);
        ok(record?.type === 'success' && record.value.unit, 'its record says it is a unit of a split task');
        outputs.push(result.outputHash!);
      }
      const merge = { inputs: ['merge', ...outputs], merge: { parts: outputs, range: null }, own: false };
      const merged = await runner.executeUnit(storage, taskHash, merge);
      equal(merged.state, 'success', merged.error ?? '');
      equal(merged.outputHash, await datasetWrite(storage, repo, await countedByRemainder(setup, pieces.map((inputs) => inputs[0]!)), IntDictType),
        'a merge folds the keys its parts share');
      const record = await recordOf(setup, taskHash, merge.inputs, merged.executionId);
      ok(record?.type === 'success' && record.value.unit, 'its record says it is a unit of a split task');
      const again = await runner.executeUnit(storage, taskHash, merge);
      equal(again.cached, true, 'a unit that ran before is served from the cache');
      equal(again.outputHash, merged.outputHash);
    },
  },
  {
    name: 'cancels a run its signal aborts: the unit\'s worker is terminated and replaced, and the execution recorded cancelled',
    run: async (setup) => {
      const counts = { started: 0, terminated: 0 };
      const runner = setup.runner(setup.pool({ width: 1, units: counting(counts) }));
      const taskHash = await taskHashOf(setup, 'waits');
      const inputHashes = await datasets(setup, [[WordsType, ['a', 'b', 'c']]]);
      const controller = new AbortController();
      const running = runner.execute(setup.storage, taskHash, inputHashes, { signal: controller.signal });
      // The unit waits on its host, mid-program.
      await until('the unit to wait on its host', () => setup.host.asked.includes('wait'));
      const ids = await setup.storage.refs.executionListIds(setup.repo, taskHash, inputsHash(inputHashes));
      equal(ids.length, 1);
      equal((await recordOf(setup, taskHash, inputHashes, ids[0]!))?.type, 'running', 'it is recorded running while it runs');
      controller.abort();
      const result = await settled('the run to end once aborted', running);
      equal(result.state, 'error');
      equal(result.cancelled, true);
      equal((await recordOf(setup, taskHash, inputHashes, result.executionId))?.type, 'cancelled');
      equal(await logOf(setup, taskHash, inputHashes, result, 'stdout'), 'waiting for the host\n', 'what it wrote is in its log');
      equal(await logOf(setup, taskHash, inputHashes, result, 'stderr'), 'e3: cancelled: e3 stopped the runner because the run was aborted\n',
        'and why it stopped');
      equal(counts.terminated, 1, 'its worker was terminated');

      // The next unit runs on a worker started in its place.
      const next = await runner.execute(setup.storage, await taskHashOf(setup, 'count'), await datasets(setup, [[WordsType, ['x']]]));
      equal(next.state, 'success', next.error ?? '');
      equal(counts.started, 2, 'a worker was started in its place');
    },
  },
  {
    name: 'records a run aborted while its unit waits for a worker cancelled, never started and owned by no one',
    run: async (setup) => {
      const runner = setup.runner(setup.pool({ width: 1 }));
      const busy = runner.execute(setup.storage, await taskHashOf(setup, 'waits'), await datasets(setup, [[WordsType, ['a']]]));
      await until('the first unit to wait on its host', () => setup.host.asked.includes('wait'));
      const controller = new AbortController();
      const taskHash = await taskHashOf(setup, 'count');
      const inputHashes = await datasets(setup, [[WordsType, ['b']]]);
      const waited: Array<number | null> = [];
      const queued = runner.execute(setup.storage, taskHash, inputHashes, {
        signal: controller.signal,
        onWaiting: (needs) => waited.push(needs),
      });
      await until('the second unit to wait for a worker', () => waited.length > 0);
      controller.abort();
      const result = await settled('the waiting run to end once aborted', queued);
      equal(result.cancelled, true);
      deepEqual(waited, [0, null], 'it waited for a core alone, and stopped waiting');
      equal((await recordOf(setup, taskHash, inputHashes, result.executionId))?.type, 'cancelled');
      equal(await logOf(setup, taskHash, inputHashes, result, 'stderr'), 'e3: cancelled: e3 did not start the runner because the run was aborted\n');
      equal(await ownerOf(setup, taskHash, inputHashes, result.executionId), null, 'it never ran, so no owner is recorded');
      setup.host.release();
      equal((await busy).state, 'success');
    },
  },
  {
    name: 'runs as many units at once as its pool is wide, and the rest in the order they began to wait',
    run: async (setup) => {
      const runner = setup.runner(setup.pool({ width: 2 }));
      const taskHash = await taskHashOf(setup, 'waits');
      const events: string[] = [];
      const runs = [1, 2, 3, 4].map(async (n) => {
        const inputHashes = await datasets(setup, [[WordsType, Array.from({ length: n }, (_, i) => `word ${i}`)]]);
        return runner.execute(setup.storage, taskHash, inputHashes, {
          onWaiting: (needs) => events.push(`${n} ${needs === null ? 'placed' : 'waiting'}`),
        });
      });
      await until('two units to wait on their host, and two for a worker', () => setup.host.asked.length === 2 && events.length === 2);
      deepEqual(setup.host.asked, ['wait', 'wait'], 'two units run: as many as the pool is wide');
      setup.host.release();
      for (const result of await Promise.all(runs)) equal(result.state, 'success', result.error ?? '');
      const began = events.filter((event) => event.endsWith(' waiting')).map((event) => event.split(' ')[0]);
      const placed = events.filter((event) => event.endsWith(' placed')).map((event) => event.split(' ')[0]);
      equal(began.length, 2);
      deepEqual(placed, began, 'the units that waited ran in the order they began to wait');
    },
  },
  {
    name: 'calls a function within its limits: a value, a collection spliced from its segments, and a stored dataset as an argument',
    run: async (setup) => {
      const runner = setup.runner(setup.pool());
      const { storage } = setup;
      // Bytes that are their buffer whole, which a message would move rather
      // than copy.
      const arg = encodeInteger(21n).slice();
      const spec: DetachedSpec = { ...call(double, [arg]), bodyIr: ir(double).slice() };
      const sizes = [spec.bodyIr.length, arg.length];
      const doubled = await runner.runDetached(spec, { storage });
      ok(doubled.kind === 'success', `a value: ${doubled.kind}`);
      same(IntegerType, decodeInteger(doubled.value), 42n, 'its value');
      deepEqual([doubled.stdout, doubled.stderr, doubled.stdoutTruncated, doubled.stderrTruncated], ['', '', false, false]);
      deepEqual([spec.bodyIr.length, arg.length], sizes, 'the caller keeps its bytes: the worker was given copies');

      const events = Array.from({ length: 3000 }, (_, i) => BigInt(i));
      const expected = events.map((x) => x * 2n);
      const each = await runner.runDetached(call(doubleEach, [encodeBeast2For(EventsType)(events)]), { storage });
      ok(each.kind === 'success', `a collection: ${each.kind}`);
      same(EventsType, decodeBeast2For(EventsType)(each.value), expected, 'its segments spliced into its value');

      const stored = await runner.runDetached(call(doubleEach, [{ dataset: await datasetWrite(storage, setup.repo, events, EventsType) }]), { storage });
      ok(stored.kind === 'success', `a stored dataset: ${stored.kind}`);
      same(EventsType, decodeBeast2For(EventsType)(stored.value), expected, 'a stored dataset is staged as a task\'s input is');
      await rejects(() => runner.runDetached(call(doubleEach, [{ dataset: 'a'.repeat(64) }])), { message: /runDetached needs options\.storage/ },
        'a stored dataset is staged from a repository');
    },
  },
  {
    name: 'calls a function past each limit: its value or its collection too large, and its logs kept to their tails',
    run: async (setup) => {
      const runner = setup.runner(setup.pool());
      const { storage } = setup;
      const text = Array.from({ length: 500 }, (_, i) => `${i}`).join('');
      const whole = await runner.runDetached(call(digits, [encodeInteger(500n)]), { storage });
      ok(whole.kind === 'success', `within its limit: ${whole.kind}`);
      same(StringType, decodeString(whole.value), text, 'its value');
      const value = await runner.runDetached(call(digits, [encodeInteger(500n)], PLATFORM_FREE, { maxResultBytes: 64 }), { storage });
      ok(value.kind === 'too_large' && value.limit === 64 && value.bytes === whole.value.length,
        `a value over its limit is too large, by its bytes: ${value.kind}`);

      // A collection is weighed by its segments, as the Writer writes them for
      // the same value.
      const events = Array.from({ length: 3000 }, (_, i) => BigInt(i));
      const doubledEvents = await readManifest(storage, setup.repo, await datasetWrite(storage, setup.repo, events.map((x) => x * 2n), EventsType));
      ok(doubledEvents !== null);
      const weight = manifestByteSize(doubledEvents);
      const fits = await runner.runDetached(call(doubleEach, [encodeBeast2For(EventsType)(events)], PLATFORM_FREE, { maxResultBytes: weight }), { storage });
      ok(fits.kind === 'success', `a collection of its limit's weight: ${fits.kind}`);
      const collection = await runner.runDetached(call(doubleEach, [encodeBeast2For(EventsType)(events)], PLATFORM_FREE, { maxResultBytes: weight - 1 }), { storage });
      ok(collection.kind === 'too_large' && collection.limit === weight - 1 && collection.bytes === weight,
        `a collection over its limit is too large, by its segments' bytes, never spliced: ${collection.kind}`);

      const logged = await runner.runDetached(call(lines, [encodeInteger(100n)], STANDARD, { maxLogBytes: 32 }), { storage });
      ok(logged.kind === 'success', `${logged.kind}`);
      same(IntegerType, decodeInteger(logged.value), 100n, 'its value');
      equal(logged.stdoutTruncated, true, 'its stdout was cut');
      ok(utf8.encode(logged.stdout).length <= 32 && logged.stdout.endsWith('line 98\nline 99\n'), `its stdout is its tail: ${JSON.stringify(logged.stdout)}`);
      deepEqual([logged.stderr, logged.stderrTruncated], ['done\n', false], 'its stderr was not cut');
    },
  },
  {
    name: 'calls a function that fails, one a browser cannot run and one aborted, answering each failed',
    run: async (setup) => {
      const runner = setup.runner(setup.pool());
      const { storage } = setup;
      const failed = await runner.runDetached(call(refusing, [encodeInteger(7n)]), { storage });
      ok(failed.kind === 'failed' && failed.exitCode === 1, `a failure exits 1: ${failed.kind}`);
      // The program is written here, so it carries the locations East finds
      // where the case runs: in a page's bundle, none.
      ok(/^Error: refused 7\n( {2}at [^\n]+\n)*$/.test(failed.stderr), `its stderr is the failure, as east-node's exec writes it: ${JSON.stringify(failed.stderr)}`);

      const custom = await runner.runDetached(call(double, [encodeInteger(1n)], variant('custom', { command: ['east-node', 'run'] })), { storage });
      ok(custom.kind === 'failed' && custom.exitCode === -1, `a command is not run: ${custom.kind}`);
      equal(custom.stderr, NO_COMMANDS);

      const controller = new AbortController();
      const aborting = runner.runDetached(call(waiting, [], WITH_TEST), { storage, signal: controller.signal });
      await until('the call to wait on its host', () => setup.host.asked.includes('wait'));
      controller.abort();
      const aborted = await aborting;
      ok(aborted.kind === 'failed' && aborted.exitCode === -1, `an aborted call failed -1: ${aborted.kind}`);
    },
  },
  {
    name: 'answers a call that runs past its timeout timed out, its worker terminated and replaced',
    run: async (setup) => {
      const counts = { started: 0, terminated: 0 };
      const runner = setup.runner(setup.pool({ width: 1, units: counting(counts) }));
      const { storage } = setup;
      const timedOut = await runner.runDetached(call(waiting, [], WITH_TEST, { timeoutMs: 500 }), { storage });
      ok(timedOut.kind === 'timed_out' && timedOut.ms === 500, `${timedOut.kind}`);
      equal(counts.terminated, 1, 'its worker was terminated');
      const next = await runner.runDetached(call(double, [encodeInteger(4n)]), { storage });
      ok(next.kind === 'success', `the next call runs: ${next.kind}`);
      same(IntegerType, decodeInteger(next.value), 8n, 'its value');
      equal(counts.started, 2, 'on a worker started in its place');
    },
  },
  {
    name: 'hands each worker the port its pool was given, through which an app\'s package reaches the host',
    run: async (setup) => {
      const runner = setup.runner(setup.pool());
      const echoed = await runner.runDetached(call(echoing, [encodeString('ping')], WITH_TEST), { storage: setup.storage });
      ok(echoed.kind === 'success', `${echoed.kind}: ${echoed.stderr}`);
      same(StringType, decodeString(echoed.value), 'ping, from the host', 'the host\'s answer');
      deepEqual(setup.host.asked, ['echo:ping']);
    },
  },
  {
    name: 'runs a one-shot over a workspace\'s dataset, and a split call over its pieces with then',
    run: async (setup) => {
      setup.pieceBytes(64);
      const runner = setup.runner(setup.pool());
      const { storage, repo } = setup;
      await deploy(setup, runner);
      await workspaceSetDataset(storage, repo, WORKSPACE, inputPath('words'), ['a', 'b', 'c'], WordsType);
      const request: OneShotRequest = { bodyIr: ir(countWords), args: [variant('dataset', inputPath('words'))], runner: PLATFORM_FREE, limits: none };
      const oneShot = await oneShotExecute(storage, runner, repo, WORKSPACE, request, { grant: 'any' });
      ok(oneShot.outcome.type === 'success', `the one-shot: ${oneShot.outcome.type}`);
      same(IntegerType, decodeInteger(oneShot.outcome.value.value), 3n, 'its value');
      deepEqual(oneShot.inputs.map(({ hash }) => hash), [await datasetWrite(storage, repo, ['a', 'b', 'c'], WordsType)], 'it names the dataset it read');

      const rows = 8_000;
      await workspaceSetDataset(storage, repo, WORKSPACE, inputPath('sales'), salesOf(rows), SalesType);
      const progress: string[] = [];
      const split: SplitCallRequest = {
        bodyIr: ir(East.function([SalesType, FunctionType([IntegerType, IntegerType], NullType)], NullType, ($, sales, emit) => {
          $.for(sales, ($, _amount, key) => {
            $(emit(key.remainder(7n), 1n));
          });
        })),
        args: [{ arg: variant('dataset', inputPath('sales')), partition: some({ by: [] }) }],
        output: variant('dict', { merge: some(ir(East.function([IntegerType, IntegerType, IntegerType], IntegerType, ($, _key, a, b) => a.add(b)))) }),
        then: some(ir(East.function([IntDictType, SalesType], IntegerType, ($, counts, _sales) => counts.size()))),
        runner: PLATFORM_FREE,
        limits: none,
      };
      const launched = await splitCallPrepare(storage, repo, WORKSPACE, split, { grant: 'any' });
      ok('task' in launched, 'the call launched');
      const outcome = await splitCallRun(storage, runner, repo, launched, { onProgress: (p) => progress.push(p.phase.type) });
      ok(outcome.outcome.type === 'success', `the split call: ${outcome.outcome.type}: ${outcome.stderr}`);
      same(IntegerType, decodeInteger(await readDatasetWhole(storage, repo, outcome.outcome.value.value)), 7n, 'then\'s value');
      ok(outcome.output.type === 'some', 'it names the assembled output');
      same(IntDictType, decodeBeast2For(IntDictType)(await readDatasetWhole(storage, repo, outcome.output.value)), remainders(rows, 7),
        'the pieces\' outputs, merged');
      ok(progress.includes('partition') && progress.includes('merge'), `its pieces ran and merged: ${[...new Set(progress)].join(', ')}`);
    },
  },
  {
    name: 'builds a record\'s index at deploy, and runs its mutations, the index maintained by each commit',
    run: async (setup) => {
      const runner = setup.runner(setup.pool());
      const { storage, repo } = setup;
      await deploy(setup, runner);
      const deployed = await storage.datasets.read(repo, WORKSPACE, 'records/counts');
      ok(deployed?.type === 'value', 'the record holds its initial state');
      deepEqual(await recordIndexNames(storage, repo, deployed.value.hash), ['by_count'], 'its index was built at deploy');

      for (const [word, n] of [['apple', 2n], ['pear', 1n], ['apple', 3n]] as const) {
        const outcome = await recordMutate(storage, runner, repo, WORKSPACE, 'counts', 'add', [encodeString(word), encodeInteger(n)], { actor: 'e3-web' });
        equal(outcome.kind, 'committed', `adding ${n} ${word}: ${JSON.stringify(outcome.kind === 'failed' ? outcome.stderr : outcome.kind)}`);
      }
      const ref = await storage.datasets.read(repo, WORKSPACE, 'records/counts');
      ok(ref?.type === 'value');
      same(CountsType, decodeBeast2For(CountsType)(await readDatasetWhole(storage, repo, ref.value.hash)),
        new SortedMap([['apple', 5n], ['pear', 1n]], compareFor(StringType)), 'the record holds what its mutations wrote');
      const index = (await readRecordState(storage, repo, ref.value.hash)).indexes.get('by_count');
      ok(index !== undefined, 'the state names its index');
      const manifest = await readManifest(storage, repo, index.manifest);
      ok(manifest !== null);
      equal(manifestElementCount(manifest), 2, 'its index holds an entry for each row');
    },
  },
  {
    name: 'takes a delivery in through intake units: by pieces with an index, whole without, and refused above its whole-intake limit',
    run: async (setup) => {
      setup.pieceBytes(4096);
      const runner = setup.runner(setup.pool());
      const { storage, repo } = setup;
      equal(runner.wholeIntakeLimit, 256 * 1024 * 1024, 'a runner takes in up to 256 MiB whole unless told otherwise');
      equal(DEFAULT_WHOLE_INTAKE_LIMIT, runner.wholeIntakeLimit);
      const type = toEastTypeValue(SalesType);

      // An indexed delivery is taken in a piece of its segments at a time,
      // each staged by ranged reads of its run, never the delivery whole.
      const rows = salesOf(20_000);
      const delivery = encodeBeast2PagedFor(SalesType)(rows);
      const object = await storage.objects.write(repo, delivery);
      const pieces: number[] = [];
      const read: string[] = [];
      const taken = await intakeDelivery(readsWhole(storage, (hash) => read.push(hash)), repo, runner, { object }, type, object, delivery.length, {
        onProgress: (progress) => pieces.push(progress.pieces.total),
      });
      equal(taken.hash, await datasetWrite(storage, repo, rows, SalesType), 'it is stored as the Writer stores the same rows');
      deepEqual(taken.runners, [WEB_RUNNER]);
      ok(taken.pieces.length > 1 && pieces[0] === taken.pieces.length, `it was taken in as ${taken.pieces.length} pieces`);
      equal(read.filter((hash) => hash === object).length, 0, 'no piece read the delivery whole');

      // One with no index cannot be cut: it is taken in whole, under the limit.
      const plain = encodeBeast2For(SalesType)(salesOf(3_000));
      ok(plain.length > 1024, `the delivery is ${plain.length} bytes`);
      const plainObject = await storage.objects.write(repo, plain);
      const whole = await intakeDelivery(readsWhole(storage, (hash) => read.push(hash)), repo, runner, { object: plainObject }, type, plainObject, plain.length);
      equal(whole.hash, await datasetWrite(storage, repo, salesOf(3_000), SalesType));
      deepEqual(whole.pieces, [], 'taken in whole, by one unit');
      equal(read.filter((hash) => hash === plainObject).length, 1, 'which read it whole');
      const bounded = setup.runner(setup.pool(), { wholeIntakeLimit: 1024 });
      await rejects(() => intakeDelivery(storage, repo, bounded, { object: plainObject }, type, plainObject, plain.length), {
        name: 'DeliveryRefusedError',
        message: /the delivery has no index that reads, so it is taken in whole, by one unit, and at \d+ bytes it is more than the 1024 a unit of this runner takes in whole — write it again with a current Writer, which indexes it/,
      }, 'above its limit, it is refused before any unit runs, naming the fix');

      // A unit refuses a delivery that is not of its declared type.
      await rejects(() => runner.intake(storage, { source: { object }, type: toEastTypeValue(WordsType) }), {
        name: 'DeliveryRefusedError',
        message: /^east-web refused the delivery: /,
      });
      await rejects(() => runner.intake(storage, { source: { file: '/deliveries/sales.beast2' }, type }), {
        message: /a browser's runner cannot read/,
      }, 'a file is no delivery a browser takes in');
    },
  },
  {
    name: 'judges an execution recorded running alive while its owner\'s session lives, and its probe takes one whose session ended for interrupted',
    run: async (setup) => {
      const runner = setup.runner(setup.pool());
      const taskHash = await taskHashOf(setup, 'count');
      const inputs = (word: string): Promise<string[]> => datasets(setup, [[WordsType, [word]]]);
      const alive = (inputHashes: string[], running: RunningExecution): Promise<boolean> =>
        runner.executionAlive(setup.storage, taskHash, inputsHash(inputHashes), running);
      const tab = (session: string): ExecutionOwner => ({ pid: 0n, pidStartTime: 0n, bootId: session });

      const own = await inputs('own');
      equal(await alive(own, await runningAs(setup, taskHash, own, tab(setup.storage.adapters.locks.session))), true, 'owned by this tab\'s session');
      const other = await setup.openSession();
      const elsewhere = await inputs('elsewhere');
      const elsewhereRunning = await runningAs(setup, taskHash, elsewhere, tab(other.session));
      equal(await alive(elsewhere, elsewhereRunning), true, 'owned by another tab\'s session, which lives');
      const pidOwned = await inputs('pid');
      equal(await alive(pidOwned, await runningAs(setup, taskHash, pidOwned, { pid: 7n, pidStartTime: 1n, bootId: other.session })), false,
        'owned by a process, which no tab is');
      const unowned = await inputs('unowned');
      equal(await alive(unowned, await runningAs(setup, taskHash, unowned, null)), false, 'owned by no one');

      // A probe leaves one another tab runs as it is, and runs the task beside it.
      const beside = await runner.execute(setup.storage, taskHash, elsewhere);
      equal(beside.state, 'success', beside.error ?? '');
      equal((await recordOf(setup, taskHash, elsewhere, elsewhereRunning.executionId))?.type, 'running', 'an execution another tab runs is left running');

      // And takes one whose owner's session has ended for interrupted.
      const ended = await inputs('ended');
      const endedRunning = await runningAs(setup, taskHash, ended, tab(other.session));
      await other.close();
      equal(await alive(ended, endedRunning), false, 'its owner\'s session has ended');
      const again = await runner.execute(setup.storage, taskHash, ended);
      equal(again.state, 'success', again.error ?? '');
      equal(again.cached, false);
      equal((await recordOf(setup, taskHash, ended, endedRunning.executionId))?.type, 'interrupted', 'the probe took it for interrupted');
    },
  },
];

/**
 * The cases only workers on threads of their own pass — Web Workers, not the
 * in-process host, whose units share the thread of the test that runs them: a
 * unit that never yields that thread is ended only by terminating it, and only
 * a Web Worker closes itself.
 */
export const threadCases: readonly AdapterCase<RunnerSetup>[] = [
  {
    name: 'ends a call that never yields its thread at its timeout, terminating its worker, and runs the next on another',
    run: async (setup) => {
      const counts = { started: 0, terminated: 0 };
      const runner = setup.runner(setup.pool({ width: 1, units: counting(counts) }));
      const { storage } = setup;
      const timedOut = await runner.runDetached(call(runaway, [], PLATFORM_FREE, { timeoutMs: 500 }), { storage });
      ok(timedOut.kind === 'timed_out' && timedOut.ms === 500, `${timedOut.kind}`);
      equal(counts.terminated, 1, 'its worker was terminated');
      const next = await runner.runDetached(call(double, [encodeInteger(5n)]), { storage });
      ok(next.kind === 'success', `the next call runs: ${next.kind}`);
      same(IntegerType, decodeInteger(next.value), 10n, 'its value');
      equal(counts.started, 2, 'on a worker started in its place');
    },
  },
  {
    name: 'fails a call whose worker closes itself, which no event says, letting the worker go, and runs the next on another',
    run: async (setup) => {
      const counts = { started: 0, terminated: 0 };
      const runner = setup.runner(setup.pool({ width: 1, units: counting(counts) }));
      const { storage } = setup;
      const exited = await settled('the call whose worker closed itself to end', runner.runDetached(call(exiting, [], WITH_TEST), { storage }));
      ok(exited.kind === 'failed' && exited.exitCode === -1, `the call failed, its worker gone: ${exited.kind}`);
      ok(/the unit worker stopped: it closed itself/.test(exited.stderr), `naming why: ${JSON.stringify(exited.stderr)}`);
      equal(setup.host.closed(), 1, 'the services its worker was handed were ended');
      // Its place is free: the pool is one wide.
      const next = await settled('the next call to run', runner.runDetached(call(double, [encodeInteger(6n)]), { storage }));
      ok(next.kind === 'success', `the next call runs: ${next.kind}`);
      same(IntegerType, decodeInteger(next.value), 12n, 'its value');
      equal(counts.started, 2, 'on a worker started in its place');
    },
  },
];
