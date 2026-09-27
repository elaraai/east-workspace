/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The guard, end to end, as `design/e3-data-architecture.md` describes it:
 * with `--memory` below what the units need at once, a run completes, writes
 * the outputs a run with room writes, and stays under the budget plus one
 * unit.
 *
 * Two split tasks each hold a known amount of memory in every piece. A run
 * with room measures a unit's peak, `P`. The run under test then has a budget
 * of one and a half `P` at four jobs: the two tasks' first pieces start
 * together, neither measured, so each reserves nothing, and between them they
 * need two `P`. The guard stops the one started last, which runs again once
 * the most it reached fits; the rest of each stage reserves the stage's peak,
 * so they run one at a time. The runners' memory is sampled from outside
 * throughout, on the platforms the guard runs on.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import e3 from '@elaraai/e3';
import { DictType, East, IntegerType, SortedMap, compareFor, encodeBeast2For } from '@elaraai/east';
import { LocalStorage, workspaceGetDatasetHash } from '@elaraai/e3-core';
import { createTestDir, removeTestDir, runE3Command, spawnE3Command } from './helpers.js';

const RowsType = DictType(IntegerType, IntegerType);
/** The integers each piece holds while it emits: a few hundred MiB of an
 *  east-node runner's heap, long enough for two pieces to be measured side by
 *  side. */
const HELD = 4_000_000n;
/** Pieces of 16 to 256 stored bytes: a piece a segment, so each task runs as
 *  a few pieces. */
const PIECES = { E3_TEST_PIECE_BYTES: '64' };
const MiB = 2 ** 20;

/** The resident memory, in bytes, of every process beneath `pid`, not
 *  counting `pid` itself: one `ps` of every process. */
function descendantsResident(pid: number): number {
  const listing = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' });
  const children = new Map<number, { pid: number; kib: number }[]>();
  for (const line of listing.stdout.split('\n')) {
    const [child, parent, kib] = line.trim().split(/\s+/).map(Number);
    if (child === undefined || parent === undefined || kib === undefined || Number.isNaN(kib)) continue;
    children.set(parent, [...(children.get(parent) ?? []), { pid: child, kib }]);
  }
  let bytes = 0;
  const pending = [pid];
  while (pending.length > 0) {
    for (const child of children.get(pending.pop()!) ?? []) {
      bytes += child.kib * 1024;
      pending.push(child.pid);
    }
  }
  return bytes;
}

/** The stderr logs of every execution a repository holds. */
function executionLogs(repo: string): string[] {
  const logs: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name === 'stderr.txt') logs.push(readFileSync(join(dir, entry.name), 'utf8'));
    }
  };
  walk(join(repo, 'executions'));
  return logs;
}

describe('the guard', { skip: process.platform === 'win32' ? 'the guard runs on Linux and macOS' : false }, () => {
  let dir: string;

  before(() => {
    dir = createTestDir();
    mkdirSync(dir, { recursive: true });
  });

  after(() => {
    if (dir !== undefined) removeTestDir(dir);
  });

  it('completes a run whose budget its units outgrow, to the bytes a run with room writes, within the budget and one unit', async (t) => {
    const rows = e3.input('rows', RowsType);
    const heavy = (name: string) => e3.streamTask(name, {
      inputs: [e3.partition(rows)],
      output: e3.output.dict(IntegerType, IntegerType),
    }, ($, rows, emit) => {
      const held = $.let(East.Array.generate(East.value(HELD), IntegerType, ($, i) => i.multiply(3n)));
      $.for(rows, ($, amount, key) => {
        $(emit(key, amount.add(held.size())));
      });
    });
    const tasks = [heavy('heavy_a'), heavy('heavy_b')];
    const repo = join(dir, 'repo');
    const zip = join(dir, 'heavy.zip');
    await e3.export(e3.package('heavy', '1.0.0', ...tasks), zip);
    // Enough rows that each task runs as several pieces.
    const file = join(dir, 'rows.beast2');
    writeFileSync(file, encodeBeast2For(RowsType)(new SortedMap(
      Array.from({ length: 3000 }, (_, i) => [BigInt(i), BigInt(i)] as [bigint, bigint]), compareFor(IntegerType))));
    for (const args of [
      ['repo', 'create', repo],
      ['package', 'import', repo, zip],
      ['workspace', 'create', repo, 'ws'],
      ['workspace', 'deploy', repo, 'ws', 'heavy@1.0.0'],
      ['dataset', 'set', repo, 'ws.rows', '--from-file', file],
    ]) {
      const result = await runE3Command(args, dir);
      assert.equal(result.exitCode, 0, `e3 ${args.join(' ')}:\n${result.stderr}\n${result.stdout}`);
    }

    // With room: every unit's peak, and the outputs.
    const roomy = await runE3Command(['dataflow', 'run', repo, 'ws', '--jobs', '4'], dir, { env: PIECES });
    assert.equal(roomy.exitCode, 0, `${roomy.stderr}\n${roomy.stdout}`);
    const peaks: number[] = [];
    for (const task of tasks) {
      const logs = await runE3Command(['task', 'logs', repo, `ws.${task.name}`], dir);
      assert.equal(logs.exitCode, 0, logs.stderr);
      const units = logs.stdout.split('\n').filter((line) => line.startsWith('piece '));
      assert.ok(units.length >= 2, `${task.name} ran as several pieces:\n${logs.stdout}`);
      for (const line of units) peaks.push(Number(/ peak=(\d+)$/.exec(line)![1]));
    }
    const peak = Math.max(...peaks);
    const storage = new LocalStorage();
    const outputs = await Promise.all(tasks.map(async (task) => (await workspaceGetDatasetHash(storage, repo, 'ws', task.output.path)).hash));

    // Under a budget of one and a half units at four jobs, sampled throughout.
    const budget = Math.floor(1.5 * peak);
    const run = spawnE3Command(['dataflow', 'run', repo, 'ws', '--force', '--jobs', '4', '--memory', String(budget)], dir, { env: PIECES });
    let highest = 0;
    const sampler = setInterval(() => { highest = Math.max(highest, descendantsResident(run.pid)); }, 50);
    const pressed = await run.result.finally(() => clearInterval(sampler));
    assert.equal(pressed.exitCode, 0, `${pressed.stderr}\n${pressed.stdout}`);
    t.diagnostic(`unit peak ${Math.round(peak / MiB)} MiB; budget ${Math.round(budget / MiB)} MiB; the runners peaked at ${Math.round(highest / MiB)} MiB together`);

    assert.deepEqual(
      await Promise.all(tasks.map(async (task) => (await workspaceGetDatasetHash(storage, repo, 'ws', task.output.path)).hash)),
      outputs, 'the outputs a run with room writes');
    const logs = executionLogs(repo);
    assert.ok(logs.some((log) => /^e3: the guard stopped the runner at \d+ MiB, past the budget of \d+ MiB: it runs again once \d+ MiB fit$/m.test(log)),
      'the guard stopped a unit, which ran again');
    assert.ok(!logs.some((log) => /runner killed by/.test(log)), 'no runner was killed by anything but the guard');
    assert.ok(highest <= budget + peak, `the runners held ${Math.round(highest / MiB)} MiB at once, over the budget and one unit, ${Math.round((budget + peak) / MiB)} MiB`);
  });
});
