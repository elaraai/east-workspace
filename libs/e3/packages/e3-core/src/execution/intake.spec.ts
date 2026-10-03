/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A local runner's intake: which runner takes a delivery in, what it stores,
 * and what happens when a runner refuses the delivery, cannot run the unit, or
 * is not there.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ArrayType, IntegerType, RUN_MAX_BYTES, StringType, StructType, encodeBeast2PagedFor, readBeast2Extents, spliceBeast2Tail, toEastTypeValue,
} from '@elaraai/east';
import { DatasetSegments } from '../dataset-open.js';
import { DeliveryRefusedError } from '../errors.js';
import { datasetWrite } from '../trees.js';
import { createTempDir, createTestRepo, encodeInSegmentsOf, removeTempDir, removeTestRepo } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { Budget } from './budget.js';
import { INTAKE_CANDIDATES, runIntake, type IntakeCandidate } from './intake.js';
import type { IntakeSource } from './interfaces.js';
import { scratchRoot } from './scratch.js';

const TableType = ArrayType(StructType({ id: IntegerType, name: StringType }));
const rows = (n: number): { id: bigint; name: string }[] => Array.from({ length: n }, (_, i) => ({ id: BigInt(i), name: `row-${i}` }));

/** `n` as the unsigned varint a frame header writes its codec and lengths as. */
const varint = (n: number): number[] => {
  const bytes: number[] = [];
  for (; n >= 0x80; n = Math.floor(n / 128)) bytes.push((n & 0x7f) | 0x80);
  bytes.push(n);
  return bytes;
};

