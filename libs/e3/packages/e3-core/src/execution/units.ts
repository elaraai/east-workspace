/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The unit builder: a task whose body is an East program, as the units a stock
 * runner's `exec` runs, staged in a directory on this machine.
 *
 * A unit (`UnitType` in `@elaraai/east`) names every file its work needs, and a
 * runner given one does the work, writes its output by the output's kind, and
 * records a result (`UnitResultType`). What each unit is — a task object's
 * `run` unit, the `merge` units that assemble a split task's pieces, a
 * function call's `run` unit, an `intake` unit — and where its output is once
 * it has run are every backend's (`unit-forms.ts`). This module stages them
 * here: each file a unit names, linked into its directory beside the unit's
 * own file. It takes what a task's units wrote into the store through its
 * door: a value or an array as the manifest the runner wrote, a set or a dict
 * from its runs, which a `merge` unit assembles when there are several, and a
 * fold as the value it folded to.
 *
 * Spawning a unit is the caller's: the local runner spawns a process, and
 * another backend runs it wherever it runs units. Every path a unit names is
 * relative to the unit's directory, so a unit and the files it names are a
 * snapshot `exec` replays wherever they are moved together — once its
 * segments are there, for a unit whose host places them as the runner reads
 * them (its `fetch`).
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  EastTypeValueType,
  UnitResultType,
  UnitType,
  decodeBeast2For,
  encodeBeast2For,
  type EastTypeValue,
  type Unit,
  type UnitResult,
} from '@elaraai/east';
import { withRunnerLifeline, type TaskObject } from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/interfaces.js';
import { storeCollection } from '../store-collection.js';
import { storeDatasetFile } from '../store-collection-file.js';
import {
  INTAKE_OUTPUT_FILE,
  INTAKE_TYPE_FILE,
  OUTPUT_MERGE_DIR,
  OUTPUT_MERGE_FILE,
  OUTPUT_MERGE_RESULT,
  UNIT_FILE,
  UNIT_OUTPUT_DIR,
  UNIT_RESULT_FILE,
  callUnitOf,
  emitsRuns,
  emittedCollectionType,
  intakeUnitOf,
  mergeUnitOf,
  outputMergeUnitOf,
  outputRunsOf,
  runUnitOf,
  unitOutputOf,
  type StockRunner,
} from './unit-forms.js';

export type { StockRunner } from './unit-forms.js';

/** The binary each stock runner is. */
const RUNNER_BINARIES: Record<StockRunner['type'], string> = {
  east_node: 'east-node',
  east_py: 'east-py',
  east_c: 'east-c',
};

/** A unit written to disk, ready for a runner's `exec`. */
export interface StagedUnit {
  /** The unit file. */
  readonly file: string;
  /** Where the runner records its result. */
  readonly result: string;
}

/** A unit of a task — its `run` unit, or a `merge` of what its pieces wrote —
 *  staged in its directory. */
export interface TaskUnit extends StagedUnit {
  /** The directory the unit and every file it names are in. */
  readonly dir: string;
  /** The unit, as its file holds it. */
  readonly unit: Unit;
  /** The runner that executes it. */
  readonly runner: StockRunner;
}

/** A path a unit names: relative to the unit's directory, with forward slashes,
 *  which every runtime reads on every platform. */
const unitPath = (dir: string, file: string): string => path.relative(dir, file).split(path.sep).join('/');

/** Links each object a unit names into its directory: a stock runner only
 *  reads what it is given, so every file is a link. */
const linkInto = (storage: StorageBackend, repo: string, dir: string) => async (name: string, hash: string): Promise<void> => {
  await storage.objects.materialize(repo, hash, path.join(dir, name), { link: true });
};

/** Writes a unit's own file into its directory, and names where the runner
 *  records its result. */
async function writeTaskUnit(dir: string, unit: Unit, runner: StockRunner): Promise<TaskUnit> {
  const file = path.join(dir, UNIT_FILE);
  await fs.writeFile(file, encodeBeast2For(UnitType)(unit));
  return { file, result: path.join(dir, UNIT_RESULT_FILE), dir, unit, runner };
}

/**
 * Stages a task's `run` unit in `dir` ({@link runUnitOf}): the program and the
 * files its output kind folds with, and the unit naming them and the staged
 * inputs, read as the task's runner says (its `decode`) — a piece of a split
 * task's as its whole task's are.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param dir - The execution's scratch directory, holding the staged inputs
 * @param task - The task object: an East body, on a stock runner
 * @param inputs - The staged inputs, in the body's parameter order
 * @param threads - The threads the runner may use (`unitThreads`)
 * @param fetch - Whether the inputs' segments were left to a
 *   `SegmentFetcher`, which places each as the runner asks for it
 * @returns The staged unit
 * @throws {Error} When the task's body is a command, or its runner is the
 *   `custom` runtime, which executes no unit.
 */
