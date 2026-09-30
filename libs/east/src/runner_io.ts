/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a unit reads and writes: the files it names, through a {@link UnitIO}.
 *
 * `executeUnit` (`runner_exec.ts`) does a unit's work over a UnitIO rather
 * than over a file system, so one implementation runs wherever a unit's files
 * are: east-node's `exec` hands it this machine's files, and a browser an
 * {@link InMemoryUnitIO} holding the unit and every file it names. A UnitIO is
 * addressed by the paths the unit names, and reads and writes synchronously,
 * since a compiled East body reads its lazily opened inputs without awaiting.
 *
 * The readers here load what a run unit names through a UnitIO: its program,
 * by its file's extension, and its inputs, each decoded whole or opened lazily
 * over its file as the unit's `decode` says, a manifest's segments read from
 * the files beside it (see `runner_protocol.ts`). A unit whose host places
 * segments as they are read (`fetch`) has its UnitIO asked for each segment
 * file before it is read.
 */

import { type EastTypeValue } from "./type_of_type.js";
import { none, some, variant } from "./containers/variant.js";
import { IRType, type AsyncFunctionIR, type FunctionIR } from "./ir.js";
import { AsyncEastIR, EastIR } from "./eastir.js";
import {
  decodeAsyncEastIR,
  decodeBeast2,
  decodeBeast2For,
  decodeEastIR,
  encodeBeast2SegmentsFor,
  isBeast2LazySafe,
  openBeast2LazyFor,
  readBeast2Extents,
  readBeast2Manifest,
  spliceBeast2,
  type Beast2LazyOptions,
  type Beast2ManifestSource,
  type Beast2SyncRangeReader,
  type CollectionManifest,
} from "./serialization/beast2/index.js";
import { decodeEastFor } from "./serialization/east.js";
import { decodeJSONFor } from "./serialization/json.js";
import type { Unit, UnitDecode, UnitOutput, UnitWork } from "./runner_protocol.js";

/**
 * The files a unit's work reads and writes, by the paths the unit names.
 *
 * @remarks
 * A relative path is relative to the unit, as the runner protocol has it; a
 * host that resolves the unit's paths first ({@link resolveUnitPaths}) hands
 * the IO absolute ones. Every method is synchronous: a lazily opened input is
 * read from inside compiled East code, which does not await.
 *
 * `executeUnit` works over any implementation. east-node's is this machine's
 * files; {@link InMemoryUnitIO} holds a unit and its files in memory, for a
 * host with no file system — a browser's Web Worker.
 */
export interface UnitIO {
  /**
   * Reads a whole file.
   *
   * @param path - the file
   * @returns its bytes
   * @throws {Error} When there is no file at `path`.
   */
  read(path: string): Uint8Array;
  /**
   * Reads a file's size.
   *
   * @param path - the file
   * @returns its size in bytes
   * @throws {Error} When there is no file at `path`; a directory is none.
   */
  size(path: string): number;
  /**
   * Reads a range of a file.
   *
   * @param path - the file
   * @param offset - the first byte's offset
   * @param length - how many bytes to read
   * @returns the `length` bytes from `offset`, fewer only where the file ends
   *   first
   * @throws {Error} When there is no file at `path`.
   */
  readRange(path: string, offset: number, length: number): Uint8Array;
  /**
   * Makes a staged manifest's segment file there to read. When it is absent
   * and the unit says its host places segments as they are read (`fetch`), the
   * host is asked for it — in the runner protocol, by creating
   * `<segment file>.want` — and this returns once the host has placed it.
   * Otherwise an absent segment stays absent, and reading it fails as reading
   * any absent file does.
   *
   * @param path - the segment's file, `<manifest>.segments/<hash>.beast2`
   * @param fetch - whether the unit's host places segments as they are read
   * @throws {Error} When the host says why it cannot place the segment.
   */
  segment(path: string, fetch: boolean): void;
  /**
   * Lists a directory.
   *
   * @param path - the directory
   * @returns the names of the files and directories directly in it
   * @throws {Error} When there is no directory at `path`.
   */
  list(path: string): string[];
  /**
   * Makes a directory, and any parent it lacks. A directory already there is
   * left as it is.
   *
   * @param path - the directory
   * @throws {Error} When a file is where the directory, or a parent of it,
   *   would be.
   */
  makeDirectory(path: string): void;
  /**
   * Writes a whole file, replacing whatever file was there.
   *
   * @param path - the file, whose directory must be there
   * @param bytes - its bytes
   * @throws {Error} When the file's directory is not there, or a directory is
   *   at `path`.
   */
  write(path: string, bytes: Uint8Array): void;
}

