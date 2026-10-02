/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ArrayType, East, IRType, StringType, encodeBeast2For, equalFor, none, variant } from '@elaraai/east';
import { StopReasonType, TASK_OBJECT_KIND, TaskObjectType, type ExecutionOwner, type ExecutionStatus, type TaskObject } from '@elaraai/e3-types';

import { LocalTaskRunner, probeExecutionCache, taskExecute, taskExecuteUnit } from './LocalTaskRunner.js';
import { collectNodeModulesBins } from './processExec.js';
import { Budget } from './budget.js';
import type { MemorySampler } from './memory.js';
import type { UnitRequeue } from './interfaces.js';
import { getBootId, getPidStartTime } from './processHelpers.js';
import { uuidv7 } from '../uuid.js';
import { inputsHash } from '../executions.js';
import { objectWrite } from '../storage/local/LocalObjectStore.js';
import { LocalStorage } from '../storage/local/index.js';
import { HeldLogStore, createTestRepo, deadPid, logsAtEachEnd, removeTestRepo, withLogStore } from '../test-helpers.js';
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

describe('taskExecute output capture', () => {
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
      kind: TASK_OBJECT_KIND,
      body: variant('command', { commandIr: await objectWrite(repo, encodeBeast2For(IRType)(commandFn.toIR().ir)) }),
      runner: variant('custom', { command: [] }),
      inputs: [],
      output: { path: [], kind: variant('value', null) },
      role: variant('data', null),
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
    // Two chunks past the cap: the one that crosses it, and the one Node
    // delivers when the child exits and it resumes the stream to drain it.
    assert.ok(maxHeld <= 1024 * 1024 + 2 * largestChunk,
      `output held for the log peaked at ${maxHeld} bytes, over the 1 MiB cap plus two chunks (${largestChunk} each)`);
  });
});

