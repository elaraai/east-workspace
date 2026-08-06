/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { closeSync, openSync, writeFileSync, writeSync, statSync } from 'fs';
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
     *  iteration with O(segment) decoded memory — regardless of size. */
    streamInput?: number;
    /** Open indexed beast2 collection inputs at or above this many bytes as
     *  lazy pager-backed values (0 disables). Defaults to 64 MiB, or the
     *  `EAST_LAZY_INPUT_BYTES` environment variable. */
    lazyInputBytes?: number;
}

/** Default size threshold above which collection inputs open lazily. */
const LAZY_INPUT_BYTES_DEFAULT = 64 * 1024 * 1024;

/** Resolves the lazy-open threshold: explicit option, else environment, else
 *  the default. */
function lazyThreshold(options: RunProgramOptions): number {
    if (options.lazyInputBytes !== undefined) return options.lazyInputBytes;
    const env = Number(process.env.EAST_LAZY_INPUT_BYTES ?? '');
    if (Number.isFinite(env) && env >= 0) return env;
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
    // beyond the input files: the emit capability.
    const fileParamCount = opts.emit !== undefined ? inputTypes.length - 1 : inputTypes.length;
    if (inputPaths.length !== fileParamCount) {
        throw new Error(
            `Function expects ${fileParamCount} input(s), but ${inputPaths.length} input file(s) provided`,
        );
    }
    if (opts.emit !== undefined && outputPath === undefined) {
        throw new Error(`--emit requires an output file (-o)`);
    }
    if (opts.streamInput !== undefined && (opts.streamInput < 0 || opts.streamInput >= inputPaths.length)) {
        throw new Error(`--stream index ${opts.streamInput} out of range (${inputPaths.length} inputs)`);
    }

    const emitSink = opts.emit !== undefined
        ? createEmitSink(opts.emit, inputTypes[inputTypes.length - 1] as EastTypeValue, outputPath!)
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

/**
 * Builds the emit capability: a host function value that validates the
 * canonical emission order (strictly ascending Set elements / Dict keys),
 * re-batches elements byte-adaptively, and appends segments to the output
 * file through a streaming writer — O(batch) memory end to end.
 */
function createEmitSink(kind: 'array' | 'set' | 'dict', emitParamType: EastTypeValue, outputPath: string): EmitSink {
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

    const fd = openSync(outputPath, 'w');
    let bytesWritten = 0;
    let headerBytes = -1;
    const writer = new Beast2Writer(outTypeValue, (bytes) => {
        writeSync(fd, bytes);
        if (headerBytes < 0) headerBytes = bytes.length;
        bytesWritten += bytes.length;
    });

    // Canonical-order enforcement per element, ahead of the writer's own
    // batch-level check, so a violation names the offending emit call and a
    // duplicate key cannot collapse silently inside a batch container.
    const orderCmp = kind === 'array' ? null : compareFor(emitInputs[0] as any) as (a: unknown, b: unknown) => number;
    let hasLast = false;
    let lastKey: unknown;

    // Byte-adaptive re-batching toward the paged-encode segment target,
    // refined from the writer's actual output as segments flush.
    let batch: unknown[] = [];
    let written = 0;
    let nextBatch = BEAST2_PAGED_BATCH_DEFAULT;
    const flush = (): void => {
        if (batch.length === 0) return;
        const value = kind === 'dict'
            ? new Map(batch as [unknown, unknown][])
            : kind === 'set' ? new Set(batch) : batch;
        writer.write(value as never);
        written += batch.length;
        batch = [];
        const body = Math.max(1, bytesWritten - Math.max(0, headerBytes));
        const avg = Math.max(1, body / written);
        nextBatch = Math.max(1, Math.min(BEAST2_PAGED_BATCH_DEFAULT, Math.floor(BEAST2_PAGED_TARGET_BYTES_DEFAULT / avg)));
    };

    const emit = (...args: unknown[]): null => {
        const key = args[0];
        if (orderCmp !== null) {
            if (hasLast && orderCmp(lastKey, key) >= 0) {
                throw new Error(
                    `beast2 v5: ${kind === 'dict' ? 'Dict' : 'Set'} stream batches must be strictly ascending in East ` +
                    `${kind === 'dict' ? 'key' : 'element'} order — segment content is the canonical value; ` +
                    `emit in ascending key order, or emit arrival order as an Array`
                );
            }
            lastKey = key;
            hasLast = true;
        }
        batch.push(kind === 'dict' ? [args[0], args[1]] : args[0]);
        if (batch.length >= nextBatch) flush();
        return null;
    };

    return {
        emit,
        finish: () => {
            flush();
            writer.finish();
            closeSync(fd);
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
