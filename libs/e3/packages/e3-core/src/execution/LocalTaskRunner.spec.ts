/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ArrayType, East, IRType, StringType, encodeBeast2For, none, variant } from '@elaraai/east';
import { TaskObjectType, type ExecutionOwner, type ExecutionStatus, type TaskObject } from '@elaraai/e3-types';

import { collectNodeModulesBins, probeExecutionCache, taskExecute } from './LocalTaskRunner.js';
import { JobSlots } from './jobs.js';
import { getBootId, getPidStartTime } from './processHelpers.js';
import { uuidv7 } from '../uuid.js';
import { objectWrite } from '../storage/local/LocalObjectStore.js';
import { LocalStorage } from '../storage/local/index.js';
import { createTestRepo, removeTestRepo } from '../test-helpers.js';
import type { StorageBackend } from '../storage/interfaces.js';

describe('collectNodeModulesBins', () => {
  let root: string;

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'e3-bin-walk-'));
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // Filter out any .bin dirs the walk picks up OUTSIDE our temp subtree
  // (the walk always reaches `/` and a system-wide node_modules above the
  // temp would otherwise leak into the assertion).
  const within = (entries: string[], base: string) =>
    entries.filter((b) => b.startsWith(base + path.sep));

  it('finds .bin in the start dir', () => {
    const proj = path.join(root, 'a');
    const bin = path.join(proj, 'node_modules', '.bin');
    mkdirSync(bin, { recursive: true });
    assert.deepEqual(within(collectNodeModulesBins(proj), root), [bin]);
  });

  it('walks up to a parent .bin from a nested subdirectory (typical .repos case)', () => {
    const proj = path.join(root, 'b');
    const bin = path.join(proj, 'node_modules', '.bin');
    const nested = path.join(proj, '.repos', 'workspace_id');
    mkdirSync(bin, { recursive: true });
    mkdirSync(nested, { recursive: true });
    assert.deepEqual(within(collectNodeModulesBins(nested), root), [bin]);
  });

  it('returns an empty list when no node_modules/.bin exists in the subtree', () => {
    const island = path.join(root, 'c', 'no-modules-anywhere');
    mkdirSync(island, { recursive: true });
    assert.deepEqual(within(collectNodeModulesBins(island), root), []);
  });

  it('collects every .bin on the walk-up path, closest first', () => {
    const outer = path.join(root, 'd');
    const inner = path.join(outer, 'inner-pkg');
    const outerBin = path.join(outer, 'node_modules', '.bin');
    const innerBin = path.join(inner, 'node_modules', '.bin');
    mkdirSync(outerBin, { recursive: true });
    mkdirSync(innerBin, { recursive: true });
    assert.deepEqual(within(collectNodeModulesBins(inner), root), [innerBin, outerBin]);
  });
});

describe('taskExecute output capture', { skip: process.platform === 'win32' }, () => {
  let repo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(repo);
  });

  it('keeps every byte of a stdout flood with one append in flight and bounded pending output', async () => {
    const floodBytes = 256 * 1024 * 1024;
    // A custom bash task that floods stdout with floodBytes, then copies its input to its output.
    const commandFn = East.function(
      [ArrayType(StringType), StringType],
      ArrayType(StringType),
      ($, inputs, output) => ['bash', '-c', 'head -c 268435456 /dev/zero | tr "\\0" x; cp "$1" "$2"', '--', inputs.get(0n), output],
    );
    const task: TaskObject = {
      commandIr: await objectWrite(repo, encodeBeast2For(IRType)(commandFn.toIR().ir)),
      inputs: [],
      output: [],
      kind: none,
      metadata: none,
      runner: variant('custom', { command: [] }),
      environment: none,
    };
    const taskHash = await objectWrite(repo, encodeBeast2For(TaskObjectType)(task));
    const inputHash = await storage.objects.write(repo, new Uint8Array([1, 2, 3]));

    // A slow log: every append waits a turn before it writes. The bytes handed
    // to the log and not yet appended are what runCommand holds in memory.
    const logs = storage.logs;
    const append = logs.append.bind(logs);
    let inFlight = 0;
    let maxInFlight = 0;
    let delivered = 0;
    let appended = 0;
    let maxHeld = 0;
    let largestChunk = 0;
    logs.append = async (r, t, i, e, stream, data) => {
      if (stream !== 'stdout') return append(r, t, i, e, stream, data);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      await append(r, t, i, e, stream, data);
      appended += Buffer.byteLength(data);
      inFlight--;
    };

    const result = await taskExecute(storage, repo, taskHash, [inputHash], {
      onStdout: (data) => {
        const bytes = Buffer.byteLength(data);
        delivered += bytes;
        largestChunk = Math.max(largestChunk, bytes);
        maxHeld = Math.max(maxHeld, delivered - appended);
      },
    });

    assert.equal(result.state, 'success', result.error ?? '');
    const log = await storage.logs.read(repo, taskHash, result.inputsHash, result.executionId, 'stdout', { limit: 16 });
    assert.equal(log.totalSize, floodBytes, 'every byte is in stdout.txt');
    assert.equal(maxInFlight, 1, 'one append in flight at a time');
    assert.ok(maxHeld <= 1024 * 1024 + largestChunk,
      `output held for the log peaked at ${maxHeld} bytes, over the 1 MiB cap plus one chunk (${largestChunk})`);
  });
});

