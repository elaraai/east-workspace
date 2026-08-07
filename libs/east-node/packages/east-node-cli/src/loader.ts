/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import { extname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
    IRType,
    decodeBeast2For,
    decodeBeast2,
    decodeEastFor,
    decodeJSONFor,
    decodeEastIR,
    decodeAsyncEastIR,
    readBeast2Extents,
    openBeast2LazyFor,
    isBeast2LazySafe,
    EastIR,
    AsyncEastIR,
    type EastTypeValue,
} from '@elaraai/east';
import type { PlatformFunction, IR, ValueTypeOf } from '@elaraai/east/internal';

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
 * Candidate require roots for resolving a platform package's `./<subpath>`
 * export, in priority order:
 *
 * 1. The LINKED CLI bin location (`process.argv[1]`'s dir) — the user-project
 *    context pnpm's bin shim invoked us with. Resolves installed stock
 *    platform packages (`@elaraai/east-node-std`, …) under the project's
 *    `node_modules`, exactly as before.
 * 2. The e3 project search dirs from `E3_RUNNER_SEARCH_DIRS` — when e3 spawns a
 *    runner it sets this to the project root(s). Required on the
 *    `e3 dataflow run` path: e3 runs the runner in a scratch cwd, so neither
 *    step 1 (a `node_modules/.bin` dir, no package scope) nor `process.cwd()`
 *    reaches the project. A project resolves its OWN package by name through
 *    its `exports` map via Node self-reference, which works only when the
 *    require root sits inside that package — i.e. at the project root.
 * 3. The process cwd (`process.cwd()`) — for a standalone `east-node run`
 *    invoked from the project shell, where cwd IS the project root.
 *
 * All roots are tried; the first that resolves wins. Stock platforms still
 * resolve via step 1 first, so existing behaviour is unchanged.
 */
function platformRequireRoots(): string[] {
    const cliEntry = process.argv[1] ?? fileURLToPath(import.meta.url);
    const roots = [path.dirname(cliEntry)];
    const fromE3 = process.env.E3_RUNNER_SEARCH_DIRS;
    if (fromE3) roots.push(...fromE3.split(path.delimiter).filter(Boolean));
    roots.push(process.cwd());
    // Dedupe so a CLI invoked from the project root doesn't probe twice.
    return [...new Set(roots)];
}

/**
 * Resolve a platform package's `./<subpath>` export across the candidate
 * require roots ({@link platformRequireRoots}). Returns the absolute resolved
 * path from the first root that resolves; rethrows the last resolution error
 * (a `MODULE_NOT_FOUND`) when every root fails so the caller's not-found
 * handling still fires.
 */
function resolvePlatformSubpath(packageName: string, subpath: string): string {
    const spec = `${packageName}/${subpath}`;
    let lastErr: unknown;
    for (const root of platformRequireRoots()) {
        try {
            const req = createRequire(pathToFileURL(root + path.sep));
            return req.resolve(spec);
        } catch (err) {
            lastErr = err;
        }
    }
    throw lastErr;
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
        // Resolve the package's `./platform` export across the candidate require
        // roots — the linked CLI bin location for installed stock platforms, the
        // e3-provided project root(s) and cwd for a project's own package. See
        // {@link platformRequireRoots} / {@link resolvePlatformSubpath} for why
        // each root is needed (and why `import.meta.url`'s realpath is not).
        const resolvedPath = resolvePlatformSubpath(packageName, 'platform');
        const platformModule = await import(pathToFileURL(resolvedPath).href);
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

    // Load package.json for version info — same linked-base resolution as
    // loadPlatform, otherwise we'd resolve from the realpath and miss
    // user-installed platform packages.
    let name = packageName;
    let version = 'unknown';

    for (const root of platformRequireRoots()) {
        try {
            const req = createRequire(pathToFileURL(root + path.sep));
            const pkgJson = req(`${packageName}/package.json`) as { name?: string; version?: string };
            name = pkgJson.name ?? packageName;
            version = pkgJson.version ?? 'unknown';
            break;
        } catch {
            // Package doesn't export package.json from this root — try the next.
        }
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

/**
 * Opens an input file as a lazy pager-backed collection value, when it can
 * be: a beast2 v5 collection blob carrying a segment index. Size, iteration
 * and keyed reads are then served from the index with O(segment) decoded
 * memory; any other operation hydrates transparently to the eager value's
 * exact semantics.
 *
 * Returns `undefined` when the file cannot be served lazily (a non-beast2
 * format, a v4 or index-less blob, a non-collection root, or an element
 * shape the lazy contract excludes — see below) — the caller falls back to
 * {@link loadInput}.
 *
 * Element shapes that transitively contain a mutable container
 * (Array/Set/Dict/Ref) or an identity-compared kind (Vector/Matrix,
 * functions) always decode eagerly: East's runtime is reference-semantic for
 * nested containers, so a write through a lazily-served (freshly decoded)
 * element would be silently dropped. {@link isBeast2LazySafe} is the gate.
 *
 * @param filePath - Path to the input file
 * @returns The lazy collection value, or `undefined` to fall back
 */
export function loadInputLazy(filePath: string): unknown | undefined {
    if (getFileFormat(filePath) !== 'beast2') return undefined;
    const data = readFileSync(filePath);
    try {
        const extents = readBeast2Extents(data);
        if (!isBeast2LazySafe(extents.typeValue)) return undefined;
        return openBeast2LazyFor(extents.typeValue)(data);
    } catch {
        return undefined;
    }
}
