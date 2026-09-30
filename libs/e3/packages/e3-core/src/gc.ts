/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Shared garbage collection algorithm for e3 repositories.
 *
 * Uses mark-and-sweep:
 * 1. collectAllRoots: Collect root hashes from all root scan methods
 * 2. markReachable: DFS through object graph via BEAST2 schema-aware traversal
 *    (gc-graph.ts)
 * 3. sweepBatch: Pure decision function — identify unreachable objects to delete
 * 4. repoGc: Driver that calls all phases in sequence, after pruning the
 *    history of runs and executions it does not keep (history.ts), then drops
 *    the adoption memo's entries whose manifest is gone, and then the
 *    backend's own sweep
 *
 * gc runs one of two ways. By default it holds the repository still, so
 * nothing writes while it decides. Given a retention window it runs beside
 * running work instead, in steps a host may spread over several invocations
 * ({@link repoGcStep}), its mark among them: an object goes only once it has
 * stayed unreachable for the window, measured from the first sweep that saw it
 * so, and only if nothing wrote or re-referenced it since.
 *
 * These functions work with any StorageBackend, through its interfaces. What a
 * backend keeps beside its objects and records — a local repository's staging
 * files, scratch directories and built environments — its `RepoStore` sweeps
 * (`gcSweepBackend`).
 */

import { ArrayType, BooleanType, IntegerType, OptionType, StringType, StructType, VariantType, decodeBeast2For, encodeBeast2For, none, some, variant, type ValueTypeOf } from '@elaraai/east';
import { GcResultType } from '@elaraai/e3-types';
import type { RepoStore, GcObjectEntry, GcRootScanResult, StorageBackend } from './storage/interfaces.js';
import { OBJECT_CONCURRENCY, eachAtMost } from './concurrency.js';
import { gcObjectReaders, markFrom, markReachable } from './gc-graph.js';
import { DEFAULT_KEEP_DAYS, DEFAULT_KEEP_RUNS, pruneHistory } from './history.js';
import { isObjectHash } from './objects.js';
import { withRepositoryHeld } from './running-work.js';
import { uuidv7, uuidv7Timestamp } from './uuid.js';

export { gcObjectReaders, markReachable, touchReachable, type GcChildKind, type MarkReachableOptions } from './gc-graph.js';

/**
 * Options for garbage collection
 */
export interface GcOptions {
  /**
   * Minimum age in milliseconds for files to be considered for deletion.
   * Files younger than this are skipped to avoid race conditions with concurrent writes.
   * Default: 60000 (1 minute)
   */
  minAge?: number;

  /**
   * If true, only report what would be deleted without actually deleting.
   * Default: false
   */
  dryRun?: boolean;

  /**
   * The runs of each workspace kept however old, the latest first: with the
   * executions they used (history.ts).
   * Default: {@link DEFAULT_KEEP_RUNS}
   */
  keepRuns?: number;

  /**
   * The days of runs and executions kept however many.
   * Default: {@link DEFAULT_KEEP_DAYS}
   */
  keepDays?: number;

  /**
   * Run beside running work, behind a retention window, instead of holding the
   * repository still: the steps of {@link repoGcStep}, one after another.
   * Default: none — gc holds the repository still
   */
  retention?: GcRetention;
}

/**
 * How gc runs beside running work.
 */
export interface GcRetention {
  /**
   * How long an object stays unreachable before gc deletes it, in
   * milliseconds, measured from the first sweep that saw it so: a whole number
   * greater than zero, and longer than any write takes to root what it stores.
   */
  windowMs: number;
}

/**
 * Result of garbage collection
 */
export interface GcResult {
  /** Number of objects deleted */
  deletedObjects: number;
  /** Number of orphaned staging files deleted */
  deletedPartials: number;
  /** Number of objects retained */
  retainedObjects: number;
  /** Number of files skipped due to being too young: beside running work,
   *  unreachable objects still inside the retention window too */
  skippedYoung: number;
  /** Total bytes freed */
  bytesFreed: number;
  /** Number of dataflow run records deleted */
  deletedRuns: number;
  /** Number of execution attempts deleted, each with its owner and logs */
  deletedExecutions: number;
}

/**
 * Result from sweepBatch — pure decision, no side effects.
 */
