/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { writeFileSync } from 'fs';
import { extname } from 'path';
import {
    EastIR,
    AsyncEastIR,
    encodeBeast2For,
    encodeEastFor,
    encodeJSONFor,
} from '@elaraai/east';
import type { PlatformFunction, FunctionIR, AsyncFunctionIR, ValueTypeOf } from '@elaraai/east/internal';
import { loadIR, loadInput } from './loader.js';

/**
 * Runs an East IR program.
 *
 * @param irPath - Path to the IR file
 * @param platformFns - Platform functions to use for execution
 * @param inputPaths - Paths to input data files (order matches function parameters)
 * @param outputPath - Optional path to write the result
 * @param verbose - Enable verbose logging
 * @returns The result of execution (or undefined if written to file)
 */
export async function runProgram(
    irPath: string,
    platformFns: PlatformFunction[],
    inputPaths: string[],
    outputPath?: string,
    verbose: boolean = false
): Promise<unknown> {
    // Load and parse the IR
    if (verbose) {
        console.error(`Loading IR from: ${irPath}`);
    }
    const ir = loadIR(irPath);

    // Get the function's input types
    const inputTypes = ir?.value?.type?.value?.inputs ?? [];

    // Validate input count
    if (inputPaths.length !== inputTypes.length) {
        throw new Error(
            `Function expects ${inputTypes.length} input(s), but ${inputPaths.length} input file(s) provided`
        );
    }

    // Load inputs
    const inputs: unknown[] = [];
    for (let i = 0; i < inputPaths.length; i++) {
        if (verbose) {
            console.error(`Loading input ${i + 1}: ${inputPaths[i]}`);
        }
        const input = loadInput(inputPaths[i]!, inputTypes[i]!);
        inputs.push(input);
    }

    // Compile and run
    let result: unknown;

    if (ir.type === 'Function') {
        if (verbose) {
            console.error('Compiling synchronous function...');
        }
        const eastIR = new EastIR(ir as FunctionIR);
        const compiled = eastIR.compile(platformFns);

        if (verbose) {
            console.error('Executing...');
        }
        result = compiled(...inputs);
    } else {
        if (verbose) {
            console.error('Compiling asynchronous function...');
        }
        const asyncEastIR = new AsyncEastIR(ir as AsyncFunctionIR);
        const compiled = asyncEastIR.compile(platformFns);

        if (verbose) {
            console.error('Executing...');
        }
        result = await compiled(...inputs);
    }

    // Write output if specified
    if (outputPath) {
        if (verbose) {
            console.error(`Writing output to: ${outputPath}`);
        }

        // Get output type from the IR
        const outputType = ir.type === 'Function'
            ? (ir as ValueTypeOf<FunctionIR>).value.output
            : (ir as ValueTypeOf<AsyncFunctionIR>).value.output;

        writeOutput(outputPath, result, outputType);
        return undefined;
    }

    return result;
}

/**
 * Writes a value to a file in the appropriate format.
 *
 * @param filePath - Path to write to
 * @param value - Value to write
 * @param type - The East type of the value
 */
function writeOutput(filePath: string, value: unknown, type: unknown): void {
    const ext = extname(filePath).toLowerCase();

    switch (ext) {
        case '.beast2':
        case '.beast': {
            const encoder = encodeBeast2For(type as any);
            const data = encoder(value);
            writeFileSync(filePath, data);
            break;
        }
        case '.east': {
            const encoder = encodeEastFor(type as any);
            const data = encoder(value);
            writeFileSync(filePath, data);
            break;
        }
        case '.json': {
            const encoder = encodeJSONFor(type as any);
            const data = encoder(value);
            writeFileSync(filePath, data);
            break;
        }
        default:
            throw new Error(
                `Unsupported output file extension "${ext}". ` +
                `Supported extensions: .beast2, .beast, .east, .json`
            );
    }
}
