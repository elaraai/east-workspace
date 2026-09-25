/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The engine, in process: a task whose work is split over its inputs, run as a
 * unit per piece and assembled by its output kind.
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
 * A merge is a unit cached like a piece, on the task and its parts. Nothing
 * here decodes a part whole: grouping reads each part's manifest and its last
 * segment, and a range is a small object the merge units read. The pieces, the
 * ranges and the tree come from the inputs and platform constants, never from
 * the pool width, the jobs budget or timing, so a task writes the same bytes on
 * every machine at every `-j`.
 *
 * While the units run, the task's own execution is recorded `running` under
 * this process, with the owner sidecar naming it, and its log names each unit's
 * execution. An aborted run records it `cancelled`, and a failure is the
 * lowest-index failing unit's.
 *
 * @packageDocumentation
 */

import { variant, type EastTypeValue } from '@elaraai/east';
import type { ExecutionStatus, TaskObject } from '@elaraai/e3-types';
import { inputsHash } from '../executions.js';
import { uuidv7 } from '../uuid.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { DatasetSegments } from '../dataset-open.js';
import { storeCollection } from '../store-collection.js';
import { getBootId, getPidStartTime } from './processHelpers.js';
import { probeExecutionCache, type ExecuteOptions, type ExecutionIds, type ExecutionResult } from './LocalTaskRunner.js';
import { planPieces, pieceSizes, type PieceSizes } from './pieces.js';
import { planMergeRanges } from './partitionExec.js';
import { mergeComponents, mergeTreeGroups, mergeTreeLevels } from './steps.js';
import type { MergeParts } from './units.js';

/** The pool width — the most units in flight at once — without a jobs budget
 *  or an explicit `partitionConcurrency`. */
const DEFAULT_POOL_WIDTH = 4;

/** The first of a merge unit's inputs as its execution records them — then its
 *  range, when it has one, and its parts — so no merge shares an identity with
 *  a piece of the same task. */
const MERGE_UNIT = 'merge';

/**
 * Runs one unit of a split task on a cache miss, recording its execution under
 * the task and `inputHashes`.
 *
 * @param inputHashes - The unit's inputs as its execution records them: a
 *   piece's inputs, or a merge's
 * @param ids - The execution's identity
 * @param merge - What a merge unit merges, or `null` for a piece
 * @returns The execution's result
 */
export type UnitExecutor = (inputHashes: string[], ids: ExecutionIds, merge: MergeParts | null) => Promise<ExecutionResult>;

/** A unit whose executor or cache probe threw — not the unit's own failure —
 *  with its index in its pool. */
interface ThrownUnit {
  index: number;
  error: unknown;
}

/** How a pool of units ended. */
interface PoolOutcome {
  /** Each unit's result, `undefined` for one that never ran. */
  results: (ExecutionResult | undefined)[];
  /** The units that threw. */
  thrown: ThrownUnit[];
}

/**
 * Runs `count` units, at most `width` at once. The pool takes no unit after one
 * fails or throws, or once `signal` aborts, and waits for the units in flight,
 * so none runs on after the task's execution has ended.
 *
 * @param count - The number of units
 * @param width - The most units in flight at once
 * @param signal - The run's abort signal
 * @param unit - Runs unit `index`
 * @returns How the pool ended
 */
