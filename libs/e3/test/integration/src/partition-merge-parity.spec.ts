/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Partition merge parity (issue #770, gate (b)).
 *
 * A partitioned task's keyed fan-in runs on the task's own runner — its
 * `merge` command over sorted partials, one pass each — and every runner's
 * merge writes through the same segment writer as its emit sink, so the task
 * must write exactly the bytes a `streamTask` with the same `merge` writes for
 * the same rows emitted in ascending key order. The twin of each job is a
 * `streamTask({ merge })` over the expected rows as a sorted
 * `Array<{ key, value }>` with duplicates adjacent, emitted in order. Per
 * runner on PATH:
 *
 * - a re-keyed `partitionTask({ merge })` whose input repeats keys within a
 *   partition and across its partitions writes the bytes of its twin — a
 *   Dict folded by a function, and a Set by `'union'`;
 * - a job whose partials form three components — each merged by its own
 *   unit, the results spliced — equals its twin by value;
 * - a job whose partials are disjoint runs no merge unit and equals its twin
 *   by value;
 * - a blob the sink writes and a blob a returned value writes, of one type,
 *   share their header bytes, which the splice of merged and unmerged
 *   components relies on;
 * - a job over the refinement-window rows — `Dict<Integer, Struct{v: String,
 *   f0..f149: Integer}>`, 2,200 rows of 5,380 characters of 64-symbol noise,
 *   rows 0–379 one character longer, the shape at which one runner's batch
 *   refinement once diverged by a single entry — equals its twin;
 * - a job whose partials each hold more rows than a segment may — so each
 *   spans several segments, the shape whose fan-in runs per key range rather
 *   than once over the component — equals its twin by value;
 * - a forced re-run at another `--jobs` count writes the same hash for every
 *   output: the bytes are a function of the inputs and the task, never of
 *   how many runners ran at once.
 *
 * Across the runners, the same rows give the same bytes: the re-keyed Dict,
 * the Set and both refinement-window outputs are byte-identical on every
 * runner.
 *
 * A runner is on PATH when `<runner> version` exits 0 in this process's
 * environment, which the CLI passes on to the runners it spawns. CI builds all
 * three from this tree; locally, put this tree's builds first on PATH.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import e3, { type DatasetDef, type Runner, type TaskDef } from '@elaraai/e3';
import {
  ArrayType,
  DictType,
  IntegerType,
  SetType,
  SortedMap,
  StringType,
  StructType,
  SEGMENT_MAX_COUNT,
  compareFor,
  decodeBeast2For,
  encodeBeast2PagedFor,
  equalFor,
  readBeast2Extents,
} from '@elaraai/east';
import { LocalStorage, workspaceGetDatasetHash } from '@elaraai/e3-core';
import { createTestDir, removeTestDir, runE3Command } from './helpers.js';

const TableType = DictType(IntegerType, StructType({ text: StringType }));
const AggType = StructType({ count: IntegerType, text: StringType });
const OutType = DictType(IntegerType, AggType);
const KeysType = SetType(IntegerType);
const PairType = StructType({ key: IntegerType, value: AggType });
const PairsType = ArrayType(PairType);
const SortedKeysType = ArrayType(IntegerType);

/** The refinement-window row: a wide string beside 150 integer fields. */
const WIDE_FIELDS = 150;
const WideRowType = StructType({
  v: StringType,
  ...Object.fromEntries(Array.from({ length: WIDE_FIELDS }, (_, k) => [`f${k}`, IntegerType])),
});
const WideType = DictType(IntegerType, WideRowType);
const WidePairType = StructType({ key: IntegerType, value: WideRowType });
const WidePairsType = ArrayType(WidePairType);

const ROWS = 3600;
const PARTITIONS = 18;
const TEXT_CHARS = 4096;
const WIDE_ROWS = 2200;
const WIDE_CHARS = 5380;
const WIDE_LONGER_ROWS = 380;
/** The per-key-range fan-in's rows: narrow, and enough of them that a
 *  partition holds more than one segment can. A Set or Dict's segments are cut
 *  by the content rule — at most {@link SEGMENT_MAX_COUNT} elements, whatever
 *  they weigh — so what makes a partial span several segments is how many rows
 *  it holds, never how wide they are. */
const RANGED_ROWS = 10_000;
const RANGED_CHARS = 40;
/** `ranged`'s byte target — half of `ranged_scrambled`'s segments per
 *  partition — and the partitions the plan's greedy packing makes of it, both
 *  set once the input is written. */
let rangedTarget = 1;
let rangedPartitions = 0;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** A deterministic 64-symbol noise generator. */
function noise(seed: number): (chars: number) => string {
  let state = seed;
  return (chars) => {
    const out: string[] = [];
    for (let c = 0; c < chars; c++) {
      state = (state * 48271) % 2147483647;
      out.push(ALPHABET[Math.floor((state / 2147483647) * 64)]!);
    }
    return out.join('');
  };
}

/** `ROWS` rows keyed by id, each carrying `TEXT_CHARS` characters of
 *  deterministic noise, so a row stays about 3 KB once deflated. */
function makeTable(): SortedMap<bigint, { text: string }> {
  const next = noise(12345);
  const table = new SortedMap<bigint, { text: string }>([], compareFor(IntegerType));
  for (let id = 0; id < ROWS; id++) table.set(BigInt(id), { text: next(TEXT_CHARS) });
  return table;
}

type WideRow = { v: string } & Record<string, bigint | string>;

/** The refinement-window rows, keyed by id: rows 0–379 one character longer. */
function makeWideRows(): { key: bigint; value: WideRow }[] {
  const next = noise(54321);
  const rows: { key: bigint; value: WideRow }[] = [];
  for (let id = 0; id < WIDE_ROWS; id++) {
    const value: WideRow = { v: next(WIDE_CHARS + (id < WIDE_LONGER_ROWS ? 1 : 0)) };
    for (let k = 0; k < WIDE_FIELDS; k++) value[`f${k}`] = BigInt(id * WIDE_FIELDS + k);
    rows.push({ key: BigInt(id), value });
  }
  return rows;
}

/** `RANGED_ROWS` narrow rows keyed by id — enough of them that a partition
 *  of them spans several segments. */
function makeRangedRows(): { key: bigint; value: { count: bigint; text: string } }[] {
  const next = noise(24680);
  return Array.from({ length: RANGED_ROWS }, (_, id) => ({
    key: BigInt(id),
    value: { count: 1n, text: next(RANGED_CHARS) },
  }));
}

const rekey = (id: bigint): bigint => ((id / 2n) * 7919n) % 1200n;
const groupedKey = (id: bigint): bigint => (id % 700n) + 10000n * (id / 1200n);
const ascending = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

/** The rows a keyed job folds, as `(key, value)` pairs sorted by key then
 *  id — duplicates adjacent, in the order the partitions fold them. */
function expectedPairs(table: SortedMap<bigint, { text: string }>, key: (id: bigint) => bigint): { key: bigint; value: { count: bigint; text: string } }[] {
  const pairs = [...table].map(([id, row]) => ({ id, key: key(id), value: { count: 1n, text: row.text } }));
  pairs.sort((a, b) => ascending(a.key, b.key) || ascending(a.id, b.id));
  return pairs.map(({ key, value }) => ({ key, value }));
}

/**
 * The parity package on one runner. `rekeyed` maps ids to `(id / 2) * 7919
 * mod 1200`: two ids share each key within a partition, the ids 2400 apart
 * share it across partitions, and every partition's keys spread over the whole
 * key space, so all 18 partials overlap. `grouped` maps ids to `id mod 700 +
 * 10000 * (id / 1200)`: the six partitions of each 1,200-row group chain into
 * one key range (the fourth wraps around the group's whole range) and touch no
 * other group's, so the partials form three components.
 * `disjoint` maps ids to `id / 2`, which keeps each partition's keys to its
 * own range. `wide` re-keys the refinement-window rows from an array in
 * scrambled order, so every partial spans the whole key space. Values fold by
 * summing the counts and keeping the first row's text — associative, and
 * sensitive to the order the values fold in. Each job's twin streams the
 * expected rows, sorted with duplicates adjacent, through the same `merge`.
 */
function parityPackage(name: string, runner: Runner) {
  const table = e3.input('table', TableType);
  const rekeyedPairs = e3.input('rekeyed_pairs', PairsType);
  const groupedPairs = e3.input('grouped_pairs', PairsType);
  const disjointPairs = e3.input('disjoint_pairs', PairsType);
  const sortedKeys = e3.input('sorted_keys', SortedKeysType);
  const wideScrambled = e3.input('wide_scrambled', WidePairsType);
  const wideSorted = e3.input('wide_sorted', WidePairsType);
  const rangedScrambled = e3.input('ranged_scrambled', PairsType);
  const rangedSorted = e3.input('ranged_sorted', PairsType);

  /** The twin of a keyed Dict job: the expected rows, sorted with duplicates
   *  adjacent, streamed through the same fold. */
  const dictTwin = (taskName: string, pairs: DatasetDef<typeof PairsType>) => e3.streamTask(taskName, {
    stream: pairs,
    output: OutType,
    merge: ($, _key, a, b) => ({ count: a.count.add(b.count), text: a.text }),
    runner,
  }, ($, rows, emit) => {
    $.for(rows, ($, pair) => {
      $(emit(pair.key, pair.value));
    });
  });

  const rekeyed = e3.partitionTask('rekeyed', {
    partitions: [table],
    output: OutType,
    merge: ($, _key, a, b) => ({ count: a.count.add(b.count), text: a.text }),
    targetPartitionBytes: 1,
    runner,
  }, ($, slice) => slice.toDict(
    ($, _row, id) => id.divide(2n).multiply(7919n).remainder(1200n),
    ($, row, _id) => ({ count: 1n, text: row.text }),
    ($, existing, value, _key) => ({ count: existing.count.add(value.count), text: existing.text }),
  ));
  const rekeyedTwin = dictTwin('rekeyed_twin', rekeyedPairs);

  const grouped = e3.partitionTask('grouped', {
    partitions: [table],
    output: OutType,
    merge: ($, _key, a, b) => ({ count: a.count.add(b.count), text: a.text }),
    targetPartitionBytes: 1,
    runner,
  }, ($, slice) => slice.toDict(
    ($, _row, id) => id.remainder(700n).add(id.divide(1200n).multiply(10000n)),
    ($, row, _id) => ({ count: 1n, text: row.text }),
    ($, existing, value, _key) => ({ count: existing.count.add(value.count), text: existing.text }),
  ));
  const groupedTwin = dictTwin('grouped_twin', groupedPairs);

  const disjoint = e3.partitionTask('disjoint', {
    partitions: [table],
    output: OutType,
    merge: ($, _key, a, b) => ({ count: a.count.add(b.count), text: a.text }),
    targetPartitionBytes: 1,
    runner,
  }, ($, slice) => slice.toDict(
    ($, _row, id) => id.divide(2n),
    ($, row, _id) => ({ count: 1n, text: row.text }),
    ($, existing, value, _key) => ({ count: existing.count.add(value.count), text: existing.text }),
  ));
  const disjointTwin = dictTwin('disjoint_twin', disjointPairs);

  const keys = e3.partitionTask('keys', {
    partitions: [table],
    output: KeysType,
    merge: 'union',
    targetPartitionBytes: 1,
    runner,
  }, ($, slice) => slice.toSet(($, _row, id) => id.divide(2n).multiply(7919n).remainder(1200n)));
  const keysTwin = e3.streamTask('keys_twin', {
    stream: sortedKeys,
    output: KeysType,
    merge: 'union',
    runner,
  }, ($, rows, emit) => {
    $.for(rows, ($, key) => {
      $(emit(key));
    });
  });

  const wide = e3.partitionTask('wide', {
    partitions: [wideScrambled],
    output: WideType,
    merge: ($, _key, a, _b) => a,
    targetPartitionBytes: 1,
    runner,
  }, ($, slice) => slice.toDict(($, pair, _i) => pair.key, ($, pair, _i) => pair.value, ($, a, _b, _key) => a));
  const wideTwin = e3.streamTask('wide_twin', {
    stream: wideSorted,
    output: WideType,
    merge: ($, _key, a, _b) => a,
    runner,
  }, ($, rows, emit) => {
    $.for(rows, ($, pair) => {
      $(emit(pair.key, pair.value));
    });
  });
  // Partitions of half the input's segments: each partial holds more rows
  // than one segment may, so the fan-in runs per key range.
  const ranged = e3.partitionTask('ranged', {
    partitions: [rangedScrambled],
    output: OutType,
    merge: ($, _key, a, _b) => a,
    targetPartitionBytes: rangedTarget,
    runner,
  }, ($, slice) => slice.toDict(($, pair, _i) => pair.key, ($, pair, _i) => pair.value, ($, a, _b, _key) => a));
  const rangedTwin = e3.streamTask('ranged_twin', {
    stream: rangedSorted,
    output: OutType,
    merge: ($, _key, a, _b) => a,
    runner,
  }, ($, rows, emit) => {
    $.for(rows, ($, pair) => {
      $(emit(pair.key, pair.value));
    });
  });

  const tasks = { rekeyed, rekeyedTwin, grouped, groupedTwin, disjoint, disjointTwin, keys, keysTwin, wide, wideTwin, ranged, rangedTwin };
  return { tasks, pkg: e3.package(name, '1.0.0', ...Object.values(tasks)) };
}

/** Whether `binary` resolves on PATH and answers `version`. */
function onPath(binary: string): boolean {
  return spawnSync(binary, ['version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
}

const RUNNERS: { name: string; runner: Runner }[] = [
  { name: 'east-node', runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] } },
  { name: 'east-c', runner: { runtime: 'east-c', platforms: ['east-c-std'] } },
  { name: 'east-py', runner: { runtime: 'east-py', platforms: ['east-py-std'] } },
];

/** Each runner's merged outputs, for the cross-runner comparison. */
const written = new Map<string, { rekeyed: Uint8Array; keys: Uint8Array; wide: Uint8Array; ranged: Uint8Array }>();

describe('partition merge parity', () => {
  let inputDir: string;
  const inputFiles: Record<string, string> = {};

  before(() => {
    inputDir = createTestDir();
    mkdirSync(inputDir, { recursive: true });
    const table = makeTable();
    assert.ok(deflateRawSync(table.get(0n)!.text).length > 2048, 'a row is wider than 2 KB deflated');
    const wideRows = makeWideRows();
    const rangedRows = makeRangedRows();
    const rangedScrambled = rangedRows.map((_, i) => rangedRows[Number((BigInt(i) * 7919n) % BigInt(RANGED_ROWS))]!);
    // The scrambled order: every partition of the array spans the key space.
    const scrambled = wideRows.map((_, i) => wideRows[Number((BigInt(i) * 7919n) % BigInt(WIDE_ROWS))]!);
    const sortedKeys = [...table.keys()].map(rekey).sort(ascending);
    const files: Record<string, Uint8Array> = {
      table: encodeBeast2PagedFor(TableType, { batchSize: ROWS / PARTITIONS })(table),
      rekeyed_pairs: encodeBeast2PagedFor(PairsType)(expectedPairs(table, rekey)),
      grouped_pairs: encodeBeast2PagedFor(PairsType)(expectedPairs(table, groupedKey)),
      disjoint_pairs: encodeBeast2PagedFor(PairsType)(expectedPairs(table, (id) => id / 2n)),
      sorted_keys: encodeBeast2PagedFor(SortedKeysType)(sortedKeys),
      wide_scrambled: encodeBeast2PagedFor(WidePairsType, { batchSize: 200 })(scrambled),
      wide_sorted: encodeBeast2PagedFor(WidePairsType, { batchSize: 200 })(wideRows),
      ranged_scrambled: encodeBeast2PagedFor(PairsType, { batchSize: 500 })(rangedScrambled),
      ranged_sorted: encodeBeast2PagedFor(PairsType, { batchSize: 500 })(rangedRows),
    };
    // Half the ranged input's segments per partition: greedy packing cuts
    // once the next segment would exceed the target.
    const rangedExtents = readBeast2Extents(files.ranged_scrambled);
    assert.ok(rangedExtents.offsets.length >= 4, 'the ranged input has several segments');
    const half = rangedExtents.offsets.length >> 1;
    rangedTarget = rangedExtents.offsets[half]! - rangedExtents.offsets[0]!;
    // The plan packs segments greedily: a partition closes when the next
    // segment would take it over the target.
    let packed = 1;
    let acc = 0;
    for (let i = 0; i < rangedExtents.offsets.length; i++) {
      const size = (i + 1 < rangedExtents.offsets.length ? rangedExtents.offsets[i + 1]! : rangedExtents.segmentsEnd) - rangedExtents.offsets[i]!;
      if (acc > 0 && acc + size > rangedTarget) {
        packed++;
        acc = 0;
      }
      acc += size;
    }
    rangedPartitions = packed;
    assert.ok(rangedPartitions >= 2, `several partitions: ${rangedPartitions}`);
    // The premise of the per-key-range fan-in, stated rather than assumed: a
    // partial holds more rows than one segment may, so it spans several
    // whatever the keys hash to.
    assert.ok(RANGED_ROWS / rangedPartitions > SEGMENT_MAX_COUNT,
      `each partial must outgrow one segment: ${RANGED_ROWS / rangedPartitions} rows in ${rangedPartitions} partitions`);
    for (const [name, bytes] of Object.entries(files)) {
      inputFiles[name] = join(inputDir, `${name}.beast2`);
      writeFileSync(inputFiles[name], bytes);
    }
  });

  after(() => {
    removeTestDir(inputDir);
  });

  for (const { name, runner } of RUNNERS) {
    describe(name, { skip: onPath(name) ? false : `${name} not on PATH` }, () => {
      let dir: string;
      let repo: string;
      let run: { stdout: string; stderr: string };
      let tasks: ReturnType<typeof parityPackage>['tasks'];
      const storage = new LocalStorage();

      /** The stored bytes of a task's output. */
      const outputBytes = async (task: TaskDef): Promise<Uint8Array> => {
        const { hash } = await workspaceGetDatasetHash(storage, repo, 'ws', task.output.path);
        assert.ok(hash !== null, `${task.name} has an output`);
        return new Uint8Array(await storage.objects.read(repo, hash));
      };

      /** The logical execution's log lines of a partitioned task. */
      const unitLines = async (task: string): Promise<string[]> => {
        const logs = await runE3Command(['task', 'logs', repo, `ws.${task}`, '--all'], dir);
        assert.equal(logs.exitCode, 0, logs.stderr);
        return logs.stdout.split('\n').filter((line) => /^(partition|merge) /.test(line));
      };
      const mergeLines = (lines: string[]): string[] =>
        lines.filter((line) => line.startsWith('merge ')).map((line) => line.split(' ').slice(0, 6).join(' ')).sort();

      before(async () => {
        dir = createTestDir();
        mkdirSync(dir, { recursive: true });
        repo = join(dir, 'repo');
        const packageName = `parity_${name.replace('-', '_')}`;
        const built = parityPackage(packageName, runner);
        tasks = built.tasks;
        const zip = join(dir, 'parity.zip');
        await e3.export(built.pkg, zip);

        for (const args of [
          ['repo', 'create', repo],
          ['package', 'import', repo, zip],
          ['workspace', 'create', repo, 'ws'],
          ['workspace', 'deploy', repo, 'ws', `${packageName}@1.0.0`],
          ...Object.entries(inputFiles).map(([input, file]) => ['dataset', 'set', repo, `ws.${input}`, '--from-file', file]),
        ]) {
          const result = await runE3Command(args, dir);
          assert.equal(result.exitCode, 0, `e3 ${args.join(' ')}:\n${result.stderr}\n${result.stdout}`);
        }
        const result = await runE3Command(['dataflow', 'run', repo, 'ws'], dir);
        assert.equal(result.exitCode, 0, `dataflow run:\n${result.stderr}\n${result.stdout}`);
        run = result;
      });

      after(() => {
        removeTestDir(dir);
      });

      it('a re-keyed Dict merged by a function writes its streamTask twin\'s bytes', async () => {
        const lines = await unitLines('rekeyed');
        assert.equal(lines.filter((line) => new RegExp(`^partition \\d+/${PARTITIONS} completed `).test(line)).length, PARTITIONS, lines.join('\n'));
        // One component of 18 partials: one merge unit.
        assert.deepEqual(mergeLines(lines), ['merge level 1/1 unit 1/1 completed']);

        const merged = await outputBytes(tasks.rekeyed);
        assert.deepEqual(merged, await outputBytes(tasks.rekeyedTwin), 'the merged output is the twin\'s bytes');
        const value = decodeBeast2For(OutType)(merged);
        assert.equal(value.size, 1200);
        let count = 0n;
        for (const agg of value.values()) count += agg.count;
        assert.equal(count, BigInt(ROWS), 'every row is counted once');
      });

      it('a re-keyed Set merged by union writes its streamTask twin\'s bytes', async () => {
        const lines = await unitLines('keys');
        assert.deepEqual(mergeLines(lines), ['merge level 1/1 unit 1/1 completed']);
        const merged = await outputBytes(tasks.keys);
        assert.deepEqual(merged, await outputBytes(tasks.keysTwin), 'the merged output is the twin\'s bytes');
        assert.equal(decodeBeast2For(KeysType)(merged).size, 1200);
      });

      it('partials forming three components merge one unit each and equal their twin by value', async () => {
        const lines = await unitLines('grouped');
        assert.deepEqual(mergeLines(lines), [
          'merge level 1/1 unit 1/3 completed',
          'merge level 1/1 unit 2/3 completed',
          'merge level 1/1 unit 3/3 completed',
        ]);
        const spliced = decodeBeast2For(OutType)(await outputBytes(tasks.grouped));
        assert.equal(spliced.size, 2100);
        assert.ok(equalFor(OutType)(spliced, decodeBeast2For(OutType)(await outputBytes(tasks.groupedTwin))));
      });

      it('disjoint partials run no merge unit and equal their twin by value', async () => {
        const lines = await unitLines('disjoint');
        assert.equal(lines.filter((line) => line.startsWith('partition ')).length, PARTITIONS, lines.join('\n'));
        assert.deepEqual(lines.filter((line) => line.startsWith('merge ')), [], 'no merge unit ran');
        assert.doesNotMatch(run.stdout, /\[MERGE\] disjoint/);

        const spliced = decodeBeast2For(OutType)(await outputBytes(tasks.disjoint));
        assert.equal(spliced.size, ROWS / 2);
        assert.ok(equalFor(OutType)(spliced, decodeBeast2For(OutType)(await outputBytes(tasks.disjointTwin))));
      });

      it('a sink-written blob and a returned blob of one type share their header bytes', async () => {
        // The twin's output is written by the emit sink; the disjoint output
        // is spliced under the header of a partial the body returned.
        const sinkWritten = await outputBytes(tasks.rekeyedTwin);
        const returned = await outputBytes(tasks.disjoint);
        const head = (bytes: Uint8Array): Uint8Array => bytes.subarray(0, readBeast2Extents(bytes).prefixEnd);
        assert.deepEqual(head(sinkWritten), head(returned));
      });

      it('the refinement-window rows merge to their twin\'s bytes', async () => {
        // 2,200 rows: the merge's second segment is sized from the first's
        // bytes, and rows 0–379 being one character longer is the shape at
        // which one runner's refinement once landed one entry apart.
        const lines = await unitLines('wide');
        assert.deepEqual(mergeLines(lines), ['merge level 1/1 unit 1/1 completed']);
        const merged = await outputBytes(tasks.wide);
        assert.deepEqual(merged, await outputBytes(tasks.wideTwin), 'the merged output is the twin\'s bytes');
        const extents = readBeast2Extents(merged);
        assert.equal(extents.elementCount, WIDE_ROWS);
        assert.ok(extents.offsets.length >= 2, 'the output spans the refinement window');
        written.set(name, { rekeyed: await outputBytes(tasks.rekeyed), keys: await outputBytes(tasks.keys), wide: merged, ranged: await outputBytes(tasks.ranged) });
      });

      it('partials spanning several segments merge per key range, and equal their twin by value', async () => {
        const lines = await unitLines('ranged');
        // Every partial holds more rows than one segment may and its keys
        // span the whole key space, so the component cuts into ranges and
        // each is merged by its own unit — where a single-segment partial
        // would leave the component one range and one unit.
        const partitionLine = new RegExp(`^partition \\d+/${rangedPartitions} completed `);
        assert.equal(lines.filter((line) => partitionLine.test(line)).length, rangedPartitions, lines.join('\n'));
        const units = mergeLines(lines);
        assert.ok(units.length >= 2, `the fan-in ran per key range: ${units.join(', ')}`);
        assert.deepEqual(units, units.map((_, i) => `merge level 1/1 unit ${i + 1}/${units.length} completed`),
          lines.join('\n'));
        const merged = await outputBytes(tasks.ranged);
        const value = decodeBeast2For(OutType)(merged);
        assert.ok(equalFor(OutType)(value, decodeBeast2For(OutType)(await outputBytes(tasks.rangedTwin))));
        assert.equal(readBeast2Extents(merged).elementCount, RANGED_ROWS);
      });

      it('a forced re-run at another --jobs count writes the same hash for every output', async () => {
        const hashes = async (): Promise<Map<string, string | null>> => {
          const out = new Map<string, string | null>();
          for (const task of Object.values(tasks)) out.set(task.name, (await workspaceGetDatasetHash(storage, repo, 'ws', task.output.path)).hash);
          return out;
        };
        const before = await hashes();
        for (const jobs of ['1', '3']) {
          const rerun = await runE3Command(['dataflow', 'run', repo, 'ws', '--force', '--jobs', jobs], dir);
          assert.equal(rerun.exitCode, 0, `--force --jobs ${jobs}:\n${rerun.stderr}\n${rerun.stdout}`);
          assert.match(rerun.stdout, /\[DONE\] ranged /, 'the forced run executed the partitioned task');
          for (const [task, hash] of await hashes()) {
            assert.equal(hash, before.get(task), `${task}'s output hash changed on --force --jobs ${jobs}`);
          }
        }
      });
    });
  }

  it('the same rows give the same bytes on every runner', { skip: RUNNERS.filter(({ name }) => onPath(name)).length < 2 ? 'fewer than two runners on PATH' : false }, () => {
    const [first, ...rest] = [...written];
    assert.ok(first !== undefined && rest.length > 0, `outputs from ${written.size} runner(s)`);
    for (const [name, outputs] of rest) {
      assert.deepEqual(outputs.rekeyed, first[1].rekeyed, `${name}'s merged Dict differs from ${first[0]}'s`);
      assert.deepEqual(outputs.keys, first[1].keys, `${name}'s merged Set differs from ${first[0]}'s`);
      assert.deepEqual(outputs.wide, first[1].wide, `${name}'s refinement-window output differs from ${first[0]}'s`);
      assert.deepEqual(outputs.ranged, first[1].ranged, `${name}'s per-key-range merged output differs from ${first[0]}'s`);
    }
  });
});
