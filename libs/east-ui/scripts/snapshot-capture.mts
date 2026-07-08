/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Shared Playwright snapshot capture for east-ui-family showcases.
 *
 * Boots a Vite dev server against a caller-supplied root, navigates
 * Chromium to `?<param>=<fileKey>` once per target, waits for East
 * compilation skeletons to clear, then writes a paired standalone `.html`
 * + full-page `.png` per target. Brand fonts are inlined as data URIs so
 * the HTML opens self-contained over `file://`.
 *
 * Used by both `east-ui-showcase` (pure east-ui examples) and
 * `e3-ui-components` (e3-task-bound examples that seed a dataset cache
 * before render). The per-package browser entry decides what to render;
 * this module owns the generic boot → navigate → capture loop.
 *
 * @packageDocumentation
 */

import { chromium, type Browser, type LaunchOptions } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import * as fs from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** The newest chromium binary in the playwright browser cache (any build
 *  number), or a system Chrome/Chromium — the e3-ui-cli acquisition cascade,
 *  inlined. Playwright's own launch insists on its EXACT version-matched
 *  build, so an offline box whose cache holds an older (perfectly capable)
 *  chromium hard-fails the snapshot run; this fallback keeps the harness
 *  working. Ubuntu snap shims are skipped (snap confinement breaks
 *  automation). */
function fallbackChromiumPath(): string | undefined {
    const cacheRoot = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(os.homedir(), '.cache', 'ms-playwright');
    try {
        const entries = readdirSync(cacheRoot)
            .map(name => /^(chromium|chromium_headless_shell)-(\d+)$/.exec(name))
            .filter((m): m is RegExpExecArray => m !== null)
            // Prefer full chromium over the headless shell, then newest build.
            .sort((a, b) => (a[1] === b[1] ? Number(b[2]) - Number(a[2]) : a[1] === 'chromium' ? -1 : 1));
        for (const m of entries) {
            const dir = path.join(cacheRoot, m[0]!);
            for (const rel of [
                'chrome-linux64/chrome', 'chrome-linux/chrome',
                'chrome-headless-shell-linux64/chrome-headless-shell',
                'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
                'chrome-headless-shell-mac/chrome-headless-shell',
            ]) {
                const p = path.join(dir, rel);
                if (existsSync(p)) return p;
            }
        }
    } catch { /* no cache dir — fall through to system browsers */ }
    for (const p of [
        '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome',
        '/usr/bin/chromium', '/usr/bin/chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ]) {
        // A snap shim exec-wraps the real binary and breaks automation.
        if (existsSync(p) && !p.startsWith('/snap/')) return p;
    }
    return undefined;
}

/** Launch Chromium: an explicit `PW_EXECUTABLE_PATH` / `E3_UI_CHROMIUM_PATH`
 *  override wins; otherwise playwright's version-matched cache; otherwise any
 *  cached/system chromium via {@link fallbackChromiumPath}. Exported so the
 *  probe-* diagnostics share the same resolution as the snapshot pipeline. */
export async function launchChromium(options: LaunchOptions): Promise<Browser> {
    const explicit = process.env.PW_EXECUTABLE_PATH ?? process.env.E3_UI_CHROMIUM_PATH;
    if (explicit) return chromium.launch({ ...options, executablePath: explicit });
    try {
        return await chromium.launch(options);
    } catch (err) {
        const fallback = fallbackChromiumPath();
        if (fallback === undefined) throw err;
        console.log(`[snapshot] playwright's bundled chromium unavailable — using ${fallback}`);
        return chromium.launch({ ...options, executablePath: fallback });
    }
}

/** One page to snapshot — `query` becomes the `?k=v&…` the entry reads,
 *  `outName` is the basename (no extension) of the written `.html` / `.png`
 *  pair. */
export interface SnapshotTarget {
    query: Record<string, string>;
    outName: string;
}

export interface CaptureConfig {
    /** Vite dev-server root (the dir containing the entry `index.html`). */
    viteRoot: string;
    /** Explicit vite config path. When omitted, vite resolves from `viteRoot`. */
    configFile?: string;
    /** Directory the `.html` / `.png` pairs are written to. */
    outDir: string;
    /** Pages to capture. */
    targets: SnapshotTarget[];
    /** Chromium viewport. Default 1280×900. */
    viewport?: { width: number; height: number };
    /** Grace period (ms) after skeletons clear before capture. Default 300. */
    settleMs?: number;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c] as string));
}

/**
 * Rewrite captured `latin-wght-normal.woff2` font URLs to base64 data URIs
 * so the standalone HTML is self-contained. Base-agnostic: matches any
 * dev-server prefix before `@fs/.../latin-wght-normal.woff2`.
 */
