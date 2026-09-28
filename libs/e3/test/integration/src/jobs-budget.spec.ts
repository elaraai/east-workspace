/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The jobs budget, end to end (issue #770): `e3 dataflow run --jobs 2` over
 * three plain tasks and a task split into several pieces, none depending on
 * another, keeps exactly two runner processes in flight at once — the plain
 * tasks and the pieces draw from the same budget — and every execution
 * completes once the hold is released.
 *
 * Every body spins while a hold file exists, so the run parks with its two
 * runners up and everything else queued; the `running` execution records
 * (each naming its runner's pid) count the runners.
 *
 * Under `--memory` below every unit's peak, the same run completes: each piece
 * after the first expects more memory than the whole budget, and runs alone.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import e3 from '@elaraai/e3';
import { East, DictType, IntegerType, SortedMap, StringType, compareFor, variant } from '@elaraai/east';
import { FileSystem } from '@elaraai/east-node-std';
import { DatasetSegments, LocalStorage, workspaceGetDatasetHash, workspaceGetTaskHash } from '@elaraai/e3-core';
import { encodeInSegmentsOf } from '@elaraai/e3-core/test';
import { createTestDir, removeTestDir, runE3Command, spawnE3Command, waitFor } from './helpers.js';

const TableType = DictType(IntegerType, StringType);
const PLAIN_TASKS = ['held_a', 'held_b', 'held_c'];

describe('the jobs budget', () => {
  let dir: string;
  let repo: string;
  let hold: string;
  const storage = new LocalStorage();

  beforeEach(async () => {
    dir = createTestDir();
    mkdirSync(dir, { recursive: true });
    repo = join(dir, 'repo');
    hold = join(dir, 'hold');

    // Three plain tasks and a partitioned task, every body spinning while the
    // hold file exists.
    const seed = e3.input('seed', IntegerType, variant('value', 1n));
    const tableInput = e3.input('table', TableType);
    const plain = PLAIN_TASKS.map((name) => e3.task(name, [seed], East.function([IntegerType], IntegerType, ($, n) => {
      const holdPath = $.const(hold);
      $.while(FileSystem.exists(holdPath), (_$) => { });
      return n;
    })));
    const held = e3.streamTask('held_p', {
      inputs: [e3.partition(tableInput)],
      output: e3.output.dict(IntegerType, StringType),
    }, ($, table, emit) => {
      const holdPath = $.const(hold);
      $.while(FileSystem.exists(holdPath), (_$) => { });
      $.for(table, ($, value, key) => {
        $(emit(key, value));
      });
    });
    const zip = join(dir, 'budget.zip');
    await e3.export(e3.package('budget', '1.0.0', ...plain, held), zip);
    // Enough rows for the table to be stored in several segments, a piece
    // each at the test's piece size.
    const table = new SortedMap(Array.from({ length: 3_600 }, (_, i) => [BigInt(i), `row-${i}`] as [bigint, string]), compareFor(IntegerType));
    const tablePath = join(dir, 'table.beast2');
    writeFileSync(tablePath, encodeInSegmentsOf(TableType, 1_000)(table));

    for (const args of [
      ['repo', 'create', repo],
      ['package', 'import', repo, zip],
      ['workspace', 'create', repo, 'ws'],
      ['workspace', 'deploy', repo, 'ws', 'budget@1.0.0'],
      ['dataset', 'set', repo, 'ws.table', '--from-file', tablePath],
    ]) {
      const result = await runE3Command(args, dir);
      assert.equal(result.exitCode, 0, `e3 ${args.join(' ')}:\n${result.stderr}\n${result.stdout}`);
    }
  });

  afterEach(() => {
    removeTestDir(dir);
  });

  /** The runner pids of every `running` record across the plain tasks and
   *  the split task's pieces — not the split task's own record, whose pid is
   *  e3's. */
  async function runnersUp(e3Pid: number | undefined): Promise<number[]> {
    const pids: number[] = [];
    for (const name of [...PLAIN_TASKS, 'held_p']) {
      const taskHash = await workspaceGetTaskHash(storage, repo, 'ws', name);
      for (const { status } of await storage.refs.executionListLatest(repo, taskHash)) {
        if (status.type === 'running' && Number(status.value.pid) !== e3Pid) pids.push(Number(status.value.pid));
      }
    }
    return pids;
  }

  it('keeps exactly --jobs runners in flight across plain tasks and pieces, then completes them all', async () => {
    writeFileSync(hold, '');
    // Pieces of 64 to 1024 stored bytes: a piece a segment of the table.
    const run = spawnE3Command(['dataflow', 'run', repo, 'ws', '--jobs', '2'], dir, { env: { E3_TEST_PIECE_BYTES: '256' } });
    // Two runners come up and hold; nothing else spawns while they do.
    await waitFor(async () => (await runnersUp(run.pid)).length === 2, 30_000);
    await new Promise((resolve) => setTimeout(resolve, 750));
    const up = await runnersUp(run.pid);
    assert.equal(up.length, 2, `runners in flight under --jobs 2: ${up.join(', ')}`);

    rmSync(hold);
    const result = await run.result;
    assert.equal(result.exitCode, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Budget: 2 cores, /);
    for (const name of [...PLAIN_TASKS, 'held_p']) assert.match(result.stdout, new RegExp(`\\[DONE\\] ${name} `));
    assert.deepEqual(await runnersUp(run.pid), [], 'no runner is left running');
    // Every execution — three plain tasks, a piece per segment of the table,
    // the split task's own — succeeded.
    const { hash: tableHash } = await workspaceGetDatasetHash(storage, repo, 'ws', [variant('field', 'inputs'), variant('field', 'table')]);
    const pieces = (await DatasetSegments.open(storage, repo, tableHash!)).segmentCount;
    assert.ok(pieces > 2, `the table is stored in ${pieces} segments`);
    assert.match(result.stdout, new RegExp(`\\[PART\\] held_p ${pieces}/${pieces} `), 'every piece ran');
    let successes = 0;
    for (const name of [...PLAIN_TASKS, 'held_p']) {
      const taskHash = await workspaceGetTaskHash(storage, repo, 'ws', name);
      for (const { status } of await storage.refs.executionListLatest(repo, taskHash)) if (status.type === 'success') successes++;
    }
    assert.equal(successes, 3 + pieces + 1);
  });

  it('completes a run whose memory is below every unit\'s peak, each piece that expects more running alone', async () => {
    const result = await runE3Command(['dataflow', 'run', repo, 'ws', '--jobs', '4', '--memory', '1M'], dir, { env: { E3_TEST_PIECE_BYTES: '256' } });
    assert.equal(result.exitCode, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Budget: 4 cores, 1 MB/);
    for (const name of [...PLAIN_TASKS, 'held_p']) assert.match(result.stdout, new RegExp(`\\[DONE\\] ${name} `));
    const { hash: tableHash } = await workspaceGetDatasetHash(storage, repo, 'ws', [variant('field', 'inputs'), variant('field', 'table')]);
    const pieces = (await DatasetSegments.open(storage, repo, tableHash!)).segmentCount;
    assert.match(result.stdout, new RegExp(`\\[PART\\] held_p ${pieces}/${pieces} `), 'every piece ran');
    const { hash: outputHash } = await workspaceGetDatasetHash(storage, repo, 'ws', [variant('field', 'tasks'), variant('field', 'held_p'), variant('field', 'output')]);
    assert.equal(outputHash, tableHash, 'the pieces\' outputs join into the table they were cut from');
  });
});
