/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { readFileSync, statSync, writeFileSync } from 'fs';
import { extname } from 'path';
import {
    EastIR,
    encodeBeast2For,
    encodeBeast2PagedFor,
    encodeEastFor,
    encodeJSONFor,
    isTypeValueEqual,
    printFor,
    variant,
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

/** Default size threshold above which collection inputs open lazily. */
const LAZY_INPUT_BYTES_DEFAULT = 64 * 1024 * 1024;

/** Resolves the lazy-open threshold: the environment, else the default. An
 *  unset or empty `EAST_LAZY_INPUT_BYTES` falls through to the 64 MiB default
 *  (`Number('')` is `0`, which would silently DISABLE lazy opening); invalid
 *  or negative values fall through too, matching east-c and east-py. Exported
 *  for `exec` and the spec. @internal */
export function lazyThreshold(): number {
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
    verbose = false,
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
        for (let i = 0; i < inputPaths.length; i++) {
            const t = printTypeValue(inputTypes[i]!);
            console.error(`  input ${i}: ${inputPaths[i]}  (${formatFileSize(inputPaths[i]!)})`);
            console.error(`    ${t}`);
        }
        if (outputType) {
            console.error(`  return:`);
            console.error(`    ${printTypeValue(outputType)}`);
        }
    }

    // Load inputs — always frozen (task inputs are immutable; mutating one
    // throws the uniform copy-first error). Beast2 collection inputs open
    // lazily at or above the size threshold, so a sparse read into a huge
    // indexed input stops paying a whole decode — and because frozen collapses
    // the shape gate, nested-container element shapes open lazily too. The
    // size is the value's: an input staged as a manifest is a small file
    // naming large ones.
    const threshold = lazyThreshold();
    const inputs: unknown[] = [];
    const lazyInputs: number[] = [];
    for (let i = 0; i < inputPaths.length; i++) {
        const lazy = threshold > 0 && inputBytes(inputPaths[i]!) >= threshold ? loadInputLazy(inputPaths[i]!) : undefined;
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
