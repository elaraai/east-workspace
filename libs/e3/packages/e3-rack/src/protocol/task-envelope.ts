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
 * - the lease's closure: every object its guest may read, and no other;
 * - for a unit of a split task, the task's execution it is part of (its
 *   scope), to a rack that keeps a stage's outputs for the next.
 *
 * A function lease names its program by hash, staged with the closure, so a
 * lease's row stays small.
 */

import type { RunnerDetachedEvent, RunnerRun, RunnerTaskEvent, RunnerUnitEvent } from '../runner-event.js';
import { isRackScopeId, type RackResources } from './rack-json.js';

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
 * What a lease's work asks of a rack: its cores, its cap (the most memory it
 * may use) and what it reserves (the memory it is expected to need), as a
 * local run's unit reserves an estimate and is stopped past a cap.
 *
 * A rack books each lease's reservation, so it holds as much work as a local
 * run of the same memory would, and lets the work's VM grow to its cap. It
 * watches what its host uses: past its memory it stops the newest work it
 * holds (`requeued-pressure`), which e3 leases again reserving what it reached,
 * as the local budget's guard does. A rack that does not watch its host books
 * the cap instead, and never books more than it has.
 */
export interface RackLeaseResources {
  /** A unit of a split task, which e3 runs again under a larger cap when it
   *  outgrows this one; or a whole task, which it does not */
  readonly kind: 'unit' | 'task';
  /** The cores it is given */
  readonly cores: number;
  /** Its cap, in bytes */
  readonly memoryBytes: number;
  /** What it reserves, in bytes: at most its cap. Absent, its cap */
  readonly reserveBytes?: number;
  /** Whether it takes a GPU, whole */
  readonly gpu: boolean;
}

/**
 * What a rack books of its memory for a lease's work: its reservation, else
 * its cap.
 *
 * @param needs - What the lease asks
 * @returns The bytes
 */
export function leaseReserve(needs: RackLeaseResources): number {
  return needs.reserveBytes ?? needs.memoryBytes;
}

/**
 * Reads what a lease's event asks of a rack.
 *
 * @param value - The event's `resources`, as its JSON holds them
 * @returns The resources, or undefined for an event that names none: work
 *   from a source that does not size its leases
 * @throws {Error} When it is not a unit's or a task's cores, cap and GPU, or
 *   it reserves more than its cap
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
  const { kind, cores, memoryBytes, reserveBytes, gpu } = value as Record<string, unknown>;
  if (kind !== 'unit' && kind !== 'task') throw new Error('a lease\'s resources are a unit\'s or a task\'s');
  for (const [name, count] of [['cores', cores], ['memoryBytes', memoryBytes]] as const) {
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) throw new Error(`a lease's ${name} is a whole number of one or more`);
  }
  if (typeof gpu !== 'boolean') throw new Error('a lease takes a GPU or does not');
  if (reserveBytes !== undefined && (typeof reserveBytes !== 'number' || !Number.isSafeInteger(reserveBytes) || reserveBytes < 1 || reserveBytes > (memoryBytes as number))) {
    throw new Error('a lease reserves a whole number of bytes, one or more and at most its cap');
  }
  return { kind, cores: cores as number, memoryBytes: memoryBytes as number, ...(reserveBytes !== undefined && { reserveBytes: reserveBytes as number }), gpu };
}

/**
 * Whether a rack that offers this much can hold a lease's work now.
 *
 * @param needs - What the lease asks
 * @param offer - What the rack's poll may be answered with
 * @returns Whether the cores, the reservation and the GPU are all within the
 *   offer
 *
 * @example
 * ```ts
 * leaseFits({ kind: 'unit', cores: 1, memoryBytes: 3 * 1024 ** 3, reserveBytes: 2 * 1024 ** 3, gpu: false }, { cores: 4, memoryBytes: 2 * 1024 ** 3, gpus: 0 }); // true
 * ```
 */
export function leaseFits(needs: RackLeaseResources, offer: RackResources): boolean {
  return needs.cores <= offer.cores && leaseReserve(needs) <= offer.memoryBytes && (!needs.gpu || offer.gpus >= 1);
}

/**
 * Whether a rack that has this much in all could hold a lease's work with
 * nothing else on it: its cores, its GPU, and its cap, since its VM may grow
 * to it.
 *
 * @param needs - What the lease asks
 * @param all - All the rack has
 * @returns Whether the rack could ever hold it
 *
 * @example
 * ```ts
 * leaseFitsRack({ kind: 'unit', cores: 1, memoryBytes: 3 * 1024 ** 3, reserveBytes: 2 * 1024 ** 3, gpu: false }, { cores: 4, memoryBytes: 2 * 1024 ** 3, gpus: 0 }); // false
 * ```
 */
