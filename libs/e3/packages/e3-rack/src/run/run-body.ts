/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The origin's body for a run a rack runs part of: each task granted to the
 * rack's run is taken whole, and its result taken from that run when the
 * origin's loop reaches it; everything else goes to the body it wraps.
 *
 * The origin owns every attempt: this process records it running, appends its
 * log as the rack's run delivers it, and records how it ended. A result is
 * taken only once its whole output is held here. Where the rack's run hands a
 * task back, has no result for it, or is lost, the attempt is recorded
 * interrupted, and the task runs here under a fresh identity.
 */

import { variant } from '@elaraai/east';
import {
  ExecutionAttempt, processOwner, touchReachable, uuidv7,
  type ExecutionIds, type ExecutionResult, type ReplicaRun, type ReplicaRunAnswer, type TaskBodyExecutor, type TaskBodyRequest,
} from '@elaraai/e3-core';
import type { RackPlacementEvent } from '../protocol/placement.js';

/** How {@link createRackRunBody} is made. */
export interface RackRunBodyOptions {
  /** The rack's run, granted the selection */
  readonly run: ReplicaRun;
  /** The tasks granted it, by name */
  readonly selected: ReadonlySet<string>;
  /** Whether a task that failed on the rack runs again here */
  readonly retryTaskFailuresLocally: boolean;
  /** The body for everything else: today's rack body, or none */
  readonly inner?: TaskBodyExecutor;
  /** Told where each granted task ran: on the rack, or here, after its
   *  rack's run gave it back, had no result, or was lost */
  readonly onPlacement?: (event: RackPlacementEvent) => void;
  /** The rack holding the run, and its lease, once one has taken it up */
  readonly placedOn?: () => { readonly rackLabel: string; readonly leaseId: string } | undefined;
}

/** Why an error that is not the task's own is no verdict: a deadline's is. */
const TIMED_OUT = 'timed out:';

/**
 * Makes the origin's body for a run a rack runs part of.
 *
 * @param options - The rack's run, what it was granted, the policy's retry,
 *   and the body it wraps
 * @returns The body
 * @example
 * const body = createRackRunBody({ run, selected: new Set(['train']), retryTaskFailuresLocally: false });
 * const runner = new LocalTaskRunner(repo, budget, { body });
 */
export function createRackRunBody(options: RackRunBodyOptions): TaskBodyExecutor {
  const { selected, inner } = options;
  const body = (request: TaskBodyRequest, local: (ids?: ExecutionIds) => Promise<ExecutionResult>): Promise<ExecutionResult> => {
    const name = request.options.taskName;
    if (request.role !== 'task' || name === undefined || !selected.has(name)) return inner === undefined ? local() : inner(request, local);
    return fromTheRack(request, local, name, options);
  };
  // With no body it wraps, every unit runs through `local()`, under the
  // budget's guard, as a runner with no body runs it: it stops units
  const stopsUnits = inner === undefined ? true : inner.stopsUnits;
  return Object.assign(body, {
    takesWhole: (_taskHash: string, { taskName }: { taskName?: string }) => taskName !== undefined && selected.has(taskName),
    ...(stopsUnits !== undefined && { stopsUnits }),
  });
}

