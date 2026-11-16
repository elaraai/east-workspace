/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A function call on a rack: a named function's, or a one-shot's, leased
 * through the shared hub as a task's body is, over the same fleet, placement
 * and wait (`rack-lease.ts`). A call is recorded nowhere: its lease runs no
 * attempt and keeps no log, and its value comes back with its completion, or
 * as the object its completion commits.
 */

import { isObjectHash, uuidv7, type DetachedArg, type DetachedCallExecutor, type DetachedResult, type DetachedSpec, type StorageBackend } from '@elaraai/e3-core';
import type { LeaseHandle } from '../client/session.js';
import { detachedClosure, recordClosure } from '../lease/closure.js';
import { RACK_INLINE_ARGS_MAX, RACK_LEASE_VERSION, type RackFunctionResult, type RackLeaseEvent, type RackReason } from '../protocol/task-envelope.js';
import { detachedSpecToWire } from '../runner-event.js';
import { selectTask } from '../routing/policy.js';
import { RackPlacementReport, admitWork, awaitLease, fallbackReason, hostBound, leaveLease, outgrownCap, readDelegation, thrownFallback, transferFailed,
  wholeResources, type RackDelegationOptions } from './rack-lease.js';

/** What a call that ends with no value of its own says: nothing. */
const SILENT = { stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false } as const;

/** The outcome of a call aborted by its caller, as a local call's is. */
function aborted(): DetachedResult {
  return { kind: 'failed', exitCode: -1, ...SILENT };
}

/** A whole number a rack's outcome says, or the fallback when it says none. */
function count(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
}

/**
 * What a rack's outcome of a call says it printed, read for what this build
 * knows of it: a rack of another release may say more.
 */
function streams(outcome: RackFunctionResult): Pick<DetachedResult, 'stdout' | 'stderr' | 'stdoutTruncated' | 'stderrTruncated'> {
  return {
    stdout: typeof outcome.stdout === 'string' ? outcome.stdout : '',
    stderr: typeof outcome.stderr === 'string' ? outcome.stderr : '',
    stdoutTruncated: outcome.stdoutTruncated === true,
    stderrTruncated: outcome.stderrTruncated === true,
  };
}

/**
 * A call's value, as its rack's outcome names it: inline, or the object its
 * completion committed, sized before it is read, so a value over the call's
 * limit is never loaded. Null when the outcome names neither, or names an
 * object the store does not hold.
 */
async function valueOf(storage: StorageBackend, repo: string, outcome: RackFunctionResult, limit: number): Promise<Uint8Array | { bytes: number } | null> {
  if (typeof outcome.valueB64 === 'string') {
    const value = new Uint8Array(Buffer.from(outcome.valueB64, 'base64'));
    return value.length > limit ? { bytes: value.length } : value;
  }
  const hash = outcome.valueHash;
  if (typeof hash !== 'string' || !isObjectHash(hash) || !(await storage.objects.touch(repo, [hash]))[0]) return null;
  const { size } = await storage.objects.stat(repo, hash);
  if (size > limit) return { bytes: size };
  return storage.objects.read(repo, hash);
}

/**
 * Delegates a detached call to a rack through the shared hub, when it is fit
 * for one, and runs it here otherwise: by `local`, which takes the runner's
 * budget grant and process settings exactly as a call with no executor does.
 *
 * @remarks
 * A call is fit for a rack as a task is: its rule, by the name `fn:<name>`
 * (or every call, with `selected`), its runner's tier, the environment it
 * declares, and its program, scanned for platform calls that reach the host.
 * Its lease is sized as a whole task's ({@link wholeResources}), and is its
 * own: two calls of one program are two leases.
 *
 * Its program, and each value argument past {@link RACK_INLINE_ARGS_MAX} in
 * all, are written to the repository's store, unrooted, and staged through
 * the lease's closure, as a stored dataset argument is: the caller holds off
 * a sweep while it runs (`withRunningWork`).
 *
 * The call's time is its rule's, when a rule that matches its name sets one,
 * longer or shorter than its caller's; else its caller's own. It is counted
 * from when its lease is first queued, on the host's clock: a call the rack
 * has not answered by then is `timed_out`, and one that falls back to run
 * here runs with the time it has left. A call that is never leased runs here
 * with the same time.
 *
 * What each end does:
 * - a value, inline or the object its completion committed, is the call's
 *   value; `too_large` and `timed_out` are its answer, as a local run's are;
 * - the function's failure is its answer, unless the policy retries failures
 *   locally, as is its cap stopping it;
 * - the rack's fault — no outcome, an outcome with a reason of the rack's own
 *   (any but `task-error`), a value it could not relay, a lost lease, a
 *   transfer that failed its tries, a stop of its own — runs it here;
 * - the caller's abort leaves the lease, and ends the call as an aborted
 *   local call ends.
 *
 * @param options - Session, policy and placement sink, as a run's body's
 * @returns The executor for e3-core's LocalTaskRunner
 * @example
 * const runner = new LocalTaskRunner(repo, budget, { detached: createRackCall({ session, policy, workspace: 'dev', selected: true }) });
 * const result = await runner.runDetached(spec, { storage, functionName: 'train_once' });
 */
