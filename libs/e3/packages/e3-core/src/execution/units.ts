/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The unit builder: a task whose body is an East program, as the units a stock
 * runner's `exec` runs.
 *
 * A unit (`UnitType` in `@elaraai/east`) names every file its work needs, and a
 * runner given one does the work, writes its output by the output's kind, and
 * records a result (`UnitResultType`). This module turns a task object into its
 * `run` unit — the program, the staged inputs and the output kind, with each
 * function and value the kind folds with staged beside them — and, for a task
 * split into pieces, into the `merge` units that assemble what its pieces
 * wrote; and a function call into the `run` unit that returns its value. It
 * takes what a task's units wrote into the store through its door: a
 * value or an array as the manifest the runner wrote, a set or a dict from its
 * runs, which a `merge` unit assembles when there are several, and a fold as
 * the value it folded to.
 *
 * Spawning a unit is the caller's: the local runner spawns a process, and
 * another backend runs it wherever it runs units. Every path a unit names is
 * relative to the unit's directory, so a unit and the files it names are a
 * snapshot `exec` replays wherever they are moved together.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { availableParallelism } from 'node:os';
import {
  UnitResultType,
  UnitType,
  decodeBeast2For,
  decodeEastIR,
  encodeBeast2For,
  none,
  some,
  variant,
  type EastTypeValue,
  type Unit,
  type UnitOutput,
  type UnitResult,
} from '@elaraai/east';
import { withRunnerLifeline, type RunnerValue, type TaskObject } from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/interfaces.js';
import { storeCollection, storeDatasetFile } from '../store-collection.js';

/** A stock runner's wire variant: one that executes units. */
export type StockRunner = Exclude<RunnerValue, { type: 'custom' }>;

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

/** What a `merge` unit of a split task assembles: outputs its pieces wrote. */
export interface MergeParts {
  /** The parts' hashes, in piece order. */
  readonly parts: readonly string[];
  /** The hash of the key range the merge is limited to — `{from, to}` over
   *  the parts' key type, as `planMergeRanges` writes it — or `null` to
   *  merge them whole. */
  readonly range: string | null;
}

/** The file a unit's result is recorded in, beside the unit. */
const RESULT_FILE = 'result.beast2';

/** A path a unit names: relative to the unit's directory, with forward slashes,
 *  which every runtime reads on every platform. */
const unitPath = (dir: string, file: string): string => path.relative(dir, file).split(path.sep).join('/');

/**
 * Stages a task's `run` unit in `dir`: the program and the files its output
 * kind folds with, and the unit naming them and the staged inputs.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param dir - The execution's scratch directory, holding the staged inputs
 * @param task - The task object: an East body, on a stock runner
 * @param inputs - The staged inputs, in the body's parameter order
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
): Promise<TaskUnit> {
  const runner = task.runner;
  if (task.body.type !== 'east' || runner.type === 'custom') {
    throw new Error('a run unit runs an East program on a stock runner');
  }
  // A stock runner only reads what it is given, so every file is a link.
  const stage = async (name: string, hash: string): Promise<string> => {
    await storage.objects.materialize(repo, hash, path.join(dir, name), { link: true });
    return name;
  };
  const kind = task.output.kind;
  let output: UnitOutput;
  switch (kind.type) {
    case 'value': output = variant('value', 'output.beast2'); break;
    case 'array': output = variant('array', 'output'); break;
    case 'set': output = variant('set', 'output'); break;
    case 'dict':
      output = variant('dict', {
        dir: 'output',
        merge: kind.value.merge.type === 'some' ? some(await stage('merge.beast2', kind.value.merge.value)) : none,
      });
      break;
    case 'fold':
      output = variant('fold', {
        path: 'output.beast2',
        zero: await stage('zero.beast2', kind.value.zero),
        combine: await stage('combine.beast2', kind.value.combine),
      });
      break;
  }
  const unit: Unit = {
    work: variant('run', {
      program: await stage('program.beast2', task.body.value.program),
      inputs: inputs.map((input) => unitPath(dir, input)),
      output,
    }),
    platforms: runner.value.platforms,
    // Until scheduling grants cores, a runner sizes its pools to the machine,
    // as it always has.
    threads: BigInt(availableParallelism()),
    result: RESULT_FILE,
  };
  const file = path.join(dir, 'unit.beast2');
  await fs.writeFile(file, encodeBeast2For(UnitType)(unit));
  return { file, result: path.join(dir, RESULT_FILE), dir, unit, runner };
}

/**
 * Stages a `merge` unit of a split task in `dir`: parts its pieces wrote,
 * assembled as its output kind says — a set's or a dict's merged into one run,
 * over the key range when one is given, or a fold's partials folded in order,
 * starting at its `zero` — and the files the kind folds with.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param dir - The execution's scratch directory, holding the staged parts
 * @param task - The task object: on a stock runner, with a set, dict or fold
 *   output
 * @param parts - The staged parts, in piece order
 * @param range - The staged key range, or `null` to merge the parts whole
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
): Promise<TaskUnit> {
  const runner = task.runner;
  if (runner.type === 'custom') {
    throw new Error('a merge unit runs on a stock runner');
  }
  // A stock runner only reads what it is given, so every file is a link.
  const stage = async (name: string, hash: string): Promise<string> => {
    await storage.objects.materialize(repo, hash, path.join(dir, name), { link: true });
    return name;
  };
  const kind = task.output.kind;
  let output: UnitOutput;
  switch (kind.type) {
    case 'set': output = variant('set', 'output'); break;
    case 'dict':
      output = variant('dict', {
        dir: 'output',
        merge: kind.value.merge.type === 'some' ? some(await stage('merge.beast2', kind.value.merge.value)) : none,
      });
      break;
    case 'fold':
      output = variant('fold', {
        path: 'output.beast2',
        zero: await stage('zero.beast2', kind.value.zero),
        combine: await stage('combine.beast2', kind.value.combine),
      });
      break;
    case 'value':
    case 'array':
      throw new Error(`a merge unit assembles a set, dict or fold output, and this task's output is ${kind.type}, whose parts no unit merges`);
  }
  const unit: Unit = {
    work: variant('merge', {
      parts: parts.map((part) => unitPath(dir, part)),
      range: range === null ? none : some(unitPath(dir, range)),
      output,
    }),
    platforms: runner.value.platforms,
    threads: BigInt(availableParallelism()),
    result: RESULT_FILE,
  };
  const file = path.join(dir, 'unit.beast2');
  await fs.writeFile(file, encodeBeast2For(UnitType)(unit));
  return { file, result: path.join(dir, RESULT_FILE), dir, unit, runner };
}

/**
 * Stages a function call as a `run` unit in `dir`: the unit naming the
 * program and the arguments, written there already, whose output is the value
 * the function returns — one blob, or a collection's manifest directory.
 *
 * @param dir - The call's scratch directory
 * @param runner - The stock runner
 * @param program - The program's file
 * @param inputs - The arguments' files, in the function's parameter order
 * @param output - The file the value is written to
 * @returns The staged unit
 */
