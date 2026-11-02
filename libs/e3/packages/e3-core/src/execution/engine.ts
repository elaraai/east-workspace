/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The engine: a task whose work is split over its inputs, run as a unit per
 * piece and assembled by its output kind, a stage at a time.
 *
 * The pieces come from `pieces.ts`. Each runs the task's program as a unit of
 * its own, an execution cached on the task and the piece's inputs, so a re-run
 * after an edit runs only the pieces the edit touched. Their outputs are then
 * assembled by the task's output kind:
 *
 * - an array's are concatenated through the store's door, which re-cuts the
 *   seams between them;
 * - a set's or a dict's are grouped where their key ranges overlap. A group of
 *   one is its own result; a larger one is merged by `merge` units over key
 *   ranges of about the pieces' middle size, each range through a tree of units
 *   of a fixed fan-in. The results, disjoint and in key order, are
 *   concatenated;
 * - a fold's partials are folded by `merge` units in piece order, through the
 *   same tree.
 *
 * The units run a stage at a time: the pieces, then each level of the tree.
 * Each stage is a `$plan` object, written as the stage starts and named by the
 * plan sidecar of the task's execution, which roots it for GC until the
 * execution ends. A run that stops mid-task takes the stage up again from its
 * plan, and finds the units that finished in the execution cache. Each plan
 * names the one before it, and the task's `success` record names the last, so
 * gc finds every unit the output was assembled from ({@link stageUnits}).
 * {@link SplitTask} is the stages; the dataflow runs their units beside every
 * other task's, and {@link executeSplitTask} runs them in a pool of its own for
 * a task run on its own.
 *
 * Both run a stage's first unit alone, to measure the stage's peak memory, and
 * the rest once it has settled, each expecting to need the largest peak a unit
 * of the stage has reached in the run, which a local runner reserves from its
 * budget. A peak comes from the unit's runner, or from the execution record of
 * a unit the cache serves. A backend whose units are stopped when they outgrow
 * their share opts out of measuring (`ExecuteOptions.firstWave`): every unit of
 * a stage starts at once, each expecting to need an estimate — the task's
 * previous peak; or, the first time a task runs, what the largest piece holds
 * of its rows decoded, as its program reads them, and for its merges the peak
 * its pieces reached — which the stage's measured peaks take over from.
 *
 * A merge is a unit cached like a piece, on the task and its parts. Nothing
 * here decodes a part whole: grouping reads each part's manifest and its last
 * segment, and a range is a small object the merge units read. The pieces, the
 * ranges and the tree come from the inputs and platform constants, never from
 * the pool width, the budget or timing, so a task writes the same bytes on
 * every machine at every `-j`.
 *
 * While the units run, the task's own execution is recorded `running`, under
 * the owner its driver passes, whose identity its record carries, and its log
 * names each unit's execution. An aborted run records it `cancelled`, for the
 * reason `aborted`; a run that yields leaves it `interrupted`, for the reason
 * `yielded`; and a failure is the lowest-index failing unit's. However it
 * ends, its end is recorded once its log is written and flushed, so a reader
 * that finds the task ended reads its whole log.
 *
 * The engine runs wherever its driver does: it reaches storage through the
 * storage interfaces and runs units through the executor its driver gives, and
 * knows nothing of the process it runs in but the owner its driver names.
 *
 * @packageDocumentation
 */

import {
  SortedMap, SortedSet, compareFor, decodeAsyncEastIR, decodeBeast2ElementsFor, decodeEastIR, none, segmentKeyTypeOf, some, variant, walkIR,
  type AsyncFunctionIR, type FunctionIR,
} from '@elaraai/east';
import { decodedWeightFor } from '@elaraai/east/internal';
import {
  UNIT_PLAN_KIND,
  decodeUnitPlan,
  encodeUnitPlan,
  pathToString,
  type ExecutionOwner,
  type ExecutionStatus,
  type PartitionProgress,
  type TaskObject,
  type UnitPlanGroup,
  type UnitPlanStage,
} from '@elaraai/e3-types';
import { inputsHash } from '../executions.js';
import { uuidv7 } from '../uuid.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { DatasetSegments } from '../dataset-open.js';
import { storeCollection } from '../store-collection.js';
import { probeExecutionCache, type ExecuteOptions, type ExecutionIds, type ExecutionResult } from './cache.js';
import type { ExecutionLiveness, MergeParts, SplitUnit } from './interfaces.js';
import { planPieces, pieceSizes, type PiecePlan, type PieceSizes } from './pieces.js';
import { mergeComponents, mergeTreeGroups, mergeTreeLevels, planMergeRanges } from './steps.js';

/**
 * The identity a split task's own `running` record carries when its driver
 * names no owner: pid 0, which the local judgement of what still runs takes for
 * no process at all.
 */
const NO_OWNER: ExecutionOwner = { pid: 0n, pidStartTime: 0n, bootId: '' };

/** The first of a merge unit's inputs as its execution records them — then its
 *  range, when it has one, and its parts — so no merge shares an identity with
 *  a piece of the same task. */
const MERGE_UNIT = 'merge';

/** An error's message. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** How many manifests a stage's estimate reads at once. */
const ESTIMATE_READS = 16;

/** How many segments of an input are decoded to weigh its rows: its first,
 *  its middle and its last. */
const SAMPLE_SEGMENTS = 3;

/** What a runner holds beside the rows it decodes, in a first run's estimate
 *  of a piece: its runtime and the threads it frames on. */
const RUNNER_BYTES = 64 * 2 ** 20;

/** What a piece whose output is a Set or a Dict buffers of what it emits, in a
 *  first run's estimate: the most a runner's run sorter holds before it
 *  writes a run (`v5/runs.ts`). */
const SORTER_BYTES = 64 * 2 ** 20;

/**
 * The largest peak resident memory a task's latest successful executions
 * recorded — its own, and those of its pieces and merges — or `undefined` when
 * none recorded one, or they cannot be read.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param taskHash - Hash of the task object
 * @returns The peak, in bytes
 */
async function previousPeak(storage: StorageBackend, repo: string, taskHash: string): Promise<number | undefined> {
  let latest: Awaited<ReturnType<StorageBackend['refs']['executionListLatest']>>;
  try {
    latest = await storage.refs.executionListLatest(repo, taskHash);
  } catch {
    return undefined;
  }
  let peak: number | undefined;
  for (const { status } of latest) {
    if (status.type === 'success' && status.value.peakBytes.type === 'some') {
      peak = Math.max(peak ?? 0, Number(status.value.peakBytes.value));
    }
  }
  return peak;
}

