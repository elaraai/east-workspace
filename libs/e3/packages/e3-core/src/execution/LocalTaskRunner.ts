/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local task execution for e3 repositories.
 *
 * This module handles all local process-specific execution:
 * - Creating temporary scratch directories for task I/O
 * - Spawning runner processes: a stock runner's `exec` of a task's unit
 *   (units.ts), or a custom command
 * - Capturing stdout/stderr and persisting to logs
 * - Process lifecycle management (signals, timeouts, cleanup)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { none, some, variant } from '@elaraai/east';
import { type ExecutionStatus, type PartitionProgress, type TaskObject, decodeTaskObject } from '@elaraai/e3-types';
import { inputsHash, evaluateCommandIr } from '../executions.js';
import { uuidv7 } from '../uuid.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { SplitUnit, TaskRunner, TaskExecuteOptions, TaskResult } from './interfaces.js';
import { getBootId, getPidStartTime, isProcessAlive } from './processHelpers.js';
import { marshalInputsToDir, spawnAndCapture } from './processExec.js';
import { storeDatasetFile } from '../store-collection.js';
import { materializeEnvironment } from './environment.js';
import { runDetached, type DetachedSpec, type DetachedResult, type DetachedRunOptions } from './runDetached.js';
import { executionScratchDir } from './scratch.js';
import { unitThreads, type Budget, type ReleaseSlot } from './budget.js';
import { readUnitResult, stageMergeUnit, stageOutputMerge, stageRunUnit, storeUnitOutput, unitArgv, type MergeParts, type StagedUnit, type TaskUnit } from './units.js';
import { executeSplitTask, isSplitTask } from './engine.js';

/**
 * Options for task execution
 */
export interface ExecuteOptions {
  /** Re-run even if cached (default: false) */
  force?: boolean;
  /** Pass `-v` to a stock runner's `exec`, so it prints where the time went
   *  and its peak memory to stderr. Runtime-only: it never affects the task
   *  hash or caching. */
  verbose?: boolean;
  /** Timeout in milliseconds (default: none) */
  timeout?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Stream stdout callback */
  onStdout?: (data: string) => void;
  /** Stream stderr callback */
  onStderr?: (data: string) => void;
  /** The process's budget (see {@link Budget}): a runner spawns only while
   *  its execution holds a core, and a split task's units take cores like any
   *  execution; each unit is granted threads from it. A split task run on its
   *  own keeps as many units in flight as the budget has cores. Runtime-only,
   *  and never seen by a remote backend. Absent, spawns are not budgeted. */
  budget?: Budget;
  /** The memory, in bytes, the execution reserves from the budget while its
   *  runner runs: for a unit of a split task, the largest peak its stage has
   *  reached in the run. Absent, it reserves none. */
  expectedPeakBytes?: number;
  /** Called as each unit of a split task (a piece, or a merge of their
   *  outputs) starts, and as it succeeds. Runtime-only progress reporting. */
  onPartitionProgress?: (progress: PartitionProgress) => void;
}

/**
 * Result of task execution
 */
export interface ExecutionResult {
  /** Combined inputs hash (identifies this execution) */
  inputsHash: string;
  /** Execution ID (UUIDv7) */
  executionId: string;
  /** True if result was from cache */
  cached: boolean;
  /** Final state */
  state: 'success' | 'failed' | 'error';
  /** Output dataset hash (null on failure) */
  outputHash: string | null;
  /** Process exit code (null if not applicable) */
  exitCode: number | null;
  /** Execution time in ms (0 if cached) */
  duration: number;
  /** Error message on failure */
  error: string | null;
  /** True when e3 stopped the execution because the run was aborted: it is
   *  recorded `cancelled`, and is not the task's own failure */
  cancelled: boolean;
  /** The highest peak resident memory, in bytes, a runner process of the
   *  execution reached, as its execution records it: a unit's, the larger of
   *  its run's and its output merge's; a split task's, the largest of its
   *  units'. Absent when no runner reported one: a command body, or a runner
   *  that recorded no result. */
  peakBytes?: number;
}

