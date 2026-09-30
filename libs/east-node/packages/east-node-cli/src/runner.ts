/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { readFileSync, statSync, writeFileSync } from 'fs';
import { extname } from 'path';
import {
    EastIR,
    beast2LazyStats,
    encodeBeast2For,
    encodeBeast2PagedFor,
    encodeEastFor,
    encodeJSONFor,
    isTypeValueEqual,
    printFor,
    variant,
    type UnitDecode,
    type UnitResult,
} from '@elaraai/east';
import type { PlatformFunction, EastTypeValue } from '@elaraai/east/internal';
import { printTypeValue } from '@elaraai/east/internal';
import { inputBytes, lazyInputBytesRead, loadEastIR, loadInput, loadInputLazy } from './loader.js';

function now(): bigint { return process.hrtime.bigint(); }
function elapsed(start: bigint, end: bigint): number { return Number(end - start) / 1e6; }

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A file's size for the verbose account, or `?` when it cannot be read. @internal */
export function formatFileSize(path: string): string {
    try { return formatSize(statSync(path).size); } catch { return '?'; }
}

/** What an input weighs for the verbose account — a manifest the collection it
 *  names, not its own few kilobytes ({@link inputBytes}) — or `?`. */
function formatInputSize(path: string): string {
    try { return formatSize(inputBytes(path)); } catch { return '?'; }
}

/**
 * Prints the verbose account of input `i` before it is read: its file, what it
 * weighs, and the type it is read as. `run -v` and `exec -v` print it alike, so
 * a task's log carries it.
 *
 * @param i - the input's position
 * @param path - its file
 * @param type - the type it is read as
 * @internal
 */
export function reportInput(i: number, path: string, type: EastTypeValue): void {
    console.error(`  input ${i}: ${path}  (${formatInputSize(path)})`);
    console.error(`    ${printTypeValue(type)}`);
}

/**
 * Prints the verbose account of an input that opened lazily.
 *
 * @param i - the input's position
 * @internal
 */
export function reportInputLazy(i: number): void {
    console.error(`  input ${i}: opened lazily — paged from the file`);
}

/**
 * Prints the verbose account of an input decoded whole as it loaded: the
 * growth in resident memory across its decode — what it holds in memory, as a
 * runner that loads its inputs first sees it — beside what it weighs on disk,
 * since a nested collection decodes at many times that.
 *
 * @param i - the input's position
 * @param bytes - the growth in resident memory, in bytes
 * @internal
 */
export function reportInputWhole(i: number, bytes: number): void {
    console.error(`  input ${i}: decoded whole — +${formatSize(Math.max(0, bytes))} resident`);
}

/**
 * Opens a program's inputs, always frozen: task inputs are immutable, and
 * mutating one throws the uniform copy-first error.
 *
 * With `decode` lazy, each beast2 collection input opens as a paged value
 * whatever it weighs, so a read decodes only the segments it reaches and an
 * operation the pager cannot serve decodes it whole, once, when it first needs
 * it; frozen collapses the shape gate, so nested element shapes open lazily
 * too. With `whole`, every input is decoded before the program runs. An input
 * that cannot open lazily — another format, an index-less blob, an element
 * shape holding a Ref or a function — is decoded whole either way. A manifest
 * is the collection it names, its segments the files beside it.
 *
 * @param paths - the input files, in parameter order
 * @param types - the parameters' types
 * @param decode - how the collection inputs are read
 * @param verbose - print how each input opened: lazily, or decoded whole and
 *   the resident memory it added
 * @returns the inputs, in parameter order
 * @internal
 */
export function openInputs(paths: readonly string[], types: readonly EastTypeValue[], decode: UnitDecode, verbose: boolean): unknown[] {
    return paths.map((path, i) => {
        const lazy = decode.type === 'lazy' ? loadInputLazy(path) : undefined;
        if (lazy !== undefined) {
            if (verbose) reportInputLazy(i);
            return lazy;
        }
        const before = verbose ? process.memoryUsage.rss() : 0;
        const value = loadInput(path, types[i]!);
        if (verbose) reportInputWhole(i, process.memoryUsage.rss() - before);
        return value;
    });
}

/**
 * Prints what reading a lazily opened input came to; nothing for an input
 * decoded whole as it loaded.
 *
 * An operation the pager cannot serve decoded the input whole, and says what
 * that added to resident memory; reads that decoded segments again, beyond the
 * ones the pager keeps, say so, since decoding the input whole would decode
 * each once; any other reads say the segments they decoded and the fences
 * they probed, and then the bytes they read, against what the input weighs.
 * east-c and east-py say each in the same words, but for the bytes read.
 *
 * @param i - the input's position
 * @param path - its file
 * @param value - the input's value
 * @internal
 */
