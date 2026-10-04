/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The history gc keeps: which of a repository's runs and executions it keeps,
 * and the deletion of the rest, in steps a host may spread over invocations.
 *
 * gc keeps, of each workspace, its last `keepRuns` runs, every run from the
 * last `keepDays` days and the run its current state came from. It keeps every
 * execution those runs used, every execution a workspace's current state is
 * served from, every execution from the last `keepDays` days, and whatever is
 * running — as the runner that started it judges it, when gc is given its
 * judgement: an attempt that cannot finish is recorded interrupted, as the
 * execution cache's probe records one, and pruned as any attempt that ended.
 * - A task over given inputs that keeps any execution keeps its latest attempt
 *   and its latest success, which are what the cache serves from: the dataflow
 *   is served the latest success, and a task run on its own the latest attempt
 *   when it succeeded. So gc never changes what either serves.
 * - A split task's kept success keeps the units its output was assembled from,
 *   which its last `$plan` names through the plans before it, and so does a
 *   kept split task's execution that can resume, through the plan it is in.
 *
 * The prune goes in three phases, a unit of work at a time
 * ({@link pruneStep}):
 * 1. `keep`, a workspace at a time, in name order: the runs it keeps, the
 *    executions from before the window they used, the identities its current
 *    state is served from, and the runs it deletes; then every identity — a
 *    task over given inputs — listed once, in key order;
 * 2. `decide`, the identities listed, a batch at a time: each one's attempts
 *    read in one call (`RefStore.executionListAttempts`), what it keeps and
 *    what it deletes decided, and the units the plans of its kept split task
 *    name; then, once every identity is decided, which of those that keep
 *    nothing of their own a plan names;
 * 3. `delete`, the decisions, a batch at a time — an identity a plan names
 *    keeping its latest attempt and its latest success — then the runs, a
 *    batch at a time, and last the roots of everything kept, gathered for the
 *    mark.
 *
 * What each phase decides is kept as parts of the prune ({@link PruneParts}):
 * a gc run's parts beside running work, memory when gc holds the repository
 * still. So nothing is deleted before every identity is decided, and a unit
 * that a later batch's split task names is never deleted. The identities are
 * listed once, and each step reads the parts of the listing it decides.
 *
 * It works through the storage interfaces, so it prunes any backend's history.
 */

import {
  ArrayType, IntegerType, OptionType, StringType, StructType, VariantType,
  decodeBeast2For, encodeBeast2For, none, some, variant, type ValueTypeOf,
} from '@elaraai/east';
import { WorkspaceRecordType, decodeUnitPlan, executionStatusRoots, type ExecutionStatus, type UnitPlan } from '@elaraai/e3-types';
import type { StorageBackend } from './storage/interfaces.js';
import { OBJECT_CONCURRENCY, eachAtMost } from './concurrency.js';
import { dataflowGetGraph, dataflowResolveInputHashes, type DataflowGraph } from './dataflow.js';
import { GcReadError, ObjectNotFoundError } from './errors.js';
import { inputsHash } from './executions.js';
import { interruptStale } from './execution/cache.js';
import { stageUnits } from './execution/engine.js';
import type { ExecutionLiveness } from './execution/interfaces.js';
import { compareUnitKeys } from './upgrades/parts.js';
import { isUuidv7, uuidv7Timestamp } from './uuid.js';

/** An error's message. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The runs of each workspace gc keeps however old: the latest ten. */
export const DEFAULT_KEEP_RUNS = 10;

/** The days of runs and executions gc keeps however many: a week. */
export const DEFAULT_KEEP_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What {@link pruneHistory} keeps, and whether it deletes the rest. */
export interface HistoryOptions {
  /** The runs of each workspace kept however old, the latest first. */
  keepRuns: number;
  /** The days of runs and executions kept however many. */
  keepDays: number;
  /** Whether to decide what goes without deleting it. */
  dryRun: boolean;
  /**
   * Whether an attempt recorded `running` can still finish, as the runner that
   * started it judges it (`TaskRunner.executionAlive`), as the execution
   * cache's probe is given it. One that cannot is recorded `interrupted`, with
   * why and its log's last line saying so, as the probe records it — in a dry
   * run, decided as if it were — and is pruned as any attempt that ended.
   * Absent, every attempt recorded running is kept.
   */
  executionAlive?: ExecutionLiveness;
  /** How many identities the prune reads at once, and how many decisions it
   *  applies at once: a batch of its work. Default: {@link OBJECT_CONCURRENCY} */
  concurrency?: number;
}

