/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
    IRType,
    FETCH_SEGMENTS_ENV,
    decodeBeast2For,
    decodeEastFor,
    decodeJSONFor,
    type AsyncEastIR,
    type EastIR,
    type EastTypeValue,
    type UnitIO,
} from '@elaraai/east';
import type { PlatformFunction, IR, ValueTypeOf } from '@elaraai/east/internal';
import {
    lazyInputBytesRead as lazyUnitInputBytesRead,
    loadUnitInput,
    loadUnitProgram,
    openUnitInputLazy,
    unitFileFormat,
    unitInputBytes,
} from '@elaraai/east/internal';

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
 * 4. The REAL path of the CLI's own script (`realpath(process.argv[1])`'s
 *    dir) — for a global install. npm's global bin links into the install,
 *    and the walk up from the link's own directory reaches no `node_modules`;
 *    the walk up from the script's real path reaches the global
 *    `node_modules`, and the packages installed beside the CLI, with no
 *    `NODE_PATH`. Last, never first: under pnpm the real path is in the
 *    store, whose walk up misses the project's own packages.
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
    const real = realScript(cliEntry);
    if (real !== undefined) roots.push(path.dirname(real));
    // Dedupe so a CLI invoked from the project root doesn't probe twice.
    return [...new Set(roots)];
}

/**
 * The real path of the script node was started with, its links followed; or
 * `undefined` when there is no such file (a `node -e` program's), and so no
 * root to add.
 */
