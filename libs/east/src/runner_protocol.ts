/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The runner protocol: the one unit of work every stock runner executes for a
 * machine, and the result it reports.
 *
 * `east-node exec <unit.beast2>`, `east-c exec …` and `east-py exec …` read a
 * {@link UnitType} blob, do its work, and write a {@link UnitResultType} blob
 * where the unit says. A unit either runs a program, writing what it produces
 * by the kind of output it makes, or merges parts of one output kind that
 * earlier units wrote. Everything a unit needs is named by path, and a relative
 * path is relative to the unit file, so a unit file and the files it names are
 * a complete, replayable snapshot of the work.
 *
 * The types live here, beside the collection layer, because every runner and
 * the platform that schedules them read them; east-c declares the same types
 * in C, and the conformance corpus pins that all three runners agree.
 */

import { ArrayType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType, type ValueTypeOf } from "./types.js";
import { LocationType } from "./ir.js";

/**
 * Where a unit's output goes, by the kind of output it is.
 *
 * @remarks
 * A `value` is what a program returns. Every other kind is emitted: the
 * program's trailing parameter is `emit`, whose signature the kind fixes — `(T)
 * -> Null`, or `(K, V) -> Null` for a dict — and the parts it emits combine the
 * way the kind says, whichever unit emitted them.
 */
export const UnitOutputType = VariantType({
  /** The program's result, written to this file: a collection as a manifest
   *  directory there, anything else as one blob. */
  value: StringType,
  /** Elements emitted in order, written through the Writer as the manifest
   *  directory `<dir>/0.beast2`. */
  array: StringType,
  /** Elements emitted in any order, written through the RunSorter as sorted
   *  runs, each the manifest directory `<dir>/<n>.beast2`, numbered from 0 in
   *  the order the runs close. Equal elements collapse. */
  set: StringType,
  /** Entries emitted in any order, written as runs like a set's. Equal keys
   *  fold with `merge`, an IR file of a `(K, V, V) -> V` function, in the order
   *  they were emitted; without it a repeated key is refused. */
  dict: StructType({ dir: StringType, merge: OptionType(StringType) }),
  /** Emitted values folded with `combine`, an IR file of a `(T, T) -> T`
   *  function, starting at `zero`, a file holding a value; the result is
   *  written to `path` as a `value` is. */
  fold: StructType({ path: StringType, zero: StringType, combine: StringType }),
});
export type UnitOutputType = typeof UnitOutputType;
export type UnitOutput = ValueTypeOf<typeof UnitOutputType>;

/** What a unit does. */
export const UnitWorkType = VariantType({
  /** Evaluate `program`, an IR file, on `inputs`, one file per parameter —
   *  a blob or a manifest directory — and write `output`. */
  run: StructType({ program: StringType, inputs: ArrayType(StringType), output: UnitOutputType }),
  /**
   * Assemble `parts` of one output kind into one: sorted set or dict runs
   * merged into one run, `<dir>/0.beast2`, with a key that several parts hold
   * collapsed or folded in part order; or fold partials folded in order,
   * starting at `zero`. `range` is a file holding `{from: Option<K>, to:
   * Option<K>}` over the parts' key type, and limits the merge to the keys in
   * `[from, to)`. An array's parts never need a unit, and a value has none.
   */
  merge: StructType({ parts: ArrayType(StringType), range: OptionType(StringType), output: UnitOutputType }),
});
export type UnitWorkType = typeof UnitWorkType;
export type UnitWork = ValueTypeOf<typeof UnitWorkType>;

/**
 * A unit of work for a runner: what `exec` reads.
 *
 * @example
 * ```ts
 * const unit: Unit = {
 *   work: variant("run", {
 *     program: "program.beast2",
 *     inputs: ["sales.beast2"],
 *     output: variant("dict", { dir: "out", merge: some("add.beast2") }),
 *   }),
 *   platforms: [],
 *   threads: 1n,
 *   result: "result.beast2",
 * };
 * writeFileSync("unit.beast2", encodeBeast2For(UnitType)(unit));
 * // east-node exec unit.beast2
 * ```
 */
export const UnitType = StructType({
  /** The work. */
  work: UnitWorkType,
  /** The platform packages the program's platform calls need, named as the
   *  runner that executes the unit names them. */
  platforms: ArrayType(StringType),
  /** The threads the runner may use, its own pools included: one frames every
   *  output inline. */
  threads: IntegerType,
  /** Where the runner writes its {@link UnitResultType}. */
  result: StringType,
});
export type UnitType = typeof UnitType;
export type Unit = ValueTypeOf<typeof UnitType>;

/** How a unit ended. */
export const UnitOutcomeType = VariantType({
  /** Every output was written. */
  ok: NullType,
  /** The unit failed: its message, and its source locations innermost first,
   *  as the program's source map gives them — empty when no East code was
   *  running. */
  failed: StructType({ message: StringType, locations: ArrayType(LocationType) }),
});
export type UnitOutcomeType = typeof UnitOutcomeType;
export type UnitOutcome = ValueTypeOf<typeof UnitOutcomeType>;

/** Where a unit's time went, in milliseconds. */
export const UnitTimingsType = StructType({
  /** Loading the program, the platforms and the inputs. */
  load: FloatType,
  /** Compiling the program and the functions its output folds with. */
  compile: FloatType,
  /** Running the program, or merging the parts. */
  execute: FloatType,
  /** Finishing the output. */
  output: FloatType,
});
export type UnitTimingsType = typeof UnitTimingsType;
export type UnitTimings = ValueTypeOf<typeof UnitTimingsType>;

/**
 * What a runner reports for a unit, written where the unit's `result` says.
 *
 * @remarks
 * The runner exits 0 when the outcome is `ok` and 1 when it records a failure;
 * any other exit, or no result, is a crash. Two runners agree on a unit when
 * their outcomes are equal: `peakBytes` and `timings` are measurements.
 */
export const UnitResultType = StructType({
  /** How the unit ended. */
  outcome: UnitOutcomeType,
  /** The process's peak resident memory: VmHWM on Linux, `ru_maxrss`
   *  elsewhere. */
  peakBytes: IntegerType,
  /** Where the time went. */
  timings: UnitTimingsType,
});
export type UnitResultType = typeof UnitResultType;
export type UnitResult = ValueTypeOf<typeof UnitResultType>;
