/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Executing a unit of the runner protocol: {@link executeUnit}, the one
 * TypeScript unit runner, over a {@link UnitIO}.
 *
 * A unit (`UnitType`) runs a program on its inputs, merges the parts of one
 * output that earlier units wrote, or takes a delivered collection in, and
 * names where its output and its result go. A program's output is written by
 * its kind:
 * - a value as one blob, or as a manifest directory when it is a collection;
 * - an array through the Writer;
 * - a set or a dict through the RunSorter, as sorted runs;
 * - a fold by folding every emitted value into an accumulator.
 *
 * A delivery taken in is read a segment at a time from its file, and written
 * through the Writer as a manifest directory (`intakeBeast2For`).
 *
 * Collections are written as manifest directories, which a store takes in by
 * linking their files. The result (`UnitResultType`) records the outcome —
 * `ok`, or the failure's message and source locations — with where the time
 * went and the host's peak memory. east-c and east-py implement the same
 * protocol, and the conformance corpus holds the three to the same output
 * bytes and outcomes.
 *
 * The work reaches its files only through the UnitIO it is given, its
 * platform functions only through the host's resolver, and the host's memory
 * only through the gauges it is given, so the same code runs as east-node's
 * `exec` over this machine's files and in a browser's Web Worker over an
 * `InMemoryUnitIO` — east-c's shape (`east/unit.h`), where the unit machinery
 * is library code and its CLI wires it to files.
 */

import { type EastTypeValue, EastTypeValueType, isTypeValueEqual } from "./type_of_type.js";
import { variant } from "./containers/variant.js";
import { SortedMap } from "./containers/sortedmap.js";
import { SortedSet } from "./containers/sortedset.js";
import { compareFor } from "./comparison.js";
import { EastError } from "./error.js";
import type { PlatformFunction } from "./platform.js";
import type { EastIR } from "./eastir.js";
import { printTypeValue } from "./compile/runtime.js";
import {
  Beast2ManifestWriter,
  Beast2RunSorter,
  beast2LazyStats,
  configureFramePool,
  decodeBeast2For,
  encodeBeast2For,
  intakeBeast2For,
  type Beast2LazyStats,
  type Beast2ManifestSink,
  type Beast2SyncRangeReader,
} from "./serialization/beast2/index.js";
import type { Unit, UnitOutcome, UnitOutput, UnitResult, UnitTimings } from "./runner_protocol.js";
import {
  type UnitIO,
  type UnitInputReport,
  lazyInputBytesRead,
  loadUnitInput,
  loadUnitProgram,
  openUnitInputs,
  segmentPath,
} from "./runner_io.js";
import { loadUnitMergeFunction, mergeUnitParts } from "./runner_merge.js";

/** A unit's `run` work. */
type RunWork = Extract<Unit["work"], { type: "run" }>["value"];

/** A unit's `merge` work. */
type MergeWork = Extract<Unit["work"], { type: "merge" }>["value"];

/** A unit's `intake` work. */
type IntakeWork = Extract<Unit["work"], { type: "intake" }>["value"];

/** Adds the time since the last lap to one phase of the result's timings. */
type Lap = (phase: keyof UnitTimings) => void;

/** One input of a run unit, as a report names it. */
export interface UnitRunInput {
  /** The input's file, as the unit names it. */
  readonly path: string;
  /** The type the input is read as: its parameter's. */
  readonly type: EastTypeValue;
}

/**
 * What a host hears of a run unit's inputs as its work goes: the account a
 * runner's `exec -v` prints, which reaches a task's log.
 *
 * @remarks
 * The report says what happened and the host says it in its own words:
 * east-node's prints the lines east-c and east-py print. A merge or intake
 * unit reads no program inputs, and reports nothing.
 */