function realScript(entry: string): string | undefined {
    try {
        return realpathSync(entry);
    } catch {
        return undefined;
    }
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
        // e3-provided project root(s) and cwd for a project's own package, and
        // last the CLI script's real path for a global install. See
        // {@link platformRequireRoots} / {@link resolvePlatformSubpath} for why
        // each root is needed, and why the real path comes last.
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

/** The longest a runner waits between looks for a segment it asked for. */
const FETCH_WAIT_MAX_MS = 50;

/**
 * A staged manifest's segment file, present: asked of the host when it is
 * absent and the host places segments as they are read (`fetch`), by creating
 * `<file>.want` and waiting for the host to place the file or to write
 * `<file>.error`, why it cannot — each whole, renamed into place, since this
 * reads either the moment it is there. Without `fetch`, an absent file is
 * returned as it is, for its read to fail as ever.
 *
 * @param file - the segment's file, `<input>.segments/<hash>.beast2`
 * @param fetch - whether the unit's host places segments as they are read
 * @returns the file
 * @throws {Error} When the host writes why it cannot place the segment.
 */
export function segmentFile(file: string, fetch: boolean): string {
    if (!fetch || existsSync(file)) return file;
    const error = `${file}.error`;
    closeSync(openSync(`${file}.want`, 'a'));
    // The runner has nothing else to do while it waits: it sleeps between
    // looks, a little longer each time.
    const pause = new Int32Array(new SharedArrayBuffer(4));
    for (let wait = 1; !existsSync(file); wait = Math.min(2 * wait, FETCH_WAIT_MAX_MS)) {
        if (existsSync(error)) {
            throw new Error(`beast2 v5: manifest segment ${file} cannot be placed: ${readFileSync(error, 'utf8')}`);
        }
        Atomics.wait(pause, 0, 0, wait);
    }
    return file;
}

/**
 * Whether this process's units' hosts place segments as they are read:
 * {@link FETCH_SEGMENTS_ENV} is `1`, which `exec` sets from its unit's
 * `fetch`, and which a host never sets for a runner.
 *
 * @returns whether an absent segment of a staged manifest is asked for
 */
export function fetchingSegments(): boolean {
    return process.env[FETCH_SEGMENTS_ENV] === '1';
}

/**
 * The process's resident memory now, in bytes: the gauge a lazily opened
 * input weighs a read of it whole by, and the verbose account weighs an input
 * decoded whole by.
 *
 * @returns the resident set size
 */
export function residentBytes(): number {
    return process.memoryUsage.rss();
}

/** The variable east-c's pager reads its cache's budget from as it opens an
 *  input, which this runner reads for its own. */
export const PAGED_CACHE_BYTES_ENV = 'EAST_PAGED_CACHE_BYTES';

/**
 * The decoded weight, in bytes, a lazily opened input's pager keeps of the
 * segments its keyed and index reads decode (`v5/SPEC.md`, "The pager's
 * cache"): {@link PAGED_CACHE_BYTES_ENV}, read as east-c's pager reads it, so a
 * test runs all three runners in one mode — `1` keeps one segment.
 *
 * @returns the budget, or `undefined` — the pager's default, 256 MiB — when
 *   the variable is unset or not a whole number in decimal digits, which
 *   east-c ignores too
 */
export function pagedCacheBytes(): number | undefined {
    const text = process.env[PAGED_CACHE_BYTES_ENV];
    return text !== undefined && /^\d+$/.test(text) ? Number(text) : undefined;
}

/**
 * The {@link UnitIO} over this machine's files, by the paths it is given — a
 * relative one taken against the working directory, as every `fs` call takes
 * it. `exec` hands it a unit whose paths it resolved against the unit file's
 * directory first.
 *
 * @remarks
 * A file's size and each ranged read open the file and close it after, so a
 * lazily opened input holds no descriptor for its life, and a body that
 * iterates every segment of a large manifest runs out of none. A missing file
 * fails as opening it fails, and a directory is no file. A segment asked for
 * is asked of the host through `<file>.want` ({@link segmentFile}).
 */
export const nodeUnitIO: UnitIO = {
    read: (file) => readFileSync(file),
    size: (file) => {
        const fd = openSync(file, 'r');
        try {
            const stat = fstatSync(fd);
            if (!stat.isFile()) throw new Error(`${file} is not a file`);
            return stat.size;
        } finally {
            closeSync(fd);
        }
    },
    readRange: (file, offset, length) => {
        const fd = openSync(file, 'r');
        try {
            const out = new Uint8Array(length);
            let done = 0;
            while (done < length) {
                const got = readSync(fd, out, done, length - done, offset + done);
                if (got === 0) break;
                done += got;
            }
            return done === length ? out : out.subarray(0, done);
        } finally {
            closeSync(fd);
        }
    },
    segment: (file, fetch) => {
        segmentFile(file, fetch);
    },
    list: (dir) => readdirSync(dir),
    makeDirectory: (dir) => {
        mkdirSync(dir, { recursive: true });
    },
    write: (file, bytes) => {
        writeFileSync(file, bytes);
    },
};

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
    const format = unitFileFormat(filePath);
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
 * Supports `.beast2` / `.beast` (source map read from the blob), `.json` and
 * `.east` (no source map available — field stays null): east's
 * `loadUnitProgram` over this machine's files.
 */
export function loadEastIR(filePath: string): EastIR<any, any> | AsyncEastIR<any, any> {
    return loadUnitProgram(nodeUnitIO, filePath);
}

/**
 * Loads input data from a file, decoded whole.
 *
 * Task inputs decode **frozen**: deeply immutable from construction, with
 * mutating builtins throwing the uniform runtime error naming the copy-first
 * remedy. Frozen collections compare by value under East `Is`. A manifest is
 * the collection it names, its segments spliced from the files beside it, each
 * asked of the host when it places segments as they are read.
 *
 * @param filePath - Path to the input file
 * @param type - The expected East type of the input
 * @returns Decoded value
 */
export function loadInput(filePath: string, type: EastTypeValue): unknown {
    return loadUnitInput(nodeUnitIO, filePath, type, fetchingSegments());
}

/**
 * Bytes a value from {@link loadInputLazy} has read so far: the geometry
 * (tail and head), every fence probe, and each segment frame decoded, across
 * the input file and every segment file a manifest-rooted input opened.
 * `undefined` for any other value.
 *
 * @param value - a task input value
 * @returns the byte count, or `undefined` when the value was not opened lazily
 */
export function lazyInputBytesRead(value: unknown): number | undefined {
    return lazyUnitInputBytesRead(value);
}

/**
 * Opens an input file as a lazy pager-backed collection value, when it can
 * be: a beast2 v5 collection blob carrying a segment index, or a manifest over
 * its segment files. Size, iteration and keyed reads are then served from the
 * index with O(segment) decoded memory; any other operation hydrates
 * transparently to the eager value's exact semantics, and what that added to
 * the process's resident memory is kept for the runner's verbose account.
 *
 * The file is never buffered whole: the value pages segment frames from it
 * through positioned reads (a Set or Dict input's first keyed read probes
 * every segment's fence once), so its residency is the page cache and the
 * process heap holds one decoded segment at a time — the difference between an
 * out-of-memory kill and graceful eviction for an input near the runner's
 * memory limit.
 *
 * Returns `undefined` when the file cannot be served lazily (a non-beast2
 * format, a v4 or index-less blob, a non-collection root, cross-segment
 * aliasing, or an element shape carrying a `Ref` or function values) — the
 * caller falls back to {@link loadInput}.
 *
 * The value opens **frozen**, like every task input, which is what makes
 * lazy service safe for any nested element shape: frozen values cannot be
 * mutated (no write through a freshly decoded element to drop) and frozen
 * collections compare by value. Only `Ref` (an identity cell even when
 * frozen) and function shapes fall back to the eager (frozen) decode.
 *
 * Its pager keeps the segments keyed and index reads decode, up to
 * {@link pagedCacheBytes} of decoded weight.
 *
 * @param filePath - Path to the input file
 * @returns The lazy collection value, or `undefined` to fall back
 */
export function loadInputLazy(filePath: string): unknown | undefined {
    const cacheBytes = pagedCacheBytes();
    return openUnitInputLazy(nodeUnitIO, filePath, {
        fetch: fetchingSegments(),
        resident: residentBytes,
        ...(cacheBytes !== undefined && { cacheBytes }),
    });
}

/**
 * The bytes an input stands for: the collection a manifest-rooted file names
 * — the manifest and every segment file — or any other file's own size.
 *
 * @remarks
 * What the verbose account weighs an input at. A manifest is a few dozen bytes
 * per segment whatever the collection weighs, so its file's size would say
 * nothing of what the input holds. The manifest is recognised through a
 * positioned reader, so a large blob is never read to learn that it is not
 * one.
 *
 * @param filePath - Path to the input file
 * @returns the byte count
 */
export function inputBytes(filePath: string): number {
    return unitInputBytes(nodeUnitIO, filePath);
}
