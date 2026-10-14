/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ExecutionAttempt, touchReachable, uuidv7, type ExecutionResult, type TaskBodyExecutor, type TaskBodyRequest } from '@elaraai/e3-core';
import type { LeaseHandle, LeaseUpdate, RackSession } from '../client/session.js';
import { recordClosure, stagedObjects, taskClosure } from '../lease/closure.js';
import { RACK_LEASE_VERSION, type RackLeaseEvent } from '../protocol/task-envelope.js';
import { splitUnitToWire } from '../runner-event.js';
import { EligibilityEvaluator } from '../routing/eligibility.js';
import type { RackPolicy } from '../routing/policy.js';
import { E3_RACK_VERSION } from '../version.js';
import { compatibleRacks } from './capacity.js';

/** Reports the placement of one task body or split unit. */
export type RackPlacementEvent =
  | { taskName: string; role: 'task' | 'unit'; where: 'rack'; rackLabel: string; leaseId: string }
  | { taskName: string; role: 'task' | 'unit'; where: 'local'; reason: string };

/** Configures a run's body executor without acquiring local resources. */
export interface RackBodyOptions {
  /** Live session serving this repository. */
  session: RackSession;
  /** Policy snapshot for this run. */
  policy: RackPolicy;
  /** Workspace named on the rack's activity view. */
  workspace: string;
  /** Disables capacity spill, but still permits infrastructure fallback. */
  rackOnly?: boolean;
  /** Receives placement and fallback notifications. */
  onPlacement?: (event: RackPlacementEvent) => void;
}

/** Whether this body could obtain a local core and its memory reservation. */
function localIdle(request: TaskBodyRequest): boolean {
  const budget = request.options.budget;
  if (budget === undefined) return true;
  const memory = request.options.expectedPeakBytes ?? 0;
  return budget.queued === 0 && budget.inFlight < budget.cores &&
    (memory > budget.memory ? budget.inFlight === 0 : budget.used + memory <= budget.memory);
}

/** Waits without abandoning a pending next() when a timer wins the race. */
function wait(next: Promise<LeaseUpdate>, ms: number, signal?: AbortSignal): Promise<LeaseUpdate | 'tick' | 'abort'> {
  if (signal?.aborted) return Promise.resolve('abort');
  return new Promise((resolve, reject) => {
    const finish = (value: LeaseUpdate | 'tick' | 'abort') => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(value); };
    const abort = () => finish('abort');
    const timer = setTimeout(() => finish('tick'), Math.max(1, Math.min(ms, 2147483647)));
    signal?.addEventListener('abort', abort, { once: true });
    next.then(finish, (error: unknown) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); });
  });
}

/**
 * Delegates eligible cache misses through the shared hub. The hub alone
 * writes the remote attempt; local() owns every local fallback and grant.
 * @param options - Session, policy and placement sink
 * @returns The body hook for e3-core's LocalTaskRunner
 * @example
 * const runner = new LocalTaskRunner(repo, budget, { body: createRackBody({ session, policy, workspace: 'dev' }) });
 */