export interface UnitRunReport extends UnitInputReport {
  /**
   * The program is loaded and its signature fits the unit: it is about to run
   * on `inputs`, none read yet.
   *
   * @param program - the program's file, as the unit names it
   * @param inputs - the inputs, in parameter order
   */
  running(program: string, inputs: readonly UnitRunInput[]): void;
  /**
   * The program ran, and its output was written — or either failed: what
   * reading lazy input `index` came to. Inputs decoded whole have no reads to
   * account for.
   *
   * @param index - the input's position
   * @param path - the input's file, as the unit names it
   * @param stats - its segment decodes and fence probes, and whether an
   *   operation the pager cannot serve read it whole
   * @param bytesRead - the bytes its reads read from its files
   */
  lazyReads(index: number, path: string, stats: Beast2LazyStats, bytesRead: number): void;
}

/** What a host gives {@link executeUnit} besides the unit and its files. */
export interface ExecuteUnitOptions {
  /**
   * Resolves the platform functions of one package the unit lists, as the
   * runner names it. Asked once per package, in the unit's order, before the
   * work begins; a package it cannot resolve fails the unit with its message.
   *
   * @param name - the package's name
   * @returns its platform functions
   */
  platforms(name: string): readonly PlatformFunction[] | Promise<readonly PlatformFunction[]>;
  /** The host's resident memory now, in bytes: what a lazily opened input
   *  weighs a read of it whole by, and what the report says an input decoded
   *  whole added. Without it, both come to 0. east-node's reads
   *  `process.memoryUsage.rss()`. */
  resident?: () => number;
  /** The host's peak resident memory in bytes, read once the work is done:
   *  the result's `peakBytes`. Without it the result says 0 — the host does
   *  not measure memory, as a browser does not. */
  peakBytes?: () => bigint;
  /** Hears how a run unit reads its inputs: without it, nothing is reported
   *  and nothing is measured for a report. */
  report?: UnitRunReport;
}

/** How the work reaches its host. */
interface Host {
  io: UnitIO;
  platforms: PlatformFunction[];
  fetch: boolean;
  resident: (() => number) | undefined;
  report: UnitRunReport | undefined;
  lap: Lap;
}

/**
 * Executes a unit: does its work over `io`, writes its output there, and says
 * how it went.
 *
 * @param unit - the unit; the files it names are read and written through `io`
 * @param io - the unit's files
 * @param options - the host's platform resolver, its memory gauges, and who
 *   hears how the inputs are read
 * @returns the result — a failure is its outcome, never a throw. The host
 *   writes it where the unit's `result` says, if it keeps it
 *
 * @remarks
 * The unit's thread grant caps the frame pool for the rest of the process: a
 * grant of one frames every output inline. A unit whose host places its
 * segments as they are read (`fetch`) has `io` asked for each segment of a
 * staged manifest before it is read ({@link UnitIO.segment}).
 *
 * @example
 * ```ts
 * const io = new InMemoryUnitIO(files);  // the unit and every file it names
 * const unit = decodeBeast2For(UnitType)(io.read("unit.beast2"));
 * const result = await executeUnit(unit, io, { platforms: (name) => packages.get(name)! });
 * if (result.outcome.type === "ok") io.files.get("output.beast2");  // the output
 * ```
 */
export async function executeUnit(unit: Unit, io: UnitIO, options: ExecuteUnitOptions): Promise<UnitResult> {
  configureFramePool({ workers: Number(unit.threads) });
  const timings = { load: 0, compile: 0, execute: 0, output: 0 };
  let mark = performance.now();
  const lap: Lap = (phase) => {
    const now = performance.now();
    timings[phase] += now - mark;
    mark = now;
  };
  let outcome: UnitOutcome;
  try {
    const platforms: PlatformFunction[] = [];
    for (const name of unit.platforms) platforms.push(...await options.platforms(name));
    const host: Host = { io, platforms, fetch: unit.fetch, resident: options.resident, report: options.report, lap };
    if (unit.work.type === "run") {
      await runWork(unit.work.value, host);
    } else if (unit.work.type === "merge") {
      mergeWork(unit.work.value, host);
    } else {
      intakeWork(unit.work.value, host);
    }
    outcome = variant("ok", null);
  } catch (err) {
    outcome = err instanceof EastError
      ? variant("failed", { message: err.eastMessage, locations: err.location })
      : variant("failed", { message: (err as Error)?.message ?? String(err), locations: [] });
  }
  return { outcome, peakBytes: options.peakBytes?.() ?? 0n, timings };
}