export interface SweepBatchResult {
  /** Hashes of objects to delete */
  toDelete: string[];
  /** Number of objects retained (reachable) */
  retained: number;
  /** Number of objects skipped due to being too young */
  skippedYoung: number;
  /** Total bytes that would be freed */
  bytesFreed: number;
}

/** The age gate's default: a minute. */
const DEFAULT_MIN_AGE_MS = 60_000;

// =============================================================================
// Shared Algorithm Functions
// =============================================================================

/**
 * Collect all root hashes from packages, workspaces, and executions.
 *
 * Calls each gcScan*Roots method with pagination support.
 * Adding a new root scan method to RepoStore requires updating this function.
 *
 * @param store - The repository store to scan
 * @param repo - Repository identifier
 * @param executionRoots - The roots of the executions gc keeps, when it has
 *   pruned the history itself, so a dry run marks as if it had deleted what it
 *   prunes; absent, every recorded execution's, as the store's scan finds them
 * @returns The root hashes
 */
export async function collectAllRoots(store: RepoStore, repo: string, executionRoots?: Iterable<string>): Promise<Set<string>> {
  const roots = new Set<string>();

  const scanAll = async (scan: (repo: string, cursor?: unknown) => Promise<GcRootScanResult>) => {
    let cursor: unknown;
    do {
      const result = await scan(repo, cursor);
      for (const hash of result.roots) {
        roots.add(hash);
      }
      cursor = result.cursor;
    } while (cursor !== undefined);
  };

  await scanAll(store.gcScanPackageRoots.bind(store));
  await scanAll(store.gcScanWorkspaceRoots.bind(store));
  if (executionRoots === undefined) {
    await scanAll(store.gcScanExecutionRoots.bind(store));
  } else {
    for (const hash of executionRoots) roots.add(hash);
  }

  return roots;
}

/**
 * Pure decision function: determine which objects to delete.
 *
 * No side effects — trivially testable. Caller decides whether to
 * actually delete (supports dry-run by skipping gcDeleteObjects).
 *
 * @param objects - Object entries from gcScanObjects
 * @param reachable - Set of reachable hashes from markReachable
 * @param minAge - Minimum age in ms; objects younger than this are skipped
 * @returns Decision result with toDelete list and stats
 */
export function sweepBatch(
  objects: GcObjectEntry[],
  reachable: Set<string>,
  minAge: number
): SweepBatchResult {
  const now = Date.now();
  const toDelete: string[] = [];
  let retained = 0;
  let skippedYoung = 0;
  let bytesFreed = 0;

  for (const obj of objects) {
    if (reachable.has(obj.hash)) {
      retained++;
      continue;
    }
    const age = now - obj.lastModified;
    if (minAge > 0 && age < minAge) {
      skippedYoung++;
      continue;
    }
    toDelete.push(obj.hash);
    bytesFreed += obj.size;
  }

  return { toDelete, retained, skippedYoung, bytesFreed };
}

/**
 * Refuses options gc cannot run by.
 *
 * @throws {RangeError} When `keepRuns`, `keepDays` or `markMs` is not a whole
 *   number of zero or more, `concurrency` is not a whole number greater than
 *   zero, or `windowMs` is not a whole number greater than zero.
 */
function checkOptions(
  options: { keepRuns?: number; keepDays?: number; markMs?: number; concurrency?: number },
  windowMs: number | undefined,
): void {
  for (const [name, value] of [['keepRuns', options.keepRuns], ['keepDays', options.keepDays], ['markMs', options.markMs]] as const) {
    if (value !== undefined && !(Number.isInteger(value) && value >= 0)) {
      throw new RangeError(`gc: ${name} must be a whole number of zero or more, got ${value}`);
    }
  }
  if (options.concurrency !== undefined && !(Number.isInteger(options.concurrency) && options.concurrency > 0)) {
    throw new RangeError(`gc: concurrency must be a whole number greater than zero, got ${options.concurrency}`);
  }
  if (windowMs !== undefined && !(Number.isInteger(windowMs) && windowMs > 0)) {
    throw new RangeError(`gc: the retention window must be a whole number of milliseconds greater than zero, got ${windowMs}`);
  }
}

/**
 * Drops the adoption memo's entries whose manifest is gone. The memo roots
 * nothing, so such an entry — its manifest taken by this sweep or an earlier
 * one — would only ever miss. One whose manifest a gate kept stays with it.
 */