/** What {@link pruneHistory} deleted, or would delete, and what it kept. */
export interface HistoryResult {
  /** Run records deleted. */
  deletedRuns: number;
  /** Execution attempts deleted, each with its owner record and logs. */
  deletedExecutions: number;
  /** The objects the kept executions keep from the sweep: each kept success's
   *  output and last plan, and the plan each kept split task's execution is
   *  in. */
  roots: Set<string>;
}

/**
 * Where a prune keeps what its phases decided, between its steps: a gc run's
 * parts beside running work (`RepoStore.gcRunWrite`), memory when gc holds the
 * repository still. A part's name is lowercase letters, digits and dots.
 */
export interface PruneParts {
  /** Keeps a part, replacing one of the same name. */
  write(name: string, data: Uint8Array): Promise<void>;
  /** A part, or `null` when there is none of the name. */
  read(name: string): Promise<Uint8Array | null>;
}

/** The part that holds the roots of everything a prune kept, once it is
 *  done: an Array of String. */
export const HISTORY_ROOTS_PART = 'roots';

/** Parts held in memory: a prune in one go. */
function memoryParts(): PruneParts {
  const held = new Map<string, Uint8Array>();
  return {
    write: (name, data) => {
      held.set(name, data);
      return Promise.resolve();
    },
    read: (name) => Promise.resolve(held.get(name) ?? null),
  };
}

/**
 * Where a prune is, which a gc run beside running work keeps in its step
 * (`GcStepType`'s `trim`), as beast2.
 *
 * - `keep`: the workspaces after `workspace` are left — and then the listing
 *   of the identities — and `kept` parts of what the ones done keep are
 *   written.
 * - `decide`: the identities from `offset` of part `chunk` of the listing's
 *   `listed` parts on are left — and then finding which a plan names — and
 *   `decided` parts of decisions are written.
 * - `delete`: the decisions from `offset` of part `part` on are left — once
 *   every part is applied, the runs from `offset` on, and then the roots — and
 *   `rooted` parts of the roots they kept are written.
 */
export const PruneAtType = VariantType({
  keep: StructType({ workspace: OptionType(StringType), kept: IntegerType }),
  decide: StructType({ kept: IntegerType, listed: IntegerType, chunk: IntegerType, offset: IntegerType, decided: IntegerType }),
  delete: StructType({ kept: IntegerType, decided: IntegerType, part: IntegerType, offset: IntegerType, rooted: IntegerType }),
});

/** Where a prune is. */
export type PruneAt = ValueTypeOf<typeof PruneAtType>;

/** Where a prune starts: the first workspace. */
export const PRUNE_START: PruneAt = variant('keep', { workspace: none, kept: 0n });

/** What a workspace keeps, and the runs it deletes: a part of the `keep`
 *  phase. */
const WorkspaceKeepType = StructType({
  /** The workspace */
  workspace: StringType,
  /** The attempts from before the window its kept runs used, each
   *  `<task>/<inputs>/<id>`: one within it is kept for being within it */
  attempts: ArrayType(StringType),
  /** The identities its current state is served from, each `<task>/<inputs>` */
  identities: ArrayType(StringType),
  /** The runs it deletes, by id */
  runs: ArrayType(StringType),
});
type WorkspaceKeep = ValueTypeOf<typeof WorkspaceKeepType>;

/** An attempt that a plan naming its identity keeps, with what it roots. */
const KeptAttemptType = StructType({ executionId: StringType, roots: ArrayType(StringType) });

/**
 * What the prune deletes of an identity, a part of the `decide` phase: the
 * attempts it keeps nothing of; and, when the identity keeps nothing of its
 * own, what a plan naming it keeps — its latest attempt and its latest
 * success — and its plan pointer, which goes when no plan names it.
 */
const DecisionType = StructType({
  task: StringType,
  inputs: StringType,
  delete: ArrayType(StringType),
  latest: OptionType(KeptAttemptType),
  success: OptionType(KeptAttemptType),
  plan: OptionType(StringType),
});
type Decision = ValueTypeOf<typeof DecisionType>;

const encodeKeep = encodeBeast2For(WorkspaceKeepType);
const decodeKeep = decodeBeast2For(WorkspaceKeepType);
const encodeDecisions = encodeBeast2For(ArrayType(DecisionType));
const decodeDecisions = decodeBeast2For(ArrayType(DecisionType));
const encodeHashes = encodeBeast2For(ArrayType(StringType));
const decodeHashes = decodeBeast2For(ArrayType(StringType));
const decodeRecord = decodeBeast2For(WorkspaceRecordType);