/** What a runner's pager keeps of an input it reads by key, at most: its
 *  cache of decoded segments (`v5/SPEC.md`, "The pager's cache"). */
const PAGER_CACHE_BYTES = 256 * 2 ** 20;

/**
 * How a program reads one of its inputs, which is what a runner that opens it
 * lazily holds of it:
 * - `none`: nothing — the program never reads it, or only its size, which its
 *   index gives;
 * - `scan`: a segment at a time — the program only loops over it (`$.for`);
 * - `keyed`: the segments its reads by key or position reach (`get`, `has`
 *   and the like), as many as the runner's pager keeps — the program reads it
 *   so, and may loop over it too;
 * - `whole`: all of it — the program uses it any other way, for which the
 *   runner decodes it whole.
 */
export type InputRead = 'none' | 'scan' | 'keyed' | 'whole';

/** The reads, from the least a runner holds to the most. */
const READS: readonly InputRead[] = ['none', 'scan', 'keyed', 'whole'];

/** The builtins a lazily opened input answers from its index. */
const SIZE_BUILTINS: ReadonlySet<string> = new Set(['DictSize', 'SetSize', 'ArraySize']);

/** The builtins a lazily opened input serves by key or position, decoding
 *  only the segments they reach. */
const KEYED_BUILTINS: ReadonlySet<string> = new Set([
  'DictHas', 'DictGet', 'DictTryGet', 'DictGetOrDefault',
  'SetHas',
  'ArrayHas', 'ArrayGet', 'ArrayTryGet', 'ArrayGetOrDefault',
]);

/**
 * How a program reads each of its first `count` parameters — a task's inputs
 * — found from where each use of it stands in its IR.
 *
 * @remarks
 * A loop over a parameter is a scan; a builtin that takes the parameter as its
 * collection reads none of it when the index answers it (its size) and is a
 * keyed read when the input serves it by key or position. Any other use —
 * passing it on, binding it to another name, any other builtin, which may
 * build as much again — reads it whole, as a runner then decodes it. A
 * closure's capture of it is not a use; what the closure does with it is. A
 * parameter used in several ways is read the most of them.
 *
 * @param program - The program's root function
 * @param count - How many of its parameters are inputs
 * @returns How each input is read, in parameter order
 */
export function inputReads(program: FunctionIR | AsyncFunctionIR, count: number): InputRead[] {
  const names = program.value.parameters.slice(0, count).map((parameter) => parameter.value.name);
  const reads: InputRead[] = names.map(() => 'none');
  walkIR(program.value.body, (node, { parent }) => {
    if (node.type !== 'Variable') return;
    const index = names.indexOf(node.value.name);
    if (index < 0) return;
    let read: InputRead = 'whole';
    if (parent !== null) {
      // The node itself at the place: what is looped over, or the builtin's
      // collection.
      if ((parent.type === 'ForArray' && Object.is(parent.value.array, node))
        || (parent.type === 'ForSet' && Object.is(parent.value.set, node))
        || (parent.type === 'ForDict' && Object.is(parent.value.dict, node))) {
        read = 'scan';
      } else if (parent.type === 'Builtin' && Object.is(parent.value.arguments[0], node)) {
        if (SIZE_BUILTINS.has(parent.value.builtin)) read = 'none';
        else if (KEYED_BUILTINS.has(parent.value.builtin)) read = 'keyed';
      }
    }
    if (READS.indexOf(read) > READS.indexOf(reads[index]!)) reads[index] = read;
  });
  return reads;
}

/**
 * What a row of a stored collection weighs decoded, in bytes: the decoded
 * weight of a few of its segments (east's `decodedWeightFor`, by its type —
 * east-c's layout, so in east-c the memory they hold), over their rows.
 *
 * @param opened - The collection
 * @returns The bytes a row weighs decoded; 0 for an empty collection
 */
async function rowWeight(opened: DatasetSegments): Promise<number> {
  const count = opened.segmentCount;
  if (count === 0) return 0;
  const type = opened.typeValue;
  const weigh = decodedWeightFor(type);
  const decode = decodeBeast2ElementsFor(type);
  const keyType = segmentKeyTypeOf(type);
  const compare = keyType === null ? null : compareFor(keyType) as (a: unknown, b: unknown) => number;
  let weight = 0;
  let rows = 0;
  const picks = [...new Set(Array.from({ length: SAMPLE_SEGMENTS }, (_, i) => Math.floor(i * (count - 1) / Math.max(1, SAMPLE_SEGMENTS - 1))))];
  for (const seg of picks) {
    const elements: unknown[] = [];
    for await (const element of decode([await opened.segment(seg)])) elements.push(element);
    // The segment as the pager keeps it: a container of its rows.
    const container = type.type === 'Set' ? new SortedSet(elements, compare!)
      : type.type === 'Dict' ? new SortedMap(elements as [unknown, unknown][], compare!)
        : elements;
    weight += weigh(container);
    rows += elements.length;
  }
  return rows === 0 ? 0 : weight / rows;
}

/**
 * Whether a task's work is split over its inputs, and so runs on the engine: an
 * East body on a stock runner, emitting its output, with an input
 * `e3.partition` marks.
 *
 * @param task - The task object
 * @returns Whether the task runs on the engine
 */
export function isSplitTask(task: TaskObject): boolean {
  return task.body.type === 'east' && task.runner.type !== 'custom' && task.output.kind.type !== 'value'
    && task.inputs.some((input) => input.partition.type === 'some');
}

/**
 * Runs one unit of a split task on a cache miss, recording its execution under
 * the task and `inputHashes`.
 *
 * @param inputHashes - The unit's inputs as its execution records them: a
 *   piece's inputs, or a merge's
 * @param ids - The execution's identity
 * @param merge - What a merge unit merges, or `null` for a piece
 * @param expectedPeakBytes - The memory the unit is expected to need: the
 *   largest peak a unit of its stage has reached in the run, or its stage's
 *   estimate; `undefined` while there is neither
 * @param own - Whether the unit is the task's own execution (see
 *   {@link SplitUnit.own}), which its record then does not call a unit
 * @param guessed - Whether `expectedPeakBytes` is a guess from what the
 *   unit holds of its rows decoded, which no run of its program measured
 *   ({@link SplitTask.stagePeakGuessed})
 * @returns The execution's result
 */
