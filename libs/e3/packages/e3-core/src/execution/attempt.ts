/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * An execution attempt's records, as every runner writes them.
 *
 * A runner that runs a task or a unit of one writes the same records whatever
 * it runs on: the attempt's owner first, then `running`, and then how it ended
 * — `success`, `failed`, `error` or `cancelled` — each saying whether the
 * execution is a unit of a split task. Its log is appended as its runner
 * writes, and a cause e3 stopped it for is the log's last line. The local
 * runner writes them for a process on this machine (`LocalTaskRunner.ts`),
 * and another backend's runner for a unit it runs where it runs units, so the
 * records read alike whichever runner wrote them.
 *
 * @packageDocumentation
 */

import { none, some, variant } from '@elaraai/east';
import { decodeTaskObject, type ExecutionOwner, type ExecutionStatus, type TaskObject } from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/interfaces.js';
import type { ExecutionIds, ExecutionResult } from './cache.js';
import type { TaskResult } from './interfaces.js';

/**
 * The runner an attempt's `running` record names, as the host that runs it
 * identifies it.
 */
export interface AttemptRunner {
  /** The runner's process id: 0 where a host's units are no process of a
   *  machine's, as a browser's are not */
  readonly pid: bigint;
  /** When that process started, in the host's own measure: 0 for none */
  readonly pidStartTime: bigint;
  /** The boot of the machine the runner runs on; in a browser, the tab's
   *  session */
  readonly bootId: string;
}

/** One stream's appends to an execution's log. */
export interface LogAppender {
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
 * One attempt at an execution, and the records it writes: its owner, its
 * `running` record, its log, and how it ended.
 *
 * @remarks
 * Every record carries the attempt's id, its inputs as its execution records
 * them, when it started, and whether it is a unit of a split task. An end's
 * record is written once; what it returns is the execution's result, as
 * {@link TaskRunner.execute}'s caller is told it.
 *
 * @example
 * ```ts
 * const attempt = new ExecutionAttempt(storage, repo, taskHash, inputHashes, ids, false);
 * const startedAt = new Date();
 * await attempt.recordOwner(owner, startedAt);
 * await attempt.recordRunning({ pid: 0n, pidStartTime: 0n, bootId: session }, startedAt);
 * return attempt.recordSuccess(outputHash);
 * ```
 */
export class ExecutionAttempt {
  /**
   * @param storage - Storage backend
   * @param repo - Repository identifier
   * @param taskHash - Hash of the task object
   * @param inputHashes - The inputs as the execution records them: a task's
   *   or a piece's input hashes, or a merge unit's `merge` tag, range and
   *   parts
   * @param ids - The attempt's identity: its inputs hash, its id and when it
   *   started
   * @param unit - Whether the execution is a unit of a split task
   */
  constructor(
    readonly storage: StorageBackend,
    readonly repo: string,
    readonly taskHash: string,
    readonly inputHashes: string[],
    readonly ids: ExecutionIds,
    readonly unit: boolean,
  ) {}

  /**
   * An appender of one stream of the attempt's log, with at most one append
   * in flight: what a runner writes, as it writes it.
   *
   * @param stream - The stream
   * @returns The appender
   */
  log(stream: 'stdout' | 'stderr'): LogAppender {
    const { storage, repo, taskHash } = this;
    const { inHash, executionId } = this.ids;
    return createLogAppender((data) => storage.logs.append(repo, taskHash, inHash, executionId, stream, data), stream);
  }

  /**
   * Records the attempt's owner, which a `running` record follows: the host
   * that alone writes the attempt's outcome, whose liveness judges whether it
   * can still finish.
   *
   * @remarks
   * Written before the `running` record, so a host that dies between the two
   * leaves no `running` record at all. An owner that cannot be recorded
   * records the attempt `error`, naming why, before the failure is thrown.
   *
   * @param owner - The owner, or `null` to record none
   * @param startedAt - When the attempt's runner started: what its records say
   * @throws What the owner's write threw, once the attempt is recorded `error`.
   */
  async recordOwner(owner: ExecutionOwner | null, startedAt: Date): Promise<void> {
    const { storage, repo, taskHash, inputHashes, unit } = this;
    const { inHash, executionId } = this.ids;
    try {
      if (owner !== null) await storage.refs.executionOwnerWrite(repo, taskHash, inHash, executionId, owner);
    } catch (err) {
      await storage.refs.executionWrite(repo, taskHash, inHash, executionId, variant('error', {
        executionId,
        inputHashes,
        startedAt,
        completedAt: new Date(),
        message: `Failed to record the execution's owner: ${err instanceof Error ? err.message : String(err)}`,
        unit,
      }));
      throw err;
    }
  }

  /**
   * Records the attempt `running`, on the runner its host names.
   *
   * @param runner - The runner, as its host identifies it
   * @param startedAt - When the runner started
   */
  async recordRunning(runner: AttemptRunner, startedAt: Date): Promise<void> {
    const { storage, repo, taskHash, inputHashes, unit } = this;
    const { inHash, executionId } = this.ids;
    const status: ExecutionStatus = variant('running', {
      executionId,
      inputHashes,
      startedAt,
      pid: runner.pid,
      pidStartTime: runner.pidStartTime,
      bootId: runner.bootId,
      unit,
    });
    await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);
  }

