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
 * Two split tasks each hold a known amount of memory in every piece. A piece
 * reaches its peak only as it finishes, so two pieces that run freely are
 * past the budget together for about a quarter second, the guard's interval,
 * and its samples can miss them. Each piece therefore says when it holds its
 * memory, by a byte appended to a marker file, and waits there while a hold
 * file exists; the test takes the hold away once it has what it waited for,
 * and after a minute regardless, so a run never holds its pieces for ever.
 *
 * The guard compares what the runners are measured using — their resident
 * memory, sampled — against the budget, so the budget is sized from that
 * same measure. A run with room is held with its first pieces at their
 * peaks, and the most any one runner is resident then, `R`, is what a held
 * piece costs the guard. The run under test then has a budget of one and a
 * half `R` at four jobs: the two tasks' first pieces start together, neither
 * measured, so each reserves nothing, and held they are resident two `R`
 * together, past the budget until the guard acts. The guard stops the one
 * started last, which runs again once the most it reached fits; the rest of
 * each stage reserves the stage's measured peak, so they run one at a time.
 * The runners' memory is sampled from outside throughout, on the platforms
 * the guard runs on.
 *
 * A piece's reported peak is its high-water mark over its whole life, which
 * the transient garbage of building its array sets above what it is resident
 * at its peak once that garbage is collected. It is one unit, for the bound
 * the run is held to; a budget sized from it sat, at times, above what two
 * held pieces were resident together, and the guard rightly never acted.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import e3 from '@elaraai/e3';
import { DictType, East, IntegerType, SortedMap, compareFor, encodeBeast2For } from '@elaraai/east';
import { FileSystem } from '@elaraai/east-node-std';
import { LocalStorage, workspaceGetDatasetHash } from '@elaraai/e3-core';
import { createTestDir, removeTestDir, runE3Command, spawnE3Command, waitFor, type CliResult, type RunningCliProcess } from './helpers.js';

const RowsType = DictType(IntegerType, IntegerType);
/** The integers each piece holds while it emits: a few hundred MiB of an
 *  east-node runner's heap. */
const HELD = 4_000_000n;
/** Pieces of 16 to 256 stored bytes: a piece a segment, so each task runs as
 *  a few pieces. */
const PIECES = { E3_TEST_PIECE_BYTES: '64' };
const MiB = 2 ** 20;
/** How long the pieces at their peaks are sampled once they are all there:
 *  a few of the sampler's intervals. */
const SAMPLE_HELD_MS = 300;

/**
 * The resident memory, in bytes, of every process beneath `pid`, not
 * counting `pid` itself, from one `ps` of every process: the most any one of
 * them is resident, and what they are resident together.
 */
