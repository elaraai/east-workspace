/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ExecutionAttempt, touchReachable, unitCap, uuidv7, type ExecutionResult, type TaskBodyExecutor, type TaskBodyRequest } from '@elaraai/e3-core';
import type { LeaseHandle, LeaseUpdate, RackSession } from '../client/session.js';
import { recordClosure, stagedObjects, taskClosure } from '../lease/closure.js';
import { RACK_LEASE_VERSION, describeRackReason, readRackReason, readRackRetries, type RackLeaseEvent, type RackLeaseResources, type RackReason, type RackTransferRetry } from '../protocol/task-envelope.js';
import { splitUnitToWire } from '../runner-event.js';
import { EligibilityEvaluator, type Eligibility } from '../routing/eligibility.js';
import { RACK_SIZES, type RackPolicy } from '../routing/policy.js';
import { E3_RACK_VERSION } from '../version.js';
import { compatibleRacks, rackCouldHold, rackFree, rackResources, rackRoom } from './capacity.js';
import type { RackResources } from '../protocol/rack-json.js';

/**
 * Reports where one task body or split unit runs, and what happens to it on a
 * rack:
 * - `placed` on a rack, when one claims its lease;
 * - `placed` locally, with why: never a rack's work (`reason` is why it is not
 *   eligible), or a rack's work that this machine runs after all (`spill`,
 *   `no-rack-for-tier:<tier>`, or a `fallback:` with what went wrong, and the
 *   rack's `detail` when its result gave a reason);
 * - `retried`: a transfer of its lease failed a try and was given another;
 * - `waiting`: its lease is queued, and no rack has room for what it asks
 *   now. `rackLabel` is the rack with the most memory free, and `free` what
 *   that rack has, when it admits by its resources. A lease that waited says
 *   for how long once a rack claims it (`waitedMs`).
 */
export type RackPlacementEvent =
  | { kind: 'placed'; taskName: string; role: 'task' | 'unit'; where: 'rack'; rackLabel: string; leaseId: string; waitedMs?: number }
  | { kind: 'waiting'; taskName: string; role: 'task' | 'unit'; where: 'rack'; rackLabel: string; leaseId: string; needs: RackLeaseResources; free?: RackResources }
  | { kind: 'placed'; taskName: string; role: 'task' | 'unit'; where: 'local'; reason: string; detail?: RackReason }
  | { kind: 'retried'; taskName: string; role: 'task' | 'unit'; where: 'rack'; rackLabel: string; leaseId: string; retry: RackTransferRetry };

/**
 * Whether a local placement is of work a rack was to run: what a run prints
 * and counts as having run locally. Work that was never a rack's is not.
 *
 * @param event - A placement event
 * @returns Whether it is a rack's work run locally
 * @example
 * if (ranLocally(event)) console.log(`[LOCAL] ${event.taskName} (${event.reason})`);
 */
export function ranLocally(event: RackPlacementEvent): event is Extract<RackPlacementEvent, { where: 'local' }> {
  return event.kind === 'placed' && event.where === 'local' &&
    (event.detail !== undefined || event.reason === 'spill' || event.reason.startsWith('fallback:') || event.reason.startsWith('no-rack-'));
}

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

/**
 * What a body's lease asks of a rack, and what the rack books for it.
 *
 * @remarks
 * A unit of a split task takes one core and the cap e3-core gives a local
 * unit that expects the same peak (`unitCap`): half as much again as it is
 * expected to need. A unit nothing has measured yet is given its rule's
 * memory limit, else its size's memory. A whole task takes its size's cores,
 * and its rule's memory limit, else its size's memory, as its cap.
 *
 * @param request - The task body or unit
 * @param verdict - Its rule's size, memory limit and GPU
 * @returns The resources, or the reason the work cannot be a rack's: the cap
 *   a measured unit needs is more than its rule's memory limit
 */
