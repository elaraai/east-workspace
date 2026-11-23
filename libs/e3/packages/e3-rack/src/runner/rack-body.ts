/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ExecutionAttempt, touchReachable, unitCap, uuidv7, type ExecutionResult, type TaskBodyExecutor, type TaskBodyRequest } from '@elaraai/e3-core';
import type { LeaseHandle } from '../client/session.js';
import { recordClosure, stagedObjects, taskClosure } from '../lease/closure.js';
import { RACK_LEASE_VERSION, describeRackPhases, leaseReserve, readRackPhases, type RackLeaseEvent, type RackLeaseResources, type RackReason } from '../protocol/task-envelope.js';
import { splitUnitToWire } from '../runner-event.js';
import type { RackFetchCost } from '../protocol/placement.js';
import { weighFetch } from './fetch-cost.js';
import { RackPlacementReport, admitWork, awaitLease, fallbackReason, hostBound, leaveLease, outgrownCap, readDelegation, thrownFallback, transferFailed,
  wholeResources, type RackDelegationOptions, type RackVerdict } from './rack-lease.js';

/**
 * What a body's lease asks of a rack, and what the rack books for it.
 *
 * @remarks
 * A unit of a split task takes one core, reserves what it expects to need,
 * and is capped where e3-core caps a local unit that expects the same peak
 * (`unitCap`): half as much again. What it expects is its stage's measured
 * peak, the task's previous peak, or, the first time the task runs, e3-core's
 * estimate of the largest piece (the runner's own memory and what the piece
 * holds of its rows), which a local unit reserves too: so a rack holds as
 * many units as a local run of its memory would, and a first run is as wide
 * as a later one. Only a unit that expects nothing at all is given its rule's
 * memory limit, else its size's memory, as its reservation and its cap. A
 * whole task asks what whole work does ({@link wholeResources}).
 *
 * @param request - The task body or unit
 * @param verdict - Its rule's size, memory limit and GPU
 * @param mostCores - The most cores a rack that could take the work has; no
 *   bound unless given
 * @returns The resources, or the reason the work cannot be a rack's: the cap
 *   a unit needs is more than its rule's memory limit
 */
export function leaseResources(request: Pick<TaskBodyRequest, 'unit' | 'options'>, verdict: RackVerdict,
  mostCores = Infinity): RackLeaseResources | RackReason {
  if (request.unit === undefined) return wholeResources(verdict, mostCores);
  const expected = request.options.expectedPeakBytes;
  if (expected === undefined || expected <= 0) return { ...wholeResources(verdict), kind: 'unit', cores: 1 };
  return unitResources(expected, verdict);
}

/** A unit that reserves `reserve` bytes, capped at `unitCap` of it; or the
 *  reason it cannot be a rack's: that cap passes its rule's memory limit. */
function unitResources(reserve: number, verdict: RackVerdict): RackLeaseResources | RackReason {
  const cap = unitCap(reserve);
  if (verdict.memoryLimit !== null && cap > verdict.memoryLimit) return { code: 'memory-limit-exceeded', needsBytes: cap, limitBytes: verdict.memoryLimit };
  return { kind: 'unit', cores: 1, memoryBytes: cap, reserveBytes: reserve, gpu: verdict.gpu };
}

/**
 * Delegates eligible cache misses through the shared hub. The hub alone
 * writes the remote attempt; local() owns every local fallback and grant.
 *
 * Work that declares an environment is leased once the environment's layers
 * are kept for the platform of a rack that composes environments: they are
 * built first, once for an environment and a platform ({@link RackLayerBuilds}),
 * and work whose environment no install makes for that platform, or whose
 * build fails, runs locally with the reason.
 *
 * A unit of a split task is leased only to a rack that caps it at what its
 * lease asks (`rackCapsUnits`), which is the hub's rule for granting one
 * too, so every unit runs where something stops it when it outgrows its
 * share: here, under the run's budget and guard, or on such a rack. The body
 * says so of itself (`TaskBodyExecutor.stopsUnits`), whatever racks there are:
 * a runner given it starts a stage's units together, and its host says
 * nothing for it.
 * @param options - Session, policy and placement sink
 * @returns The body hook for e3-core's LocalTaskRunner
 * @example
 * const runner = new LocalTaskRunner(repo, budget, { body: createRackBody({ session, policy, workspace: 'dev' }) });
 */
