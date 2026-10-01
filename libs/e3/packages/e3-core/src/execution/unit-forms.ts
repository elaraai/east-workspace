/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The units a task runs as, wherever they run.
 *
 * A unit (`UnitType` in `@elaraai/east`) names every file its work needs by a
 * path relative to its directory, and a runner given one does the work,
 * writes its output by the output's kind, and records a result. This module
 * says what those units are: a task object's `run` unit — its program, its
 * inputs and its output kind, with each function and value the kind folds
 * with staged beside them — the `merge` units that assemble what a split
 * task's pieces wrote, a function call's `run` unit, and an `intake` unit. It
 * says, too, which file holds what a unit wrote once it has run, and the
 * `merge` unit a set or a dict needs when it closed several runs.
 *
 * Where a unit's files are is its host's: the local runner stages them in a
 * directory on this machine and runs `exec` over it (`units.ts`), and a
 * browser holds them in memory beside the unit it runs in a worker. A host
 * places each object a unit names by the {@link UnitStage} it gives.
 *
 * @packageDocumentation
 */

import { decodeEastIR, none, some, variant, type EastTypeValue, type Unit, type UnitOutput } from '@elaraai/east';
import type { RunnerValue, TaskObject, TaskOutputKind } from '@elaraai/e3-types';

/** A stock runner's wire variant: one that executes units. */
export type StockRunner = Exclude<RunnerValue, { type: 'custom' }>;

/** The unit's own file in its directory, where a host that keeps files writes
 *  it. */
export const UNIT_FILE = 'unit.beast2';

/** The file a unit's result is recorded in, beside the unit. */
export const UNIT_RESULT_FILE = 'result.beast2';

/** The directory a run unit's emitted output is written to: an array's
 *  manifest directory `<dir>/0.beast2`, or a set's or a dict's runs, one
 *  `<dir>/<n>.beast2` each. */
export const UNIT_OUTPUT_DIR = 'output';

/** The file a run unit's returned value, or a fold's, is written to. */
const OUTPUT_FILE = 'output.beast2';

/** The merge a run unit's output needs when it closed several runs: its unit
 *  file, its result, and the directory its one run is written to. */
export const OUTPUT_MERGE_FILE = 'merge-unit.beast2';
export const OUTPUT_MERGE_RESULT = 'merge-result.beast2';
export const OUTPUT_MERGE_DIR = 'merged';

/** An intake unit's type file, which holds the type its delivery must name,
 *  and the manifest directory it writes the delivery to. */
export const INTAKE_TYPE_FILE = 'type.beast2';
export const INTAKE_OUTPUT_FILE = 'output.beast2';

/**
 * Places an object a unit reads in the unit's directory, under the name the
 * unit names it by: what a host stages a unit's files with.
 *
 * @param name - The file's name, relative to the unit's directory
 * @param hash - The object it holds
 */
export type UnitStage = (name: string, hash: string) => Promise<void>;

/** A unit, and the stock runner that executes it. */
export interface UnitForm {
  /** The unit. */
  readonly unit: Unit;
  /** The runner that executes it. */
  readonly runner: StockRunner;
}

/** Where a unit writes an output of a kind, and the files the kind folds
 *  with — a dict's `merge` function, a fold's `zero` and `combine` — placed
 *  by `stage`. */
async function outputOf(kind: TaskOutputKind, stage: UnitStage): Promise<UnitOutput> {
  const staged = async (name: string, hash: string): Promise<string> => {
    await stage(name, hash);
    return name;
  };
  switch (kind.type) {
    case 'value': return variant('value', OUTPUT_FILE);
    case 'array': return variant('array', UNIT_OUTPUT_DIR);
    case 'set': return variant('set', UNIT_OUTPUT_DIR);
    case 'dict':
      return variant('dict', {
        dir: UNIT_OUTPUT_DIR,
        merge: kind.value.merge.type === 'some' ? some(await staged('merge.beast2', kind.value.merge.value)) : none,
      });
    case 'fold':
      return variant('fold', {
        path: OUTPUT_FILE,
        zero: await staged('zero.beast2', kind.value.zero),
        combine: await staged('combine.beast2', kind.value.combine),
      });
  }
}

/**
 * A task's `run` unit: its program, the files its output kind folds with, and
 * the inputs, read as the task's runner says (its `decode`) — a piece of a
 * split task's as its whole task's are.
 *
 * @remarks
 * The program and the files the kind folds with are placed by `stage`, the
 * files the kind folds with first: a dict's `merge` function, or a fold's
 * `zero` and `combine`.
 *
 * @param task - The task object: an East body, on a stock runner
 * @param inputs - The staged inputs, in the body's parameter order, relative
 *   to the unit's directory
 * @param threads - The threads the runner may use
 * @param fetch - Whether the inputs' segments are left to the host, which
 *   places each as the runner asks for it
 * @param stage - Places each object the unit names
 * @returns The unit, and its runner
 * @throws {Error} When the task's body is a command, or its runner is the
 *   `custom` runtime, which executes no unit.
 */
