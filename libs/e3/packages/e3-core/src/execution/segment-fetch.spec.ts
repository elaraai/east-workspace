/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A unit on a store whose objects are elsewhere (#1017): its collections are
 * staged without their segments, and its runner asks for each as it reads it,
 * so the unit downloads what it reads — alone, and as a piece of a split task
 * — and every runner reads an input so staged as it reads one staged whole. A
 * store whose objects are files here stages as it always has. A runner reading
 * a collection in order waits on a fraction of its segments, since the fetcher
 * reads ahead of it.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArrayType, DictType, East, IntegerType, SortedMap, compareFor, decodeBeast2For, encodeEastIR, variant, type EastType } from '@elaraai/east';
import e3, { type Runner, type TaskDef } from '@elaraai/e3';
import { LocalTaskRunner, taskExecute } from './LocalTaskRunner.js';
import { SegmentFetcher } from './segment-fetch.js';
import { DatasetSegments } from '../dataset-open.js';
import { ObjectNotFoundError } from '../errors.js';
import { datasetWrite } from '../trees.js';
import { packageImport, packageRead } from '../packages.js';
import { createTempDir, createTestRepo, removeTempDir, removeTestRepo } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/interfaces.js';

/** Whether a command runs: a runner's CLI on PATH. */
function onPath(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore', shell: process.platform === 'win32' });
    return true;
  } catch {
    return false;
  }
}

/** Runs `fn` with the pieces an input is cut into sized about `bytes`. */
async function withPieceBytes<T>(bytes: number, fn: () => Promise<T>): Promise<T> {
  const was = process.env.E3_TEST_PIECE_BYTES;
  process.env.E3_TEST_PIECE_BYTES = String(bytes);
  try {
    return await fn();
  } finally {
    if (was === undefined) delete process.env.E3_TEST_PIECE_BYTES;
    else process.env.E3_TEST_PIECE_BYTES = was;
  }
}

/** Every input opens paged, whatever its size, as a large one does. */
const PAGED = { extraEnv: { EAST_LAZY_INPUT_BYTES: '1' } };

const TableType = ArrayType(IntegerType);
const KeyedType = DictType(IntegerType, IntegerType);