/**
 * TaskRunner implementation for local process execution.
 *
 * Spawns runner processes locally to execute tasks.
 * Used by the local CLI and e3-api-server for task execution.
 */
export class LocalTaskRunner implements TaskRunner {
  /**
   * @param repo - The repository the runner runs tasks of
   * @param budget - The process's budget: every runner this spawns — a
   *   task's, a unit's, a function call's — takes a core from it, and each
   *   unit is granted threads from it. Absent, spawns are not budgeted.
   */
  constructor(private readonly repo: string, private readonly budget?: Budget) {}

  async execute(
    storage: StorageBackend,
    taskHash: string,
    inputHashes: string[],
    options?: TaskExecuteOptions
  ): Promise<TaskResult> {
    return toTaskResult(await taskExecute(storage, this.repo, taskHash, inputHashes, {
      force: options?.force,
      verbose: options?.verbose,
      signal: options?.signal,
      onStdout: options?.onStdout,
      onStderr: options?.onStderr,
      budget: this.budget,
      expectedPeakBytes: options?.expectedPeakBytes,
      onPartitionProgress: options?.onPartitionProgress,
    }));
  }

  async executeUnit(
    storage: StorageBackend,
    taskHash: string,
    unit: SplitUnit,
    options?: TaskExecuteOptions
  ): Promise<TaskResult> {
    return toTaskResult(await taskExecuteUnit(storage, this.repo, taskHash, unit, {
      force: options?.force,
      verbose: options?.verbose,
      signal: options?.signal,
      onStdout: options?.onStdout,
      onStderr: options?.onStderr,
      budget: this.budget,
      expectedPeakBytes: options?.expectedPeakBytes,
    }));
  }

  async runDetached(spec: DetachedSpec, options?: DetachedRunOptions): Promise<DetachedResult> {
    let extraBins: string[] | undefined = options?.extraBins;
    if (spec.environment && !extraBins) {
      if (!options?.storage) {
        throw new Error('runDetached: spec declares an environment but options.storage was not provided');
      }
      extraBins = await materializeEnvironment(options.storage, this.repo, spec.environment);
    }
    return runDetached(spec, {
      signal: options?.signal,
      verbose: options?.verbose,
      // Anchor the runner-binary PATH walk at the repo's parent (the
      // project dir), matching the tracked path's walk-up in spawnAndCapture.
      runnerSearchDir: options?.runnerSearchDir ?? path.dirname(this.repo),
      extraBins,
      // The call runs in the repository's scratch root, as an execution does,
      // and a dataset argument is staged from the repository.
      storage: options?.storage,
      repo: this.repo,
    }, this.budget);
  }
}

/** An execution's result, as a {@link TaskRunner} reports it. */
function toTaskResult(result: ExecutionResult): TaskResult {
  const taskResult: TaskResult = {
    state: result.state,
    cached: result.cached,
    executionId: result.executionId,
  };
  if (result.cancelled) {
    taskResult.cancelled = true;
  }
  if (result.peakBytes !== undefined) {
    taskResult.peakBytes = result.peakBytes;
  }
  if (result.state === 'success' && result.outputHash) {
    taskResult.outputHash = result.outputHash;
  } else if (result.state === 'failed') {
    taskResult.exitCode = result.exitCode ?? undefined;
    taskResult.error = result.error ?? undefined;
  } else if (result.state === 'error') {
    taskResult.error = result.error ?? undefined;
  }
  return taskResult;
}