export type UnitExecutor = (
  inputHashes: string[],
  ids: ExecutionIds,
  merge: MergeParts | null,
  expectedPeakBytes: number | undefined,
  own: boolean,
  guessed?: boolean,
) => Promise<ExecutionResult>;

/**
 * The units of a stage, in index order: a unit per piece, over its inputs; or,
 * for a merge level, a unit per run of a group's entries that holds two or
 * more, in group order. A run of one passes through to the next level.
 *
 * @remarks
 * A unit's execution is cached on the task and `inputsHash(unit.inputs)`, so
 * this is what a unit's identity is made from, for the drivers and for gc.
 *
 * @param stage - The stage, as its `$plan` holds it
 * @returns The stage's units
 */
export function stageUnits(stage: UnitPlanStage): SplitUnit[] {
  if (stage.type === 'pieces') return stage.value.map((inputs) => ({ inputs: [...inputs], merge: null, own: false }));
  return stage.value.groups.flatMap((group) => {
    const range = group.range.type === 'some' ? group.range.value : null;
    return mergeTreeGroups(group.entries)
      .filter((entries) => entries.length >= 2)
      .map((entries) => ({ inputs: [MERGE_UNIT, ...(range === null ? [] : [range]), ...entries], merge: { parts: entries, range }, own: false }));
  });
}

/** A unit whose executor or cache probe threw — not the unit's own failure —
 *  with its index in its stage. */
export interface ThrownUnit {
  readonly index: number;
  readonly error: unknown;
}

/** A stage of a split task: units that run in any order, as many at once as
 *  the driver allows. */
export interface SplitStage {
  /** The stage's `$plan` object; `null` for a task that is one piece, whose
   *  one unit is the task's own execution. */
  readonly plan: string | null;
  /** The units, in index order: the order a failure is attributed in. */
  readonly units: readonly SplitUnit[];
  /** The merge level, from 1, and the number of levels the merges take;
   *  `null` for the pieces. */
  readonly merge: { readonly level: number; readonly levels: number } | null;
}

/**
 * A task whose work is split over its inputs, as the stages its units run in.
 *
 * @remarks
 * A driver opens the task and runs the stage's units, each probed in the
 * execution cache first unless the run is forced: one alone while the stage is
 * {@link measuring}, and then the rest, each expecting to need
 * {@link stagePeak}. A stage that starts with an estimate
 * (`ExecuteOptions.firstWave`) does not measure: all its units may start. It
 * reports each unit as it starts and as it settles, and advances the task
 * once every unit it started has settled: to the next stage,
 * or to the task's end. The task's own execution is recorded here: `running`
 * when its first stage starts, and its outcome when it ends, with the largest
 * peak of its units. A task that is one piece runs that unit under its own
 * identity, and records nothing more.
 */
export class SplitTask {
  /** The sizes the pieces were cut at, whose middle size a merge range aims
   *  for; `null` for a stage taken up from a plan, until a merge needs them. */
  private sizes: PieceSizes | null = null;
  /** The partitioned inputs the planning opened, by position, which the first
   *  run's estimate reads rather than decode their manifests again; none for
   *  a stage taken up from a plan. */
  private opened: ReadonlyMap<number, DatasetSegments> = new Map();
  /** The stage in progress, as its units see it. */
  private current!: SplitStage;
  /** The stage in progress, as its plan holds it; `null` for one piece. */
  private planned: UnitPlanStage | null = null;
  /** For each unit of a merge level, the group and the run of it it merges. */
  private runs: { group: number; run: number }[] = [];
  /** The level's groups, split into the runs its units merge. */
  private levelRuns: string[][][] = [];
  /** The phase the stage's units report their progress in. */
  private phase: PartitionProgress['phase'] = 'partition';
  /** The units of the stage that succeeded. */
  private done = 0;
  /** Whether the sidecar names a plan this task wrote, to clear when it ends. */
  private rooted = false;
  /** Whether the task's own execution is recorded `running`: from its first
   *  stage until it ends. */
  private running = false;
  /** The task's log appends, one at a time: a record waits for them. */
  private logWrites: Promise<void> = Promise.resolve();
  /** Whether the task took up a stage a plan named, rather than planning its
   *  pieces. */
  private tookUp = false;
  /** The units of the stage that settled, however they ended. */
  private settled = 0;
  /** The largest peak a unit of the stage has reached, in bytes. */
  private stagePeakBytes: number | undefined;
  /** The task's previous peak, in bytes — the largest among its latest
   *  successful executions — read once when the task opens to start its
   *  stages with an estimate; `undefined` when none recorded one. */
  private previousPeak: number | undefined;
  /** What the stage expects each unit to need before any has settled, and
   *  where that came from: the task's previous peak; what the largest piece
   *  holds of its rows decoded; or, for a merge level, the peak the task's
   *  units have reached in this run. `null` for a stage that measures. */
  private estimate: { readonly bytes: number; readonly from: 'previous' | 'rows' | 'run' } | null = null;
  /** The largest peak any unit of the task has reached, in bytes: the one its
   *  own execution records. */
  private peakBytes: number | undefined;

  private constructor(
    private readonly storage: StorageBackend,
    private readonly repo: string,
    private readonly taskHash: string,
    private readonly task: TaskObject,
    private readonly inputHashes: string[],
    private readonly ids: ExecutionIds,
    private readonly options: ExecuteOptions,
    /** The owner the task's own execution is recorded under, whose identity
     *  its `running` and `interrupted` records carry. */
    private readonly owner: ExecutionOwner | null,
  ) {}

  /** The stage in progress. */
  get stage(): SplitStage {
    return this.current;
  }

  /** Whether the task took up a stage a `$plan` named, rather than planning
   *  its pieces. */
  get resumed(): boolean {
    return this.tookUp;
  }

  /**
   * Whether the stage is measuring: none of its units has settled yet, and it
   * started with no estimate. A driver runs one unit of the stage while it
   * measures, and the rest once that one has settled.
   */
  get measuring(): boolean {
    return this.settled === 0 && this.estimate === null;
  }

  /**
   * The memory, in bytes, a unit of the stage is expected to need: the largest
   * peak resident memory a unit of the stage has reached in this run — as its
   * runner reported it, or as the execution record of one the cache served
   * holds it — or the stage's estimate, whichever is larger; `undefined` until
   * there is either. Each stage measures afresh: the pieces, and each level of
   * their merges.
   */
  get stagePeak(): number | undefined {
    if (this.estimate === null) return this.stagePeakBytes;
    // The task's previous peak is the same program's, and only raised; an
    // estimate made in this run gives way to the stage's own peaks.
    if (this.estimate.from === 'previous') return Math.max(this.estimate.bytes, this.stagePeakBytes ?? 0);
    return this.stagePeakBytes ?? this.estimate.bytes;
  }