const fontCache = new Map<string, string>();
async function inlineLatinFonts(css: string): Promise<string> {
    const re = /url\("([^"]*@fs(\/[^"]*latin-wght-normal\.woff2))"\)/g;
    const fsPaths = new Set<string>();
    for (const m of css.matchAll(re)) fsPaths.add(m[2]!);
    for (const fsPath of fsPaths) {
        if (fontCache.has(fsPath)) continue;
        try {
            const buf = await fs.readFile(fsPath);
            fontCache.set(fsPath, `data:font/woff2;base64,${buf.toString('base64')}`);
        } catch {
            fontCache.set(fsPath, '');
        }
    }
    return css.replace(re, (full, _viteUrl, fsPath) => {
        const dataUri = fontCache.get(fsPath);
        return dataUri ? `url("${dataUri}")` : full;
    });
}

/**
 * Boot vite, capture every target to `<outDir>/<outName>.{html,png}`, tear
 * down. Returns `{ captured, failed }`.
 */
export async function captureFiles(cfg: CaptureConfig): Promise<{ captured: number; failed: number }> {
    const viewport = cfg.viewport ?? { width: 1280, height: 900 };
    const settleMs = cfg.settleMs ?? 300;

    const server: ViteDevServer = await createServer({
        root: cfg.viteRoot,
        ...(cfg.configFile ? { configFile: cfg.configFile } : {}),
        server: { port: 0, strictPort: false, host: '127.0.0.1' },
        logLevel: 'warn',
        // The IR packages rebuild without version bumps, which Vite's dep
        // cache keys on — force re-optimization so snapshots never render a
        // stale prebundle.
        optimizeDeps: { force: true },
    });
    await server.listen();
    const addr = server.httpServer?.address();
    const port = server.config.server.port ?? (addr && typeof addr === 'object' ? addr.port : 5173);
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`[snapshot] dev server: ${baseUrl}`);

    let browser: Browser | undefined;
    let captured = 0;
    let failed = 0;
    try {
        browser = await launchChromium({
            headless: true,
            args: ['--no-sandbox', '--disable-gpu'],
        });
        const context = await browser.newContext({ viewport });
        await fs.mkdir(cfg.outDir, { recursive: true });

        for (const target of cfg.targets) {
            const outPath = path.join(cfg.outDir, `${target.outName}.html`);
            const queryStr = Object.entries(target.query)
                .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
                .join('&');
            try {
                const page = await context.newPage();
                page.on('console', msg => {
                    if (msg.type() === 'error' || msg.type() === 'warning') {
                        console.log(`[browser:${msg.type()}] ${target.outName}: ${msg.text()}`);
                    }
                });
                page.on('pageerror', err => {
                    console.log(`[browser:pageerror] ${target.outName}: ${err.message}`);
                });
                const navStart = Date.now();
                await page.goto(`${baseUrl}/?${queryStr}`, {
                    waitUntil: 'networkidle',
                    timeout: 30_000,
                });
                // Vite optimizes newly-seen deps on first request and triggers a
                // full reload that destroys any in-flight evaluate. Reload once
                // up front so the optimized graph is settled before we capture.
                await page.waitForTimeout(500);
                await page.reload({ waitUntil: 'networkidle', timeout: 30_000 });
                await page.evaluate(() => document.fonts.ready);
                // Wait for the snapshot app to boot past its "Loading…" state
                // (cold Vite can compile a newly-seen example module slower than
                // the skeleton wait), then for any in-component skeletons to clear.
                try {
                    await page.waitForFunction(
                        () => document.querySelector('[data-snapshot-boot]') === null,
                        { timeout: 25_000, polling: 100 },
                    );
                } catch {
                    console.warn(`[snapshot]   ${target.outName}: still booting at timeout`);
                }
                try {
                    await page.waitForFunction(
                        () => document.querySelectorAll('.elara-skeleton').length === 0,
                        { timeout: 25_000, polling: 200 },
                    );
                } catch {
                    console.warn(`[snapshot]   ${target.outName}: skeletons still present at timeout`);
                }
                await page.waitForTimeout(settleMs);

                const { bodyHtml, cssText: rawCss, titleText } = await page.evaluate(() => {
                    const css = Array.from(document.styleSheets)
                        .map(sheet => {
                            try {
                                return Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
                            } catch {
                                return '';
                            }
                        })
                        .filter(Boolean)
                        .join('\n\n');
                    return { bodyHtml: document.body.innerHTML, cssText: css, titleText: document.title || 'East UI snapshot' };
                });
                const cssText = await inlineLatinFonts(rawCss);

                const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(titleText)} — ${escapeHtml(target.outName)}</title>
    <style>
${cssText}
    </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
                await fs.writeFile(outPath, html, 'utf8');
                await page.screenshot({ path: outPath.replace(/\.html$/, '.png'), fullPage: true });
                await page.close();
                captured += 1;
                console.log(`[snapshot] ${captured}/${cfg.targets.length}  ${target.outName}  (${Date.now() - navStart} ms)`);
            } catch (err) {
                failed += 1;
                console.warn(`[snapshot] FAILED ${target.outName}:`, (err as Error).message);
            }
        }
        console.log(`[snapshot] done — wrote ${captured} files (${failed} failed) → ${cfg.outDir}`);
    } finally {
        await browser?.close();
        await server.close();
    }
    return { captured, failed };
}
