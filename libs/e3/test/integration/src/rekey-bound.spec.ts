/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The re-key's memory bound, end to end (the e3 data plan's §6, and stage 4's
 * acceptance): a `streamTask` over a partitioned Array of nested rows emits
 * them to a `dict` under keys unrelated to their order, and the dict's `merge`
 * folds equal keys. It runs on every runner on PATH, at two input sizes.
 *
 * Each key is emitted twice, once for a row in the first half of the input and
 * once for a row in the second, so equal keys fold across pieces. The `merge`
 * keeps the row with the lower id, which is associative and exact.
 *
 * - Every unit's peak memory, which its runner reports and e3 writes on the
 *   unit's line in the task's log, stays under the runner's baseline (its
 *   smallest unit's peak) plus the RunSorter's byte cap, and the larger input's
 *   highest peak is within a margin of the smaller's.
 * - e3 runs every re-key under a heap of its own.
 * - The output is the manifest the Writer writes for the value, so it is the
 *   same on every runner, and a forced re-run at `--jobs 1` writes it again.
 *
 * In CI the inputs are small, and the test's piece size splits each into
 * several pieces, every one but the last closing more than one run.
 * `E3_REKEY_SCALE=1` runs it at full scale, by hand: rows of about a
 * kilobyte, pieces of the platform's size, and runs the RunSorter closes by
 * bytes. It writes a few GB into repositories under the temp directory, so
 * point `TMPDIR` at a disk. Put this tree's runners first on PATH.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import e3, { type Runner } from '@elaraai/e3';
import {
  ArrayType,
  Beast2Writer,
  DictType,
  East,
  IntegerType,
  RUN_MAX_BYTES,
  StringType,
  StructType,
  compareFor,
  type ValueTypeOf,
} from '@elaraai/east';
import { LocalStorage, storeCollection, workspaceGetDatasetHash } from '@elaraai/e3-core';
import { createTestDir, getE3CliPath, removeTestDir, runE3Command, type CliResult } from './helpers.js';

const RowType = StructType({
  id: IntegerType,
  site: StringType,
  detail: StructType({ qty: IntegerType, note: StringType }),
});
const RowsType = ArrayType(RowType);
const OutType = DictType(IntegerType, RowType);
type Row = ValueTypeOf<typeof RowType>;

const scale = process.env.E3_REKEY_SCALE === '1';
/** The smaller input's rows; the larger holds twice as many. */
const ROWS = scale ? 1_000_000 : 100_000;
/** The characters of noise in a row's note. */
const NOTE_CHARS = scale ? 1_000 : 24;
/** The entries each row emits. */
const FANOUT = scale ? 1n : 4n;
/** The CLI's own heap, in MiB. */
const E3_HEAP_MB = scale ? 256 : 128;
/** In CI, pieces of 0.25 to 4 MB of stored bytes: each input splits into
 *  several. At full scale, the platform's. */
const PIECES: Record<string, string> = scale ? {} : { E3_TEST_PIECE_BYTES: String(1_000_000) };
const MiB = 2 ** 20;

/** Whether `binary` resolves on PATH and answers `version`. */
function onPath(binary: string): boolean {
  return spawnSync(binary, ['version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
}

const RUNNERS: { name: string; runner: Runner }[] = [
  { name: 'east-node', runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] } },
  { name: 'east-c', runner: { runtime: 'east-c', platforms: ['east-c-std'] } },
  { name: 'east-py', runner: { runtime: 'east-py', platforms: ['east-py-std'] } },
];

/** Runs the CLI under a heap of `E3_HEAP_MB`, which its runners do not inherit. */
function runE3Bounded(args: string[], cwd: string, env: Record<string, string>): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [`--max-old-space-size=${E3_HEAP_MB}`, getE3CliPath(), ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}