export async function stageCallUnit(
  dir: string,
  runner: StockRunner,
  program: string,
  inputs: readonly string[],
  output: string,
): Promise<StagedUnit> {
  const unit: Unit = {
    work: variant('run', {
      program: unitPath(dir, program),
      inputs: inputs.map((input) => unitPath(dir, input)),
      output: variant('value', unitPath(dir, output)),
    }),
    platforms: runner.value.platforms,
    threads: BigInt(availableParallelism()),
    result: RESULT_FILE,
  };
  const file = path.join(dir, 'unit.beast2');
  await fs.writeFile(file, encodeBeast2For(UnitType)(unit));
  return { file, result: path.join(dir, RESULT_FILE) };
}

/**
 * The argv that runs a staged unit: `<runner> exec <unit>`, with the stdin
 * lifeline, and `-v` when the runner should print where the time went.
 *
 * @param runner - The stock runner
 * @param unit - The staged unit
 * @param verbose - Whether the runner prints its timings and peak memory
 * @returns The argv
 */
export function unitArgv(runner: StockRunner, unit: StagedUnit, verbose?: boolean): string[] {
  return withRunnerLifeline(runner, [RUNNER_BINARIES[runner.type], 'exec', unit.file, ...(verbose ? ['-v'] : [])]);
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

/** The runs a set or dict output closed, in the order they closed. */
async function outputRuns(unit: TaskUnit): Promise<string[]> {
  const runs = (await fs.readdir(path.join(unit.dir, 'output'))).filter((name) => /^\d+\.beast2$/.test(name));
  return runs.sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).map((name) => `output/${name}`);
}

/**
 * Stages the `merge` unit a finished run unit's output needs: a set or a dict
 * left in several runs, which the runner merges into one.
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
  const work = unit.unit.work;
  if (work.type !== 'run') return null;
  const output = work.value.output;
  if (output.type !== 'set' && output.type !== 'dict') return null;
  const runs = await outputRuns(unit);
  if (runs.length < 2) return null;
  const merge: Unit = {
    work: variant('merge', {
      parts: runs,
      range: none,
      output: output.type === 'set' ? variant('set', 'merged') : variant('dict', { dir: 'merged', merge: output.value.merge }),
    }),
    platforms: unit.unit.platforms,
    threads: unit.unit.threads,
    result: 'merge-result.beast2',
  };
  const file = path.join(unit.dir, 'merge-unit.beast2');
  await fs.writeFile(file, encodeBeast2For(UnitType)(merge));
  return { file, result: path.join(unit.dir, 'merge-result.beast2') };
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
 * wrote one run, or the value its partials folded to.
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
  const work = unit.unit.work;
  if (work.type === 'merge') {
    const merged = work.value.output;
    switch (merged.type) {
      case 'set': return storeDatasetFile(storage, repo, at(`${merged.value}/0.beast2`), { canonical: true });
      case 'dict': return storeDatasetFile(storage, repo, at(`${merged.value.dir}/0.beast2`), { canonical: true });
      case 'fold': return storeDatasetFile(storage, repo, at(merged.value.path), { canonical: true });
      default: throw new Error(`a merge unit writes a set, a dict or a fold, not ${merged.type}`);
    }
  }
  const output = work.value.output;
  switch (output.type) {
    case 'value':
      return storeDatasetFile(storage, repo, at(output.value), { canonical: true });
    case 'fold':
      return storeDatasetFile(storage, repo, at(output.value.path), { canonical: true });
    case 'array':
      return storeDatasetFile(storage, repo, at('output/0.beast2'), { canonical: true });
    case 'set':
    case 'dict': {
      const runs = await outputRuns(unit);
      if (runs.length > 1) return storeDatasetFile(storage, repo, at('merged/0.beast2'), { canonical: true });
      if (runs.length === 1) return storeDatasetFile(storage, repo, at(runs[0]!), { canonical: true });
      const program = decodeEastIR(await fs.readFile(at(work.value.program)));
      const signature = (program.ir as { value: { type: EastTypeValue } }).value.type.value as { inputs: EastTypeValue[] };
      const emitted = (signature.inputs.at(-1)!.value as { inputs: EastTypeValue[] }).inputs;
      const type = output.type === 'set'
        ? variant('Set', emitted[0]!)
        : variant('Dict', { key: emitted[0]!, value: emitted[1]! });
      return storeCollection(storage, repo, type as EastTypeValue, []);
    }
  }
}
