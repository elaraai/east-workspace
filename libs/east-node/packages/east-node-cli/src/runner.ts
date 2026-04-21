/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { writeFileSync, statSync } from 'fs';
import { extname } from 'path';
import {
    EastIR,
    AsyncEastIR,
    encodeBeast2For,
    encodeEastFor,
    encodeJSONFor,
    printFor,
} from '@elaraai/east';
import type { PlatformFunction, FunctionIR, AsyncFunctionIR, ValueTypeOf, EastTypeValue } from '@elaraai/east/internal';
import { EAST_SOURCE_MAP_SYMBOL, printTypeValue } from '@elaraai/east/internal';
import type { SourceMap } from '@elaraai/east/internal';
import { loadIR, loadInput } from './loader.js';

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

/**
 * Runs an East IR program.
 */
export async function runProgram(
    irPath: string,
    platformFns: PlatformFunction[],
    packages: string[],
    inputPaths: string[],
    outputPath?: string,
    verbose: boolean = false,
): Promise<unknown> {
    const t0 = now();

    // Load and parse the IR
    const ir = loadIR(irPath);

    // Get the function's input types
    const inputTypes = ir?.value?.type?.value?.inputs ?? [];
    const outputType = (ir?.value?.type?.value?.output ?? null) as EastTypeValue | null;
    const isAsync = ir.type === 'AsyncFunction';

    // Validate input count
    if (inputPaths.length !== inputTypes.length) {
        throw new Error(
            `Function expects ${inputTypes.length} input(s), but ${inputPaths.length} input file(s) provided`,
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
        for (let i = 0; i < inputTypes.length; i++) {
            const t = printTypeValue(inputTypes[i]!);
            console.error(`  input ${i}: ${inputPaths[i]}  (${formatFileSize(inputPaths[i]!)})`);
            console.error(`    ${t}`);
        }
        if (outputType) {
            console.error(`  return:`);
            console.error(`    ${printTypeValue(outputType)}`);
        }
    }

    // Load inputs
    const inputs: unknown[] = [];
    for (let i = 0; i < inputPaths.length; i++) {
        inputs.push(loadInput(inputPaths[i]!, inputTypes[i]!));
    }

    const t1 = now();

    // The beast2 decoder attaches the decoded source map to the root Function
    // / AsyncFunction IR via EAST_SOURCE_MAP_SYMBOL. Forward it to EastIR so
    // loc_ids resolve into source locations in error stacks at runtime.
    const sourceMap = (ir as any)[EAST_SOURCE_MAP_SYMBOL] as SourceMap | undefined;

    let result: unknown;
    if (ir.type === 'Function') {
        const eastIR = new EastIR(ir as FunctionIR);
        if (sourceMap) eastIR.source_map = sourceMap;
        const compiled = eastIR.compile(platformFns);
        const t2 = now();

        result = compiled(...inputs);
        const t3 = now();

        const t4 = maybeWriteOutput(outputPath, result, outputType, verbose);
        const t5 = now();

        if (verbose) printTimingAndMemory(t0, t1, t2, t3, t4, t5);
    } else {
        const asyncEastIR = new AsyncEastIR(ir as AsyncFunctionIR);
        if (sourceMap) asyncEastIR.source_map = sourceMap;
        const compiled = asyncEastIR.compile(platformFns);
        const t2 = now();

        result = await compiled(...inputs);
        const t3 = now();

        const t4 = maybeWriteOutput(outputPath, result, outputType, verbose);
        const t5 = now();

        if (verbose) printTimingAndMemory(t0, t1, t2, t3, t4, t5);
    }

    return outputPath ? undefined : result;
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

function writeOutput(filePath: string, value: unknown, type: unknown): void {
    const ext = extname(filePath).toLowerCase();
    switch (ext) {
        case '.beast2':
        case '.beast': {
            const encoder = encodeBeast2For(type as any);
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