describe('the re-key\'s memory bound', () => {
  let dir: string;
  /** Per input size: the input file, and the expected output's entries in
   *  key order. */
  const inputs: { rows: number; file: string; expected: [bigint, Row][] }[] = [];

  before(() => {
    dir = createTestDir();
    mkdirSync(dir, { recursive: true });
    for (const rows of [ROWS, 2 * ROWS]) {
      // The rows stream to disk in batches, and each residue's first row —
      // the one the merge keeps — joins the expected output under its key.
      const half = BigInt(rows / 2) * FANOUT;
      const file = join(dir, `rows-${rows}.beast2`);
      const expected: [bigint, Row][] = [];
      let state = 12345;
      const fd = openSync(file, 'w');
      try {
        const writer = new Beast2Writer(RowsType, (bytes) => {
          for (let offset = 0; offset < bytes.length;) offset += writeSync(fd, bytes, offset, bytes.length - offset);
        });
        for (let first = 0; first < rows; first += 10_000) {
          const batch: Row[] = [];
          for (let i = first; i < Math.min(first + 10_000, rows); i++) {
            const note: string[] = [];
            for (let c = 0; c < NOTE_CHARS; c++) {
              state = (state * 48271) % 2147483647;
              note.push(String.fromCharCode(48 + (state % 75)));
            }
            const row: Row = { id: BigInt(i), site: `site-${i % 97}`, detail: { qty: BigInt(i % 1000), note: note.join('') } };
            batch.push(row);
            for (let j = 0n; j < FANOUT; j++) {
              const x = BigInt(i) * FANOUT + j;
              if (x < half) expected.push([(x * 2654435761n) % 4294967311n, row]);
            }
          }
          writer.write(batch);
        }
        writer.finish();
      } finally {
        closeSync(fd);
      }
      const cmp = compareFor(IntegerType);
      expected.sort(([a], [b]) => cmp(a, b));
      inputs.push({ rows, file, expected });
    }
  });

  after(() => {
    if (dir !== undefined) removeTestDir(dir);
  });

  for (const { name, runner } of RUNNERS) {
    it(`stays within the bound on ${name}, and writes the Writer's manifest`, { skip: onPath(name) ? false : `${name} not on PATH` }, async (t) => {
      const storage = new LocalStorage();
      /** Per input size, every unit's peak. */
      const peaks: number[][] = [];
      for (const [size, { rows, file, expected }] of inputs.entries()) {
        const repo = join(dir, `${name}-${rows}`);
        // Each residue mod `half` is emitted by row x / FANOUT and by the row
        // half a table later; the key is the residue scattered by a bijection
        // mod the prime 4294967311, so it has nothing to do with the rows'
        // order.
        const half = BigInt(rows / 2) * FANOUT;
        const input = e3.input('rows', RowsType);
        const rekeyed = e3.streamTask('rekeyed', {
          inputs: [e3.partition(input)],
          output: e3.output.dict(IntegerType, RowType, {
            merge: ($, _key, a, b) => East.lessEqual(a.id, b.id).ifElse(($) => a, ($) => b),
          }),
          runner,
        }, ($, rows, emit) => {
          $.for(rows, ($, row) => {
            $.for(East.Array.range(0n, FANOUT), ($, j) => {
              const residue = $.const(row.id.multiply(FANOUT).add(j).remainder(half));
              $(emit(residue.multiply(2654435761n).remainder(4294967311n), row));
            });
          });
        });
        const zip = join(dir, `${name}-${rows}.zip`);
        await e3.export(e3.package('rekey', '1.0.0', rekeyed), zip);
        for (const args of [
          ['repo', 'create', repo],
          ['package', 'import', repo, zip],
          ['workspace', 'create', repo, 'ws'],
          ['workspace', 'deploy', repo, 'ws', 'rekey@1.0.0'],
          ['dataset', 'set', repo, 'ws.rows', '--from-file', file],
        ]) {
          const result = await runE3Command(args, dir);
          assert.equal(result.exitCode, 0, `e3 ${args.join(' ')}:\n${result.stderr}\n${result.stdout}`);
        }

        const run = await runE3Bounded(['dataflow', 'run', repo, 'ws'], dir, PIECES);
        assert.equal(run.exitCode, 0, `the re-key under a ${E3_HEAP_MB} MiB heap:\n${run.stderr}\n${run.stdout}`);
        const logs = await runE3Command(['task', 'logs', repo, 'ws.rekeyed'], dir);
        assert.equal(logs.exitCode, 0, logs.stderr);
        const units = logs.stdout.split('\n').filter((line) => /^(piece|merge) /.test(line));
        assert.ok(units.some((line) => line.startsWith('merge ')), `equal keys merged across pieces:\n${units.join('\n')}`);
        peaks.push(units.map((line) => {
          const peak = / peak=(\d+)$/.exec(line);
          assert.ok(peak !== null, `every unit names its runner's peak: ${line}`);
          return Number(peak[1]);
        }));

        // The output is the manifest the Writer writes for the value.
        const { hash } = await workspaceGetDatasetHash(storage, repo, 'ws', rekeyed.output.path);
        assert.equal(hash, await storeCollection(storage, repo, OutType, [{ elements: expected }]), 'the output is the Writer\'s manifest');

        // So is a forced re-run at one job, of the smaller input.
        if (size === 0) {
          const serial = await runE3Bounded(['dataflow', 'run', repo, 'ws', '--force', '--jobs', '1'], dir, PIECES);
          assert.equal(serial.exitCode, 0, `--force --jobs 1:\n${serial.stderr}\n${serial.stdout}`);
          assert.equal((await workspaceGetDatasetHash(storage, repo, 'ws', rekeyed.output.path)).hash, hash, 'the same output at --jobs 1');
        }
      }

      // Every unit stays under the runner's baseline plus the RunSorter's cap,
      // and the larger input raises no unit's peak beyond a margin.
      const [small, large] = peaks as [number[], number[]];
      const baseline = Math.min(...small);
      const bound = baseline + RUN_MAX_BYTES + 32 * MiB;
      const smallMax = Math.max(...small);
      const largeMax = Math.max(...large);
      t.diagnostic(`unit peaks: baseline ${Math.round(baseline / MiB)} MiB; highest ${Math.round(smallMax / MiB)} MiB at ${ROWS} rows, ${Math.round(largeMax / MiB)} MiB at ${2 * ROWS}; bound ${Math.round(bound / MiB)} MiB`);
      for (const peak of [...small, ...large]) {
        assert.ok(peak <= bound, `a unit peaked at ${Math.round(peak / MiB)} MiB, over ${Math.round(bound / MiB)} MiB (baseline ${Math.round(baseline / MiB)} MiB)`);
      }
      assert.ok(largeMax <= smallMax * 1.25 + 16 * MiB,
        `the larger input's highest unit peak, ${Math.round(largeMax / MiB)} MiB, grew past the smaller's, ${Math.round(smallMax / MiB)} MiB`);
    });
  }
});