describe('stopped executions', { skip: process.platform === 'win32' }, () => {
  let repo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(repo);
  });

  /** A custom bash task running `script` with its input as "$1" and its output as "$2". */
  async function bashTask(script: string): Promise<{ taskHash: string; inputHashes: string[] }> {
    const commandFn = East.function(
      [ArrayType(StringType), StringType],
      ArrayType(StringType),
      ($, inputs, output) => ['bash', '-c', script, '--', inputs.get(0n), output],
    );
    const task: TaskObject = {
      commandIr: await objectWrite(repo, encodeBeast2For(IRType)(commandFn.toIR().ir)),
      inputs: [],
      output: [],
      kind: none,
      metadata: none,
      runner: variant('custom', { command: [] }),
      environment: none,
    };
    return {
      taskHash: await objectWrite(repo, encodeBeast2For(TaskObjectType)(task)),
      inputHashes: [await storage.objects.write(repo, new Uint8Array([1, 2, 3]))],
    };
  }

  async function stderrOf(taskHash: string, result: { inputsHash: string; executionId: string }): Promise<string> {
    return (await storage.logs.read(repo, taskHash, result.inputsHash, result.executionId, 'stderr')).data;
  }

  it('records a runner e3 stopped because the run was aborted as cancelled, naming the cause on stderr', async () => {
    const { taskHash, inputHashes } = await bashTask('echo started; sleep 30; cp "$1" "$2"');
    const abort = new AbortController();
    const result = await taskExecute(storage, repo, taskHash, inputHashes, {
      signal: abort.signal,
      onStdout: () => abort.abort(),
    });

    assert.equal(result.state, 'error');
    assert.equal(result.cancelled, true);
    assert.equal(result.error, 'cancelled: e3 stopped the runner because the run was aborted');
    const status = await storage.refs.executionGet(repo, taskHash, result.inputsHash, result.executionId);
    assert.equal(status?.type, 'error');
    assert.equal(status?.type === 'error' ? status.value.message : null, 'cancelled: e3 stopped the runner because the run was aborted');
    assert.ok((await stderrOf(taskHash, result)).endsWith('e3: cancelled: e3 stopped the runner because the run was aborted\n'));
    // Nothing is cached: the next run executes.
    assert.equal(await probeExecutionCache(storage, repo, taskHash, result.inputsHash), null);
  });

  it('records a runner stopped by the timeout as timed out', async () => {
    const { taskHash, inputHashes } = await bashTask('sleep 30; cp "$1" "$2"');
    const result = await taskExecute(storage, repo, taskHash, inputHashes, { timeout: 100 });

    assert.equal(result.state, 'error');
    assert.equal(result.cancelled, false);
    assert.equal(result.error, 'timed out: e3 stopped the runner after 100 ms');
    const status = await storage.refs.executionGet(repo, taskHash, result.inputsHash, result.executionId);
    assert.equal(status?.type === 'error' ? status.value.message : null, 'timed out: e3 stopped the runner after 100 ms');
    assert.ok((await stderrOf(taskHash, result)).endsWith('e3: timed out: e3 stopped the runner after 100 ms\n'));
  });

  it('records a runner killed by a signal from elsewhere as failed with exit code -1', async () => {
    const { taskHash, inputHashes } = await bashTask('kill -TERM $$');
    const result = await taskExecute(storage, repo, taskHash, inputHashes);

    assert.equal(result.state, 'failed');
    assert.equal(result.cancelled, false);
    assert.equal(result.exitCode, -1);
    assert.equal(result.error, 'e3: runner killed by SIGTERM');
    const status = await storage.refs.executionGet(repo, taskHash, result.inputsHash, result.executionId);
    assert.equal(status?.type === 'failed' ? status.value.exitCode : null, -1n);
    assert.ok((await stderrOf(taskHash, result)).endsWith('e3: runner killed by SIGTERM\n'));
  });

  describe('interrupted-execution repair', () => {
    const taskHash = 'a'.repeat(64);
    const inHash = 'b'.repeat(64);

    /** The pid of a process that has exited. */
    function deadPid(): number {
      const child = spawnSync(process.execPath, ['-e', '']);
      return child.pid!;
    }

    async function writeRunning(runner: { pid: number; pidStartTime: number }, owner: ExecutionOwner | null): Promise<string> {
      const executionId = uuidv7();
      const status: ExecutionStatus = variant('running', {
        executionId,
        inputHashes: [],
        startedAt: new Date(),
        pid: BigInt(runner.pid),
        pidStartTime: BigInt(runner.pidStartTime),
        bootId: await getBootId(),
      });
      await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);
      if (owner !== null) {
        await storage.refs.executionOwnerWrite!(repo, taskHash, inHash, executionId, owner);
      }
      return executionId;
    }

    const liveProcess = async () => ({ pid: process.pid, pidStartTime: await getPidStartTime(process.pid), bootId: await getBootId() });
    const deadProcess = async () => ({ pid: deadPid(), pidStartTime: 12345, bootId: await getBootId() });

    it('rewrites a running record whose runner and owner are both gone as interrupted', async () => {
      const runner = await deadProcess();
      const executionId = await writeRunning(runner, await deadProcess());

      assert.equal(await probeExecutionCache(storage, repo, taskHash, inHash), null);
      const status = await storage.refs.executionGet(repo, taskHash, inHash, executionId);
      assert.equal(status?.type, 'error');
      assert.equal(
        status?.type === 'error' ? status.value.message : null,
        `interrupted: the orchestrator exited before this execution finished (runner pid ${runner.pid})`,
      );
    });

    it('leaves a running record alone while its owner lives, while its runner lives, or with no owner', async () => {
      const liveOwner = await writeRunning(await deadProcess(), await liveProcess());
      await probeExecutionCache(storage, repo, taskHash, inHash);
      assert.equal((await storage.refs.executionGet(repo, taskHash, inHash, liveOwner))?.type, 'running');

      const liveRunner = await writeRunning(await liveProcess(), await deadProcess());
      await probeExecutionCache(storage, repo, taskHash, inHash);
      assert.equal((await storage.refs.executionGet(repo, taskHash, inHash, liveRunner))?.type, 'running');

      const noOwner = await writeRunning(await deadProcess(), null);
      await probeExecutionCache(storage, repo, taskHash, inHash);
      assert.equal((await storage.refs.executionGet(repo, taskHash, inHash, noOwner))?.type, 'running');
    });
  });

  it('runs in a scratch directory under E3_SCRATCH_DIR named after the execution and this process, removed after', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'e3-scratch-root-'));
    const previous = process.env.E3_SCRATCH_DIR;
    process.env.E3_SCRATCH_DIR = root;
    try {
      const { taskHash, inputHashes } = await bashTask('echo "$PWD"; cp "$1" "$2"');
      const result = await taskExecute(storage, repo, taskHash, inputHashes);
      assert.equal(result.state, 'success', result.error ?? '');

      const cwd = (await storage.logs.read(repo, taskHash, result.inputsHash, result.executionId, 'stdout')).data.trim();
      // The shell reports its working directory resolved, and macOS's
      // temporary directory is a symlink (/var -> /private/var).
      assert.equal(path.dirname(cwd), realpathSync(root));
      const pidStartTime = await getPidStartTime(process.pid);
      assert.match(
        path.basename(cwd),
        new RegExp(`^e3-exec-${taskHash.slice(0, 8)}-${result.inputsHash.slice(0, 8)}-${process.pid}-${pidStartTime}-\\d+$`),
      );
      assert.deepEqual(readdirSync(root), [], 'the execution removed its scratch directory');
    } finally {
      if (previous === undefined) delete process.env.E3_SCRATCH_DIR;
      else process.env.E3_SCRATCH_DIR = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes the owner sidecar beside the running record', async () => {
    const { taskHash, inputHashes } = await bashTask('cp "$1" "$2"');
    const result = await taskExecute(storage, repo, taskHash, inputHashes);
    assert.equal(result.state, 'success', result.error ?? '');
    const owner = await storage.refs.executionOwnerRead!(repo, taskHash, result.inputsHash, result.executionId);
    assert.deepEqual(owner, { pid: process.pid, pidStartTime: await getPidStartTime(process.pid), bootId: await getBootId() });
  });
});

