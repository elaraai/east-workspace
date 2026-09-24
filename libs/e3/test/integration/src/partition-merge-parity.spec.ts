/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Partition merge parity (issue #770, gate (b)).
 *
 * A partitioned task's keyed fan-in runs on the task's own runner — its
 * `merge` command over sorted partials, one pass each — and every runner's
 * merge writes through the same segment writer as its emit sink. Every output
 * then goes through the store's door, which re-cuts the seams of an assembly,
 * so the task must store exactly the manifest a `streamTask` with the same
 * `merge` stores for the same rows emitted in ascending key order. The twin of
 * each job is a `streamTask({ merge })` over the expected rows as a sorted
 * `Array<{ key, value }>` with duplicates adjacent, emitted in order. Per
 * runner on PATH:
 *
 * - a re-keyed `partitionTask({ merge })` whose input repeats keys within a
 *   partition and across its partitions stores its twin's manifest — a Dict
 *   folded by a function, and a Set by `'union'`;
 * - a job whose partials form three components — each merged by its own
 *   unit, the results assembled — stores its twin's manifest;
 * - a job whose partials are disjoint runs no merge unit and stores its twin's
 *   manifest;
 * - an output the sink wrote and one assembled from partials a body returned
 *   name one header;
 * - a job over wide rows — `Dict<Integer, Struct{v: String, f0..f149:
 *   Integer}>`, 2,200 rows of 5,380 characters of 64-symbol noise, rows 0–379
 *   one character longer, rows the cut rule measures by their bytes — merges
 *   per key range and stores its twin's manifest;
 * - a job whose partials each hold more rows than a segment may — so each
 *   spans several segments, the shape whose fan-in runs per key range rather
 *   than once over the component — stores its twin's manifest;
 * - a forced re-run at `--jobs 1`, one runner at a time where the first run
 *   held as many as there are CPUs, writes the same hash for every output:
 *   the bytes are a function of the inputs and the task, never of how many
 *   runners ran at once.
 *
 * Across the runners, the same rows give the same manifests: the re-keyed
 * Dict, the Set, the wide rows and the per-key-range output are identical on
 * every runner.
 *
 * The inputs are delivered in batches of the test's choosing, and the store
 * cuts each the Writer's way, so a partition is one of the Writer's segments:
 * the test plans its partitions from the Writer's own encoding of each input.
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
  East,
  IntegerType,
  SetType,
  SortedMap,
  StringType,
  StructType,
  SEGMENT_MAX_COUNT,
  compareFor,
  decodeBeast2For,
  encodeBeast2PagedFor,
  readBeast2Extents,
} from '@elaraai/east';
import { DatasetSegments, LocalStorage, readDatasetWhole, readManifest, workspaceGetDatasetHash } from '@elaraai/e3-core';
import { encodeInSegmentsOf } from '@elaraai/e3-core/test';
import { createTestDir, removeTestDir, runE3Command } from './helpers.js';

const TableType = DictType(IntegerType, StructType({ text: StringType }));
const AggType = StructType({ count: IntegerType, text: StringType });
const OutType = DictType(IntegerType, AggType);
const KeysType = SetType(IntegerType);
const PairType = StructType({ key: IntegerType, value: AggType });
const PairsType = ArrayType(PairType);
const SortedKeysType = ArrayType(IntegerType);

/** The wide row: a long string beside 150 integer fields. */
const WIDE_FIELDS = 150;
const WideRowType = StructType({
  v: StringType,
  ...Object.fromEntries(Array.from({ length: WIDE_FIELDS }, (_, k) => [`f${k}`, IntegerType])),
});
const WideType = DictType(IntegerType, WideRowType);
const WidePairType = StructType({ key: IntegerType, value: WideRowType });
const WidePairsType = ArrayType(WidePairType);

const ROWS = 3600;
const TEXT_CHARS = 4096;
const WIDE_ROWS = 2200;
const WIDE_CHARS = 5380;
const WIDE_LONGER_ROWS = 380;
/** The per-key-range fan-in's rows: narrow, and enough of them that a
 *  partition holds more than one segment can. A segment of narrow rows holds
 *  at most {@link SEGMENT_MAX_COUNT} of them, so a partial of more spans
 *  several segments whatever its keys hash to. */
const RANGED_ROWS = 10_000;
const RANGED_CHARS = 40;
/** `ranged`'s byte target — the most bytes either side of the most even
 *  split of `ranged_scrambled`'s segments in two — and the partitions the
 *  plan's greedy packing makes of it, both set once the input is written. */
