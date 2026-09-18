/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Stopped executions, end to end (issue #770, gate (c)).
 *
 * - Ctrl-C during a partition: the partition and the partitioned task are
 *   recorded `error` with `cancelled:`, the partition's stderr log ends with
 *   the `e3:` line, `e3 dataflow run` prints `[CANCELLED]`, and the next run
 *   executes.
 * - The same through `LocalOrchestrator.cancel()`.
 * - `kill -9` of e3 during a partition: the runner exits with it (the stdin
 *   lifeline), the next run sweeps the scratch directory the killed run left
 *   behind, and the stopped partition is recorded `interrupted:` — under one
 *   partition at a time, and under `--jobs 4` with every partition's runner
 *   running, on east-node and, when on PATH, on east-c.
 *
 * The partitioned task runs on east-node, e3's default runner, unless a case
 * says otherwise. Its body marks that it runs and then spins while a hold
 * file exists, so each case stops a partition mid-computation, and a run with
 * the same inputs completes once the hold file is gone.
 *
 * Skipped on Windows, where a test cannot deliver SIGINT to the CLI (see
 * signal-handling.spec.ts) and a process's start time is unknown, so a dead
 * scratch-directory owner cannot be told from a live one.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import e3, { type Runner } from '@elaraai/e3';
import { DictType, IntegerType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2PagedFor, equalFor, variant } from '@elaraai/east';
import { FileSystem } from '@elaraai/east-node-std';
import {
  DataflowAbortedError,
  InMemoryStateStore,
  JobSlots,
  LocalOrchestrator,
  LocalStorage,
  workspaceGetDatasetHash,
  workspaceGetTaskHash,
  workspaceStatus,
  type TaskCompletedCallback,
} from '@elaraai/e3-core';
import { createTestDir, removeTestDir, runE3Command, spawnE3Command, waitFor } from './helpers.js';

const TableType = DictType(IntegerType, StringType);
const CANCELLED_TASK = 'cancelled: e3 stopped the partitioned run because the run was aborted';
const CANCELLED_UNIT = 'cancelled: e3 stopped the runner because the run was aborted';

/** Whether a process with this pid exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Whether `pid` has exited within `ms` — a bounded liveness wait. */
async function exitsWithin(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (alive(pid)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

/** Whether `binary` resolves on PATH and answers `version`. */
function onPath(binary: string): boolean {
  return spawnSync(binary, ['version'], { stdio: 'ignore' }).status === 0;
}

const EAST_NODE: Runner = { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] };
const KILL_RUNNERS: { name: string; runner: Runner; available: boolean }[] = [
  { name: 'east-node', runner: EAST_NODE, available: true },
  { name: 'east-c', runner: { runtime: 'east-c', platforms: ['east-c-std'] }, available: onPath('east-c') },
];

describe('stopped executions', { skip: process.platform === 'win32' ? 'no SIGINT delivery or process start times on Windows' : false }, () => {
  let dir: string;
  let repo: string;
  let started: string;
  let hold: string;
  let table: SortedMap<bigint, string>;
  const storage = new LocalStorage();

  beforeEach(() => {
    dir = createTestDir();
    mkdirSync(dir, { recursive: true });
    repo = join(dir, 'repo');
    started = join(dir, 'started');
    hold = join(dir, 'hold');
    table = new SortedMap(Array.from({ length: 40 }, (_, i) => [BigInt(i), `row-${i}`] as [bigint, string]), compareFor(IntegerType));
  });

  /** Deploys the held task on `runner`: forty rows in four segments make
   *  four partitions, one of which runs at a time under --jobs 1, all four
   *  under 4. */
  async function deploy(runner: Runner): Promise<void> {
    const tableInput = e3.input('table', TableType);
    const held = e3.partitionTask('held', {
      partitions: [tableInput],
      output: TableType,
      targetPartitionBytes: 1,
      runner,
    }, ($, slice) => {
      const startedPath = $.const(started);
      const holdPath = $.const(hold);
      $(FileSystem.writeFile(startedPath, 'running'));
      $.while(FileSystem.exists(holdPath), (_$) => { });
      return slice;
    });
    const zip = join(dir, 'held.zip');
    await e3.export(e3.package('held', '1.0.0', held), zip);
    const tablePath = join(dir, 'table.beast2');
    writeFileSync(tablePath, encodeBeast2PagedFor(TableType, { batchSize: 10 })(table));

    for (const args of [
      ['repo', 'create', repo],
      ['package', 'import', repo, zip],
      ['workspace', 'create', repo, 'ws'],
      ['workspace', 'deploy', repo, 'ws', 'held@1.0.0'],
      ['dataset', 'set', repo, 'ws.table', '--from-file', tablePath],
    ]) {
      const result = await runE3Command(args, dir);
      assert.equal(result.exitCode, 0, `e3 ${args.join(' ')}:\n${result.stderr}\n${result.stdout}`);
    }
  }

  afterEach(() => {
    removeTestDir(dir);
  });

  /** The partitioned task and its first partition are recorded cancelled,
   *  and the partition's stderr log ends with the `e3:` line. */
  async function assertCancelled(): Promise<void> {
    const status = await workspaceStatus(storage, repo, 'ws');
    const task = status.tasks.find((t) => t.name === 'held');
    assert.equal(task?.status.type === 'error' ? task.status.message : JSON.stringify(task?.status), CANCELLED_TASK);

    // The partitioned task's log names the partition that was stopped.
    const logs = await runE3Command(['task', 'logs', repo, 'ws.held', '--all'], dir);
    assert.equal(logs.exitCode, 0, logs.stderr);
    const line = /^partition 1\/4 cancelled task=([0-9a-f]{64}) inputs=([0-9a-f]{64}) execution=(\S+) duration=\d+$/m.exec(logs.stdout);
    assert.ok(line, `the partitioned task's log names the stopped partition:\n${logs.stdout}`);
    const [, taskHash, inputsHash, executionId] = line;

    const unit = await storage.refs.executionGet(repo, taskHash!, inputsHash!, executionId!);
    assert.equal(unit?.type === 'error' ? unit.value.message : unit?.type, CANCELLED_UNIT);
    const unitLogs = await runE3Command(['task', 'logs', repo, '--execution', `${taskHash}/${inputsHash}/${executionId}`, '--all'], dir);
    assert.equal(unitLogs.exitCode, 0, unitLogs.stderr);
    assert.match(unitLogs.stdout, new RegExp(`=== STDERR ===\\n(.*\\n)*e3: ${CANCELLED_UNIT}\\n?$`));
  }

  /** With the hold file gone, a run with the same inputs executes the task
   *  and writes the table back. */
  async function assertNextRunExecutes(env?: Record<string, string>): Promise<void> {
    rmSync(hold);
    const rerun = await runE3Command(['dataflow', 'run', repo, 'ws'], dir, { env });
    assert.equal(rerun.exitCode, 0, `${rerun.stderr}\n${rerun.stdout}`);
    assert.match(rerun.stdout, /\[DONE\] held/);
    const { hash } = await workspaceGetDatasetHash(storage, repo, 'ws', [variant('field', 'tasks'), variant('field', 'held'), variant('field', 'output')]);
    assert.ok(hash !== null);
    assert.ok(equalFor(TableType)(decodeBeast2For(TableType)(await storage.objects.read(repo, hash)), table));
  }

  it('Ctrl-C during a partition records the partition and the task cancelled, prints [CANCELLED], and the next run executes', async () => {
    await deploy(EAST_NODE);
    writeFileSync(hold, '');
    const run = spawnE3Command(['dataflow', 'run', repo, 'ws', '--jobs', '1'], dir);
    await waitFor(() => existsSync(started), 30_000);
    run.kill('SIGINT');
    const result = await run.result;

    assert.equal(result.exitCode, 130, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\[CANCELLED\] held/);
    assert.doesNotMatch(result.stdout, /\[FAIL\] held/);
    await assertCancelled();
    await assertNextRunExecutes();
  });

  it('LocalOrchestrator.cancel() during a partition records the same, and the next run executes', async () => {
    await deploy(EAST_NODE);
    writeFileSync(hold, '');
    const orchestrator = new LocalOrchestrator(new InMemoryStateStore());
    const completed: TaskCompletedCallback[] = [];
    const handle = await orchestrator.start(storage, repo, 'ws', {
      concurrency: 1,
      jobs: new JobSlots(1),
      onTaskComplete: (result) => { completed.push(result); },
    });
    await waitFor(() => existsSync(started), 30_000);
    await orchestrator.cancel(handle);

    await assert.rejects(orchestrator.wait(handle), (err: unknown) => err instanceof DataflowAbortedError);
    assert.deepEqual(completed.map((c) => [c.name, c.state]), [['held', 'cancelled']]);
    await assertCancelled();
    await assertNextRunExecutes();
  });

  /** kill -9 of e3 with `concurrency` partitions running on `runner`: every
   *  running partition's runner exits with e3, the next run sweeps every
   *  scratch directory the killed run left behind, and every stopped
   *  partition is recorded `interrupted:`. */
  async function assertKillMinusNine(runner: Runner, concurrency: number): Promise<void> {
    await deploy(runner);
    const scratch = join(dir, 'scratch');
    mkdirSync(scratch);
    const env = { E3_SCRATCH_DIR: scratch };
    writeFileSync(hold, '');
    const run = spawnE3Command(['dataflow', 'run', repo, 'ws', '--jobs', String(concurrency)], dir, { env });
    await waitFor(() => existsSync(started), 30_000);

    // Every running partition's record names its runner.
    const taskHash = await workspaceGetTaskHash(storage, repo, 'ws', 'held');
    const units = new Map<string, { inputsHash: string; executionId: string; pid: number }>();
    await waitFor(async () => {
      for (const { inputsHash, status } of await storage.refs.executionListLatest(repo, taskHash)) {
        if (status.type === 'running' && Number(status.value.pid) !== run.pid) {
          units.set(inputsHash, { inputsHash, executionId: status.value.executionId, pid: Number(status.value.pid) });
        }
      }
      return units.size === concurrency;
    }, 30_000);
    await waitFor(() => readdirSync(scratch).filter((name) => name.startsWith('e3-exec-')).length === concurrency, 30_000);
    const leftBehind = readdirSync(scratch).filter((name) => name.startsWith('e3-exec-'));
    assert.equal(leftBehind.length, concurrency, `${concurrency} partition(s) run: ${leftBehind.join(', ')}`);

    run.kill('SIGKILL');
    await run.result;
    for (const unit of units.values()) {
      assert.ok(await exitsWithin(unit.pid, 10_000), `runner ${unit.pid} outlived the killed e3 by 10 s`);
    }
    for (const name of leftBehind) assert.ok(existsSync(join(scratch, name)), 'the killed run left its scratch directories behind');

    await assertNextRunExecutes(env);
    for (const name of leftBehind) assert.ok(!existsSync(join(scratch, name)), `the next run swept ${name}`);
    for (const unit of units.values()) {
      const stopped = await storage.refs.executionGet(repo, taskHash, unit.inputsHash, unit.executionId);
      assert.match(
        stopped?.type === 'error' ? stopped.value.message : String(stopped?.type),
        new RegExp(`^interrupted: the orchestrator exited before this execution finished \\(runner pid ${unit.pid}\\)$`),
      );
    }
  }

  it('kill -9 of e3 during a partition: its runner exits, and the next run sweeps the scratch directory and records the partition interrupted', async () => {
    await assertKillMinusNine(EAST_NODE, 1);
  });

  for (const { name, runner, available } of KILL_RUNNERS) {
    it(`kill -9 of e3 with four partitions running on ${name}: every runner exits, and the next run sweeps every scratch directory and records each partition interrupted`,
      { skip: available ? false : `${name} not on PATH` }, async () => {
        await assertKillMinusNine(runner, 4);
      });
  }
});
