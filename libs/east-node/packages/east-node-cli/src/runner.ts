/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { closeSync, fstatSync, openSync, readSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'fs';
import { extname } from 'path';
import {
    EastIR,
    Beast2Writer,
    BEAST2_PAGED_BATCH_DEFAULT,
    BEAST2_PAGED_TARGET_BYTES_DEFAULT,
    compareFor,
    decodeBeast2For,
    encodeBeast2For,
    encodeBeast2PagedFor,
    encodeEastFor,
    encodeJSONFor,
    isTypeValueEqual,
    openBeast2LazyFor,
    printFor,
    variant,
    type Beast2SyncRangeReader,
} from '@elaraai/east';
import type { PlatformFunction, EastTypeValue } from '@elaraai/east/internal';
import { printTypeValue } from '@elaraai/east/internal';
import { lazyInputBytesRead, loadEastIR, loadInput, loadInputLazy } from './loader.js';

function now(): bigint { return process.hrtime.bigint(); }
function elapsed(start: bigint, end: bigint): number { return Number(end - start) / 1e6; }

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatFileSize(path: string): string {
    try { return formatSize(statSync(path).size); } catch { return '?'; }
}

/** Streaming-execution options accepted by {@link runProgram}. */
export interface RunProgramOptions {
    /** Enable verbose timing/memory output on stderr. */
    verbose?: boolean;
    /** Write the output incrementally from the function's trailing `emit`
     *  parameter instead of its return value. The value names the output
     *  collection kind; element/key/value types come from the emit
     *  parameter's function type. */
    emit?: 'array' | 'set' | 'dict';
    /** Feed these `-i` inputs (0-based) lazily — segment-by-segment
     *  iteration with O(segment) decoded memory — regardless of size.
     *  Element shapes the lazy contract excludes (nested mutable
     *  containers, vectors/matrices, functions) decode whole instead. */
    streamInputs?: number[];
    /** With `emit: 'dict'`: an IR file (any format the IR positional
     *  accepts) holding a `(K, V, V) -> V` East function over the emit
     *  parameter's key and value types, compiled with the run's platforms.
     *  Emissions with an equal key fold left with it, in emission order. */
    merge?: string;
    /** With `emit: 'set'`: equal elements collapse to the first. */
    union?: boolean;
    /** Open indexed beast2 collection inputs at or above this many bytes as
     *  lazy pager-backed values (0 disables). Defaults to 64 MiB, or the
     *  `EAST_LAZY_INPUT_BYTES` environment variable. Applies only to
     *  shape-gate-safe element types (see `loadInputLazy`) — others always
     *  decode whole. */
    lazyInputBytes?: number;
}

/** Default size threshold above which collection inputs open lazily. */
const LAZY_INPUT_BYTES_DEFAULT = 64 * 1024 * 1024;

/** Resolves the lazy-open threshold: explicit option, else environment, else
 *  the default. An unset or empty `EAST_LAZY_INPUT_BYTES` falls through to
 *  the 64 MiB default (`Number('')` is `0`, which would silently DISABLE
 *  lazy opening); invalid or negative values fall through too, matching
 *  east-c and east-py. Exported for the spec only. @internal */
export function lazyThreshold(options: RunProgramOptions): number {
    if (options.lazyInputBytes !== undefined) return options.lazyInputBytes;
    const raw = process.env.EAST_LAZY_INPUT_BYTES;
    if (raw !== undefined && raw !== '') {
        const env = Number(raw);
        if (Number.isFinite(env) && env >= 0) return env;
    }
    return LAZY_INPUT_BYTES_DEFAULT;
}

/**
 * Runs an East IR program.
 */
export async function runProgram(
    irPath: string,
    platformFns: PlatformFunction[],
    packages: string[],
    inputPaths: string[],
    outputPath?: string,
    options: RunProgramOptions | boolean = {},
): Promise<unknown> {
    // Callers predating streaming execution pass `verbose` as a boolean.
    const opts: RunProgramOptions = typeof options === 'boolean' ? { verbose: options } : options;
    const verbose = opts.verbose ?? false;
    const t0 = now();

    if (opts.merge !== undefined && opts.emit !== 'dict') {
        throw new Error('--merge applies to --emit dict only');
    }
    if (opts.union && opts.emit !== 'set') {
        throw new Error('--union applies to --emit set only');
    }

    // Load as an EastIR bundle so source_map travels with the IR and error
    // frames resolve end-to-end.
    const eastIR = loadEastIR(irPath);
    const ir = eastIR.ir;
    const isAsync = eastIR instanceof EastIR ? false : true;

    // Get the function's input/output types from the IR.
    const inputTypes = (ir as any)?.value?.type?.value?.inputs ?? [];
    const outputType = ((ir as any)?.value?.type?.value?.output ?? null) as EastTypeValue | null;

    // With emit, the function takes one trailing runner-provided parameter
    // beyond the input files: the emit capability. A zero-parameter function
    // has no trailing parameter to be it — the shaped emit error, not a
    // negative arity count.
    if (opts.emit !== undefined && inputTypes.length === 0) {
        throw new Error(`--emit requires the function's trailing parameter to be the emit capability (a function type), but the function takes no parameters`);
    }
    const fileParamCount = opts.emit !== undefined ? inputTypes.length - 1 : inputTypes.length;
    if (inputPaths.length !== fileParamCount) {
        throw new Error(
            `Function expects ${fileParamCount} input(s), but ${inputPaths.length} input file(s) provided`,
        );
    }
    if (opts.emit !== undefined && (outputPath === undefined || extname(outputPath).toLowerCase() !== '.beast2')) {
        // east-c / east-py parity: the emitted blob is a beast2 stream, so
        // any other output extension is refused up front.
        throw new Error(`--emit requires a .beast2 output file (-o)`);
    }
    const streamInputs = opts.streamInputs ?? [];
    for (const index of streamInputs) {
        if (index < 0 || index >= inputPaths.length) {
            throw new Error(`--stream index ${index} out of range (${inputPaths.length} inputs)`);
        }
    }

    const emitSink = opts.emit !== undefined
        ? createEmitSink(opts.emit, inputTypes[inputTypes.length - 1] as EastTypeValue, outputPath!, verbose, {
            ...(opts.merge !== undefined && { mergePath: opts.merge }),
            union: opts.union ?? false,
            platformFns,
        })
        : null;

    // Verbose header
    if (verbose) {
        console.error(`Running: ${irPath}  (${formatFileSize(irPath)})`);

        if (packages.length > 0) {
            console.error(`Platform: ${packages.length} package(s), ${platformFns.length} function(s)`);
            for (const p of packages) console.error(`  - ${p}`);
        }

        console.error(`Function: ${inputTypes.length} inputs, ${isAsync ? 'async' : 'sync'}`);
        for (let i = 0; i < fileParamCount; i++) {
            const t = printTypeValue(inputTypes[i]!);
            console.error(`  input ${i}: ${inputPaths[i]}  (${formatFileSize(inputPaths[i]!)})`);
            console.error(`    ${t}`);
        }
        if (emitSink) console.error(`  emit: ${opts.emit} sink -> ${outputPath}`);
        if (outputType) {
            console.error(`  return:`);
            console.error(`    ${printTypeValue(outputType)}`);
        }
    }

    // Load inputs — always frozen (task inputs are immutable; mutating one
    // throws the uniform copy-first error). Streamed inputs always open
    // lazily; other beast2 collection inputs open lazily at or above the
    // size threshold, so a sparse read into a huge indexed input stops
    // paying a whole decode — and because frozen collapses the shape gate,
    // nested-container element shapes open lazily too.
    const threshold = lazyThreshold(opts);
    const inputs: unknown[] = [];
    const lazyInputs: number[] = [];
    for (let i = 0; i < inputPaths.length; i++) {
        const wantLazy = streamInputs.includes(i) ||
            (threshold > 0 && statSync(inputPaths[i]!).size >= threshold);
        const lazy = wantLazy ? loadInputLazy(inputPaths[i]!) : undefined;
        if (lazy !== undefined) {
            lazyInputs.push(i);
            if (verbose) console.error(`  input ${i}: opened lazily — paged from the file`);
        }
        inputs.push(lazy !== undefined ? lazy : loadInput(inputPaths[i]!, inputTypes[i]!));
    }
    /** The verbose summary's account of each lazy input: what paging came
     *  to, against the file's size. */
    const reportLazyReads = (): void => {
        for (const i of lazyInputs) {
            const read = lazyInputBytesRead(inputs[i]);
            if (read !== undefined) console.error(`  input ${i}: ${formatSize(read)} read of ${formatFileSize(inputPaths[i]!)}`);
        }
    };
    if (emitSink) inputs.push(emitSink.emit);

    const t1 = now();

    let result: unknown;
    if (!isAsync) {
        const compiled = (eastIR as EastIR<any, any>).compile(platformFns);
        const t2 = now();

        result = compiled(...inputs);
        const t3 = now();

        const t4 = emitSink
            ? finishEmit(emitSink, outputPath!, verbose)
            : maybeWriteOutput(outputPath, result, outputType, verbose);
        const t5 = now();

        if (verbose) {
            printTimingAndMemory(t0, t1, t2, t3, t4, t5);
            reportLazyReads();
        }
    } else {
        const compiled = (eastIR as any).compile(platformFns);
        const t2 = now();

        result = await compiled(...inputs);
        const t3 = now();

        const t4 = emitSink
            ? finishEmit(emitSink, outputPath!, verbose)
            : maybeWriteOutput(outputPath, result, outputType, verbose);
        const t5 = now();

        if (verbose) {
            printTimingAndMemory(t0, t1, t2, t3, t4, t5);
            reportLazyReads();
        }
    }

    return outputPath ? undefined : result;
}

/** An emit capability wired to a streaming beast2 writer on the output file. */
interface EmitSink {
    /** The function value passed as the body's trailing parameter. */
    emit: (...args: unknown[]) => null;
    /** Flushes pending elements and finalizes the blob (terminator + index),
     *  or merges the spilled runs into it. */
    finish: () => void;
}

/** How the emit sink treats equal keys, and what it needs to fold them. */
interface EmitFoldOptions {
    /** The `--merge` IR file (dict sinks). */
    mergePath?: string;
    /** Equal set elements collapse to the first. */
    union: boolean;
    /** The run's platforms, which the merge function compiles with. */
    platformFns: PlatformFunction[];
}

/** Out-of-order Set/Dict emission buffers and spills sorted runs once the
 *  buffered entries reach this many (`EAST_EMIT_RUN_ELEMENTS` overrides)... */
const EMIT_RUN_ELEMENTS_DEFAULT = 100_000;

/** ...or their encoded bytes reach this many (`EAST_EMIT_RUN_BYTES`
 *  overrides) — the in-memory bound of the sink's spill/merge path (issues
 *  #518, #770). */
const EMIT_RUN_BYTES_DEFAULT = 64 * 1024 * 1024;

/** At most this many sources feed one merge; more runs merge in passes. */
const EMIT_MERGE_FANIN = 64;

/** The buffer a raw run is written and read back through. */
const RUN_IO_BUFFER_BYTES = 1024 * 1024;

/**
 * A positive size from the environment variable `name`: digits only, at
 * least 1 — anything else (a sign, an exponent, a fraction, a suffix) is
 * `fallback`, as east-c and east-py parse it.
 *
 * @param name - the environment variable
 * @param fallback - the value when the variable is unset or unusable
 * @returns the size
 */
function emitSizeFromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw !== undefined && /^[0-9]+$/.test(raw)) {
        const value = Number(raw);
        if (Number.isSafeInteger(value) && value >= 1) return value;
    }
    return fallback;
}

