/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local task execution for e3 repositories.
 *
 * This module handles all local process-specific execution:
 * - Creating temporary scratch directories for task I/O
 * - Spawning runner processes (east-node, east-py, julia)
 * - Capturing stdout/stderr and persisting to logs
 * - Process lifecycle management (signals, timeouts, cleanup)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { variant } from '@elaraai/east';
import { type ExecutionStatus, type PartitionProgress, type TaskObject, decodeTaskObject, withRunnerVerbose, TASK_KIND_PARTITION } from '@elaraai/e3-types';
import { inputsHash, evaluateCommandIr } from '../executions.js';
import { uuidv7 } from '../uuid.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { TaskRunner, TaskExecuteOptions, TaskResult } from './interfaces.js';
import { getBootId, getPidStartTime, isProcessAlive } from './processHelpers.js';
import { adoptOutputFile, marshalInputsToDir, spawnAndCapture } from './processExec.js';
import { materializeEnvironment } from './environment.js';
import { runDetached, type DetachedSpec, type DetachedResult, type DetachedRunOptions } from './runDetached.js';

// Re-exported from processExec.js (where the implementation moved) for
// backwards compatibility — exported for testing, not public API.
export { collectNodeModulesBins, collectVenvBins } from './processExec.js';

/**
 * Options for task execution
 */
export interface ExecuteOptions {
  /** Re-run even if cached (default: false) */
  force?: boolean;
  /** Pass `-v` to the runner (known runtimes only) so it prints timing/perf
   *  to stderr. Runtime-only: applied to the evaluated argv just before spawn,
   *  so it never affects the task hash or caching. */
  verbose?: boolean;
  /** Timeout in milliseconds (default: none) */
  timeout?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Stream stdout callback */
  onStdout?: (data: string) => void;
  /** Stream stderr callback */
  onStderr?: (data: string) => void;
  /** Maximum concurrent per-partition executions of a partitioned task
   *  (default: 4). Runtime-only: never affects hashes or caching. */
  partitionConcurrency?: number;
  /** Called as each unit of a partitioned task (slice execution or combine
   *  step) starts and completes. Runtime-only progress reporting. */
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
  /** True when e3 stopped the execution because the run was aborted — an
   *  `error` whose message starts `cancelled:`, which is not the task's own
   *  failure */
  cancelled: boolean;
}

/**
 * TaskRunner implementation for local process execution.
 *
 * Spawns runner processes locally to execute tasks.
 * Used by the local CLI and e3-api-server for task execution.
 */
export class LocalTaskRunner implements TaskRunner {
  constructor(private readonly repo: string) {}

  async execute(
    storage: StorageBackend,
    taskHash: string,
    inputHashes: string[],
    options?: TaskExecuteOptions
  ): Promise<TaskResult> {
    const result = await taskExecute(storage, this.repo, taskHash, inputHashes, {
      force: options?.force,
      verbose: options?.verbose,
      signal: options?.signal,
      onStdout: options?.onStdout,
      onStderr: options?.onStderr,
      partitionConcurrency: options?.partitionConcurrency,
      onPartitionProgress: options?.onPartitionProgress,
    });

    // Convert ExecutionResult to TaskResult
    const taskResult: TaskResult = {
      state: result.state,
      cached: result.cached,
      executionId: result.executionId,
    };
    if (result.cancelled) {
      taskResult.cancelled = true;
    }

    if (result.state === 'success' && result.outputHash) {
      taskResult.outputHash = result.outputHash;
    } else if (result.state === 'failed') {
      taskResult.exitCode = result.exitCode ?? undefined;
    } else if (result.state === 'error') {
      taskResult.error = result.error ?? undefined;
    }

    return taskResult;
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
    });
  }
}

