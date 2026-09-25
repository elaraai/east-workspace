/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A record's bulk operations, as steps.
 *
 * Building an index over a large record is an external sort: every slice of
 * the record emits its entries in the INDEX's order, and those partials have
 * to be merged. That is the fan-in a partitioned task already does — plan the
 * slices, map a program over each, merge the partials through a tree, splice —
 * so a record operation is that same template with the record's primary in
 * place of a task's input blob, and a commit where a task would write a
 * dataset ref.
 *
 * Nothing here is new machinery. The plan comes from `planPartitions`, the
 * slices from `carvePartitionSlices`, the merge shape from `mergeComponents`
 * and `planMergeRanges`, the splice from `spliceBlobs`. Each unit is an
 * ordinary content-addressed execution of a synthesized task — probed in the
 * execution cache and run by whatever `TaskRunner` the caller holds — so a
 * rebuild over an unchanged record re-runs no unit, and a backend that runs
 * units on its own compute needs no record-specific compute path. Such a
 * rebuild is not free once the record fans out: every slice is carved before
 * its unit is probed, so it still reads the whole record and stages every
 * slice.
 *
 * The one thing a record operation ends in that a task does not is the commit,
 * and it stays the caller's: the compare-and-swap loop, the idempotency slot
 * and the reserved-slot rule all live with it, and a second implementation of
 * the commit protocol is exactly what this file exists not to be.
 *
 * @packageDocumentation
 */

import { encodeBeast2For, encodeEastIR, none, variant, type EastIR } from '@elaraai/east';
import {
  TASK_OBJECT_KIND,
  TaskObjectType,
  mergeCommandIr,
  streamCommandIr,
  type RunnerValue,
  type TaskObject,
} from '@elaraai/e3-types';
import { DatasetSegments } from '../dataset-open.js';
import { storeCollection } from '../store-collection.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { TaskExecuteOptions, TaskResult, TaskRunner } from './interfaces.js';
import { carvePartitionSlices, planMergeRanges, planPartitions, spliceBlobs } from './partitionExec.js';
import { mergeComponents, mergeTreeGroups, mergeTreeLevels } from './steps.js';

/** The slice size a record operation aims for, in wire bytes — the knob that
 *  decides how far it fans out. Larger than a task's default: a unit is a
 *  whole process, and an index build over a 150 MB record is meant to be one
 *  unit on a laptop and a handful on a machine with cores to spare. */
export const RECORD_SLICE_BYTES = 256 * 1024 * 1024;

/** What a record operation reads, runs and merges. */
export interface RecordOperation {
  /** The collection every unit reads a slice of, as a stored dataset hash —
   *  a record's primary manifest. */
  over: string;
  /** Hash of the program each slice runs: `(slice, emit) => Null`. */
  bodyIr: string;
  /** Hash of the fold the fan-in merges equal keys with, `(K, V, V) -> V`. */
  mergeIr: string;
  /** The runtime every unit runs on. */
  runner: RunnerValue;
  /** Target carved-slice size in wire bytes; defaults to
   *  {@link RECORD_SLICE_BYTES}. */
  targetBytes?: number;
  /** Runtime-only: cancellation, verbosity, the jobs budget, the pool width. */
  options?: TaskExecuteOptions;
}

/** What a record operation produced, or why it did not. */
export type RecordOperationResult =
  /** The operation's collection, stored as a manifest. */
  | { kind: 'built'; hash: string }
  /** A unit exited non-zero, or the orchestration could not proceed. */
  | { kind: 'failed'; message: string; exitCode: number | null }
  /** The run was aborted. */
  | { kind: 'cancelled' };

/** The most units in flight at once, without a jobs budget or an explicit
 *  pool width. */
const DEFAULT_CONCURRENCY = 4;

/** Why a record operation cannot fan out. */
const CUSTOM_RUNTIME_MESSAGE =
  'a record operation fans out on a stock runtime (east-c, east-node, east-py); this one declares the custom runtime';

/**
 * Runs a record operation: plan the slices, map the program over each, merge
 * the partials, and store the result as a manifest.
 *
 * @remarks
 * A record small enough to plan as one partition runs its single unit over the
 * record itself — the slice would be byte-identical to it, and carving one
 * would only write the same bytes under a second hash.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param runner - What runs the units; its execution cache is what lets a
 *   re-run over an unchanged record run no unit
 * @param operation - What to read, run and merge
 * @returns The stored manifest, or why the operation did not finish
 */