function descendantsResident(pid: number): { one: number; all: number } {
  const listing = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' });
  const children = new Map<number, { pid: number; kib: number }[]>();
  for (const line of listing.stdout.split('\n')) {
    const [child, parent, kib] = line.trim().split(/\s+/).map(Number);
    if (child === undefined || parent === undefined || kib === undefined || Number.isNaN(kib)) continue;
    children.set(parent, [...(children.get(parent) ?? []), { pid: child, kib }]);
  }
  let one = 0;
  let all = 0;
  const pending = [pid];
  while (pending.length > 0) {
    for (const child of children.get(pending.pop()!) ?? []) {
      one = Math.max(one, child.kib * 1024);
      all += child.kib * 1024;
      pending.push(child.pid);
    }
  }
  return { one, all };
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
    const hold = join(dir, 'hold');
    const atPeakMark = join(dir, 'at-peak');
    const rows = e3.input('rows', RowsType);
    const heavy = (name: string) => e3.streamTask(name, {
      inputs: [e3.partition(rows)],
      output: e3.output.dict(IntegerType, IntegerType),
    }, ($, rows, emit) => {
      const held = $.let(East.Array.generate(East.value(HELD), IntegerType, ($, i) => i.multiply(3n)));
      // At its peak, the piece says so, and waits while the hold file exists.
      const holdPath = $.const(hold);
      const atPeakPath = $.const(atPeakMark);
      $(FileSystem.appendFile(atPeakPath, '.'));
      $.while(FileSystem.exists(holdPath), (_$) => { });
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

    /** How many pieces have reached their peaks: the marker's bytes. */
    const atPeak = (): number => (existsSync(atPeakMark) ? statSync(atPeakMark).size : 0);

    /**
     * Runs the dataflow with its first pieces waiting at their peaks until
     * `until` holds, sampling the runners' resident memory every 50 ms: the
     * most any one runner was resident while they were sampled at their
     * peaks, once `until` held, and the most they were resident together over
     * the run. The hold is taken away after a minute regardless, so a run
     * never holds its pieces for ever: `released` says whether `until` held
     * first.
     */
    const runHeld = async (
      args: readonly string[],
      until: (run: RunningCliProcess) => boolean,
    ): Promise<{ result: CliResult; one: number; all: number; released: boolean }> => {
      rmSync(atPeakMark, { force: true });
      writeFileSync(hold, '');
      const run = spawnE3Command(['dataflow', 'run', repo, 'ws', ...args], dir, { env: PIECES });
      let one = 0;
      let all = 0;
      let atPeaks = false;
      const sampler = setInterval(() => {
        const resident = descendantsResident(run.pid);
        if (atPeaks) one = Math.max(one, resident.one);
        all = Math.max(all, resident.all);
      }, 50);
      const released = await waitFor(() => until(run), 60_000).then(() => true, () => false);
      atPeaks = true;
      await new Promise((resolve) => setTimeout(resolve, SAMPLE_HELD_MS));
      atPeaks = false;
      rmSync(hold);
      const result = await run.result.finally(() => clearInterval(sampler));
      return { result, one, all, released };
    };

    // With room, its first pieces held at their peaks together: what a held
    // piece is resident, R; and then, released, every unit's reported peak
    // and the outputs.
    const roomy = await runHeld(['--jobs', '4'], () => atPeak() >= 2);
    assert.equal(roomy.result.exitCode, 0, `${roomy.result.stderr}\n${roomy.result.stdout}`);
    assert.ok(roomy.released, `the two first pieces reached their peaks together:\n${roomy.result.stdout}`);
    const resident = roomy.one;
    assert.ok(resident > 0, 'a held piece was sampled');
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

    // Under a budget of one and a half held pieces at four jobs, sampled
    // throughout. The first pieces wait at their peaks until the guard has
    // stopped one; a guard that never does fails the run's assertions after
    // a minute, rather than holding the pieces for ever.
    const budget = Math.floor(1.5 * resident);
    const pressed = await runHeld(['--force', '--jobs', '4', '--memory', String(budget)], (run) => run.getStdout().includes('[REQUEUE]'));
    assert.equal(pressed.result.exitCode, 0, `${pressed.result.stderr}\n${pressed.result.stdout}`);
    assert.ok(pressed.released, `the guard stopped a first piece while the two held past the budget together:\n${pressed.result.stdout}`);
    t.diagnostic(`a held piece is resident ${Math.round(resident / MiB)} MiB and reports a peak of ${Math.round(peak / MiB)} MiB; ` +
      `budget ${Math.round(budget / MiB)} MiB; the runners peaked at ${Math.round(pressed.all / MiB)} MiB together`);

    assert.deepEqual(
      await Promise.all(tasks.map(async (task) => (await workspaceGetDatasetHash(storage, repo, 'ws', task.output.path)).hash)),
      outputs, 'the outputs a run with room writes');
    const logs = executionLogs(repo);
    assert.ok(logs.some((log) => /^e3: the guard stopped the runner at \d+ MiB, past the budget of \d+ MiB: it runs again once \d+ MiB fit$/m.test(log)),
      'the guard stopped a unit, which ran again');
    assert.ok(!logs.some((log) => /runner killed by/.test(log)), 'no runner was killed by anything but the guard');
    assert.ok(pressed.all <= budget + peak,
      `the runners held ${Math.round(pressed.all / MiB)} MiB at once, over the budget and one unit, ${Math.round((budget + peak) / MiB)} MiB`);
  });
});