export async function runUnitOf(
  task: TaskObject,
  inputs: readonly string[],
  threads: number,
  fetch: boolean,
  stage: UnitStage,
): Promise<UnitForm> {
  const runner = task.runner;
  const body = task.body;
  if (body.type !== 'east' || runner.type === 'custom') {
    throw new Error('a run unit runs an East program on a stock runner');
  }
  const output = await outputOf(task.output.kind, stage);
  await stage('program.beast2', body.value.program);
  const unit: Unit = {
    work: variant('run', {
      program: 'program.beast2',
      inputs: [...inputs],
      output,
      decode: runner.value.decode,
    }),
    platforms: runner.value.platforms,
    threads: BigInt(threads),
    fetch,
    result: UNIT_RESULT_FILE,
  };
  return { unit, runner };
}

/**
 * A `merge` unit of a split task: parts its pieces wrote, assembled as its
 * output kind says — a set's or a dict's merged into one run, over the key
 * range when one is given, or a fold's partials folded in order, starting at
 * its `zero` — and the files the kind folds with, placed by `stage`.
 *
 * @param task - The task object: on a stock runner, with a set, dict or fold
 *   output
 * @param parts - The staged parts, in piece order, relative to the unit's
 *   directory
 * @param range - The staged key range, or `null` to merge the parts whole
 * @param threads - The threads the runner may use
 * @param fetch - Whether the parts' segments are left to the host, which
 *   places each as the runner asks for it
 * @param stage - Places each object the unit names
 * @returns The unit, and its runner
 * @throws {Error} When the task's runner is the `custom` runtime, or its output
 *   is a value or an array, whose parts no unit merges.
 */
export async function mergeUnitOf(
  task: TaskObject,
  parts: readonly string[],
  range: string | null,
  threads: number,
  fetch: boolean,
  stage: UnitStage,
): Promise<UnitForm> {
  const runner = task.runner;
  if (runner.type === 'custom') {
    throw new Error('a merge unit runs on a stock runner');
  }
  const kind = task.output.kind;
  if (kind.type === 'value' || kind.type === 'array') {
    throw new Error(`a merge unit assembles a set, dict or fold output, and this task's output is ${kind.type}, whose parts no unit merges`);
  }
  const output = await outputOf(kind, stage);
  const unit: Unit = {
    work: variant('merge', {
      parts: [...parts],
      range: range === null ? none : some(range),
      output,
    }),
    platforms: runner.value.platforms,
    threads: BigInt(threads),
    fetch,
    result: UNIT_RESULT_FILE,
  };
  return { unit, runner };
}

/**
 * A function call's `run` unit: its program and its arguments, read as the
 * runner says (its `decode`), whose output is the value the function returns
 * — one blob, or a collection's manifest directory.
 *
 * @param runner - The stock runner
 * @param program - The program's file, relative to the unit's directory
 * @param inputs - The arguments' files, in the function's parameter order
 * @param output - The file the value is written to
 * @param threads - The threads the runner may use
 * @param fetch - Whether the arguments' segments are left to the host, which
 *   places each as the runner asks for it
 * @returns The unit
 */
export function callUnitOf(
  runner: StockRunner,
  program: string,
  inputs: readonly string[],
  output: string,
  threads: number,
  fetch: boolean,
): Unit {
  return {
    work: variant('run', {
      program,
      inputs: [...inputs],
      output: variant('value', output),
      decode: runner.value.decode,
    }),
    platforms: runner.value.platforms,
    threads: BigInt(threads),
    fetch,
    result: UNIT_RESULT_FILE,
  };
}

/**
 * An `intake` unit: a delivered collection, or a run of its segments, taken
 * in as the manifest directory {@link INTAKE_OUTPUT_FILE}, with the type the
 * delivery must hold in {@link INTAKE_TYPE_FILE} beside it.
 *
 * @param input - The delivery, as the unit names it: where it lies, or staged
 *   beside the unit
 * @param segments - The run of its segments to take in, or `null` for all of
 *   it
 * @param threads - The threads the runner may use
 * @returns The unit
 */
export function intakeUnitOf(input: string, segments: { readonly from: number; readonly to: number } | null, threads: number): Unit {
  return {
    work: variant('intake', {
      input,
      type: INTAKE_TYPE_FILE,
      segments: segments === null ? none : some({ from: BigInt(segments.from), to: BigInt(segments.to) }),
      output: INTAKE_OUTPUT_FILE,
    }),
    platforms: [],
    threads: BigInt(threads),
    // A delivery is one file, placed whole before the unit runs.
    fetch: false,
    result: UNIT_RESULT_FILE,
  };
}

/**
 * Whether a unit writes its output as runs: a `run` unit whose output is a set
 * or a dict, which closes a run each time its RunSorter fills one.
 *
 * @param unit - The unit
 * @returns Whether it writes runs to {@link UNIT_OUTPUT_DIR}
 */
export function emitsRuns(unit: Unit): boolean {
  const work = unit.work;
  return work.type === 'run' && (work.value.output.type === 'set' || work.value.output.type === 'dict');
}

