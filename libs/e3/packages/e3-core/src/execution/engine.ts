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
 * a unit the cache serves; nothing is read from earlier runs.
 *
 * A merge is a unit cached like a piece, on the task and its parts. Nothing
 * here decodes a part whole: grouping reads each part's manifest and its last
 * segment, and a range is a small object the merge units read. The pieces, the
 * ranges and the tree come from the inputs and platform constants, never from
 * the pool width, the budget or timing, so a task writes the same bytes on
 * every machine at every `-j`.
 *
 * While the units run, the task's own execution is recorded `running` under
 * this process, with the owner sidecar naming it, and its log names each unit's
 * execution. An aborted run records it `cancelled`, and a failure is the
 * lowest-index failing unit's.
 *
 * @packageDocumentation
 */

import { none, some, variant } from '@elaraai/east';
import {
  UNIT_PLAN_KIND,
  decodeUnitPlan,
  encodeUnitPlan,
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
import { getBootId, getPidStartTime } from './processHelpers.js';
import type { SplitUnit } from './interfaces.js';
import { probeExecutionCache, type ExecuteOptions, type ExecutionIds, type ExecutionResult } from './LocalTaskRunner.js';
import { planPieces, pieceSizes, type PieceSizes } from './pieces.js';
import { mergeComponents, mergeTreeGroups, mergeTreeLevels, planMergeRanges } from './steps.js';
import type { MergeParts } from './units.js';

/** The pool width — the most units in flight at once — of a task run on its
 *  own without a budget. */
const DEFAULT_POOL_WIDTH = 4;

/** The first of a merge unit's inputs as its execution records them — then its
 *  range, when it has one, and its parts — so no merge shares an identity with
 *  a piece of the same task. */
const MERGE_UNIT = 'merge';

/** An error's message. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
 *   largest peak a unit of its stage has reached in the run, or `undefined`
 *   while none has
 * @returns The execution's result
 */
export type UnitExecutor = (
  inputHashes: string[],
  ids: ExecutionIds,
  merge: MergeParts | null,
  expectedPeakBytes: number | undefined,
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
  if (stage.type === 'pieces') return stage.value.map((inputs) => ({ inputs: [...inputs], merge: null }));
  return stage.value.groups.flatMap((group) => {
    const range = group.range.type === 'some' ? group.range.value : null;
    return mergeTreeGroups(group.entries)
      .filter((entries) => entries.length >= 2)
      .map((entries) => ({ inputs: [MERGE_UNIT, ...(range === null ? [] : [range]), ...entries], merge: { parts: entries, range } }));
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
 * {@link stagePeak}. It reports each unit as it starts and as it settles, and
 * advances the task once every unit it started has settled: to the next stage,
 * or to the task's end. The task's own execution is recorded here: `running`
 * when its first stage starts, and its outcome when it ends, with the largest
 * peak of its units. A task that is one piece runs that unit under its own
 * identity, and records nothing more.
 */
export class SplitTask {
  /** The piece sizes: the pieces' middle size is what a merge range aims for. */
  private sizes!: PieceSizes;
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
   * Whether the stage is measuring: none of its units has settled yet. A
   * driver runs one unit of the stage while it measures, and the rest once
   * that one has settled.
   */
  get measuring(): boolean {
    return this.settled === 0;
  }

  /**
   * The largest peak resident memory, in bytes, a unit of the stage has
   * reached in this run — as its runner reported it, or as the execution
   * record of one the cache served holds it — or `undefined` until one has.
   * Each stage measures afresh: the pieces, and each level of their merges.
   */
  get stagePeak(): number | undefined {
    return this.stagePeakBytes;
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
  ): Promise<SplitTask | ExecutionResult> {
    const split = new SplitTask(storage, repo, taskHash, task, inputHashes, ids, options);
    let stage: UnitPlanStage | null = null;
    // The plan of the stage before the one taken up, which its plan names.
    let previous: string | null = null;
    if (plan !== null) {
      try {
        const named = decodeUnitPlan(await storage.objects.read(repo, plan));
        if (named.task === taskHash && named.inputs === ids.inHash) {
          stage = named.stage;
          previous = named.previous.type === 'some' ? named.previous.value : null;
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
    try {
      split.sizes = pieceSizes();
      if (stage === null) {
        const pieces = await planPieces(storage, repo, task.inputs, inputHashes, split.sizes);
        if (pieces.length === 1) {
          split.current = { plan: null, units: [{ inputs: [...inputHashes], merge: null }], merge: null };
          return split;
        }
        stage = variant('pieces', pieces);
      }
    } catch (err) {
      return split.errorResult(`Failed to plan the task's pieces: ${messageOf(err)}`);
    }
    await split.begin(stage, previous);

    // The task's execution is this process's own work while its units run,
    // recorded `running` under this process with the owner sidecar naming it,
    // so a run that dies here is found interrupted.
    const bootId = await getBootId();
    const pidStartTime = await getPidStartTime(process.pid);
    await storage.refs.executionWrite(repo, taskHash, ids.inHash, ids.executionId, variant('running', {
      executionId: ids.executionId,
      inputHashes,
      startedAt: new Date(ids.startTime),
      pid: BigInt(process.pid),
      pidStartTime: BigInt(pidStartTime),
      bootId,
    }));
    await storage.refs.executionOwnerWrite(repo, taskHash, ids.inHash, ids.executionId, {
      pid: BigInt(process.pid),
      pidStartTime: BigInt(pidStartTime),
      bootId,
    });
    split.running = true;
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
      const line = `${label} ${state} task=${this.taskHash} inputs=${result.inputsHash} execution=${result.executionId} duration=${result.duration}${peak}\n`;
      this.logWrites = this.logWrites.then(async () => {
        try {
          await this.storage.logs.append(this.repo, this.taskHash, this.ids.inHash, this.ids.executionId, 'stdout', line);
        } catch (err) {
          console.warn(`Failed to append the task's log: ${messageOf(err)}`);
        }
      });
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
          for (const range of await planMergeRanges(this.storage, this.repo, parts, this.sizes.target)) {
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
   * recorded `cancelled`, with the cause as the last line of its stderr log.
   *
   * @returns The task's execution
   */
  async cancel(): Promise<ExecutionResult> {
    const cause = "cancelled: e3 stopped the task's units because the run was aborted";
    await this.logWrites;
    try {
      await this.storage.logs.append(this.repo, this.taskHash, this.ids.inHash, this.ids.executionId, 'stderr', `e3: ${cause}\n`);
    } catch (err) {
      console.warn(`Failed to append stderr log: ${messageOf(err)}`);
    }
    await this.finish(variant('cancelled', {
      executionId: this.ids.executionId,
      inputHashes: this.inputHashes,
      startedAt: new Date(this.ids.startTime),
      completedAt: new Date(),
    }));
    return this.ended('error', cause, null, true);
  }

  /**
   * Leaves the task mid-stage, for a run that yields: its execution is
   * recorded `interrupted`, and its plan stays rooted for the run that takes
   * the stage up again. A task that has ended is left as it ended.
   */
  async suspend(): Promise<void> {
    if (!this.running) return;
    await this.logWrites;
    await this.storage.refs.executionWrite(this.repo, this.taskHash, this.ids.inHash, this.ids.executionId, variant('interrupted', {
      executionId: this.ids.executionId,
      inputHashes: this.inputHashes,
      startedAt: new Date(this.ids.startTime),
      completedAt: new Date(),
      pid: BigInt(process.pid),
    }));
  }

  /** Starts a stage: writes its plan, naming the plan of the stage before it,
   *  roots it, and lists its units. */
  private async begin(stage: UnitPlanStage, previous: string | null): Promise<void> {
    const plan = await this.storage.objects.write(this.repo, encodeUnitPlan({
      kind: UNIT_PLAN_KIND,
      task: this.taskHash,
      inputs: this.ids.inHash,
      stage,
      previous: previous === null ? none : some(previous),
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
      return;
    }
    const { level, levels, groups } = stage.value;
    this.phase = this.task.output.kind.type === 'fold' ? 'combine' : 'merge';
    this.levelRuns = groups.map((group) => mergeTreeGroups(group.entries));
    // Each unit's group and run, in the order stageUnits lists the units.
    this.runs = this.levelRuns.flatMap((groupRuns, group) =>
      groupRuns.flatMap((entries, run) => (entries.length < 2 ? [] : [{ group, run }])));
    this.current = { plan, units: stageUnits(stage), merge: { level: Number(level), levels: Number(levels) } };
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

  /** Records the task's outcome, once its log is written, and unroots its
   *  plan. */
  private async finish(status: ExecutionStatus): Promise<void> {
    await this.logWrites;
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

/**
 * Executes a task whose work is split over its inputs on its own: runs each
 * stage's units in a pool, and records the result under the task's own
 * `(taskHash, inputsHash)` identity.
 *
 * @remarks
 * Called by `taskExecute` after its cache probe and task decode. The stage the
 * plan sidecar names is taken up again, so a run that stopped mid-task
 * resumes where it stopped. Every unit is probed in the execution cache here,
 * and run by `execute` only on a miss. A stage's first unit runs alone, and the
 * rest then as many at once as the pool is wide, each expecting to need the
 * largest peak the stage has reached.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param taskHash - Hash of the task object
 * @param task - The task, which {@link isSplitTask}
 * @param inputHashes - The task's input hashes
 * @param ids - The task's execution identity
 * @param options - Execution options
 * @param execute - Runs one unit on a cache miss
 * @returns The task's execution result
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
): Promise<ExecutionResult> {
  let plan: string | null = null;
  try {
    plan = await storage.refs.executionPlanRead(repo, taskHash, ids.inHash);
  } catch {
    // Unreadable: the pieces are planned again.
  }
  const split = await SplitTask.open(storage, repo, taskHash, task, inputHashes, ids, options, plan);
  if (!(split instanceof SplitTask)) return split;
  // The pool width. Under a budget the pool is as wide as its cores, and the
  // budget, not the pool, bounds the runner processes.
  const width = Math.max(1, options.budget?.cores ?? DEFAULT_POOL_WIDTH);
  for (;;) {
    const { units } = split.stage;
    const outcome = await runPool(units.length, width, options.signal, () => !split.measuring, async (index) => {
      const unit = units[index]!;
      split.unitStarted(index);
      const unitHash = inputsHash(unit.inputs);
      const result = (options.force ? null : await probeExecutionCache(storage, repo, taskHash, unitHash))
        ?? await execute(unit.inputs, { inHash: unitHash, executionId: uuidv7(), startTime: Date.now() }, unit.merge, split.stagePeak);
      split.unitSettled(index, result);
      return result;
    });
    const result = await split.advance(outcome.results, outcome.thrown);
    if (result !== null) return result;
  }
}