/** A part of what the `keep` phase decided: a workspace's. */
const keepsPart = (n: bigint): string => `keeps.${n}`;
/** A part of the decisions the `decide` phase made: a step's. */
const decisionsPart = (n: bigint): string => `decisions.${n}`;
/** The units the plans a `decide` step read name. */
const unitsPart = (n: bigint): string => `units.${n}`;
/** The roots of what a `decide` step kept. */
const decidedRootsPart = (n: bigint): string => `decidedroots.${n}`;
/** The roots of what a `delete` step kept of an identity a plan names. */
const unitRootsPart = (n: bigint): string => `unitroots.${n}`;
/** A part of the listing of the identities, in key order. */
const identitiesPart = (n: bigint): string => `identities.${n}`;
/** The identities a `decide` step decided that keep nothing of their own, and
 *  have something a plan naming them keeps: an attempt, or a plan pointer. */
const candidatesPart = (n: bigint): string => `candidates.${n}`;
/** The candidates a plan names, found once every identity is decided. */
const NAMED_PART = 'named';

/** How many identities a part of the listing holds.
 *  @internal */
export const IDENTITIES_PER_PART = 1024;

/**
 * Reads a part of the prune.
 *
 * @throws {Error} When the part is gone: the gc run was deleted, or given up.
 */
async function readPart(parts: PruneParts, name: string): Promise<Uint8Array> {
  const data = await parts.read(name);
  if (data === null) throw new Error(`the history prune has lost its ${name}: start gc again`);
  return data;
}

/** A step's clock: it goes on until the time it may run until has passed,
 *  once it has done a unit of work. */
interface StepClock {
  /** Whether the step starts another unit. */
  goesOn(): boolean;
  /** A unit is done. */
  worked(): void;
}

function stepClock(until: number): StepClock {
  let units = 0;
  return {
    goesOn: () => units === 0 || Date.now() < until,
    worked: () => {
      units++;
    },
  };
}

/** What a step of the prune deleted, or would in a dry run. */
interface Deleted {
  deletedRuns: number;
  deletedExecutions: number;
}

/** What a step of the prune returns. */
export interface PruneStepResult extends Deleted {
  /** Where the prune goes on from; `null` once it is done, and the roots of
   *  what it kept are its {@link HISTORY_ROOTS_PART} */
  at: PruneAt | null;
}

/**
 * Deletes the runs and executions gc does not keep (see the module's doc).
 *
 * @remarks
 * gc holding the repository still runs it under its locks, so no run or task
 * writes a record while it decides. gc beside running work runs it without
 * them, in the steps of {@link pruneStep}, and what runs meanwhile comes to no
 * harm:
 * - a record written after the prune lists the records is not among them, and
 *   stays;
 * - a run that takes an attempt from the cache as the prune deletes it names
 *   an execution that is gone, which the next prune and a workspace's export
 *   pass over; the output it took is rooted by the dataset it writes, and the
 *   retention window keeps it until then;
 * - a split task's execution that begins meanwhile may have its plan pointer
 *   cleared, which costs only a resume: an execution after a crash plans its
 *   pieces again, rather than take up the stage.
 *
 * Everything is decided before the first deletion, so a failure — a workspace
 * whose graph cannot be built, a record or a plan that cannot be read — deletes
 * nothing. Only a record's or a plan's absence means it keeps nothing; one
 * that fails to read for any other reason may keep what it names, so the
 * prune stops rather than decide without it. An execution record that reads
 * but does not decode keeps nothing. An execution goes with its owner record
 * and its logs; a split task's plan pointer goes when nothing of its execution
 * is kept.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param options - What to keep, whether to delete the rest, the runner's
 *   judgement of what still runs, and how many reads and deletes at once
 * @param now - The time the ages are measured from, in epoch milliseconds
 * @returns What was deleted, or would be in a dry run, and the roots of what
 *   was kept
 * @throws {GcReadError} When a plan a kept execution names cannot be read for
 *   a reason other than its absence, or does not decode.
 * @throws {Error} When a workspace's graph, or an execution's records, cannot
 *   be read.
 */
