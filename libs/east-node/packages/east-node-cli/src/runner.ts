/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { closeSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'fs';
import { extname } from 'path';
import {
    EastIR,
    Beast2Writer,
    BEAST2_PAGED_BATCH_DEFAULT,
    BEAST2_PAGED_TARGET_BYTES_DEFAULT,
    compareFor,
    encodeBeast2For,
    encodeBeast2PagedFor,
    encodeEastFor,
    encodeJSONFor,
    iterBeast2SegmentsFor,
    printFor,
    variant,
} from '@elaraai/east';
import type { PlatformFunction, EastTypeValue } from '@elaraai/east/internal';
import { printTypeValue } from '@elaraai/east/internal';
import { loadEastIR, loadInput, loadInputLazy } from './loader.js';

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
    /** Feed the given `-i` input (0-based) lazily — segment-by-segment
     *  iteration with O(segment) decoded memory — regardless of size.
     *  Element shapes the lazy contract excludes (nested mutable
     *  containers, vectors/matrices, functions) decode whole instead. */
    streamInput?: number;
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
    if (opts.streamInput !== undefined && (opts.streamInput < 0 || opts.streamInput >= inputPaths.length)) {
        throw new Error(`--stream index ${opts.streamInput} out of range (${inputPaths.length} inputs)`);
    }

    const emitSink = opts.emit !== undefined
        ? createEmitSink(opts.emit, inputTypes[inputTypes.length - 1] as EastTypeValue, outputPath!, verbose)
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

    // Load inputs. The streamed input always opens lazily; other beast2
    // collection inputs open lazily at or above the size threshold, so a
    // sparse read into a huge indexed input stops paying a whole decode.
    const threshold = lazyThreshold(opts);
    const inputs: unknown[] = [];
    for (let i = 0; i < inputPaths.length; i++) {
        const wantLazy = i === opts.streamInput ||
            (threshold > 0 && statSync(inputPaths[i]!).size >= threshold);
        const lazy = wantLazy ? loadInputLazy(inputPaths[i]!) : undefined;
        inputs.push(lazy !== undefined ? lazy : loadInput(inputPaths[i]!, inputTypes[i]!));
    }
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

        if (verbose) printTimingAndMemory(t0, t1, t2, t3, t4, t5);
    } else {
        const compiled = (eastIR as any).compile(platformFns);
        const t2 = now();

        result = await compiled(...inputs);
        const t3 = now();

        const t4 = emitSink
            ? finishEmit(emitSink, outputPath!, verbose)
            : maybeWriteOutput(outputPath, result, outputType, verbose);
        const t5 = now();

        if (verbose) printTimingAndMemory(t0, t1, t2, t3, t4, t5);
    }

    return outputPath ? undefined : result;
}

/** An emit capability wired to a streaming beast2 writer on the output file. */
interface EmitSink {
    /** The function value passed as the body's trailing parameter. */
    emit: (...args: unknown[]) => null;
    /** Flushes pending elements and finalizes the blob (terminator + index). */
    finish: () => void;
}

/** Out-of-order Set/Dict emission buffers and spills sorted runs of at most
 *  this many elements (`EAST_EMIT_RUN_ELEMENTS` overrides; minimum 1) — the
 *  in-memory bound of the sink's spill/merge path (issue #518). */
const EMIT_RUN_ELEMENTS_DEFAULT = 100_000;

/** Resolves the spill-run element cap: environment override, else the
 *  default. Invalid or sub-1 values fall back, matching east-py / east-c. */
