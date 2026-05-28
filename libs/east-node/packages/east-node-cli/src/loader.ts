/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import { extname } from 'path';
import { pathToFileURL } from 'url';
import {
    IRType,
    decodeBeast2For,
    decodeBeast2,
    decodeEastFor,
    decodeJSONFor,
    decodeEastIR,
    decodeAsyncEastIR,
    EastIR,
    AsyncEastIR,
    type EastTypeValue,
} from '@elaraai/east';
import type { PlatformFunction, IR, ValueTypeOf } from '@elaraai/east/internal';

const require = createRequire(import.meta.url);

// Decoder for IR from beast2 format (self-describing)
const decodeIRFromBeast2 = decodeBeast2For(IRType);

// Decoder for IR from east text format
const decodeIRFromEast = decodeEastFor(IRType);

// Decoder for IR from JSON format
const decodeIRFromJSON = decodeJSONFor(IRType);

/**
 * Metadata about a loaded platform package.
 */
export interface PlatformMetadata {
    /** Package name */
    name: string;
    /** Package version */
    version: string;
    /** Platform functions exported by the package */
    fns: PlatformFunction[];
}

/**
 * Loads platform functions from a package.
 *
 * The package must export a `./platform` subpath with a default export
 * of `PlatformFunction[]`.
 *
 * @param packageName - The npm package name (e.g., "@elaraai/east-node-std")
 * @returns Array of platform functions
 * @throws Error if package cannot be loaded or doesn't follow convention
 */
export async function loadPlatform(packageName: string): Promise<PlatformFunction[]> {
    try {
        // Anchor platform resolution at the LINKED CLI bin location, not at
        // this file's realpath. pnpm's bin shim invokes us with the
        // user-project linked path; `process.argv[1]` preserves that. By
        // contrast, this module's `import.meta.url` is realpath'd by
        // default, anchored at east-node-cli's source location in whichever
        // monorepo it lives in — useless for finding user-installed
        // platform packages.
        //
        // The loader stays platform-agnostic: any package that exports
        // `./platform` and is installed in the user's project resolves
        // here, with no hardcoded list and no extra Node flags.
        const cliEntry = process.argv[1] ?? import.meta.url;
        const linkedDir = path.dirname(
            cliEntry.startsWith('file:') ? new URL(cliEntry).pathname : cliEntry,
        );
        const base = pathToFileURL(linkedDir + path.sep).href;
        const resolved = import.meta.resolve(`${packageName}/platform`, base);
        const platformModule = await import(resolved);
        const fns = platformModule.default;

        // Validate the export
        if (!Array.isArray(fns)) {
            throw new Error(
                `Package "${packageName}" does not export a valid platform. ` +
                `Expected default export of PlatformFunction[], got ${typeof fns}.`
            );
        }

        // Validate each platform function structurally
        for (let i = 0; i < fns.length; i++) {
            const fn = fns[i];
            if (!isValidPlatformFunction(fn)) {
                throw new Error(
                    `Package "${packageName}" exports invalid platform function at index ${i}. ` +
                    `Expected { name: string, inputs: EastTypeValue[], output: EastTypeValue, type: 'sync' | 'async', fn: Function }.`
                );
            }
        }

        return fns;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND' ||
            (err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
            throw new Error(
                `Could not load platform package "${packageName}". ` +
                `Make sure it is installed: npm install ${packageName}`
            );
        }
        throw err;
    }
}

/**
 * Loads platform functions with metadata from a package.
 *
 * @param packageName - The npm package name
 * @returns Platform metadata including name, version, and functions
 */
export async function loadPlatformWithMetadata(packageName: string): Promise<PlatformMetadata> {
    const fns = await loadPlatform(packageName);

    // Load package.json for version info
    let name = packageName;
    let version = 'unknown';

    try {
        const pkgJson = require(`${packageName}/package.json`) as { name?: string; version?: string };
        name = pkgJson.name ?? packageName;
        version = pkgJson.version ?? 'unknown';
    } catch {
        // Package doesn't export package.json, use defaults
    }

    return { name, version, fns };
}

/**
 * Loads platform functions from multiple packages.
 *
 * @param packageNames - Array of npm package names
 * @returns Combined array of all platform functions
 */
export async function loadPlatforms(packageNames: string[]): Promise<PlatformFunction[]> {
    const allFns: PlatformFunction[] = [];

    for (const pkgName of packageNames) {
        const fns = await loadPlatform(pkgName);
        allFns.push(...fns);
    }

    return allFns;
}