export async function pruneHistory(
  storage: StorageBackend,
  repo: string,
  options: HistoryOptions,
  now: number = Date.now(),
): Promise<HistoryResult> {
  const parts = memoryParts();
  const { deletedRuns, deletedExecutions } = await pruneStep(storage, repo, parts, PRUNE_START, options, now, Infinity);
  return { deletedRuns, deletedExecutions, roots: new Set(decodeHashes(await readPart(parts, HISTORY_ROOTS_PART))) };
}

/**
 * Runs the prune from where it is, a unit of work at a time — a workspace, the
 * listing, a batch of identities, finding which a plan names, a batch of
 * decisions or of runs, the roots — until it is done, or the clock has passed
 * `until` once the step has done a unit.
 *
 * @remarks
 * What a gc run beside running work does in each of its `trim` steps, and
 * what {@link pruneHistory} does in one go. A batch is `options.concurrency`
 * identities read, or decisions or runs applied, at once. A step that fails
 * can be run again from the same `at`: it writes the parts it wrote again, and
 * deletes again only what is gone already.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param parts - Where the prune keeps what its phases decided
 * @param at - Where the prune is: {@link PRUNE_START} for its first step
 * @param options - What to keep, whether to delete the rest, the runner's
 *   judgement of what still runs, and how many reads and deletes at once
 * @param now - The time the ages are measured from, in epoch milliseconds:
 *   the same for every step of a prune
 * @param until - When the step starts no further unit, in epoch milliseconds
 * @returns Where the prune goes on from, or `null` once it is done, and what
 *   the step deleted
 * @throws {GcReadError} When a plan a kept execution names cannot be read for
 *   a reason other than its absence, or does not decode.
 * @throws {Error} When a workspace's graph, or an execution's records, cannot
 *   be read, or a part of the prune is gone.
 */
export async function pruneStep(
  storage: StorageBackend,
  repo: string,
  parts: PruneParts,
  at: PruneAt,
  options: HistoryOptions,
  now: number,
  until: number,
): Promise<PruneStepResult> {
  const deleted: Deleted = { deletedRuns: 0, deletedExecutions: 0 };
  const clock = stepClock(until);
  let next: PruneAt | null = at;
  while (next !== null && clock.goesOn()) {
    switch (next.type) {
      case 'keep': next = await keepPhase(storage, repo, parts, next.value, options, now, clock); break;
      case 'decide': next = await decidePhase(storage, repo, parts, next.value, options, now, clock); break;
      case 'delete': next = await deletePhase(storage, repo, parts, next.value, options, clock, deleted); break;
    }
  }
  return { at: next, ...deleted };
}

// =============================================================================
// keep: what the runs and the workspaces keep
// =============================================================================

/** The workspaces after the last done, a workspace a unit; then the listing
 *  of the identities, a unit of its own. */
async function keepPhase(
  storage: StorageBackend,
  repo: string,
  parts: PruneParts,
  { workspace, kept }: Extract<PruneAt, { type: 'keep' }>['value'],
  options: HistoryOptions,
  now: number,
  clock: StepClock,
): Promise<PruneAt> {
  let last = workspace.type === 'some' ? workspace.value : null;
  let written = kept;
  const stopped = (): PruneAt => variant('keep', { workspace: last === null ? none : some(last), kept: written });
  const workspaces = (await storage.refs.workspaceList(repo))
    .filter((name) => last === null || compareUnitKeys(name, last) > 0)
    .sort(compareUnitKeys);
  for (const name of workspaces) {
    if (!clock.goesOn()) return stopped();
    await parts.write(keepsPart(written), encodeKeep(await keepOf(storage, repo, name, options, now)));
    written++;
    last = name;
    clock.worked();
  }
  if (!clock.goesOn()) return stopped();
  const listed = await listIdentities(storage, repo, parts, options);
  clock.worked();
  return variant('decide', { kept: written, listed, chunk: 0n, offset: 0n, decided: 0n });
}

/**
 * Lists every identity once, in key order, as the listing's parts of
 * {@link IDENTITIES_PER_PART} each: what the `decide` phase decides. An
 * identity a run records only later is not listed, and keeps every attempt it
 * has, each within the window.
 *
 * @returns How many parts the listing is
 */
