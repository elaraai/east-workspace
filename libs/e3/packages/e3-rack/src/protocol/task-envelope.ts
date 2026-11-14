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
import type { RackResources } from './rack-json.js';

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
 * What a lease's work asks of a rack, and what the rack books for it while it
 * runs: its cores, and its cap, which is the most memory it may use. A rack
 * that books the cap of everything it holds never books more than it has.
 */
export interface RackLeaseResources {
  /** A unit of a split task, which e3 runs again under a larger cap when it
   *  outgrows this one; or a whole task, which it does not */
  readonly kind: 'unit' | 'task';
  /** The cores it is given */
  readonly cores: number;
  /** Its cap, in bytes */
  readonly memoryBytes: number;
  /** Whether it takes a GPU, whole */
  readonly gpu: boolean;
}

/**
 * Reads what a lease's event asks of a rack.
 *
 * @param value - The event's `resources`, as its JSON holds them
 * @returns The resources, or undefined for an event that names none: work
 *   from a source that does not size its leases
 * @throws {Error} When it is not a unit's or a task's cores, cap and GPU
 *
 * @example
 * ```ts
 * const needs = readRackLeaseResources(lease.event.resources);
 * if (needs !== undefined && !leaseFits(needs, offer)) continue;
 * ```
 */
export function readRackLeaseResources(value: unknown): RackLeaseResources | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('a lease\'s resources are a JSON object');
  const { kind, cores, memoryBytes, gpu } = value as Record<string, unknown>;
  if (kind !== 'unit' && kind !== 'task') throw new Error('a lease\'s resources are a unit\'s or a task\'s');
  for (const [name, count] of [['cores', cores], ['memoryBytes', memoryBytes]] as const) {
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) throw new Error(`a lease's ${name} is a whole number of one or more`);
  }
  if (typeof gpu !== 'boolean') throw new Error('a lease takes a GPU or does not');
  return { kind, cores: cores as number, memoryBytes: memoryBytes as number, gpu };
}

/**
 * Whether a rack that offers this much can hold a lease's work now.
 *
 * @param needs - What the lease asks
 * @param offer - What the rack's poll may be answered with
 * @returns Whether the cores, the cap and the GPU are all within the offer
 *
 * @example
 * ```ts
 * leaseFits({ kind: 'unit', cores: 1, memoryBytes: 3 * 1024 ** 3, gpu: false }, { cores: 4, memoryBytes: 8 * 1024 ** 3, gpus: 0 }); // true
 * ```
 */
export function leaseFits(needs: RackLeaseResources, offer: RackResources): boolean {
  return needs.cores <= offer.cores && needs.memoryBytes <= offer.memoryBytes && (!needs.gpu || offer.gpus >= 1);
}

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
  /**
   * What the work asks of a rack: a poll is answered with it only when the
   * rack's offer holds it, and the rack caps the work at it. Read with
   * {@link readRackLeaseResources}; absent from a source that does not size
   * its leases, whose work a rack admits as it did before.
   */
  readonly resources?: RackLeaseResources;
}

/**
 * Why a lease ended as it did: a word a program reads, and what that word
 * carries. Each is printed on its line and counted in a run's summary.
 *
 * | Code | Carries | Who sets it |
 * |---|---|---|
 * | `outgrew-cap` | `capBytes`, `peakBytes` | the rack, when the cap stopped the work |
 * | `memory-limit-exceeded` | `needsBytes`, `limitBytes` | the launching machine, when a cap would pass its ceiling |
 * | `input-transfer-failed`, `output-transfer-failed` | `attempts`, `cause` | the rack, after its tries |
 * | `source-unreachable` | `ms` | the rack |
 * | `guest-crashed` | `detail` | the rack |
 * | `requeued-pressure` | `peakBytes` | a rack that runs several units in one VM (reserved) |
 * | `task-error` | | the rack: the task's own failure |
 */
export const RACK_REASON_CODES = ['outgrew-cap', 'memory-limit-exceeded', 'input-transfer-failed', 'output-transfer-failed',
  'source-unreachable', 'guest-crashed', 'requeued-pressure', 'task-error'] as const;

/** A reason's code this build knows. */
export type RackReasonCode = typeof RACK_REASON_CODES[number];

/**
 * Why a lease ended as it did. JSON: a reader takes the fields it knows, and
 * a code it does not know is a rack's fault it cannot name.
 */
export interface RackReason {
  /** One of {@link RACK_REASON_CODES}, or a later release's */
  readonly code: string;
  /** The cap the work ran under, in bytes */
  readonly capBytes?: number;
  /** The most the work was measured using, in bytes */
  readonly peakBytes?: number;
  /** What the work would be capped at, in bytes */
  readonly needsBytes?: number;
  /** The ceiling that is less than it, in bytes */
  readonly limitBytes?: number;
  /** The tries a transfer was given */
  readonly attempts?: number;
  /** What the last try failed of */
  readonly cause?: string;
  /** How long the source had not answered, in ms */
  readonly ms?: number;
  /** What is known of the guest's end */
  readonly detail?: string;
}