async function forgetCollectedAdoptions(storage: StorageBackend, repo: string): Promise<void> {
  for (const { sourceHash, manifestHash } of await storage.refs.adoptionList(repo)) {
    if (manifestHash !== null && await storage.objects.exists(repo, manifestHash)) continue;
    await storage.refs.adoptionDelete(repo, sourceHash);
  }
}

// =============================================================================
// Driver
// =============================================================================

/**
 * Run garbage collection on an e3 repository.
 *
 * Works with any StorageBackend — no instanceof checks.
 *
 * By default gc holds the repository still ({@link withRepositoryHeld}): the
 * tasks lock exclusively and every workspace's dataflow lock, from before the
 * history's prune until the sweep is done, so it never overlaps a write
 * holding the tasks lock or a dataflow run: the objects either writes before
 * it roots them need no rooting, and no record is written while it decides
 * which to keep. It prunes the history first (history.ts), and then marks from
 * what it kept, so the outputs only the deleted records kept go in the same
 * sweep. Marking is header-first, so a dataset is never read whole. The
 * adoption memo's entries whose manifest is gone are dropped then, since the
 * memo roots nothing. Last, the backend sweeps what it keeps beside its
 * objects and records ({@link RepoStore.gcSweepBackend}).
 *
 * Given `options.retention`, gc holds nothing: it runs the steps of
 * {@link repoGcStep} one after another, beside whatever runs, and deletes
 * only objects unreachable for the retention window. A run it gives up on, at
 * an error, keeps nothing.
 *
 * gc never decides on a read that failed. Only an object's absence
 * (`ObjectNotFoundError`) says an object names nothing: any other read
 * failure, and an object that names other objects but does not decode, stops
 * gc with an error naming the object, before the sweep deletes anything. The
 * history prune decides everything before it deletes anything, and stops the
 * same way on a record or a plan it cannot read.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param options - GC options
 * @returns GC result with statistics
 * @throws {RangeError} When `keepRuns` or `keepDays` is not a whole number of
 *   zero or more, or the retention window is not a whole number of
 *   milliseconds greater than zero.
 * @throws {GcReadError} When an object the mark or the history prune reached
 *   cannot be read for a reason other than its absence, or names other
 *   objects and does not decode: nothing is swept.
 * @throws {RepositoryBusyError} When gc holds the repository still, and a task
 *   is running in it, or a dataflow in one of its workspaces.
 * @throws {Error} When a record the history prune or the root scans read
 *   cannot be read.
 */
export async function repoGc(
  storage: StorageBackend,
  repo: string,
  options: GcOptions = {}
): Promise<GcResult> {
  checkOptions(options, options.retention?.windowMs);
  if (options.retention === undefined) {
    return withRepositoryHeld(storage, repo, { doing: 'gc' }, () => collectGarbage(storage, repo, options));
  }
  const stepOptions: GcStepOptions = {
    windowMs: options.retention.windowMs,
    ...(options.minAge !== undefined && { minAge: options.minAge }),
    ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
    ...(options.keepRuns !== undefined && { keepRuns: options.keepRuns }),
    ...(options.keepDays !== undefined && { keepDays: options.keepDays }),
  };
  let step: GcStep | null = null;
  try {
    for (;;) {
      const next = await repoGcStep(storage, repo, step, stepOptions);
      if (next.step === null) return next.result;
      step = next.step;
    }
  } catch (err) {
    if (step !== null) {
      await storage.repos.gcRunDelete(repo, step.value.run).catch(() => { /* the step's own failure is the one raised */ });
    }
    throw err;
  }
}