describe('a unit whose collections are placed as its runner reads them', () => {
  let repo: string;
  let dir: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    dir = createTempDir();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(dir);
  });

  /** `storage`, recording each object it places; placing one a download when
   *  `placement` says so, as a store elsewhere places it. */
  function counting(placed: string[], placement?: 'download'): StorageBackend {
    const objects = Object.create(storage.objects, {
      ...(placement !== undefined && { placement: { value: placement } }),
      materialize: {
        value: (at: string, hash: string, dest: string, options?: { link?: boolean }): Promise<void> => {
          placed.push(hash);
          return storage.objects.materialize(at, hash, dest, options);
        },
      },
    }) as StorageBackend['objects'];
    return {
      upgrades: storage.upgrades,
      objects,
      refs: storage.refs,
      locks: storage.locks,
      logs: storage.logs,
      repos: storage.repos,
      datasets: storage.datasets,
      validateRepository: (at) => storage.validateRepository(at),
    };
  }

  /** Exports `task` in a package of its own, imports it, and stores its
   *  inputs, the values of its input datasets in order. */
  async function prepare(task: TaskDef, inputs: [EastType, unknown][]): Promise<{ taskHash: string; inputHashes: string[] }> {
    const zip = join(dir, `${task.name}.zip`);
    await e3.export(e3.package(task.name, '1.0.0', task), zip);
    await packageImport(storage, repo, zip);
    const taskHash = (await packageRead(storage, repo, task.name, '1.0.0')).tasks.get(task.name)!;
    const inputHashes: string[] = [];
    for (const [type, value] of inputs) inputHashes.push(await datasetWrite(storage, repo, value, type));
    return { taskHash, inputHashes };
  }

  /** The segments a stored collection is manifested as. */
  async function segmentsOf(hash: string): Promise<string[]> {
    return (await DatasetSegments.open(storage, repo, hash)).manifest!.entries.map((entry) => entry.hash);
  }

  it('places only the segment a read lands in, and every segment where objects are files here, as ever', async () => {
    const values = Array.from({ length: 50_000 }, (_, i) => BigInt(i));
    const first = e3.task('first', [e3.input('table', TableType)], East.function([TableType], IntegerType, ($, table) => table.get(0n)));
    const { taskHash, inputHashes } = await prepare(first, [[TableType, values]]);
    const segments = await segmentsOf(inputHashes[0]!);
    assert.ok(segments.length > 4, `the table spans segments, not ${segments.length}`);

    const placed: string[] = [];
    const fetched = await taskExecute(counting(placed, 'download'), repo, taskHash, inputHashes, PAGED);
    assert.equal(fetched.state, 'success', fetched.error ?? '');
    assert.equal(fetched.outputHash, await datasetWrite(storage, repo, 0n, IntegerType));
    assert.deepEqual(segments.filter((segment) => placed.includes(segment)), [segments[0]], 'only the segment the read lands in');

    const linked: string[] = [];
    const whole = await taskExecute(counting(linked), repo, taskHash, inputHashes, { ...PAGED, force: true });
    assert.equal(whole.outputHash, fetched.outputHash);
    assert.deepEqual(segments.filter((segment) => linked.includes(segment)), segments, 'every segment, linked in before the runner starts');
  });

  it("places an unpartitioned input's segments for each piece of a split task only as the piece reads them", async () => {
    const sales = new SortedMap(Array.from({ length: 20_000 }, (_, i) => [BigInt(i), BigInt(i)] as [bigint, bigint]), compareFor(IntegerType));
    const lookup = Array.from({ length: 50_000 }, (_, i) => BigInt(i + 7));
    const shifted = e3.streamTask('shifted', {
      inputs: [e3.partition(e3.input('sales', KeyedType)), e3.input('lookup', TableType)],
      output: e3.output.dict(IntegerType, IntegerType),
    }, ($, sales, lookup, emit) => {
      const base = $.let(lookup.get(0n));
      $.for(sales, ($, amount, account) => {
        $(emit(account, amount.add(base)));
      });
    });
    const { taskHash, inputHashes } = await prepare(shifted, [[KeyedType, sales], [TableType, lookup]]);
    const lookupSegments = await segmentsOf(inputHashes[1]!);
    assert.ok(lookupSegments.length > 4, `the lookup spans segments, not ${lookupSegments.length}`);

    const placed: string[] = [];
    const result = await withPieceBytes(16 * 1024, () => taskExecute(counting(placed, 'download'), repo, taskHash, inputHashes, PAGED));
    assert.equal(result.state, 'success', result.error ?? '');
    const expected = new SortedMap([...sales].map(([account, amount]) => [account, amount + 7n] as [bigint, bigint]), compareFor(IntegerType));
    assert.equal(result.outputHash, await datasetWrite(storage, repo, expected, KeyedType));
    const pieces = placed.filter((hash) => hash === lookupSegments[0]).length;
    assert.ok(pieces > 1, `each piece placed the lookup's first segment, and there were ${pieces}`);
    assert.deepEqual(lookupSegments.slice(1).filter((segment) => placed.includes(segment)), [], 'no piece placed a segment of the lookup it did not read');
  });

  it("places only the segment a function call's dataset argument is read at", async () => {
    const table = await datasetWrite(storage, repo, Array.from({ length: 50_000 }, (_, i) => BigInt(i)), TableType);
    const segments = await segmentsOf(table);
    const last = East.function([TableType], IntegerType, ($, rows) => rows.get(49_999n));
    const placed: string[] = [];
    const result = await new LocalTaskRunner(repo).runDetached({
      bodyIr: encodeEastIR(last.toIR()),
      args: [{ dataset: table }],
      runner: variant('east_node', { platforms: [] }),
      limits: { timeoutMs: 60_000, maxResultBytes: 1024, maxLogBytes: 64 * 1024 },
    }, { storage: counting(placed, 'download'), extraEnv: PAGED.extraEnv });
    assert.ok(result.kind === 'success', `the call ended ${result.kind}: ${result.stderr}`);
    assert.equal(decodeBeast2For(IntegerType)(result.value), 49_999n);
    assert.deepEqual(segments.filter((segment) => placed.includes(segment)), [segments.at(-1)], 'only the segment the read lands in');
  });

  describe('runner conformance', () => {
    const runners: Runner[] = [
      { runtime: 'east-node', platforms: [] },
      ...(onPath('east-c', ['version']) ? [{ runtime: 'east-c' as const, platforms: [] }] : []),
      ...(onPath('east-py', ['version']) ? [{ runtime: 'east-py' as const, platforms: [] }] : []),
    ];

    for (const runner of runners) {
      it(`${runner.runtime} reads an input whose segments are placed as it reads them as it reads one staged whole`, async () => {
        const table = new SortedMap(Array.from({ length: 30_000 }, (_, i) => [BigInt(i), BigInt(3 * i)] as [bigint, bigint]), compareFor(IntegerType));
        const tally = e3.task(`tally_${runner.runtime.replace('-', '_')}`, [e3.input('ledger', KeyedType)],
          East.function([KeyedType], IntegerType, ($, table) => {
            const sum = $.let(0n);
            $.for(table, ($, value) => {
              $.assign(sum, sum.add(value));
            });
            return sum.add(table.get(12_345n).multiply(1_000_000n)).add(table.size());
          }), { runner });
        const { taskHash, inputHashes } = await prepare(tally, [[KeyedType, table]]);
        const segments = await segmentsOf(inputHashes[0]!);

        const whole = await taskExecute(storage, repo, taskHash, inputHashes, PAGED);
        assert.equal(whole.state, 'success', whole.error ?? '');
        const placed: string[] = [];
        const fetched = await taskExecute(counting(placed, 'download'), repo, taskHash, inputHashes, { ...PAGED, force: true });
        assert.equal(fetched.state, 'success', fetched.error ?? '');
        assert.equal(fetched.outputHash, whole.outputHash, 'the same output as the input staged whole');
        assert.deepEqual(segments.filter((segment) => placed.includes(segment)), segments, 'every segment the body read was asked for, and placed');
      });
    }
  });
});