async function listIdentities(storage: StorageBackend, repo: string, parts: PruneParts, options: HistoryOptions): Promise<bigint> {
  const keys = (await storage.refs.executionList(repo))
    .map(({ taskHash, inputsHash: inputs }) => `${taskHash}/${inputs}`)
    .sort(compareUnitKeys);
  const listing: string[][] = [];
  for (let at = 0; at < keys.length; at += IDENTITIES_PER_PART) listing.push(keys.slice(at, at + IDENTITIES_PER_PART));
  await eachAtMost(listing.map((_, n) => n), options.concurrency ?? OBJECT_CONCURRENCY, (n) =>
    parts.write(identitiesPart(BigInt(n)), encodeHashes(listing[n]!)));
  return BigInt(listing.length);
}

/** Whether an attempt was recorded within the window: at `cutoff` or since. */
function inWindow(executionId: string, cutoff: number): boolean {
  return isUuidv7(executionId) && uuidv7Timestamp(executionId).getTime() >= cutoff;
}

/**
 * What a workspace keeps: the runs it keeps and the attempts from before the
 * window they used, the identities its current state is served from, and the
 * runs it deletes.
 *
 * @throws {Error} When its graph cannot be built: what its state is served
 *   from cannot be known, so nothing is decided without it.
 */
async function keepOf(storage: StorageBackend, repo: string, workspace: string, options: HistoryOptions, now: number): Promise<WorkspaceKeep> {
  const width = options.concurrency ?? OBJECT_CONCURRENCY;
  const cutoff = now - options.keepDays * DAY_MS;
  const data = await storage.refs.workspaceRead(repo, workspace);
  const record = data === null ? null : decodeRecord(data);
  const state = record?.type === 'some' ? record.value : null;

  const runIds = await storage.refs.dataflowRunList(repo, workspace);
  const keptRuns = new Set(options.keepRuns > 0 ? runIds.slice(-options.keepRuns) : []);
  if (state?.currentRunId.type === 'some') keptRuns.add(state.currentRunId.value);
  const reading = runIds.filter((runId) => keptRuns.has(runId) || uuidv7Timestamp(runId).getTime() >= cutoff);
  const read = new Set(reading);
  const deleting = runIds.filter((runId) => !read.has(runId));
  // An attempt within the window is kept for being within it, so only those
  // from before it are kept for a run's sake: a run that takes one from the
  // cache names it, and keeps it, however old
  const attempts = new Set<string>();
  await eachAtMost(reading, width, async (runId) => {
    const run = await storage.refs.dataflowRunGet(repo, workspace, runId);
    for (const used of run?.taskExecutions.values() ?? []) {
      if (!inWindow(used.executionId, cutoff)) attempts.add(`${used.taskHash}/${used.inputsHash}/${used.executionId}`);
    }
  });

  const identities: string[] = [];
  if (state !== null) {
    let graph: DataflowGraph;
    try {
      graph = await dataflowGetGraph(storage, repo, workspace);
    } catch (err) {
      throw new Error(`gc deletes nothing while it cannot read what workspace '${workspace}' is served from: ${messageOf(err)}`);
    }
    const resolved: (string | null)[][] = new Array<(string | null)[]>(graph.tasks.length);
    await eachAtMost(graph.tasks.map((_, i) => i), width, async (i) => {
      resolved[i] = await dataflowResolveInputHashes(storage, repo, workspace, graph.tasks[i]!);
    });
    graph.tasks.forEach((task, i) => {
      const inputs = resolved[i]!;
      const assigned = inputs.filter((hash): hash is string => hash !== null);
      if (assigned.length === inputs.length) identities.push(`${task.hash}/${inputsHash(assigned)}`);
    });
  }
  return { workspace, attempts: [...attempts].sort(compareUnitKeys), identities, runs: deleting };
}

/** What the workspaces keep, as the `keep` phase's parts hold it. */
async function readKeeps(parts: PruneParts, kept: bigint): Promise<{ attempts: Set<string>; identities: Set<string>; keeps: WorkspaceKeep[] }> {
  const attempts = new Set<string>();
  const identities = new Set<string>();
  const keeps: WorkspaceKeep[] = [];
  for (let n = 0n; n < kept; n++) {
    const keep = decodeKeep(await readPart(parts, keepsPart(n)));
    for (const attempt of keep.attempts) attempts.add(attempt);
    for (const identity of keep.identities) identities.add(identity);
    keeps.push(keep);
  }
  return { attempts, identities, keeps };
}

// =============================================================================
// decide: what each identity keeps, and deletes
// =============================================================================

/** An identity: a task over given inputs, and its key, `<task>/<inputs>`. */
interface Identity {
  readonly taskHash: string;
  readonly inputs: string;
  readonly key: string;
}