/**
 * Validates that a value looks like a PlatformFunction.
 * We use structural validation since PlatformFunction contains JS functions.
 */
function isValidPlatformFunction(value: unknown): value is PlatformFunction {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const fn = value as Record<string, unknown>;

    // Check required string fields
    if (typeof fn.name !== 'string') return false;
    if (fn.type !== 'sync' && fn.type !== 'async') return false;

    // Check fn is a function
    if (typeof fn.fn !== 'function') return false;

    // Check inputs is an array
    if (!Array.isArray(fn.inputs)) return false;

    // Check output exists (we trust the type structure)
    if (fn.output === undefined) return false;

    return true;
}

/**
 * Determines the file format from extension.
 */
function getFileFormat(filePath: string): 'beast2' | 'east' | 'json' {
    const ext = extname(filePath).toLowerCase();

    switch (ext) {
        case '.beast2':
        case '.beast':
            return 'beast2';
        case '.east':
            return 'east';
        case '.json':
            return 'json';
        default:
            throw new Error(
                `Unsupported file extension "${ext}". ` +
                `Supported extensions: .beast2, .beast, .east, .json`
            );
    }
}

/**
 * Loads an IR file and returns the parsed IR.
 *
 * Supports the following formats:
 * - `.beast2`, `.beast` - Binary East format (self-describing)
 * - `.east` - Text East format
 * - `.json` - JSON format
 *
 * Source maps are NOT returned from this function — use {@link loadEastIR}
 * if you need the source map along with the IR.
 *
 * @param filePath - Path to the IR file
 * @returns Parsed IR (FunctionIR or AsyncFunctionIR)
 */
export function loadIR(filePath: string): ValueTypeOf<IR> {
    const format = getFileFormat(filePath);
    const data = readFileSync(filePath);

    let ir: ValueTypeOf<IR>;

    switch (format) {
        case 'beast2': {
            // Beast2 is self-describing, includes type info in the file
            ir = decodeIRFromBeast2(data);
            break;
        }
        case 'east': {
            // East text format, decode using IR type
            ir = decodeIRFromEast(data);
            break;
        }
        case 'json': {
            // JSON format, decode using IR type
            ir = decodeIRFromJSON(data);
            break;
        }
    }

    // Validate that the IR is a function
    if (ir.type !== 'Function' && ir.type !== 'AsyncFunction') {
        throw new Error(
            `IR file must contain a function or async function, got "${ir.type}"`
        );
    }

    return ir;
}

/**
 * Loads an IR file and returns an EastIR / AsyncEastIR bundle (IR + source
 * map). Prefer this over {@link loadIR} when the caller will compile + run
 * the IR, so that error locations resolve end-to-end.
 *
 * Supports `.beast2` / `.beast` (source map read from the blob), `.json`
 * (source map read from the `{ir, source_map}` wrapper format), and `.east`
 * (no source map available — field stays null).
 */
export function loadEastIR(filePath: string): EastIR<any, any> | AsyncEastIR<any, any> {
    const format = getFileFormat(filePath);
    const data = readFileSync(filePath);

    if (format === 'beast2') {
        // Peek at the root variant to pick sync/async decoder.
        const probe = decodeIRFromBeast2(data);
        if (probe.type === 'Function') {
            return decodeEastIR(data);
        }
        if (probe.type === 'AsyncFunction') {
            return decodeAsyncEastIR(data);
        }
        throw new Error(`IR file must contain a function or async function, got "${probe.type}"`);
    }

    // For east / json formats we fall back to the IR-only path (no source map).
    // JSON wrapper parsing for {ir, source_map} can be added here if needed.
    const ir = loadIR(filePath);
    if (ir.type === 'Function') {
        return new EastIR<any, any>(ir as any);
    }
    return new AsyncEastIR<any, any>(ir as any);
}

/**
 * Loads input data from a file.
 *
 * The type of the input must be provided to decode correctly.
 *
 * @param filePath - Path to the input file
 * @param type - The expected East type of the input
 * @returns Decoded value
 */
export function loadInput(filePath: string, type: EastTypeValue): unknown {
    const format = getFileFormat(filePath);
    const data = readFileSync(filePath);

    switch (format) {
        case 'beast2': {
            // For inputs, we use decodeBeast2 which is self-describing
            // This allows loading data without knowing the exact type
            const result = decodeBeast2(data);
            return result.value;
        }
        case 'east': {
            const decoder = decodeEastFor(type);
            return decoder(data);
        }
        case 'json': {
            const decoder = decodeJSONFor(type);
            return decoder(data);
        }
    }
}