/** The mark and sweep of {@link repoGc}, run under its locks. */
async function collectGarbage(
  storage: StorageBackend,
  repo: string,
  options: GcOptions
): Promise<GcResult> {
  const minAge = options.minAge ?? DEFAULT_MIN_AGE_MS;
  const dryRun = options.dryRun ?? false;

  // Step 0: Prune the history: the runs and executions gc does not keep go,
  // or would in a dry run
  const history = await pruneHistory(storage, repo, {
    keepRuns: options.keepRuns ?? DEFAULT_KEEP_RUNS,
    keepDays: options.keepDays ?? DEFAULT_KEEP_DAYS,
    dryRun,
  });

  // Step 1: Collect all root hashes: the executions' from what the prune kept
  const roots = await collectAllRoots(storage.repos, repo, history.roots);

  // Step 2: Mark all reachable objects, header-first. Only an object's absence
  // reads as `null`: any other failure stops the mark, and the sweep after it
  const { readObject, readHead } = gcObjectReaders(storage, repo);
  const reachable = await markReachable(readObject, roots, { readHead });

  // Step 3: Scan and sweep objects
  let totalDeleted = 0;
  let totalRetained = 0;
  let totalSkippedYoung = 0;
  let totalBytesFreed = 0;
  let cursor: string | undefined;

  do {
    const scan = await storage.repos.gcScanObjects(repo, cursor);
    const result = sweepBatch(scan.objects, reachable, minAge);

    totalRetained += result.retained;
    totalSkippedYoung += result.skippedYoung;
    totalBytesFreed += result.bytesFreed;

    if (!dryRun && result.toDelete.length > 0) {
      await storage.repos.gcDeleteObjects(repo, result.toDelete);
    }
    totalDeleted += result.toDelete.length;

    cursor = scan.cursor;
  } while (cursor !== undefined);

  // Step 4: The adoption memo's entries whose manifest is gone
  if (!dryRun) await forgetCollectedAdoptions(storage, repo);

  // Step 5: The backend sweeps what it keeps beside its objects and records
  const backend = await storage.repos.gcSweepBackend(repo, reachable, { minAge, dryRun, held: true });

  return {
    deletedObjects: totalDeleted,
    deletedPartials: backend.deletedPartials,
    retainedObjects: totalRetained,
    skippedYoung: totalSkippedYoung + backend.skippedYoung,
    bytesFreed: totalBytesFreed,
    deletedRuns: history.deletedRuns,
    deletedExecutions: history.deletedExecutions,
  };
}

// =============================================================================
// Beside running work, in steps
// =============================================================================

/**
 * A gc run beside running work, as far as its steps have got: the run whose
 * parts its `RepoStore` keeps between steps, whether it is a dry run, and what
 * it has counted so far.
 */
const GcRunFields = {
  /** The run's id, a UUIDv7: its parts are kept under it */
  run: StringType,
  /** Whether the run deletes nothing, and notes nothing */
  dryRun: BooleanType,
  /** What the run has counted so far */
  result: GcResultType,
};

/**
 * The next step of a gc run beside running work ({@link repoGcStep}), which a
 * host keeps between invocations as beast2.
 *
 * - `mark`: the history is pruned and the roots it kept are kept: the mark is
 *   next.
 * - `marking`: the mark is under way, spread over steps: what it has reached
 *   so far, and what it has still to visit, are kept as the `generation` of
 *   the run's parts that names them; it goes on.
 * - `sweep`: the mark's reachable set is kept: the sweep goes on at the page
 *   of the object scan `cursor` names — `none` for the first.
 * - `finish`: every page is swept: the adoption memo and the backend's own
 *   sweep are left.
 */
export const GcStepType = VariantType({
  mark: StructType(GcRunFields),
  marking: StructType({ ...GcRunFields, generation: IntegerType }),
  sweep: StructType({ ...GcRunFields, cursor: OptionType(StringType) }),
  finish: StructType(GcRunFields),
});

/** The next step of a gc run beside running work. */
export type GcStep = ValueTypeOf<typeof GcStepType>;

/** What a gc run beside running work has counted, as its step keeps it. */
type GcCounts = ValueTypeOf<typeof GcResultType>;

/** A run at one kind of step. */
type GcRunAt<K extends GcStep['type']> = Extract<GcStep, { type: K }>['value'];

/** Nothing counted yet. */
const ZERO_COUNTS: GcCounts = {
  deletedObjects: 0n, deletedPartials: 0n, retainedObjects: 0n, skippedYoung: 0n, bytesFreed: 0n, deletedRuns: 0n, deletedExecutions: 0n,
};

/**
 * Options for {@link repoGcStep}: a host passes the same ones to every step of
 * a run.
 */