export async function stageRunUnit(
  storage: StorageBackend,
  repo: string,
  dir: string,
  task: TaskObject,
  inputs: readonly string[],
  threads: number,
  fetch = false,
): Promise<TaskUnit> {
  const { unit, runner } = await runUnitOf(task, inputs.map((input) => unitPath(dir, input)), threads, fetch, linkInto(storage, repo, dir));
  return writeTaskUnit(dir, unit, runner);
}

/**
 * Stages a `merge` unit of a split task in `dir` ({@link mergeUnitOf}): parts
 * its pieces wrote, assembled as its output kind says — a set's or a dict's
 * merged into one run, over the key range when one is given, or a fold's
 * partials folded in order, starting at its `zero` — and the files the kind
 * folds with.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param dir - The execution's scratch directory, holding the staged parts
 * @param task - The task object: on a stock runner, with a set, dict or fold
 *   output
 * @param parts - The staged parts, in piece order
 * @param range - The staged key range, or `null` to merge the parts whole
 * @param threads - The threads the runner may use (`unitThreads`)
 * @param fetch - Whether the parts' segments were left to a
 *   `SegmentFetcher`, which places each as the runner asks for it
 * @returns The staged unit
 * @throws {Error} When the task's runner is the `custom` runtime, or its output
 *   is a value or an array, whose parts no unit merges.
 */
export async function stageMergeUnit(
  storage: StorageBackend,
  repo: string,
  dir: string,
  task: TaskObject,
  parts: readonly string[],
  range: string | null,
  threads: number,
  fetch = false,
): Promise<TaskUnit> {
  const { unit, runner } = await mergeUnitOf(
    task,
    parts.map((part) => unitPath(dir, part)),
    range === null ? null : unitPath(dir, range),
    threads,
    fetch,
    linkInto(storage, repo, dir),
  );
  return writeTaskUnit(dir, unit, runner);
}

/**
 * Stages a function call as a `run` unit in `dir` ({@link callUnitOf}): the
 * unit naming the program and the arguments, written there already and read
 * as the runner says (its `decode`), whose output is the value the function
 * returns — one blob, or a collection's manifest directory.
 *
 * @param dir - The call's scratch directory
 * @param runner - The stock runner
 * @param program - The program's file
 * @param inputs - The arguments' files, in the function's parameter order
 * @param output - The file the value is written to
 * @param threads - The threads the runner may use (`unitThreads`)
 * @param fetch - Whether the arguments' segments were left to a
 *   `SegmentFetcher`, which places each as the runner asks for it
 * @returns The staged unit
 */
export async function stageCallUnit(
  dir: string,
  runner: StockRunner,
  program: string,
  inputs: readonly string[],
  output: string,
  threads: number,
  fetch = false,
): Promise<StagedUnit> {
  const unit = callUnitOf(
    runner,
    unitPath(dir, program),
    inputs.map((input) => unitPath(dir, input)),
    unitPath(dir, output),
    threads,
    fetch,
  );
  const file = path.join(dir, UNIT_FILE);
  await fs.writeFile(file, encodeBeast2For(UnitType)(unit));
  return { file, result: path.join(dir, UNIT_RESULT_FILE) };
}

/** An `intake` unit staged in its directory: where the runner writes the
 *  delivery it takes in. */
export interface IntakeUnit extends StagedUnit {
  /** The manifest directory's manifest: `output.beast2`, its segments in
   *  `output.beast2.segments/`. */
  readonly output: string;
}

/**
 * Stages an `intake` unit in `dir` ({@link intakeUnitOf}): a delivered
 * collection, or a run of its segments, taken in as the manifest directory
 * `output.beast2`, with the type the delivery must hold written beside it.
 *
 * @remarks
 * The delivery is named by its absolute path, where it lies: a runner only
 * reads it.
 *
 * @param dir - The intake's scratch directory
 * @param input - The delivered file
 * @param type - The collection type its header must name
 * @param segments - The run of its segments to take in, or `null` for all of it
 * @param threads - The threads the runner may use (`unitThreads`)
 * @returns The staged unit
 */
export async function stageIntakeUnit(
  dir: string,
  input: string,
  type: EastTypeValue,
  segments: { readonly from: number; readonly to: number } | null,
  threads: number,
): Promise<IntakeUnit> {
  await fs.writeFile(path.join(dir, INTAKE_TYPE_FILE), encodeBeast2For(EastTypeValueType)(type));
  const unit = intakeUnitOf(path.resolve(input), segments, threads);
  const file = path.join(dir, UNIT_FILE);
  await fs.writeFile(file, encodeBeast2For(UnitType)(unit));
  return { file, result: path.join(dir, UNIT_RESULT_FILE), output: path.join(dir, INTAKE_OUTPUT_FILE) };
}

/**
 * The command a stock runner is run by: `east-node`, `east-py` or `east-c`.
 *
 * @param runner - The stock runner
 * @returns Its command
 */