export function createRackCall(options: RackDelegationOptions): DetachedCallExecutor {
  const { session, policy } = options;
  const delegation = readDelegation(options);
  const { rackOnly, unreachableWaitMs } = delegation;
  return async (request, local) => {
    const { repo } = request;
    const signal = request.options.signal;
    const taskName = `fn:${request.options.functionName ?? 'anonymous'}`;
    // The call's time: its rule's when its rule sets one, else its caller's
    const ruled = request.options.functionName === undefined ? null : selectTask(policy, taskName).ruleTimeoutMinutes;
    const spec: DetachedSpec = ruled === null ? request.spec : { ...request.spec, limits: { ...request.spec.limits, timeoutMs: ruled * 60_000 } };
    const report = new RackPlacementReport(options.onPlacement, { taskName, role: 'call' });
    let handle: LeaseHandle | undefined;
    let leavingRack = false;
    // When the call must have answered by: set once its lease is first queued
    let deadline: number | undefined;
    const timedOut = (): DetachedResult => ({ kind: 'timed_out', ms: spec.limits.timeoutMs, ...SILENT });
    // A call leased before runs here with the time it has left; one never
    // leased, as it would with no rack. The build of its environment for a
    // rack, when that is why, says so in its own words.
    const runLocal = async (reason: string, detail?: RackReason, said?: string): Promise<DetachedResult> => {
      leavingRack = true;
      await leaveLease(handle);
      report.local(reason, detail);
      let result: DetachedResult;
      if (deadline === undefined) result = await local(spec);
      else {
        const left = deadline - Date.now();
        if (left <= 0) return timedOut();
        result = await local({ ...spec, limits: { ...spec.limits, timeoutMs: left } });
      }
      if (said === undefined) return result;
      return { ...result, stderr: `e3: the environment was not built for a rack (${reason}): ${said} — running locally\n${result.stderr}` };
    };
    // Whether the call is leased at all, sized as whole work is. Process
    // settings its runner was configured with, and variables of its own, stay
    // on the local call.
    const admitted = await admitWork({ session, delegation, signal, storage: request.options.storage, repo, unit: false,
      judge: (storage) => delegation.evaluator.evaluateCall(request, storage), hostBound: hostBound(request.settings, request.options.extraEnv),
      asks: wholeResources, onEnvironment: options.onEnvironment });
    // A caller that aborts while its call waits for a rack, or for its
    // environment's layers, starts nothing here either
    if (admitted.kind === 'aborted') return aborted();
    if (admitted.kind === 'local') return runLocal(admitted.why.reason, admitted.why.detail, admitted.why.said);
    const { verdict, fleet, resources, storage } = admitted;
    const canSpill = () => delegation.spills(request.budget);
    // Under rack-only, a call whose transfer failed is leased once more.
    let leasedAgain = false;
    const unreachable: { since?: number } = {};
    try {
      // The program, and a value argument past what a lease carries inline,
      // are objects of the repository, staged through the lease's closure
      const program = await storage.objects.write(repo, spec.bodyIr);
      const args: DetachedArg[] = [];
      let inline = 0;
      for (const arg of spec.args) {
        if (!(arg instanceof Uint8Array)) args.push(arg);
        else if (inline + arg.length <= RACK_INLINE_ARGS_MAX) { inline += arg.length; args.push(arg); }
        else args.push({ dataset: await storage.objects.write(repo, arg) });
      }
      const closure = await recordClosure(storage, repo, await detachedClosure(storage, repo, program, args, verdict.environment ?? undefined));
      const timeoutMs = spec.limits.timeoutMs;
      // The program travels by its hash, as the lease names it
      const wire = detachedSpecToWire({ ...spec, bodyIr: new Uint8Array(), args });
      leases: for (;;) {
        handle = undefined;
        const event: RackLeaseEvent = { version: RACK_LEASE_VERSION,
          runnerEvent: { mode: 'run-detached', launchId: uuidv7(), repo: session.repoAlias, timeoutMs, spec: wire, ...(request.options.verbose === true && { verbose: true }) },
          workspace: options.workspace, taskName, e3Version: session.e3Version, program, closure, resources,
          ...(verdict.environment !== null && { environment: verdict.environment }) };
        if (signal?.aborted) { leavingRack = true; return aborted(); }
        deadline ??= Date.now() + spec.limits.timeoutMs;
        const submitted = await fleet.submit({ eventJson: JSON.stringify(event), tier: verdict.tier, computeSize: verdict.size }, resources,
          { joins: false, canSpill, onWaiting: report.waiting(resources) });
        if (submitted === null) return await runLocal('spill');
        handle = submitted.handle;
        report.queued(submitted);
        const leaseId = handle.leaseId;
        const end = await awaitLease(handle, { session, fleet, policy, rackOnly, unreachableWaitMs, signal, canSpill, deadline: { at: deadline }, unreachable,
          onClaimed: (claim) => report.claimed(claim.rackLabel, leaseId, resources) });
        if (end.kind === 'aborted') { leavingRack = true; return aborted(); }
        if (end.kind === 'expired') { leavingRack = true; return timedOut(); }
        if (end.kind === 'local') return await runLocal(end.reason);
        const result = end.result;
        // What the rack said of the lease beyond its outcome, and how the call
        // runs here by it
        const reason = report.reason(leaseId, result);
        const fallback = (text: string | undefined, otherwise: string) => runLocal(fallbackReason(reason, text, otherwise), reason);
        if (reason?.code === 'outgrew-cap') {
          // A call e3 does not run again: its cap stopped it, and that is its
          // failure, as a whole task's is
          const cap = outgrownCap(reason, resources);
          report.outgrew(leaseId, cap);
          if (policy.retryTaskFailuresLocally) return await fallback(result.error, 'the call outgrew its cap');
          leavingRack = true;
          return { kind: 'failed', exitCode: -1, ...SILENT,
            stderr: `e3: memory-limit-exceeded: the call outgrew its cap of ${Math.round(cap / 1024 ** 2)} MiB on rack ${report.rackLabel}; raise --memory-limit or --size\n` };
        }
        if (result.cancelled === true) {
          // A rack that stopped the call for a reason of its own did not run
          // it, and it runs here; only the caller's abort ends it
          if (!signal?.aborted) return await fallback(result.error, 'the rack stopped the call');
          leavingRack = true;
          return aborted();
        }
        // A transfer that failed its tries is the link's fault: a call kept
        // for a rack is leased once more before it runs here.
        if (rackOnly && !leasedAgain && transferFailed(reason)) {
          leasedAgain = true;
          continue leases;
        }
        // A reason of the rack's own is its fault, whatever outcome it
        // answered with it: only `task-error` names the function's failure
        if (reason !== undefined && reason.code !== 'task-error') return await fallback(result.error, 'the rack failed the call');
        const outcome = result.detached;
        if (outcome === undefined) return await fallback(result.error, 'the rack answered no outcome of the call');
        // A value the rack could not relay to this source runs here
        if (outcome.rackResultTooLarge === true) return await runLocal('fallback:value-too-large-to-relay');
        switch (outcome.kind) {
          case 'success': {
            const value = await valueOf(storage, repo, outcome, spec.limits.maxResultBytes);
            if (value === null) return await runLocal('fallback:incomplete-output');
            leavingRack = true;
            if (!(value instanceof Uint8Array)) return { kind: 'too_large', bytes: value.bytes, limit: spec.limits.maxResultBytes, ...streams(outcome) };
            return { kind: 'success', value, ...streams(outcome) };
          }
          case 'failed':
            // The function's own failure is its answer
            if (policy.retryTaskFailuresLocally) return await fallback(result.error, 'the call failed on its rack');
            leavingRack = true;
            return { kind: 'failed', exitCode: count(outcome.exitCode, -1), ...streams(outcome) };
          case 'too_large':
            leavingRack = true;
            return { kind: 'too_large', bytes: count(outcome.bytes, 0), limit: count(outcome.limit, spec.limits.maxResultBytes), ...streams(outcome) };
          case 'timed_out':
            leavingRack = true;
            return { kind: 'timed_out', ms: count(outcome.ms, timeoutMs), ...streams(outcome) };
          default:
            return await runLocal('fallback:unreadable-outcome');
        }
      }
    } catch (error) {
      if (leavingRack) throw error;
      return await runLocal(thrownFallback(error));
    }
  };
}