/** The identity a key of the listing names. */
function identityOf(key: string): Identity {
  const slash = key.indexOf('/');
  return { taskHash: key.slice(0, slash), inputs: key.slice(slash + 1), key };
}

/** The identities listed from where the last step stopped, a batch a unit; the
 *  step's decisions, the units its plans name, the roots of what it kept and
 *  its candidates, kept as parts of its own. Once every identity is decided,
 *  which candidates a plan names, a unit of its own. */
async function decidePhase(
  storage: StorageBackend,
  repo: string,
  parts: PruneParts,
  { kept, listed, chunk, offset, decided }: Extract<PruneAt, { type: 'decide' }>['value'],
  options: HistoryOptions,
  now: number,
  clock: StepClock,
): Promise<PruneAt> {
  const width = options.concurrency ?? OBJECT_CONCURRENCY;
  const keeps = await readKeeps(parts, kept);
  const decisions: Decision[] = [];
  const units = new Set<string>();
  const roots = new Set<string>();
  const expand = planExpander(storage, repo, units);
  let part = chunk;
  let from = Number(offset);
  let worked = false;
  while (part < listed && clock.goesOn()) {
    const keys = decodeHashes(await readPart(parts, identitiesPart(part)));
    while (from < keys.length && clock.goesOn()) {
      const batch = keys.slice(from, from + width);
      await eachAtMost(batch, width, async (key) => {
        const decision = await decideIdentity(storage, repo, identityOf(key), keeps, options, now, expand, roots);
        if (decision !== null) decisions.push(decision);
      });
      from += batch.length;
      worked = true;
      clock.worked();
    }
    if (from < keys.length) break;
    part++;
    from = 0;
  }

  let written = decided;
  if (worked) {
    decisions.sort((a, b) => compareUnitKeys(`${a.task}/${a.inputs}`, `${b.task}/${b.inputs}`));
    const candidates = decisions
      .filter(({ latest, success, plan }) => latest.type === 'some' || success.type === 'some' || plan.type === 'some')
      .map(({ task, inputs }) => `${task}/${inputs}`);
    await parts.write(unitsPart(written), encodeHashes([...units].sort(compareUnitKeys)));
    await parts.write(decidedRootsPart(written), encodeHashes([...roots].sort(compareUnitKeys)));
    await parts.write(candidatesPart(written), encodeHashes(candidates));
    await parts.write(decisionsPart(written), encodeDecisions(decisions));
    written++;
  }
  if (part < listed || !clock.goesOn()) return variant('decide', { kept, listed, chunk: part, offset: BigInt(from), decided: written });
  await nameCandidates(parts, written);
  clock.worked();
  return variant('delete', { kept, decided: written, part: 0n, offset: 0n, rooted: 0n });
}

/**
 * Finds which candidates — the identities that keep nothing of their own, and
 * have something a plan naming them keeps — a plan names, once every identity
 * is decided: a unit that a later batch's split task names is kept, whichever
 * batch decided it.
 *
 * @param decided - How many parts of decisions the `decide` phase wrote
 */
async function nameCandidates(parts: PruneParts, decided: bigint): Promise<void> {
  const units = new Set<string>();
  for (let n = 0n; n < decided; n++) for (const unit of decodeHashes(await readPart(parts, unitsPart(n)))) units.add(unit);
  const named: string[] = [];
  for (let n = 0n; n < decided; n++) {
    for (const key of decodeHashes(await readPart(parts, candidatesPart(n)))) if (units.has(key)) named.push(key);
  }
  await parts.write(NAMED_PART, encodeHashes(named.sort(compareUnitKeys)));
}

/** An attempt at an identity, as the prune decides on it. */
interface Attempt {
  readonly executionId: string;
  readonly status: ExecutionStatus | null;
}

/**
 * Decides what an identity keeps and deletes: what the runs and workspaces
 * keep of it, its recent attempts, and those running — after its runner's
 * judgement — and, when it keeps any, its latest attempt and latest success.
 * The roots of what it keeps go to `roots`, and the units its kept split
 * task's plans name are expanded.
 *
 * @returns What it deletes, or `null` when it deletes nothing and has no plan
 *   pointer a plan's units may keep
 * @throws {Error} When its attempts cannot be read: nothing is decided without
 *   them.
 */