/**
 * Loads the `--merge` function: an IR file holding a `(K, V, V) -> V` East
 * function over the emit parameter's key and value types, compiled with the
 * run's platforms.
 *
 * @param path - the IR file (any format the IR positional accepts)
 * @param keyType - the emit parameter's key type
 * @param valueType - the emit parameter's value type
 * @param platformFns - the run's platforms
 * @returns the compiled merge function
 * @throws {Error} When the IR is not a function of that shape, naming the
 *   expected and the actual types.
 */
function loadMergeFunction(path: string, keyType: EastTypeValue, valueType: EastTypeValue, platformFns: PlatformFunction[]): (key: unknown, acc: unknown, value: unknown) => unknown {
    const bundle = loadEastIR(path);
    const fnType = (bundle.ir as any).value.type as EastTypeValue;
    const shape = fnType.type === 'Function' ? fnType.value as { inputs: EastTypeValue[]; output: EastTypeValue } : null;
    if (shape === null || shape.inputs.length !== 3 ||
        !isTypeValueEqual(shape.inputs[0]!, keyType) ||
        !isTypeValueEqual(shape.inputs[1]!, valueType) ||
        !isTypeValueEqual(shape.inputs[2]!, valueType) ||
        !isTypeValueEqual(shape.output, valueType)) {
        throw new Error(
            `--merge: expected a function (K, V, V) -> V matching the emit parameter ` +
            `(K = ${printTypeValue(keyType)}, V = ${printTypeValue(valueType)}), got ${printTypeValue(fnType)}`,
        );
    }
    return (bundle as EastIR<any, any>).compile(platformFns) as (key: unknown, acc: unknown, value: unknown) => unknown;
}