export function leaseFitsRack(needs: RackLeaseResources, all: RackResources): boolean {
  return needs.cores <= all.cores && needs.memoryBytes <= all.memoryBytes && (!needs.gpu || all.gpus >= 1);
}

/**
 * Whether a rack could ever hold a lease's work: the one rule a source grants
 * by and a run places by.
 *
 * @remarks
 * A rack that says all it has admits work by its resources, and holds what
 * they hold ({@link leaseFitsRack}). One that says none admits by its slots
 * and caps nothing: it holds a whole task, and never a unit of a split task,
 * which runs only where something stops it when it outgrows its share. Nor
 * does a rack that has not yet said what it is.
 *
 * @param needs - What the lease asks
 * @param all - All the rack has, as its report says; undefined of a rack that
 *   reports none, or has not reported
 * @returns Whether the rack could ever hold it
 *
 * @example
 * ```ts
 * rackEverHolds({ kind: 'unit', cores: 1, memoryBytes: 3 * 1024 ** 3, gpu: false }, undefined); // false
 * rackEverHolds({ kind: 'task', cores: 1, memoryBytes: 3 * 1024 ** 3, gpu: false }, undefined); // true
 * ```
 */
export function rackEverHolds(needs: RackLeaseResources, all: RackResources | undefined): boolean {
  return all === undefined ? needs.kind !== 'unit' : leaseFitsRack(needs, all);
}

/**
 * The execution of a split task a unit's lease is part of: its split scope
 * (e3-core's `SplitScope`), as a rack is told it.
 *
 * @remarks
 * A rack whose report names `split-scopes` (`RACK_SPLIT_SCOPES`) may keep what a lease
 * of a scope wrote, once its source holds it, and give it to a later lease of
 * the same scope that reads it, rather than fetch it back from its source:
 * a merge reads the pieces it merges where they were made. It keeps nothing
 * of a scope once its source says the scope ended
 * (`RACK_SCOPES_ENDED_HEADER`), and a rack's own bound on what it keeps
 * and on how long applies, after which a lease fetches as any does. Only a
 * rack that names the feature is told a scope; a lease is the same work
 * without one.
 */
export interface RackLeaseScope {
  /** The scope's id: random, of nothing the task runs over, one for each
   *  execution of a split task. Words of at most 64 letters, digits and
   *  hyphens. */
  readonly id: string;
  /** Whether a later lease of the scope reads what this one writes: its
   *  outputs are worth keeping. A lease that feeds none still reads what the
   *  scope keeps. */
  readonly feeds: boolean;
}

/**
 * Reads a lease event's scope, for what this build knows of it.
 *
 * @remarks
 * A scope is what a lease says beside its work, and the work is the same
 * without it: so one that does not read is none, and the lease is never
 * refused for it.
 *
 * @param value - The event's `scope`, as its JSON holds it
 * @returns The scope, or undefined when the event names none or one that does
 *   not read
 * @example
 * ```ts
 * const scope = readRackLeaseScope(event.scope);
 * if (scope?.feeds === true) keepOutputs(scope.id);
 * ```
 */
export function readRackLeaseScope(value: unknown): RackLeaseScope | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { id, feeds } = value as Record<string, unknown>;
  if (!isRackScopeId(id) || typeof feeds !== 'boolean') return undefined;
  return { id, feeds };
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
  /**
   * The split task's execution a unit is part of, to a rack that keeps a
   * stage's outputs for the next ({@link RackLeaseScope}). Read with
   * {@link readRackLeaseScope}; a source leaves it out of the lease a rack
   * that does not name `split-scopes` (`RACK_SPLIT_SCOPES`) is granted.
   */
  readonly scope?: RackLeaseScope;
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
 * | `guest-crashed` | `detail` | the rack, when the guest ended without an outcome once it had its lease |
 * | `guest-boot-failed` | `detail` | the rack, when no guest took the lease: its VM did not boot |
 * | `tier-image-failed` | `detail` | the rack, when it could not make the image of the lease's tier |
 * | `environment-failed` | `detail` | the rack, when it could not compose the lease's environment |
 * | `work-disk-full` | `detail` | the rack, when the work filled the disk it writes on |
 * | `no-room` | `detail` | the rack, when it no longer had room for the lease once its grant settled |
 * | `rack-stopping` | `detail` | the rack, when it or its host is stopping and gave the work up |
 * | `rack-failed` | `detail` | the rack, for a cause of its own that no other word names |
 * | `requeued-pressure` | `peakBytes` | a rack that books reservations, when its host ran short and it stopped the newest work it holds |
 * | `task-error` | | the rack: the task's own failure |
 */