  /**
   * Whether {@link stagePeak} is a guess from what a piece holds of its rows
   * decoded: the stage started with no peak of the task to go by, and none of
   * its units has reported one yet. A unit is then not capped by what it
   * reserves, since no run of the program measured it.
   */
  get stagePeakGuessed(): boolean {
    return this.estimate?.from === 'rows' && this.stagePeakBytes === undefined;
  }

  /**
   * Opens a split task at its first stage: the stage `plan` names, when it is
   * one of this task's over these inputs, or else its pieces, planned now.
   *
   * @param storage - Storage backend
   * @param repo - Repository identifier
   * @param taskHash - Hash of the task object
   * @param task - The task, which {@link isSplitTask}
   * @param inputHashes - The task's input hashes
   * @param ids - The task's own execution identity
   * @param options - The run's signal and progress callback
   * @param plan - The `$plan` of a stage the task was in, or `null`
   * @param owner - The owner the task's own execution is recorded under while
   *   its stages run: the process that drives them, which a probe finds
   *   exited if the execution cannot finish, or `null` for none, whose
   *   execution is never repaired as interrupted — what a driver passes when no
   *   other process can check its liveness. The execution's `running` record
   *   carries its pid, start time and boot id; pid 0 for none.
   * @returns The task; or its execution, recorded `error`, when its pieces
   *   cannot be planned
   * @throws {Error} When the plan or the task's `running` record cannot be
   *   written.
   */
  static async open(
    storage: StorageBackend,
    repo: string,
    taskHash: string,
    task: TaskObject,
    inputHashes: string[],
    ids: ExecutionIds,
    options: ExecuteOptions,
    plan: string | null,
    owner: ExecutionOwner | null,
  ): Promise<SplitTask | ExecutionResult> {
    const split = new SplitTask(storage, repo, taskHash, task, inputHashes, ids, options, owner);
    if (options.firstWave === 'estimate') split.previousPeak = await previousPeak(storage, repo, taskHash);
    let stage: UnitPlanStage | null = null;
    // The plan of the stage before the one taken up, which its plan names.
    let previous: string | null = null;
    if (plan !== null) {
      try {
        const named = decodeUnitPlan(await storage.objects.read(repo, plan));
        if (named.task === taskHash && named.inputs === ids.inHash) {
          stage = named.stage;
          previous = named.previous.type === 'some' ? named.previous.value : null;
          // The stages before this one reached it; this one adds its own.
          split.peakBytes = named.peakBytes.type === 'some' ? Number(named.peakBytes.value) : undefined;
        } else if (named.task === taskHash && (await storage.refs.executionPlanRead(repo, taskHash, named.inputs)) === plan) {
          // A stage of the task over inputs it no longer has, which nothing
          // takes up again: it is no longer rooted.
          await storage.refs.executionPlanWrite(repo, taskHash, named.inputs, null);
        }
      } catch {
        // Gone, or not a unit plan: the pieces are planned again.
      }
    }
    split.tookUp = stage !== null;
    // The input the pieces are cut over, when they are planned here.
    let cut: PiecePlan | null = null;
    try {
      if (stage === null) {
        cut = await planPieces(storage, repo, task.inputs, inputHashes, pieceSizes, options.signal === undefined ? {} : { signal: options.signal });
        split.sizes = cut.sizes;
        split.opened = cut.opened;
        if (cut.pieces.length === 1) {
          split.current = { plan: null, units: [{ inputs: [...inputHashes], merge: null, own: true }], merge: null };
          return split;
        }
        stage = variant('pieces', cut.pieces);
      }
    } catch (err) {
      // A run aborted while it planned stops between pieces, as it stops
      // between units.
      if (options.signal?.aborted) return split.cancel();
      return split.errorResult(`Failed to plan the task's pieces: ${messageOf(err)}`);
    }
    await split.begin(stage, previous);

    // The task's execution is recorded `running` while its units run, under
    // the owner its driver names, so a run that dies here is found
    // interrupted; with no owner it never is. The owner is written first, so a
    // run that dies between the two writes leaves no `running` record.
    if (owner !== null) {
      await storage.refs.executionOwnerWrite(repo, taskHash, ids.inHash, ids.executionId, owner);
    }
    const identity = owner ?? NO_OWNER;
    await storage.refs.executionWrite(repo, taskHash, ids.inHash, ids.executionId, variant('running', {
      executionId: ids.executionId,
      inputHashes,
      startedAt: new Date(ids.startTime),
      pid: identity.pid,
      pidStartTime: identity.pidStartTime,
      bootId: identity.bootId,
      unit: false,
    }));
    split.running = true;
    // The log says which input the pieces were cut over: the partitioned
    // input that weighs the most, whatever the order it is listed in.
    if (cut !== null) {
      split.log(`plan pieces=${cut.pieces.length} over=${pathToString(task.inputs[cut.primary]!.path)} bytes=${cut.primaryBytes}\n`);
    }
    split.logWave();
    return split;
  }

  /**
   * Reports a unit of the stage started.
   *
   * @param index - The unit's index in the stage
   */
  unitStarted(index: number): void {
    this.options.onPartitionProgress?.({ phase: this.phase, index, total: this.current.units.length, completed: this.done, state: 'started' });
  }

  /**
   * Reports a unit of the stage settled: its peak, toward {@link stagePeak};
   * its line in the task's log, naming its execution and its peak memory when
   * it has one; and its progress when it succeeded.
   *
   * @param index - The unit's index in the stage
   * @param result - The unit's result
   */
  unitSettled(index: number, result: ExecutionResult): void {
    this.settled++;
    if (result.peakBytes !== undefined) {
      this.stagePeakBytes = Math.max(this.stagePeakBytes ?? 0, result.peakBytes);
      this.peakBytes = Math.max(this.peakBytes ?? 0, result.peakBytes);
    }
    const total = this.current.units.length;
    if (this.current.plan !== null) {
      const merge = this.current.merge;
      const label = merge === null ? `piece ${index + 1}/${total}` : `${this.phase} level ${merge.level}/${merge.levels} unit ${index + 1}/${total}`;
      const state = result.cancelled ? 'cancelled' : result.cached ? 'cached' : result.state === 'success' ? 'completed' : 'failed';
      const peak = result.peakBytes === undefined ? '' : ` peak=${result.peakBytes}`;
      this.log(`${label} ${state} task=${this.taskHash} inputs=${result.inputsHash} execution=${result.executionId} duration=${result.duration}${peak}\n`);
    }
    if (result.state === 'success') {
      this.done++;
      this.options.onPartitionProgress?.({
        phase: this.phase, index, total, completed: this.done, state: 'completed', cached: result.cached, duration: result.duration,
      });
    }
  }

