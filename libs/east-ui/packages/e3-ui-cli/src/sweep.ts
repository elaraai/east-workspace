/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `e3-ui shots` — sweep a project for every renderable UI export and render
 * each to `<outDir>/<relative-path-sans-ext>/<exportName>.png` (and optionally
 * a standalone `.html` beside it).
 *
 * Discovery walks the given paths (directories recurse; `*.spec.*`, `*.d.ts`,
 * `node_modules`, and the output directory itself are excluded). Each file is
 * esbuild-loaded ONCE, its exports classified at the IR level (`detect.ts` —
 * output type vs `UIComponentType`, zero inputs, workspace-bound platform
 * calls), and every render candidate captured through ONE shared browser
 * session. Nothing is silently dropped: files that fail to load and exports
 * that are skipped each carry their reason in the summary (and the optional
 * JSON manifest), so a sweep doubles as an audit of the project's renderable
 * surface.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadSourceExports } from './load-source.js';
import { classifyExports, describeSkip, detectContextFor } from './detect.js';
import { openCaptureSession, type SessionCaptureOptions } from './capture.js';
import { defaultAppDir } from './render.js';
import { encodeEastIR, type EastIR } from '@elaraai/east';

/** One rendered export. */
export interface SweepRendered {
    file: string;
    exportName: string;
    png: string;
    html?: string | undefined;
}

/** One skipped export (or a whole file that failed to load/classify). */
export interface SweepSkipped {
    file: string;
    /** Absent for file-level skips (load errors, no detect context). */
    exportName?: string | undefined;
    reason: string;
}

/** One render FAILURE (a classified-renderable export whose capture threw). */
export interface SweepFailed {
    file: string;
    exportName: string;
    error: string;
}

/** The sweep outcome. `failed.length > 0` should exit non-zero. */
export interface SweepResult {
    rendered: SweepRendered[];
    skipped: SweepSkipped[];
    failed: SweepFailed[];
}

/** Options for {@link sweep}. */
export interface SweepOptions {
    /** Files or directories to sweep (directories recurse). Default: `src`. */
    paths?: string[];
    /** Base directory for discovery + relative output layout. Default: cwd. */
    cwd?: string;
    /** Output directory. Default: `.shots`. */
    outDir?: string;
    /** Also write a standalone HTML beside each PNG. */
    html?: boolean;
    /** Also write `<outDir>/manifest.json` describing the sweep. */
    json?: boolean;
    /** Component-frame mount width. Default `'full'` — width-flexible
     *  components render faithfully; pass `undefined` explicitly via the CLI's
     *  `--frame-width none` for the historical shrink-to-fit crop. */
    frameWidth?: string | undefined;
    /** Chromium viewport. */
    viewport?: { width: number; height: number } | undefined;
    /** Device scale factor. */
    deviceScaleFactor?: number | undefined;
    /** Settle time after skeletons clear (ms). */
    settleMs?: number | undefined;
    /** Per-capture timeout (ms). */
    timeoutMs?: number | undefined;
    /** Override the prebuilt app directory. */
    appDir?: string | undefined;
    /** Progress/summary sink. Default `console.log`. */
    log?: (line: string) => void;
    /** Render override for tests: receives each candidate's capture options.
     *  When set, no browser session is opened. */
    render?: (opts: SessionCaptureOptions) => Promise<void>;
}

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git']);

/** Recursively collect `.ts`/`.tsx` sources under `entry` (a file or dir). */
async function discover(entry: string, outDirAbs: string): Promise<string[]> {
    const stat = await fs.stat(entry).catch(() => null);
    if (stat === null) return [];
    if (stat.isFile()) {
        return isSweepableSource(entry) ? [entry] : [];
    }
    if (!stat.isDirectory() || path.resolve(entry) === outDirAbs) return [];
    const out: string[] = [];
    for (const name of (await fs.readdir(entry)).sort()) {
        if (EXCLUDED_DIRS.has(name)) continue;
        const child = path.join(entry, name);
        const childStat = await fs.stat(child).catch(() => null);
        if (childStat?.isDirectory()) {
            if (path.resolve(child) !== outDirAbs) out.push(...await discover(child, outDirAbs));
        } else if (childStat?.isFile() && isSweepableSource(child)) {
            out.push(child);
        }
    }
    return out;
}

/** Is `file` a sweepable TS/TSX source (not a spec, not a declaration)? */
export function isSweepableSource(file: string): boolean {
    if (!/\.tsx?$/i.test(file)) return false;
    if (/\.d\.ts$/i.test(file)) return false;
    if (/\.spec\.tsx?$/i.test(file)) return false;
    return true;
}

/** The output basename (no extension) for a swept file, relative to `cwd` —
 *  `src/ui/index.tsx` → `src/ui/index`. Paths outside `cwd` fall back to a
 *  flattened basename. */
export function outputStemFor(file: string, cwd: string): string {
    const rel = path.relative(cwd, path.resolve(file));
    const safe = rel.startsWith('..') ? path.basename(file) : rel;
    return safe.replace(/\.tsx?$/i, '');
}

/**
 * Sweep `paths` and render every renderable UI export.
 *
 * @param opts - Sweep options
 * @returns The sweep outcome (rendered / skipped / failed)
 * @throws If the browser session cannot be opened (no browser installed)
 */