describe('stopped executions', () => {
  let repo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(repo);
  });

  /** A custom task running `argv` followed by its input path and its output path. */
  async function customTask(argv: string[]): Promise<{ taskHash: string; inputHashes: string[] }> {
    const commandFn = East.function(
      [ArrayType(StringType), StringType],
      ArrayType(StringType),
      ($, inputs, output) => [...argv, inputs.get(0n), output],
    );
    const task: TaskObject = {
      kind: TASK_OBJECT_KIND,
      body: variant('command', { commandIr: await objectWrite(repo, encodeBeast2For(IRType)(commandFn.toIR().ir)) }),
      runner: variant('custom', { command: [] }),
      inputs: [],
      output: { path: [], kind: variant('value', null) },
      role: variant('data', null),
      environment: none,
    };
    return {
      taskHash: await objectWrite(repo, encodeBeast2For(TaskObjectType)(task)),
      inputHashes: [await storage.objects.write(repo, new Uint8Array([1, 2, 3]))],
    };
  }

  /** A custom bash task running `script` with its input as "$1" and its output as "$2". */
  const bashTask = (script: string) => customTask(['bash', '-c', script, '--']);

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
    assert.equal(status?.type, 'cancelled');
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

  it('fails the execution, not the process, when a stopped runner\'s record cannot be written', async () => {
    // The record of a runner e3 stopped is written while the scratch
    // directory is being removed: a write that fails there must reject this
    // execution, never go unhandled — Node ends a process on an unhandled
    // rejection, an e3-api-server with every run it serves.
    const { taskHash, inputHashes } = await bashTask('echo started; sleep 30; cp "$1" "$2"');
    const refs = storage.refs;
    const write = refs.executionWrite.bind(refs);
    refs.executionWrite = async (r, t, i, e, status) => {
      if (status.type === 'cancelled') throw new Error('the record cannot be written');
      return write(r, t, i, e, status);
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const abort = new AbortController();
      await assert.rejects(
        taskExecute(storage, repo, taskHash, inputHashes, { signal: abort.signal, onStdout: () => abort.abort() }),
        { message: 'the record cannot be written' },
      );
      // An unhandled rejection is reported as the event loop turns.
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(unhandled, [], 'no rejection went unhandled');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('records a runner killed by a signal from elsewhere as failed with exit code -1', {
    skip: process.platform === 'win32' ? 'Windows has no signals: a process ended from elsewhere leaves only its exit code' : false,
  }, async () => {
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

    async function writeRunning(runner: ExecutionOwner, owner: ExecutionOwner | null): Promise<string> {
      const executionId = uuidv7();
      const status: ExecutionStatus = variant('running', {
        executionId,
        inputHashes: [],
        startedAt: new Date(),
        pid: runner.pid,
        pidStartTime: runner.pidStartTime,
        bootId: await getBootId(),
        unit: false,
      });
      await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);
      if (owner !== null) {
        await storage.refs.executionOwnerWrite!(repo, taskHash, inHash, executionId, owner);
      }
      return executionId;
    }

    const liveProcess = async (): Promise<ExecutionOwner> => ({
      pid: BigInt(process.pid), pidStartTime: BigInt(await getPidStartTime(process.pid)), bootId: await getBootId(),
    });
    const deadProcess = async (): Promise<ExecutionOwner> => ({ pid: BigInt(deadPid()), pidStartTime: 12345n, bootId: await getBootId() });

    it('rewrites a running record whose runner and owner are both gone as interrupted, saying why once its log is flushed', async () => {
      const runner = await deadProcess();
      const executionId = await writeRunning(runner, await deadProcess());
      // A store that holds appends until they are flushed: the record's write
      // finds the line that says why readable.
      const logs = new HeldLogStore(storage.logs);
      const ends = logsAtEachEnd(storage.refs, logs);

      assert.equal(await probeExecutionCache(withLogStore(storage, logs), repo, taskHash, inHash), null);
      const status = await storage.refs.executionGet(repo, taskHash, inHash, executionId);
      assert.ok(status?.type === 'interrupted', `the record is ${status?.type}`);
      assert.equal(status.value.pid, runner.pid);
      const message = 'interrupted: its runner and the process or browser tab that owned it are gone';
      assert.ok(equalFor(StopReasonType)(status.value.reason, { kind: variant('owner_gone', null), message }), 'its runner and its owner are gone');
      assert.deepEqual(ends.map((end) => ({ status: end.status, stderr: end.stderr })), [{ status: 'interrupted', stderr: `e3: ${message}\n` }]);
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

    it('judges by the liveness its caller gives in place of this host\'s processes', async () => {
      // Its runner and its owner are gone here, as a unit running on another
      // host's are: the caller's liveness says whether it can still finish.
      const elsewhere = await writeRunning(await deadProcess(), await deadProcess());
      await probeExecutionCache(storage, repo, taskHash, inHash, async () => true);
      assert.equal((await storage.refs.executionGet(repo, taskHash, inHash, elsewhere))?.type, 'running');

      // And one with no owner is repaired once the caller's liveness says it
      // cannot finish.
      const noOwner = await writeRunning(await liveProcess(), null);
      await probeExecutionCache(storage, repo, taskHash, inHash, async () => false);
      assert.equal((await storage.refs.executionGet(repo, taskHash, inHash, noOwner))?.type, 'interrupted');
    });

    it('probes a unit with the liveness its caller gives', async () => {
      const { taskHash: unitTask, inputHashes } = await bashTask('cp "$1" "$2"');
      const unitHash = inputsHash(inputHashes);
      const executionId = uuidv7();
      const dead = await deadProcess();
      await storage.refs.executionOwnerWrite(repo, unitTask, unitHash, executionId, dead);
      await storage.refs.executionWrite(repo, unitTask, unitHash, executionId, variant('running', {
        executionId, inputHashes, startedAt: new Date(), pid: dead.pid, pidStartTime: dead.pidStartTime, bootId: dead.bootId, unit: true,
      }));
      const asked: string[] = [];

      const result = await taskExecuteUnit(storage, repo, unitTask, { inputs: inputHashes, merge: null, own: false }, {
        executionAlive: async (_storage, _task, inputs) => {
          asked.push(inputs);
          return true;
        },
      });
      assert.equal(result.state, 'success', result.error ?? '');
      assert.deepEqual(asked, [unitHash]);
      assert.equal((await storage.refs.executionGet(repo, unitTask, unitHash, executionId))?.type, 'running', 'the attempt the caller says still runs is left as it is');
    });
  });

  it('serves the latest attempt only when it succeeded: a success behind a failed attempt is not served', async () => {
    const taskHash = 'c'.repeat(64);
    const inHash = 'd'.repeat(64);
    const now = new Date();
    const succeeded = uuidv7();
    await storage.refs.executionWrite(repo, taskHash, inHash, succeeded, variant('success', {
      executionId: succeeded, inputHashes: [], outputHash: 'e'.repeat(64), startedAt: now, completedAt: now,
      peakBytes: none, plan: none, unit: false,
    }));
    assert.equal((await probeExecutionCache(storage, repo, taskHash, inHash))?.executionId, succeeded, 'the latest attempt, a success, is served');

    // Minted after the success's, so its id sorts after it, in the same
    // millisecond or a later one
    const failed = uuidv7();
    await storage.refs.executionWrite(repo, taskHash, inHash, failed, variant('failed', {
      executionId: failed, inputHashes: [], startedAt: now, completedAt: now, exitCode: 1n, peakBytes: none, unit: false,
    }));
    assert.equal(await probeExecutionCache(storage, repo, taskHash, inHash), null, 'the success behind a failed attempt is not');
  });

  it('runs in a scratch directory under E3_SCRATCH_DIR named after the execution attempt and this process, removed after', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'e3-scratch-root-'));
    const previous = process.env.E3_SCRATCH_DIR;
    process.env.E3_SCRATCH_DIR = root;
    try {
      // The runner reports its working directory as the platform names it —
      // node, not bash, whose MSYS form (/c/...) is no Windows path.
      const { taskHash, inputHashes } = await customTask(['node', '-e',
        'process.stdout.write(process.cwd()); require("node:fs").copyFileSync(process.argv[1], process.argv[2])']);
      const result = await taskExecute(storage, repo, taskHash, inputHashes);
      assert.equal(result.state, 'success', result.error ?? '');

      const cwd = (await storage.logs.read(repo, taskHash, result.inputsHash, result.executionId, 'stdout')).data.trim();
      // Compared resolved: macOS's temporary directory is a symlink (/var ->
      // /private/var), and Windows's may be named in its short 8.3 form.
      assert.equal(realpathSync(path.dirname(cwd)), realpathSync(root));
      const pidStartTime = await getPidStartTime(process.pid);
      assert.equal(
        path.basename(cwd),
        `e3-exec-${taskHash.slice(0, 8)}-${result.inputsHash.slice(0, 8)}-${process.pid}-${pidStartTime}-${result.executionId.replaceAll('-', '')}`,
      );
      assert.deepEqual(readdirSync(root), [], 'the execution removed its scratch directory');
    } finally {
      if (previous === undefined) delete process.env.E3_SCRATCH_DIR;
      else process.env.E3_SCRATCH_DIR = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs a task whose repository is named relative to the working directory', async () => {
    // A runner runs in its execution's scratch directory, so every path it is
    // handed must be absolute, however the caller named the repository: a
    // server given a relative --repos names each repository relative to its
    // own working directory.
    const { taskHash, inputHashes } = await customTask(['node', '-e', 'require("node:fs").copyFileSync(process.argv[1], process.argv[2])']);
    const cwd = process.cwd();
    process.chdir(path.dirname(repo));
    try {
      const result = await taskExecute(storage, path.basename(repo), taskHash, inputHashes);
      assert.equal(result.state, 'success', result.error ?? '');
      assert.equal(result.outputHash, inputHashes[0], 'its output is the bytes it copies');
    } finally {
      process.chdir(cwd);
    }
  });

  it('writes the owner sidecar before the running record', async () => {
    // A process killed between the two writes then leaves no `running` record
    // without the owner its repair needs.
    const { taskHash, inputHashes } = await bashTask('cp "$1" "$2"');
    const refs = storage.refs;
    const write = refs.executionWrite.bind(refs);
    const ownerAtRunning: (ExecutionOwner | null)[] = [];
    refs.executionWrite = async (r, t, i, e, status) => {
      if (status.type === 'running') ownerAtRunning.push(await refs.executionOwnerRead(r, t, i, e));
      return write(r, t, i, e, status);
    };
    const result = await taskExecute(storage, repo, taskHash, inputHashes);
    assert.equal(result.state, 'success', result.error ?? '');
    assert.deepEqual(ownerAtRunning, [{ pid: BigInt(process.pid), pidStartTime: BigInt(await getPidStartTime(process.pid)), bootId: await getBootId() }]);
  });

  it('records the owner its caller names, or none', async () => {
    // A host that runs an execution on another's behalf, and judges its
    // liveness itself.
    const named: ExecutionOwner = { pid: 77n, pidStartTime: 7n, bootId: 'a-host-that-launched-it' };
    for (const [owner, salt] of [[named, 'named'], [null, 'none']] as const) {
      const { taskHash, inputHashes } = await bashTask(`cp "$1" "$2" # ${salt}`);
      const result = await taskExecute(storage, repo, taskHash, inputHashes, { owner });
      assert.equal(result.state, 'success', result.error ?? '');
      assert.deepEqual(await storage.refs.executionOwnerRead(repo, taskHash, result.inputsHash, result.executionId), owner);
    }
  });
});