/**
 * Execute a single task.
 *
 * This is the core execution primitive. It:
 * 1. Computes the execution identity from task + inputs
 * 2. Checks cache (unless force=true)
 * 3. Marshals inputs to a scratch directory
 * 4. Builds the runner's argv from the task's body
 * 5. Runs the runner
 * 6. Stores the output and updates status
 *
 * A task whose work is split over an input — an East body on a stock runner,
 * emitting its output, with an input `e3.partition` marks — runs through the
 * engine instead (engine.ts): a unit per piece, each through these steps, and
 * the units that assemble their outputs.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier (for local storage, the path to e3 repository directory)
 * @param taskHash - Hash of the task object
 * @param inputHashes - Array of input dataset hashes
 * @param options - Execution options
 * @returns Execution result
 */
export async function taskExecute(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  inputHashes: string[],
  options: ExecuteOptions = {}
): Promise<ExecutionResult> {
  const inHash = inputsHash(inputHashes);
  const startTime = Date.now();

  // Step 1: Check cache (unless force)
  if (!options.force) {
    const cached = await probeExecutionCache(storage, repo, taskHash, inHash);
    if (cached !== null) return cached;
  }

  // Step 2: Generate a new execution ID, and read the task object
  const ids = { inHash, executionId: uuidv7(), startTime };
  const task = await readTaskObject(storage, repo, taskHash, inputHashes, ids);
  if (!('body' in task)) return task;

  if (isSplitTask(task)) {
    return executeSplitTask(storage, repo, taskHash, task, inputHashes, ids, options,
      (unitInputs, unitIds, merge, expectedPeakBytes) =>
        taskExecuteBody(storage, repo, taskHash, task, unitInputs, unitIds, { ...options, expectedPeakBytes }, merge));
  }
  return taskExecuteBody(storage, repo, taskHash, task, inputHashes, ids, options);
}

/**
 * Execute one unit of a task split into pieces, which the caller planned: a
 * piece, run as the task's program over the piece's inputs, or a merge of what
 * the pieces wrote. Served from the execution cache when the unit ran before,
 * unless `options.force`.
 *
 * The dataflow runs a split task's units through this, beside every other
 * task's; `taskExecute` runs a task on its own through the engine instead.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param taskHash - Hash of the task object
 * @param unit - The unit
 * @param options - Execution options
 * @returns The unit's execution result
 */
export async function taskExecuteUnit(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  unit: SplitUnit,
  options: ExecuteOptions = {}
): Promise<ExecutionResult> {
  const inHash = inputsHash(unit.inputs);
  if (!options.force) {
    const cached = await probeExecutionCache(storage, repo, taskHash, inHash);
    if (cached !== null) return cached;
  }
  const ids = { inHash, executionId: uuidv7(), startTime: Date.now() };
  const task = await readTaskObject(storage, repo, taskHash, unit.inputs, ids);
  if (!('body' in task)) return task;
  return taskExecuteBody(storage, repo, taskHash, task, unit.inputs, ids, options, unit.merge);
}

/** Reads and decodes a task object; or, when it does not read, records the
 *  execution `error`, naming why, and returns its result. */
async function readTaskObject(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  inputHashes: string[],
  ids: ExecutionIds,
): Promise<TaskObject | ExecutionResult> {
  try {
    return decodeTaskObject(Buffer.from(await storage.objects.read(repo, taskHash)));
  } catch (err) {
    const message = `Failed to read task object: ${err}`;
    await storage.refs.executionWrite(repo, taskHash, ids.inHash, ids.executionId, variant('error', {
      executionId: ids.executionId,
      inputHashes,
      startedAt: new Date(ids.startTime),
      completedAt: new Date(),
      message,
    }));
    return {
      inputsHash: ids.inHash,
      executionId: ids.executionId,
      cached: false,
      state: 'error',
      outputHash: null,
      exitCode: null,
      duration: Date.now() - ids.startTime,
      error: message,
      cancelled: false,
    };
  }
}

/**
 * Probes the execution cache for a successful prior execution.
 *
 * A latest record still `running` whose runner and orchestrator have both
 * exited is first rewritten as `interrupted` (see
 * {@link repairInterruptedExecution}), so it no longer reads as live.
 *
 * Exported for the engine, which probes every unit before running it.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param taskHash - Hash of the task object
 * @param inHash - Combined inputs hash
 * @returns The cached result, or `null` when no successful execution exists
 *
 * @internal
 */
