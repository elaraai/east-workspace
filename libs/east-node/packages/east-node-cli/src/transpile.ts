/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `east-node transpile` (#628): an East IR file printed as the TypeScript
 * `East.function` builder surface — `East.toSource` behind a CLI, the twin
 * of `east-py transpile`.
 *
 * The printed module rebuilds the same IR (normalized) when imported, and a
 * rebuild proves it here: the module is imported against this CLI's own
 * `@elaraai/east` and the IR it builds is returned (and written, on the
 * CLI) beside the source. That is the TypeScript leg of the cross-language
 * round trip the east-py conformance suite drives: IR → python → IR →
 * TypeScript → IR, every leg equal under `east-c ir normalize`.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encodeEastIR, encodeJSONFor, IRType, toSource } from '@elaraai/east';
import type { EastIR, AsyncEastIR } from '@elaraai/east';
import { loadIR } from './loader.js';

/** Options for {@link transpile}. */
export interface TranspileOptions {
    /** The module-level export bound to the rebuilt function (default `main`). */
    name?: string;
    /** The module specifier the printed source imports from (default `@elaraai/east`). */
    importFrom?: string;
    /** Import the printed module and return the IR it builds. */
    rebuild?: boolean;
}

/** The result of transpiling one IR file. */
export interface Transpiled {
    /** The printed TypeScript module. */
    source: string;
    /** The IR the printed module builds — present when `rebuild` was requested. */
    rebuilt?: EastIR<any, any> | AsyncEastIR<any, any>;
}

const IR_EXTENSIONS = new Set(['.beast2', '.beast', '.east', '.json']);

/**
 * Prints an IR file as a TypeScript module, optionally rebuilding it.
 *
 * @param irPath - Path to the IR file (`.beast2`, `.beast`, `.east`, or `.json`)
 * @param options - Export name, import specifier, and whether to rebuild
 * @returns The module source, and the rebuilt IR when requested
 * @throws When the file is not a function IR, or the IR has a shape the
 *   TypeScript surface cannot spell (`Unprintable`), or the printed module
 *   does not rebuild
 */
export async function transpile(irPath: string, options: TranspileOptions = {}): Promise<Transpiled> {
    const name = options.name ?? 'main';
    const importFrom = options.importFrom ?? '@elaraai/east';
    const ir = loadIR(irPath);
    const source = toSource(ir, { name, importFrom });
    if (!options.rebuild) return { source };
    return { source, rebuilt: await rebuild(source, name, importFrom) };
}

/**
 * Imports a printed module against this CLI's own `@elaraai/east` and
 * returns what its export builds.
 *
 * The module's import line is the printer's own (`from "<importFrom>"`);
 * it is retargeted at the resolved package so the module loads from a
 * temporary directory that has no `node_modules`.
 */
async function rebuild(source: string, name: string, importFrom: string): Promise<EastIR<any, any> | AsyncEastIR<any, any>> {
    const east = import.meta.resolve('@elaraai/east');
    const retargeted = source.replace(`from ${JSON.stringify(importFrom)};`, `from ${JSON.stringify(east)};`);
    const dir = mkdtempSync(join(tmpdir(), 'east-transpile-'));
    try {
        const path = join(dir, 'module.mjs');
        writeFileSync(path, retargeted, 'utf-8');
        const mod = await import(pathToFileURL(path).href);
        const fn = mod[name];
        if (fn === undefined || typeof fn.toIR !== 'function') {
            throw new Error(`the printed module has no East function export named ${JSON.stringify(name)}`);
        }
        return fn.toIR();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * Encodes a rebuilt IR for a path: `.beast2` / `.beast` as the IR bundle
 * (source map included), `.json` as the raw IR JSON `east-node run` reads.
 *
 * @param eastIR - The rebuilt IR bundle
 * @param outPath - The path it will be written to; its extension picks the format
 * @returns The encoded bytes
 */
export function encodeRebuilt(eastIR: EastIR<any, any> | AsyncEastIR<any, any>, outPath: string): Uint8Array {
    const ext = extname(outPath).toLowerCase();
    if (ext === '.beast2' || ext === '.beast') return encodeEastIR(eastIR);
    if (ext === '.json') return encodeJSONFor(IRType)(eastIR.ir as any);
    throw new Error(`Unsupported rebuild extension "${ext}". Supported extensions: .beast2, .beast, .json`);
}

/**
 * Transpiles every IR file in a directory: `<stem>.ts` under `outDir` for
 * each `<stem>.<beast2|beast|east|json>`, and — when `rebuildDir` is given —
 * `<stem>.beast2` there holding the IR each module builds.
 *
 * @param inDir - The directory of IR files (other files are ignored)
 * @param outDir - Where the modules go (created)
 * @param options - Export name, import specifier, and the rebuild directory
 * @returns The stems transpiled, in order
 * @throws On the first file that does not transpile, naming it
 */
export async function transpileDir(inDir: string, outDir: string, options: TranspileOptions & { rebuildDir?: string } = {}): Promise<string[]> {
    const files = readdirSync(inDir).filter(f => IR_EXTENSIONS.has(extname(f).toLowerCase())).sort();
    mkdirSync(outDir, { recursive: true });
    if (options.rebuildDir !== undefined) mkdirSync(options.rebuildDir, { recursive: true });
    const stems: string[] = [];
    for (const file of files) {
        const stem = basename(file, extname(file));
        let result: Transpiled;
        try {
            result = await transpile(join(inDir, file), { ...options, rebuild: options.rebuildDir !== undefined });
        } catch (err) {
            throw new Error(`${file}: ${(err as Error).message}`);
        }
        writeFileSync(join(outDir, `${stem}.ts`), result.source, 'utf-8');
        if (options.rebuildDir !== undefined) {
            const out = join(options.rebuildDir, `${stem}.beast2`);
            writeFileSync(out, encodeRebuilt(result.rebuilt!, out));
        }
        stems.push(stem);
    }
    return stems;
}

/** Whether a path is a directory. */
export function isDirectory(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}