/** A path with its `.` and empty segments dropped and its `..` segments
 *  applied, so one file has one key: `a/./b//c/../d` is `a/b/d`. A leading
 *  `/` is kept, and `..` above it stays at it. */
function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") {
      parts.pop();
    } else if (part !== ".." || !absolute) {
      parts.push(part);
    }
  }
  const joined = parts.join("/");
  return absolute ? `/${joined}` : joined;
}

/** The directory a normalized path is in: `""` for the relative root and
 *  `"/"` for the absolute one, each its own parent. */
function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  if (slash < 0) return "";
  return slash === 0 ? "/" : path.slice(0, slash);
}

/**
 * A {@link UnitIO} holding a unit and every file it names in memory: the IO a
 * host with no file system gives `executeUnit`, a browser's Web Worker among
 * them.
 *
 * @remarks
 * Files are held by their paths, normalized (`./a/../b` is `b`), and a
 * directory is there when a held file is in it or it was made. Writes copy the
 * bytes they are given, so the files an execution writes are the IO's own,
 * and {@link files} holds them once it is done — a host collects the unit's
 * outputs from there.
 *
 * The IO holds every file the unit names, segments included, so it never asks
 * a host for a segment: {@link segment} has nothing to do, and a segment that
 * is not held is read as any absent file, and fails at once.
 *
 * @example
 * ```ts
 * const io = new InMemoryUnitIO([
 *   ["unit.beast2", encodeBeast2For(UnitType)(unit)],
 *   ["program.beast2", encodeEastIR(program)],
 *   ["x.beast2", encodeBeast2For(IntegerType)(7n)],
 * ]);
 * const result = await executeUnit(unit, io, { platforms: () => [] });
 * io.files.get("out.beast2");  // the output the unit names, as its runner wrote it
 * ```
 */
export class InMemoryUnitIO implements UnitIO {
  private readonly held = new Map<string, Uint8Array>();
  /** Every directory there is: both roots, each held file's parents, and each
   *  one made. */
  private readonly directories = new Set<string>(["", "/"]);

  /**
   * @param files - the unit and every file it names, by the paths the unit
   *   names them by
   */
  constructor(files: Iterable<readonly [string, Uint8Array]> = []) {
    for (const [path, bytes] of files) {
      const key = normalizePath(path);
      this.held.set(key, bytes);
      for (let dir = parentOf(key); !this.directories.has(dir); dir = parentOf(dir)) this.directories.add(dir);
    }
  }

  /** Every file the IO holds, by its normalized path: the files it was given,
   *  and those written since. */
  get files(): ReadonlyMap<string, Uint8Array> {
    return this.held;
  }

  /** @inheritDoc */
  read(path: string): Uint8Array {
    const bytes = this.held.get(normalizePath(path));
    if (bytes === undefined) throw new Error(`no such file: ${path}`);
    return bytes;
  }

  /** @inheritDoc */
  size(path: string): number {
    return this.read(path).length;
  }

  /** @inheritDoc */
  readRange(path: string, offset: number, length: number): Uint8Array {
    return this.read(path).subarray(offset, offset + length);
  }

  /** Every segment is held already, so there is none to ask for. */
  segment(_path: string, _fetch: boolean): void {}

  /** @inheritDoc */
  list(path: string): string[] {
    const dir = normalizePath(path);
    if (!this.directories.has(dir)) {
      throw new Error(this.held.has(dir) ? `not a directory: ${path}` : `no such directory: ${path}`);
    }
    const prefix = dir === "" || dir === "/" ? dir : `${dir}/`;
    const names = new Set<string>();
    for (const key of [...this.held.keys(), ...this.directories]) {
      // The relative root lists relative paths only.
      if (key === dir || !key.startsWith(prefix) || (prefix === "" && key.startsWith("/"))) continue;
      names.add(key.slice(prefix.length).split("/")[0]!);
    }
    return [...names].sort();
  }