  /**
   * Advances the task once every unit of the stage the driver started has
   * settled: to its next stage, or to its end, which is recorded.
   *
   * @param results - Each unit's result, `undefined` for one that never ran
   * @param thrown - The units whose executor or cache probe threw
   * @returns The task's execution when it has ended — by an abort, the
   *   lowest-index failing unit, or its assembled output — or `null` when the
   *   next stage is in {@link stage}
   * @throws The error of the lowest-index unit that threw, once the task's
   *   execution is recorded `error`; or an error writing the next stage's plan.
   */
  async advance(results: readonly (ExecutionResult | undefined)[], thrown: readonly ThrownUnit[]): Promise<ExecutionResult | null> {
    const stage = this.current;
    const describe = (index: number): string => stage.merge === null
      ? `Piece ${index + 1} of ${stage.units.length}`
      : `${this.phase === 'merge' ? 'Merge' : 'Combine'} unit ${index + 1} of ${stage.units.length} at level ${stage.merge.level} of ${stage.merge.levels}`;
    if (stage.plan === null) {
      // One piece: its unit is the task's own execution.
      if (thrown.length > 0) throw thrown[0]!.error;
      return results[0] ?? this.cancel();
    }
    if (thrown.length > 0) {
      const unit = thrown.reduce((lowest, next) => (next.index < lowest.index ? next : lowest));
      try {
        await this.errorResult(`${describe(unit.index)} could not run: ${messageOf(unit.error)}`);
      } catch {
        // The record cannot be written either: the unit's own error stands.
      }
      throw unit.error;
    }
    if (this.options.signal?.aborted || results.some((result) => result?.cancelled)) return this.cancel();
    const failed = results.findIndex((result) => result !== undefined && (result.state !== 'success' || result.outputHash === null));
    if (failed >= 0) {
      const unit = results[failed]!;
      const detail = unit.state === 'failed'
        ? `failed (exit code ${unit.exitCode})${unit.error ? `: ${unit.error}` : ''}`
        // A unit reaching here in the success state wrote no output — an
        // executor's broken promise rather than a failure it reported — so it
        // is named for what it is.
        : unit.state === 'success'
          ? 'reported success without writing an output'
          : `errored: ${unit.error}`;
      return unit.state === 'failed'
        ? this.failedResult(unit.exitCode, `${describe(failed)} ${detail}`)
        : this.errorResult(`${describe(failed)} ${detail}`);
    }
    const outputs = results.map((result) => result!.outputHash!);
    const kind = this.task.output.kind.type;

    // A merge level: the next level's groups are each run's output, or its one
    // entry.
    const planned = this.planned!;
    if (planned.type === 'merge') {
      const next = this.levelRuns.map((groupRuns) => groupRuns.map((run) => run[0]!));
      this.runs.forEach(({ group, run }, index) => {
        next[group]![run] = outputs[index]!;
      });
      const groups: UnitPlanGroup[] = planned.value.groups.map((group, g) => ({ range: group.range, entries: next[g]! }));
      const { level, levels } = planned.value;
      if (level === levels) return this.assembled(groups, groups[0]!.entries[0]!);
      await this.begin(variant('merge', { level: level + 1n, levels, groups }), stage.plan);
      return null;
    }

    // The pieces, assembled by the output kind.
    if (kind === 'array') {
      let outputHash: string;
      try {
        const { typeValue } = await DatasetSegments.open(this.storage, this.repo, outputs[0]!);
        outputHash = await storeCollection(this.storage, this.repo, typeValue, outputs.map((stored) => ({ stored })));
      } catch (err) {
        return this.errorResult(`Failed to concatenate the pieces' outputs: ${messageOf(err)}`);
      }
      return this.successResult(outputHash);
    }
    const groups: UnitPlanGroup[] = [];
    if (kind === 'fold') {
      groups.push({ range: none, entries: outputs });
    } else if (kind === 'set' || kind === 'dict') {
      // The outputs whose key ranges overlap merge over key ranges; one whose
      // range overlaps none is its own result.
      try {
        for (const component of (await mergeComponents(this.storage, this.repo, outputs)).components) {
          const parts = component.partitions.map((p) => outputs[p]!);
          if (parts.length === 1) {
            groups.push({ range: none, entries: parts });
            continue;
          }
          if (this.options.signal?.aborted) return await this.cancel();
          for (const range of await planMergeRanges(this.storage, this.repo, parts, (await this.cutSizes()).target)) {
            groups.push({ range: some(range), entries: parts });
          }
        }
      } catch (err) {
        return this.errorResult(`Failed to group the pieces' outputs by key range: ${messageOf(err)}`);
      }
    } else {
      return this.errorResult('a task whose output is returned runs as one unit, and is never split into pieces');
    }
    const levels = mergeTreeLevels(groups.map((group) => group.entries.length));
    if (levels === 0) return this.assembled(groups, outputs[0]!);
    await this.begin(variant('merge', { level: 1n, levels: BigInt(levels), groups }), stage.plan);
    return null;
  }

  /**
   * Ends the task stopped because the run was aborted: its execution is
   * recorded `cancelled`, for the reason `aborted`, with the cause as the last
   * line of its stderr log.
   *
   * @returns The task's execution
   */
  async cancel(): Promise<ExecutionResult> {
    const cause = "cancelled: e3 stopped the task's units because the run was aborted";
    await this.stoppedLine(cause);
    await this.finish(variant('cancelled', {
      executionId: this.ids.executionId,
      inputHashes: this.inputHashes,
      startedAt: new Date(this.ids.startTime),
      completedAt: new Date(),
      unit: false,
      reason: { kind: variant('aborted', null), message: cause },
    }));
    return this.ended('error', cause, null, true);
  }

