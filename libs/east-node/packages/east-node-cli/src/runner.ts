/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { statSync, writeFileSync } from 'fs';
import { extname } from 'path';
import {
    EastIR,
    compareFor,
    encodeBeast2For,
    encodeBeast2PagedFor,
    encodeEastFor,
    encodeJSONFor,
    isTypeValueEqual,
    printFor,
    variant,
} from '@elaraai/east';
import type { PlatformFunction, EastTypeValue } from '@elaraai/east/internal';
import { printTypeValue } from '@elaraai/east/internal';
import { EmitFileWriter, type EmitKind } from './emit-writer.js';
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

/** Streaming-execution options accepted by {@link runProgram}. */
/**
 * A refusal of the command line itself — a flag combination, an output
 * destination, a function shape the flags do not fit.
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
     *  Adjacent emissions with an equal key fold left with it, in emission
     *  order. */
    merge?: string;
    /** With `emit: 'set'`: adjacent equal elements collapse to the first. */
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
        throw new UsageError('--merge applies to --emit dict only');
    }
    if (opts.union && opts.emit !== 'set') {
        throw new UsageError('--union applies to --emit set only');
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
        throw new UsageError(`--emit requires the function's trailing parameter to be the emit capability (a function type)`);
    }
    const fileParamCount = opts.emit !== undefined ? inputTypes.length - 1 : inputTypes.length;
    if (inputPaths.length !== fileParamCount) {
        // east-c / east-py parity, down to the signature line: one sentence
        // for one condition, whichever runner the task declares.
        const signature = `(${(inputTypes as EastTypeValue[]).map((t) => printTypeValue(t)).join(', ')}) -> ` +
            `${outputType !== null ? printTypeValue(outputType) : '?'}`;
        throw new UsageError(
            `Function expects ${fileParamCount} inputs, got ${inputPaths.length}\nSignature: ${signature}`,
        );
    }
    if (opts.emit !== undefined && (outputPath === undefined || extname(outputPath).toLowerCase() !== '.beast2')) {
        // east-c / east-py parity: the emitted blob is a beast2 stream, so
        // any other output extension is refused up front.
        throw new UsageError(`--emit requires a .beast2 output file (-o)`);
    }
    const streamInputs = opts.streamInputs ?? [];
    for (const index of streamInputs) {
        if (index < 0 || index >= inputPaths.length) {
            throw new UsageError(`--stream index ${index} out of range (${inputPaths.length} inputs)`);
        }
    }

    const emitSink = opts.emit !== undefined
        ? createEmitSink(opts.emit, inputTypes[inputTypes.length - 1] as EastTypeValue, outputPath!, {
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
    // nested-container element shapes open lazily too. The size is the
    // value's: an input staged as a manifest is a small file naming large
    // ones.
    const threshold = lazyThreshold(opts);
    const inputs: unknown[] = [];
    const lazyInputs: number[] = [];
    for (let i = 0; i < inputPaths.length; i++) {
        const wantLazy = streamInputs.includes(i) ||
            (threshold > 0 && inputBytes(inputPaths[i]!) >= threshold);
        const lazy = wantLazy ? loadInputLazy(inputPaths[i]!) : undefined;
        if (lazy !== undefined) {
            lazyInputs.push(i);
            if (verbose) console.error(`  input ${i}: opened lazily — paged from the file`);
        }
        inputs.push(lazy !== undefined ? lazy : loadInput(inputPaths[i]!, inputTypes[i]!));
    }
    /** The verbose summary's account of each lazy input: what paging came
     *  to, against the size of the value. */
    const reportLazyReads = (): void => {
        for (const i of lazyInputs) {
            const read = lazyInputBytesRead(inputs[i]);
            if (read !== undefined) console.error(`  input ${i}: ${formatSize(read)} read of ${formatSize(inputBytes(inputPaths[i]!))}`);
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
    /** Flushes pending elements and finalizes the blob (terminator + index). */
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

/** A compiled `(K, V, V) -> V` fold of equal keys. */
export type MergeFunction = (key: unknown, acc: unknown, value: unknown) => unknown;

/**
 * Loads a `--merge` function: an IR file holding a `(K, V, V) -> V` East
 * function over the given key and value types, compiled with the run's
 * platforms. Shared by the emit sink and the blob merge.
 *
 * @param path - the IR file (any format the IR positional accepts)
 * @param keyType - the key type
 * @param valueType - the value type
 * @param platformFns - the run's platforms
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
            `--merge: expected a function (K, V, V) -> V matching ${subject} ` +
            `(K = ${printTypeValue(keyType)}, V = ${printTypeValue(valueType)}), got ${printTypeValue(fnType)}`,
        );
    }
    return (bundle as EastIR<any, any>).compile(platformFns) as MergeFunction;
}

/**
 * The canonical duplicate-key error, identical across runners: the emit
 * sink's, and the blob merge's when a key is shared without a fold.
 *
 * @param kind - the collection kind
 * @param printKey - the key type's printer
 * @param key - the repeated key
 * @returns the message
 */
export function duplicateMessage(kind: 'set' | 'dict', printKey: (v: unknown) => string, key: unknown): string {
    const noun = kind === 'dict' ? 'Dict' : 'Set';
    const part = kind === 'dict' ? 'key' : 'element';
    return `beast2 v5: duplicate ${noun} ${part} emitted: ${printKey(key)} — ${noun} ${part}s must be unique`;
}

/**
 * The canonical out-of-order error, identical across runners: a Set/Dict
 * emission below the previous one.
 *
 * @param kind - the collection kind
 * @param printKey - the key type's printer
 * @param key - the offending key
 * @param previous - the key emitted before it
 * @returns the message
 */
function disorderMessage(kind: 'set' | 'dict', printKey: (v: unknown) => string, key: unknown, previous: unknown): string {
    const noun = kind === 'dict' ? 'Dict' : 'Set';
    const part = kind === 'dict' ? 'key' : 'element';
    return `beast2 v5: ${noun} ${part} emitted out of order: ${printKey(key)} after ${printKey(previous)} — Set/Dict emissions must ascend in East order`;
}

/**
 * Builds the emit capability: a host function value that re-batches elements
 * byte-adaptively and appends segments to the output file through a
 * streaming writer ({@link EmitFileWriter}) — one pass, with one open batch
 * in memory whatever the output's size.
 *
 * Set/Dict emissions must ascend in East (key) order (issue #770): a key
 * below the previous one is an error naming both, in the same words on every
 * runner, and so is an equal key unless the sink folds it. With a merge
 * function an adjacent equal dict key folds into the batch's last entry,
 * `acc = merge(key, acc, value)`; with union an adjacent equal set element
 * collapses into the previous one. The output is then byte-identical to what
 * the non-folding sink writes for the already-folded sequence.
 */
function createEmitSink(kind: EmitKind, emitParamType: EastTypeValue, outputPath: string, fold: EmitFoldOptions): EmitSink {
    if (emitParamType.type !== 'Function') {
        throw new UsageError(`--emit requires the function's trailing parameter to be the emit capability (a function type)`);
    }
    const emitInputs = (emitParamType as any).value.inputs as EastTypeValue[];
    const expectedArity = kind === 'dict' ? 2 : 1;
    if (emitInputs.length !== expectedArity) {
        throw new UsageError(`--emit ${kind} expects an emit parameter taking ${expectedArity} argument(s), got ${emitInputs.length}`);
    }
    if (fold.mergePath !== undefined && kind !== 'dict') {
        throw new UsageError('--merge applies to --emit dict only');
    }
    if (fold.union && kind !== 'set') {
        throw new UsageError('--union applies to --emit set only');
    }
    const merge = fold.mergePath !== undefined
        ? loadMergeFunction(fold.mergePath, emitInputs[0]!, emitInputs[1]!, fold.platformFns, 'the emit parameter')
        : null;

    // The output collection's wire type is reconstructed from the emit
    // parameter's argument types.
    const outTypeValue: EastTypeValue =
        kind === 'dict' ? variant('Dict', { key: emitInputs[0]!, value: emitInputs[1]! }) as EastTypeValue :
        kind === 'set' ? variant('Set', emitInputs[0]!) as EastTypeValue :
        variant('Array', emitInputs[0]!) as EastTypeValue;

    // Canonical-order tracking per element, ahead of the writer's own
    // batch-level check, so an adjacent duplicate or an out-of-order key
    // names the offending emit call and can never collapse silently inside a
    // batch container.
    const orderCmp = kind === 'array' ? null : compareFor(emitInputs[0] as any) as (a: unknown, b: unknown) => number;
    const printKey = kind === 'array' ? null : printFor(emitInputs[0] as any) as (v: unknown) => string;

    const out = new EmitFileWriter(kind, outTypeValue, outputPath);
    let hasLast = false;
    let lastKey: unknown;

    const emit = (...args: unknown[]): null => {
        const key = args[0];
        if (orderCmp !== null && hasLast) {
            const order = orderCmp(lastKey, key);
            if (order === 0 && fold.union) {
                // The first element stands.
                return null;
            }
            if (order === 0 && merge !== null) {
                // The flush rule keeps the last entry in the open batch, so
                // the fold lands in place.
                out.foldLast((last) => {
                    const [k, acc] = last as [unknown, unknown];
                    return [k, merge(key, acc, args[1])];
                });
                return null;
            }
            if (order === 0) throw new Error(duplicateMessage(kind as 'set' | 'dict', printKey!, key));
            if (order > 0) throw new Error(disorderMessage(kind as 'set' | 'dict', printKey!, key, lastKey));
        }
        out.push(kind === 'dict' ? [key, args[1]] : key);
        if (orderCmp !== null) {
            lastKey = key;
            hasLast = true;
        }
        return null;
    };

    return {
        emit,
        finish: () => out.finishClose(),
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