/** Writes all of `bytes` to `fd` — `writeSync` may write fewer bytes than
 *  asked, and a silently short write would corrupt the file. */
function writeAll(fd: number, bytes: Uint8Array): void {
    let written = 0;
    while (written < bytes.length) {
        written += writeSync(fd, bytes, written, bytes.length - written);
    }
}

/** The raw run record format — `varint(keyLen) keyBytes varint(valueLen)
 *  valueBytes` — written through a buffer with a `writeSync` loop. The
 *  sink's own temporary format, not beast2. */
class RunFileWriter {
    private readonly fd: number;
    private readonly buffer = Buffer.allocUnsafe(RUN_IO_BUFFER_BYTES);
    private used = 0;

    constructor(path: string) {
        this.fd = openSync(path, 'w');
    }

    /** Appends one record; returns its key and value bytes. */
    write(keyBytes: Uint8Array, valueBytes: Uint8Array | null): number {
        this.varint(keyBytes.length);
        this.bytes(keyBytes);
        const value = valueBytes ?? new Uint8Array(0);
        this.varint(value.length);
        this.bytes(value);
        return keyBytes.length + value.length;
    }

    /** Flushes and closes the file. */
    close(): void {
        try {
            this.drain();
        } finally {
            closeSync(this.fd);
        }
    }

    private varint(n: number): void {
        if (this.buffer.length - this.used < 10) this.drain();
        while (n >= 0x80) {
            this.buffer[this.used++] = (n % 0x80) | 0x80;
            n = Math.floor(n / 0x80);
        }
        this.buffer[this.used++] = n;
    }

    private bytes(data: Uint8Array): void {
        if (data.length > this.buffer.length - this.used) {
            this.drain();
            if (data.length > this.buffer.length) {
                writeAll(this.fd, data);
                return;
            }
        }
        this.buffer.set(data, this.used);
        this.used += data.length;
    }

    private drain(): void {
        if (this.used === 0) return;
        writeAll(this.fd, this.buffer.subarray(0, this.used));
        this.used = 0;
    }
}

/** Reads raw run records back sequentially through a buffer. */
class RunFileReader {
    private readonly fd: number;
    private readonly buffer = Buffer.allocUnsafe(RUN_IO_BUFFER_BYTES);
    private start = 0;
    private end = 0;
    private position = 0;

    constructor(path: string) {
        this.fd = openSync(path, 'r');
    }

    /** The next record, or `null` at a clean end of the run. */
    next(): { keyBytes: Uint8Array; valueBytes: Uint8Array } | null {
        const keyLength = this.varint(true);
        if (keyLength === null) return null;
        const keyBytes = this.bytes(keyLength);
        const valueBytes = this.bytes(this.varint(false)!);
        return { keyBytes, valueBytes };
    }