export async function executeRecordOperation(
  storage: StorageBackend,
  repo: string,
  runner: TaskRunner,
  operation: RecordOperation,
): Promise<RecordOperationResult> {
  const options = operation.options ?? {};
  if (operation.runner.type === 'custom') {
    return { kind: 'failed', message: CUSTOM_RUNTIME_MESSAGE, exitCode: null };
  }
  const concurrency = Math.max(1, options.partitionConcurrency ?? options.jobs?.capacity ?? DEFAULT_CONCURRENCY);

  const map = await unitTask(storage, repo, operation.runner,
    streamCommandIr(operation.runner, { emit: 'dict', merge: 'none', stream: 'first' }));

  // ---------------------------------------------------------------------
  // plan
  // ---------------------------------------------------------------------
  let planned: Awaited<ReturnType<typeof planPartitions>>;
  try {
    planned = await planPartitions(storage, repo, {
      primary: operation.over,
      secondaries: [],
      by: null,
      targetBytes: operation.targetBytes ?? RECORD_SLICE_BYTES,
    });
  } catch (err) {
    return { kind: 'failed', message: err instanceof Error ? err.message : String(err), exitCode: null };
  }

  const unit = async (task: { hash: string }, inputs: string[]): Promise<TaskResult> =>
    runner.execute(storage, task.hash, inputs, options);

  // ---------------------------------------------------------------------
  // map — one unit per slice, in a pool
  // ---------------------------------------------------------------------
  if (planned.partitions === 1) {
    const result = await unit(map, [operation.bodyIr, operation.over]);
    const partial = outputOf(result, 'the operation');
    if (typeof partial !== 'string') return partial;
    return store(storage, repo, partial);
  }

  const partials: (string | null)[] = Array.from({ length: planned.partitions }, () => null);
  // Failure is attributed to the LOWEST-index unit that did not succeed, not
  // to whichever worker settled first: the same fan-out must report the same
  // cause on every machine at every pool width.
  const failed = new Failures();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, planned.partitions) }, async () => {
    for (;;) {
      const p = next++;
      if (p >= planned.partitions || failed.any || options.signal?.aborted) return;
      let slice: string;
      try {
        slice = (await carvePartitionSlices(storage, repo, planned.plan, p))[0]!;
      } catch (err) {
        failed.at(p, { kind: 'failed', message: `slice ${p + 1} of ${planned.partitions} could not be carved: ${message(err)}`, exitCode: null });
        return;
      }
      const result = await unit(map, [operation.bodyIr, slice]);
      const output = outputOf(result, `slice ${p + 1} of ${planned.partitions}`);
      if (typeof output !== 'string') {
        failed.at(p, output);
        return;
      }
      partials[p] = output;
    }
  }));
  if (options.signal?.aborted) return { kind: 'cancelled' };
  if (failed.any) return failed.lowest;

  // ---------------------------------------------------------------------
  // reduce — the merge tree of the partitioned fan-in
  // ---------------------------------------------------------------------
  const merge = await unitTask(storage, repo, operation.runner,
    mergeCommandIr(operation.runner, 'function'));
  let groups: { range: string | null; entries: string[] }[];
  try {
    groups = [];
    const hashes = partials.map((hash) => hash!);
    for (const component of (await mergeComponents(storage, repo, hashes)).components) {
      const entries = component.partitions.map((i) => hashes[i]!);
      // A component of one partial is already its own result.
      if (entries.length === 1) {
        groups.push({ range: null, entries });
        continue;
      }
      for (const range of await planMergeRanges(storage, repo, entries, operation.targetBytes ?? RECORD_SLICE_BYTES)) {
        groups.push({ range, entries });
      }
    }
  } catch (err) {
    return { kind: 'failed', message: `the partials could not be merged: ${message(err)}`, exitCode: null };
  }
  // Every partial empty: the operation's collection is empty, and the first
  // partial's header is what an empty one is written under.
  if (groups.length === 0) return store(storage, repo, partials[0]!);

  const levels = mergeTreeLevels(groups.map((group) => group.entries.length));
  for (let level = 1; level <= levels; level++) {
    const runs = groups.map((group) => mergeTreeGroups(group.entries));
    const units = runs.flatMap((groupRuns, group) =>
      groupRuns.flatMap((entries, run) => (entries.length > 1 ? [{ group, run, entries }] : [])));
    const results: (string | null)[] = Array.from({ length: units.length }, () => null);
    const levelFailed = new Failures();
    let nextUnit = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, units.length) }, async () => {
      for (;;) {
        const i = nextUnit++;
        if (i >= units.length || levelFailed.any || options.signal?.aborted) return;
        const { group, entries } = units[i]!;
        const range = groups[group]!.range;
        const result = await unit(merge,
          [operation.mergeIr, ...(range !== null ? [range] : []), ...entries]);
        const output = outputOf(result, `merge unit ${i + 1} of ${units.length} at level ${level} of ${levels}`);
        if (typeof output !== 'string') {
          levelFailed.at(i, output);
          return;
        }
        results[i] = output;
      }
    }));
    if (options.signal?.aborted) return { kind: 'cancelled' };
    if (levelFailed.any) return levelFailed.lowest;

    const nextEntries = runs.map((groupRuns) => groupRuns.map((entries) => entries[0]!));
    units.forEach((u, i) => {
      nextEntries[u.group]![u.run] = results[i]!;
    });
    groups = groups.map((group, g) => ({ range: group.range, entries: nextEntries[g]! }));
  }

  // ---------------------------------------------------------------------
  // splice, then the encoder door
  // ---------------------------------------------------------------------
  const merged = groups.map((group) => group.entries[0]!);
  try {
    return await store(storage, repo, merged.length === 1 ? merged[0]! : await spliceBlobs(storage, repo, merged));
  } catch (err) {
    return { kind: 'failed', message: `the merged partials could not be spliced: ${message(err)}`, exitCode: null };
  }
}

