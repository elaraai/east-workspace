/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What a rack lease carries to its agent, and what the agent completes it
 * with (epic #67; v2 since elaraai/e3-cloud#214).
 *
 * @remarks
 * A lease carries the runner containers' v2 event (#205): its guest makes the
 * call of e3-core's own execution the event names, as a runner Lambda does,
 * over the objects its host staged. Beside the event it carries what a rack
 * needs and a container does not:
 * - the workspace and the task's name, for the activity view;
 * - the runtime version the work was built with, which the agent boots (#189);
 * - the environment the guest's rootfs is composed from;
 * - the lease's closure: every object its guest may read, and no other.
 *
 * A function lease names its program by hash, staged with the closure, so a
 * lease's row stays small.
 */

import type { RunnerDetachedEvent, RunnerRun, RunnerTaskEvent, RunnerUnitEvent } from '../runner-event.js';

/** The version of the lease event this build writes and reads. */
export const RACK_LEASE_VERSION = 2;

/**
 * What a lease's guest may read: the objects its execution reads (#214).
 * Inline when small; when large, the hash of an object in the repository's
 * store that lists them (`encodeClosure`), which is itself admitted.
 */
export type RackLeaseClosure =
  | { readonly hashes: readonly string[] }
  | { readonly object: string; readonly count: number };

/**
 * A lease's work, v2 (#214): a dataflow task, a unit of a split task, or a
 * function call.
 */
export interface RackLeaseEvent {
  /** {@link RACK_LEASE_VERSION} */
  readonly version: typeof RACK_LEASE_VERSION;
  /**
   * The runner containers' v2 event (#205) the guest runs: `task`, `unit` or
   * `run-detached`, with the launch id the attempt's `running` record is
   * stamped with. A function lease's `spec.bodyIr` is empty: its program is
   * {@link program}.
   */
  readonly runnerEvent: RunnerTaskEvent | RunnerUnitEvent | RunnerDetachedEvent;
  /** The workspace */
  readonly workspace: string;
  /** The task's name, or `fn:{name}` for a function: what the activity view shows */
  readonly taskName: string;
  /** The e3 version the work was built with: the runtime the guest runs (#189) */
  readonly e3Version?: string;
  /**
   * The environment spec hash the work declares, when it declares one: the
   * worker composes the environment's rootfs from its published layers, and
   * the guest links it where e3-core looks for it.
   */
  readonly environment?: string;
  /** A function lease's program: the object its detached call's `bodyIr` is */
  readonly program?: string;
  /** Every object the guest may read */
  readonly closure: RackLeaseClosure;
}

/**
 * What a rack agent completes a lease with.
 */
export interface RackLeaseResult {
  /** The task's name, as the event names it */
  taskName: string;
  /** `success` only when the work succeeded: the activity view's outcome */
  status: 'success' | 'failed';
  /**
   * A task or unit lease's outcome, as e3-core's execution ended it: the
   * record the cloud writes of the attempt. Absent, `status` says.
   */
  state?: 'success' | 'failed' | 'error';
  /** The output's hash, when it succeeded: every object it names committed */
  outputHash?: string;
  /** The runner's exit code, when it failed */
  exitCode?: number;
  /** What went wrong, when it did not succeed */
  error?: string;
  /** The highest peak resident memory, in bytes, a runner process reached */
  peakBytes?: number;
  /** Whether e3 stopped it because its run was aborted */
  cancelled?: boolean;
  /** How long it ran, in ms */
  duration?: number;
  /** A function lease's detached call's outcome (#83). `status` mirrors it
   *  (`success` ⇔ kind 'success') so the lease store's validation applies
   *  unchanged. */
  detached?: RackFunctionResult;
}

/**
 * The attempt a claimed lease runs: the cloud mints its execution id when a
 * rack claims the lease, and writes its `running` record then, stamped with
 * the rack launch; the rack's completion writes its outcome under it (#214).
 */
export interface RackLeaseAttempt {
  /** The attempt's execution id, a UUIDv7: its records' */
  readonly executionId: string;
  /** When its rack claimed the lease, in ms since the epoch */
  readonly startedAtMs: number;
}

/**
 * Wire shape of a delegated function call's outcome (#83): a JSON-safe
 * mirror of e3-core's `DetachedResult` with the value bytes base64. Rides
 * inside the completion's `resultJson` onto the lease row (no object-store
 * writes: functions are persistence-free), so the AGENT size-gates
 * `valueB64` and streams to keep the row under the DynamoDB item cap; an
 * over-sized value is reported as kind 'failed' with `rackResultTooLarge`
 * and the runner re-runs the call on cloud.
 */
export interface RackFunctionResult {
  kind: 'success' | 'failed' | 'too_large' | 'timed_out';
  /** Result value bytes (beast2), base64: kind 'success' only. */
  valueB64?: string;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  /** kind 'failed' */
  exitCode?: number;
  /** kind 'too_large' */
  bytes?: number;
  limit?: number;
  /** kind 'timed_out' */
  ms?: number;
  /** The rack produced a result too large to relay through the lease row:
   *  the runner should fall back to cloud rather than surface a failure. */
  rackResultTooLarge?: boolean;
}

/**
 * Whether a lease is a function call's (#83): its guest runs `runDetached`,
 * and nothing it does is recorded.
 *
 * @param event - The lease's event
 * @returns Whether it is a function lease
 */
export function isFunctionLease(event: RackLeaseEvent): boolean {
  return event.runnerEvent.mode === 'run-detached';
}

/**
 * The task object a lease's work runs: a task's or a unit's task, or a
 * function lease's program.
 *
 * @param event - The lease's event
 * @returns The object's hash
 */
export function leaseTaskHash(event: RackLeaseEvent): string {
  const run = event.runnerEvent;
  return run.mode === 'run-detached' ? event.program ?? '' : run.taskHash;
}

/**
 * The inputs a lease's attempt is recorded under, as e3-core records them: a
 * task's input hashes, a unit's inputs; none for a function.
 *
 * @param event - The lease's event
 * @returns The inputs
 */
export function leaseInputs(event: RackLeaseEvent): string[] {
  const run = event.runnerEvent;
  switch (run.mode) {
    case 'task': return [...run.inputHashes];
    case 'unit': return [...run.unit.inputs];
    default: return [];
  }
}

/**
 * Whether a lease's attempt is recorded as a unit (e3-core's `unit: !own`):
 * a piece or a merge of a split task; not a task, nor the one unit of a task
 * whose input closes no piece (elaraai/east-workspace#953).
 *
 * @param event - The lease's event
 * @returns What the attempt's records say
 */
export function leaseRecordsUnit(event: RackLeaseEvent): boolean {
  const run = event.runnerEvent;
  return run.mode === 'unit' && !run.unit.own;
}

/**
 * The dataflow run a lease's work is part of, when a dataflow launched it:
 * what its completion wakes (#208), and what re-attaches to it (#207).
 *
 * @param event - The lease's event
 * @returns The run, or undefined
 */
export function leaseRun(event: RackLeaseEvent): RunnerRun | undefined {
  const run = event.runnerEvent;
  return run.mode === 'task' || run.mode === 'unit' ? run.run : undefined;
}

/**
 * Whether a stored event is a v2 lease event this build runs: one written
 * before #214 is not granted.
 *
 * @param event - The event, as the lease store holds it
 * @returns Whether it is one
 */
export function isLeaseEventV2(event: unknown): event is RackLeaseEvent {
  if (typeof event !== 'object' || event === null) return false;
  const { version, runnerEvent, closure } = event as Record<string, unknown>;
  return version === RACK_LEASE_VERSION && typeof runnerEvent === 'object' && runnerEvent !== null
    && typeof closure === 'object' && closure !== null;
}