/** Runs a program on its inputs and writes what it produces. */
async function runWork(work: RunWork, host: Host): Promise<void> {
  const { io, platforms, report, lap } = host;
  const program = loadUnitProgram(io, work.program);
  const signature = (program.ir as { value: { type: EastTypeValue } }).value.type.value as { inputs: EastTypeValue[]; output: EastTypeValue };
  // Every kind but a value is emitted, through the trailing parameter.
  const emitted = work.output.type !== "value";
  if (emitted && signature.inputs.length === 0) {
    throw new Error(`exec: a ${work.output.type} output is emitted: the program's trailing parameter must be emit, a function`);
  }
  const params = emitted ? signature.inputs.slice(0, -1) : signature.inputs;
  if (work.inputs.length !== params.length) {
    const printed = `(${signature.inputs.map((type) => printTypeValue(type)).join(", ")}) -> ${printTypeValue(signature.output)}`;
    throw new Error(`Function expects ${params.length} inputs, got ${work.inputs.length}\nSignature: ${printed}`);
  }
  // Inputs are frozen: each collection opened lazily, or every input decoded
  // whole, as the unit's `decode` says.
  report?.running(work.program, work.inputs.map((path, i) => ({ path, type: params[i]! })));
  const inputs = openUnitInputs(io, work.inputs, params, work.decode, {
    fetch: host.fetch,
    ...(host.resident !== undefined && { resident: host.resident }),
    ...(report !== undefined && { report }),
  });
  lap("load");
  const compiled = (program as EastIR<unknown[], unknown>).compile(platforms);
  const output = openOutput(work.output, emitted ? signature.inputs.at(-1)! : signature.output, host);
  lap("compile");
  try {
    const result = await compiled(...inputs, ...(output.emit !== undefined ? [output.emit] : []));
    lap("execute");
    output.finish(result);
    lap("output");
  } finally {
    // What reading each lazy input came to, the output's writing included —
    // or up to the failure.
    if (report !== undefined) {
      inputs.forEach((input, i) => {
        const read = lazyInputBytesRead(input);
        const stats = beast2LazyStats(input);
        if (read !== undefined && stats !== undefined) report.lazyReads(i, work.inputs[i]!, stats, read);
      });
    }
  }
}

/** Where a running program's output goes. */
interface OutputSink {
  /** The emit capability, passed as the program's trailing parameter —
   *  absent for a value, which the program returns. */
  emit?: (...args: unknown[]) => null;
  /** Writes the output, given what the program returned. */
  finish(result: unknown): void;
}

/**
 * Opens a running program's output.
 *
 * @param output - the output
 * @param type - the program's result type, for a value; its emit parameter's
 *   type otherwise
 * @param host - the unit's files, and the platforms a fold's functions
 *   compile with
 * @returns the sink
 * @throws {Error} When the emit parameter does not fit the kind, a fold's
 *   function does not fit the emitted type, or an output directory holds
 *   anything already.
 */