export interface GcStepOptions {
  /**
   * How long an object stays unreachable before gc deletes it, in
   * milliseconds, measured from the first sweep that saw it so: a whole number
   * greater than zero, and longer than any write takes to root what it stores.
   */
  windowMs: number;
  /**
   * The age gate: an object written more recently than this many milliseconds
   * ago is not deleted, whatever its note says, and nor is a staging file.
   * Default: 60000 (1 minute)
   */
  minAge?: number;
  /**
   * Whether the run only reports what it would delete: it deletes nothing,
   * prunes no history and notes nothing. Read by the first step; the run keeps
   * it. Default: false
   */
  dryRun?: boolean;
  /** The runs of each workspace the history keeps however old. Default:
   *  {@link DEFAULT_KEEP_RUNS} */
  keepRuns?: number;
  /** The days of runs and executions the history keeps however many.
   *  Default: {@link DEFAULT_KEEP_DAYS} */
  keepDays?: number;
  /**
   * How long one mark step reads, in milliseconds, before it hands what it
   * has still to visit to the next step (`marking`): a host whose steps run on
   * compute with a time limit sets it under that limit, with room to keep
   * what the step reached. Default: no limit — one step marks everything.
   */
  markMs?: number;
  /** How many objects the mark reads at once. Default:
   *  {@link OBJECT_CONCURRENCY} */
  concurrency?: number;
  /** When the step runs, in epoch milliseconds. Default: now */
  now?: number;
}

/** What a step of a gc run beside running work returns. */
export interface GcStepResult {
  /** The next step, or `null` once the run is done */
  step: GcStep | null;
  /** What the run has counted so far: once it is done, its result */
  result: GcResult;
}

/** The part of a run that keeps the roots the history kept. */
const ROOTS_PART = 'roots';

/** The part of a run that lists the shards of the mark's reachable set, once
 *  the mark is whole: what the sweep reads it by. */
const REACHABLE_PART = 'reachable';

/**
 * The part of a run that keeps a shard of the mark's reachable set: the
 * reached objects whose hash begins with a prefix, as a generation of the mark
 * wrote them.
 *
 * @param shard - The shard's id: `<generation>.<prefix>`
 */
const shardPart = (shard: string): string => `reachable.${shard}`;

/** The part of a run that lists the shards a generation of the mark kept,
 *  while the mark goes on over steps. */
const markingPart = (generation: number): string => `marking.${generation}`;

/** The part of a run that keeps what a generation of the mark had still to
 *  visit. */
const frontierPart = (generation: number): string => `frontier.${generation}`;

/** The prefix a shard's id names: its last two hex digits. */
const prefixOf = (shard: string): string => shard.slice(-2);

const encodeHashes = encodeBeast2For(ArrayType(StringType));
const decodeHashes = decodeBeast2For(ArrayType(StringType));

/**
 * Run one step of garbage collection beside running work.
 *
 * @remarks
 * gc holds nothing here. Its safety is the retention window: an object is
 * deleted only once it has stayed unreachable for `options.windowMs`,
 * measured from the first sweep that saw it so
 * ({@link RepoStore.gcNoteUnreachable}), and only if nothing wrote or
 * re-referenced it since ({@link RepoStore.gcDeleteUnreachable}). A write in
 * flight stores objects it has not yet rooted; they are younger than the
 * window, so no sweep reaches them. A caller that roots an object it did not
 * write touches it first (`ObjectStore.touch`, {@link touchReachable}).
 *
 * A run is five kinds of step, each bounded so a host with bounded compute
 * spreads them over invocations, keeping the {@link GcStep} each returns — an
 * East value, as beast2 — until the next:
 * 1. `null` starts a run: it prunes the history, as {@link repoGc} does, and
 *    keeps the roots the history kept;
 * 2. `mark` marks from every root, header-first, `options.concurrency` reads
 *    at once, and keeps the reachable set in shards. Given `options.markMs`,
 *    it stops once that has passed, and keeps what it has reached and what it
 *    has still to visit;
 * 3. `marking` goes on with a mark so stopped, until the mark is whole. Each
 *    step keeps a generation of the run's parts of its own, so a step that
 *    fails, run again, starts from the parts it started from;
 * 4. `sweep` sweeps one page of the object scan: it clears the notes of what
 *    the mark reached, notes what it did not — unless it was written after the
 *    run began, so its mark may have missed what roots it: a later run notes
 *    it, if it is unreachable then — and deletes what has stayed unreachable
 *    for the window; the next page is the next step;
 * 5. `finish` drops the adoption memo's entries whose manifest is gone, runs
 *    the backend's own sweep beside running work, and deletes the run.
 *
 * A step that fails can be run again. A run given up keeps its parts until the
 * host deletes them (`RepoStore.gcRunDelete`).
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param step - The step a previous call returned, or `null` to start a run
 * @param options - The retention window, the age gate, the history kept, and
 *   how long a mark step reads and how many objects at once: the same for
 *   every step of a run
 * @returns The next step — `null` once the run is done — and what the run has
 *   counted so far
 * @throws {RangeError} When `keepRuns`, `keepDays` or `markMs` is not a whole
 *   number of zero or more, `concurrency` is not a whole number greater than
 *   zero, or `windowMs` is not a whole number greater than zero.
 * @throws {GcReadError} When an object the mark or the history prune reached
 *   cannot be read for a reason other than its absence, or names other
 *   objects and does not decode: nothing is swept.
 * @throws {Error} When a record the history prune or the root scans read
 *   cannot be read, or a part of the run is gone.
 */