async function runPool(
  count: number,
  width: number,
  signal: AbortSignal | undefined,
  unit: (index: number) => Promise<ExecutionResult>,
): Promise<PoolOutcome> {
  const results: (ExecutionResult | undefined)[] = Array.from({ length: count }, () => undefined);
  const thrown: ThrownUnit[] = [];
  let next = 0;
  let stopped = false;
  await Promise.all(Array.from({ length: Math.min(width, count) }, async () => {
    for (;;) {
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
  }));
  return { results, thrown };
}

/**
 * Executes a task whose work is split over its inputs: plans its pieces, runs a
 * unit per piece, and assembles their outputs by the task's output kind,
 * recording the result under the task's own `(taskHash, inputsHash)` identity.
 *
 * @remarks
 * Called by `taskExecute` after its cache probe and task decode. Every unit is
 * probed in the execution cache here, and run by `execute` only on a miss. A
 * plan of one piece runs that unit under the task's own identity and inputs,
 * since the piece is the input itself.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param taskHash - Hash of the task object
 * @param task - The task: an East body on a stock runner, with an emitted
 *   output and a partitioned input
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
  const { inHash, executionId, startTime } = ids;
  const progress = options.onPartitionProgress;
  const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

  // The task's log: one stdout line per unit, appended when the unit's result
  // is known and naming the unit's execution in full, so its own logs can be
  // opened. Appends run one at a time, and a record waits for them.
  let logWrites: Promise<void> = Promise.resolve();
  const logUnit = (label: string, result: ExecutionResult): void => {
    const state = result.cancelled ? 'cancelled' : result.cached ? 'cached' : result.state === 'success' ? 'completed' : 'failed';
    const line = `${label} ${state} task=${taskHash} inputs=${result.inputsHash} execution=${result.executionId} duration=${result.duration}\n`;
    logWrites = logWrites.then(async () => {
      try {
        await storage.logs.append(repo, taskHash, inHash, executionId, 'stdout', line);
      } catch (err) {
        console.warn(`Failed to append the task's log: ${message(err)}`);
      }
    });
  };
  const record = async (status: ExecutionStatus): Promise<void> => {
    await logWrites;
    await storage.refs.executionWrite(repo, taskHash, inHash, executionId, status);
  };
  const ended = (state: 'failed' | 'error', error: string, exitCode: number | null, cancelled: boolean): ExecutionResult => ({
    inputsHash: inHash,
    executionId,
    cached: false,
    state,
    outputHash: null,
    exitCode,
    duration: Date.now() - startTime,
    error,
    cancelled,
  });
  /** Records a unit's own failure as the task's `failed`. */
  const failedResult = async (exitCode: number | null, error: string): Promise<ExecutionResult> => {
    await record(variant('failed', {
      executionId,
      inputHashes,
      startedAt: new Date(startTime),
      completedAt: new Date(),
      exitCode: BigInt(exitCode ?? -1),
    }));
    return ended('failed', error, exitCode, false);
  };
  const errorResult = async (error: string): Promise<ExecutionResult> => {
    await record(variant('error', {
      executionId,
      inputHashes,
      startedAt: new Date(startTime),
      completedAt: new Date(),
      message: error,
    }));
    return ended('error', error, null, false);
  };
  /** Records the task stopped because the run was aborted, with the cause as
   *  the last line of its stderr log. */
  const cancelledResult = async (): Promise<ExecutionResult> => {
    const cause = "cancelled: e3 stopped the task's units because the run was aborted";
    await logWrites;
    try {
      await storage.logs.append(repo, taskHash, inHash, executionId, 'stderr', `e3: ${cause}\n`);
    } catch (err) {
      console.warn(`Failed to append stderr log: ${message(err)}`);
    }
    await record(variant('cancelled', {
      executionId,
      inputHashes,
      startedAt: new Date(startTime),
      completedAt: new Date(),
    }));
    return ended('error', cause, null, true);
  };
  /** A unit that did not succeed, as the task's result. */
  const unitResult = (what: string, unit: ExecutionResult): Promise<ExecutionResult> => {
    const detail = unit.state === 'failed'
      ? `failed (exit code ${unit.exitCode})${unit.error ? `: ${unit.error}` : ''}`
      // A unit reaching here in the success state wrote no output — an
      // executor's broken promise rather than a failure it reported — so it is
      // named for what it is.
      : unit.state === 'success'
        ? 'reported success without writing an output'
        : `errored: ${unit.error}`;
    return unit.state === 'failed' ? failedResult(unit.exitCode, `${what} ${detail}`) : errorResult(`${what} ${detail}`);
  };
  /**
   * The hashes a pool's units wrote; or the task's execution, ended by an abort
   * or by the pool's lowest-index failing unit. A unit that threw ends it
   * `error`, naming the lowest-index one, whose error is then rethrown.
   */
  const settle = async (outcome: PoolOutcome, describe: (index: number) => string): Promise<string[] | ExecutionResult> => {
    if (outcome.thrown.length > 0) {
      const unit = outcome.thrown.reduce((lowest, thrown) => (thrown.index < lowest.index ? thrown : lowest));
      try {
        await errorResult(`${describe(unit.index)} could not run: ${message(unit.error)}`);
      } catch {
        // The record cannot be written either: the unit's own error stands.
      }
      throw unit.error;
    }
    if (options.signal?.aborted || outcome.results.some((result) => result?.cancelled)) return cancelledResult();
    const failed = outcome.results.findIndex((result) => result !== undefined && (result.state !== 'success' || result.outputHash === null));
    if (failed >= 0) return unitResult(describe(failed), outcome.results[failed]!);
    return outcome.results.map((result) => result!.outputHash!);
  };

  // Every unit is probed in the execution cache here, and run only on a miss.
  const runUnit = async (unitInputs: string[], merge: MergeParts | null): Promise<ExecutionResult> => {
    const unitHash = inputsHash(unitInputs);
    if (!options.force) {
      const cached = await probeExecutionCache(storage, repo, taskHash, unitHash);
      if (cached !== null) return cached;
    }
    return execute(unitInputs, { inHash: unitHash, executionId: uuidv7(), startTime: Date.now() }, merge);
  };
  // The pool width. Under a jobs budget the pool is as wide as the budget,
  // which, not the pool, bounds the runner processes.
  const width = Math.max(1, options.partitionConcurrency ?? options.jobs?.capacity ?? DEFAULT_POOL_WIDTH);

  /** Merges each group's entries through a tree of merge units, a level at a
   *  time, and resolves with each group's result; or with the task's
   *  execution, ended by an abort or a failure. */
  const mergeTree = async (
    groups: readonly { range: string | null; entries: string[] }[],
    phase: 'merge' | 'combine',
  ): Promise<string[] | ExecutionResult> => {
    let current = groups;
    const levels = mergeTreeLevels(current.map((group) => group.entries.length));
    for (let level = 1; level <= levels; level++) {
      const runs = current.map((group) => mergeTreeGroups(group.entries));
      const units = runs.flatMap((groupRuns, group) =>
        groupRuns.flatMap((entries, run) => (entries.length > 1 ? [{ group, run, entries }] : [])));
      let done = 0;
      const outcome = await runPool(units.length, width, options.signal, async (index) => {
        const { group, entries } = units[index]!;
        const range = current[group]!.range;
        progress?.({ phase, index, total: units.length, completed: done, state: 'started' });
        const result = await runUnit([MERGE_UNIT, ...(range === null ? [] : [range]), ...entries], { parts: entries, range });
        logUnit(`${phase} level ${level}/${levels} unit ${index + 1}/${units.length}`, result);
        if (result.state === 'success') {
          done++;
          progress?.({ phase, index, total: units.length, completed: done, state: 'completed', cached: result.cached, duration: result.duration });
        }
        return result;
      });
      const hashes = await settle(outcome, (index) =>
        `${phase === 'merge' ? 'Merge' : 'Combine'} unit ${index + 1} of ${units.length} at level ${level} of ${levels}`);
      if (!Array.isArray(hashes)) return hashes;
      // The next level's entries: each run's output, or its one entry.
      const next = runs.map((groupRuns) => groupRuns.map((run) => run[0]!));
      units.forEach((unit, index) => {
        next[unit.group]![unit.run] = hashes[index]!;
      });
      current = current.map((group, g) => ({ range: group.range, entries: next[g]! }));
    }
    return current.map((group) => group.entries[0]!);
  };

  // ---------------------------------------------------------------------
  // The pieces.
  // ---------------------------------------------------------------------
  let sizes: PieceSizes;
  let pieces: string[][];
  try {
    sizes = pieceSizes();
    pieces = await planPieces(storage, repo, task.inputs, inputHashes, sizes);
  } catch (err) {
    return errorResult(`Failed to plan the task's pieces: ${message(err)}`);
  }
  if (pieces.length === 1) {
    progress?.({ phase: 'partition', index: 0, total: 1, completed: 0, state: 'started' });
    const result = await execute(inputHashes, ids, null);
    if (result.state === 'success') {
      progress?.({ phase: 'partition', index: 0, total: 1, completed: 1, state: 'completed', cached: result.cached, duration: result.duration });
    }
    return result;
  }

  // Two or more: the task's execution is this process's own work while its
  // units run, recorded `running` under this process with the owner sidecar
  // naming it, so a run that dies here is found interrupted.
  const bootId = await getBootId();
  const pidStartTime = await getPidStartTime(process.pid);
  await record(variant('running', {
    executionId,
    inputHashes,
    startedAt: new Date(startTime),
    pid: BigInt(process.pid),
    pidStartTime: BigInt(pidStartTime),
    bootId,
  }));
  await storage.refs.executionOwnerWrite(repo, taskHash, inHash, executionId, { pid: process.pid, pidStartTime, bootId });

  let done = 0;
  const ran = await runPool(pieces.length, width, options.signal, async (p) => {
    progress?.({ phase: 'partition', index: p, total: pieces.length, completed: done, state: 'started' });
    const result = await runUnit(pieces[p]!, null);
    logUnit(`piece ${p + 1}/${pieces.length}`, result);
    if (result.state === 'success') {
      done++;
      progress?.({ phase: 'partition', index: p, total: pieces.length, completed: done, state: 'completed', cached: result.cached, duration: result.duration });
    }
    return result;
  });
  const outputs = await settle(ran, (p) => `Piece ${p + 1} of ${pieces.length}`);
  if (!Array.isArray(outputs)) return outputs;

  // ---------------------------------------------------------------------
  // The assembly, by the output kind.
  // ---------------------------------------------------------------------
  const kind = task.output.kind.type;
  let outputHash: string;
  if (kind === 'array') {
    try {
      const { typeValue } = await DatasetSegments.open(storage, repo, outputs[0]!);
      outputHash = await storeCollection(storage, repo, typeValue, outputs.map((stored) => ({ stored })));
    } catch (err) {
      return errorResult(`Failed to concatenate the pieces' outputs: ${message(err)}`);
    }
  } else if (kind === 'fold') {
    const folded = await mergeTree([{ range: null, entries: outputs }], 'combine');
    if (!Array.isArray(folded)) return folded;
    outputHash = folded[0]!;
  } else if (kind === 'set' || kind === 'dict') {
    // The outputs whose key ranges overlap merge over key ranges; one whose
    // range overlaps none is its own result.
    let typeValue: EastTypeValue;
    const groups: { range: string | null; entries: string[] }[] = [];
    try {
      const grouped = await mergeComponents(storage, repo, outputs);
      typeValue = grouped.typeValue;
      for (const component of grouped.components) {
        const parts = component.partitions.map((p) => outputs[p]!);
        if (parts.length === 1) {
          groups.push({ range: null, entries: parts });
          continue;
        }
        if (options.signal?.aborted) return await cancelledResult();
        for (const range of await planMergeRanges(storage, repo, parts, sizes.target)) groups.push({ range, entries: parts });
      }
    } catch (err) {
      return errorResult(`Failed to group the pieces' outputs by key range: ${message(err)}`);
    }
    const merged = await mergeTree(groups, 'merge');
    if (!Array.isArray(merged)) return merged;
    try {
      outputHash = merged.length === 1 ? merged[0]! : await storeCollection(storage, repo, typeValue, merged.map((stored) => ({ stored })));
    } catch (err) {
      return errorResult(`Failed to concatenate the merged outputs: ${message(err)}`);
    }
  } else {
    return errorResult('a task whose output is returned runs as one unit, and is never split into pieces');
  }

  await record(variant('success', {
    executionId,
    inputHashes,
    outputHash,
    startedAt: new Date(startTime),
    completedAt: new Date(),
  }));
  return {
    inputsHash: inHash,
    executionId,
    cached: false,
    state: 'success',
    outputHash,
    exitCode: 0,
    duration: Date.now() - startTime,
    error: null,
    cancelled: false,
  };
}