  /**
   * Leaves the task mid-stage, for a run that yields, or that another process
   * took up: its execution is recorded `interrupted`, for the reason
   * `yielded`, once the reason is the last line of its stderr log and the log
   * is flushed, and its plan stays rooted for the run that takes the stage up
   * again. A task that has ended is left as it ended.
   *
   * @param by - Why the task is left: the run `yielded`, or another process
   *   took it up (`superseded`), which its log's last line says
   */
  async suspend(by: 'yielded' | 'superseded' = 'yielded'): Promise<void> {
    if (!this.running) return;
    const cause = by === 'yielded'
      ? 'interrupted: the run yielded mid-stage, and a resumed run takes the stage up again'
      : 'interrupted: another process took the run up mid-stage, and takes the stage up again';
    await this.stoppedLine(cause);
    await this.flushLog();
    await this.storage.refs.executionWrite(this.repo, this.taskHash, this.ids.inHash, this.ids.executionId, variant('interrupted', {
      executionId: this.ids.executionId,
      inputHashes: this.inputHashes,
      startedAt: new Date(this.ids.startTime),
      completedAt: new Date(),
      pid: (this.owner ?? NO_OWNER).pid,
      unit: false,
      reason: { kind: variant('yielded', null), message: cause },
    }));
  }

  /** Appends why the task stopped, `e3: <cause>`, as the last line of its
   *  stderr log, after every line the task logged; a line that cannot be
   *  written is warned of, and the task's end is recorded all the same. */
  private async stoppedLine(cause: string): Promise<void> {
    await this.logWrites;
    try {
      await this.storage.logs.append(this.repo, this.taskHash, this.ids.inHash, this.ids.executionId, 'stderr', `e3: ${cause}\n`);
    } catch (err) {
      console.warn(`Failed to append stderr log: ${messageOf(err)}`);
    }
  }

  /** Appends a line to the task's log, after every line before it; a line
   *  that cannot be written is warned of, and the task goes on. */
  private log(line: string): void {
    this.logWrites = this.logWrites.then(async () => {
      try {
        await this.storage.logs.append(this.repo, this.taskHash, this.ids.inHash, this.ids.executionId, 'stdout', line);
      } catch (err) {
        console.warn(`Failed to append the task's log: ${messageOf(err)}`);
      }
    });
  }

  /** Makes the task's log whole for every reader before a record of its end
   *  (`LogStore.flush`); a log that cannot be flushed is warned of, and the
   *  record is written all the same. */
  private async flushLog(): Promise<void> {
    try {
      await this.storage.logs.flush(this.repo, this.taskHash, this.ids.inHash, this.ids.executionId);
    } catch (err) {
      console.warn(`Failed to flush the task's log: ${messageOf(err)}`);
    }
  }

  /** The sizes the pieces were cut at: those the planning found, or, for a
   *  stage taken up from a plan, those the heaviest partitioned input gives,
   *  as the planning weighed it. */
  private async cutSizes(): Promise<PieceSizes> {
    if (this.sizes === null) {
      const weights = await Promise.all(this.task.inputs.flatMap((input, index) => input.partition.type === 'some'
        ? [DatasetSegments.open(this.storage, this.repo, this.inputHashes[index]!).then((opened) => opened.bytes)]
        : []));
      this.sizes = pieceSizes(Math.max(0, ...weights));
    }
    return this.sizes;
  }

  /** Starts a stage: writes its plan, naming the plan of the stage before it
   *  and the largest peak the stages before it reached, roots it, and lists its
   *  units. A plan is made of the stage's outputs and the execution records of
   *  the units before it, so writing it again, as a driver taking up a stage
   *  does, writes the same object. */
  private async begin(stage: UnitPlanStage, previous: string | null): Promise<void> {
    const plan = await this.storage.objects.write(this.repo, encodeUnitPlan({
      kind: UNIT_PLAN_KIND,
      task: this.taskHash,
      inputs: this.ids.inHash,
      stage,
      previous: previous === null ? none : some(previous),
      peakBytes: this.peakBytes === undefined ? none : some(BigInt(this.peakBytes)),
    }));
    await this.storage.refs.executionPlanWrite(this.repo, this.taskHash, this.ids.inHash, plan);
    this.rooted = true;
    this.planned = stage;
    this.done = 0;
    this.settled = 0;
    this.stagePeakBytes = undefined;
    if (stage.type === 'pieces') {
      this.phase = 'partition';
      this.current = { plan, units: stageUnits(stage), merge: null };
    } else {
      const { level, levels, groups } = stage.value;
      this.phase = this.task.output.kind.type === 'fold' ? 'combine' : 'merge';
      this.levelRuns = groups.map((group) => mergeTreeGroups(group.entries));
      // Each unit's group and run, in the order stageUnits lists the units.
      this.runs = this.levelRuns.flatMap((groupRuns, group) =>
        groupRuns.flatMap((entries, run) => (entries.length < 2 ? [] : [{ group, run }])));
      this.current = { plan, units: stageUnits(stage), merge: { level: Number(level), levels: Number(levels) } };
    }
    this.estimate = this.options.firstWave === 'estimate' ? await this.estimateOf(this.current.units) : null;
    // The inputs as planned are read by that estimate alone: their manifests,
    // decoded, are let go rather than held for the run.
    this.opened = new Map();
    // The first stage's line follows the plan's, once the task is running.
    if (this.running) this.logWave();
  }

  /** Says in the task's log what a stage that starts with an estimate expects
   *  each unit to need, and where that came from. */
  private logWave(): void {
    if (this.estimate === null) return;
    const merge = this.current.merge;
    const stage = merge === null ? 'pieces' : `${this.phase} level ${merge.level}/${merge.levels}`;
    this.log(`wave ${stage} units=${this.current.units.length} estimate=${this.estimate.bytes} from=${this.estimate.from}\n`);
  }

  /**
   * What each unit of a stage that starts with an estimate is expected to
   * need: the task's previous peak; or, the first time the task runs, for its
   * pieces what the largest piece holds if it decodes its inputs whole, and
   * for a merge level the largest peak the task's units have reached in this
   * run. `null`, so the stage measures, when there is none, or what a piece
   * weighs cannot be read.
   */
  private async estimateOf(units: readonly SplitUnit[]): Promise<{ bytes: number; from: 'previous' | 'rows' | 'run' } | null> {
    if (this.previousPeak !== undefined) return { bytes: this.previousPeak, from: 'previous' };
    if (this.current.merge !== null) return this.peakBytes === undefined ? null : { bytes: this.peakBytes, from: 'run' };
    try {
      return { bytes: await this.piecesWeight(units), from: 'rows' };
    } catch {
      return null;
    }
  }