export function runnerCommand(runner: StockRunner): string {
  return RUNNER_BINARIES[runner.type];
}

/**
 * The argv that runs a staged unit: `<runner> exec <unit>`, with the stdin
 * lifeline, and `-v` when the runner should print where the time went.
 *
 * @param runner - The stock runner
 * @param unit - The staged unit
 * @param verbose - Whether the runner prints its timings and peak memory
 * @param command - The command it is run by, when not its own
 * @returns The argv
 */
export function unitArgv(runner: StockRunner, unit: StagedUnit, verbose?: boolean, command = runnerCommand(runner)): string[] {
  return withRunnerLifeline(runner, [command, 'exec', unit.file, ...(verbose ? ['-v'] : [])]);
}

/**
 * Reads the result a runner recorded for a unit.
 *
 * @param unit - The staged unit
 * @returns The result, or `null` when the runner recorded none that reads —
 *   a runner that crashed
 */
export async function readUnitResult(unit: StagedUnit): Promise<UnitResult | null> {
  try {
    return decodeBeast2For(UnitResultType)(await fs.readFile(unit.result));
  } catch {
    return null;
  }
}

/** The runs a set or dict output closed, in the order they closed
 *  ({@link outputRunsOf}): read only of a unit that writes runs, whose
 *  output directory its runner made. */
async function outputRuns(unit: TaskUnit): Promise<string[]> {
  return outputRunsOf(await fs.readdir(path.join(unit.dir, UNIT_OUTPUT_DIR)));
}

/**
 * Stages the `merge` unit a finished run unit's output needs
 * ({@link outputMergeUnitOf}): a set or a dict left in several runs, which the
 * runner merges into one.
 *
 * @remarks
 * A key two runs both hold folds with the dict's merge, or for a set collapses;
 * a dict with no merge refuses it, naming the key, as the RunSorter refuses one
 * within a run.
 *
 * @param unit - The run unit, which has run
 * @returns The merge unit, or `null` when the output needs none
 */
export async function stageOutputMerge(unit: TaskUnit): Promise<StagedUnit | null> {
  if (!emitsRuns(unit.unit)) return null;
  const merge = outputMergeUnitOf(unit.unit, await outputRuns(unit));
  if (merge === null) return null;
  const file = path.join(unit.dir, OUTPUT_MERGE_FILE);
  await fs.writeFile(file, encodeBeast2For(UnitType)(merge));
  return { file, result: path.join(unit.dir, OUTPUT_MERGE_RESULT) };
}

/**
 * Removes what a unit's runners wrote — its output, its result, and the merge
 * its output needed with what that wrote — so the unit runs again from a clean
 * directory, as it does once the guard, or its cgroup's cap, has stopped it: a
 * runner writes its output directories only when they are empty.
 *
 * @param unit - The unit, staged
 */
export async function clearUnitOutput(unit: TaskUnit): Promise<void> {
  const work = unit.unit.work;
  let written: string;
  if (work.type === 'intake') {
    written = work.value.output;
  } else {
    const output = work.value.output;
    written = output.type === 'value' ? output.value
      : output.type === 'fold' ? output.value.path
        : output.type === 'dict' ? output.value.dir
          : output.value;
  }
  for (const name of [written, `${written}.segments`, UNIT_RESULT_FILE, OUTPUT_MERGE_FILE, OUTPUT_MERGE_RESULT, OUTPUT_MERGE_DIR]) {
    await fs.rm(path.join(unit.dir, name), { recursive: true, force: true });
  }
}

/**
 * Takes what a finished unit wrote, merged if it needed a merge, into the
 * store through its door, and returns the output's hash.
 *
 * @remarks
 * A value, an array and a fold are one file the runner wrote — a manifest
 * directory for a collection — and each segment file is linked in as it
 * stands. A set or a dict is its one run, or the merge unit's run when it
 * closed several, or the empty collection when nothing was emitted: the
 * program's `emit` parameter says its type. A `merge` unit of a split task
 * wrote one run, or the value its partials folded to. An `intake` unit wrote
 * the delivery it took in as a manifest directory, as the Writer cut it.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param unit - The unit, which has run, and whose merge has run if it needed
 *   one
 * @returns The output's hash
 * @throws {Error} When an output file is missing or the door refuses it.
 */
export async function storeUnitOutput(storage: StorageBackend, repo: string, unit: TaskUnit): Promise<string> {
  const at = (file: string): string => path.join(unit.dir, file);
  const place = unitOutputOf(unit.unit, emitsRuns(unit.unit) ? await outputRuns(unit) : []);
  if ('file' in place) return storeDatasetFile(storage, repo, at(place.file), { canonical: true });
  return storeCollection(storage, repo, emittedCollectionType(await fs.readFile(at(place.program)), place.empty), []);
}