/** Takes a granted task's result from the rack's run, or runs it here. */
async function fromTheRack(
  request: TaskBodyRequest,
  local: (ids?: ExecutionIds) => Promise<ExecutionResult>,
  taskName: string,
  { run, retryTaskFailuresLocally, onPlacement, placedOn }: RackRunBodyOptions,
): Promise<ExecutionResult> {
  const { storage, repo, taskHash, inputHashes, ids, options } = request;
  // Said as the rack's when it gave a verdict, and as here's when it ran here
  const onTheRack = (): void => {
    const where = placedOn?.();
    if (where !== undefined) onPlacement?.({ kind: 'placed', taskName, role: 'task', where: 'rack', rackLabel: where.rackLabel, leaseId: where.leaseId });
  };
  const attempt = new ExecutionAttempt(storage, repo, taskHash, inputHashes, ids, false);
  const startedAt = new Date(ids.startTime);
  const owner = await processOwner();
  await attempt.recordOwner(owner, startedAt);
  await attempt.recordRunning(owner, startedAt);
  const logs = { stdout: attempt.log('stdout'), stderr: attempt.log('stderr') };
  const onLog = (stream: 'stdout' | 'stderr', text: string): void => {
    void logs[stream].push(text);
    (stream === 'stdout' ? options.onStdout : options.onStderr)?.(text);
  };

  /** The attempt ended here as interrupted, why in its log, and the task run here. */
  const runHere = async (code: string, cause: string): Promise<ExecutionResult> => {
    onPlacement?.({ kind: 'placed', taskName, role: 'task', where: 'local', reason: `fallback:${code}` });
    await logs.stderr.push(`e3: ${cause}: running it here\n`);
    await attempt.flushLog();
    await storage.refs.executionWrite(repo, taskHash, ids.inHash, ids.executionId, variant('interrupted', {
      executionId: ids.executionId, inputHashes, startedAt, completedAt: new Date(), pid: 0n, unit: false,
      reason: { kind: variant('host', code), message: cause },
    }));
    return local({ inHash: ids.inHash, executionId: uuidv7(), startTime: Date.now() });
  };

  let answer: ReplicaRunAnswer;
  try {
    answer = await run.ask({ taskName, taskHash, inputsHash: ids.inHash, onLog, ...(options.signal !== undefined && { signal: options.signal }) });
  } catch (err) {
    // What the rack sent of its log before it was lost is the attempt's
    await Promise.all([logs.stdout.idle(), logs.stderr.idle()]);
    if (options.signal?.aborted) return attempt.recordStopped('cancelled', 'cancelled: e3 stopped waiting on the rack because the run was aborted');
    return runHere('rack.lost', `its rack run was lost (${err instanceof Error ? err.message : String(err)})`);
  }
  await Promise.all([logs.stdout.idle(), logs.stderr.idle()]);
  if (options.signal?.aborted) return attempt.recordStopped('cancelled', 'cancelled: e3 stopped waiting on the rack because the run was aborted');

  switch (answer.kind) {
    case 'handed-back':
      return runHere('rack.handed_back', `its rack handed it back (${answer.reason})`);
    case 'unknown':
      return runHere('rack.unknown', 'its rack run has no result for it');
    case 'done': {
      const durationMs = answer.durationMs;
      if (answer.state === 'success') {
        if (answer.outputHash === undefined || !await touchReachable(storage, repo, [answer.outputHash])) {
          return runHere('rack.incomplete_output', 'its output from the rack is not whole here');
        }
        await logs.stderr.push(`e3: on its rack: ran ${durationMs} ms\n`);
        const result = await attempt.recordSuccess(answer.outputHash, answer.peakBytes, attempt.flushLog());
        onTheRack();
        return { ...result, durationMs };
      }
      if (answer.state === 'failed') {
        if (retryTaskFailuresLocally && !(answer.error ?? '').startsWith(TIMED_OUT)) {
          return runHere('rack.failed', `it failed on its rack (exit code ${answer.exitCode ?? 'none'}), and the policy runs a failure again here`);
        }
        const result = await attempt.recordFailed(answer.exitCode ?? null, answer.error ?? null, answer.peakBytes);
        onTheRack();
        return { ...result, durationMs };
      }
      // An error a deadline gave is the task's verdict; any other is its rack's
      if (!(answer.error ?? '').startsWith(TIMED_OUT)) return runHere('rack.error', `its rack run could not run it (${answer.error ?? 'no reason given'})`);
      const result = await attempt.recordError(answer.error ?? TIMED_OUT);
      onTheRack();
      return { ...result, durationMs };
    }
  }
}