  /**
   * What the largest piece holds of its inputs, as its program reads them
   * ({@link inputReads}): an input it only loops over, two segments of it; one
   * it reads by key, the segments its pager keeps, at most; any other, all of
   * its rows — each at what a row of that input weighs decoded
   * ({@link rowWeight}). A value that is not a collection counts at its stored
   * bytes, and the runner's own memory and, for a Set or Dict output, its
   * sorter's buffer are added. A runner that decodes its inputs whole, and a
   * program that cannot be read, read every input whole.
   */
  private async piecesWeight(units: readonly SplitUnit[]): Promise<number> {
    const { task } = this;
    const reads = await this.inputReads();
    /** What an input of `rows` rows of `row` bytes each, in segments of
     *  `segmentRows` rows, holds as it is read. */
    const held = (read: InputRead, rows: number, row: number, segmentRows: number): number => {
      const segments = Math.min(rows, 2 * segmentRows) * row;
      if (read === 'none') return 0;
      if (read === 'scan') return segments;
      if (read === 'keyed') return Math.min(rows * row, PAGER_CACHE_BYTES + segments);
      return rows * row;
    };
    const partitioned: { index: number; read: InputRead; row: number; segmentRows: number }[] = [];
    let shared = RUNNER_BYTES + (task.output.kind.type === 'set' || task.output.kind.type === 'dict' ? SORTER_BYTES : 0);
    for (const [index, input] of task.inputs.entries()) {
      const read = reads[index]!;
      if (read === 'none') continue;
      const hash = this.inputHashes[index]!;
      let opened: DatasetSegments;
      try {
        opened = this.opened.get(index) ?? await DatasetSegments.open(this.storage, this.repo, hash);
      } catch {
        shared += (await this.storage.objects.stat(this.repo, hash)).size;
        continue;
      }
      const row = await rowWeight(opened);
      const segmentRows = opened.elementCount / Math.max(1, opened.segmentCount);
      if (input.partition.type === 'some') partitioned.push({ index, read, row, segmentRows });
      else shared += held(read, opened.elementCount, row, segmentRows);
    }
    let largest = 0;
    // A few manifests at a time: a stage may have hundreds of pieces.
    for (let at = 0; at < units.length; at += ESTIMATE_READS) {
      const weights = await Promise.all(units.slice(at, at + ESTIMATE_READS).map(async (unit) => {
        let bytes = 0;
        for (const { index, read, row, segmentRows } of partitioned) {
          const rows = (await DatasetSegments.open(this.storage, this.repo, unit.inputs[index]!)).elementCount;
          bytes += held(read, rows, row, segmentRows);
        }
        return bytes;
      }));
      largest = Math.max(largest, ...weights);
    }
    return Math.ceil(shared + largest);
  }

  /** How the task's program reads each of its inputs: whole, every one, on a
   *  runner that decodes them so, or when the program cannot be read. */
  private async inputReads(): Promise<InputRead[]> {
    const { task } = this;
    const whole = task.inputs.map((): InputRead => 'whole');
    if (task.body.type !== 'east' || task.runner.type === 'custom' || task.runner.value.decode.type === 'whole') return whole;
    try {
      const bytes = await this.storage.objects.read(this.repo, task.body.value.program);
      let program: FunctionIR | AsyncFunctionIR;
      try {
        program = decodeEastIR(bytes).ir;
      } catch {
        program = decodeAsyncEastIR(bytes).ir;
      }
      return inputReads(program, task.inputs.length);
    } catch {
      return whole;
    }
  }

  /** The task's output once every group has one entry: a fold's one partial,
   *  or a set's or a dict's groups concatenated in key order. */
  private async assembled(groups: readonly UnitPlanGroup[], typeOf: string): Promise<ExecutionResult> {
    const entries = groups.map((group) => group.entries[0]!);
    if (entries.length === 1) return this.successResult(entries[0]!);
    let outputHash: string;
    try {
      const { typeValue } = await DatasetSegments.open(this.storage, this.repo, typeOf);
      outputHash = await storeCollection(this.storage, this.repo, typeValue, entries.map((stored) => ({ stored })));
    } catch (err) {
      return this.errorResult(`Failed to concatenate the merged outputs: ${messageOf(err)}`);
    }
    return this.successResult(outputHash);
  }

  /** Records the task's outcome, once its log is written and flushed, and
   *  unroots its plan. */
  private async finish(status: ExecutionStatus): Promise<void> {
    await this.logWrites;
    await this.flushLog();
    this.running = false;
    await this.storage.refs.executionWrite(this.repo, this.taskHash, this.ids.inHash, this.ids.executionId, status);
    if (this.rooted) {
      await this.storage.refs.executionPlanWrite(this.repo, this.taskHash, this.ids.inHash, null);
      this.rooted = false;
    }
  }

  private ended(state: 'failed' | 'error', error: string, exitCode: number | null, cancelled: boolean): ExecutionResult {
    return {
      inputsHash: this.ids.inHash,
      executionId: this.ids.executionId,
      cached: false,
      state,
      outputHash: null,
      exitCode,
      duration: Date.now() - this.ids.startTime,
      error,
      cancelled,
    };
  }

  /** Records a unit's own failure as the task's `failed`. */
  private async failedResult(exitCode: number | null, error: string): Promise<ExecutionResult> {
    await this.finish(variant('failed', {
      executionId: this.ids.executionId,
      inputHashes: this.inputHashes,
      startedAt: new Date(this.ids.startTime),
      completedAt: new Date(),
      exitCode: BigInt(exitCode ?? -1),
      peakBytes: this.peakBytes === undefined ? none : some(BigInt(this.peakBytes)),
      unit: false,
    }));
    return { ...this.ended('failed', error, exitCode, false), ...(this.peakBytes !== undefined && { peakBytes: this.peakBytes }) };
  }

  private async errorResult(error: string): Promise<ExecutionResult> {
    await this.finish(variant('error', {
      executionId: this.ids.executionId,
      inputHashes: this.inputHashes,
      startedAt: new Date(this.ids.startTime),
      completedAt: new Date(),
      message: error,
      unit: false,
    }));
    return this.ended('error', error, null, false);
  }