export async function repoGcStep(
  storage: StorageBackend,
  repo: string,
  step: GcStep | null,
  options: GcStepOptions,
): Promise<GcStepResult> {
  checkOptions(options, options.windowMs);
  const now = options.now ?? Date.now();
  if (step === null) return startRun(storage, repo, options, now);
  switch (step.type) {
    case 'mark': return markRun(storage, repo, step.value, options);
    case 'marking': return markingRun(storage, repo, step.value, options);
    case 'sweep': return sweepPage(storage, repo, step.value, options, now);
    case 'finish': return finishRun(storage, repo, step.value, options);
  }
}

/** A step to return, with what its run has counted so far. */
function stepped(step: GcStep): GcStepResult {
  return { step, result: resultOf(step.value.result) };
}

/** What a run has counted, as {@link repoGc} reports it. */
function resultOf(counts: GcCounts): GcResult {
  return {
    deletedObjects: Number(counts.deletedObjects),
    deletedPartials: Number(counts.deletedPartials),
    retainedObjects: Number(counts.retainedObjects),
    skippedYoung: Number(counts.skippedYoung),
    bytesFreed: Number(counts.bytesFreed),
    deletedRuns: Number(counts.deletedRuns),
    deletedExecutions: Number(counts.deletedExecutions),
  };
}

/** A run's counts, with a step's added. */
function counted(counts: GcCounts, added: Partial<GcResult>): GcCounts {
  const add = (key: keyof GcResult): bigint => counts[key] + BigInt(added[key] ?? 0);
  return {
    deletedObjects: add('deletedObjects'),
    deletedPartials: add('deletedPartials'),
    retainedObjects: add('retainedObjects'),
    skippedYoung: add('skippedYoung'),
    bytesFreed: add('bytesFreed'),
    deletedRuns: add('deletedRuns'),
    deletedExecutions: add('deletedExecutions'),
  };
}

/**
 * Reads a part of a run: a list of hashes, or of shards.
 *
 * @throws {Error} When the part is gone: the run was deleted, or given up.
 */
async function readRunPart(storage: StorageBackend, repo: string, run: string, name: string): Promise<string[]> {
  const data = await storage.repos.gcRunRead(repo, run, name);
  if (data === null) throw new Error(`gc run ${run} has lost its ${name}: start gc again`);
  return decodeHashes(data);
}

/** The first step: the history pruned, and the roots it kept kept. */
async function startRun(storage: StorageBackend, repo: string, options: GcStepOptions, now: number): Promise<GcStepResult> {
  const dryRun = options.dryRun ?? false;
  const history = await pruneHistory(storage, repo, {
    keepRuns: options.keepRuns ?? DEFAULT_KEEP_RUNS,
    keepDays: options.keepDays ?? DEFAULT_KEEP_DAYS,
    dryRun,
  }, now);
  const run = uuidv7();
  await storage.repos.gcRunWrite(repo, run, ROOTS_PART, encodeHashes([...history.roots]));
  const result = counted(ZERO_COUNTS, { deletedRuns: history.deletedRuns, deletedExecutions: history.deletedExecutions });
  return stepped(variant('mark', { run, dryRun, result }));
}

/** The reached objects, in shards by the first two hex digits of each hash:
 *  those a store holds. */