let rangedTarget = 1;
let rangedPartitions = 0;
/** The partitions the table is cut into — one per segment the Writer cuts it
 *  into, at a byte target of 1 — and the first ids of the second and third
 *  thirds of them, which bound `grouped`'s groups; set once the table is
 *  written. */
let partitions = 0;
let groupBounds: [bigint, bigint] = [0n, 0n];

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

/** The wide rows, keyed by id: rows 0–379 one character longer. */
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

const intCmp = compareFor(IntegerType);
const rekey = (id: bigint): bigint => ((id / 2n) * 7919n) % 1200n;
const groupedKey = (id: bigint): bigint =>
  (id * 7919n) % 100n + (intCmp(id, groupBounds[1]) >= 0 ? 20000n : intCmp(id, groupBounds[0]) >= 0 ? 10000n : 0n);
const ascending = (a: bigint, b: bigint): number => intCmp(a, b);

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
 * key space, so all the partials overlap. `grouped` maps ids to `id * 7919
 * mod 100`, plus 10000 for each third of the partitions an id's partition
 * follows: every partial of a third spreads over that third's keys and touches
 * no other third's, so the partials form three components.
 * `disjoint` keys each row by its own id, which keeps each partition's keys to
 * its own range wherever the cut falls. `wide` re-keys the wide rows from an
 * array in scrambled order, so every partial spans the whole key space. Values
 * fold by summing the counts and keeping the first row's text — associative,
 * and sensitive to the order the values fold in. Each job's twin streams the
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
    ($, _row, id) => id.multiply(7919n).remainder(100n).add(East.greaterEqual(id, groupBounds[1]).ifElse(
      ($) => 20000n,
      ($) => East.greaterEqual(id, groupBounds[0]).ifElse(($) => 10000n, ($) => 0n),
    )),
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
    ($, _row, id) => id,
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

/** Each runner's merged outputs' hashes, for the cross-runner comparison. */
const written = new Map<string, { rekeyed: string; keys: string; wide: string; ranged: string }>();