export function leaseResources(request: Pick<TaskBodyRequest, 'unit' | 'options'>, verdict: Extract<Eligibility, { eligible: true }>): RackLeaseResources | RackReason {
  const size = RACK_SIZES[verdict.size];
  const fallback = verdict.memoryLimit ?? size.memoryBytes;
  if (request.unit === undefined) return { kind: 'task', cores: size.cores, memoryBytes: fallback, gpu: verdict.gpu };
  const expected = request.options.expectedPeakBytes;
  if (expected === undefined) return { kind: 'unit', cores: 1, memoryBytes: fallback, gpu: verdict.gpu };
  const cap = unitCap(expected);
  if (verdict.memoryLimit !== null && cap > verdict.memoryLimit) return { code: 'memory-limit-exceeded', needsBytes: cap, limitBytes: verdict.memoryLimit };
  return { kind: 'unit', cores: 1, memoryBytes: cap, gpu: verdict.gpu };
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
    // A rack's result that gives its reason is placed by it: the reason's
    // code, and its cause or detail, are what the run prints.
    const runLocal = async (reason: string, detail?: RackReason): Promise<ExecutionResult> => {
      leavingRack = true;
      if (handle !== undefined) await handle.cancel().catch(() => {});
      const ids = handle === undefined ? request.ids : freshIds();
      options.onPlacement?.({ kind: 'placed', ...placement, where: 'local', reason, ...(detail !== undefined && { detail }) });
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
    if (compatibleRacks(session.capacity(), verdict.tier).length === 0) return runLocal(`no-rack-for-tier:${verdict.tier}`);
    // A unit whose cap would pass its rule's limit is not a rack's: a unit is
    // pure, and runs under the local budget instead.
    const resources = leaseResources(request, verdict);
    if ('code' in resources) return runLocal(resources.code, resources);
    // Work no rack could hold, with nothing else on it, is not queued: it
    // would wait for ever. For want of memory it runs locally by that name.
    const fleet = compatibleRacks(session.capacity(), verdict.tier);
    if (!fleet.some((rack) => rackCouldHold(rack, resources))) {
      const most = Math.max(...fleet.map((rack) => rackResources(rack)?.memoryBytes ?? 0));
      return resources.memoryBytes > most
        ? runLocal('memory-limit-exceeded', { code: 'memory-limit-exceeded', needsBytes: resources.memoryBytes, limitBytes: most })
        : runLocal(`no-rack-holds:${resources.gpu ? 'gpu' : `${resources.cores}-cores`}`);
    }
    const canSpill = () => policy.spill && !options.rackOnly && localIdle(request);
    // How many more leases asking this much the compatible racks hold in the
    // latest snapshot, less the work already queued for them.
    const room = () => {
      const snapshot = session.capacity();
      return compatibleRacks(snapshot, verdict.tier).reduce((sum, rack) => sum + rackRoom(rack, resources), 0) - Number(snapshot.queued);
    };
    let waitingSince: number | undefined;
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
        workspace: options.workspace, taskName: placement.taskName, e3Version: E3_RACK_VERSION, closure, resources };
      if (request.options.signal?.aborted) return await stop('cancelled', 'cancelled: e3 did not start the rack execution because the run was aborted');
      const lease = { eventJson: JSON.stringify(event), tier: verdict.tier, computeSize: verdict.size };
      const full = room() <= 0;
      if (full && canSpill()) {
        // The racks are full. Identical work already queued or held costs them
        // no further capacity, so attach to it; anything else runs locally now,
        // without first queuing a lease a rack could claim before the spill.
        const attached = await session.attachLease(lease);
        if (attached === null) return await runLocal('spill');
        handle = attached;
      } else handle = await session.createLease(lease);
      if (full && handle.attempt === null) {
        // Queued with no room for it now: said once, with the rack that has
        // the most memory free. Work attached to a lease a rack already holds
        // waits for nothing.
        waitingSince = Date.now();
        const racks = compatibleRacks(session.capacity(), verdict.tier);
        const best = racks.reduce((most, rack) => (rackFree(rack)?.memoryBytes ?? 0) > (rackFree(most)?.memoryBytes ?? 0) ? rack : most, racks[0]);
        if (best !== undefined) {
          const free = rackFree(best);
          options.onPlacement?.({ kind: 'waiting', ...placement, where: 'rack', rackLabel: best.label, leaseId: handle.leaseId, needs: resources, ...(free !== undefined && { free }) });
        }
      }
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
          options.onPlacement?.({ kind: 'placed', ...placement, where: 'rack', rackLabel, leaseId: handle.leaseId,
            ...(waitingSince !== undefined && { waitedMs: Date.now() - waitingSince }) });
          waitingSince = undefined;
          next = handle.next();
          continue;
        }
        if (update.kind === 'lost') return await runLocal(`fallback:${update.reason}`);
        if (update.kind === 'cancelled') {
          // This session left the lease: by the run's abort, or by closing
          // under a run that was not aborted, whose work then finishes locally.
          if (request.options.signal?.aborted) return await stop('cancelled', 'cancelled: e3 left the rack execution because the run was aborted');
          return await runLocal('fallback:rack session closed');
        }
        const result = update.result;
        if (update.attempt === null) return await runLocal('fallback:missing-attempt');
        const attempt = update.attempt;
        // What the rack said of the lease beyond its outcome. A reason this
        // build cannot read is a rack's fault it cannot name.
        const leaseId = handle.leaseId;
        for (const retry of readRackRetries(result.retries)) options.onPlacement?.({ kind: 'retried', ...placement, where: 'rack', rackLabel, leaseId, retry });
        const reason = readRackReason(result.reason);
        // A reason that carries no words of its own is said with the result's.
        const fallback = (text: string | undefined, otherwise: string) => runLocal(`fallback:${reason === undefined ? text ?? otherwise
          : reason.cause === undefined && reason.detail === undefined && text !== undefined ? `${reason.code}: ${text}` : describeRackReason(reason)}`, reason);
        const duration = () => Date.now() - request.ids.startTime;
        const peak = result.peakBytes !== undefined ? { peakBytes: result.peakBytes } : {};
        if (result.cancelled === true) {
          // To e3-core a cancelled result is its own abort's: the task goes back
          // to pending, and a loop that was not aborted launches it again at
          // once. Only this run's abort is one. A rack that stopped the attempt
          // for a reason of its own did not run it, and the work runs locally.
          if (!request.options.signal?.aborted) return await fallback(result.error, 'the rack stopped the attempt');
          return { inputsHash: request.ids.inHash, executionId: attempt.executionId, cached: false, state: 'error', outputHash: null,
            exitCode: result.exitCode ?? null, duration: duration(), error: result.error ?? null, cancelled: true, ...peak };
        }
        const state = result.state ?? (result.status === 'success' ? 'success' : (result.exitCode ?? 0) > 0 ? 'failed' : 'error');
        if (state === 'success') {
          if (result.outputHash === undefined || !await touchReachable(request.storage, request.repo, [result.outputHash])) return await runLocal('fallback:incomplete-output');
          return { inputsHash: request.ids.inHash, executionId: attempt.executionId, cached: false, state, outputHash: result.outputHash,
            exitCode: 0, duration: duration(), error: result.error ?? null, cancelled: false, ...peak };
        }
        // e3-core, which the rack ran, records its own timeout as an error whose
        // message begins `timed out:` (as an abort's begins `cancelled:`). The
        // task would use its time up again here, so that error stands. Any
        // other error is the rack's, and the work runs locally; a task's own
        // failure is its verdict, whatever its message mentions, unless the
        // policy retries failures locally.
        const timedOut = state === 'error' && /^timed out:/.test(result.error ?? '');
        if (state === 'error' ? !timedOut : policy.retryTaskFailuresLocally) return await fallback(result.error, 'rack execution failed');
        return { inputsHash: request.ids.inHash, executionId: attempt.executionId, cached: false, state, outputHash: null,
          exitCode: result.exitCode ?? null, duration: duration(), error: result.error ?? null, cancelled: false, ...peak };
      }
    } catch (error) {
      if (leavingRack) throw error;
      return await runLocal(`fallback:${error instanceof Error ? error.message : String(error)}`);
    } finally { untee?.(); }
  };
}