export function createRackBody(options: RackDelegationOptions): TaskBodyExecutor {
  const { session, policy } = options;
  const delegation = readDelegation(options);
  const { rackOnly, unreachableWaitMs } = delegation;
  const body: TaskBodyExecutor = async (request, local) => {
    const taskName = request.options.taskName ?? request.taskHash;
    const report = new RackPlacementReport(options.onPlacement, { taskName, role: request.role });
    const signal = request.options.signal;
    let handle: LeaseHandle | undefined;
    let untee: (() => void) | undefined;
    let leavingRack = false;
    const freshIds = () => ({ inHash: request.ids.inHash, executionId: uuidv7(), startTime: Date.now() });
    const stop = (kind: 'cancelled' | 'error', cause: string) => {
      leavingRack = true;
      return new ExecutionAttempt(request.storage, request.repo, request.taskHash, request.inputHashes, freshIds(), request.unit !== undefined && !request.unit.own).recordStopped(kind, cause);
    };
    // A rack's result that gives its reason is placed by it: the reason's
    // code, and its cause or detail, are what the run prints.
    const runLocal = async (reason: string, detail?: RackReason, said?: string, fetch?: RackFetchCost): Promise<ExecutionResult> => {
      leavingRack = true;
      await leaveLease(handle);
      const ids = handle === undefined ? request.ids : freshIds();
      report.local(reason, detail, fetch);
      // What went wrong is in the task's log: a rack's attempt, or the build
      // of its environment for a rack, in the build tool's own words.
      const line = reason.startsWith('fallback:') ? `e3: rack attempt failed on ${report.rackLabel}: ${reason.slice(9)} — running locally\n`
        : said !== undefined ? `e3: the environment was not built for a rack (${reason}): ${said} — running locally\n` : undefined;
      if (line !== undefined) {
        await request.storage.logs.append(request.repo, request.taskHash, ids.inHash, ids.executionId, 'stderr', line);
        request.options.onStderr?.(line);
      }
      return local(ids);
    };
    // Whether the work is leased at all, and the fleet as it sees it. Process
    // settings its runner was configured with stay on the standard body, and
    // a unit whose cap would pass its rule's limit is not a rack's: a unit is
    // pure, and runs under the local budget instead.
    const admitted = await admitWork({ session, delegation, signal, storage: request.storage, repo: request.repo, unit: request.unit !== undefined,
      judge: () => delegation.evaluator.evaluate(request), hostBound: hostBound(request.options, request.options.extraEnv),
      asks: (verdict, mostCores) => leaseResources(request, verdict, mostCores), onEnvironment: options.onEnvironment });
    // A run aborted while its work waited for a rack, or for its
    // environment's layers, starts nothing here either
    if (admitted.kind === 'aborted') return await stop('cancelled', 'cancelled: e3 did not start the rack execution because the run was aborted');
    if (admitted.kind === 'local') return runLocal(admitted.why.reason, admitted.why.detail, admitted.why.said);
    const { verdict, fleet } = admitted;
    // What the lease asks: a unit its cap stopped asks more of its next lease.
    let resources: RackLeaseResources = admitted.resources;
    const canSpill = () => delegation.spills(request.options.budget, request.options.expectedPeakBytes ?? 0);
    // Under rack-only, work whose transfer failed is leased once more.
    let leasedAgain = false;
    // Since when a queued lease has had no rack that could claim it.
    const unreachable: { since?: number } = {};
    // When a rack last claimed the work, by this machine's clock: how long it
    // waited for its grant, from its hand-over, which its line says
    let claimedAt: number | undefined;
    try {
      const hashes = await taskClosure(request.storage, request.repo, request.taskHash, request.task,
        request.unit === undefined ? request.inputHashes : stagedObjects(request.unit.inputs, request.unit.merge));
      // Work that would spend longer fetching what the racks do not hold of
      // its closure than it last ran runs here; a first run follows its policy
      if (delegation.weighsFetch) {
        const ranMs = await delegation.runTimes.ranMs(request.storage, request.repo, request.taskHash, request.ids.inHash,
          request.unit !== undefined && !request.unit.own);
        const cost = ranMs === null ? null : await weighFetch({ links: (closed) => session.fetchCosts(closed), racks: fleet.racks().map((rack) => rack.rackId),
          storage: request.storage, repo: request.repo, hashes, ranMs, times: delegation.runTimes });
        if (cost !== null) return await runLocal('fetch-bound', undefined, undefined, cost);
      }
      const closure = await recordClosure(request.storage, request.repo, hashes);
      const timeoutMs = Math.min(verdict.timeoutMinutes * 60000, request.options.timeout ?? Infinity);
      // A lease at a time, as the local body runs an attempt at a time: a
      // unit its cap stopped is leased again asking for more.
      leases: for (;;) {
      handle = undefined;
      const common = { launchId: uuidv7(), repo: session.repoAlias, timeoutMs,
        taskHash: request.taskHash, force: true, verbose: request.options.verbose === true,
        ...(request.options.expectedPeakBytes !== undefined && { expectedPeakBytes: request.options.expectedPeakBytes }) };
      const event: RackLeaseEvent = { version: RACK_LEASE_VERSION,
        runnerEvent: request.unit === undefined ? { ...common, mode: 'task', inputHashes: request.inputHashes }
          : { ...common, mode: 'unit', unit: splitUnitToWire(request.unit) },
        workspace: options.workspace, taskName, e3Version: session.e3Version, closure, resources,
        ...(verdict.environment !== null && { environment: verdict.environment }) };
      if (signal?.aborted) return await stop('cancelled', 'cancelled: e3 did not start the rack execution because the run was aborted');
      const needs = resources;
      const submitted = await fleet.submit({ eventJson: JSON.stringify(event), tier: verdict.tier, computeSize: verdict.size }, needs,
        { joins: true, canSpill, onWaiting: report.waiting(needs) });
      if (submitted === null) return await runLocal('spill');
      handle = submitted.handle;
      report.queued(submitted);
      const leaseId = handle.leaseId;
      const end = await awaitLease(handle, { session, fleet, policy, rackOnly, unreachableWaitMs, signal, canSpill,
        deadline: { afterClaimMs: timeoutMs }, unreachable,
        onClaimed: (claim) => {
          untee?.();
          untee = claim.attempt === null ? undefined : session.onLog(claim.attempt.executionId, (stream, text) => {
            if (stream === 'stdout') request.options.onStdout?.(text); else request.options.onStderr?.(text);
          });
          // A claim after the first is the same work leased again, which a
          // run counts once
          report.claimed(claim.rackLabel, leaseId, needs);
          claimedAt = Date.now();
        } });
      if (end.kind === 'aborted') {
        return await stop('cancelled', end.how === 'left' ? 'cancelled: e3 left the rack execution because the run was aborted'
          : 'cancelled: e3 stopped waiting for the rack execution because the run was aborted');
      }
      if (end.kind === 'expired') return await stop('error', `timed out: the task exceeded ${verdict.timeoutMinutes} min on rack ${report.rackLabel}`);
      if (end.kind === 'local') return await runLocal(end.reason);
      const result = end.result;
      if (end.attempt === null) return await runLocal('fallback:missing-attempt');
      const attempt = end.attempt;
      // What the rack said of the lease beyond its outcome, and how the work
      // runs here by it
      const reason = report.reason(leaseId, result);
      const fallback = (text: string | undefined, otherwise: string) => runLocal(fallbackReason(reason, text, otherwise), reason);
      const duration = () => Date.now() - request.ids.startTime;
      // Where its time went on the rack, as its rack says it (#1723): what its
      // line says after its duration
      const phases = readRackPhases(result.phases);
      const timing = phases === undefined ? '' : describeRackPhases(phases, claimedAt === undefined ? undefined : claimedAt - request.ids.startTime);
      const peak = { ...(result.peakBytes !== undefined && { peakBytes: result.peakBytes }), ...(timing !== '' && { timing }) };
      if (reason?.code === 'outgrew-cap') {
        const cap = outgrownCap(reason, resources);
        if (resources.kind === 'unit') {
          // The rack stopped the unit at its cap, as its cgroup's cap stops
          // a local one, which then runs again under a cap half as large
          // again. So does this one, on its next lease: unless that would
          // pass its rule's limit, or what any rack could hold, when it
          // runs locally, under the local budget.
          const again = unitCap(cap);
          request.options.onRequeued?.({ reason: 'cap', peak: cap, reserves: cap });
          report.outgrew(leaseId, cap, again);
          untee?.(); untee = undefined;
          if (verdict.memoryLimit !== null && again > verdict.memoryLimit) {
            return await runLocal('memory-limit-exceeded', { code: 'memory-limit-exceeded', needsBytes: again, limitBytes: verdict.memoryLimit });
          }
          // It reserves what it reached, as a local unit its cap stopped does.
          const larger = { ...resources, memoryBytes: again, reserveBytes: cap };
          const nowhere = fleet.unheld(larger);
          if (nowhere !== null) return await runLocal(nowhere.reason, nowhere.detail);
          resources = larger;
          continue leases;
        }
        // A whole task e3 does not run again: its cap stopped it, and that
        // is its failure, as a task the local guard stops fails.
        report.outgrew(leaseId, cap);
        if (policy.retryTaskFailuresLocally) return await fallback(result.error, 'the task outgrew its cap');
        return { inputsHash: request.ids.inHash, executionId: attempt.executionId, cached: false, state: 'failed', outputHash: null, exitCode: -1, duration: duration(),
          error: `memory-limit-exceeded: the task outgrew its cap of ${Math.round(cap / 1024 ** 2)} MiB on rack ${report.rackLabel}; raise --memory-limit or --size`, cancelled: false, ...peak };
      }
      if (reason?.code === 'requeued-pressure' && resources.kind === 'unit') {
        // The rack's host ran short of memory, and the rack stopped the
        // newest work it held: this unit, which did not outgrow its own
        // cap. It runs again reserving what it reached, at least what it
        // reserved, as the local budget's guard runs one again; past its
        // rule's limit, or every rack's memory, it runs locally.
        const reached = Math.max(reason.peakBytes ?? 0, leaseReserve(resources));
        const again = unitResources(reached, verdict);
        request.options.onRequeued?.({ reason: 'budget', peak: reason.peakBytes ?? reached, reserves: reached });
        report.stopped(leaseId, reason.peakBytes ?? reached, reached);
        untee?.(); untee = undefined;
        if ('code' in again) return await runLocal(again.code, again);
        const nowhere = fleet.unheld(again);
        if (nowhere !== null) return await runLocal(nowhere.reason, nowhere.detail);
        resources = again;
        continue leases;
      }
      if (result.cancelled === true) {
        // To e3-core a cancelled result is its own abort's: the task goes back
        // to pending, and a loop that was not aborted launches it again at
        // once. Only this run's abort is one. A rack that stopped the attempt
        // for a reason of its own did not run it, and the work runs locally.
        if (!signal?.aborted) return await fallback(result.error, 'the rack stopped the attempt');
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
      // message begins `timed out:` (as an abort's begins `cancelled:`), and
      // the rack gives it no reason, or `task-error`, which names the task's
      // own failure. The task would use its time up again here, so that error
      // stands. Any other error is the rack's, and the work runs locally. So
      // is any end the rack gives a reason of its own for, whatever its words
      // begin with, and whatever its state: a task whose process the rack's
      // work disk filling killed fails, which is no failure of the task's. A
      // task's own failure is its verdict, whatever its message mentions,
      // unless the policy retries failures locally.
      // A transfer that failed its tries is the link's fault: a run that
      // keeps its work for a rack leases it once more before it runs locally.
      if (rackOnly && !leasedAgain && transferFailed(reason)) {
        leasedAgain = true;
        untee?.(); untee = undefined;
        continue leases;
      }
      const racksFault = reason !== undefined && reason.code !== 'task-error';
      const timedOut = state === 'error' && !racksFault && /^timed out:/.test(result.error ?? '');
      if (racksFault || (state === 'error' ? !timedOut : policy.retryTaskFailuresLocally)) return await fallback(result.error, 'rack execution failed');
      return { inputsHash: request.ids.inHash, executionId: attempt.executionId, cached: false, state, outputHash: null,
        exitCode: result.exitCode ?? null, duration: duration(), error: result.error ?? null, cancelled: false, ...peak };
      }
    } catch (error) {
      if (leavingRack) throw error;
      return await runLocal(thrownFallback(error));
    } finally { untee?.(); }
  };
  // Every unit runs where something stops it when it outgrows its share
  return Object.assign(body, { stopsUnits: true });
}