describe('partition merge parity', () => {
  let inputDir: string;
  const inputFiles: Record<string, string> = {};

  before(() => {
    inputDir = createTestDir();
    mkdirSync(inputDir, { recursive: true });
    const table = makeTable();
    assert.ok(deflateRawSync(table.get(0n)!.text).length > 2048, 'a row is wider than 2 KB deflated');
    // One partition per segment the Writer cuts the table into, and the thirds
    // of them that bound `grouped`'s groups.
    const tableCounts = readBeast2Extents(encodeBeast2PagedFor(TableType)(table)).counts;
    partitions = tableCounts.length;
    assert.ok(partitions >= 6, `the table is cut into several segments: ${partitions}`);
    const firstIds: bigint[] = [];
    let at = 0;
    for (const count of tableCounts) {
      firstIds.push(BigInt(at));
      at += count;
    }
    groupBounds = [firstIds[Math.floor(partitions / 3)]!, firstIds[Math.floor((2 * partitions) / 3)]!];
    const wideRows = makeWideRows();
    const rangedRows = makeRangedRows();
    const rangedScrambled = rangedRows.map((_, i) => rangedRows[Number((BigInt(i) * 7919n) % BigInt(RANGED_ROWS))]!);
    // The scrambled order: every partition of the array spans the key space.
    const scrambled = wideRows.map((_, i) => wideRows[Number((BigInt(i) * 7919n) % BigInt(WIDE_ROWS))]!);
    const sortedKeys = [...table.keys()].map(rekey).sort(ascending);
    const files: Record<string, Uint8Array> = {
      table: encodeInSegmentsOf(TableType, 200)(table),
      rekeyed_pairs: encodeBeast2PagedFor(PairsType)(expectedPairs(table, rekey)),
      grouped_pairs: encodeBeast2PagedFor(PairsType)(expectedPairs(table, groupedKey)),
      disjoint_pairs: encodeBeast2PagedFor(PairsType)(expectedPairs(table, (id) => id)),
      sorted_keys: encodeBeast2PagedFor(SortedKeysType)(sortedKeys),
      wide_scrambled: encodeInSegmentsOf(WidePairsType, 200)(scrambled),
      wide_sorted: encodeInSegmentsOf(WidePairsType, 200)(wideRows),
      ranged_scrambled: encodeInSegmentsOf(PairsType, 500)(rangedScrambled),
      ranged_sorted: encodeInSegmentsOf(PairsType, 500)(rangedRows),
    };
    // The ranged input in two partitions of about equal bytes: a target of
    // the most bytes either side of the most even split of the Writer's
    // segments in two, which the plan's greedy packing then cuts once.
    const rangedExtents = readBeast2Extents(encodeBeast2PagedFor(PairsType)(rangedScrambled));
    const sizes = rangedExtents.offsets.map((offset, i) =>
      (i + 1 < rangedExtents.offsets.length ? rangedExtents.offsets[i + 1]! : rangedExtents.segmentsEnd) - offset);
    assert.ok(sizes.length >= 4, 'the ranged input has several segments');
    const total = sizes.reduce((sum, size) => sum + size, 0);
    rangedTarget = total;
    let prefix = 0;
    for (let i = 0; i + 1 < sizes.length; i++) {
      prefix += sizes[i]!;
      rangedTarget = Math.min(rangedTarget, Math.max(prefix, total - prefix));
    }
    // The plan packs segments greedily: a partition closes when the next
    // segment would take it over the target.
    let packed = 1;
    let acc = 0;
    for (const size of sizes) {
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

      /** A task's output's hash: the manifest it is stored as. */
      const outputHash = async (task: TaskDef): Promise<string> => {
        const { hash } = await workspaceGetDatasetHash(storage, repo, 'ws', task.output.path);
        assert.ok(hash !== null, `${task.name} has an output`);
        return hash;
      };
      /** A task's output, whole. */
      const outputBlob = async (task: TaskDef): Promise<Uint8Array> => readDatasetWhole(storage, repo, await outputHash(task));
      /** The merge units of one level, numbered in order. */
      const oneLevel = (units: string[]): string[] => units.map((_, i) => `merge level 1/1 unit ${i + 1}/${units.length} completed`);

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

      it('a re-keyed Dict merged by a function stores its streamTask twin\'s manifest', async () => {
        const lines = await unitLines('rekeyed');
        assert.equal(lines.filter((line) => new RegExp(`^partition \\d+/${partitions} completed `).test(line)).length, partitions, lines.join('\n'));
        // One component of every partial: one level of units, one per range.
        const units = mergeLines(lines);
        assert.ok(units.length >= 1, lines.join('\n'));
        assert.deepEqual(units, oneLevel(units), lines.join('\n'));

        assert.equal(await outputHash(tasks.rekeyed), await outputHash(tasks.rekeyedTwin), 'the merged output is the twin\'s manifest');
        const value = decodeBeast2For(OutType)(await outputBlob(tasks.rekeyed));
        assert.equal(value.size, 1200);
        let count = 0n;
        for (const agg of value.values()) count += agg.count;
        assert.equal(count, BigInt(ROWS), 'every row is counted once');
      });

      it('a re-keyed Set merged by union stores its streamTask twin\'s manifest', async () => {
        const lines = await unitLines('keys');
        const units = mergeLines(lines);
        assert.ok(units.length >= 1, lines.join('\n'));
        assert.deepEqual(units, oneLevel(units), lines.join('\n'));
        assert.equal(await outputHash(tasks.keys), await outputHash(tasks.keysTwin), 'the merged output is the twin\'s manifest');
        assert.equal(decodeBeast2For(KeysType)(await outputBlob(tasks.keys)).size, 1200);
      });

      it('partials forming three components merge one unit each and store their twin\'s manifest', async () => {
        // Every partial of a component is one segment, so each component
        // merges whole, in one unit.
        const lines = await unitLines('grouped');
        assert.deepEqual(mergeLines(lines), [
          'merge level 1/1 unit 1/3 completed',
          'merge level 1/1 unit 2/3 completed',
          'merge level 1/1 unit 3/3 completed',
        ]);
        assert.equal(await outputHash(tasks.grouped), await outputHash(tasks.groupedTwin), 'the assembled output is the twin\'s manifest');
        assert.equal(decodeBeast2For(OutType)(await outputBlob(tasks.grouped)).size, 300, 'three groups of 100 keys');
      });

      it('disjoint partials run no merge unit and store their twin\'s manifest', async () => {
        const lines = await unitLines('disjoint');
        assert.equal(lines.filter((line) => line.startsWith('partition ')).length, partitions, lines.join('\n'));
        assert.deepEqual(lines.filter((line) => line.startsWith('merge ')), [], 'no merge unit ran');
        assert.doesNotMatch(run.stdout, /\[MERGE\] disjoint/);

        assert.equal(await outputHash(tasks.disjoint), await outputHash(tasks.disjointTwin), 'the assembled output is the twin\'s manifest');
        assert.equal(decodeBeast2For(OutType)(await outputBlob(tasks.disjoint)).size, ROWS);
      });

      it('an output the sink wrote and one assembled from returned partials name one header', async () => {
        // The twin's output is written by the emit sink; the disjoint output
        // is assembled from partials the body returned.
        const sinkWritten = await readManifest(storage, repo, await outputHash(tasks.rekeyedTwin));
        const assembled = await readManifest(storage, repo, await outputHash(tasks.disjoint));
        assert.ok(sinkWritten !== null && assembled !== null, 'both outputs are manifests');
        assert.equal(sinkWritten.header, assembled.header);
      });

      it('wide rows merge per key range and store their twin\'s manifest', async () => {
        // 2,200 rows of about 6 KB: the output is cut by bytes, not by count —
        // and so is every partial, which can then span several segments and
        // merge per key range, one unit each. The ranges' outputs are
        // assembled through the store's door, which re-cuts the joins between
        // them, so the output is the twin's manifest.
        const lines = await unitLines('wide');
        const units = mergeLines(lines);
        assert.ok(units.length >= 1, lines.join('\n'));
        assert.deepEqual(units, oneLevel(units), lines.join('\n'));
        const merged = await outputHash(tasks.wide);
        assert.equal(merged, await outputHash(tasks.wideTwin), 'the merged output is the twin\'s manifest');
        const segments = await DatasetSegments.open(storage, repo, merged);
        assert.equal(segments.elementCount, WIDE_ROWS);
        assert.ok(segments.segmentCount >= 2, 'the output spans several segments');
        written.set(name, { rekeyed: await outputHash(tasks.rekeyed), keys: await outputHash(tasks.keys), wide: merged, ranged: await outputHash(tasks.ranged) });
      });

      it('partials spanning several segments merge per key range, and store their twin\'s manifest', async () => {
        const lines = await unitLines('ranged');
        // Every partial holds more rows than one segment may and its keys
        // span the whole key space, so the component cuts into ranges and
        // each is merged by its own unit — where a single-segment partial
        // would leave the component one range and one unit.
        const partitionLine = new RegExp(`^partition \\d+/${rangedPartitions} completed `);
        assert.equal(lines.filter((line) => partitionLine.test(line)).length, rangedPartitions, lines.join('\n'));
        const units = mergeLines(lines);
        assert.ok(units.length >= 2, `the fan-in ran per key range: ${units.join(', ')}`);
        assert.deepEqual(units, oneLevel(units), lines.join('\n'));
        const merged = await outputHash(tasks.ranged);
        assert.equal(merged, await outputHash(tasks.rangedTwin), 'the merged output is the twin\'s manifest');
        assert.equal((await DatasetSegments.open(storage, repo, merged)).elementCount, RANGED_ROWS);
      });

      it('a forced serial re-run writes the same hash for every output', async () => {
        const hashes = async (): Promise<Map<string, string | null>> => {
          const out = new Map<string, string | null>();
          for (const task of Object.values(tasks)) out.set(task.name, (await workspaceGetDatasetHash(storage, repo, 'ws', task.output.path)).hash);
          return out;
        };
        const before = await hashes();
        const rerun = await runE3Command(['dataflow', 'run', repo, 'ws', '--force', '--jobs', '1'], dir);
        assert.equal(rerun.exitCode, 0, `--force --jobs 1:\n${rerun.stderr}\n${rerun.stdout}`);
        assert.match(rerun.stdout, /\[DONE\] ranged /, 'the forced run executed the partitioned task');
        for (const [task, hash] of await hashes()) {
          assert.equal(hash, before.get(task), `${task}'s output hash changed on --force --jobs 1`);
        }
      });
    });
  }

  it('the same rows give the same manifests on every runner', { skip: RUNNERS.filter(({ name }) => onPath(name)).length < 2 ? 'fewer than two runners on PATH' : false }, () => {
    const [first, ...rest] = [...written];
    assert.ok(first !== undefined && rest.length > 0, `outputs from ${written.size} runner(s)`);
    for (const [name, outputs] of rest) {
      assert.equal(outputs.rekeyed, first[1].rekeyed, `${name}'s merged Dict differs from ${first[0]}'s`);
      assert.equal(outputs.keys, first[1].keys, `${name}'s merged Set differs from ${first[0]}'s`);
      assert.equal(outputs.wide, first[1].wide, `${name}'s wide-row output differs from ${first[0]}'s`);
      assert.equal(outputs.ranged, first[1].ranged, `${name}'s per-key-range merged output differs from ${first[0]}'s`);
    }
  });
});