/**
 * The runs a set or dict output closed, in the order they closed: the
 * manifests among the names in {@link UNIT_OUTPUT_DIR}, relative to the unit's
 * directory.
 *
 * @param names - The names in the output directory
 * @returns The runs, in close order
 */
export function outputRunsOf(names: readonly string[]): string[] {
  const runs = names.filter((name) => /^\d+\.beast2$/.test(name));
  return runs.sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).map((name) => `${UNIT_OUTPUT_DIR}/${name}`);
}

/**
 * The `merge` unit a finished run unit's output needs: a set or a dict left in
 * several runs, which the runner merges into one, in {@link OUTPUT_MERGE_DIR}.
 *
 * @remarks
 * A key two runs both hold folds with the dict's merge, or for a set
 * collapses; a dict with no merge refuses it, naming the key, as the RunSorter
 * refuses one within a run. The merge unit names the dict's merge function as
 * the run unit staged it, beside both.
 *
 * @param unit - The run unit, which has run
 * @param runs - The runs it closed, in close order ({@link outputRunsOf})
 * @returns The merge unit, or `null` when the output needs none
 */
export function outputMergeUnitOf(unit: Unit, runs: readonly string[]): Unit | null {
  const work = unit.work;
  if (work.type !== 'run') return null;
  const output = work.value.output;
  if (output.type !== 'set' && output.type !== 'dict') return null;
  if (runs.length < 2) return null;
  return {
    work: variant('merge', {
      parts: [...runs],
      range: none,
      output: output.type === 'set'
        ? variant('set', OUTPUT_MERGE_DIR)
        : variant('dict', { dir: OUTPUT_MERGE_DIR, merge: output.value.merge }),
    }),
    platforms: unit.platforms,
    threads: unit.threads,
    // Its parts are the runs the unit wrote beside it: nothing to fetch.
    fetch: false,
    result: OUTPUT_MERGE_RESULT,
  };
}

/**
 * Where a unit's output is once it has run, and its merge has run if it
 * needed one.
 *
 * - `file`: the file that holds it, relative to the unit's directory — one
 *   blob, or a manifest directory's manifest.
 * - `empty`: a set or a dict that emitted nothing, which is the empty
 *   collection of the type its program's `emit` takes
 *   ({@link emittedCollectionType}), read from `program`.
 */
export type UnitOutputPlace =
  | { readonly file: string }
  | { readonly empty: 'set' | 'dict'; readonly program: string };

/**
 * Where a unit's output is once it has run: a value, an array and a fold are
 * one file the runner wrote; a set or a dict is its one run, or the merge
 * unit's run when it closed several, or nothing when nothing was emitted. A
 * `merge` unit of a split task wrote one run, or the value its partials folded
 * to; an `intake` unit wrote the delivery it took in as a manifest directory.
 *
 * @param unit - The unit, which has run
 * @param runs - The runs a set or dict output closed ({@link outputRunsOf});
 *   none for any other unit
 * @returns Where its output is
 * @throws {Error} When a merge unit's output is neither a set, a dict nor a
 *   fold.
 */
export function unitOutputOf(unit: Unit, runs: readonly string[]): UnitOutputPlace {
  const work = unit.work;
  if (work.type === 'merge') {
    const merged = work.value.output;
    switch (merged.type) {
      case 'set': return { file: `${merged.value}/0.beast2` };
      case 'dict': return { file: `${merged.value.dir}/0.beast2` };
      case 'fold': return { file: merged.value.path };
      default: throw new Error(`a merge unit writes a set, a dict or a fold, not ${merged.type}`);
    }
  }
  // An intake unit writes the delivery as the manifest directory it names.
  if (work.type === 'intake') return { file: work.value.output };
  const output = work.value.output;
  switch (output.type) {
    case 'value': return { file: output.value };
    case 'fold': return { file: output.value.path };
    case 'array': return { file: `${UNIT_OUTPUT_DIR}/0.beast2` };
    case 'set':
    case 'dict':
      if (runs.length > 1) return { file: `${OUTPUT_MERGE_DIR}/0.beast2` };
      if (runs.length === 1) return { file: runs[0]! };
      return { empty: output.type, program: work.value.program };
  }
}

/**
 * The collection a set or dict program emits into: the type its trailing
 * `emit` parameter takes, a Set of its one argument or a Dict of its two.
 *
 * @param program - The program's IR bundle
 * @param kind - The output's kind
 * @returns The collection type
 * @throws {Error} When the bytes do not decode as an East function.
 */
export function emittedCollectionType(program: Uint8Array, kind: 'set' | 'dict'): EastTypeValue {
  const decoded = decodeEastIR(program);
  const signature = (decoded.ir as { value: { type: EastTypeValue } }).value.type.value as { inputs: EastTypeValue[] };
  const emitted = (signature.inputs.at(-1)!.value as { inputs: EastTypeValue[] }).inputs;
  const type = kind === 'set'
    ? variant('Set', emitted[0]!)
    : variant('Dict', { key: emitted[0]!, value: emitted[1]! });
  return type as EastTypeValue;
}
