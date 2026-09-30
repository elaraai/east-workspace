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
 * where the unit says. A unit runs a program, writing what it produces by the
 * kind of output it makes; merges parts of one output kind that earlier units
 * wrote; or takes a delivered collection in, as the Writer writes it.
 * Everything a unit needs is named by path, and a relative path is relative to
 * the unit file, so a unit file and the files it names are a complete,
 * replayable snapshot of the work. An intake's delivery is the one exception:
 * it may be named by an absolute path, where it lies, since a runner only reads
 * it and a delivery of many gigabytes is not staged beside the unit.
 *
 * The types live here, beside the collection layer, because every runner and
 * the platform that schedules them read them; east-c declares the same types
 * in C, and the conformance corpus pins that all three runners agree. The
 * TypeScript runner is `executeUnit` (`runner_exec.ts`), which does a unit's
 * work over whatever holds its files (`UnitIO`): east-node's `exec` is its
 * file wrapper, and a browser runs it over the files in memory.
 *
 * A run unit says how its collection inputs are read (`decode`): lazily, a
 * segment at a time as the program reads them, or decoded whole before it
 * runs. A runner's `run` command takes the same choice as `--decode`, lazy
 * unless it says `whole`, so a program reads its inputs the same way whichever
 * runner, and whichever command, runs it.
 *
 * A collection a unit reads is staged as its manifest and the manifest's
 * segments beside it, `<file>.segments/<hash>.beast2`. A host whose store is
 * elsewhere may leave the segments out and place each as the runner first
 * reads it, so a unit downloads what it reads: the unit says so (`fetch`). Its
 * runner then asks for a staged manifest's segment file it finds absent, by
 * creating `<segment file>.want` beside where it would be, and waits for the
 * host to place the file or to write `<segment file>.error`, holding why it
 * cannot, which the runner fails with. The host writes either whole — under a
 * name of its own, renamed into place — since the runner reads each the moment
 * it is there, and a file it finds half-written it reads as such. A unit that
 * does not say so reads
 * an absent segment as the input's own error, at once. Such a unit and the
 * files beside it are a snapshot of the work only once its segments are there.
 */

import { ArrayType, BooleanType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType, type ValueTypeOf } from "./types.js";
import { LocationType } from "./ir.js";

/**
 * The environment variable a runner's `exec` sets to `1` in its own process
 * when its unit asks for segments as it reads them (`fetch`), which the
 * runner's manifest openers read — east-c's, for east-c and east-py alike. A
 * host never sets it for a runner: e3 strips it from every runner it starts,
 * so only a unit turns it on.
 */
export const FETCH_SEGMENTS_ENV = "E3_FETCH_SEGMENTS";

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

/**
 * How a run unit's collection inputs are read.
 *
 * @remarks
 * `lazy` opens each Array, Set and Dict input over its file and decodes a
 * segment at a time as the program reads it: its size, a keyed read and the
 * `$.for` loop decode only the segments they reach, and an operation the
 * runner cannot serve so decodes the input whole, once, when it first needs
 * it. `whole` decodes every input before the program runs, which suits a
 * program that reads most of an input at random: lazily, a runner keeps only
 * the segments it decoded last, and a read beyond them decodes its segment
 * again. A value that is not a collection, and a collection whose elements
 * hold a Ref or a function, is decoded whole either way. The program's result
 * is the same either way: only the memory and the time it takes differ.
 */
export const UnitDecodeType = VariantType({
  /** Each collection input opened over its file, a segment decoded as the
   *  program reaches it. */
  lazy: NullType,
  /** Every input decoded whole before the program runs. */
  whole: NullType,
});
export type UnitDecodeType = typeof UnitDecodeType;
export type UnitDecode = ValueTypeOf<typeof UnitDecodeType>;

/** What a unit does. */
export const UnitWorkType = VariantType({
  /** Evaluate `program`, an IR file, on `inputs`, one file per parameter —
   *  a blob or a manifest directory — read as `decode` says, and write
   *  `output`. */
  run: StructType({
    program: StringType,
    inputs: ArrayType(StringType),
    output: UnitOutputType,
    decode: UnitDecodeType,
  }),
  /**
   * Assemble `parts` of one output kind into one: sorted set or dict runs
   * merged into one run, `<dir>/0.beast2`, with a key that several parts hold
   * collapsed or folded in part order; or fold partials folded in order,
   * starting at `zero`. `range` is a file holding `{from: Option<K>, to:
   * Option<K>}` over the parts' key type, and limits the merge to the keys in
   * `[from, to)`. An array's parts never need a unit, and a value has none.
   */
  merge: StructType({ parts: ArrayType(StringType), range: OptionType(StringType), output: UnitOutputType }),
  /**
   * Take in `input`, a delivered beast2 file of an Array, Set or Dict — named
   * where it lies, by an absolute path or one relative to the unit — as the
   * Writer writes it: the manifest directory `output`. `type` is a file holding
   * the declared type, an `EastTypeValue` blob, which the delivery's header
   * must name. `segments` limits the unit to the delivery's segments `[from,
   * to)`, by its index, for a piece of a large one. Rows are read a segment at
   * a time, and each segment is either the Writer's bytes, carried as they
   * stand, or read and written again.
   */
  intake: StructType({
    input: StringType,
    type: StringType,
    segments: OptionType(StructType({ from: IntegerType, to: IntegerType })),
    output: StringType,
  }),
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
 *     decode: variant("lazy", null),
 *   }),
 *   platforms: [],
 *   threads: 1n,
 *   fetch: false,
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
  /** Whether the host places the segments of the collections the unit reads
   *  as the runner asks for them: a segment file of a staged manifest may be
   *  absent, and the runner asks for it (see the module's description). */
  fetch: BooleanType,
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
   *  elsewhere; 0 from a host that does not measure memory, as a browser
   *  does not. */
  peakBytes: IntegerType,
  /** Where the time went. */
  timings: UnitTimingsType,
});
export type UnitResultType = typeof UnitResultType;
export type UnitResult = ValueTypeOf<typeof UnitResultType>;