export const RACK_REASON_CODES = ['outgrew-cap', 'memory-limit-exceeded', 'input-transfer-failed', 'output-transfer-failed',
  'source-unreachable', 'guest-crashed', 'guest-boot-failed', 'tier-image-failed', 'environment-failed', 'work-disk-full', 'no-room',
  'rack-stopping', 'rack-failed', 'requeued-pressure', 'task-error'] as const;

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
  /** What was moved: `input` (read), `output` (written), or a kind a later
   *  release names */
  readonly transfer: string;
  /** The try that follows: 2 for the first retry */
  readonly attempt: number;
  /** The tries a transfer is given */
  readonly of: number;
  /** What the try before it failed of */
  readonly cause: string;
}

const REASON_NUMBERS = ['capBytes', 'peakBytes', 'needsBytes', 'limitBytes', 'attempts', 'ms'] as const;
const REASON_TEXTS = ['cause', 'detail'] as const;

/** A word a run prints between brackets: a code, a kind of transfer. */
const WORD = /^[a-z][a-z0-9-]{0,63}$/;

/** The most retries a result is read for: more than a lease's transfers make. */
const MOST_RETRIES = 4096;

/**
 * Reads a lease result's reason, for what this build knows of it.
 *
 * @remarks
 * A reason is what a rack says beside its result, and a rack of another
 * release may say more, or say it otherwise: so this build takes the fields
 * it knows, of the kinds it knows, and leaves out the rest. It never refuses
 * a result for its reason, whose work would then be lost.
 *
 * @param value - The result's `reason`, as its JSON holds it
 * @returns The reason with the fields this build reads; undefined when the
 *   result has none, or none with a code this build can print
 *
 * @example
 * ```ts
 * const reason = readRackReason(result.reason);
 * if (reason?.code === 'outgrew-cap') requeue(reason.capBytes);
 * ```
 */
export function readRackReason(value: unknown): RackReason | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  if (typeof fields.code !== 'string' || !WORD.test(fields.code)) return undefined;
  const reason: { -readonly [K in keyof RackReason]: RackReason[K] } = { code: fields.code };
  for (const name of REASON_NUMBERS) {
    const field = fields[name];
    if (typeof field === 'number' && Number.isSafeInteger(field) && field >= 0) reason[name] = field;
  }
  for (const name of REASON_TEXTS) {
    const field = fields[name];
    // A line of a run's output, not a log: what is longer is cut.
    if (typeof field === 'string') reason[name] = field.slice(0, 500);
  }
  return reason;
}

/**
 * Reads the retries a lease result lists, for what this build knows of them.
 *
 * @remarks
 * As a reason is, retries are read for what this build knows: a retry it
 * cannot read is left out, a kind of transfer a later release names is kept,
 * and a result is never refused for them.
 *
 * @param value - The result's `retries`, as its JSON holds them
 * @returns The retries this build reads, at most {@link MOST_RETRIES}; none
 *   when the result lists none
 *
 * @example
 * ```ts
 * for (const retry of readRackRetries(result.retries)) console.log(`${retry.transfer} transfer retried (${retry.attempt} of ${retry.of}): ${retry.cause}`);
 * ```
 */
