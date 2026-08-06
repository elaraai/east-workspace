/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { writeFileSync, statSync } from 'fs';
import { extname } from 'path';
import {
    EastIR,
    encodeBeast2For,
    encodeBeast2PagedFor,
    encodeEastFor,
    encodeJSONFor,
    printFor,
} from '@elaraai/east';
import type { PlatformFunction, EastTypeValue } from '@elaraai/east/internal';
import { printTypeValue } from '@elaraai/east/internal';
import { loadEastIR, loadInput } from './loader.js';

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

    // Load as an EastIR bundle so source_map travels with the IR and error
    // frames resolve end-to-end.
    const eastIR = loadEastIR(irPath);
    const ir = eastIR.ir;
    const isAsync = eastIR instanceof EastIR ? false : true;

    // Get the function's input/output types from the IR.
    const inputTypes = (ir as any)?.value?.type?.value?.inputs ?? [];
    const outputType = ((ir as any)?.value?.type?.value?.output ?? null) as EastTypeValue | null;

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

    let result: unknown;
    if (!isAsync) {
        const compiled = (eastIR as EastIR<any, any>).compile(platformFns);
        const t2 = now();

        result = compiled(...inputs);
        const t3 = now();

        const t4 = maybeWriteOutput(outputPath, result, outputType, verbose);
        const t5 = now();

        if (verbose) printTimingAndMemory(t0, t1, t2, t3, t4, t5);
    } else {
        const compiled = (eastIR as any).compile(platformFns);
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