/**
 * Execute a single task.
 *
 * This is the core execution primitive. It:
 * 1. Computes the execution identity from task + inputs
 * 2. Checks cache (unless force=true)
 * 3. Marshals inputs to a scratch directory
 * 4. Evaluates command IR to get exec args
 * 5. Runs the command
 * 6. Stores the output and updates status
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

  // Step 2: Generate a new execution ID
  const executionId = uuidv7();

  // Step 3: Read task object
  let task: TaskObject;
  try {
    const taskData = await storage.objects.read(repo, taskHash);
    const decoder = decodeTaskObject;
    task = decoder(Buffer.from(taskData));
  } catch (err) {
    // Record error with executionId for audit trail
    const status: ExecutionStatus = variant('error', {
      executionId,
      inputHashes,
      startedAt: new Date(startTime),
      completedAt: new Date(),
      message: `Failed to read task object: ${err}`,
    });
    await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);

    return {
      inputsHash: inHash,
      executionId,
      cached: false,
      state: 'error',
      outputHash: null,
      exitCode: null,
      duration: Date.now() - startTime,
      error: `Failed to read task object: ${err}`,
      cancelled: false,
    };
  }

  // Partitioned tasks fan out below this point: carve the partitioned
  // input(s), run each slice as its own content-addressed execution, and
  // splice/combine the shards. Every unit that misses the cache runs the
  // standard body in this process under fresh ids. Loaded lazily —
  // partitionExec imports back into this module for the cache probe and the
  // standard body.
  if (task.kind.type === 'some' && task.kind.value === TASK_KIND_PARTITION) {
    const { partitionTaskExecute } = await import('./partitionExec.js');
    return partitionTaskExecute(
      storage, repo, taskHash, task, inputHashes, { inHash, executionId, startTime }, options,
      (unitTaskHash, unitTask, unitInputs, unitOptions) => taskExecuteBody(
        storage, repo, unitTaskHash, unitTask, unitInputs,
        { inHash: inputsHash(unitInputs), executionId: uuidv7(), startTime: Date.now() },
        unitOptions,
      ),
    );
  }

  return taskExecuteBody(storage, repo, taskHash, task, inputHashes, { inHash, executionId, startTime }, options);
}

/**
 * Probes the execution cache for a successful prior execution.
 *
 * A latest record still `running` whose runner and orchestrator have both
 * exited is first rewritten as an `interrupted:` error (see
 * {@link repairInterruptedExecution}), so it no longer reads as live.
 *
 * Exported for the partition executor, which probes every unit of a
 * partitioned task before running it.
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
  };
}

/**
 * Rewrites a `running` record as `error` when its execution can no longer
 * finish: the runner has exited and so has the orchestrator recorded as its
 * owner, so nothing will ever write its outcome.
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
  const owner = await storage.refs.executionOwnerRead?.(repo, taskHash, inHash, running.executionId) ?? null;
  if (owner === null) return;
  if (await isProcessAlive(owner.pid, owner.pidStartTime, owner.bootId)) return;
  const status: ExecutionStatus = variant('error', {
    executionId: running.executionId,
    inputHashes: running.inputHashes,
    startedAt: running.startedAt,
    completedAt: new Date(),
    message: `interrupted: the orchestrator exited before this execution finished (runner pid ${pid})`,
  });
  await storage.refs.executionWrite(repo, taskHash, inHash, running.executionId, status);
}

/** The identity of one execution attempt, computed by {@link taskExecute}
 *  before dispatch. @internal */
export interface ExecutionIds {
  /** Combined inputs hash. */
  inHash: string;
  /** Fresh execution ID (UUIDv7). */
  executionId: string;
  /** Wall-clock start of the attempt (epoch ms). */
  startTime: number;
}

/** The standard execution body: scratch dir, input marshalling, command IR
 *  evaluation, spawn, and verbatim output store. Exported for the partition
 *  path's single-partition short-circuit, which runs the body once under the
 *  LOGICAL execution identity (the whole input is the one slice). @internal */