export async function sweep(opts: SweepOptions = {}): Promise<SweepResult> {
    const cwd = path.resolve(opts.cwd ?? process.cwd());
    const outDir = path.resolve(cwd, opts.outDir ?? '.shots');
    const log = opts.log ?? ((line: string) => console.log(line));
    const entries = (opts.paths?.length ? opts.paths : ['src']).map(p => path.resolve(cwd, p));

    const files: string[] = [];
    for (const entry of entries) files.push(...await discover(entry, outDir));
    if (files.length === 0) {
        log(`[e3-ui shots] no .ts/.tsx sources found under: ${entries.map(e => path.relative(cwd, e) || '.').join(', ')}`);
        return { rendered: [], skipped: [], failed: [] };
    }

    const result: SweepResult = { rendered: [], skipped: [], failed: [] };

    // Classify everything FIRST (no browser needed), then render candidates
    // through one session — so a project with nothing renderable never launches
    // Chromium at all.
    interface Candidate { file: string; exportName: string; b64: string }
    const candidates: Candidate[] = [];
    for (const file of files) {
        const rel = path.relative(cwd, file);
        let moduleExports: Record<string, unknown>;
        try {
            moduleExports = await loadSourceExports(file);
        } catch (err) {
            result.skipped.push({ file: rel, reason: `failed to load: ${err instanceof Error ? err.message : String(err)}` });
            continue;
        }
        const ctx = await detectContextFor(file);
        if (ctx === null) {
            result.skipped.push({ file: rel, reason: 'project has no resolvable @elaraai/east — nothing to classify' });
            continue;
        }
        for (const c of classifyExports(moduleExports, ctx)) {
            if (!c.renderable || c.fn === undefined) {
                // Plain non-East exports (types, constants, helpers) are noise,
                // not signal — only East-shaped exports get skip lines.
                if (c.shape !== null && c.skip !== undefined) {
                    result.skipped.push({ file: rel, exportName: c.name, reason: describeSkip(c.skip) });
                }
                continue;
            }
            try {
                const bytes = encodeEastIR(c.fn.toIR() as EastIR<unknown[], unknown>);
                candidates.push({ file: rel, exportName: c.name, b64: Buffer.from(bytes).toString('base64') });
            } catch (err) {
                result.failed.push({ file: rel, exportName: c.name, error: `IR encode failed: ${err instanceof Error ? err.message : String(err)}` });
            }
        }
    }

    if (candidates.length === 0) {
        summarize(result, outDir, cwd, log);
        if (opts.json) await writeManifest(result, outDir);
        return result;
    }

    const render = opts.render;
    const session = render ? null : await openCaptureSession(opts.appDir ?? defaultAppDir());
    try {
        let done = 0;
        for (const cand of candidates) {
            const stem = outputStemFor(path.resolve(cwd, cand.file), cwd);
            const dir = path.join(outDir, stem);
            await fs.mkdir(dir, { recursive: true });
            const png = path.join(dir, `${cand.exportName}.png`);
            const html = opts.html ? path.join(dir, `${cand.exportName}.html`) : undefined;
            const captureOpts: SessionCaptureOptions = {
                payload: { kind: 'component', b64: cand.b64 },
                outPng: png,
                outHtml: html,
                // Sweep default is a FAITHFUL-width mount; `'none'` opts back
                // into the historical shrink-to-fit crop.
                frameWidth: opts.frameWidth === 'none' ? undefined : (opts.frameWidth ?? 'full'),
                viewport: opts.viewport,
                deviceScaleFactor: opts.deviceScaleFactor,
                settleMs: opts.settleMs,
                timeoutMs: opts.timeoutMs,
            };
            done += 1;
            try {
                await (render ? render(captureOpts) : session!.captureOne(captureOpts));
                result.rendered.push({ file: cand.file, exportName: cand.exportName, png: path.relative(cwd, png), html: html ? path.relative(cwd, html) : undefined });
                log(`[e3-ui shots] ${done}/${candidates.length}  ${cand.file} › ${cand.exportName}`);
            } catch (err) {
                result.failed.push({ file: cand.file, exportName: cand.exportName, error: err instanceof Error ? err.message : String(err) });
                log(`[e3-ui shots] ${done}/${candidates.length}  ${cand.file} › ${cand.exportName} FAILED`);
            }
        }
    } finally {
        await session?.close();
    }

    summarize(result, outDir, cwd, log);
    if (opts.json) await writeManifest(result, outDir);
    return result;
}

function summarize(result: SweepResult, outDir: string, cwd: string, log: (line: string) => void): void {
    log(`[e3-ui shots] done — ${result.rendered.length} rendered, ${result.skipped.length} skipped, ${result.failed.length} failed → ${path.relative(cwd, outDir) || '.'}`);
    for (const s of result.skipped) {
        log(`  skipped  ${s.file}${s.exportName ? ` › ${s.exportName}` : ''} — ${s.reason}`);
    }
    for (const f of result.failed) {
        log(`  FAILED   ${f.file} › ${f.exportName} — ${f.error}`);
    }
}

async function writeManifest(result: SweepResult, outDir: string): Promise<void> {
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