describe('a local intake', () => {
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

  /** A delivery on disk. */
  const deliver = (name: string, bytes: Uint8Array): string => {
    const file = join(dir, name);
    writeFileSync(file, bytes);
    return file;
  };

  it('takes a delivery in on the first runner it finds, as the manifest the Writer writes', async () => {
    const file = deliver('table.beast2', encodeBeast2PagedFor(TableType)(rows(3_000)));
    const taken = await runIntake(storage, repo, { source: { file }, type: toEastTypeValue(TableType) }, {}, new Map());
    assert.ok(['east-c', 'east-node'].includes(taken.runner), `taken in by ${taken.runner}`);
    assert.equal(taken.hash, await datasetWrite(storage, repo, rows(3_000), TableType));
    assert.ok(taken.peakBytes !== undefined && taken.peakBytes > 0, 'the runner reports its peak');
  });

  it('takes a run of segments in, and a delivery the store holds whole', async () => {
    const bytes = encodeInSegmentsOf(TableType, 8)(rows(40));
    const piece = await runIntake(storage, repo, { source: { file: deliver('table.beast2', bytes) }, type: toEastTypeValue(TableType), segments: { from: 1, to: 3 } }, {}, new Map());
    assert.equal(piece.hash, await datasetWrite(storage, repo, rows(40).slice(8, 24), TableType), 'segments 1 and 2: rows 8 to 23');

    const object = await storage.objects.write(repo, bytes);
    const whole = await runIntake(storage, repo, { source: { object }, type: toEastTypeValue(TableType) }, {}, new Map());
    assert.equal(whole.hash, await datasetWrite(storage, repo, rows(40), TableType));
    assert.equal((await DatasetSegments.open(storage, repo, whole.hash)).elementCount, 40);
  });

  /** `storage`, with its objects read through `objects`. */
  const through = (objects: StorageBackend['objects']): StorageBackend => ({
    upgrades: storage.upgrades,
    objects,
    refs: storage.refs,
    locks: storage.locks,
    logs: storage.logs,
    repos: storage.repos,
    datasets: storage.datasets,
    runStates: (at) => storage.runStates(at),
    validateRepository: (at) => storage.validateRepository(at),
  });

  /** `storage`, as a store whose objects are elsewhere, placing one by a
   *  download, with some of its object store's members replaced. */
  const elsewhere = (members: PropertyDescriptorMap = {}): StorageBackend =>
    through(Object.create(storage.objects, { placement: { value: 'download' }, ...members }) as StorageBackend['objects']);

  it('links a delivery the store holds whole in for a run of its segments, where objects are files here', async () => {
    const bytes = encodeInSegmentsOf(TableType, 8)(rows(400));
    const object = await storage.objects.write(repo, bytes);
    const placed: Array<boolean | undefined> = [];
    let ranges = 0;
    const objects = Object.create(storage.objects, {
      readRange: {
        value: (at: string, hash: string, offset: number, length: number): Promise<Uint8Array> => {
          if (hash === object) ranges++;
          return storage.objects.readRange(at, hash, offset, length);
        },
      },
      materialize: {
        value: (at: string, hash: string, dest: string, options?: { link?: boolean }): Promise<void> => {
          if (hash === object) placed.push(options?.link);
          return storage.objects.materialize(at, hash, dest, options);
        },
      },
    }) as StorageBackend['objects'];

    const piece = await runIntake(through(objects), repo, { source: { object }, type: toEastTypeValue(TableType), segments: { from: 10, to: 20 } }, {}, new Map());

    assert.equal(piece.hash, await datasetWrite(storage, repo, rows(400).slice(80, 160), TableType));
    assert.deepEqual(placed, [true], 'the delivery is placed by a link, which reads none of it');
    assert.equal(ranges, 0, 'and none of it is read by range');
  });

  it('stages a run of the segments of a delivery the store holds elsewhere, reading no byte of it outside its header, its index and the run', async () => {
    const bytes = encodeInSegmentsOf(TableType, 8)(rows(400));
    const object = await storage.objects.write(repo, bytes);
    const { prefixEnd, offsets, segmentsEnd } = readBeast2Extents(bytes);
    const [from, to] = [10, 20];
    // Every range of the delivery the intake reads; and neither the whole of
    // it, nor a download of it.
    const reads: Array<readonly [number, number]> = [];
    const counting = elsewhere({
      readRange: {
        value: (at: string, hash: string, offset: number, length: number): Promise<Uint8Array> => {
          if (hash === object) reads.push([offset, offset + length]);
          return storage.objects.readRange(at, hash, offset, length);
        },
      },
      read: {
        value: (at: string, hash: string): Promise<Uint8Array> =>
          hash === object ? Promise.reject(new Error('the intake read the delivery whole')) : storage.objects.read(at, hash),
      },
      materialize: {
        value: (at: string, hash: string, dest: string, options?: { link?: boolean }): Promise<void> =>
          hash === object ? Promise.reject(new Error('the intake staged the delivery whole')) : storage.objects.materialize(at, hash, dest, options),
      },
    });

    const piece = await runIntake(counting, repo, { source: { object }, type: toEastTypeValue(TableType), segments: { from, to } }, {}, new Map());

    assert.equal(piece.hash, await datasetWrite(storage, repo, rows(400).slice(8 * from, 8 * to), TableType), 'segments 10 to 19: rows 80 to 159');
    const header: readonly [number, number] = [0, prefixEnd];
    const run: readonly [number, number] = [offsets[from]!, offsets[to]!];
    const index: readonly [number, number] = [segmentsEnd, bytes.length];
    for (const [start, end] of reads) {
      assert.ok([header, run, index].some(([a, b]) => start >= a && end <= b), `read [${start}, ${end}) lies outside the header, the run and the index`);
    }
    const inRun = reads.filter(([start]) => start >= run[0] && start < run[1]).reduce((sum, [start, end]) => sum + end - start, 0);
    assert.equal(inRun, run[1] - run[0], 'the run is read once');
  });

  it('raises a read of a delivery the store holds elsewhere that the store fails, as it failed, and stages none of it whole', async () => {
    const bytes = encodeInSegmentsOf(TableType, 8)(rows(400));
    const object = await storage.objects.write(repo, bytes);
    // A store under load: every ranged read of the delivery is throttled
    const throttled = Object.assign(new Error('Please reduce your request rate.'), { name: 'SlowDown' });
    const throttling = elsewhere({
      readRange: {
        value: (at: string, hash: string, offset: number, length: number): Promise<Uint8Array> =>
          hash === object ? Promise.reject(throttled) : storage.objects.readRange(at, hash, offset, length),
      },
      materialize: {
        value: (at: string, hash: string, dest: string, options?: { link?: boolean }): Promise<void> =>
          hash === object ? Promise.reject(new Error('the intake staged the delivery whole')) : storage.objects.materialize(at, hash, dest, options),
      },
    });
    await assert.rejects(
      runIntake(throttling, repo, { source: { object }, type: toEastTypeValue(TableType), segments: { from: 10, to: 20 } }, {}, new Map()),
      (err: unknown) => err === throttled,
    );
  });

  it("names a staged run's refused segment, and its offset, as the delivery numbers them, as a delivery read where it lies is refused", async () => {
    const Strings = ArrayType(StringType);
    const good = encodeInSegmentsOf(Strings, 4)(Array.from({ length: 40 }, (_, i) => `s-${i}`));
    const extents = readBeast2Extents(good);
    const frames = extents.offsets.map((offset, i) => good.subarray(offset, i + 1 < extents.offsets.length ? extents.offsets[i + 1]! : extents.segmentsEnd));
    const counts = [...extents.counts];
    // Segment 3 declares more than a segment is read in, and segment 6 holds
    // one String that is not UTF-8.
    frames[3] = new Uint8Array([...varint(1), ...varint(RUN_MAX_BYTES + 1), ...varint(1), 0]);
    frames[6] = new Uint8Array([...varint(0), ...varint(3), ...varint(3), 0x01, 0x01, 0x80]);
    counts[6] = 1;
    const table: Array<{ offset: number; count: number }> = [];
    let at = extents.prefixEnd;
    for (const [i, frame] of frames.entries()) {
      table.push({ offset: at, count: counts[i]! });
      at += frame.length;
    }
    const delivery = Buffer.concat([good.subarray(0, extents.prefixEnd), ...frames, spliceBeast2Tail(table, at)]);
    const file = deliver('faulty.beast2', delivery);
    const object = await storage.objects.write(repo, delivery);

    // The object's runs are staged, as a store elsewhere stages them; the
    // file is read where it lies.
    const staging = elsewhere();
    const refusal = async (source: IntakeSource, segments: { from: number; to: number }): Promise<string> => {
      try {
        await runIntake(staging, repo, { source, type: toEastTypeValue(Strings), segments }, {}, new Map());
      } catch (err) {
        assert.ok(err instanceof DeliveryRefusedError, String(err));
        return err.refusal;
      }
      return assert.fail(`segments [${segments.from}, ${segments.to}) were taken in`);
    };
    const oversized = await refusal({ object }, { from: 2, to: 5 });
    assert.match(oversized, new RegExp(`^intake: segment 3 of the delivery, at offset ${table[3]!.offset}, holds ${RUN_MAX_BYTES + 1} bytes, more than the ${RUN_MAX_BYTES} a segment is read in — `));
    assert.equal(oversized, await refusal({ file }, { from: 2, to: 5 }), 'as the runner words it reading the delivery where it lies');
    const undecodable = await refusal({ object }, { from: 5, to: 8 });
    assert.equal(undecodable, 'intake: segment 6 of the delivery holds a row that does not decode: a String is not well-formed UTF-8');
    assert.equal(undecodable, await refusal({ file }, { from: 5, to: 8 }));
  });

  it("refuses what the runner refuses, in the runner's words, and tries no other", async () => {
    const file = deliver('junk.beast2', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    const unusable = new Map<string, string>();
    let refusedBy = '';
    await assert.rejects(
      runIntake(storage, repo, { source: { file }, type: toEastTypeValue(TableType) }, {}, unusable),
      (err: unknown) => {
        assert.ok(err instanceof DeliveryRefusedError, String(err));
        assert.equal(err.refusal, 'intake: the delivery is not a beast2 blob of version 4 or 5');
        assert.equal(err.message, `${err.runner} refused the delivery: ${err.refusal}`);
        refusedBy = err.runner;
        return true;
      },
    );
    assert.equal(unusable.has(refusedBy), false, 'a refusal is the delivery\'s, not the runner\'s');
  });

  it('falls back to the next runner when one cannot run the unit at all, saying why, and does not try it again',
    { skip: process.platform === 'win32' ? 'the stand-in east-c is a shell script' : false }, async () => {
      // An east-c from before the intake unit: it knows no `exec`, and says so
      // above its usage.
      const ran = join(dir, 'stale-east-c.ran');
      const stale = join(dir, 'stale-east-c');
      writeFileSync(stale, `#!/bin/sh\necho ran >> '${ran}'\n` +
        `printf 'Error: Unknown command: exec\\nUsage:\\n  east-c run <ir> [inputs...]\\n\\nSupported formats: .json, .beast2\\n' >&2\nexit 2\n`);
      chmodSync(stale, 0o755);
      const candidates: IntakeCandidate[] = [{ runner: INTAKE_CANDIDATES[0]!.runner, command: stale }, INTAKE_CANDIDATES[1]!];
      const unusable = new Map<string, string>();
      const spec = { source: { file: deliver('table.beast2', encodeBeast2PagedFor(TableType)(rows(100))) }, type: toEastTypeValue(TableType) };

      const first = await runIntake(storage, repo, spec, {}, unusable, candidates);
      assert.equal(first.runner, 'east-node');
      assert.equal(first.fallback, `${stale} exited 2 without recording a result for the intake unit (Error: Unknown command: exec)`);
      assert.equal(first.hash, await datasetWrite(storage, repo, rows(100), TableType));

      const second = await runIntake(storage, repo, spec, {}, unusable, candidates);
      assert.equal(second.runner, 'east-node');
      assert.equal(second.fallback, first.fallback, 'each intake says why');
      assert.equal(readFileSync(ran, 'utf8'), 'ran\n', 'the runner that could not run the unit is not tried again');
    });

  it('runs its unit from the base environment it is given, in place of the process\'s own',
    { skip: process.platform === 'win32' ? 'the stand-in east-node is a shell script' : false }, async () => {
      // east-node, saying what environment it was started from
      const seen = join(dir, 'seen');
      const reporting = join(dir, 'reporting-east-node');
      writeFileSync(reporting, `#!/bin/sh\nprintf '%s|%s' "\${E3_TEST_BASE-unset}" "\${E3_TEST_PROCESS_ONLY-unset}" > '${seen}'\nexec east-node "$@"\n`);
      chmodSync(reporting, 0o755);
      const candidates: IntakeCandidate[] = [{ runner: INTAKE_CANDIDATES[1]!.runner, command: reporting }];
      const spec = { source: { file: deliver('table.beast2', encodeBeast2PagedFor(TableType)(rows(100))) }, type: toEastTypeValue(TableType) };

      const previous = process.env.E3_TEST_PROCESS_ONLY;
      process.env.E3_TEST_PROCESS_ONLY = 'the process\'s';
      try {
        const taken = await runIntake(storage, repo, spec, { env: { PATH: process.env.PATH ?? '', E3_TEST_BASE: 'the base\'s' } }, new Map(), candidates);
        assert.equal(taken.hash, await datasetWrite(storage, repo, rows(100), TableType));
      } finally {
        if (previous === undefined) delete process.env.E3_TEST_PROCESS_ONLY;
        else process.env.E3_TEST_PROCESS_ONLY = previous;
      }
      assert.equal(readFileSync(seen, 'utf8'), 'the base\'s|unset');
    });

  it('stages its unit only once it holds a core, so an intake waiting for room holds nothing', async () => {
    const staged = (): string[] => (existsSync(scratchRoot(repo)) ? readdirSync(scratchRoot(repo)) : []);
    const budget = new Budget({ cores: 1, memory: 1024 ** 3 }, { sampler: null });
    const held = await budget.acquire();
    const spec = { source: { file: deliver('table.beast2', encodeBeast2PagedFor(TableType)(rows(10))) }, type: toEastTypeValue(TableType) };

    const taking = runIntake(storage, repo, spec, { budget }, new Map());
    const stop = new AbortController();
    const withdrawn = runIntake(storage, repo, spec, { budget, signal: stop.signal }, new Map());
    while (budget.queued < 2) await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(staged(), [], 'nothing is staged while the intakes wait for a core');

    stop.abort();
    await assert.rejects(withdrawn, { name: 'AbortError' });
    held.release();
    assert.equal((await taking).hash, await datasetWrite(storage, repo, rows(10), TableType));
    assert.deepEqual(staged(), [], 'nor left behind once the delivery is in');
  });

  it('says what to add when it finds no runner', async () => {
    const candidates: IntakeCandidate[] = [
      { runner: INTAKE_CANDIDATES[0]!.runner, command: 'e3-test-no-such-east-c' },
      { runner: INTAKE_CANDIDATES[1]!.runner, command: 'e3-test-no-such-east-node' },
    ];
    const file = deliver('table.beast2', encodeBeast2PagedFor(TableType)(rows(10)));
    await assert.rejects(
      runIntake(storage, repo, { source: { file }, type: toEastTypeValue(TableType) }, {}, new Map(), candidates),
      /^Error: e3 found no runner to take the delivery in: add @elaraai\/east-node-cli \(or east-c\) to the project$/,
    );
  });
});