async function decideIdentity(
  storage: StorageBackend,
  repo: string,
  { taskHash, inputs, key }: Identity,
  keeps: { attempts: ReadonlySet<string>; identities: ReadonlySet<string> },
  options: HistoryOptions,
  now: number,
  expand: (plan: string) => Promise<void>,
  roots: Set<string>,
): Promise<Decision | null> {
  let attempts: Attempt[];
  try {
    attempts = await storage.refs.executionListAttempts(repo, taskHash, inputs);
  } catch (err) {
    // One the store failed to read may be a success whose output only it
    // keeps: nothing is decided without it.
    throw new Error(`gc deletes nothing while it cannot read the executions of ${key}: ${messageOf(err)}`);
  }
  const plan = await storage.refs.executionPlanRead(repo, taskHash, inputs);

  // An attempt recorded running that its runner says cannot finish is
  // recorded so, as a probe records it, and is then as any attempt that ended
  const alive = options.executionAlive;
  if (alive !== undefined) {
    attempts = await Promise.all(attempts.map(async (attempt): Promise<Attempt> => {
      if (attempt.status?.type !== 'running') return attempt;
      const stopped = await interruptStale(storage, repo, taskHash, inputs, attempt.status.value, alive, !options.dryRun);
      return stopped === null ? attempt : { executionId: attempt.executionId, status: stopped };
    }));
  }

  const cutoff = now - options.keepDays * DAY_MS;
  const kept = new Set<string>();
  for (const { executionId, status } of attempts) {
    if (keeps.attempts.has(`${key}/${executionId}`) || inWindow(executionId, cutoff) || status?.type === 'running') kept.add(executionId);
  }
  const keepsItself = keeps.identities.has(key) || kept.size > 0;
  const latest = attempts.at(-1);
  const success = [...attempts].reverse().find((attempt) => attempt.status?.type === 'success');
  if (keepsItself) {
    if (latest !== undefined) kept.add(latest.executionId);
    if (success !== undefined) kept.add(success.executionId);
  }

  for (const { executionId, status } of attempts) {
    if (!kept.has(executionId) || status === null) continue;
    for (const root of executionStatusRoots(status)) roots.add(root);
    if (status.type === 'success' && status.value.plan.type === 'some') await expand(status.value.plan.value);
  }
  if (keepsItself && plan !== null) {
    roots.add(plan);
    await expand(plan);
  }

  const deletes = attempts.filter(({ executionId }) => !kept.has(executionId)).map(({ executionId }) => executionId);
  if (keepsItself) return deletes.length === 0 ? null : { task: taskHash, inputs, delete: deletes, latest: none, success: none, plan: none };
  if (deletes.length === 0 && plan === null) return null;
  const keptAttempt = (attempt: Attempt | undefined) => (attempt === undefined
    ? none
    : some({ executionId: attempt.executionId, roots: attempt.status === null ? [] : [...executionStatusRoots(attempt.status)] }));
  return { task: taskHash, inputs, delete: deletes, latest: keptAttempt(latest), success: keptAttempt(success), plan: plan === null ? none : some(plan) };
}

/**
 * The units plans name, each plan read once: a stage's plan, and each stage's
 * before it. A plan that is gone names no units to keep; one that cannot be
 * read, or does not decode, names units that cannot be known, and nothing is
 * decided without them.
 *
 * @param units - Where each unit's identity, `<task>/<inputs>`, goes
 * @returns What expands a plan's chain into `units`
 */
function planExpander(storage: StorageBackend, repo: string, units: Set<string>): (plan: string) => Promise<void> {
  const expanded = new Set<string>();
  return async (planHash) => {
    for (let next: string | null = planHash; next !== null && !expanded.has(next);) {
      expanded.add(next);
      let bytes: Uint8Array;
      try {
        bytes = await storage.objects.read(repo, next);
      } catch (err) {
        if (err instanceof ObjectNotFoundError) return;
        throw new GcReadError(next, messageOf(err));
      }
      let plan: UnitPlan;
      try {
        plan = decodeUnitPlan(bytes);
      } catch (err) {
        throw new GcReadError(next, messageOf(err), true);
      }
      for (const unit of stageUnits(plan.stage)) units.add(`${plan.task}/${inputsHash(unit.inputs)}`);
      next = plan.previous.type === 'some' ? plan.previous.value : null;
    }
  };
}

// =============================================================================
// delete: the decisions, the runs, and the roots
// =============================================================================

/** The decisions from where the last step stopped, a batch a unit; then the
 *  runs, a batch a unit; then the roots of everything kept, gathered into
 *  {@link HISTORY_ROOTS_PART}, a unit of its own. */