export function reportInputReads(i: number, path: string, value: unknown): void {
    const read = lazyInputBytesRead(value);
    const stats = beast2LazyStats(value);
    if (read === undefined || stats === undefined) return;
    if (stats.hydrated) {
        console.error(`  input ${i}: decoded whole (an operation the pager cannot serve) — +${formatSize(stats.hydratedBytes)} resident`);
    } else if (stats.segmentsDecoded > stats.segments) {
        console.error(`  input ${i}: ${stats.segmentsDecoded} segment decodes of its ${stats.segments} segments, ` +
            `${stats.fencesProbed} fences probed — its reads land at random beyond the segments kept, so decoding it ` +
            'whole would decode each once');
    } else {
        console.error(`  input ${i}: ${stats.segmentsDecoded} of ${stats.segments} segments decoded, ${stats.fencesProbed} fences probed — ` +
            `${formatSize(read)} read of ${formatInputSize(path)}`);
    }
}

/**
 * A refusal of the command line itself — a function the inputs given do not
 * fit.
 *
 * These are the user's errors, not the program's, and east-c and east-py
 * answer them with one sentence on stderr. Marking them lets the CLI do the
 * same instead of printing the JS stack it prints for an error thrown from
 * East or from a platform function, where the frames are the diagnosis.
 */
export class UsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UsageError';
    }
}

/**
 * Runs an East IR program.
 *
 * @param irPath - the program's IR file
 * @param platformFns - the platform functions it may call
 * @param packages - the platform packages they came from, for the verbose
 *   account
 * @param inputPaths - one input file per parameter, in order
 * @param outputPath - where the result is written, in its extension's format;
 *   without it the result prints as East text
 * @param verbose - print where the time went, the peak memory and how each
 *   input opened
 * @param decode - how the collection inputs are read: lazily (the default), or
 *   decoded whole before the program runs
 * @returns the result, when it is not written to `outputPath`
 */
export async function runProgram(
    irPath: string,
    platformFns: PlatformFunction[],
    packages: string[],
    inputPaths: string[],
    outputPath?: string,
    verbose = false,
    decode: UnitDecode = variant('lazy', null),
): Promise<unknown> {
    const t0 = now();

    // Load as an EastIR bundle so source_map travels with the IR and error
    // frames resolve end-to-end.
    const eastIR = loadEastIR(irPath);
    const ir = eastIR.ir;
    const isAsync = eastIR instanceof EastIR ? false : true;

    // Get the function's input/output types from the IR.
    const inputTypes = (ir as any)?.value?.type?.value?.inputs ?? [];
    const outputType = ((ir as any)?.value?.type?.value?.output ?? null) as EastTypeValue | null;

    if (inputPaths.length !== inputTypes.length) {
        // east-c / east-py parity, down to the signature line: one sentence
        // for one condition, whichever runner the task declares.
        const signature = `(${(inputTypes as EastTypeValue[]).map((t) => printTypeValue(t)).join(', ')}) -> ` +
            `${outputType !== null ? printTypeValue(outputType) : '?'}`;
        throw new UsageError(
            `Function expects ${inputTypes.length} inputs, got ${inputPaths.length}\nSignature: ${signature}`,
        );
    }

    // Verbose header
    if (verbose) {
        console.error(`Running: ${irPath}  (${formatFileSize(irPath)})`);

        if (packages.length > 0) {
            console.error(`Platform: ${packages.length} package(s), ${platformFns.length} function(s)`);
            for (const p of packages) console.error(`  - ${p}`);
        }

        console.error(`Function: ${inputTypes.length} inputs, ${isAsync ? 'async' : 'sync'}`);
        for (let i = 0; i < inputPaths.length; i++) reportInput(i, inputPaths[i]!, inputTypes[i]!);
        if (outputType) {
            console.error(`  return:`);
            console.error(`    ${printTypeValue(outputType)}`);
        }
    }

    // Load inputs, frozen: each collection lazily, unless --decode whole says
    // to decode them before the program runs.
    const inputs = openInputs(inputPaths, inputTypes as EastTypeValue[], decode, verbose);
    /** The verbose summary's account of each lazy input: what paging came
     *  to, against the size of the value. */
    const reportLazyReads = (): void => {
        for (let i = 0; i < inputs.length; i++) reportInputReads(i, inputPaths[i]!, inputs[i]);
    };

    const t1 = now();

    let result: unknown;
    if (!isAsync) {
        const compiled = (eastIR as EastIR<any, any>).compile(platformFns);
        const t2 = now();

        result = compiled(...inputs);
        const t3 = now();

        const t4 = maybeWriteOutput(outputPath, result, outputType, verbose);

        if (verbose) {
            printResult({
                outcome: variant('ok', null),
                peakBytes: peakBytes(),
                timings: { load: elapsed(t0, t1), compile: elapsed(t1, t2), execute: elapsed(t2, t3), output: elapsed(t3, t4) },
            });
            reportLazyReads();
        }
    } else {
        const compiled = (eastIR as any).compile(platformFns);
        const t2 = now();

        result = await compiled(...inputs);
        const t3 = now();

        const t4 = maybeWriteOutput(outputPath, result, outputType, verbose);

        if (verbose) {
            printResult({
                outcome: variant('ok', null),
                peakBytes: peakBytes(),
                timings: { load: elapsed(t0, t1), compile: elapsed(t1, t2), execute: elapsed(t2, t3), output: elapsed(t3, t4) },
            });
            reportLazyReads();
        }
    }

    return outputPath ? undefined : result;
}

