/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Partition merge parity (issue #770, gate (b)).
 *
 * A partitioned task's keyed fan-in runs on the task's own runner, as a tree
 * of stream executions whose sink folds equal keys, so the task must write
 * exactly the bytes a `streamTask` with the same `merge` writes for the same
 * emissions. Per runner on PATH:
 *
 * - a re-keyed `partitionTask({ merge })` whose input repeats keys within a
 *   partition and across its 20 partitions writes the bytes of its
 *   `streamTask({ merge })` twin — a Dict folded by a function, and a Set by
 *   `'union'`;
 * - a job whose partials are disjoint runs no merge unit and equals its twin
 *   by value;
 * - a blob the sink writes and a blob a returned value writes, of one type,
 *   share their header bytes, which the splice of merged and unmerged
 *   components relies on.
 *
 * Across the runners, the same emissions give the same bytes. Every output row
 * is wider than 2 KB deflated, the width at which the runners' batch
 * refinement once diverged.
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
  DictType,
  IntegerType,
  SetType,
  SortedMap,
  StringType,
  StructType,
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

const ROWS = 3600;
const PARTITIONS = 20;
const TEXT_CHARS = 4096;

/** `ROWS` rows keyed by id, each carrying `TEXT_CHARS` characters of
 *  deterministic noise, so a row stays about 3 KB once deflated. */
function makeTable(): SortedMap<bigint, { text: string }> {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let seed = 12345;
  const table = new SortedMap<bigint, { text: string }>([], compareFor(IntegerType));
  for (let id = 0; id < ROWS; id++) {
    const chars: string[] = [];
    for (let c = 0; c < TEXT_CHARS; c++) {
      seed = (seed * 48271) % 2147483647;
      chars.push(alphabet[Math.floor((seed / 2147483647) * 64)]!);
    }
    table.set(BigInt(id), { text: chars.join('') });
  }
  return table;
}

/**
 * The parity package on one runner. `rekeyed` maps ids to `(id / 2) * 7919
 * mod 1200`: two ids share each key within a partition, the ids 2400 apart
 * share it across partitions, and every partition's keys spread over the whole
 * key space, so all 20 partials overlap. `disjoint` maps ids to `id / 2`,
 * which keeps each partition's keys to its own range. Values fold by summing
 * the counts and keeping the first row's text — associative, and sensitive to
 * the order the values fold in.
 */
function parityPackage(name: string, runner: Runner) {
  const table = e3.input('table', TableType);

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
  const rekeyedTwin = e3.streamTask('rekeyed_twin', {
    stream: table,
    output: OutType,
    merge: ($, _key, a, b) => ({ count: a.count.add(b.count), text: a.text }),
    runner,
  }, ($, rows, emit) => {
    $.for(rows, ($, row, id) => {
      $(emit(id.divide(2n).multiply(7919n).remainder(1200n), { count: 1n, text: row.text }));
    });
  });

  const keys = e3.partitionTask('keys', {
    partitions: [table],
    output: KeysType,
    merge: 'union',
    targetPartitionBytes: 1,
    runner,
  }, ($, slice) => slice.toSet(($, _row, id) => id.divide(2n).multiply(7919n).remainder(1200n)));
  const keysTwin = e3.streamTask('keys_twin', {
    stream: table,
    output: KeysType,
    merge: 'union',
    runner,
  }, ($, rows, emit) => {
    $.for(rows, ($, _row, id) => {
      $(emit(id.divide(2n).multiply(7919n).remainder(1200n)));
    });
  });

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
  const disjointTwin = e3.streamTask('disjoint_twin', {
    stream: table,
    output: OutType,
    merge: ($, _key, a, b) => ({ count: a.count.add(b.count), text: a.text }),
    runner,
  }, ($, rows, emit) => {
    $.for(rows, ($, row, id) => {
      $(emit(id.divide(2n), { count: 1n, text: row.text }));
    });
  });

  return {
    tasks: { rekeyed, rekeyedTwin, keys, keysTwin, disjoint, disjointTwin },
    pkg: e3.package(name, '1.0.0', rekeyed, rekeyedTwin, keys, keysTwin, disjoint, disjointTwin),
  };
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

/** Each runner's re-keyed outputs, for the cross-runner comparison. */
const written = new Map<string, { rekeyed: Uint8Array; keys: Uint8Array }>();

describe('partition merge parity', () => {
  let tableDir: string;
  let tablePath: string;

  before(() => {
    tableDir = createTestDir();
    mkdirSync(tableDir, { recursive: true });
    const table = makeTable();
    assert.ok(deflateRawSync(table.get(0n)!.text).length > 2048, 'a row is wider than 2 KB deflated');
    tablePath = join(tableDir, 'table.beast2');
    writeFileSync(tablePath, encodeBeast2PagedFor(TableType, { batchSize: ROWS / PARTITIONS })(table));
  });

  after(() => {
    removeTestDir(tableDir);
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
          ['dataset', 'set', repo, 'ws.table', '--from-file', tablePath],
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
        assert.equal(lines.filter((line) => /^partition \d+\/20 completed /.test(line)).length, PARTITIONS, lines.join('\n'));
        // One component of 20 partials: three units at level 1, one at level 2.
        assert.deepEqual(
          lines.filter((line) => line.startsWith('merge ')).map((line) => line.split(' ').slice(0, 6).join(' ')).sort(),
          [
            'merge level 1/2 unit 1/3 completed',
            'merge level 1/2 unit 2/3 completed',
            'merge level 1/2 unit 3/3 completed',
            'merge level 2/2 unit 1/1 completed',
          ],
        );

        const merged = await outputBytes(tasks.rekeyed);
        assert.deepEqual(merged, await outputBytes(tasks.rekeyedTwin), 'the merged output is the twin\'s bytes');
        const value = decodeBeast2For(OutType)(merged);
        assert.equal(value.size, 1200);
        let count = 0n;
        for (const agg of value.values()) count += agg.count;
        assert.equal(count, BigInt(ROWS), 'every row is counted once');
        written.set(name, { rekeyed: merged, keys: await outputBytes(tasks.keys) });
      });

      it('a re-keyed Set merged by union writes its streamTask twin\'s bytes', async () => {
        const lines = await unitLines('keys');
        assert.equal(lines.filter((line) => line.startsWith('merge ')).length, 4, lines.join('\n'));
        const merged = await outputBytes(tasks.keys);
        assert.deepEqual(merged, await outputBytes(tasks.keysTwin), 'the merged output is the twin\'s bytes');
        assert.equal(decodeBeast2For(KeysType)(merged).size, 1200);
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
    });
  }

  it('the same emissions give the same bytes on every runner', { skip: RUNNERS.filter(({ name }) => onPath(name)).length < 2 ? 'fewer than two runners on PATH' : false }, () => {
    const [first, ...rest] = [...written];
    assert.ok(first !== undefined && rest.length > 0, `outputs from ${written.size} runner(s)`);
    for (const [name, outputs] of rest) {
      assert.deepEqual(outputs.rekeyed, first[1].rekeyed, `${name}'s merged Dict differs from ${first[0]}'s`);
      assert.deepEqual(outputs.keys, first[1].keys, `${name}'s merged Set differs from ${first[0]}'s`);
    }
  });
});