describe('the jobs budget', { skip: process.platform === 'win32' }, () => {
  let repo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(repo);
  });

  /** A custom bash task running `script` with its input as "$1" and its
   *  output as "$2"; each call is its own task, so nothing cache-hits. */
  async function bashTask(script: string, salt: string): Promise<{ taskHash: string; inputHashes: string[] }> {
    const commandFn = East.function(
      [ArrayType(StringType), StringType],
      ArrayType(StringType),
      ($, inputs, output) => ['bash', '-c', script, salt, inputs.get(0n), output],
    );
    const task: TaskObject = {
      commandIr: await objectWrite(repo, encodeBeast2For(IRType)(commandFn.toIR().ir)),
      inputs: [],
      output: [],
      kind: none,
      metadata: none,
      runner: variant('custom', { command: [] }),
      environment: none,
    };
    return {
      taskHash: await objectWrite(repo, encodeBeast2For(TaskObjectType)(task)),
      inputHashes: [await storage.objects.write(repo, new Uint8Array([1, 2, 3]))],
    };
  }

  it('keeps at most the budget of runners in flight across concurrent executions', async () => {
    // Six executions started at once under a budget of two: each runner
    // marks itself running while it sleeps, so the most marks present at
    // once is the most runners in flight.
    const marks = mkdtempSync(path.join(tmpdir(), 'e3-jobs-'));
    try {
      const jobs = new JobSlots(2);
      const script = `touch "${marks}/$0"; sleep 0.3; rm "${marks}/$0"; cp "$1" "$2"`;
      let peakMarks = 0;
      const watcher = setInterval(() => { peakMarks = Math.max(peakMarks, readdirSync(marks).length); }, 10);
      const results = await Promise.all(Array.from({ length: 6 }, async (_, i) => {
        const { taskHash, inputHashes } = await bashTask(script, `run-${i}`);
        return taskExecute(storage, repo, taskHash, inputHashes, { jobs });
      }));
      clearInterval(watcher);
      for (const result of results) assert.equal(result.state, 'success', result.error ?? '');
      assert.equal(jobs.peak, 2, 'the budget was used in full');
      assert.ok(peakMarks <= 2, `runners in flight at once: ${peakMarks}`);
      assert.equal(jobs.inFlight, 0);
    } finally {
      rmSync(marks, { recursive: true, force: true });
    }
  });

  it('records an execution the run aborts while it waits for a slot as cancelled, without a runner', async () => {
    const jobs = new JobSlots(1);
    const abort = new AbortController();
    const holder = await bashTask('sleep 30; cp "$1" "$2"', 'holder');
    const waiter = await bashTask('cp "$1" "$2"', 'waiter');
    // The first execution takes the one slot as soon as it spawns; the
    // second then queues, and the abort reaches it there.
    const first = taskExecute(storage, repo, holder.taskHash, holder.inputHashes, { jobs, signal: abort.signal, onStdout: () => {} });
    await new Promise<void>((resolve) => {
      const poll = setInterval(() => { if (jobs.inFlight === 1) { clearInterval(poll); resolve(); } }, 10);
    });
    const second = taskExecute(storage, repo, waiter.taskHash, waiter.inputHashes, { jobs, signal: abort.signal });
    await new Promise<void>((resolve) => {
      const poll = setInterval(() => { if (jobs.queued === 1) { clearInterval(poll); resolve(); } }, 10);
    });
    abort.abort();

    const waited = await second;
    assert.equal(waited.state, 'error');
    assert.equal(waited.cancelled, true);
    assert.equal(waited.error, 'cancelled: e3 did not start the runner because the run was aborted');
    const status = await storage.refs.executionGet(repo, waiter.taskHash, waited.inputsHash, waited.executionId);
    assert.equal(status?.type === 'error' ? status.value.message : status?.type, 'cancelled: e3 did not start the runner because the run was aborted');
    const stderr = await storage.logs.read(repo, waiter.taskHash, waited.inputsHash, waited.executionId, 'stderr');
    assert.equal(stderr.data, 'e3: cancelled: e3 did not start the runner because the run was aborted\n');
    // No runner ever ran for it: the only record it has is the cancelled one.
    assert.deepEqual(await storage.refs.executionListIds(repo, waiter.taskHash, waited.inputsHash), [waited.executionId]);

    const held = await first;
    assert.equal(held.cancelled, true);
    assert.equal(held.error, 'cancelled: e3 stopped the runner because the run was aborted');
    assert.equal(jobs.inFlight, 0);
  });
});