async function deletePhase(
  storage: StorageBackend,
  repo: string,
  parts: PruneParts,
  { kept, decided, part, offset, rooted }: Extract<PruneAt, { type: 'delete' }>['value'],
  options: HistoryOptions,
  clock: StepClock,
  deleted: Deleted,
): Promise<PruneAt | null> {
  const width = options.concurrency ?? OBJECT_CONCURRENCY;
  const named = new Set(decodeHashes(await readPart(parts, NAMED_PART)));
  const roots = new Set<string>();
  let written = rooted;
  let at = part;
  let from = Number(offset);
  const keepRoots = async (): Promise<void> => {
    if (roots.size === 0) return;
    await parts.write(unitRootsPart(written), encodeHashes([...roots].sort(compareUnitKeys)));
    written++;
    roots.clear();
  };
  const stopped = async (): Promise<PruneAt> => {
    await keepRoots();
    return variant('delete', { kept, decided, part: at, offset: BigInt(from), rooted: written });
  };

  for (; at < decided; at++, from = 0) {
    const decisions = decodeDecisions(await readPart(parts, decisionsPart(at)));
    while (from < decisions.length) {
      if (!clock.goesOn()) return stopped();
      const batch = decisions.slice(from, from + width);
      await eachAtMost(batch, width, async (decision) => {
        // Counted once applied: `+=` would read the count before the await,
        // and lose what the decisions applied beside this one counted
        const applied = await applyDecision(storage, repo, decision, named, roots, options.dryRun);
        deleted.deletedExecutions += applied;
      });
      from += batch.length;
      clock.worked();
    }
  }

  // The runs, every workspace's, once every decision is applied: `from` is now
  // the offset of the next run
  const { keeps } = await readKeeps(parts, kept);
  const runs = keeps.flatMap(({ workspace, runs: ids }) => ids.map((runId) => ({ workspace, runId })));
  while (from < runs.length) {
    if (!clock.goesOn()) return stopped();
    const batch = runs.slice(from, from + width);
    await eachAtMost(batch, width, async ({ workspace, runId }) => {
      if (!options.dryRun) await storage.refs.dataflowRunDelete(repo, workspace, runId);
      deleted.deletedRuns++;
    });
    from += batch.length;
    clock.worked();
  }

  // The roots of everything kept, for the mark
  if (!clock.goesOn()) return stopped();
  await keepRoots();
  const all = new Set<string>();
  for (let n = 0n; n < decided; n++) for (const root of decodeHashes(await readPart(parts, decidedRootsPart(n)))) all.add(root);
  for (let n = 0n; n < written; n++) for (const root of decodeHashes(await readPart(parts, unitRootsPart(n)))) all.add(root);
  await parts.write(HISTORY_ROOTS_PART, encodeHashes([...all].sort(compareUnitKeys)));
  return null;
}

/**
 * Applies an identity's decision: one a plan names keeps its latest attempt
 * and its latest success, rooting what they name and its plan pointer; one
 * no plan names has its plan pointer cleared. Then each attempt it keeps
 * nothing of goes, with its owner and its logs, one after another, so the
 * last leaves its directory empty.
 *
 * @param named - The candidates a plan names
 * @returns How many attempts it deleted, or would in a dry run
 */
async function applyDecision(
  storage: StorageBackend,
  repo: string,
  decision: Decision,
  named: ReadonlySet<string>,
  roots: Set<string>,
  dryRun: boolean,
): Promise<number> {
  const { task, inputs } = decision;
  let deletes = decision.delete;
  if (named.has(`${task}/${inputs}`)) {
    const keep = new Set<string>();
    for (const attempt of [decision.latest, decision.success]) {
      if (attempt.type !== 'some') continue;
      keep.add(attempt.value.executionId);
      for (const root of attempt.value.roots) roots.add(root);
    }
    if (decision.plan.type === 'some') roots.add(decision.plan.value);
    deletes = deletes.filter((executionId) => !keep.has(executionId));
  } else if (decision.plan.type === 'some' && !dryRun) {
    await storage.refs.executionPlanWrite(repo, task, inputs, null);
  }
  if (!dryRun) {
    for (const executionId of deletes) {
      await storage.logs.remove(repo, task, inputs, executionId);
      await storage.refs.executionDelete(repo, task, inputs, executionId);
    }
  }
  return deletes.length;
}