  /** @inheritDoc */
  makeDirectory(path: string): void {
    const made: string[] = [];
    for (let dir = normalizePath(path); !this.directories.has(dir); dir = parentOf(dir)) {
      if (this.held.has(dir)) throw new Error(`not a directory: ${dir}`);
      made.push(dir);
    }
    for (const dir of made) this.directories.add(dir);
  }

  /** @inheritDoc */
  write(path: string, bytes: Uint8Array): void {
    const key = normalizePath(path);
    if (this.directories.has(key)) throw new Error(`is a directory: ${path}`);
    const dir = parentOf(key);
    if (!this.directories.has(dir)) throw new Error(`no such directory: ${dir}`);
    this.held.set(key, bytes.slice());
  }
}

/**
 * Resolves every path a unit names — its program, inputs, parts, outputs,
 * functions, the files an intake reads and writes, and its result — keeping
 * the rest of the unit as it is.
 *
 * @remarks
 * What east-c's `east_unit_read` does as it reads a unit: a host whose unit
 * names paths relative to the unit file resolves them against that file's
 * directory once, so its UnitIO and its messages see the paths the files are
 * at.
 *
 * @param unit - the unit
 * @param resolve - resolves one path the unit names
 * @returns the unit, naming every file by its resolved path
 *
 * @example
 * ```ts
 * const unit = decodeBeast2For(UnitType)(readFileSync(unitPath));
 * const base = dirname(resolve(unitPath));
 * const resolved = resolveUnitPaths(unit, (path) => resolve(base, path));
 * ```
 */
export function resolveUnitPaths(unit: Unit, resolve: (path: string) => string): Unit {
  const output = (out: UnitOutput): UnitOutput => {
    switch (out.type) {
      case "value": return variant("value", resolve(out.value));
      case "array": return variant("array", resolve(out.value));
      case "set": return variant("set", resolve(out.value));
      case "dict": return variant("dict", {
        dir: resolve(out.value.dir),
        merge: out.value.merge.type === "some" ? some(resolve(out.value.merge.value)) : none,
      });
      case "fold": return variant("fold", {
        path: resolve(out.value.path),
        zero: resolve(out.value.zero),
        combine: resolve(out.value.combine),
      });
    }
  };
  const work = (w: UnitWork): UnitWork => {
    switch (w.type) {
      case "run": return variant("run", {
        program: resolve(w.value.program),
        inputs: w.value.inputs.map((path) => resolve(path)),
        output: output(w.value.output),
        decode: w.value.decode,
      });
      case "merge": return variant("merge", {
        parts: w.value.parts.map((path) => resolve(path)),
        range: w.value.range.type === "some" ? some(resolve(w.value.range.value)) : none,
        output: output(w.value.output),
      });
      case "intake": return variant("intake", {
        input: resolve(w.value.input),
        type: resolve(w.value.type),
        segments: w.value.segments,
        output: resolve(w.value.output),
      });
    }
  };
  return {
    work: work(unit.work),
    platforms: unit.platforms,
    threads: unit.threads,
    fetch: unit.fetch,
    result: resolve(unit.result),
  };
}

/** The encodings a file a unit names can hold, told apart by its extension. */
export type UnitFileFormat = "beast2" | "east" | "json";

/** A path's extension, `.beast2` of `dir/x.beast2`: the last segment's text
 *  from its last dot, after any trailing separators, or empty when that
 *  segment has no dot but a leading one. `/` and `\` both separate. */
function extensionOf(path: string): string {
  let end = path.length;
  while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) end--;
  const trimmed = path.slice(0, end);
  const base = trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
  if (base === "..") return "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

/**
 * The encoding a file a unit names holds, by its extension: `.beast2` or
 * `.beast` a beast2 blob, `.east` East text, `.json` JSON.
 *
 * @param path - the file
 * @returns its encoding
 * @throws {Error} When the extension is none of those, naming it.
 */
export function unitFileFormat(path: string): UnitFileFormat {
  const ext = extensionOf(path).toLowerCase();
  switch (ext) {
    case ".beast2":
    case ".beast":
      return "beast2";
    case ".east":
      return "east";
    case ".json":
      return "json";
    default:
      throw new Error(`Unsupported file extension "${ext}". Supported extensions: .beast2, .beast, .east, .json`);
  }
}

/** A decoded IR value, by the TypeScript type the compiler reads it as. */
type ProgramIR = FunctionIR | AsyncFunctionIR | { type: string };