export async function probeExecutionCache(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  inHash: string
): Promise<ExecutionResult | null> {
  const status = await storage.refs.executionGetLatest(repo, taskHash, inHash);
  if (status?.type === 'running') {
    await repairInterruptedExecution(storage, repo, taskHash, inHash, status.value);
    return null;
  }
  if (status?.type !== 'success') {
    return null;
  }
  const existingOutput = await storage.refs.executionGetLatestOutput(repo, taskHash, inHash);
  if (existingOutput === null) {
    return null;
  }
  return {
    inputsHash: inHash,
    executionId: status.value.executionId,
    cached: true,
    state: 'success',
    outputHash: existingOutput,
    exitCode: 0,
    duration: 0,
    error: null,
    cancelled: false,
    ...(status.value.peakBytes.type === 'some' && { peakBytes: Number(status.value.peakBytes.value) }),
  };
}

/**
 * Rewrites a `running` record as `interrupted` when its execution can no
 * longer finish: the runner has exited and so has the orchestrator recorded as
 * its owner, so nothing will ever write its outcome.
 *
 * A live owner means the orchestrator is between the runner's exit and the
 * record's write (it hashes the output there), so the record is left alone;
 * so is a record with no owner sidecar.
 */
async function repairInterruptedExecution(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  inHash: string,
  running: Extract<ExecutionStatus, { type: 'running' }>['value']
): Promise<void> {
  const pid = Number(running.pid);
  if (await isProcessAlive(pid, Number(running.pidStartTime), running.bootId)) return;
  const owner = await storage.refs.executionOwnerRead(repo, taskHash, inHash, running.executionId);
  if (owner === null) return;
  if (await isProcessAlive(owner.pid, owner.pidStartTime, owner.bootId)) return;
  const status: ExecutionStatus = variant('interrupted', {
    executionId: running.executionId,
    inputHashes: running.inputHashes,
    startedAt: running.startedAt,
    completedAt: new Date(),
    pid: running.pid,
  });
  await storage.refs.executionWrite(repo, taskHash, inHash, running.executionId, status);
}

/** The identity of one execution attempt: the execution-cache key it is
 *  recorded under, and its own ID and start. */
export interface ExecutionIds {
  /** Combined inputs hash. */
  inHash: string;
  /** Fresh execution ID (UUIDv7). */
  executionId: string;
  /** Wall-clock start of the attempt (epoch ms). */
  startTime: number;
}

/** The standard execution body: scratch dir, input marshalling, the runner's
 *  argv, spawn, and the output through the store's door. The engine runs each
 *  unit of a split task through it.
 *
 *  What the argv is depends on the body. A command body — a custom task's —
 *  is its command IR, evaluated over the staged paths. An
 *  East body on a stock runner is a unit its `exec` runs, with the `merge`
 *  unit a set or dict output needs when it closed several runs. An East body
 *  on the `custom` runtime is its command given `run`'s arguments: `-i` for
 *  each input, `-o` and the program's file.
 *
 *  Given `merge`, the execution is a merge unit of a split task instead: the
 *  parts and the range are staged, and `inputHashes` are only the identity its
 *  record carries.
 *  @internal */