function shardsOf(reachable: ReadonlySet<string>): Map<string, string[]> {
  const shards = new Map<string, string[]>();
  for (const hash of reachable) {
    if (!isObjectHash(hash)) continue; // names no object a store holds
    const prefix = hash.slice(0, 2);
    const shard = shards.get(prefix);
    if (shard === undefined) shards.set(prefix, [hash]);
    else shard.push(hash);
  }
  return shards;
}

/** The first mark step: from every root the run kept. */
async function markRun(storage: StorageBackend, repo: string, fields: GcRunAt<'mark'>, options: GcStepOptions): Promise<GcStepResult> {
  const roots = await collectAllRoots(storage.repos, repo, await readRunPart(storage, repo, fields.run, ROOTS_PART));
  return markOn(storage, repo, fields, 0, new Map(), new Set(), [...roots], options);
}

/** A mark step that goes on from what the generation its step names kept. */
async function markingRun(
  storage: StorageBackend,
  repo: string,
  { run, dryRun, result, generation }: GcRunAt<'marking'>,
  options: GcStepOptions,
): Promise<GcStepResult> {
  const kept = Number(generation);
  const shards = new Map<string, string>();
  const reachable = new Set<string>();
  for (const shard of await readRunPart(storage, repo, run, markingPart(kept))) shards.set(prefixOf(shard), shard);
  await eachAtMost([...shards.values()], OBJECT_CONCURRENCY, async (shard) => {
    for (const hash of await readRunPart(storage, repo, run, shardPart(shard))) reachable.add(hash);
  });
  const pending = await readRunPart(storage, repo, run, frontierPart(kept));
  return markOn(storage, repo, { run, dryRun, result }, kept, shards, reachable, pending, options);
}

/**
 * Marks, header-first, from what is left to visit, for as long as the step
 * may, and keeps what it reached as a generation of the run's parts of its
 * own: the shards that changed, and, while the mark is not whole, what it has
 * still to visit and the list of every shard. Once the mark is whole, the
 * shards' list is kept last, so a sweep finds the mark whole or refuses.
 *
 * @param generation - The generation the step starts from: 0 for the first
 * @param shards - Each prefix's shard as that generation kept it, by id
 */
async function markOn(
  storage: StorageBackend,
  repo: string,
  { run, dryRun, result }: GcRunAt<'mark'>,
  generation: number,
  shards: ReadonlyMap<string, string>,
  reachable: Set<string>,
  pending: string[],
  options: GcStepOptions,
): Promise<GcStepResult> {
  const began = Date.now();
  const markMs = options.markMs;
  const before = new Map([...shardsOf(reachable)].map(([prefix, hashes]) => [prefix, hashes.length]));
  const { readObject, readHead } = gcObjectReaders(storage, repo);
  const whole = await markFrom(readObject, reachable, pending, {
    readHead,
    ...(options.concurrency !== undefined && { concurrency: options.concurrency }),
    ...(markMs !== undefined && { until: () => Date.now() - began >= markMs }),
  });

  // Written under names of this generation's own, beside the last's
  const next = generation + 1;
  const kept = new Map(shards);
  const changed = [...shardsOf(reachable)].filter(([prefix, hashes]) => before.get(prefix) !== hashes.length);
  await eachAtMost(changed, OBJECT_CONCURRENCY, ([prefix, hashes]) =>
    storage.repos.gcRunWrite(repo, run, shardPart(`${next}.${prefix}`), encodeHashes(hashes)));
  for (const [prefix] of changed) kept.set(prefix, `${next}.${prefix}`);
  if (whole) {
    await storage.repos.gcRunWrite(repo, run, REACHABLE_PART, encodeHashes([...kept.values()]));
    return stepped(variant('sweep', { run, dryRun, result, cursor: none }));
  }
  await storage.repos.gcRunWrite(repo, run, frontierPart(next), encodeHashes(pending));
  await storage.repos.gcRunWrite(repo, run, markingPart(next), encodeHashes([...kept.values()]));
  return stepped(variant('marking', { run, dryRun, result, generation: BigInt(next) }));
}

/**
 * A page of the sweep: what the mark reached keeps, and has its note cleared;
 * what it did not is noted, unless it was written after the run began; and
 * what has stayed unreachable for the window is deleted, while nothing has
 * written or re-referenced it since.
 */