/** The IR decoders of each encoding, built on first use: East text's parser
 *  over the IR type is costly to build, and most hosts never meet one. */
let irDecoders: Record<UnitFileFormat, (data: Uint8Array) => ProgramIR> | undefined;

/** Decodes a program's IR from a file's bytes in the file's encoding. */
function decodeProgramIR(format: UnitFileFormat, data: Uint8Array): ProgramIR {
  irDecoders ??= {
    beast2: decodeBeast2For(IRType) as (data: Uint8Array) => ProgramIR,
    east: decodeEastFor(IRType) as (data: Uint8Array) => ProgramIR,
    json: decodeJSONFor(IRType) as (data: Uint8Array) => ProgramIR,
  };
  return irDecoders[format](data);
}

/**
 * Loads a unit's program: an IR file holding an East function or async
 * function, in any encoding a unit may name ({@link unitFileFormat}).
 *
 * @remarks
 * A beast2 program carries its source map, so an error it raises names where
 * its source was written; East text and JSON carry none.
 *
 * @param io - the unit's files
 * @param path - the program's file
 * @returns the program, ready to compile
 * @throws {Error} When the extension is not one a unit may name, the file
 *   cannot be read or decoded as IR, or the IR is not a function.
 */
export function loadUnitProgram(io: UnitIO, path: string): EastIR<any[], any> | AsyncEastIR<any[], any> {
  const format = unitFileFormat(path);
  const data = io.read(path);
  // The root variant says whether the program is sync or async.
  const ir = decodeProgramIR(format, data);
  if (format === "beast2") {
    if (ir.type === "Function") return decodeEastIR(data);
    if (ir.type === "AsyncFunction") return decodeAsyncEastIR(data);
  } else {
    if (ir.type === "Function") return new EastIR<any[], any>(ir as FunctionIR);
    if (ir.type === "AsyncFunction") return new AsyncEastIR<any[], any>(ir as AsyncFunctionIR);
  }
  throw new Error(`IR file must contain a function or async function, got "${ir.type}"`);
}

/**
 * A staged manifest's segment file: `<manifest>.segments/<hash>.beast2`, the
 * layout every runner's opener reads and a store takes in by linking.
 *
 * @param manifest - the manifest's file
 * @param hash - the segment's SHA-256, as the manifest names it
 * @returns the segment's file
 * @internal
 */
export function segmentPath(manifest: string, hash: string): string {
  return `${manifest}.segments/${hash}.beast2`;
}

/**
 * Reads exactly `length` bytes of a file from `offset`, failing a range the
 * file ends inside, as a positioned reader does.
 *
 * @param io - the unit's files
 * @param path - the file
 * @param offset - the first byte's offset
 * @param length - how many bytes to read
 * @returns the bytes
 * @throws {Error} When the file ends before the range does.
 * @internal
 */
export function readUnitRange(io: UnitIO, path: string, offset: number, length: number): Uint8Array {
  const bytes = io.readRange(path, offset, length);
  if (bytes.length !== length) throw new Error(`beast2: short read at offset ${offset + bytes.length}`);
  return bytes;
}

/** Whether a file is there to read. */
function holds(io: UnitIO, path: string): boolean {
  try {
    io.size(path);
    return true;
  } catch {
    return false;
  }
}

/** Ranged access to a file through `io`, adding every byte it reads to
 *  `counter`. */
function countedReader(io: UnitIO, path: string, counter: { bytes: number }): Beast2SyncRangeReader {
  return {
    size: io.size(path),
    read(offset, length) {
      const bytes = readUnitRange(io, path, offset, length);
      counter.bytes += length;
      return bytes;
    },
  };
}

/** The bytes each lazily opened input has read so far, for a runner's
 *  account of its inputs. */
const lazyReads = new WeakMap<object, () => number>();

/**
 * The bytes an input {@link openUnitInputLazy} opened has read so far: its
 * geometry (tail and head), every fence it probed and each segment frame it
 * decoded, across its file and, for a manifest, every segment file it read.
 *
 * @param value - an input's value
 * @returns the byte count, or `undefined` for a value not opened lazily
 */
export function lazyInputBytesRead(value: unknown): number | undefined {
  return typeof value === "object" && value !== null ? lazyReads.get(value)?.() : undefined;
}