/** A try of a transfer that failed and was followed by another. */
export interface RackTransferRetry {
  /** An input read, or an output written */
  readonly transfer: 'input' | 'output';
  /** The try that follows: 2 for the first retry */
  readonly attempt: number;
  /** The tries a transfer is given */
  readonly of: number;
  /** What the try before it failed of */
  readonly cause: string;
}

const REASON_NUMBERS = ['capBytes', 'peakBytes', 'needsBytes', 'limitBytes', 'attempts', 'ms'] as const;
const REASON_TEXTS = ['cause', 'detail'] as const;

/**
 * Reads a lease result's reason.
 *
 * @param value - The result's `reason`, as its JSON holds it
 * @returns The reason with the fields this build knows, or undefined when the
 *   result has none
 * @throws {Error} When it is not an object with a code, or a field this
 *   build reads is of the wrong kind
 *
 * @example
 * ```ts
 * const reason = readRackReason(result.reason);
 * if (reason?.code === 'outgrew-cap') requeue(reason.capBytes);
 * ```
 */
export function readRackReason(value: unknown): RackReason | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('a reason is a JSON object');
  const fields = value as Record<string, unknown>;
  if (typeof fields.code !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(fields.code)) throw new Error('a reason has a code');
  const reason: { -readonly [K in keyof RackReason]: RackReason[K] } = { code: fields.code };
  for (const name of REASON_NUMBERS) {
    const field = fields[name];
    if (field === undefined) continue;
    if (typeof field !== 'number' || !Number.isSafeInteger(field) || field < 0) throw new Error(`a reason's ${name} is a whole number`);
    reason[name] = field;
  }
  for (const name of REASON_TEXTS) {
    const field = fields[name];
    if (field === undefined) continue;
    if (typeof field !== 'string') throw new Error(`a reason's ${name} is text`);
    // A line of a run's output, not a log: what is longer is cut.
    reason[name] = field.slice(0, 500);
  }
  return reason;
}

/**
 * Reads the retries a lease result lists.
 *
 * @param value - The result's `retries`, as its JSON holds them
 * @returns The retries, none when the result lists none
 * @throws {Error} When it is not a list of retries, or lists more than a
 *   lease's transfers could make
 *
 * @example
 * ```ts
 * for (const retry of readRackRetries(result.retries)) console.log(`${retry.transfer} transfer retried (${retry.attempt} of ${retry.of}): ${retry.cause}`);
 * ```
 */
export function readRackRetries(value: unknown): RackTransferRetry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 4096) throw new Error('retries are a list');
  return value.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) throw new Error('a retry is a JSON object');
    const { transfer, attempt, of, cause } = entry as Record<string, unknown>;
    if (transfer !== 'input' && transfer !== 'output') throw new Error('a retry is of an input or an output');
    for (const count of [attempt, of]) if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) throw new Error('a retry counts its tries');
    if (typeof cause !== 'string') throw new Error('a retry has a cause');
    return { transfer, attempt: attempt as number, of: of as number, cause: cause.slice(0, 500) };
  });
}

/**
 * A reason as a run prints it between brackets: its code, and what the code
 * carries that is text. A size it carries is for its reader to format.
 *
 * @param reason - The reason
 * @returns Such as `input-transfer-failed: connection reset`
 *
 * @example
 * ```ts
 * console.log(`[LOCAL] ${taskName} (${describeRackReason(reason)})`);
 * ```
 */
export function describeRackReason(reason: RackReason): string {
  const said = reason.cause ?? reason.detail;
  return said === undefined || said === '' ? reason.code : `${reason.code}: ${said}`;
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
  /** Why it ended as it did, when it did not succeed: read with {@link readRackReason} */
  reason?: RackReason;
  /** The tries of its transfers that failed and were followed by another:
   *  read with {@link readRackRetries} */
  retries?: RackTransferRetry[];
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
 * @example
 * const attempt = isFunctionLease(lease.event) ? undefined : { executionId: uuidv7(), startedAtMs: now() };
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
 * @example
 * const leaseId = makeLeaseId(leaseTaskHash(event), inputsHash(leaseInputs(event)));
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
 * @example
 * const inHash = inputsHash(leaseInputs(event));
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
 * @example
 * const status = variant('success', { ...common, unit: leaseRecordsUnit(event) });
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
 * @example
 * const run = leaseRun(lease.event);
 * if (run !== undefined) await wake(lease.repo, run);
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
 * @example
 * if (!isLeaseEventV2(lease.event)) return forbidden('no work this build runs');
 */
export function isLeaseEventV2(event: unknown): event is RackLeaseEvent {
  if (typeof event !== 'object' || event === null) return false;
  const { version, runnerEvent, closure } = event as Record<string, unknown>;
  return version === RACK_LEASE_VERSION && typeof runnerEvent === 'object' && runnerEvent !== null
    && typeof closure === 'object' && closure !== null;
}