/** The failures of one pool, answering with the lowest-index one — so a
 *  fan-out reports the same cause whatever order its workers settled in. */
class Failures {
  private index = Infinity;
  private result: RecordOperationResult | null = null;

  at(index: number, result: RecordOperationResult): void {
    if (index >= this.index) return;
    this.index = index;
    this.result = result;
  }

  get any(): boolean {
    return this.result !== null;
  }

  get lowest(): RecordOperationResult {
    return this.result!;
  }
}

/** A unit's output hash, or the operation's failure. */
function outputOf(result: TaskResult, what: string): string | RecordOperationResult {
  if (result.cancelled) return { kind: 'cancelled' };
  if (result.state === 'success' && result.outputHash !== undefined) return result.outputHash;
  const detail = result.state === 'failed'
    ? `failed (exit code ${result.exitCode})${result.error ? `: ${result.error}` : ''}`
    : result.state === 'success' ? 'reported success without writing an output' : `errored: ${result.error}`;
  return { kind: 'failed', message: `${what} ${detail}`, exitCode: result.exitCode ?? null };
}

/** Takes the operation's collection through the store's door, so it lands as
 *  segment objects and a manifest like every other collection — a manifest the
 *  door already wrote comes back as it is. */
async function store(storage: StorageBackend, repo: string, hash: string): Promise<RecordOperationResult> {
  try {
    const { typeValue } = await DatasetSegments.open(storage, repo, hash);
    return { kind: 'built', hash: await storeCollection(storage, repo, typeValue, [{ stored: hash }]) };
  } catch (err) {
    return { kind: 'failed', message: `the result could not be stored as segments: ${message(err)}`, exitCode: null };
  }
}

/** An error's message, whatever was thrown. */
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Writes the synthesized task a unit executes: a command body over the staged
 *  inputs, its runtime, and nothing else — a record operation's units have no
 *  dataset of their own and no environment. */
async function unitTask(
  storage: StorageBackend,
  repo: string,
  runnerValue: RunnerValue,
  command: EastIR<[string[], string], string[]>,
): Promise<{ hash: string; task: TaskObject }> {
  const task: TaskObject = {
    kind: TASK_OBJECT_KIND,
    body: variant('command', { commandIr: await storage.objects.write(repo, encodeEastIR(command)) }),
    runner: runnerValue,
    inputs: [],
    output: { path: [], kind: variant('value', null) },
    role: variant('data', null),
    environment: none,
  };
  return { hash: await storage.objects.write(repo, encodeBeast2For(TaskObjectType)(task)), task };
}