/** A compiled `(K, V, V) -> V` fold of equal keys. */
export type MergeFunction = (key: unknown, acc: unknown, value: unknown) => unknown;

/**
 * Loads a merge function: an IR file holding a `(K, V, V) -> V` East function
 * over the given key and value types, compiled with the unit's platforms.
 * Shared by `exec`'s dict output and the blob merge.
 *
 * @param path - the IR file (any format the IR positional accepts)
 * @param keyType - the key type
 * @param valueType - the value type
 * @param platformFns - the unit's platforms
 * @param subject - what the function must match, for the message: `the emit
 *   parameter` or `the inputs`
 * @returns the compiled merge function
 * @throws {Error} When the IR is not a function of that shape, naming the
 *   expected and the actual types.
 */
export function loadMergeFunction(path: string, keyType: EastTypeValue, valueType: EastTypeValue, platformFns: PlatformFunction[], subject: string): MergeFunction {
    const bundle = loadEastIR(path);
    const fnType = (bundle.ir as any).value.type as EastTypeValue;
    const shape = fnType.type === 'Function' ? fnType.value as { inputs: EastTypeValue[]; output: EastTypeValue } : null;
    if (shape === null || shape.inputs.length !== 3 ||
        !isTypeValueEqual(shape.inputs[0]!, keyType) ||
        !isTypeValueEqual(shape.inputs[1]!, valueType) ||
        !isTypeValueEqual(shape.inputs[2]!, valueType) ||
        !isTypeValueEqual(shape.output, valueType)) {
        throw new Error(
            `merge function: expected a function (K, V, V) -> V matching ${subject} ` +
            `(K = ${printTypeValue(keyType)}, V = ${printTypeValue(valueType)}), got ${printTypeValue(fnType)}`,
        );
    }
    return (bundle as EastIR<any, any>).compile(platformFns) as MergeFunction;
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

/**
 * Prints a unit's result as `-v` shows it: where the time went, and the
 * process's peak memory.
 *
 * @param result - the result
 */
export function printResult(result: UnitResult): void {
    const { load, compile, execute, output } = result.timings;
    console.error('\nTiming:');
    console.error(`  Load:     ${load.toFixed(1).padStart(8)} ms`);
    console.error(`  Compile:  ${compile.toFixed(1).padStart(8)} ms`);
    console.error(`  Execute:  ${execute.toFixed(1).padStart(8)} ms`);
    console.error(`  Output:   ${output.toFixed(1).padStart(8)} ms`);
    console.error(`  Total:    ${(load + compile + execute + output).toFixed(1).padStart(8)} ms`);
    console.error('\nMemory:');
    console.error(`  Peak RSS: ${(Number(result.peakBytes) / (1024 * 1024)).toFixed(1).padStart(8)} MB`);
}

/**
 * The process's peak resident memory in bytes: VmHWM on Linux, where
 * `ru_maxrss` carries a parent's peak across exec, and `ru_maxrss` elsewhere.
 *
 * @returns the peak
 */
export function peakBytes(): bigint {
    try {
        const hwm = /^VmHWM:\s+(\d+) kB$/m.exec(readFileSync('/proc/self/status', 'utf8'));
        if (hwm !== null) return BigInt(hwm[1]!) * 1024n;
    } catch {
        // No /proc: not Linux.
    }
    return BigInt(process.resourceUsage().maxRSS) * 1024n;
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
            // Collection-rooted outputs are ALWAYS segmented + indexed, cut by
            // the content-defined rule, so e3's paged dataset reads can seek —
            // one encoding per logical value, at every size.
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