export function readRackRetries(value: unknown): RackTransferRetry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MOST_RETRIES).flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { transfer, attempt, of, cause } = entry as Record<string, unknown>;
    if (typeof transfer !== 'string' || !WORD.test(transfer) || typeof cause !== 'string') return [];
    if (![attempt, of].every((count) => typeof count === 'number' && Number.isSafeInteger(count) && count >= 1)) return [];
    return [{ transfer, attempt: attempt as number, of: of as number, cause: cause.slice(0, 500) }];
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
 * The marks of a lease's time on its rack this build names
 * (elaraai/e3-cloud#371), in the order a lease reaches them. Each is in ms
 * after the rack received the lease's grant (its claim, which is 0):
 *
 * | Mark | When |
 * |---|---|
 * | `admitted` | the rack had room for the lease, and began on it |
 * | `closure-resolved` | the names of the objects its guest may read were known (its inputs are fetched as its work reads them, after `booted`) |
 * | `environment-ready` | its environment's disk or image was made, or found |
 * | `image-ready` | its tier's image was built, or found |
 * | `vm-acquired` | its VM was started, or a warm one taken |
 * | `booted` | its guest asked for its lease |
 * | `runner-started` | its execution started |
 * | `runner-ended` | its guest answered its result |
 * | `outputs-sent` | every object its work made was in the store |
 */
export const RACK_PHASE_MARKS = ['admitted', 'closure-resolved', 'environment-ready', 'image-ready', 'vm-acquired', 'booted',
  'runner-started', 'runner-ended', 'outputs-sent'] as const;

/**
 * Where a lease's time went on its rack, and what it moved
 * (elaraai/e3-cloud#371): each mark it reached ({@link RACK_PHASE_MARKS}), by
 * the rack's own clock, which no reader compares with its own; and the bytes
 * of its transfers. JSON: a reader takes the marks and counts it knows
 * ({@link readRackPhases}).
 */
export interface RackLeasePhases {
  /** Each mark the lease reached, by its word, in ms after the rack received its grant */
  readonly marks: Readonly<Record<string, number>>;
  /** The bytes fetched from its source for it: the objects its guest read that the rack's cache did not hold, its closure's listing, and its environment's layers */
  readonly fetchedBytes?: number;
  /** How long, in ms, at least one of those fetches was under way: a guest fetches its inputs as its work reads them, so this overlaps its run */
  readonly fetchMs?: number;
  /** The bytes of the objects its guest read that the rack's cache held already */
  readonly cachedBytes?: number;
  /** The bytes sent to its source: the objects its work made that the store did not hold, and a call's value staged as an object */
  readonly sentBytes?: number;
}

/** The most marks of a result's phases that are read. */
const MOST_MARKS = 32;

const PHASE_COUNTS = ['fetchedBytes', 'fetchMs', 'cachedBytes', 'sentBytes'] as const;

/**
 * Reads a lease result's phases, for what this build knows of them.
 *
 * @remarks
 * As a reason is, phases are read for what this build knows: a mark is kept
 * where its name is a word and its time a whole number of ms, at most
 * {@link MOST_MARKS} of them, a mark a later release names among them; a
 * count is kept where it is a whole number; the rest is left out, and a
 * result is never refused for them. A rack from before them says none.
 *
 * @param value - The result's `phases`, as its JSON holds them
 * @returns The phases this build reads; undefined when the result has none,
 *   or none that read
 *
 * @example
 * ```ts
 * const phases = readRackPhases(result.phases);
 * if (phases !== undefined) console.log(describeRackPhases(phases));
 * ```
 */
export function readRackPhases(value: unknown): RackLeasePhases | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  const marks: Record<string, number> = {};
  if (typeof fields.marks === 'object' && fields.marks !== null && !Array.isArray(fields.marks)) {
    for (const [mark, ms] of Object.entries(fields.marks as Record<string, unknown>).slice(0, MOST_MARKS)) {
      if (WORD.test(mark) && typeof ms === 'number' && Number.isSafeInteger(ms) && ms >= 0) marks[mark] = ms;
    }
  }
  const phases: { -readonly [K in keyof RackLeasePhases]: RackLeasePhases[K] } = { marks };
  for (const name of PHASE_COUNTS) {
    const field = fields[name];
    if (typeof field === 'number' && Number.isSafeInteger(field) && field >= 0) phases[name] = field;
  }
  return Object.keys(marks).length === 0 && PHASE_COUNTS.every((name) => phases[name] === undefined) ? undefined : phases;
}

/** A span as a line says it: tenths of a second under ten, whole seconds past. */
function seconds(ms: number): string {
  return ms < 9_950 ? `${Math.round(ms / 100) / 10} s` : `${Math.round(ms / 1000)} s`;
}