    close(): void {
        closeSync(this.fd);
    }

    /** Makes at least `min` bytes available unless the run ends first;
     *  returns how many are. */
    private fill(min: number): number {
        if (this.end - this.start >= min) return this.end - this.start;
        if (this.start > 0) {
            this.buffer.copy(this.buffer, 0, this.start, this.end);
            this.end -= this.start;
            this.start = 0;
        }
        while (this.end < min && this.end < this.buffer.length) {
            const n = readSync(this.fd, this.buffer, this.end, this.buffer.length - this.end, this.position);
            if (n === 0) break;
            this.end += n;
            this.position += n;
        }
        return this.end;
    }

    private varint(atRecordStart: boolean): number | null {
        let value = 0;
        let scale = 1;
        for (let i = 0; i < 10; i++) {
            if (this.fill(1) === 0) {
                if (atRecordStart && i === 0) return null;
                throw new Error('emit: a spilled run is truncated or corrupt');
            }
            const byte = this.buffer[this.start++]!;
            value += (byte & 0x7f) * scale;
            if ((byte & 0x80) === 0) return value;
            scale *= 0x80;
        }
        throw new Error('emit: a spilled run is truncated or corrupt');
    }

    private bytes(length: number): Uint8Array {
        const out = new Uint8Array(length);
        let done = Math.min(length, this.end - this.start);
        out.set(this.buffer.subarray(this.start, this.start + done), 0);
        this.start += done;
        if (done < length && length - done <= this.buffer.length) {
            const available = this.fill(length - done);
            const take = Math.min(available, length - done);
            out.set(this.buffer.subarray(this.start, this.start + take), done);
            this.start += take;
            done += take;
        }
        while (done < length) {
            // A record wider than the buffer reads straight into its own bytes.
            const n = readSync(this.fd, out, done, length - done, this.position);
            if (n === 0) throw new Error('emit: a spilled run is truncated or corrupt');
            done += n;
            this.position += n;
        }
        return out;
    }
}

/** One buffered out-of-order emission, encoded at the emit: the decoded key
 *  orders the run, and the key and value are standalone beast2 blobs — what
 *  the byte cap measures — so the emitted value itself is released at once.
 *  `seq` is the emission's position in the stream: entries order by
 *  (key, seq), so equal keys fold in emission order. */
interface PendingEntry {
    key: unknown;
    seq: number;
    keyBytes: Uint8Array;
    valueBytes: Uint8Array | null;
}

/** A merge source's current entry: its decoded key, and its key and value
 *  as bytes (raw runs and the tail) or decoded (the demoted prefix). */
interface MergeEntry {
    key: unknown;
    keyBytes: Uint8Array | null;
    valueBytes: Uint8Array | null;
    value: unknown;
}

/** One merge source: its current entry (`null` once exhausted). */
interface MergeSource {
    head: MergeEntry | null;
    advance: () => void;
    close: () => void;
}

/** A run the finish merges: the demoted beast2 prefix, or a raw run. */
interface RunFile {
    path: string;
    prefix: boolean;
}

/**
 * Builds the emit capability: a host function value that re-batches elements
 * byte-adaptively and appends segments to the output file through a
 * streaming writer.
 *
 * Emission order is unconstrained (issue #518). While Set/Dict emissions
 * stay strictly ascending in East (key) order, segments stream straight to
 * the output file — O(batch) memory, byte-identical to an always-ascending
 * producer. On the first out-of-order key the file written so far is
 * finalized (a complete canonical beast2 file of the prefix) and demoted to
 * spill run #0; emissions then encode as they arrive and spill as sorted raw
 * runs beside the output once they reach the element cap
 * (`EAST_EMIT_RUN_ELEMENTS`) or the byte cap (`EAST_EMIT_RUN_BYTES`), and
 * `finish` merges the runs and the tail into the canonical output through a
 * binary heap, at most 64 sources at once — more runs merge in passes into
 * intermediate runs `<output>.run<N>.p<pass>`, the tail joining only the
 * final pass. No run is read whole, so the sink's memory is bounded by the
 * caps rather than the output's size.
 *
 * Duplicate Set/Dict keys are a hard error in every path — immediately when
 * adjacent in the stream, at spill/merge time otherwise — unless the sink
 * folds them (issue #770): with a merge function equal dict keys fold left in
 * emission order, `acc = merge(key, acc, value)`; with union equal set
 * elements collapse to the first. The output is then byte-identical to what
 * the non-folding sink writes for the already-folded sequence. The sink may
 * fold part of a key's emissions before combining it with the rest, so the
 * merge function must be associative.
 */