function openOutput(output: UnitOutput, type: EastTypeValue, host: Host): OutputSink {
  const { io, platforms } = host;
  if (output.type === "value") {
    const path = output.value;
    return { finish: (result) => writeValue(io, path, type, result) };
  }
  const arity = output.type === "dict" ? 2 : 1;
  const emitInputs = type.type === "Function" ? (type.value as { inputs: EastTypeValue[] }).inputs : null;
  if (emitInputs === null || emitInputs.length !== arity) {
    throw new Error(`exec: a ${output.type} output is emitted: the program's trailing parameter must be emit, a function of ${arity} argument${arity === 1 ? "" : "s"}, got ${printTypeValue(type)}`);
  }
  const element = emitInputs[0]!;
  switch (output.type) {
    case "array": {
      const writer = new Beast2ManifestWriter(variant("Array", element) as EastTypeValue, manifestDirectory(io, `${outputDirectory(io, output.value)}/0.beast2`), { parallel: true });
      return {
        emit: (value) => { writer.add(value); return null; },
        finish: () => writer.finish(),
      };
    }
    case "set": {
      const dir = outputDirectory(io, output.value);
      const sorter = new Beast2RunSorter(variant("Set", element) as EastTypeValue, (run) => manifestDirectory(io, `${dir}/${run}.beast2`), { union: true, parallel: true });
      return {
        emit: (value) => { sorter.add(value); return null; },
        finish: () => sorter.finish(),
      };
    }
    case "dict": {
      const value = emitInputs[1]!;
      const merge = output.value.merge.type === "some"
        ? loadUnitMergeFunction(io, output.value.merge.value, element, value, platforms, "the emit parameter")
        : undefined;
      const dir = outputDirectory(io, output.value.dir);
      const sorter = new Beast2RunSorter(variant("Dict", { key: element, value }) as EastTypeValue, (run) => manifestDirectory(io, `${dir}/${run}.beast2`), { ...(merge !== undefined && { merge }), parallel: true });
      return {
        emit: (key, entry) => { sorter.add([key, entry]); return null; },
        finish: () => sorter.finish(),
      };
    }
    case "fold": {
      const { combine } = loadCombineFunction(io, output.value.combine, element, platforms);
      const path = output.value.path;
      let acc = loadUnitInput(io, output.value.zero, element, host.fetch);
      return {
        emit: (value) => { acc = combine(acc, value); return null; },
        finish: () => writeValue(io, path, element, acc),
      };
    }
  }
}

/** Assembles the parts of one output into one. */
function mergeWork(work: MergeWork, host: Host): void {
  const { io, platforms, lap } = host;
  const output = work.output;
  switch (output.type) {
    case "set":
    case "dict": {
      const dir = outputDirectory(io, output.type === "set" ? output.value : output.value.dir);
      lap("load");
      mergeUnitParts(io, work.parts, manifestDirectory(io, `${dir}/0.beast2`), {
        union: output.type === "set",
        ...(output.type === "dict" && output.value.merge.type === "some" && { merge: output.value.merge.value }),
        ...(work.range.type === "some" && { range: work.range.value }),
        platforms,
        fetch: host.fetch,
      });
      lap("execute");
      return;
    }
    case "fold": {
      const { combine, type } = loadCombineFunction(io, output.value.combine, null, platforms);
      let acc = loadUnitInput(io, output.value.zero, type, host.fetch);
      lap("compile");
      for (const part of work.parts) acc = combine(acc, loadUnitInput(io, part, type, host.fetch));
      lap("execute");
      writeValue(io, output.value.path, type, acc);
      lap("output");
      return;
    }
    case "array":
      throw new Error("exec: an array's parts are concatenated, never merged: a merge unit takes set, dict or fold parts");
    case "value":
      throw new Error("exec: a value has no parts: a merge unit takes set, dict or fold parts");
  }
}

/**
 * Takes a delivered collection in: the file read a segment at a time, through
 * ranged reads, and written through the Writer as the manifest directory the
 * unit names.
 *
 * @throws {Error} When the type file does not hold a type, the delivery cannot
 *   be read, or the intake refuses it — every refusal in the words each runner
 *   uses.
 */
function intakeWork(work: IntakeWork, host: Host): void {
  const { io, lap } = host;
  let type: EastTypeValue;
  try {
    type = decodeBeast2For(EastTypeValueType)(io.read(work.type)) as EastTypeValue;
  } catch {
    throw new Error("exec: intake: its type file does not hold a type");
  }
  const intake = intakeBeast2For(type);
  const delivery: Beast2SyncRangeReader = {
    size: io.size(work.input),
    read: (offset, length) => io.readRange(work.input, offset, length),
  };
  lap("load");
  const segments = work.segments.type === "some"
    ? { segments: { from: Number(work.segments.value.from), to: Number(work.segments.value.to) } }
    : {};
  intake(delivery, manifestDirectory(io, work.output), { ...segments, parallel: true });
  lap("execute");
}