/**
 * The bytes an input stands for: the collection a manifest names — the
 * manifest and every segment file — or any other file's own size.
 *
 * @remarks
 * What a runner's verbose account weighs an input at. A manifest is a few
 * dozen bytes per segment whatever the collection weighs, so its file's size
 * would say nothing of what the input holds. The manifest is recognised
 * through ranged reads, so a large blob is never read to learn that it is not
 * one.
 *
 * @param io - the unit's files
 * @param path - the input's file
 * @returns the byte count
 * @throws {Error} When the extension is not one a unit may name, or there is
 *   no file at `path`.
 */
export function unitInputBytes(io: UnitIO, path: string): number {
  if (unitFileFormat(path) !== "beast2") return io.size(path);
  try {
    const reader = countedReader(io, path, { bytes: 0 });
    const manifest = readBeast2Manifest(reader);
    if (manifest === null) return reader.size;
    return manifest.entries.reduce((sum, entry) => sum + Number(entry.bytes), reader.size);
  } catch {
    return io.size(path);
  }
}

/** One blob out of a manifest's segment files, each asked for when the unit's
 *  host places segments as they are read: the segments share one header, so
 *  splicing them decodes nothing and is byte-identical to the blob they were
 *  cut from. An empty collection names no segment, and is the Writer's own
 *  empty blob. */
function spliceManifest(io: UnitIO, path: string, manifest: CollectionManifest, fetch: boolean): Uint8Array {
  if (manifest.entries.length === 0) return encodeBeast2SegmentsFor(manifest.type)([]);
  return spliceBeast2(manifest.entries.map((entry) => {
    const file = segmentPath(path, entry.hash);
    io.segment(file, fetch);
    return io.read(file);
  }));
}

/**
 * Loads an input decoded whole, and frozen: deeply immutable from
 * construction, a mutating builtin throwing the uniform copy-first error, and
 * compared by value under East `Is`, as every task input is.
 *
 * @remarks
 * A beast2 file is self-describing; a manifest is the collection it names,
 * its segments spliced from the files beside it, each asked for first when the
 * unit's host places segments as they are read. East text and JSON decode as
 * `type`.
 *
 * @param io - the unit's files
 * @param path - the input's file
 * @param type - the parameter's type
 * @param fetch - whether the unit's host places segments as they are read
 * @returns the input's value
 * @throws {Error} When the extension is not one a unit may name, or the file,
 *   or a segment its manifest names, cannot be read or decoded.
 */
export function loadUnitInput(io: UnitIO, path: string, type: EastTypeValue, fetch: boolean): unknown {
  const format = unitFileFormat(path);
  const data = io.read(path);
  switch (format) {
    case "beast2": {
      const manifest = readBeast2Manifest(data);
      if (manifest !== null) return decodeBeast2(spliceManifest(io, path, manifest, fetch), { frozen: true }).value;
      return decodeBeast2(data, { frozen: true }).value;
    }
    case "east":
      return decodeEastFor(type, true)(data);
    case "json":
      return decodeJSONFor(type, true)(data);
  }
}

/** How a unit's inputs are read, beyond the unit itself. */
export interface UnitInputOptions {
  /** Whether the unit's host places segments as they are read: the unit's
   *  `fetch`. */
  fetch: boolean;
  /** The host's resident memory now, in bytes: what a lazily opened input
   *  weighs a read of it whole by (`beast2LazyStats`), and what an input
   *  decoded whole is said to add. Without it, both come to 0. */
  resident?: () => number;
}

/**
 * Opens an input lazily, frozen, when it can be: a beast2 v5 collection blob
 * carrying a segment index, or a manifest over its segment files. Its size,
 * iteration and keyed reads are served a segment at a time; any other
 * operation reads it whole, once, when it first needs it, to the eager value's
 * exact semantics.
 *
 * @remarks
 * The file is never read whole: the value pages segment frames from it through
 * ranged reads, and a manifest's segments are read from their own files, each
 * asked for as it is first read when the unit's host places segments as they
 * are read. A unit whose host does not, and whose manifest names a segment not
 * there, is refused here, so its input decodes whole and fails there.
 *
 * Frozen is what makes a lazy open safe for any nested element shape, since a
 * frozen value cannot be written through; an element holding a Ref or a
 * function still cannot be, and is refused ({@link isBeast2LazySafe}).
 *
 * @param io - the unit's files
 * @param path - the input's file
 * @param options - the unit's `fetch`, and the host's resident-memory gauge
 * @returns the lazy collection value, or `undefined` when the input cannot be
 *   opened lazily — another encoding, a version 4 or index-less blob, a root
 *   that is no collection, segments that alias one another, an unsafe element
 *   shape, or a file that is not there — for the caller to decode it whole
 */