describe('the segment fetcher over a store where placing an object takes a while', () => {
  const DELAY_MS = 20;
  let dir: string;

  beforeEach(() => {
    dir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(dir);
  });

  /** A store whose objects are elsewhere: placing one takes `DELAY_MS`, and
   *  the most placements in flight at once is kept. */
  function slowStore(placed: string[], inFlight: { now: number; most: number }): StorageBackend {
    const objects = {
      placement: 'download',
      materialize: async (_repo: string, hash: string, dest: string): Promise<void> => {
        placed.push(hash);
        inFlight.most = Math.max(inFlight.most, ++inFlight.now);
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
        await writeFile(dest, hash);
        inFlight.now--;
      },
    };
    return { objects } as unknown as StorageBackend;
  }

  /** A manifest's segments, staged unplaced in one directory and left to a
   *  started fetcher, in the manifest's order. */
  function staged(storage: StorageBackend, count: number): { fetcher: SegmentFetcher; files: string[]; hashes: string[] } {
    const segmentDir = join(dir, 'input-0.beast2.segments');
    mkdirSync(segmentDir);
    const fetcher = new SegmentFetcher(storage, 'repo', true);
    const hashes = Array.from({ length: count }, (_, i) => i.toString(16).padStart(64, '0'));
    const files = hashes.map((hash) => join(segmentDir, `${hash}.beast2`));
    hashes.forEach((hash, i) => fetcher.add(hash, files[i]!));
    fetcher.start();
    return { fetcher, files, hashes };
  }

  /** What a runner does as it reads a segment: nothing when it is there, and
   *  otherwise it asks for it and waits for it. */
  async function read(file: string): Promise<void> {
    if (existsSync(file)) return;
    await writeFile(`${file}.want`, '');
    while (!existsSync(file)) {
      if (existsSync(`${file}.error`)) throw new Error(readFileSync(`${file}.error`, 'utf8'));
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }

  it('reads ahead of a runner reading a manifest in order, placing the segments after the one it asks for side by side, each once', async () => {
    const placed: string[] = [];
    const inFlight = { now: 0, most: 0 };
    const { fetcher, files } = staged(slowStore(placed, inFlight), 256);
    for (const file of files) await read(file);
    await fetcher.stop();
    assert.equal(new Set(placed).size, 256, 'each segment is placed');
    assert.equal(placed.length, 256, 'and placed once');
    // A runner asks for one segment at a time and waits for it, so placements
    // side by side are the fetcher's, ahead of it: once the asks have doubled
    // the window to 8, it starts that many at once, on any machine. How long
    // the scan takes is left untimed, since a slow machine is what a clock
    // measures.
    assert.ok(inFlight.most >= 8, `placements run side by side: at most ${inFlight.most} did`);
  });

  it('reads nothing ahead of a runner reading one segment, or segments out of order', async () => {
    const placed: string[] = [];
    const { fetcher, files, hashes } = staged(slowStore(placed, { now: 0, most: 0 }), 64);
    for (const at of [40, 7, 23]) await read(files[at]!);
    await fetcher.stop();
    assert.deepEqual(placed.sort(), [40, 7, 23].map((at) => hashes[at]!).sort());
  });

  /** The object the `i`th staged segment is. */
  const hashOf = (i: number): string => i.toString(16).padStart(64, '0');

  /** The failure a store under load answers a burst with: one that passes. */
  const throttled = (): Error => Object.assign(new Error('Please reduce your request rate.'), { name: 'SlowDown' });

  /** `store`, its placing of an object failing as many times as `failures`
   *  says, with the error it names. */
  function failing(store: StorageBackend, failures: Map<string, { times: number; error: () => Error }>): StorageBackend {
    const objects = store.objects;
    const materialize = async (repo: string, hash: string, dest: string, options?: { link?: boolean }): Promise<void> => {
      const failure = failures.get(hash);
      if (failure !== undefined && failure.times > 0) {
        failure.times--;
        throw failure.error();
      }
      return objects.materialize(repo, hash, dest, options);
    };
    return { objects: { ...objects, materialize } } as unknown as StorageBackend;
  }

  it('leaves a segment whose placement ahead of the runner failed to the runner\'s own ask, which places it', async () => {
    // The runner reads 0 and 1 in order, so 2 is placed ahead of it, and that
    // placement fails once
    const store = failing(slowStore([], { now: 0, most: 0 }), new Map([[hashOf(2), { times: 1, error: throttled }]]));
    const { fetcher, files } = staged(store, 8);
    try {
      for (const file of files.slice(0, 3)) await read(file);
    } finally {
      await fetcher.stop();
    }
    assert.equal(existsSync(files[2]!), true, 'the runner read it');
    assert.equal(existsSync(`${files[2]!}.error`), false, 'a failure ahead of the runner wrote nothing');
  });

  it('tries a segment the runner asked for again after a failure that may pass, and writes why once it will not', async () => {
    const store = failing(slowStore([], { now: 0, most: 0 }), new Map([
      [hashOf(5), { times: 2, error: throttled }],
      [hashOf(9), { times: 1, error: () => new ObjectNotFoundError(hashOf(9)) }],
      [hashOf(11), { times: 99, error: throttled }],
    ]));
    const { fetcher, files } = staged(store, 16);
    try {
      await read(files[5]!);
      await assert.rejects(read(files[9]!), /not found/, 'a missing object is written at once');
      await assert.rejects(read(files[11]!), /^Error: Please reduce your request rate\.$/, 'and one that keeps failing once its tries are spent, whole');
    } finally {
      await fetcher.stop();
    }
  });
});