export async function taskExecuteBody(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  task: TaskObject,
  inputHashes: string[],
  ids: ExecutionIds,
  options: ExecuteOptions = {},
  merge: MergeParts | null = null,
): Promise<ExecutionResult> {
  const { inHash, executionId, startTime } = ids;
  // What spawns: a stock runner's `exec`, for an East body on a stock runtime;
  // otherwise the author's own command.
  const stock = task.body.type === 'east' && task.runner.type !== 'custom';

  /** Records an error e3 met before the runner ran. */
  const errorResult = async (message: string, exitCode: number | null = null): Promise<ExecutionResult> => {
    const status: ExecutionStatus = variant('error', {
      executionId,
      inputHashes,
      startedAt: new Date(startTime),
      completedAt: new Date(),
      message,
    });
    await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);
    return {
      inputsHash: inHash,
      executionId,
      cached: false,
      state: 'error',
      outputHash: null,
      exitCode,
      duration: Date.now() - startTime,
      error: message,
      cancelled: false,
    };
  };

  // Step 4: Create scratch directory inside the repository (or under
  // E3_SCRATCH_DIR), named after the execution attempt and this process — its
  // pid and start time — so no two attempts share one, in this process or
  // across processes, and a directory this process leaves behind if it dies is
  // swept once it is gone (execution/scratch.ts).
  const scratchDir = await executionScratchDir(repo, taskHash, inHash, executionId);
  await fs.mkdir(scratchDir, { recursive: true });

  try {
    // Step 5: Marshal inputs to scratch dir. A stock runner only ever READS
    // its inputs, so they may share the object's storage, and it opens a
    // collection staged as its manifest, the segments linked beside it. A
    // command is arbitrary and could move or truncate the path, which through
    // a hard link would rewrite the object itself — so it gets copies, and a
    // collection spliced into one file.
    const staged = merge === null ? inputHashes : [...(merge.range === null ? [] : [merge.range]), ...merge.parts];
    const inputPaths = await marshalInputsToDir(storage, repo, scratchDir, staged, {
      link: stock,
      manifests: stock,
    });

    // Step 6: The runner's argv, by the body.
    const outputPath = path.join(scratchDir, 'output.beast2');
    let unit: TaskUnit | null = null;
    let args: string[];
    if (merge !== null) {
      unit = merge.range === null
        ? await stageMergeUnit(storage, repo, scratchDir, task, inputPaths, null, unitThreads(options.budget))
        : await stageMergeUnit(storage, repo, scratchDir, task, inputPaths.slice(1), inputPaths[0]!, unitThreads(options.budget));
      args = unitArgv(unit.runner, unit, options.verbose);
    } else if (task.body.type === 'command') {
      // The e3 SDK's `customTask` wraps the user command in `["bash", "-c",
      // "<cmd-with-paths-interpolated>"]`. Bash treats `\` as an escape
      // character (e.g. `\U`, `\f`, `\b`), so a Windows backslash path mangles
      // the command string. Normalize separators here — bash + MSYS coreutils
      // (cp, sleep, …) accept `C:/path` form, node's `fs` is happy with either
      // separator on Windows, and runners using these paths as plain strings
      // (east-py, etc.) are unaffected. No-op on POSIX (`path.sep === '/'`).
      const toForwardSlash = (p: string) => p.split(path.sep).join('/');
      try {
        args = await evaluateCommandIr(storage, repo, task.body.value.commandIr, inputPaths.map(toForwardSlash), toForwardSlash(outputPath));
      } catch (err) {
        return await errorResult(`Failed to evaluate command IR: ${err}`);
      }
      if (args.length === 0) {
        return await errorResult('Command IR produced empty command');
      }
    } else if (task.runner.type === 'custom') {
      if (task.output.kind.type !== 'value') {
        return await errorResult(`the custom runtime runs a program that returns its output, and this task's output is ${task.output.kind.type}, which is emitted`);
      }
      const program = path.join(scratchDir, 'program.beast2');
      await storage.objects.materialize(repo, task.body.value.program, program, { link: false });
      args = [...task.runner.value.command, ...inputPaths.flatMap((input) => ['-i', input]), '-o', outputPath, program];
    } else {
      unit = await stageRunUnit(storage, repo, scratchDir, task, inputPaths, unitThreads(options.budget));
      args = unitArgv(unit.runner, unit, options.verbose);
    }

    // Step 6.5: Materialize the task's declared execution environment (warm
    // cache hit after first use); its bin dir is prepended to the child PATH.
    let envBins: string[] = [];
    if (task.environment.type === 'some') {
      try {
        envBins = await materializeEnvironment(storage, repo, task.environment.value);
      } catch (err) {
        return await errorResult(`Failed to materialize environment: ${err instanceof Error ? err.message : err}`);
      }
    }

    /** The highest peak a unit's runner reported, over the run and its merge. */
    let peakBytes: number | undefined;

    /** Records an execution e3 stopped (`cancelled`, or an `error` naming
     *  the cause) or a signal ended (`failed`, exit code -1), appending
     *  `e3: <cause>` to its stderr log. Returned awaited: a promise returned
     *  unawaited from inside the `try` gets no handler until the `finally`
     *  has removed the scratch directory, so a record that cannot be written
     *  would be an unhandled rejection — which ends the process — rather than
     *  this execution's failure. */
    const stoppedResult = async (outcome: 'cancelled' | 'error' | 'failed', cause: string): Promise<ExecutionResult> => {
      try {
        await storage.logs.append(repo, taskHash, inHash, executionId, 'stderr', `e3: ${cause}\n`);
      } catch (err) {
        console.warn(`Failed to append stderr log: ${err instanceof Error ? err.message : String(err)}`);
      }
      const stopped = { executionId, inputHashes, startedAt: new Date(startTime), completedAt: new Date() };
      const status: ExecutionStatus = outcome === 'cancelled' ? variant('cancelled', stopped)
        : outcome === 'error' ? variant('error', { ...stopped, message: cause })
        : variant('failed', { ...stopped, exitCode: -1n, peakBytes: peakBytes === undefined ? none : some(BigInt(peakBytes)) });
      await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);
      return {
        inputsHash: inHash,
        executionId,
        cached: false,
        state: outcome === 'failed' ? 'failed' : 'error',
        outputHash: null,
        exitCode: outcome === 'failed' ? -1 : null,
        duration: Date.now() - startTime,
        error: outcome === 'failed' ? `e3: ${cause}` : cause,
        cancelled: outcome === 'cancelled',
      };
    };

    // Step 7: Get boot ID for crash detection
    const bootId = await getBootId();

    /** Spawns the runner, and resolves with the execution's record when it
     *  did not end well — `null` when it did. A unit ends well only when
     *  its runner recorded an `ok` result. */
    const spawnRunner = async (argv: string[], staged: StagedUnit | null): Promise<ExecutionResult | null> => {
      const result = await runCommand(storage, repo, taskHash, inHash, executionId, argv, inputHashes, bootId, scratchDir, options, envBins, stock);
      const recorded = staged === null ? null : await readUnitResult(staged);
      if (recorded !== null) peakBytes = Math.max(peakBytes ?? 0, Number(recorded.peakBytes));
      if (result.exitCode === 0) {
        if (staged === null || recorded?.outcome.type === 'ok') return null;
        return await errorResult('the runner exited 0 without recording an ok result for its unit', 0);
      }
      // e3 stopped the runner, or a signal ended it: the record names the
      // cause, and so does the last line of the execution's stderr log.
      if (result.stoppedByE3 && options.signal?.aborted) {
        return await stoppedResult('cancelled', 'cancelled: e3 stopped the runner because the run was aborted');
      }
      if (result.timedOut) {
        return await stoppedResult('error', `timed out: e3 stopped the runner after ${options.timeout} ms`);
      }
      if (result.exitCode === null && result.signal !== null) {
        return await stoppedResult('failed', `runner killed by ${result.signal}`);
      }
      const status: ExecutionStatus = variant('failed', {
        executionId,
        inputHashes,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        exitCode: BigInt(result.exitCode ?? -1),
        peakBytes: peakBytes === undefined ? none : some(BigInt(peakBytes)),
      });
      await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);
      return {
        inputsHash: inHash,
        executionId,
        cached: false,
        state: 'failed',
        outputHash: null,
        exitCode: result.exitCode,
        duration: Date.now() - startTime,
        error: result.error,
        cancelled: false,
        ...(peakBytes !== undefined && { peakBytes }),
      };
    };

    // Step 7.5: the process's budget. The runner spawns only once this
    // execution holds a core and the memory it expects to need, beside every
    // other runner the process spawns, and holds them until its last runner
    // process has exited. An execution the run aborts while it waits never
    // spawns: it is recorded cancelled, with no `running` record ever written.
    let releaseSlot: ReleaseSlot | undefined;
    if (options.budget !== undefined) {
      try {
        releaseSlot = await options.budget.acquire({ memory: options.expectedPeakBytes ?? 0, signal: options.signal });
      } catch (err) {
        if (options.signal?.aborted) {
          return await stoppedResult('cancelled', 'cancelled: e3 did not start the runner because the run was aborted');
        }
        throw err;
      }
    }

    // Step 8: Execute the command: the unit, then the merge its output needs.
    try {
      const failure = await spawnRunner(args, unit);
      if (failure !== null) return failure;
      const merge = unit === null ? null : await stageOutputMerge(unit);
      if (merge !== null) {
        const mergeFailure = await spawnRunner(unitArgv(unit!.runner, merge, options.verbose), merge);
        if (mergeFailure !== null) return mergeFailure;
      }
    } finally {
      releaseSlot?.();
    }

    // Step 9: take the output into the store through its door: a collection a
    // stock runner wrote is stored as the runner cut it, a segment at a time,
    // and one a custom command wrote is read and written again; any other
    // value is linked in as it stands. A multi-gigabyte output never lands on
    // this process's heap. Done before the scratch cleanup in the `finally`
    // below.
    let outputHash: string;
    try {
      outputHash = unit !== null
        ? await storeUnitOutput(storage, repo, unit)
        : await storeDatasetFile(storage, repo, outputPath, { canonical: stock });
    } catch (err) {
      return await errorResult(`Failed to read output: ${err}`, 0);
    }
    const status: ExecutionStatus = variant('success', {
      executionId,
      inputHashes,
      outputHash,
      startedAt: new Date(startTime),
      completedAt: new Date(),
      peakBytes: peakBytes === undefined ? none : some(BigInt(peakBytes)),
    });
    await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);
    return {
      inputsHash: inHash,
      executionId,
      cached: false,
      state: 'success',
      outputHash,
      exitCode: 0,
      duration: Date.now() - startTime,
      error: null,
      cancelled: false,
      ...(peakBytes !== undefined && { peakBytes }),
    };
  } finally {
    // Cleanup scratch directory
    try {
      await fs.rm(scratchDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/** One stream's appends to an execution's log. */
interface LogAppender {
  /** Queues a chunk; resolves once the append that holds it has settled. */
  push(data: string): Promise<void>;
  /** Resolves once every queued chunk has been appended. */
  idle(): Promise<void>;
}

/**
 * Appends one stream's output to an execution's log with at most one append
 * in flight: the chunks that arrive while an append runs are queued, and the
 * next append writes them all at once.
 *
 * @param append - Appends data to the stream's log
 * @param stream - The stream, for the warning a failed append prints
 * @returns The appender
 */
function createLogAppender(append: (data: string) => Promise<void>, stream: 'stdout' | 'stderr'): LogAppender {
  let queue: { data: string; settle: () => void }[] = [];
  let draining: Promise<void> | null = null;
  const drain = async (): Promise<void> => {
    while (queue.length > 0) {
      const batch = queue;
      queue = [];
      try {
        await append(batch.map((chunk) => chunk.data).join(''));
      } catch (err) {
        console.warn(`Failed to append ${stream} log: ${err instanceof Error ? err.message : String(err)}`);
      }
      for (const chunk of batch) chunk.settle();
    }
    draining = null;
  };
  return {
    push: (data) => new Promise<void>((resolve) => {
      queue.push({ data, settle: resolve });
      draining ??= drain();
    }),
    idle: () => draining ?? Promise.resolve(),
  };
}

/**
 * Run a command and capture output.
 *
 * Composes the persistence-free `spawnAndCapture` (processExec.ts) with the
 * tracked path's storage writes: `storage.logs.append` for both streams and
 * the `running` execution status (with pid) once the child has spawned.
 *
 * Each stream's appends run one at a time and the chunks that queue behind one
 * are coalesced; a chunk counts as pending until its append settles, so a
 * runner that writes faster than the log is appended blocks on its pipe.
 */
async function runCommand(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  inHash: string,
  executionId: string,
  args: string[],
  inputHashes: string[],
  bootId: string,
  scratchDir: string,
  options: ExecuteOptions,
  extraBins: string[] = [],
  stdinLifeline = false
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; stoppedByE3: boolean; timedOut: boolean; error: string | null }> {
  const stdoutLog = createLogAppender(
    (data) => storage.logs.append(repo, taskHash, inHash, executionId, 'stdout', data), 'stdout');
  const stderrLog = createLogAppender(
    (data) => storage.logs.append(repo, taskHash, inHash, executionId, 'stderr', data), 'stderr');

  let result: Awaited<ReturnType<typeof spawnAndCapture>>;
  try {
    result = await spawnAndCapture(args, scratchDir, {
      timeoutMs: options.timeout,
      signal: options.signal,
      stdinLifeline,
      // Runners (`east-node`, `east-c`) are typically installed as project
      // devDeps and exposed on `node_modules/.bin`. Walk up from BOTH the
      // repo and process.cwd() — the nearest .bin often lacks the runner
      // (it's hoisted to the workspace root).
      extraBins,
      searchDirs: [path.dirname(repo), process.cwd()],
      // Tee stdout - use storage.logs.append for log persistence
      onStdout: (str) => {
        const appended = stdoutLog.push(str);
        if (options.onStdout) {
          options.onStdout(str);
        }
        return appended;
      },
      // Tee stderr — persist to storage.logs; spawnAndCapture keeps the
      // in-memory tail that the error message includes on non-zero exit.
      onStderr: (str) => {
        const appended = stderrLog.push(str);
        if (options.onStderr) {
          options.onStderr(str);
        }
        return appended;
      },
      // Write running status with actual child PID
      onSpawned: async (pid) => {
        const pidStartTime = await getPidStartTime(pid ?? -1);
        const startedAt = new Date();
        const status: ExecutionStatus = variant('running', {
          executionId,
          inputHashes,
          startedAt,
          pid: BigInt(pid ?? -1),
          pidStartTime: BigInt(pidStartTime ?? -1),
          bootId,
        });
        await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);
        // The owner sidecar: this process, which alone writes the outcome.
        // A `running` record with no owner is never repaired, so one whose
        // owner cannot be recorded is recorded failed before the spawn fails.
        try {
          await storage.refs.executionOwnerWrite(repo, taskHash, inHash, executionId, {
            pid: process.pid,
            pidStartTime: await getPidStartTime(process.pid),
            bootId,
          });
        } catch (err) {
          await storage.refs.executionWrite(repo, taskHash, inHash, executionId, variant('error', {
            executionId,
            inputHashes,
            startedAt,
            completedAt: new Date(),
            message: `Failed to record the execution's owner: ${err instanceof Error ? err.message : String(err)}`,
          }));
          throw err;
        }
      },
    });
  } finally {
    // Every chunk the runner wrote is in its log before this returns — or
    // throws, when the spawn fails after the runner has written.
    await Promise.all([stdoutLog.idle(), stderrLog.idle()]);
  }

  return {
    exitCode: result.exitCode,
    signal: result.signal,
    stoppedByE3: result.stoppedByE3,
    timedOut: result.timedOut,
    error: result.error,
  };
}
