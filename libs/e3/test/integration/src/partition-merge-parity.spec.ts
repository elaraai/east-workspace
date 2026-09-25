/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Partition merge parity (issue #770, gate (b)).
 *
 * A task whose output is a Dict or a Set sorts what its body emits, and folds
 * a key's values with the output's `merge` in the order they were emitted;
 * the output then goes through the store's door. So a job that emits its rows
 * in any order must store exactly the manifest its twin stores — a task that
 * emits the same rows already sorted, duplicates adjacent in the order the job
 * emits them, through the same `merge`. The jobs read their input through
 * `e3.partition`, so the comparison holds however the input is cut. Per runner
 * on PATH:
 *
 * - a re-keyed Dict, whose keys repeat within the input's segments and across
 *   them, stores its twin's manifest, and so does a re-keyed Set;
 * - a Dict keyed in three groups, one per third of the input's segments, and
 *   one keyed by id, store their twins' manifests;
 * - outputs of one type name one header, whichever task wrote them;
 * - a job over wide rows — `Dict<Integer, Struct{v: String, f0..f149:
 *   Integer}>`, 2,200 rows of 5,380 characters of 64-symbol noise, rows 0–379
 *   one character longer, rows the cut rule measures by their bytes — stores
 *   its twin's manifest;
 * - a job over 10,000 narrow rows in scrambled order stores its twin's
 *   manifest;
 * - a forced re-run at `--jobs 1`, one runner at a time where the first run
 *   held as many as there are CPUs, writes the same hash for every output:
 *   the bytes are a function of the inputs and the task, never of how many
 *   runners ran at once.
 *
 * Across the runners, the same rows give the same manifests: the re-keyed
 * Dict, the Set, the wide rows and the narrow rows are identical on every
 * runner.
 *
 * The inputs are delivered in batches of the test's choosing, and the store
 * cuts each the Writer's way: `grouped`'s groups are thirds of the Writer's
 * segments of the table.
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
import e3, { type Runner, type TaskDef } from '@elaraai/e3';
import {
  ArrayType,
  DictType,
  East,
  IntegerType,
  SetType,
  SortedMap,
  StringType,
  StructType,
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
const WidePairType = StructType({ key: IntegerType, value: WideRowType });
const WidePairsType = ArrayType(WidePairType);

const ROWS = 3600;
const TEXT_CHARS = 4096;
const WIDE_ROWS = 2200;
const WIDE_CHARS = 5380;
const WIDE_LONGER_ROWS = 380;
/** The narrow rows: enough of them to fill many segments. */
const RANGED_ROWS = 10_000;
const RANGED_CHARS = 40;
/** The first ids of the second and third thirds of the Writer's segments of
 *  the table, which bound `grouped`'s groups; set once the table is written. */
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

/** `RANGED_ROWS` narrow rows keyed by id. */
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
 *  id — duplicates adjacent, in the order the job emits them. */
function expectedPairs(table: SortedMap<bigint, { text: string }>, key: (id: bigint) => bigint): { key: bigint; value: { count: bigint; text: string } }[] {
  const pairs = [...table].map(([id, row]) => ({ id, key: key(id), value: { count: 1n, text: row.text } }));
  pairs.sort((a, b) => ascending(a.key, b.key) || ascending(a.id, b.id));
  return pairs.map(({ key, value }) => ({ key, value }));
}

/**
 * The parity package on one runner. `rekeyed` maps ids to `(id / 2) * 7919
 * mod 1200`: two neighbouring ids share each key, the ids 2400 apart share it
 * too, and every segment's keys spread over the whole key space. `grouped`
 * maps ids to `id * 7919 mod 100`, plus 10000 for each third of the table's
 * segments an id's segment follows, so each third's keys are its own.
 * `disjoint` keys each row by its own id. `wide` and `ranged` re-key rows from
 * an array in scrambled order, so every segment of it spans the whole key
 * space. Values fold by summing the counts and keeping the first row's text —
 * associative, and sensitive to the order the values fold in. Each job's twin
 * emits the expected rows, sorted with duplicates adjacent, through the same
 * `merge`.
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

  const rekeyed = e3.streamTask('rekeyed', {
    inputs: [e3.partition(table)],
    output: e3.output.dict(IntegerType, AggType, { merge: ($, _key, a, b) => ({ count: a.count.add(b.count), text: a.text }) }),
    runner,
  }, ($, table, emit) => {
    $.for(table, ($, row, id) => {
      $(emit(id.divide(2n).multiply(7919n).remainder(1200n), { count: 1n, text: row.text }));
    });
  });
  const rekeyedTwin = e3.streamTask('rekeyed_twin', {
    inputs: [rekeyedPairs],
    output: e3.output.dict(IntegerType, AggType, { merge: ($, _key, a, b) => ({ count: a.count.add(b.count), text: a.text }) }),
    runner,
  }, ($, rows, emit) => {
    $.for(rows, ($, pair) => {
      $(emit(pair.key, pair.value));
    });
  });

  const grouped = e3.streamTask('grouped', {
    inputs: [e3.partition(table)],
    output: e3.output.dict(IntegerType, AggType, { merge: ($, _key, a, b) => ({ count: a.count.add(b.count), text: a.text }) }),
    runner,
  }, ($, table, emit) => {
    $.for(table, ($, row, id) => {
      $(emit(id.multiply(7919n).remainder(100n).add(East.greaterEqual(id, groupBounds[1]).ifElse(
        ($) => 20000n,
        ($) => East.greaterEqual(id, groupBounds[0]).ifElse(($) => 10000n, ($) => 0n),
      )), { count: 1n, text: row.text }));
    });
  });
  const groupedTwin = e3.streamTask('grouped_twin', {
    inputs: [groupedPairs],
    output: e3.output.dict(IntegerType, AggType, { merge: ($, _key, a, b) => ({ count: a.count.add(b.count), text: a.text }) }),
    runner,
  }, ($, rows, emit) => {
    $.for(rows, ($, pair) => {
      $(emit(pair.key, pair.value));
    });
  });

  const disjoint = e3.streamTask('disjoint', {
    inputs: [e3.partition(table)],
    output: e3.output.dict(IntegerType, AggType, { merge: ($, _key, a, b) => ({ count: a.count.add(b.count), text: a.text }) }),
    runner,
  }, ($, table, emit) => {
    $.for(table, ($, row, id) => {
      $(emit(id, { count: 1n, text: row.text }));
    });
  });
  const disjointTwin = e3.streamTask('disjoint_twin', {
    inputs: [disjointPairs],
    output: e3.output.dict(IntegerType, AggType, { merge: ($, _key, a, b) => ({ count: a.count.add(b.count), text: a.text }) }),
    runner,
  }, ($, rows, emit) => {
    $.for(rows, ($, pair) => {
      $(emit(pair.key, pair.value));
    });
  });

  const keys = e3.streamTask('keys', {
    inputs: [e3.partition(table)],
    output: e3.output.set(IntegerType),
    runner,
  }, ($, table, emit) => {
    $.for(table, ($, _row, id) => {
      $(emit(id.divide(2n).multiply(7919n).remainder(1200n)));
    });
  });
  const keysTwin = e3.streamTask('keys_twin', {
    inputs: [sortedKeys],
    output: e3.output.set(IntegerType),
    runner,
  }, ($, rows, emit) => {
    $.for(rows, ($, key) => {
      $(emit(key));
    });
  });

  const wide = e3.streamTask('wide', {
    inputs: [e3.partition(wideScrambled)],
    output: e3.output.dict(IntegerType, WideRowType, { merge: ($, _key, a, _b) => a }),
    runner,
  }, ($, rows, emit) => {
    $.for(rows, ($, pair) => {
      $(emit(pair.key, pair.value));
    });
  });
  const wideTwin = e3.streamTask('wide_twin', {
    inputs: [wideSorted],
    output: e3.output.dict(IntegerType, WideRowType, { merge: ($, _key, a, _b) => a }),
    runner,
  }, ($, rows, emit) => {
    $.for(rows, ($, pair) => {
      $(emit(pair.key, pair.value));
    });
  });

  const ranged = e3.streamTask('ranged', {
    inputs: [e3.partition(rangedScrambled)],
    output: e3.output.dict(IntegerType, AggType, { merge: ($, _key, a, _b) => a }),
    runner,
  }, ($, rows, emit) => {
    $.for(rows, ($, pair) => {
      $(emit(pair.key, pair.value));
    });
  });
  const rangedTwin = e3.streamTask('ranged_twin', {
    inputs: [rangedSorted],
    output: e3.output.dict(IntegerType, AggType, { merge: ($, _key, a, _b) => a }),
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

/** Each runner's outputs' hashes, for the cross-runner comparison. */
const written = new Map<string, { rekeyed: string; keys: string; wide: string; ranged: string }>();

describe('partition merge parity', () => {
  let inputDir: string;
  const inputFiles: Record<string, string> = {};

  before(() => {
    inputDir = createTestDir();
    mkdirSync(inputDir, { recursive: true });
    const table = makeTable();
    assert.ok(deflateRawSync(table.get(0n)!.text).length > 2048, 'a row is wider than 2 KB deflated');
    // The thirds of the Writer's segments of the table, which bound
    // `grouped`'s groups.
    const tableCounts = readBeast2Extents(encodeBeast2PagedFor(TableType)(table)).counts;
    assert.ok(tableCounts.length >= 6, `the table is cut into several segments: ${tableCounts.length}`);
    const firstIds: bigint[] = [];
    let at = 0;
    for (const count of tableCounts) {
      firstIds.push(BigInt(at));
      at += count;
    }
    groupBounds = [firstIds[Math.floor(tableCounts.length / 3)]!, firstIds[Math.floor((2 * tableCounts.length) / 3)]!];
    const wideRows = makeWideRows();
    const rangedRows = makeRangedRows();
    const rangedScrambled = rangedRows.map((_, i) => rangedRows[Number((BigInt(i) * 7919n) % BigInt(RANGED_ROWS))]!);
    // The scrambled order: every segment of the array spans the key space.
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
          ['dataflow', 'run', repo, 'ws'],
        ]) {
          const result = await runE3Command(args, dir);
          assert.equal(result.exitCode, 0, `e3 ${args.join(' ')}:\n${result.stderr}\n${result.stdout}`);
        }
      });

      after(() => {
        removeTestDir(dir);
      });

      it('a re-keyed Dict folded by merge stores its twin\'s manifest', async () => {
        assert.equal(await outputHash(tasks.rekeyed), await outputHash(tasks.rekeyedTwin), 'the output is the twin\'s manifest');
        const value = decodeBeast2For(OutType)(await outputBlob(tasks.rekeyed));
        assert.equal(value.size, 1200);
        let count = 0n;
        for (const agg of value.values()) count += agg.count;
        assert.equal(count, BigInt(ROWS), 'every row is counted once');
      });

      it('a re-keyed Set stores its twin\'s manifest', async () => {
        assert.equal(await outputHash(tasks.keys), await outputHash(tasks.keysTwin), 'the output is the twin\'s manifest');
        assert.equal(decodeBeast2For(KeysType)(await outputBlob(tasks.keys)).size, 1200);
      });

      it('a Dict keyed in three groups stores its twin\'s manifest', async () => {
        assert.equal(await outputHash(tasks.grouped), await outputHash(tasks.groupedTwin), 'the output is the twin\'s manifest');
        assert.equal(decodeBeast2For(OutType)(await outputBlob(tasks.grouped)).size, 300, 'three groups of 100 keys');
      });

      it('a Dict keyed by id stores its twin\'s manifest', async () => {
        assert.equal(await outputHash(tasks.disjoint), await outputHash(tasks.disjointTwin), 'the output is the twin\'s manifest');
        assert.equal(decodeBeast2For(OutType)(await outputBlob(tasks.disjoint)).size, ROWS);
      });

      it('outputs of one type name one header, whichever task wrote them', async () => {
        const twin = await readManifest(storage, repo, await outputHash(tasks.rekeyedTwin));
        const job = await readManifest(storage, repo, await outputHash(tasks.disjoint));
        assert.ok(twin !== null && job !== null, 'both outputs are manifests');
        assert.equal(twin.header, job.header);
      });

      it('wide rows store their twin\'s manifest', async () => {
        // 2,200 rows of about 6 KB: the output is cut by bytes, not by count.
        const output = await outputHash(tasks.wide);
        assert.equal(output, await outputHash(tasks.wideTwin), 'the output is the twin\'s manifest');
        const segments = await DatasetSegments.open(storage, repo, output);
        assert.equal(segments.elementCount, WIDE_ROWS);
        assert.ok(segments.segmentCount >= 2, 'the output spans several segments');
        written.set(name, { rekeyed: await outputHash(tasks.rekeyed), keys: await outputHash(tasks.keys), wide: output, ranged: await outputHash(tasks.ranged) });
      });

      it('narrow rows emitted in scrambled order store their twin\'s manifest', async () => {
        const output = await outputHash(tasks.ranged);
        assert.equal(output, await outputHash(tasks.rangedTwin), 'the output is the twin\'s manifest');
        assert.equal((await DatasetSegments.open(storage, repo, output)).elementCount, RANGED_ROWS);
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
      assert.equal(outputs.rekeyed, first[1].rekeyed, `${name}'s re-keyed Dict differs from ${first[0]}'s`);
      assert.equal(outputs.keys, first[1].keys, `${name}'s re-keyed Set differs from ${first[0]}'s`);
      assert.equal(outputs.wide, first[1].wide, `${name}'s wide-row output differs from ${first[0]}'s`);
      assert.equal(outputs.ranged, first[1].ranged, `${name}'s narrow-row output differs from ${first[0]}'s`);
    }
  });
});