  private async successResult(outputHash: string): Promise<ExecutionResult> {
    // The task ends in the stage it ran last, whose plan names those before.
    const plan = this.current.plan;
    await this.finish(variant('success', {
      executionId: this.ids.executionId,
      inputHashes: this.inputHashes,
      outputHash,
      startedAt: new Date(this.ids.startTime),
      completedAt: new Date(),
      peakBytes: this.peakBytes === undefined ? none : some(BigInt(this.peakBytes)),
      plan: plan === null ? none : some(plan),
      unit: false,
    }));
    return {
      inputsHash: this.ids.inHash,
      executionId: this.ids.executionId,
      cached: false,
      state: 'success',
      outputHash,
      exitCode: 0,
      duration: Date.now() - this.ids.startTime,
      error: null,
      cancelled: false,
      ...(this.peakBytes !== undefined && { peakBytes: this.peakBytes }),
    };
  }
}

/** How a pool of units ended. */
interface PoolOutcome {
  /** Each unit's result, `undefined` for one that never ran. */
  results: (ExecutionResult | undefined)[];
  /** The units that threw. */
  thrown: ThrownUnit[];
}

/**
 * Runs `count` units: one at a time until `measured` holds, and then the rest,
 * at most `width` at once. The pool takes no unit after one fails or throws, or
 * once `signal` aborts, and waits for the units in flight, so none runs on
 * after the task's execution has ended.
 *
 * @param count - The number of units
 * @param width - The most units in flight at once
 * @param signal - The run's abort signal
 * @param measured - Whether the stage has measured a unit, so the rest may run
 *   at once
 * @param unit - Runs unit `index`
 * @returns How the pool ended
 */
async function runPool(
  count: number,
  width: number,
  signal: AbortSignal | undefined,
  measured: () => boolean,
  unit: (index: number) => Promise<ExecutionResult>,
): Promise<PoolOutcome> {
  const results: (ExecutionResult | undefined)[] = Array.from({ length: count }, () => undefined);
  const thrown: ThrownUnit[] = [];
  let next = 0;
  let stopped = false;
  /** Runs units until the pool takes no more, or while `probing`, until the
   *  stage has measured a unit. */
  const work = async (probing: boolean): Promise<void> => {
    while (!(probing && measured())) {
      const index = next++;
      if (index >= count || stopped || signal?.aborted) return;
      try {
        const result = await unit(index);
        results[index] = result;
        // A unit e3 stopped because the run was aborted is not a failure.
        if ((result.state !== 'success' || result.outputHash === null) && !result.cancelled) stopped = true;
      } catch (error) {
        thrown.push({ index, error });
        stopped = true;
        return;
      }
    }
  };
  await work(true);
  await Promise.all(Array.from({ length: Math.min(width, count) }, () => work(false)));
  return { results, thrown };
}

/** How a driver runs a split task on its own ({@link executeSplitTask}). */
export interface SplitTaskDriver {
  /** The most units in flight at once, a positive integer. */
  readonly width: number;
  /** The owner the task's own execution is recorded under while its stages
   *  run, or `null` for none (see {@link SplitTask.open}). */
  readonly owner: ExecutionOwner | null;
  /**
   * Whether a unit recorded `running` can still finish, as the runner that
   * started it judges it — its `TaskRunner.executionAlive` — for each unit's
   * probe of the execution cache. A driver whose units run on other hosts
   * passes its runner's, so a unit still running elsewhere is left as it is and
   * handed to the executor, which attaches to it rather than running it again.
   * The root entry's `executeSplitTask` takes it as optional, and judges as the
   * local runner does, on this host, without it.
   */
  readonly executionAlive: ExecutionLiveness;
}

/**
 * Executes a task whose work is split over its inputs on its own: runs each
 * stage's units in a pool, and records the result under the task's own
 * `(taskHash, inputsHash)` identity.
 *
 * @remarks
 * `taskExecute` calls it after its cache probe and task decode, and a remote
 * runner calls it for a task run outside the dataflow — an index build — with
 * an `execute` that runs each unit where it runs. The stage the plan sidecar
 * names is taken up again, so a run that stopped mid-task resumes where it
 * stopped. Every unit is probed in the execution cache here, with the driver's
 * judgement of whether a unit recorded `running` can still finish, and run by
 * `execute` only on a miss: a unit still running on another host is handed to
 * `execute` as it is, never rewritten as interrupted by a host that cannot see
 * it. A stage's first unit runs alone, and the rest then as many at once as
 * the driver's width, each expecting to need the largest peak the stage has
 * reached. The driver holds the task in memory from its first stage to its
 * end; one that cannot drives {@link SplitTask} a step at a time instead.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param taskHash - Hash of the task object
 * @param task - The task, which {@link isSplitTask}
 * @param inputHashes - The task's input hashes
 * @param ids - The task's execution identity
 * @param options - Execution options: the run's signal, progress callback and
 *   `force`
 * @param execute - Runs one unit on a cache miss
 * @param driver - The pool's width, the owner of the task's execution, and
 *   the judgement of whether a unit recorded running can still finish
 * @returns The task's execution result
 * @throws {RangeError} When the width is not a positive integer.
 * @throws The error of the lowest-index unit whose executor or cache probe
 *   threw, once the task's execution is recorded `error`.
 */
export async function executeSplitTask(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  task: TaskObject,
  inputHashes: string[],
  ids: ExecutionIds,
  options: ExecuteOptions,
  execute: UnitExecutor,
  driver: SplitTaskDriver,
): Promise<ExecutionResult> {
  const { width, owner, executionAlive } = driver;
  if (!(Number.isInteger(width) && width >= 1)) {
    throw new RangeError(`width must be a positive integer, got ${width}`);
  }
  let plan: string | null = null;
  try {
    plan = await storage.refs.executionPlanRead(repo, taskHash, ids.inHash);
  } catch {
    // Unreadable: the pieces are planned again.
  }
  const split = await SplitTask.open(storage, repo, taskHash, task, inputHashes, ids, options, plan, owner);
  if (!(split instanceof SplitTask)) return split;
  for (;;) {
    const { units } = split.stage;
    const outcome = await runPool(units.length, width, options.signal, () => !split.measuring, async (index) => {
      const unit = units[index]!;
      split.unitStarted(index);
      const unitHash = inputsHash(unit.inputs);
      const result = (options.force ? null : await probeExecutionCache(storage, repo, taskHash, unitHash, executionAlive))
        ?? await execute(unit.inputs, { inHash: unitHash, executionId: uuidv7(), startTime: Date.now() }, unit.merge, split.stagePeak, unit.own,
          split.stagePeakGuessed);
      split.unitSettled(index, result);
      return result;
    });
    const result = await split.advance(outcome.results, outcome.thrown);
    if (result !== null) return result;
  }
}