describe('the budget', () => {
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
      kind: TASK_OBJECT_KIND,
      body: variant('command', { commandIr: await objectWrite(repo, encodeBeast2For(IRType)(commandFn.toIR().ir)) }),
      runner: variant('custom', { command: [] }),
      inputs: [],
      output: { path: [], kind: variant('value', null) },
      role: variant('data', null),
      environment: none,
    };
    return {
      taskHash: await objectWrite(repo, encodeBeast2For(TaskObjectType)(task)),
      inputHashes: [await storage.objects.write(repo, new Uint8Array([1, 2, 3]))],
    };
  }

  it('keeps at most the budget\'s cores of runners in flight across the executions of a runner holding it', async () => {
    // Six executions started at once under a budget of two cores: each runner
    // marks itself running until the test lets it go, so the most marks
    // present at once is the most runners in flight. The test lets them go
    // once two hold the budget, however long either took to start.
    const marks = mkdtempSync(path.join(tmpdir(), 'e3-budget-'));
    const go = `${marks}-go`;
    try {
      const budget = new Budget({ cores: 2, memory: 1024 ** 3 });
      const runner = new LocalTaskRunner(repo, budget);
      // Forward slashes, as e3 hands a custom runner its own paths: bash takes
      // a Windows backslash for an escape.
      const marksDir = marks.split(path.sep).join('/');
      const goFile = go.split(path.sep).join('/');
      const script = `touch "${marksDir}/$0"; while [ ! -e "${goFile}" ]; do sleep 0.05; done; rm "${marksDir}/$0"; cp "$1" "$2"`;
      let peakMarks = 0;
      const watcher = setInterval(() => { peakMarks = Math.max(peakMarks, readdirSync(marks).length); }, 10);
      const running = Promise.all(Array.from({ length: 6 }, async (_, i) => {
        const { taskHash, inputHashes } = await bashTask(script, `run-${i}`);
        return runner.execute(storage, taskHash, inputHashes);
      }));
      await new Promise<void>((resolve) => {
        const poll = setInterval(() => { if (budget.inFlight === 2) { clearInterval(poll); resolve(); } }, 10);
      });
      writeFileSync(go, '');
      const results = await running;
      clearInterval(watcher);
      for (const result of results) assert.equal(result.state, 'success', result.error ?? '');
      assert.equal(budget.peak, 2, 'the budget was used in full');
      assert.ok(peakMarks <= 2, `runners in flight at once: ${peakMarks}`);
      assert.equal(budget.inFlight, 0);
    } finally {
      rmSync(marks, { recursive: true, force: true });
      rmSync(go, { force: true });
    }
  });

  it('reserves the memory a unit is expected to need, so units that do not fit together run one at a time', async () => {
    const runUnits = async (budget: Budget, expectedPeakBytes: number, salt: string, script: string) => {
      const runner = new LocalTaskRunner(repo, budget);
      const results = await Promise.all(['a', 'b'].map(async (name) => {
        const { taskHash, inputHashes } = await bashTask(script, `${salt}-${name}`);
        return runner.executeUnit(storage, taskHash, { inputs: inputHashes, merge: null, own: false }, { expectedPeakBytes });
      }));
      for (const result of results) assert.equal(result.state, 'success', result.error ?? '');
      assert.equal(budget.inFlight, 0);
      assert.equal(budget.reserved, 0);
    };

    const apart = new Budget({ cores: 2, memory: 1024 ** 3 });
    await runUnits(apart, 0.6 * 1024 ** 3, 'apart', 'cp "$1" "$2"');
    assert.equal(apart.peak, 1, 'two units expecting 60% of the memory each ran one at a time');

    // Each runner marks itself up and waits until both are, so the two are in
    // flight together however long either takes to start; were they never
    // granted together, each would go on after a long while, and the peak
    // below fail
    const marks = mkdtempSync(path.join(tmpdir(), 'e3-together-'));
    try {
      const marksDir = marks.split(path.sep).join('/');
      const bothUp = `touch "${marksDir}/$0"; for i in $(seq 200); do [ "$(ls "${marksDir}" | wc -l)" -ge 2 ] && break; sleep 0.05; done; cp "$1" "$2"`;
      const together = new Budget({ cores: 2, memory: 1024 ** 3 });
      await runUnits(together, 0.4 * 1024 ** 3, 'together', bothUp);
      assert.equal(together.peak, 2, 'two expecting 40% each ran at once');
    } finally {
      rmSync(marks, { recursive: true, force: true });
    }
  });

  it('tells its caller while an execution waits for room, with what it waits to reserve, and when it no longer waits', async () => {
    const budget = new Budget({ cores: 1, memory: 1024 ** 3 });
    const held = await budget.acquire();
    const { taskHash, inputHashes } = await bashTask('cp "$1" "$2"', 'waiting');
    const waits: (number | null)[] = [];
    const run = new LocalTaskRunner(repo, budget).executeUnit(storage, taskHash, { inputs: inputHashes, merge: null, own: false },
      { expectedPeakBytes: 64 * 1024 ** 2, onWaiting: (needs) => waits.push(needs) });
    await new Promise<void>((resolve) => {
      const poll = setInterval(() => { if (budget.queued === 1) { clearInterval(poll); resolve(); } }, 10);
    });
    assert.deepEqual(waits, [64 * 1024 ** 2]);
    held.release();
    const result = await run;
    assert.equal(result.state, 'success', result.error ?? '');
    assert.deepEqual(waits, [64 * 1024 ** 2, null]);
  });

  it('records an execution the run aborts while it waits for the budget as cancelled, without a runner', async () => {
    const budget = new Budget({ cores: 1, memory: 1024 ** 3 });
    const abort = new AbortController();
    const holder = await bashTask('sleep 30; cp "$1" "$2"', 'holder');
    const waiter = await bashTask('cp "$1" "$2"', 'waiter');
    // The first execution takes the one core as soon as it spawns; the
    // second then queues, and the abort reaches it there.
    const first = taskExecute(storage, repo, holder.taskHash, holder.inputHashes, { budget, signal: abort.signal, onStdout: () => {} });
    await new Promise<void>((resolve) => {
      const poll = setInterval(() => { if (budget.inFlight === 1) { clearInterval(poll); resolve(); } }, 10);
    });
    const second = taskExecute(storage, repo, waiter.taskHash, waiter.inputHashes, { budget, signal: abort.signal });
    await new Promise<void>((resolve) => {
      const poll = setInterval(() => { if (budget.queued === 1) { clearInterval(poll); resolve(); } }, 10);
    });
    abort.abort();

    const waited = await second;
    assert.equal(waited.state, 'error');
    assert.equal(waited.cancelled, true);
    assert.equal(waited.error, 'cancelled: e3 did not start the runner because the run was aborted');
    const status = await storage.refs.executionGet(repo, waiter.taskHash, waited.inputsHash, waited.executionId);
    assert.equal(status?.type, 'cancelled');
    const stderr = await storage.logs.read(repo, waiter.taskHash, waited.inputsHash, waited.executionId, 'stderr');
    assert.equal(stderr.data, 'e3: cancelled: e3 did not start the runner because the run was aborted\n');
    // No runner ever ran for it: the only record it has is the cancelled one.
    assert.deepEqual(await storage.refs.executionListIds(repo, waiter.taskHash, waited.inputsHash), [waited.executionId]);

    const held = await first;
    assert.equal(held.cancelled, true);
    assert.equal(held.error, 'cancelled: e3 stopped the runner because the run was aborted');
    assert.equal(budget.inFlight, 0);
  });

  it('holds a function call through a runner holding the budget until it has a core', async () => {
    const budget = new Budget({ cores: 1, memory: 1024 ** 3 });
    const runner = new LocalTaskRunner(repo, budget);
    const held = await budget.acquire();
    const abort = new AbortController();
    const call = runner.runDetached({
      bodyIr: new Uint8Array([1]),
      args: [],
      runner: variant('custom', { command: ['false'] }),
      limits: { timeoutMs: 10_000, maxResultBytes: 1024, maxLogBytes: 1024 },
    }, { signal: abort.signal });
    await new Promise<void>((resolve) => {
      const poll = setInterval(() => { if (budget.queued === 1) { clearInterval(poll); resolve(); } }, 10);
    });
    // Aborted while it waits, it ends as an aborted call does, having spawned nothing.
    abort.abort();
    assert.deepEqual(await call, { kind: 'failed', exitCode: -1, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false });
    held.release();
    assert.equal(budget.inFlight, 0);
  });
});