function emitRunElements(): number {
    const raw = process.env.EAST_EMIT_RUN_ELEMENTS;
    if (raw !== undefined && raw !== '') {
        const env = Number(raw);
        if (Number.isInteger(env) && env >= 1) return env;
    }
    return EMIT_RUN_ELEMENTS_DEFAULT;
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
 * spill run #0; emissions then buffer to a bounded element cap
 * (`EAST_EMIT_RUN_ELEMENTS`) and spill as sorted runs beside the output, and
 * `finish` k-way merges runs + tail into the canonical output. Duplicate
 * Set/Dict keys are a hard error in every path: immediately when adjacent in
 * the stream, at spill/merge time otherwise.
 */
function createEmitSink(kind: 'array' | 'set' | 'dict', emitParamType: EastTypeValue, outputPath: string, verbose: boolean): EmitSink {
    if (emitParamType.type !== 'Function') {
        throw new Error(`--emit requires the function's trailing parameter to be the emit capability (a function type), got ${emitParamType.type}`);
    }
    const emitInputs = (emitParamType as any).value.inputs as EastTypeValue[];
    const expectedArity = kind === 'dict' ? 2 : 1;
    if (emitInputs.length !== expectedArity) {
        throw new Error(`--emit ${kind} expects an emit parameter taking ${expectedArity} argument(s), got ${emitInputs.length}`);
    }

    // The output collection's wire type is reconstructed from the emit
    // parameter's argument types.
    const outTypeValue: EastTypeValue =
        kind === 'dict' ? variant('Dict', { key: emitInputs[0]!, value: emitInputs[1]! }) as EastTypeValue :
        kind === 'set' ? variant('Set', emitInputs[0]!) as EastTypeValue :
        variant('Array', emitInputs[0]!) as EastTypeValue;

    /** Opens a streaming file writer: header at open, terminator + index at
     *  `finishClose` — every finished file is a complete canonical blob. */
    function openFileWriter(path: string): {
        writer: Beast2Writer;
        bodyBytes: () => number;
        finishClose: () => void;
        closeAbandoned: () => void;
    } {
        const fd = openSync(path, 'w');
        let bytesWritten = 0;
        let headerBytes = -1;
        const writer = new Beast2Writer(outTypeValue, (bytes) => {
            // writeSync may return a short count; loop until the chunk is
            // fully on disk — a silently truncated write would corrupt the
            // blob while the process still exits 0.
            let written = 0;
            while (written < bytes.length) {
                written += writeSync(fd, bytes, written, bytes.length - written);
            }
            if (headerBytes < 0) headerBytes = bytes.length;
            bytesWritten += bytes.length;
        });
        return {
            writer,
            bodyBytes: () => Math.max(1, bytesWritten - Math.max(0, headerBytes)),
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
    const itemKey = (item: unknown): unknown => kind === 'dict' ? (item as [unknown, unknown])[0]! : item;
    const toValue = (items: unknown[]): unknown =>
        kind === 'dict' ? new Map(items as [unknown, unknown][]) : kind === 'set' ? new Set(items) : items;

    let out = openFileWriter(outputPath);
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
        const avg = Math.max(1, out.bodyBytes() / written);
        nextBatch = Math.max(1, Math.min(BEAST2_PAGED_BATCH_DEFAULT, Math.floor(BEAST2_PAGED_TARGET_BYTES_DEFAULT / avg)));
    };

    // Out-of-order (spill/merge) state; `buffer === null` means the
    // ascending fast path is still live.
    let buffer: unknown[] | null = null;
    const runs: string[] = [];
    const runCap = emitRunElements();
    let spilledBytes = 0;

    /** East-order sort of buffered items with the adjacent-duplicate check —
     *  equality is East equality (`compareFor`) throughout. */
    const sortRun = (items: unknown[]): unknown[] => {
        const sorted = items.slice().sort((a, b) => orderCmp!(itemKey(a), itemKey(b)));
        for (let i = 1; i < sorted.length; i++) {
            if (orderCmp!(itemKey(sorted[i - 1]), itemKey(sorted[i])) === 0) {
                throw new Error(duplicateMessage(itemKey(sorted[i])));
            }
        }
        return sorted;
    };

    const spill = (): void => {
        if (buffer!.length === 0) return;
        const sorted = sortRun(buffer!);
        const path = `${outputPath}.run${runs.length}`;
        const run = openFileWriter(path);
        for (let i = 0; i < sorted.length; i += BEAST2_PAGED_BATCH_DEFAULT) {
            run.writer.write(toValue(sorted.slice(i, i + BEAST2_PAGED_BATCH_DEFAULT)) as never);
        }
        run.finishClose();
        runs.push(path);
        spilledBytes += statSync(path).size;
        buffer = [];
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
            runs.push(run0);
            spilledBytes += statSync(run0).size;
        } else {
            unlinkSync(run0);
        }
        buffer = [];
        console.error(
            `east emit: ${kind === 'dict' ? 'Dict keys' : 'Set elements'} left ascending order at ` +
            `element ${emitted}; establishing canonical order in the sink (spill/merge)`
        );
    };

    const mergeRuns = (): void => {
        // K-way merge the spilled runs and the in-memory tail into the
        // canonical output — O(run cap + one decoded segment per run)
        // memory, with the cross-run duplicate check on the merged stream.
        const tail = buffer!.length > 0 ? sortRun(buffer!) : [];
        buffer = [];
        const iters: Iterator<unknown>[] = runs.map((path) => {
            const bytes = new Uint8Array(readFileSync(path));
            return (function* () {
                for (const segment of iterBeast2SegmentsFor(outTypeValue as any)(bytes)) {
                    if (kind === 'dict') yield* (segment as Map<unknown, unknown>).entries();
                    else yield* (segment as Iterable<unknown>);
                }
            })();
        });
        iters.push(tail[Symbol.iterator]());
        const heads: (IteratorResult<unknown>)[] = iters.map((it) => it.next());

        out = openFileWriter(outputPath);
        let finished = false;
        try {
            let prevKey: unknown;
            let hasPrev = false;
            let mergedBatch: unknown[] = [];
            let merged = 0;
            let next = BEAST2_PAGED_BATCH_DEFAULT;
            for (;;) {
                let min = -1;
                for (let i = 0; i < heads.length; i++) {
                    if (!heads[i]!.done && (min < 0 || orderCmp!(itemKey(heads[i]!.value), itemKey(heads[min]!.value)) < 0)) {
                        min = i;
                    }
                }
                if (min < 0) break;
                const item = heads[min]!.value;
                heads[min] = iters[min]!.next();
                const key = itemKey(item);
                if (hasPrev && orderCmp!(prevKey, key) === 0) throw new Error(duplicateMessage(key));
                prevKey = key;
                hasPrev = true;
                mergedBatch.push(item);
                if (mergedBatch.length >= next) {
                    out.writer.write(toValue(mergedBatch) as never);
                    merged += mergedBatch.length;
                    mergedBatch = [];
                    const avg = Math.max(1, out.bodyBytes() / merged);
                    next = Math.max(1, Math.min(BEAST2_PAGED_BATCH_DEFAULT, Math.floor(BEAST2_PAGED_TARGET_BYTES_DEFAULT / avg)));
                }
            }
            if (mergedBatch.length > 0) out.writer.write(toValue(mergedBatch) as never);
            out.finishClose();
            finished = true;
        } finally {
            // An error (a cross-run duplicate) leaves the partial output
            // unfinalized — no terminator or index — exactly like an error
            // on the straight-through path.
            if (!finished) out.closeAbandoned();
        }
        for (const path of runs) unlinkSync(path);
        if (verbose) {
            console.error(`  emit: merged ${runs.length} spilled run(s) + in-memory tail (${formatSize(spilledBytes)} temp)`);
        }
    };

    const emit = (...args: unknown[]): null => {
        if (buffer !== null) {
            buffer.push(kind === 'dict' ? [args[0], args[1]] : args[0]);
            emitted++;
            if (buffer.length >= runCap) spill();
            return null;
        }
        const key = args[0];
        if (orderCmp !== null && hasLast) {
            const order = orderCmp(lastKey, key);
            if (order === 0) throw new Error(duplicateMessage(key));
            if (order > 0) {
                demote();
                return emit(...args);
            }
        }
        if (orderCmp !== null) {
            lastKey = key;
            hasLast = true;
        }
        batch.push(kind === 'dict' ? [args[0], args[1]] : args[0]);
        emitted++;
        if (batch.length >= nextBatch) flush();
        return null;
    };

    return {
        emit,
        finish: () => {
            if (buffer === null) {
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