/**
 * Loads a fold's `combine`: an IR file holding a `(T, T) -> T` East function,
 * compiled with the unit's platforms.
 *
 * @param io - the unit's files
 * @param path - the IR file
 * @param type - the emitted type, or `null` to take `T` from the function —
 *   a merge of fold partials has no program to say what was emitted
 * @param platforms - the unit's platform functions
 * @returns the compiled function, and `T`
 * @throws {Error} When the IR is not a function of that shape.
 */
function loadCombineFunction(io: UnitIO, path: string, type: EastTypeValue | null, platforms: PlatformFunction[]): { combine: (acc: unknown, value: unknown) => unknown; type: EastTypeValue } {
  const bundle = loadUnitProgram(io, path);
  const fnType = (bundle.ir as { value: { type: EastTypeValue } }).value.type;
  const shape = fnType.type === "Function" ? fnType.value as { inputs: EastTypeValue[]; output: EastTypeValue } : null;
  const t = type ?? shape?.output;
  if (shape === null || t === undefined || shape.inputs.length !== 2 ||
      !isTypeValueEqual(shape.inputs[0]!, t) ||
      !isTypeValueEqual(shape.inputs[1]!, t) ||
      !isTypeValueEqual(shape.output, t)) {
    const expected = t !== undefined ? ` (T = ${printTypeValue(t)})` : "";
    throw new Error(`exec: combine: expected a function (T, T) -> T${expected}, got ${printTypeValue(fnType)}`);
  }
  return { combine: (bundle as EastIR<unknown[], unknown>).compile(platforms) as (acc: unknown, value: unknown) => unknown, type: t };
}

/**
 * Writes a value output: a collection as a manifest directory at `path`,
 * anything else as one blob there.
 *
 * @param io - the unit's files
 * @param path - the output's file
 * @param type - the value's type
 * @param value - the value
 */
function writeValue(io: UnitIO, path: string, type: EastTypeValue, value: unknown): void {
  if (type.type !== "Array" && type.type !== "Set" && type.type !== "Dict") {
    io.write(path, encodeBeast2For(type)(value));
    return;
  }
  // A collection goes in canonical order: a Set or Dict an East program
  // built is sorted already, and a plain one is sorted first.
  const key = (type.type === "Dict" ? (type.value as { key: EastTypeValue }).key : type.value) as EastTypeValue;
  const cmp = compareFor(key) as (a: unknown, b: unknown) => number;
  const elements: Iterable<unknown> = type.type === "Array" ? value as unknown[]
    : type.type === "Set" ? (value instanceof SortedSet ? value : [...(value as Set<unknown>)].sort(cmp))
    : value instanceof SortedMap ? value.entries() : [...(value as Map<unknown, unknown>).entries()].sort((a, b) => cmp(a[0], b[0]));
  const writer = new Beast2ManifestWriter(type, manifestDirectory(io, path), { parallel: true });
  for (const element of elements) writer.add(element);
  writer.finish();
}

/**
 * The sink a manifest directory is written through: the manifest at `path`,
 * written last, and every object it names in `<path>.segments/` under its
 * SHA-256 — the layout a store takes in by linking, and every runner's opener
 * reads.
 *
 * @param io - the unit's files
 * @param path - the manifest's file
 * @returns the sink
 */
function manifestDirectory(io: UnitIO, path: string): Beast2ManifestSink {
  let made = false;
  return {
    object: (hash, bytes) => {
      if (!made) {
        io.makeDirectory(`${path}.segments`);
        made = true;
      }
      io.write(segmentPath(path, hash), bytes);
    },
    manifest: (bytes) => io.write(path, bytes),
  };
}

/**
 * Makes an output directory of runs, which must hold nothing yet: every
 * manifest in it is one of the unit's runs.
 *
 * @param io - the unit's files
 * @param dir - the directory
 * @returns the directory
 * @throws {Error} When it holds anything already.
 */
function outputDirectory(io: UnitIO, dir: string): string {
  io.makeDirectory(dir);
  if (io.list(dir).length > 0) throw new Error(`exec: the output directory ${dir} is not empty`);
  return dir;
}
