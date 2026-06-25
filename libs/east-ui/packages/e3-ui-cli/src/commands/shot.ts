/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `e3-ui shot` — render an east-ui / e3-ui component to a PNG. Exactly one
 * source: `--from-source` (a TS/TSX file), `--from-ir` (serialized IR), or
 * `--from-task` (a live e3 task). Static and `State`-only components render with
 * no backend; `--from-task` fetches a task's already-computed output.
 *
 * @packageDocumentation
 */

import { basename } from 'node:path';
import { renderToPng, renderTaskToPng } from '../render.js';
import { detectFormat, type InputFormat } from '../payload.js';
import type { CaptureMode } from '../capture.js';

/** Options accepted by the `shot` command (commander camel-cases flags). */
export interface ShotCommandOptions {
    fromSource?: string;
    fromIr?: string;
    fromTask?: string;
    repo?: string;
    export?: string;
    output?: string;
    html?: boolean;
    viewport?: string;
    dpr?: string;
    fullPage?: boolean;
    element?: string;
    wait?: string;
    timeout?: string;
    storageKey?: string;
}

/** Max Chromium viewport dimension (px). */
const MAX_VIEWPORT = 16384;
/** Max device scale factor — `viewport × dpr` is the raster size, so an
 *  unbounded dpr can OOM Chromium. */
const MAX_DPR = 8;

/** Parse `--dpr`, bounded to a sane range (mirrors the viewport bound). */
export function parseDpr(value: string): number {
    const n = parsePositive(value, '--dpr');
    if (n > MAX_DPR) throw new Error(`Invalid --dpr "${value}" (must be 1..${MAX_DPR})`);
    return n;
}

/** Parse `WIDTHxHEIGHT`, bounded to a sane positive range. */
export function parseViewport(spec: string): { width: number; height: number } {
    const m = /^(\d+)x(\d+)$/i.exec(spec.trim());
    if (!m) throw new Error(`Invalid --viewport "${spec}" (expected WIDTHxHEIGHT, e.g. 1280x900)`);
    const width = Number(m[1]);
    const height = Number(m[2]);
    if (width < 1 || height < 1 || width > MAX_VIEWPORT || height > MAX_VIEWPORT) {
        throw new Error(`Invalid --viewport "${spec}" (each dimension must be 1..${MAX_VIEWPORT})`);
    }
    return { width, height };
}

export function parsePositive(value: string, flag: string): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${flag} "${value}" (expected a positive number)`);
    return n;
}

/** Split a `<workspace>.<task>` specifier on its first dot. */
export function parseTaskPath(spec: string): { workspace: string; task: string } {
    const dot = spec.indexOf('.');
    if (dot <= 0 || dot === spec.length - 1) {
        throw new Error(`Invalid --from-task "${spec}" (expected <workspace>.<task>)`);
    }
    return { workspace: spec.slice(0, dot), task: spec.slice(dot + 1) };
}

/** Detect the IR format of a `--from-ir` file (rejecting `.ts`/`.tsx`). */
export function detectIrFormat(filePath: string): InputFormat {
    const format = detectFormat(filePath);
    if (format === 'ts') {
        throw new Error(`"${filePath}" is a TypeScript source — use --from-source, not --from-ir.`);
    }
    return format;
}

/** Default PNG base name: `<file-without-ext>` / `<ws>.<task>` / `shot`. */
export function stripExt(filePath: string): string {
    return basename(filePath).replace(/\.(tsx?|beast2|json)$/i, '');
}

/** Shared capture options parsed from the CLI flags. */
function captureOptionsFrom(options: ShotCommandOptions): {
    mode: CaptureMode;
    viewport?: { width: number; height: number };
    deviceScaleFactor?: number;
    settleMs?: number;
    timeoutMs?: number;
} {
    let mode: CaptureMode = { kind: 'frame' };
    if (options.element) mode = { kind: 'element', selector: options.element };
    else if (options.fullPage) mode = { kind: 'full-page' };
    return {
        mode,
        ...(options.viewport ? { viewport: parseViewport(options.viewport) } : {}),
        ...(options.dpr ? { deviceScaleFactor: parseDpr(options.dpr) } : {}),
        ...(options.wait ? { settleMs: parsePositive(options.wait, '--wait') } : {}),
        ...(options.timeout ? { timeoutMs: parsePositive(options.timeout, '--timeout') } : {}),
    };
}

/** Commander action for `e3-ui shot`. */
export async function shotCommand(options: ShotCommandOptions): Promise<void> {
    try {
        const sources = [
            options.fromSource !== undefined ? 'source' : null,
            options.fromIr !== undefined ? 'ir' : null,
            options.fromTask !== undefined ? 'task' : null,
        ].filter((s): s is string => s !== null);
        if (sources.length !== 1) {
            throw new Error('Provide exactly one of --from-source, --from-ir, or --from-task.');
        }

        // --from-task: a live e3 task.
        if (options.fromTask !== undefined) {
            if (!options.repo) throw new Error('--from-task requires --repo (a local e3 repository path).');
            const { workspace, task } = parseTaskPath(options.fromTask);
            const output = options.output ?? `${workspace}.${task}.png`.replace(/[^\w.-]+/g, '_');
            const html = options.html ? output.replace(/\.png$/i, '') + '.html' : undefined;
            await renderTaskToPng({ repo: options.repo, workspace, task, output, html, ...captureOptionsFrom(options) });
            console.log(`Wrote ${output}${html ? ` and ${html}` : ''}`);
            return;
        }

        // --from-source (.ts/.tsx) or --from-ir (.beast2/.json | stdin).
        let inputPath: string | null;
        let from: InputFormat;
        let outBase: string;
        if (options.fromSource !== undefined) {
            inputPath = options.fromSource;
            from = 'ts';
            outBase = stripExt(options.fromSource);
        } else {
            const ir = options.fromIr!;
            inputPath = ir === '-' ? null : ir;
            from = inputPath ? detectIrFormat(inputPath) : 'beast2';
            outBase = inputPath ? stripExt(inputPath) : 'shot';
        }

        const output = options.output ?? `${outBase}.png`;
        const html = options.html ? output.replace(/\.png$/i, '') + '.html' : undefined;

        await renderToPng({
            input: { path: inputPath, from, exportName: options.export },
            output,
            html,
            ...captureOptionsFrom(options),
            ...(options.storageKey ? { storageKey: options.storageKey } : {}),
        });

        console.log(`Wrote ${output}${html ? ` and ${html}` : ''}`);
    } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}