async function sweepPage(
  storage: StorageBackend,
  repo: string,
  { run, dryRun, result, cursor }: GcRunAt<'sweep'>,
  options: GcStepOptions,
  now: number,
): Promise<GcStepResult> {
  const minAge = options.minAge ?? DEFAULT_MIN_AGE_MS;
  // The run's id was minted as it began, before its mark read any root, and
  // names the millisecond it began in: what is written in a later one was
  // written after the run began
  const after = uuidv7Timestamp(run).getTime() + 1;
  const marked = new Map((await readRunPart(storage, repo, run, REACHABLE_PART)).map((shard) => [prefixOf(shard), shard]));
  const shards = new Map<string, Set<string>>();
  const reached = async (hash: string): Promise<boolean> => {
    const prefix = hash.slice(0, 2);
    const shard = marked.get(prefix);
    if (shard === undefined) return false;
    let hashes = shards.get(prefix);
    if (hashes === undefined) {
      hashes = new Set(await readRunPart(storage, repo, run, shardPart(shard)));
      shards.set(prefix, hashes);
    }
    return hashes.has(hash);
  };

  const scan = await storage.repos.gcScanObjects(repo, cursor.type === 'some' ? cursor.value : undefined);
  let retainedObjects = 0;
  let skippedYoung = 0;
  let deletedObjects = 0;
  let bytesFreed = 0;
  const cleared: string[] = [];
  const unnoted: GcObjectEntry[] = [];
  const expired: { object: GcObjectEntry; since: number }[] = [];
  // Inside the window, or written more recently than the age gate: kept for now
  const decide = (object: GcObjectEntry, since: number): void => {
    if (now - since < options.windowMs || (minAge > 0 && now - object.lastModified < minAge)) skippedYoung++;
    else expired.push({ object, since });
  };
  for (const object of scan.objects) {
    if (await reached(object.hash)) {
      retainedObjects++;
      if (object.unreachableSince !== null) cleared.push(object.hash);
    } else if (object.unreachableSince === null) {
      // Written after the run began, its mark may have missed what roots it:
      // left unnoted, for a later run to note if it is unreachable then, rather
      // than noted now and cleared by the next mark.
      if (object.lastModified >= after) skippedYoung++;
      else unnoted.push(object);
    } else {
      decide(object, object.unreachableSince);
    }
  }
  if (dryRun) {
    // Noted by no dry run: each is inside its window
    skippedYoung += unnoted.length;
  } else {
    if (cleared.length > 0) await storage.repos.gcClearUnreachable(repo, cleared);
    if (unnoted.length > 0) {
      const sinces = await storage.repos.gcNoteUnreachable(repo, unnoted.map(({ hash }) => hash), now);
      unnoted.forEach((object, i) => decide(object, sinces[i] ?? now));
    }
  }
  await eachAtMost(expired, OBJECT_CONCURRENCY, async ({ object, since }) => {
    if (dryRun || await storage.repos.gcDeleteUnreachable(repo, object.hash, since)) {
      deletedObjects++;
      bytesFreed += object.size;
    } else {
      retainedObjects++; // written or re-referenced since it was noted
    }
  });

  const counts = counted(result, { deletedObjects, retainedObjects, skippedYoung, bytesFreed });
  return stepped(scan.cursor === undefined
    ? variant('finish', { run, dryRun, result: counts })
    : variant('sweep', { run, dryRun, result: counts, cursor: some(scan.cursor) }));
}

/** The last step: the adoption memo, the backend's own sweep beside running
 *  work, and the run deleted. */
async function finishRun(
  storage: StorageBackend,
  repo: string,
  { run, dryRun, result }: GcRunAt<'finish'>,
  options: GcStepOptions,
): Promise<GcStepResult> {
  if (!dryRun) await forgetCollectedAdoptions(storage, repo);
  const reachable = new Set<string>();
  for (const shard of await readRunPart(storage, repo, run, REACHABLE_PART)) {
    for (const hash of await readRunPart(storage, repo, run, shardPart(shard))) reachable.add(hash);
  }
  const backend = await storage.repos.gcSweepBackend(repo, reachable, { minAge: options.minAge ?? DEFAULT_MIN_AGE_MS, dryRun, held: false });
  await storage.repos.gcRunDelete(repo, run);
  return { step: null, result: resultOf(counted(result, { deletedPartials: backend.deletedPartials, skippedYoung: backend.skippedYoung })) };
}