function createEmitSink(kind: 'array' | 'set' | 'dict', emitParamType: EastTypeValue, outputPath: string, verbose: boolean, fold: EmitFoldOptions): EmitSink {
    if (emitParamType.type !== 'Function') {
        throw new Error(`--emit requires the function's trailing parameter to be the emit capability (a function type), got ${emitParamType.type}`);
    }
    const emitInputs = (emitParamType as any).value.inputs as EastTypeValue[];
    const expectedArity = kind === 'dict' ? 2 : 1;
    if (emitInputs.length !== expectedArity) {
        throw new Error(`--emit ${kind} expects an emit parameter taking ${expectedArity} argument(s), got ${emitInputs.length}`);
    }
    if (fold.mergePath !== undefined && kind !== 'dict') {
        throw new Error('--merge applies to --emit dict only');
    }
    if (fold.union && kind !== 'set') {
        throw new Error('--union applies to --emit set only');
    }
    const merge = fold.mergePath !== undefined
        ? loadMergeFunction(fold.mergePath, emitInputs[0]!, emitInputs[1]!, fold.platformFns)
        : null;
    const folds = merge !== null || fold.union;

    // The output collection's wire type is reconstructed from the emit
    // parameter's argument types.
    const outTypeValue: EastTypeValue =
        kind === 'dict' ? variant('Dict', { key: emitInputs[0]!, value: emitInputs[1]! }) as EastTypeValue :
        kind === 'set' ? variant('Set', emitInputs[0]!) as EastTypeValue :
        variant('Array', emitInputs[0]!) as EastTypeValue;

    /** Opens a streaming file writer: header at open, terminator + index at
     *  `finishClose` — every finished file is a complete canonical blob. */
    function openFileWriter(path: string, parallel = false): {
        writer: Beast2Writer;
        nextBatch: (elements: number) => number;
        finishClose: () => void;
        closeAbandoned: () => void;
    } {
        const fd = openSync(path, 'w');
        let headerBytes = -1;
        const writer = new Beast2Writer(outTypeValue, (bytes) => {
            writeAll(fd, bytes);
            if (headerBytes < 0) headerBytes = bytes.length;
        }, { parallel });
        const refine = (bytes: number, elements: number): number => {
            const avg = Math.max(1, Math.max(1, bytes - Math.max(0, headerBytes)) / elements);
            return Math.max(1, Math.min(BEAST2_PAGED_BATCH_DEFAULT, Math.floor(BEAST2_PAGED_TARGET_BYTES_DEFAULT / avg)));
        };
        return {
            writer,
            // The next batch size after `elements` have been written. With
            // frames deflating on workers (#763) the bytes written are only
            // known within bounds; the refinement is monotone in them, so
            // agreeing bounds are the serial decision and disagreeing ones
            // wait for the frames — the segmentation never depends on timing.
            nextBatch: (elements) => {
                const { lo, hi } = writer.emittedBounds();
                const next = refine(lo, elements);
                if (next === refine(hi, elements)) return next;
                writer.settle();
                return refine(writer.emittedBounds().lo, elements);
            },
            finishClose: () => { writer.finish(); closeSync(fd); },
            closeAbandoned: () => { closeSync(fd); },
        };
    }

    // Canonical-order tracking per element, ahead of the writer's own
    // batch-level check, so an adjacent duplicate names the offending emit
    // call and can never collapse silently inside a batch container.
    const orderCmp = kind === 'array' ? null : compareFor(emitInputs[0] as any) as (a: unknown, b: unknown) => number;
    const printKey = kind === 'array' ? null : printFor(emitInputs[0] as any) as (v: unknown) => string;
    const duplicateMessage = (key: unknown): string => {
        const noun = kind === 'dict' ? 'Dict' : 'Set';
        const part = kind === 'dict' ? 'key' : 'element';
        return `beast2 v5: duplicate ${noun} ${part} emitted: ${printKey!(key)} — ${noun} ${part}s must be unique`;
    };
    const toValue = (items: unknown[]): unknown =>
        kind === 'dict' ? new Map(items as [unknown, unknown][]) : kind === 'set' ? new Set(items) : items;

    // Standalone beast2 blobs for buffered keys and values (Set/Dict sinks
    // only — an Array sink never leaves the ascending path).
    const encodeKey = kind === 'array' ? null : encodeBeast2For(emitInputs[0]!);
    const decodeKey = kind === 'array' ? null : decodeBeast2For(emitInputs[0]!);
    const encodeValue = kind === 'dict' ? encodeBeast2For(emitInputs[1]!) : null;
    const decodeValue = kind === 'dict' ? decodeBeast2For(emitInputs[1]!) : null;

    let out = openFileWriter(outputPath, true);
    let hasLast = false;
    let lastKey: unknown;
    let emitted = 0;

    // Byte-adaptive re-batching toward the paged-encode segment target,
    // refined from the writer's actual output as segments flush.
    let batch: unknown[] = [];
    let written = 0;
    let nextBatch = BEAST2_PAGED_BATCH_DEFAULT;
    const flush = (): void => {
        if (batch.length === 0) return;
        out.writer.write(toValue(batch) as never);
        written += batch.length;
        batch = [];
        nextBatch = out.nextBatch(written);
    };

    // Out-of-order (spill/merge) state; `buffered` false means the ascending
    // fast path is still live.
    let buffered = false;
    let pending: PendingEntry[] = [];
    let pendingBytes = 0;
    const runs: RunFile[] = [];
    const runCap = emitSizeFromEnv('EAST_EMIT_RUN_ELEMENTS', EMIT_RUN_ELEMENTS_DEFAULT);
    const runBytes = emitSizeFromEnv('EAST_EMIT_RUN_BYTES', EMIT_RUN_BYTES_DEFAULT);

    // The -v epilogue's account of the buffered path.
    let spills = 0;
    let peakEntries = 0;
    let peakBytes = 0;
    let spillMs = 0;

    /** Sorts entries by (key, emission sequence) and folds each run of equal
     *  keys to one entry in emission order — merge folds the values and
     *  re-encodes the result, union keeps the first — or, without a fold,
     *  throws the duplicate error naming the second. */
    const sortPending = (entries: PendingEntry[]): PendingEntry[] => {
        entries.sort((a, b) => orderCmp!(a.key, b.key) || a.seq - b.seq);
        const folded: PendingEntry[] = [];
        for (let i = 0; i < entries.length;) {
            let j = i + 1;
            while (j < entries.length && orderCmp!(entries[i]!.key, entries[j]!.key) === 0) j++;
            if (j - i > 1 && !folds) throw new Error(duplicateMessage(entries[i + 1]!.key));
            if (j - i > 1 && merge !== null) {
                const first = entries[i]!;
                let acc = decodeValue!(first.valueBytes!);
                for (let k = i + 1; k < j; k++) acc = merge(first.key, acc, decodeValue!(entries[k]!.valueBytes!));
                folded.push({ key: first.key, seq: first.seq, keyBytes: first.keyBytes, valueBytes: encodeValue!(acc) });
            } else {
                folded.push(entries[i]!);
            }
            i = j;
        }
        return folded;
    };

    const spill = (): void => {
        if (pending.length === 0) return;
        const started = verbose ? performance.now() : 0;
        const sorted = sortPending(pending);
        const path = `${outputPath}.run${runs.length}`;
        const run = new RunFileWriter(path);
        try {
            for (const entry of sorted) run.write(entry.keyBytes, entry.valueBytes);
        } finally {
            run.close();
        }
        runs.push({ path, prefix: false });
        spills++;
        pending = [];
        pendingBytes = 0;
        if (verbose) spillMs += performance.now() - started;
    };

    const demote = (): void => {
        // The prefix written so far is ascending, so finishing the writer
        // yields a complete canonical beast2 file — demote it to run #0 and
        // switch to buffered (sort-in-the-sink) emission.
        flush();
        out.finishClose();
        const run0 = `${outputPath}.run0`;
        renameSync(outputPath, run0);
        if (written > 0) {
            runs.push({ path: run0, prefix: true });
        } else {
            unlinkSync(run0);
        }
        buffered = true;
        console.error(
            `east emit: ${kind === 'dict' ? 'Dict keys' : 'Set elements'} left ascending order at ` +
            `element ${emitted}; establishing canonical order in the sink (spill/merge)`
        );
    };

    /** A raw run, read record by record through its buffer. */
    const rawSource = (path: string): MergeSource => {
        const reader = new RunFileReader(path);
        const source: MergeSource = {
            head: null,
            advance: () => {
                const record = reader.next();
                source.head = record === null ? null : {
                    key: decodeKey!(record.keyBytes),
                    keyBytes: record.keyBytes,
                    valueBytes: kind === 'dict' ? record.valueBytes : null,
                    value: undefined,
                };
            },
            close: () => reader.close(),
        };
        return source;
    };

    /** The demoted prefix, read segment by segment from its file descriptor. */
    const prefixSource = (path: string): MergeSource => {
        const fd = openSync(path, 'r');
        const reader: Beast2SyncRangeReader = {
            size: fstatSync(fd).size,
            read(offset, length) {
                const bytes = new Uint8Array(length);
                let done = 0;
                while (done < length) {
                    const n = readSync(fd, bytes, done, length - done, offset + done);
                    if (n === 0) throw new Error(`beast2: short read at offset ${offset + done}`);
                    done += n;
                }
                return bytes;
            },
        };
        const lazy = openBeast2LazyFor(outTypeValue)(reader) as Map<unknown, unknown> | Set<unknown>;
        const entries: Iterator<unknown> = kind === 'dict'
            ? (lazy as Map<unknown, unknown>).entries()
            : (lazy as Set<unknown>).keys();
        const source: MergeSource = {
            head: null,
            advance: () => {
                const next = entries.next();
                if (next.done) {
                    source.head = null;
                } else if (kind === 'dict') {
                    const [key, value] = next.value as [unknown, unknown];
                    source.head = { key, keyBytes: null, valueBytes: null, value };
                } else {
                    source.head = { key: next.value, keyBytes: null, valueBytes: null, value: undefined };
                }
            },
            close: () => closeSync(fd),
        };
        return source;
    };

    /** The sorted in-memory tail. */
    const tailSource = (entries: PendingEntry[]): MergeSource => {
        let index = 0;
        const source: MergeSource = {
            head: null,
            advance: () => {
                const entry = entries[index++];
                source.head = entry === undefined ? null : { key: entry.key, keyBytes: entry.keyBytes, valueBytes: entry.valueBytes, value: undefined };
            },
            close: () => {},
        };
        return source;
    };

    const openSource = (run: RunFile): MergeSource => {
        const source = run.prefix ? prefixSource(run.path) : rawSource(run.path);
        try {
            source.advance();
        } catch (err) {
            source.close();
            throw err;
        }
        return source;
    };

    /** An entry's value, decoded at most once. */
    const valueOf = (entry: MergeEntry): unknown =>
        entry.valueBytes !== null ? decodeValue!(entry.valueBytes) : entry.value;

    /**
     * Merges `sources`, given in emission order, into `put`: a binary
     * min-heap ordered by (key, source index), so equal keys leave in
     * emission order. Equal keys fold — a merge function holds the current
     * key's entry until a greater key arrives, folding each equal one into
     * it; union keeps the first — or, without a fold, are the duplicate
     * error.
     */
    const mergeSources = (sources: MergeSource[], put: (entry: MergeEntry, folded: { value: unknown } | null) => void): void => {
        const heap: number[] = [];
        for (let i = 0; i < sources.length; i++) if (sources[i]!.head !== null) heap.push(i);
        const before = (a: number, b: number): boolean => {
            const order = orderCmp!(sources[a]!.head!.key, sources[b]!.head!.key);
            return order < 0 || (order === 0 && a < b);
        };
        const siftDown = (at: number): void => {
            for (;;) {
                const l = 2 * at + 1;
                const r = l + 1;
                let least = at;
                if (l < heap.length && before(heap[l]!, heap[least]!)) least = l;
                if (r < heap.length && before(heap[r]!, heap[least]!)) least = r;
                if (least === at) return;
                [heap[at], heap[least]] = [heap[least]!, heap[at]!];
                at = least;
            }
        };
        for (let i = (heap.length >> 1) - 1; i >= 0; i--) siftDown(i);

        let prevKey: unknown;
        let hasPrev = false;
        let held: MergeEntry | null = null;
        let heldFold: { value: unknown } | null = null;
        while (heap.length > 0) {
            const source = sources[heap[0]!]!;
            const entry = source.head!;
            if (hasPrev && orderCmp!(prevKey, entry.key) === 0) {
                if (!folds) throw new Error(duplicateMessage(entry.key));
                if (merge !== null) {
                    const acc: unknown = heldFold !== null ? heldFold.value : valueOf(held!);
                    heldFold = { value: merge(entry.key, acc, valueOf(entry)) };
                }
                // Union: the first element stands; the equal one is dropped.
            } else {
                prevKey = entry.key;
                hasPrev = true;
                if (merge !== null) {
                    if (held !== null) put(held, heldFold);
                    held = entry;
                    heldFold = null;
                } else {
                    put(entry, null);
                }
            }
            source.advance();
            if (source.head === null) {
                heap[0] = heap[heap.length - 1]!;
                heap.pop();
            }
            if (heap.length > 0) siftDown(0);
        }
        if (held !== null) put(held, heldFold);
    };

    const mergeRuns = (): void => {
        const started = verbose ? performance.now() : 0;
        const tail = sortPending(pending);
        pending = [];
        pendingBytes = 0;
        const hasTail = tail.length > 0;
        const temporary = runs.map((run) => run.path);
        const sourceCount = runs.length + (hasTail ? 1 : 0);
        let level: RunFile[] = runs.slice();
        let passes = 0;
        let width = 0;

        while (level.length + (hasTail ? 1 : 0) > EMIT_MERGE_FANIN) {
            passes++;
            const next: RunFile[] = [];
            for (let g = 0; g < level.length; g += EMIT_MERGE_FANIN) {
                const group = level.slice(g, g + EMIT_MERGE_FANIN);
                if (group.length === 1 && !group[0]!.prefix) {
                    next.push(group[0]!);
                    continue;
                }
                const path = `${outputPath}.run${next.length}.p${passes}`;
                temporary.push(path);
                const writer = new RunFileWriter(path);
                const sources: MergeSource[] = [];
                try {
                    for (const run of group) sources.push(openSource(run));
                    mergeSources(sources, (entry, folded) => {
                        writer.write(
                            entry.keyBytes ?? encodeKey!(entry.key),
                            kind !== 'dict' ? null
                                : folded !== null ? encodeValue!(folded.value)
                                : entry.valueBytes ?? encodeValue!(entry.value),
                        );
                    });
                } finally {
                    for (const source of sources) source.close();
                    writer.close();
                }
                width = Math.max(width, group.length);
                for (const run of group) unlinkSync(run.path);
                next.push({ path, prefix: false });
            }
            level = next;
        }
        passes++;
        width = Math.max(width, level.length + (hasTail ? 1 : 0));

        // The final pass writes the output through a fresh writer, so its
        // batch refinement starts afresh, as a new sink's does.
        out = openFileWriter(outputPath, true);
        let finished = false;
        const sources: MergeSource[] = [];
        try {
            for (const run of level) sources.push(openSource(run));
            if (hasTail) {
                const source = tailSource(tail);
                source.advance();
                sources.push(source);
            }
            let mergedBatch: unknown[] = [];
            let merged = 0;
            let next = BEAST2_PAGED_BATCH_DEFAULT;
            mergeSources(sources, (entry, folded) => {
                mergedBatch.push(kind === 'dict'
                    ? [entry.key, folded !== null ? folded.value : valueOf(entry)]
                    : entry.key);
                if (mergedBatch.length >= next) {
                    out.writer.write(toValue(mergedBatch) as never);
                    merged += mergedBatch.length;
                    mergedBatch = [];
                    next = out.nextBatch(merged);
                }
            });
            if (mergedBatch.length > 0) out.writer.write(toValue(mergedBatch) as never);
            out.finishClose();
            finished = true;
        } finally {
            for (const source of sources) source.close();
            // An error (a cross-run duplicate, a failing merge function)
            // leaves the partial output unfinalized — no terminator or
            // index — exactly like an error on the straight-through path.
            if (!finished) out.closeAbandoned();
        }
        for (const path of temporary) {
            try {
                unlinkSync(path);
            } catch {
                // A pass already removed the runs it read.
            }
        }
        if (verbose) {
            const mergeMs = performance.now() - started;
            console.error(
                `  emit: merged ${sourceCount} source(s) in ${passes} pass(es) (${width} runs per pass); ` +
                `${spills} spill(s), peak ${peakEntries} entries / ${formatSize(peakBytes)} buffered, ` +
                `spill ${spillMs.toFixed(1)} ms, merge ${mergeMs.toFixed(1)} ms`
            );
        }
    };

    const emit = (...args: unknown[]): null => {
        if (buffered) {
            const key = args[0];
            const keyBytes = encodeKey!(key);
            const valueBytes = kind === 'dict' ? encodeValue!(args[1]) : null;
            pending.push({ key, seq: emitted, keyBytes, valueBytes });
            pendingBytes += keyBytes.length + (valueBytes?.length ?? 0);
            if (pending.length > peakEntries) peakEntries = pending.length;
            if (pendingBytes > peakBytes) peakBytes = pendingBytes;
            emitted++;
            if (pending.length >= runCap || pendingBytes >= runBytes) spill();
            return null;
        }
        const key = args[0];
        if (orderCmp !== null && hasLast) {
            const order = orderCmp(lastKey, key);
            if (order === 0 && fold.union) {
                // The first element stands.
                emitted++;
                return null;
            }
            if (order === 0 && merge !== null) {
                // The flush rule keeps the last entry in the open batch, so
                // the fold lands in place.
                const last = batch[batch.length - 1] as [unknown, unknown];
                batch[batch.length - 1] = [last[0], merge(key, last[1], args[1])];
                emitted++;
                return null;
            }
            if (order === 0) throw new Error(duplicateMessage(key));
            if (order > 0) {
                demote();
                return emit(...args);
            }
        }
        // The flush rule: a full batch goes out only now that an element
        // which will not fold into it has arrived.
        if (batch.length >= nextBatch) flush();
        batch.push(kind === 'dict' ? [key, args[1]] : key);
        if (orderCmp !== null) {
            lastKey = key;
            hasLast = true;
        }
        emitted++;
        return null;
    };

    return {
        emit,
        finish: () => {
            if (!buffered) {
                flush();
                out.finishClose();
                return;
            }
            mergeRuns();
        },
    };
}