  /**
   * Records an error e3 met, rather than the task's own failure: the attempt
   * is `error`, naming it.
   *
   * @param message - What went wrong
   * @param exitCode - The runner's exit code, when it had exited
   * @returns The execution's result
   */
  async recordError(message: string, exitCode: number | null = null): Promise<ExecutionResult> {
    const { storage, repo, taskHash, inputHashes, unit } = this;
    const { inHash, executionId, startTime } = this.ids;
    const status: ExecutionStatus = variant('error', {
      executionId,
      inputHashes,
      startedAt: new Date(startTime),
      completedAt: new Date(),
      message,
      unit,
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
  }

  /**
   * Records an attempt e3 stopped — `cancelled`, or an `error` naming the
   * cause — or a signal ended (`failed`, exit code -1), appending `e3:
   * <cause>` to its stderr log.
   *
   * @remarks
   * A log that cannot be appended to is warned of, and the record is written
   * all the same.
   *
   * @param outcome - How it is recorded
   * @param cause - Why it stopped, as its log and its record say
   * @param peakBytes - The highest peak its runners reported, which a
   *   `failed` record keeps
   * @returns The execution's result
   */
  async recordStopped(outcome: 'cancelled' | 'error' | 'failed', cause: string, peakBytes?: number): Promise<ExecutionResult> {
    const { storage, repo, taskHash, inputHashes, unit } = this;
    const { inHash, executionId, startTime } = this.ids;
    try {
      await storage.logs.append(repo, taskHash, inHash, executionId, 'stderr', `e3: ${cause}\n`);
    } catch (err) {
      console.warn(`Failed to append stderr log: ${err instanceof Error ? err.message : String(err)}`);
    }
    const stopped = { executionId, inputHashes, startedAt: new Date(startTime), completedAt: new Date(), unit };
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
  }

  /**
   * Records the task's own failure, as its runner reported it: the attempt is
   * `failed`, with the runner's exit code.
   *
   * @param exitCode - The runner's exit code; `null` is recorded as -1
   * @param error - What the runner said: its exit and the tail of its stderr
   * @param peakBytes - The highest peak its runners reported
   * @returns The execution's result
   */
  async recordFailed(exitCode: number | null, error: string | null, peakBytes?: number): Promise<ExecutionResult> {
    const { storage, repo, taskHash, inputHashes, unit } = this;
    const { inHash, executionId, startTime } = this.ids;
    const status: ExecutionStatus = variant('failed', {
      executionId,
      inputHashes,
      startedAt: new Date(startTime),
      completedAt: new Date(),
      exitCode: BigInt(exitCode ?? -1),
      peakBytes: peakBytes === undefined ? none : some(BigInt(peakBytes)),
      unit,
    });
    await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);
    return {
      inputsHash: inHash,
      executionId,
      cached: false,
      state: 'failed',
      outputHash: null,
      exitCode,
      duration: Date.now() - startTime,
      error,
      cancelled: false,
      ...(peakBytes !== undefined && { peakBytes }),
    };
  }

  /**
   * Records the attempt's success: the output it stored through the store's
   * door.
   *
   * @param outputHash - The output's hash
   * @param peakBytes - The highest peak its runners reported
   * @returns The execution's result
   */
  async recordSuccess(outputHash: string, peakBytes?: number): Promise<ExecutionResult> {
    const { storage, repo, taskHash, inputHashes, unit } = this;
    const { inHash, executionId, startTime } = this.ids;
    const status: ExecutionStatus = variant('success', {
      executionId,
      inputHashes,
      outputHash,
      startedAt: new Date(startTime),
      completedAt: new Date(),
      peakBytes: peakBytes === undefined ? none : some(BigInt(peakBytes)),
      plan: none,
      unit,
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
  }
}

/**
 * Reads and decodes a task object; or, when it does not read, records the
 * execution `error`, naming why, and whether it is a unit, and returns its
 * result.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param taskHash - Hash of the task object
 * @param inputHashes - The inputs as the execution records them
 * @param ids - The attempt's identity
 * @param unit - Whether the execution is a unit of a split task
 * @returns The task object, or the execution's result when it does not read
 */
export async function readTaskObject(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  inputHashes: string[],
  ids: ExecutionIds,
  unit: boolean,
): Promise<TaskObject | ExecutionResult> {
  try {
    return decodeTaskObject(await storage.objects.read(repo, taskHash));
  } catch (err) {
    return new ExecutionAttempt(storage, repo, taskHash, inputHashes, ids, unit).recordError(`Failed to read task object: ${String(err)}`);
  }
}

/**
 * An execution's result, as a {@link TaskRunner} reports it.
 *
 * @param result - The execution's result
 * @returns The task's result: its outcome, and the output, exit code and error
 *   its state has
 */
export function toTaskResult(result: ExecutionResult): TaskResult {
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
