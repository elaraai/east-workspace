/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The runner event, v2 (#205): what a launcher sends a runner container, and
 * what the container answers.
 *
 * The event is JSON. A value e3-core types as an East value (a detached call's
 * runner, an intake's declared type) is in East's JSON encoding, whose
 * integers are strings, and bytes are base64. Each mode names e3-core's own
 * call the container makes:
 * - `task`: `taskExecute`, a task over its inputs;
 * - `unit`: `taskExecuteUnit`, a piece or a merge of a split task, which its
 *   caller planned;
 * - `run-detached`: `runDetached`, a function or one-shot call;
 * - `intake`: `runIntake`, a delivery the store holds, or a run of its
 *   segments.
 *
 * A launcher builds the event with the `…ToWire` functions here and sends it
 * as JSON; the container reads it back with {@link decodeRunnerEvent} and the
 * `…FromWire` functions.
 */

import { EastTypeType, fromJSONFor, toJSONFor, type EastTypeValue } from '@elaraai/east';
import {
  DeliveryRefusedError,
  isObjectHash,
  isUuidv7,
  type DetachedArg,
  type DetachedResult,
  type DetachedSpec,
  type IntakeResult,
  type IntakeSpec,
  type SplitUnit,
  type TaskResult,
} from '@elaraai/e3-core';
import { RunnerType, type RunnerValue } from '@elaraai/e3-types';

// =============================================================================
// The event
// =============================================================================

/**
 * A unit of a split task, whole (e3-core's `SplitUnit`): its inputs as its
 * record names them, what a merge unit merges, and whether it is its task's
 * own execution. e3-core records a unit with `unit: !own`, so a wire that
 * dropped `own` would hide the one run of a task whose input closes no piece
 * from the task's history.
 */
export interface SplitUnitWire {
  /** The unit's inputs, as its execution records them */
  readonly inputs: readonly string[];
  /** What a merge unit merges: the parts, in piece order, and the hash of the
   *  key range the merge is limited to, or `null` to merge them whole; `null`
   *  for a piece */
  readonly merge: { readonly parts: readonly string[]; readonly range: string | null } | null;
  /** Whether the unit is its task's own execution */
  readonly own: boolean;
}

/**
 * A detached call (e3-core's `DetachedSpec`). The program and each value
 * argument are base64; a stored dataset argument is `{dataset}`, the hash of
 * the object its ref names, which the container stages from the store.
 */
export interface DetachedSpecWire {
  /** The program, base64 */
  readonly bodyIr: string;
  /** The arguments, in order: a value's beast2 bytes as base64, or a stored dataset */
  readonly args: readonly (string | { readonly dataset: string })[];
  /** The runner, in East's JSON encoding of `RunnerType` */
  readonly runner: unknown;
  /** The call's limits */
  readonly limits: { readonly timeoutMs: number; readonly maxResultBytes: number; readonly maxLogBytes: number };
  /** The environment spec object the call runs in, when it declares one */
  readonly environment?: string;
}

/**
 * An intake of a delivery the store holds (e3-core's `IntakeSpec` with an
 * `{object}` source): a runner container reads a delivery from the store,
 * never from another host's files.
 */
export interface IntakeSpecWire {
  /** The delivery: the hash of the object it is stored as */
  readonly object: string;
  /** The collection type its header must name, in East's JSON encoding of `EastTypeType` */
  readonly type: unknown;
  /** The delivery's segments `[from, to)` to take in, by its index; absent, the whole delivery */
  readonly segments?: { readonly from: number; readonly to: number };
}

/**
 * The run a task or a unit is part of, when a dataflow launched it: a cancel
 * requested of the run, or its end, stops the execution.
 */
export interface RunnerRun {
  /** The run's workspace */
  readonly workspace: string;
  /** The run's id, a UUIDv7 */
  readonly id: string;
}

/** What every runner event carries. */
interface RunnerEventBase {
  /** The launch's id, a UUIDv7 the launcher minted: the container stamps it on
   *  the `running` records it writes */
  readonly launchId: string;
  /** The repository */
  readonly repo: string;
  /** The longest the call may run, in ms: the container caps it at the time
   *  it has left */
  readonly timeoutMs: number;
}

/** What a task and a unit event carry beyond the base. */
interface RunnerExecutionFields {
  /** The run the execution is part of, when a dataflow launched it */
  readonly run?: RunnerRun;
  /** The task object's hash */
  readonly taskHash: string;
  /** Run it even when the execution cache holds it */
  readonly force?: boolean;
  /** Pass `-v` to a stock runner's `exec` */
  readonly verbose?: boolean;
  /** The memory, in bytes, the execution is expected to need */
  readonly expectedPeakBytes?: number;
  /** Why the execution runs where it does, which the container adds to the
   *  end of the attempt's stderr log once e3-core has recorded it: a retry
   *  after running out of memory, or a launch on Fargate (#206) */
  readonly notice?: string;
}

/** A task over its inputs: e3-core's `taskExecute`. */
export interface RunnerTaskEvent extends RunnerEventBase, RunnerExecutionFields {
  readonly mode: 'task';
  /** The task's input hashes, in the order its body takes them */
  readonly inputHashes: readonly string[];
}

/** A unit of a split task, which its caller planned: e3-core's `taskExecuteUnit`. */
export interface RunnerUnitEvent extends RunnerEventBase, RunnerExecutionFields {
  readonly mode: 'unit';
  /** The unit */
  readonly unit: SplitUnitWire;
}

/** A function or one-shot call: e3-core's `runDetached`. */
export interface RunnerDetachedEvent extends RunnerEventBase {
  readonly mode: 'run-detached';
  /** The call */
  readonly spec: DetachedSpecWire;
  /** Pass `-v` to a stock runner's `exec` */
  readonly verbose?: boolean;
  /**
   * When the call must have answered by, in ms since the epoch: when it was
   * made, plus its timeout (#209). A request waits on the call, so the time
   * its runner function takes to start, and the container's staging, count
   * against it: the container gives e3-core what is left, and answers
   * `timed_out` at once when nothing is. Absent, the call's timeout counts
   * from its runner's start. Only the cloud's own launches carry one: a
   * rack's clock is not the cloud's, and the delegating runner keeps a leased
   * call's deadline itself.
   */
  readonly deadline?: number;
}

/** An intake of a delivery, or of a run of its segments: e3-core's `runIntake`. */
export interface RunnerIntakeEvent extends RunnerEventBase {
  readonly mode: 'intake';
  /** The intake */
  readonly spec: IntakeSpecWire;
}

/** The runner event, v2. */
export type RunnerEvent = RunnerTaskEvent | RunnerUnitEvent | RunnerDetachedEvent | RunnerIntakeEvent;

// =============================================================================
// The answer
// =============================================================================

/** A detached call's outcome (e3-core's `DetachedResult`), the value's bytes as base64. */
export type RunnerDetachedResponse =
  | (Omit<Extract<DetachedResult, { kind: 'success' }>, 'value'> & { readonly value: string })
  | Exclude<DetachedResult, { kind: 'success' }>;

/**
 * An intake's outcome: what it stored (e3-core's `IntakeResult`), or the
 * runner's refusal of the delivery, which the caller raises again as
 * e3-core's `DeliveryRefusedError` ({@link intakeResultFromWire}).
 */
export type RunnerIntakeResponse =
  | {
    readonly kind: 'stored';
    readonly hash: string;
    readonly runner: string;
    readonly fallback?: string;
    readonly peakBytes?: number;
  }
  | {
    readonly kind: 'refused';
    readonly runner: string;
    readonly refusal: string;
    readonly stderr: string;
    readonly delivery: string;
  };

/**
 * What a runner container answers: e3-core's `TaskResult` for a task or a
 * unit, which is JSON as it stands; a detached call's and an intake's
 * outcomes as above.
 */
export type RunnerResponse = TaskResult | RunnerDetachedResponse | RunnerIntakeResponse;

// =============================================================================
// To and from the wire
// =============================================================================

const runnerToJSON = toJSONFor(RunnerType);
const runnerFromJSON = fromJSONFor(RunnerType);
const typeToJSON = toJSONFor(EastTypeType);
const typeFromJSON = fromJSONFor(EastTypeType);

/**
 * A unit as the wire carries it.
 *
 * @param unit - The unit
 * @returns Its wire form
 */
export function splitUnitToWire(unit: SplitUnit): SplitUnitWire {
  return {
    inputs: [...unit.inputs],
    merge: unit.merge === null ? null : { parts: [...unit.merge.parts], range: unit.merge.range },
    own: unit.own,
  };
}

/**
 * A unit, from the wire.
 *
 * @param wire - Its wire form
 * @returns The unit
 */
export function splitUnitFromWire(wire: SplitUnitWire): SplitUnit {
  return {
    inputs: [...wire.inputs],
    merge: wire.merge === null ? null : { parts: [...wire.merge.parts], range: wire.merge.range },
    own: wire.own,
  };
}

/**
 * A detached call as the wire carries it.
 *
 * @param spec - The call
 * @returns Its wire form
 */
export function detachedSpecToWire(spec: DetachedSpec): DetachedSpecWire {
  return {
    bodyIr: Buffer.from(spec.bodyIr).toString('base64'),
    args: spec.args.map((arg) => arg instanceof Uint8Array ? Buffer.from(arg).toString('base64') : { dataset: arg.dataset }),
    runner: runnerToJSON(spec.runner),
    limits: { timeoutMs: spec.limits.timeoutMs, maxResultBytes: spec.limits.maxResultBytes, maxLogBytes: spec.limits.maxLogBytes },
    ...(spec.environment !== undefined && { environment: spec.environment }),
  };
}

/**
 * A detached call, from the wire.
 *
 * @param wire - Its wire form
 * @returns The call
 * @throws {RunnerEventError} When its runner does not decode as a `RunnerType`
 */
export function detachedSpecFromWire(wire: DetachedSpecWire): DetachedSpec {
  return {
    bodyIr: new Uint8Array(Buffer.from(wire.bodyIr, 'base64')),
    args: wire.args.map((arg): DetachedArg => typeof arg === 'string'
      ? new Uint8Array(Buffer.from(arg, 'base64'))
      : { dataset: arg.dataset }),
    runner: decodeEast(runnerFromJSON, wire.runner, 'spec.runner') as RunnerValue,
    limits: { timeoutMs: wire.limits.timeoutMs, maxResultBytes: wire.limits.maxResultBytes, maxLogBytes: wire.limits.maxLogBytes },
    ...(wire.environment !== undefined && { environment: wire.environment }),
  };
}

/**
 * An intake as the wire carries it.
 *
 * @param spec - The intake: of a delivery the store holds
 * @returns Its wire form
 * @throws {Error} When the delivery is a file, which a runner container
 *   cannot read
 */
export function intakeSpecToWire(spec: IntakeSpec): IntakeSpecWire {
  if (!('object' in spec.source)) {
    throw new Error('a runner container takes in a delivery the store holds: this intake names a file');
  }
  return {
    object: spec.source.object,
    type: typeToJSON(spec.type),
    ...(spec.segments !== undefined && { segments: { from: spec.segments.from, to: spec.segments.to } }),
  };
}

/**
 * An intake, from the wire.
 *
 * @param wire - Its wire form
 * @returns The intake
 * @throws {RunnerEventError} When its type does not decode as an East type
 */
export function intakeSpecFromWire(wire: IntakeSpecWire): IntakeSpec {
  return {
    source: { object: wire.object },
    type: decodeEast(typeFromJSON, wire.type, 'spec.type') as EastTypeValue,
    ...(wire.segments !== undefined && { segments: { from: wire.segments.from, to: wire.segments.to } }),
  };
}

/**
 * A detached call's outcome as the container answers it.
 *
 * @param result - The outcome
 * @returns Its wire form
 */
export function detachedResultToWire(result: DetachedResult): RunnerDetachedResponse {
  return result.kind === 'success' ? { ...result, value: Buffer.from(result.value).toString('base64') } : result;
}

/**
 * A detached call's outcome, from the container's answer.
 *
 * @param response - The answer
 * @returns The outcome
 */
export function detachedResultFromWire(response: RunnerDetachedResponse): DetachedResult {
  return response.kind === 'success' ? { ...response, value: new Uint8Array(Buffer.from(response.value, 'base64')) } : response;
}

/**
 * What an intake stored, from the container's answer.
 *
 * @param response - The answer
 * @returns What the intake stored
 * @throws {DeliveryRefusedError} When the runner refused the delivery
 */
export function intakeResultFromWire(response: RunnerIntakeResponse): IntakeResult {
  if (response.kind === 'refused') {
    throw new DeliveryRefusedError(response.runner, response.refusal, response.stderr, response.delivery);
  }
  return {
    hash: response.hash,
    runner: response.runner,
    ...(response.fallback !== undefined && { fallback: response.fallback }),
    ...(response.peakBytes !== undefined && { peakBytes: response.peakBytes }),
  };
}

// =============================================================================
// Reading an event
// =============================================================================

/** A runner event that does not read: what is wrong with it. */
export class RunnerEventError extends Error {
  /**
   * @param problem - What is wrong with the event
   */
  constructor(problem: string) {
    super(`runner event: ${problem}`);
    this.name = 'RunnerEventError';
  }
}

/**
 * Reads a runner event: the JSON value a container was handed, checked
 * against the v2 shape.
 *
 * @param value - The event, parsed from its JSON
 * @returns The event
 * @throws {RunnerEventError} When it is not a v2 runner event: a v1 event
 *   (which no launcher sends since elaraai/e3-cloud#205), an unknown mode, or
 *   a field that is missing or of the wrong kind
 */
export function decodeRunnerEvent(value: unknown): RunnerEvent {
  const event = record(value, 'the event');
  if (event.mode === undefined && 'taskName' in event) {
    throw new RunnerEventError('a v1 task event, which this runner no longer runs: launchers send v2 events since elaraai/e3-cloud#205');
  }
  const base: RunnerEventBase = {
    launchId: uuid(event.launchId, 'launchId'),
    repo: text(event.repo, 'repo'),
    timeoutMs: positive(event.timeoutMs, 'timeoutMs'),
  };
  switch (event.mode) {
    case 'task':
      return { mode: 'task', ...base, ...executionFields(event), inputHashes: hashes(event.inputHashes, 'inputHashes') };
    case 'unit':
      return { mode: 'unit', ...base, ...executionFields(event), unit: splitUnitWire(event.unit) };
    case 'run-detached':
      return {
        mode: 'run-detached',
        ...base,
        spec: detachedSpecWire(event.spec),
        ...(event.verbose !== undefined && { verbose: flag(event.verbose, 'verbose') }),
        ...(event.deadline !== undefined && { deadline: count(event.deadline, 'deadline') }),
      };
    case 'intake':
      return { mode: 'intake', ...base, spec: intakeSpecWire(event.spec) };
    default:
      throw new RunnerEventError(`mode is ${JSON.stringify(event.mode)}, not task, unit, run-detached or intake`);
  }
}

/** The fields a task and a unit event share, checked. */
function executionFields(event: Record<string, unknown>): RunnerExecutionFields {
  return {
    taskHash: objectHash(event.taskHash, 'taskHash'),
    ...(event.run !== undefined && { run: runOf(event.run) }),
    ...(event.force !== undefined && { force: flag(event.force, 'force') }),
    ...(event.verbose !== undefined && { verbose: flag(event.verbose, 'verbose') }),
    ...(event.expectedPeakBytes !== undefined && { expectedPeakBytes: count(event.expectedPeakBytes, 'expectedPeakBytes') }),
    ...(event.notice !== undefined && { notice: text(event.notice, 'notice') }),
  };
}

function runOf(value: unknown): RunnerRun {
  const run = record(value, 'run');
  return { workspace: text(run.workspace, 'run.workspace'), id: uuid(run.id, 'run.id') };
}

function splitUnitWire(value: unknown): SplitUnitWire {
  const unit = record(value, 'unit');
  let merge: SplitUnitWire['merge'] = null;
  if (unit.merge !== null) {
    const parts = record(unit.merge, 'unit.merge');
    merge = {
      parts: hashes(parts.parts, 'unit.merge.parts'),
      range: parts.range === null ? null : objectHash(parts.range, 'unit.merge.range'),
    };
  }
  // A merge unit's inputs name its tag and its parts, so they are text, not hashes
  return { inputs: texts(unit.inputs, 'unit.inputs'), merge, own: flag(unit.own, 'unit.own') };
}

function detachedSpecWire(value: unknown): DetachedSpecWire {
  const spec = record(value, 'spec');
  const limits = record(spec.limits, 'spec.limits');
  const wire: DetachedSpecWire = {
    bodyIr: text(spec.bodyIr, 'spec.bodyIr', true),
    args: list(spec.args, 'spec.args').map((arg, i) => typeof arg === 'string'
      ? arg
      : { dataset: objectHash(record(arg, `spec.args[${i}]`).dataset, `spec.args[${i}].dataset`) }),
    runner: spec.runner,
    limits: {
      timeoutMs: positive(limits.timeoutMs, 'spec.limits.timeoutMs'),
      maxResultBytes: count(limits.maxResultBytes, 'spec.limits.maxResultBytes'),
      maxLogBytes: count(limits.maxLogBytes, 'spec.limits.maxLogBytes'),
    },
    ...(spec.environment !== undefined && { environment: objectHash(spec.environment, 'spec.environment') }),
  };
  // The runner is checked now, so that a malformed one is refused before anything runs
  decodeEast(runnerFromJSON, wire.runner, 'spec.runner');
  return wire;
}

function intakeSpecWire(value: unknown): IntakeSpecWire {
  const spec = record(value, 'spec');
  let segments: IntakeSpecWire['segments'];
  if (spec.segments !== undefined) {
    const run = record(spec.segments, 'spec.segments');
    segments = { from: count(run.from, 'spec.segments.from'), to: count(run.to, 'spec.segments.to') };
  }
  decodeEast(typeFromJSON, spec.type, 'spec.type');
  return {
    object: objectHash(spec.object, 'spec.object'),
    type: spec.type,
    ...(segments !== undefined && { segments }),
  };
}

function decodeEast<T>(decode: (value: unknown) => T, value: unknown, at: string): T {
  try {
    return decode(value);
  } catch (err) {
    throw new RunnerEventError(`${at} does not decode: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function record(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RunnerEventError(`${at} is not an object`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) throw new RunnerEventError(`${at} is not an array`);
  return value;
}

function text(value: unknown, at: string, empty = false): string {
  if (typeof value !== 'string' || (!empty && value === '')) throw new RunnerEventError(`${at} is not a string`);
  return value;
}

function texts(value: unknown, at: string): string[] {
  return list(value, at).map((item, i) => text(item, `${at}[${i}]`));
}

function objectHash(value: unknown, at: string): string {
  if (typeof value !== 'string' || !isObjectHash(value)) throw new RunnerEventError(`${at} is not an object hash`);
  return value;
}

function hashes(value: unknown, at: string): string[] {
  return list(value, at).map((item, i) => objectHash(item, `${at}[${i}]`));
}

function uuid(value: unknown, at: string): string {
  if (typeof value !== 'string' || !isUuidv7(value)) throw new RunnerEventError(`${at} is not a UUIDv7`);
  return value;
}

function flag(value: unknown, at: string): boolean {
  if (typeof value !== 'boolean') throw new RunnerEventError(`${at} is not a boolean`);
  return value;
}

function count(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RunnerEventError(`${at} is not a whole number`);
  }
  return value;
}

function positive(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RunnerEventError(`${at} is not a positive number`);
  }
  return value;
}