export async function taskExecuteBody(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  task: TaskObject,
  inputHashes: string[],
  ids: ExecutionIds,
  options: ExecuteOptions = {}
): Promise<ExecutionResult> {
  const { inHash, executionId, startTime } = ids;

  // Step 4: Create scratch directory
  // Include PID to prevent collisions when multiple e3 processes run the same
  // task concurrently (e.g., same task in different workspaces at same millisecond)
  const scratchDir = path.join(
    tmpdir(),
    `e3-exec-${taskHash.slice(0, 8)}-${inHash.slice(0, 8)}-${process.pid}-${Date.now()}`
  );
  await fs.mkdir(scratchDir, { recursive: true });

  try {
    // Step 5: Marshal inputs to scratch dir. A stock runner only ever READS
    // its inputs, so they may share the object's storage; a `custom` runner is
    // an arbitrary command that could move or truncate the path, which through
    // a hard link would rewrite the object itself — so it gets copies.
    const inputPaths = await marshalInputsToDir(storage, repo, scratchDir, inputHashes, {
      link: task.runner.type !== 'custom',
    });

    // Step 6: Evaluate command IR to get exec args
    const outputPath = path.join(scratchDir, 'output.beast2');

    // The e3 SDK's `customTask` wraps the user command in `["bash", "-c",
    // "<cmd-with-paths-interpolated>"]`. Bash treats `\` as an escape
    // character (e.g. `\U`, `\f`, `\b`), so a Windows backslash path mangles
    // the command string. Normalize separators here — bash + MSYS coreutils
    // (cp, sleep, …) accept `C:/path` form, node's `fs` is happy with either
    // separator on Windows, and runners using these paths as plain strings
    // (east-py, etc.) are unaffected. No-op on POSIX (`path.sep === '/'`).
    const toForwardSlash = (p: string) => p.split(path.sep).join('/');
    const irInputPaths = inputPaths.map(toForwardSlash);
    const irOutputPath = toForwardSlash(outputPath);

    let args: string[];
    try {
      args = await evaluateCommandIr(storage, repo, task.commandIr, irInputPaths, irOutputPath);
    } catch (err) {
      const status: ExecutionStatus = variant('error', {
        executionId,
        inputHashes,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        message: `Failed to evaluate command IR: ${err}`,
      });
      await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);

      return {
        inputsHash: inHash,
        executionId,
        cached: false,
        state: 'error',
        outputHash: null,
        exitCode: null,
        duration: Date.now() - startTime,
        error: `Failed to evaluate command IR: ${err}`,
        cancelled: false,
      };
    }

    if (args.length === 0) {
      const status: ExecutionStatus = variant('error', {
        executionId,
        inputHashes,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        message: 'Command IR produced empty command',
      });
      await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);

      return {
        inputsHash: inHash,
        executionId,
        cached: false,
        state: 'error',
        outputHash: null,
        exitCode: null,
        duration: Date.now() - startTime,
        error: 'Command IR produced empty command',
        cancelled: false,
      };
    }

    // Step 6.4: Runtime verbose toggle. Splice `-v` into the evaluated argv for
    // known runtimes only (never a custom runner's user-authored command). This
    // is applied AFTER the cache decision and never touches commandIr/hashes, so
    // `-v` changes only what a task that actually spawns prints — not caching.
    args = withRunnerVerbose(task.runner, args, options.verbose);

    // Step 6.5: Materialize the task's declared execution environment (warm
    // cache hit after first use); its bin dir is prepended to the child PATH.
    let envBins: string[] = [];
    if (task.environment.type === 'some') {
      try {
        envBins = await materializeEnvironment(storage, repo, task.environment.value);
      } catch (err) {
        const message = `Failed to materialize environment: ${err instanceof Error ? err.message : err}`;
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
          exitCode: null,
          duration: Date.now() - startTime,
          error: message,
          cancelled: false,
        };
      }
    }

    // Step 7: Get boot ID for crash detection
    const bootId = await getBootId();

    // Step 8: Execute command. A stock runner gets the stdin lifeline, so it
    // exits if this process dies; a custom command keeps an ignored stdin.
    const result = await runCommand(
      storage,
      repo,
      taskHash,
      inHash,
      executionId,
      args,
      inputHashes,
      bootId,
      scratchDir,
      options,
      envBins,
      task.runner.type !== 'custom'
    );

    /** Records an execution e3 stopped (`error`) or a signal ended
     *  (`failed`, exit code -1), appending `e3: <cause>` to its stderr log. */
    const stoppedResult = async (state: 'error' | 'failed', cause: string, cancelled: boolean): Promise<ExecutionResult> => {
      try {
        await storage.logs.append(repo, taskHash, inHash, executionId, 'stderr', `e3: ${cause}\n`);
      } catch (err) {
        console.warn(`Failed to append stderr log: ${err instanceof Error ? err.message : String(err)}`);
      }
      const status: ExecutionStatus = state === 'error'
        ? variant('error', {
          executionId,
          inputHashes,
          startedAt: new Date(startTime),
          completedAt: new Date(),
          message: cause,
        })
        : variant('failed', {
          executionId,
          inputHashes,
          startedAt: new Date(startTime),
          completedAt: new Date(),
          exitCode: -1n,
        });
      await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);
      return {
        inputsHash: inHash,
        executionId,
        cached: false,
        state,
        outputHash: null,
        exitCode: state === 'failed' ? -1 : null,
        duration: Date.now() - startTime,
        error: state === 'failed' ? `e3: ${cause}` : cause,
        cancelled,
      };
    };

    // Step 9: Handle result
    if (result.exitCode === 0) {
      // Success - take the output into the store without reading it: hashed
      // by streaming and linked or kernel-copied, so a multi-gigabyte output
      // never lands on this process's heap. Done before the scratch cleanup
      // in the `finally` below.
      try {
        const outputHash = await adoptOutputFile(storage, repo, outputPath);

        // Write success status (output is stored within status.beast2's directory)
        const status: ExecutionStatus = variant('success', {
          executionId,
          inputHashes,
          outputHash,
          startedAt: new Date(startTime),
          completedAt: new Date(),
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
        };
      } catch (err) {
        // Output file missing or unreadable
        const status: ExecutionStatus = variant('error', {
          executionId,
          inputHashes,
          startedAt: new Date(startTime),
          completedAt: new Date(),
          message: `Failed to read output: ${err}`,
        });
        await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);

        return {
          inputsHash: inHash,
          executionId,
          cached: false,
          state: 'error',
          outputHash: null,
          exitCode: 0,
          duration: Date.now() - startTime,
          error: `Failed to read output: ${err}`,
          cancelled: false,
        };
      }
    }

    // e3 stopped the runner, or a signal ended it: the record names the
    // cause, and so does the last line of the execution's stderr log.
    if (result.stoppedByE3 && options.signal?.aborted) {
      return stoppedResult('error', 'cancelled: e3 stopped the runner because the run was aborted', true);
    }
    if (result.timedOut) {
      return stoppedResult('error', `timed out: e3 stopped the runner after ${options.timeout} ms`, false);
    }
    if (result.exitCode === null && result.signal !== null) {
      return stoppedResult('failed', `runner killed by ${result.signal}`, false);
    }

    // Failed - write failed status
    const status: ExecutionStatus = variant('failed', {
      executionId,
      inputHashes,
      startedAt: new Date(startTime),
      completedAt: new Date(),
      exitCode: BigInt(result?.exitCode ?? -1),
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

  const result = await spawnAndCapture(args, scratchDir, {
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
      const status: ExecutionStatus = variant('running', {
        executionId,
        inputHashes,
        startedAt: new Date(),
        pid: BigInt(pid ?? -1),
        pidStartTime: BigInt(pidStartTime ?? -1),
        bootId,
      });
      await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);
      // The owner sidecar: this process, which alone writes the outcome.
      await storage.refs.executionOwnerWrite?.(repo, taskHash, inHash, executionId, {
        pid: process.pid,
        pidStartTime: await getPidStartTime(process.pid),
        bootId,
      });
    },
  });

  // Wait for any pending log writes to complete
  await Promise.all([stdoutLog.idle(), stderrLog.idle()]);

  return {
    exitCode: result.exitCode,
    signal: result.signal,
    stoppedByE3: result.stoppedByE3,
    timedOut: result.timedOut,
    error: result.error,
  };
}