describe('the guard', () => {
  let repo: string;
  let storage: StorageBackend;
  let marks: string;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
    marks = mkdtempSync(path.join(tmpdir(), 'e3-guard-'));
  });

  afterEach(() => {
    removeTestRepo(repo);
    rmSync(marks, { recursive: true, force: true });
  });

  const MiB = 1024 ** 2;

  /** A custom bash task that marks each attempt, holds on for `seconds` — its
   *  first attempt alone, given `firstOnly` — and copies its input to its
   *  output. */
  async function markingTask(seconds: number, salt: string, firstOnly = false): Promise<{ taskHash: string; inputHashes: string[] }> {
    // Forward slashes, as e3 hands a custom runner its own paths.
    const attemptsFile = `${marks.split(path.sep).join('/')}/attempts`;
    const hold = firstOnly ? `[ "$(wc -l < "${attemptsFile}")" -ge 2 ] || sleep ${seconds}` : `sleep ${seconds}`;
    const script = `echo x >> "${attemptsFile}"; ${hold}; cp "$1" "$2"`;
    const commandFn = East.function(
      [ArrayType(StringType), StringType],
      ArrayType(StringType),
      ($, inputs, output) => ['bash', '-c', script, salt, inputs.get(0n), output],
    );
    const task: TaskObject = {
      kind: TASK_OBJECT_KIND,
      body: variant('command', { commandIr: await objectWrite(repo, encodeBeast2For(IRType)(commandFn.toIR().ir)) }),
      runner: variant('custom', { command: [] }),
      inputs: [],
      output: { path: [], kind: variant('value', null) },
      role: variant('data', null),
      environment: none,
    };
    return {
      taskHash: await objectWrite(repo, encodeBeast2For(TaskObjectType)(task)),
      inputHashes: [await storage.objects.write(repo, new Uint8Array([1, 2, 3]))],
    };
  }

  const attempts = (): number => readFileSync(path.join(marks, 'attempts'), 'utf8').split('\n').filter((line) => line !== '').length;
  // The samplers below report the pressure only once a runner has marked its
  // attempt: bash can take longer to start on Windows than the guard takes to
  // stop it, and a runner stopped before its mark would go uncounted.
  const marked = (): boolean => existsSync(path.join(marks, 'attempts'));

  it('runs a unit it stopped past the budget again, reserving what the unit reached, under the same execution, to the same bytes', async () => {
    // The first runner measured is past the budget; any later one is small.
    let first: number | undefined;
    const sampler: MemorySampler = {
      sample: async (runners) => new Map(runners.map((runner) => {
        first ??= runner.pid;
        return [runner.pid, runner.pid === first && marked() ? 150 * MiB : MiB];
      })),
      machine: async () => null,
    };
    const budget = new Budget({ cores: 2, memory: 100 * MiB }, { sampler, sampleMs: 10 });
    // The first attempt holds on until the guard stops it, however long the
    // guard takes to sample it; the attempt the guard runs again copies at once
    const { taskHash, inputHashes } = await markingTask(30, 'past the budget', true);
    const requeues: UnitRequeue[] = [];
    const result = await new LocalTaskRunner(repo, budget).executeUnit(storage, taskHash, { inputs: inputHashes, merge: null, own: false },
      { expectedPeakBytes: 10 * MiB, onRequeued: (requeue) => requeues.push(requeue) });

    assert.equal(result.state, 'success', result.error ?? '');
    assert.equal(attempts(), 2);
    assert.deepEqual(requeues, [{ reason: 'budget', peak: 150 * MiB, reserves: 150 * MiB }], 'its caller hears the requeue');
    const stderr = (await storage.logs.read(repo, taskHash, inputsHash(inputHashes), result.executionId, 'stderr')).data;
    assert.ok(stderr.includes('e3: the guard stopped the runner at 150 MiB, past the budget of 100 MiB: it runs again once 150 MiB fit\n'), stderr);
    assert.deepEqual(await storage.refs.executionListIds(repo, taskHash, inputsHash(inputHashes)), [result.executionId], 'one execution, run twice');
    assert.equal(result.outputHash, inputHashes[0], 'its output is the bytes it copies');
    assert.equal(budget.inFlight, 0);
  });

  it('leaves a task past the budget running', async () => {
    const sampler: MemorySampler = {
      sample: async (runners) => new Map(runners.map((runner) => [runner.pid, 150 * MiB])),
      machine: async () => null,
    };
    const budget = new Budget({ cores: 2, memory: 100 * MiB }, { sampler, sampleMs: 10 });
    const { taskHash, inputHashes } = await markingTask(0.3, 'a task');
    const result = await new LocalTaskRunner(repo, budget).execute(storage, taskHash, inputHashes);

    assert.equal(result.state, 'success', result.error ?? '');
    assert.equal(attempts(), 1);
  });

  it('fails a task it stopped with the machine nearly out of memory, and a function call', async () => {
    const sampler: MemorySampler = {
      sample: async (runners) => new Map(runners.map((runner) => [runner.pid, 20 * MiB])),
      machine: async () => (marked() ? { available: 1, total: 100 } : null),
    };
    const budget = new Budget({ cores: 2, memory: 100 * MiB }, { sampler, sampleMs: 10 });
    const runner = new LocalTaskRunner(repo, budget);
    const { taskHash, inputHashes } = await markingTask(30, 'the machine');
    const result = await runner.execute(storage, taskHash, inputHashes);

    const cause = 'the guard stopped the runner at 20 MiB, with the machine nearly out of memory';
    assert.equal(result.state, 'failed');
    assert.equal(result.exitCode, -1);
    assert.equal(result.error, `e3: ${cause}`);
    const status = await storage.refs.executionGet(repo, taskHash, inputsHash(inputHashes), result.executionId);
    assert.equal(status?.type, 'failed');
    assert.equal(attempts(), 1, 'not run again');

    const call = await runner.runDetached({
      bodyIr: new Uint8Array([1]),
      args: [],
      runner: variant('custom', { command: ['bash', '-c', 'sleep 30', '--'] }),
      limits: { timeoutMs: 60_000, maxResultBytes: 1024, maxLogBytes: 1024 },
    });
    assert.equal(call.kind, 'failed');
    assert.equal(call.kind === 'failed' ? call.exitCode : null, -1);
    assert.ok(call.stderr.endsWith(`e3: ${cause}`), call.stderr);
    assert.equal(budget.inFlight, 0);
  });
});