export function createRackBody(options: RackBodyOptions): TaskBodyExecutor {
  const { session, policy } = options;
  const evaluator = new EligibilityEvaluator(policy);
  return async (request, local) => {
    const placement = { taskName: request.options.taskName ?? request.taskHash, role: request.role };
    let handle: LeaseHandle | undefined;
    let rackLabel = 'rack';
    let untee: (() => void) | undefined;
    let leavingRack = false;
    const freshIds = () => ({ inHash: request.ids.inHash, executionId: uuidv7(), startTime: Date.now() });
    const stop = (kind: 'cancelled' | 'error', cause: string) => {
      leavingRack = true;
      return new ExecutionAttempt(request.storage, request.repo, request.taskHash, request.inputHashes, freshIds(), request.unit !== undefined && !request.unit.own).recordStopped(kind, cause);
    };
    const runLocal = async (reason: string): Promise<ExecutionResult> => {
      leavingRack = true;
      if (handle !== undefined) await handle.cancel().catch(() => {});
      const ids = handle === undefined ? request.ids : freshIds();
      options.onPlacement?.({ ...placement, where: 'local', reason });
      if (reason.startsWith('fallback:')) {
        const line = `e3: rack attempt failed on ${rackLabel}: ${reason.slice(9)} — running locally\n`;
        await request.storage.logs.append(request.repo, request.taskHash, ids.inHash, ids.executionId, 'stderr', line);
        request.options.onStderr?.(line);
      }
      return local(ids);
    };
    if (request.options.signal?.aborted) return local();
    if (session.hubLost) return runLocal('hub-unreachable');
    const verdict = await evaluator.evaluate(request);
    if (!verdict.eligible) return runLocal(verdict.reason);
    // An explicitly configured host process environment or identity cannot be
    // reproduced by a stock guest. Keep these settings on the standard body.
    if (request.options.env !== undefined || request.options.uid !== undefined || request.options.gid !== undefined ||
      (request.options.extraEnv !== undefined && Object.keys(request.options.extraEnv).length > 0)) return runLocal('host-process-settings');
    const racks = compatibleRacks(session.capacity(), verdict.tier);
    if (racks.length === 0) return runLocal(`no-rack-for-tier:${verdict.tier}`);
    const canSpill = () => policy.spill && !options.rackOnly && localIdle(request);
    const free = racks.reduce((sum, rack) => sum + Number(rack.capacity) - Number(rack.busy), 0) - Number(session.capacity().queued);
    try {
      const hashes = await taskClosure(request.storage, request.repo, request.taskHash, request.task,
        request.unit === undefined ? request.inputHashes : stagedObjects(request.unit.inputs, request.unit.merge));
      const closure = await recordClosure(request.storage, request.repo, hashes);
      const timeoutMs = Math.min(verdict.timeoutMinutes * 60000, request.options.timeout ?? Infinity);
      const common = { launchId: uuidv7(), repo: session.repoAlias, timeoutMs,
        taskHash: request.taskHash, force: true, verbose: request.options.verbose === true,
        ...(request.options.expectedPeakBytes !== undefined && { expectedPeakBytes: request.options.expectedPeakBytes }) };
      const event: RackLeaseEvent = { version: RACK_LEASE_VERSION,
        runnerEvent: request.unit === undefined ? { ...common, mode: 'task', inputHashes: request.inputHashes }
          : { ...common, mode: 'unit', unit: splitUnitToWire(request.unit) },
        workspace: options.workspace, taskName: placement.taskName, e3Version: E3_RACK_VERSION, closure };
      if (request.options.signal?.aborted) return await stop('cancelled', 'cancelled: e3 did not start the rack execution because the run was aborted');
      handle = await session.createLease({ eventJson: JSON.stringify(event), tier: verdict.tier, computeSize: verdict.size });
      // Attach before spilling: identical work already held by the rack costs
      // no additional capacity and must remain shared between local runs.
      if (!handle.attached && free <= 0 && canSpill()) return await runLocal('spill');
      const claimWait = Number(policy.claimTimeoutSeconds) * 1000;
      let claimDeadline = Date.now() + claimWait;
      let executionDeadline: number | undefined;
      let next = handle.next();
      for (;;) {
        const update = await wait(next, (executionDeadline ?? claimDeadline) - Date.now(), request.options.signal);
        if (update === 'abort') {
          await handle.cancel().catch(() => {});
          return await stop('cancelled', 'cancelled: e3 stopped waiting for the rack execution because the run was aborted');
        }
        if (update === 'tick') {
          if (executionDeadline !== undefined) {
            if (Date.now() < executionDeadline) continue;
            await handle.cancel().catch(() => {});
            return await stop('error', `timed out: the task exceeded ${verdict.timeoutMinutes} min on rack ${rackLabel}`);
          }
          await session.refreshCapacity();
          if (compatibleRacks(session.capacity(), verdict.tier).length === 0) return await runLocal('fallback:rack-unavailable');
          if (canSpill()) return await runLocal('fallback:not-claimed');
          claimDeadline = Date.now() + claimWait;
          continue;
        }
        if (update.kind === 'claimed') {
          rackLabel = update.rackLabel;
          // The host owns the deadline; the rack's clock does not determine it.
          executionDeadline ??= Date.now() + common.timeoutMs;
          untee?.();
          untee = session.onLog(update.attempt.executionId, (stream, text) => {
            if (stream === 'stdout') request.options.onStdout?.(text); else request.options.onStderr?.(text);
          });
          options.onPlacement?.({ ...placement, where: 'rack', rackLabel, leaseId: handle.leaseId });
          next = handle.next();
          continue;
        }
        if (update.kind === 'lost') return await runLocal(`fallback:${update.reason}`);
        if (update.kind === 'cancelled') {
          return await stop('cancelled', 'Rack work was cancelled');
        }
        const result = update.result;
        if (update.attempt === null) return await runLocal('fallback:missing-attempt');
        const cancelled = result.cancelled === true;
        const timedOut = /timed?\s*out/i.test(result.error ?? '');
        const taskFailed = result.state === 'failed' || (result.state === undefined && (result.exitCode ?? 0) > 0);
        const state = cancelled || timedOut ? 'error' : result.state ?? (result.status === 'success' ? 'success' : taskFailed ? 'failed' : 'error');
        if (state === 'success') {
          if (result.outputHash === undefined || !await touchReachable(request.storage, request.repo, [result.outputHash])) return await runLocal('fallback:incomplete-output');
        } else if (!cancelled && !timedOut && (!taskFailed || policy.retryTaskFailuresLocally)) {
          return await runLocal(`fallback:${result.error ?? 'rack execution failed'}`);
        }
        return { inputsHash: request.ids.inHash, executionId: update.attempt.executionId, cached: false,
          state, outputHash: state === 'success' ? result.outputHash! : null, exitCode: state === 'success' ? 0 : result.exitCode ?? null,
          duration: Date.now() - request.ids.startTime, error: result.error ?? null, cancelled,
          ...(result.peakBytes !== undefined && { peakBytes: result.peakBytes }) };
      }
    } catch (error) {
      if (leavingRack) throw error;
      return await runLocal(`fallback:${error instanceof Error ? error.message : String(error)}`);
    } finally { untee?.(); }
  };
}