/** Finalizes the emit sink and reports the output like the return-value path. */
function finishEmit(sink: EmitSink, outputPath: string, verbose: boolean): bigint {
    sink.finish();
    const t = now();
    if (verbose) {
        console.error(`Output: ${outputPath}  (${formatFileSize(outputPath)})`);
    }
    return t;
}

function maybeWriteOutput(outputPath: string | undefined, result: unknown, outputType: EastTypeValue | null, verbose: boolean): bigint {
    if (!outputPath) {
        // Print to stdout as .east format (matches east-c / east-py)
        if (outputType) {
            const printer = printFor(outputType as any);
            console.log(printer(result));
        }
        return now();
    }
    if (!outputType) return now();
    writeOutput(outputPath, result, outputType);
    const t = now();
    if (verbose) {
        console.error(`Output: ${outputPath}  (${formatFileSize(outputPath)})`);
        console.error(`  ${printTypeValue(outputType)}`);
    }
    return t;
}

function printTimingAndMemory(t0: bigint, t1: bigint, t2: bigint, t3: bigint, t4: bigint, t5: bigint): void {
    console.error('\nTiming:');
    console.error(`  Load:     ${elapsed(t0, t1).toFixed(1).padStart(8)} ms`);
    console.error(`  Compile:  ${elapsed(t1, t2).toFixed(1).padStart(8)} ms`);
    console.error(`  Execute:  ${elapsed(t2, t3).toFixed(1).padStart(8)} ms`);
    console.error(`  Output:   ${elapsed(t3, t4).toFixed(1).padStart(8)} ms`);
    console.error(`  Total:    ${elapsed(t0, t5).toFixed(1).padStart(8)} ms`);

    const rssBytes = process.memoryUsage().rss;
    const rssMB = rssBytes / (1024 * 1024);
    console.error('\nMemory:');
    console.error(`  Peak RSS: ${rssMB.toFixed(1).padStart(8)} MB`);
}

/** Whether an output root type is a collection (Array/Set/Dict). */
function isCollectionRoot(type: EastTypeValue): boolean {
    return type.type === 'Array' || type.type === 'Set' || type.type === 'Dict';
}

function writeOutput(filePath: string, value: unknown, type: unknown): void {
    const ext = extname(filePath).toLowerCase();
    switch (ext) {
        case '.beast2':
        case '.beast': {
            // Collection-rooted outputs are ALWAYS segmented + indexed
            // (byte-adaptive segments) so e3's paged dataset reads can seek —
            // one uniform encoding per logical value, at every size.
            const encoder = isCollectionRoot(type as EastTypeValue)
                ? encodeBeast2PagedFor(type as any)
                : encodeBeast2For(type as any);
            writeFileSync(filePath, encoder(value));
            break;
        }
        case '.east': {
            const encoder = encodeEastFor(type as any);
            writeFileSync(filePath, encoder(value));
            break;
        }
        case '.json': {
            const encoder = encodeJSONFor(type as any);
            writeFileSync(filePath, encoder(value));
            break;
        }
        default:
            throw new Error(
                `Unsupported output file extension "${ext}". ` +
                `Supported extensions: .beast2, .beast, .east, .json`,
            );
    }
}