describe('the caller\'s environment', () => {
  let repo: string;
  let storage: StorageBackend;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(repo);
  });

  /** What a runner prints: the variable the tests set, then it copies its
   *  input to its output. */
  const printSecret = 'process.stdout.write(process.env.E3_TEST_SECRET ?? "unset");';

  /** A custom task whose runner prints the variable and copies its input to
   *  its output. */
  async function printingTask(): Promise<{ taskHash: string; inputHashes: string[] }> {
    const commandFn = East.function(
      [ArrayType(StringType), StringType],
      ArrayType(StringType),
      ($, inputs, output) => ['node', '-e', `${printSecret} require("node:fs").copyFileSync(process.argv[1], process.argv[2])`, inputs.get(0n), output],
    );
    const task: TaskObject = {
      kind: TASK_OBJECT_KIND,
      body: variant('command', { commandIr: await objectWrite(repo, encodeBeast2For(IRType)(commandFn.toIR().ir)) }),
      runner: variant('custom', { command: [] }),
      inputs: [],
      output: { path: [], kind: variant('value', null) },
      role: variant('data', null),
      environment: none,
    };
    return {
      taskHash: await objectWrite(repo, encodeBeast2For(TaskObjectType)(task)),
      inputHashes: [await storage.objects.write(repo, new Uint8Array([1, 2, 3]))],
    };
  }

  it('reaches a task\'s runner and a unit\'s, and is no part of the execution\'s identity', async () => {
    const runner = new LocalTaskRunner(repo);
    const { taskHash, inputHashes } = await printingTask();
    const printed = async (executionId: string): Promise<string> =>
      (await storage.logs.read(repo, taskHash, inputsHash(inputHashes), executionId, 'stdout')).data;

    const task = await runner.execute(storage, taskHash, inputHashes, { extraEnv: { E3_TEST_SECRET: 'the task\'s' } });
    assert.equal(task.state, 'success', task.error ?? '');
    assert.equal(await printed(task.executionId), 'the task\'s');

    const unit = await runner.executeUnit(storage, taskHash, { inputs: inputHashes, merge: null, own: false },
      { force: true, extraEnv: { E3_TEST_SECRET: 'the unit\'s' } });
    assert.equal(unit.state, 'success', unit.error ?? '');
    assert.equal(await printed(unit.executionId), 'the unit\'s');

    const again = await runner.execute(storage, taskHash, inputHashes, { extraEnv: { E3_TEST_SECRET: 'another' } });
    assert.equal(again.cached, true, 'a different environment is the same execution');
  });

  it('reaches a function call\'s runner', async () => {
    const result = await new LocalTaskRunner(repo).runDetached({
      bodyIr: new Uint8Array([1]),
      args: [encodeBeast2For(StringType)('the value')],
      runner: variant('custom', { command: [process.execPath, '-e',
        `${printSecret} const a = process.argv; require("node:fs").copyFileSync(a[a.indexOf("-i") + 1], a[a.indexOf("-o") + 1])`, '--'] }),
      limits: { timeoutMs: 30_000, maxResultBytes: 1024, maxLogBytes: 1024 },
    }, { extraEnv: { E3_TEST_SECRET: 'the call\'s' } });
    assert.equal(result.kind, 'success', result.stderr);
    assert.equal(result.stdout, 'the call\'s');
  });

  it('refuses a variable e3 sets itself', async () => {
    const { taskHash, inputHashes } = await printingTask();
    for (const name of ['PATH', 'E3_RUNNER_SEARCH_DIRS', 'E3_FETCH_SEGMENTS']) {
      await assert.rejects(
        new LocalTaskRunner(repo).execute(storage, taskHash, inputHashes, { extraEnv: { [name]: '/nowhere' } }),
        { message: `a runner's environment may not set ${name}, which e3 sets itself` },
      );
    }
  });
});