export function openUnitInputLazy(io: UnitIO, path: string, options: UnitInputOptions): unknown | undefined {
  if (unitFileFormat(path) !== "beast2") return undefined;
  const counter = { bytes: 0 };
  const lazy: Beast2LazyOptions = options.resident !== undefined ? { frozen: true, resident: options.resident } : { frozen: true };
  try {
    const reader = countedReader(io, path, counter);
    // A file whose value is a manifest is the collection it names, its
    // segments the files beside it: nothing reads a segment the body does not.
    const manifest = readBeast2Manifest(reader);
    let value: object;
    if (manifest !== null) {
      if (!isBeast2LazySafe(manifest.type, { frozen: true })) return undefined;
      const entries = manifest.entries;
      if (!options.fetch && !entries.every((entry) => holds(io, segmentPath(path, entry.hash)))) return undefined;
      const readers: (Beast2SyncRangeReader | undefined)[] = new Array(entries.length);
      const source: Beast2ManifestSource = {
        manifest,
        segment(i) {
          if (readers[i] === undefined) {
            const file = segmentPath(path, entries[i]!.hash);
            io.segment(file, options.fetch);
            readers[i] = countedReader(io, file, counter);
          }
          return readers[i];
        },
      };
      value = openBeast2LazyFor(manifest.type, lazy)(source) as object;
    } else {
      const extents = readBeast2Extents(reader);
      if (!extents.selfContained || !isBeast2LazySafe(extents.typeValue, { frozen: true })) return undefined;
      value = openBeast2LazyFor(extents.typeValue, lazy)(reader) as object;
    }
    lazyReads.set(value, () => counter.bytes);
    return value;
  } catch {
    return undefined;
  }
}

/**
 * What a runner hears of its inputs as they open: the account `-v` gives of
 * each.
 */
export interface UnitInputReport {
  /**
   * Input `index` opened lazily.
   *
   * @param index - the input's position
   */
  openedLazily(index: number): void;
  /**
   * Input `index` was decoded whole before the program ran.
   *
   * @param index - the input's position
   * @param residentBytes - what its decode added to resident memory, by the
   *   host's gauge: 0 without one, and below 0 when memory freed across the
   *   decode left the host smaller
   */
  decodedWhole(index: number, residentBytes: number): void;
}

/** How a program's inputs open: the unit's `fetch`, the host's gauge, and who
 *  hears how each opened. */
export interface UnitInputsOptions extends UnitInputOptions {
  /** Hears how each input opened; without it, nothing is measured for it. */
  report?: UnitInputReport;
}

/**
 * Opens a program's inputs as the unit's `decode` says, every one frozen.
 *
 * @remarks
 * With `lazy`, each collection input opens lazily whatever it weighs
 * ({@link openUnitInputLazy}); one that cannot, and every input with `whole`,
 * is decoded whole before the program runs ({@link loadUnitInput}), what that
 * added to resident memory measured for a report.
 *
 * @param io - the unit's files
 * @param paths - the input files, in parameter order
 * @param types - the parameters' types
 * @param decode - how the collection inputs are read
 * @param options - the unit's `fetch`, the host's gauge, and the report
 * @returns the inputs, in parameter order
 * @throws {Error} When an input decoded whole cannot be read or decoded.
 */
export function openUnitInputs(io: UnitIO, paths: readonly string[], types: readonly EastTypeValue[], decode: UnitDecode, options: UnitInputsOptions): unknown[] {
  const { report, resident } = options;
  return paths.map((path, i) => {
    const lazy = decode.type === "lazy" ? openUnitInputLazy(io, path, options) : undefined;
    if (lazy !== undefined) {
      report?.openedLazily(i);
      return lazy;
    }
    const measured = report !== undefined && resident !== undefined;
    const before = measured ? resident() : 0;
    const value = loadUnitInput(io, path, types[i]!, options.fetch);
    report?.decodedWhole(i, measured ? resident() - before : 0);
    return value;
  });
}