/** A size as e3's lines say one: `42 B`, `1.5 KB`, `903 MB`. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  for (const unit of ['KB', 'MB', 'GB']) {
    value /= 1024;
    if (value < 1024) return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
  }
  value /= 1024;
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)} TB`;
}

/**
 * Where a lease's time went on its rack, as a run prints it on the line of its
 * work and its log says it (#1723):
 * - `granted +12 s`: how long the lease waited for a rack to claim it, when
 *   its caller measured it;
 * - `admitted +2 s`: how long the rack took to have room for it, when that
 *   was half a second or more;
 * - `fetched 903 MB (0 B cached) 260 s`: the bytes fetched from its source,
 *   those its guest read from the rack's cache, and how long a fetch was under
 *   way, which overlaps the run (its inputs are fetched as its work reads
 *   them);
 * - `booted 3 s`: from its admission until its guest asked for its lease (its
 *   environment and image made, its VM started);
 * - `ran 19 s`: its execution, from its start until its guest answered;
 * - `sent 4 MB 1 s`: the bytes sent to its source, and how long after its
 *   result the last object was in the store (each object is sent as its work
 *   makes it).
 * A part whose marks or counts the rack did not say is left out.
 *
 * @param phases - What the rack said ({@link readRackPhases})
 * @param grantedMs - How long the lease waited for its grant, in ms, by its
 *   caller's clock; undefined when not measured
 * @param formatSize - How a size is printed: by default as e3's lines print
 *   one (`903 MB`)
 * @returns The parts, joined by ` · `; empty when there are none
 *
 * @example
 * ```ts
 * describeRackPhases({ marks: { 'admitted': 0, 'booted': 3_000, 'runner-started': 3_200, 'runner-ended': 22_200, 'outputs-sent': 23_200 },
 *   fetchedBytes: 903 * 1024 ** 2, fetchMs: 260_000, cachedBytes: 0, sentBytes: 4 * 1024 ** 2 }, 12_000);
 * // 'granted +12 s · fetched 903 MB (0 B cached) 260 s · booted 3 s · ran 19 s · sent 4 MB 1 s'
 * ```
 */
export function describeRackPhases(phases: RackLeasePhases, grantedMs?: number, formatSize: (bytes: number) => string = size): string {
  const { marks } = phases;
  const admitted = marks['admitted'];
  const booted = marks['booted'];
  const started = marks['runner-started'];
  const ended = marks['runner-ended'];
  const sent = marks['outputs-sent'];
  const parts: string[] = [];
  if (grantedMs !== undefined && Number.isFinite(grantedMs) && grantedMs >= 0) parts.push(`granted +${seconds(grantedMs)}`);
  if (admitted !== undefined && admitted >= 500) parts.push(`admitted +${seconds(admitted)}`);
  if (phases.fetchedBytes !== undefined || phases.cachedBytes !== undefined) {
    const took = phases.fetchMs === undefined ? '' : ` ${seconds(phases.fetchMs)}`;
    parts.push(`fetched ${formatSize(phases.fetchedBytes ?? 0)} (${formatSize(phases.cachedBytes ?? 0)} cached)${took}`);
  }
  if (booted !== undefined) parts.push(`booted ${seconds(Math.max(0, booted - (admitted ?? 0)))}`);
  if (started !== undefined && ended !== undefined) parts.push(`ran ${seconds(Math.max(0, ended - started))}`);
  if (phases.sentBytes !== undefined || sent !== undefined) {
    const took = sent !== undefined && ended !== undefined ? ` ${seconds(Math.max(0, sent - ended))}` : '';
    parts.push(`sent ${formatSize(phases.sentBytes ?? 0)}${took}`);
  }
  return parts.join(' · ');
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
  /** Where its time went on its rack, and what it moved (elaraai/e3-cloud#371):
   *  read with {@link readRackPhases}. Absent from a rack that says none */
  phases?: RackLeasePhases;
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
 * The most bytes of value arguments a call's lease carries inline, in all: an
 * argument past them is stored as an object of the repository, and staged as
 * a dataset argument is, through the lease's closure.
 */
export const RACK_INLINE_ARGS_MAX = 192 * 1024;

/**
 * The largest call value a completion carries inline, in bytes: a larger one
 * travels as an object of the store, to a source whose hello says it takes
 * one (`call-value-objects`), and to any other is not relayed
 * (`rackResultTooLarge`).
 */
export const RACK_INLINE_VALUE_MAX = 192 * 1024;

/**
 * Wire shape of a delegated function call's outcome (#83): a JSON-safe
 * mirror of e3-core's `DetachedResult`, its value inline as base64 or named
 * by hash. Rides inside the completion's `resultJson` onto the lease row, so
 * the AGENT size-gates `valueB64` to keep the row under the DynamoDB item
 * cap. A value too large to carry goes as an object of the store to a source
 * whose hello says it takes one (`call-value-objects`): the completion commits
 * it as its output, and names it here. To any other source it is reported as
 * kind 'failed' with `rackResultTooLarge`, and the runner runs the call
 * elsewhere.
 */
export interface RackFunctionResult {
  kind: 'success' | 'failed' | 'too_large' | 'timed_out';
  /** Result value bytes (beast2), base64: kind 'success' only. */
  valueB64?: string;
  /** The value's hash, when it travels as an object of the store: kind
   *  'success' only, in place of `valueB64`. The completion commits the
   *  object as its output (`outputHash`), which is the same hash. */
  valueHash?: string;
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
