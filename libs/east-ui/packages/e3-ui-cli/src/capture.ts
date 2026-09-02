/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Headless capture: serve the prebuilt browser app, inject the component
 * payload, wait for fonts + render to settle, and screenshot to PNG.
 *
 * The app is served over a throwaway `node:http` server (NOT `file://` —
 * Chromium blocks ES-module scripts loaded from `file://` on CORS grounds).
 * The wait/settle/screenshot loop mirrors the in-repo snapshot pipeline
 * (`libs/east-ui/scripts/snapshot-capture.mts`).
 *
 * @packageDocumentation
 */

import { createServer, type Server } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { launchBrowser } from './browser.js';
import type { ShotPayload } from './payload.js';

/** Default capture parameters — single source of truth (CLI help text in
 *  `cli.ts` documents these values; keep them in sync). */
export const CAPTURE_DEFAULTS = {
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    settleMs: 300,
    timeoutMs: 30_000,
    storageKey: 'shot',
    statusPollMs: 100,
    skeletonPollMs: 200,
    errorTextLimit: 600,
} as const;

/** How the screenshot is framed. */
export type CaptureMode =
    | { kind: 'frame' }                 // tight crop of the component frame (default)
    | { kind: 'full-page' }             // the whole scrolled page
    | { kind: 'element'; selector: string };

/** Options for a single capture. */
export interface CaptureOptions {
    /** Directory of the prebuilt app bundle (the built `dist/app`). */
    appDir: string;
    /** The render payload (base64 IR). */
    payload: ShotPayload;
    /** Output PNG path. */
    outPng: string;
    /** When set, also write a self-contained HTML snapshot here. */
    outHtml?: string | undefined;
    /** Storage key prefix for persisted component state. */
    storageKey?: string;
    /** Chromium viewport. Default 1280×900. */
    viewport?: { width: number; height: number };
    /** Device scale factor (DPR). Default 2. */
    deviceScaleFactor?: number;
    /** Framing. Default `{ kind: 'frame' }`. */
    mode?: CaptureMode;
    /** Component-frame mount width: `'full'` (fill the viewport width — right
     *  for width-flexible components like Schematic/Plan/Table, which collapse
     *  in the default shrink-to-fit frame) or a CSS width (`'900px'`). Default:
     *  shrink-to-fit (the historical tight crop). */
    frameWidth?: string | undefined;
    /** Grace period (ms) after skeletons clear before capture. Default 300. */
    settleMs?: number;
    /** Per-navigation timeout (ms). Default 30000. */
    timeoutMs?: number;
    /** Outline any element whose content overflows its box before capture —
     *  surfaces collapsed / clipped regions invisible in a normal shot (#320). */
    debugLayout?: boolean | undefined;
}

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

/** Serve the prebuilt app directory over a random localhost port. */
/**
 * Resolve a URL pathname to a file within `root`, or `null` if it would escape
 * (path traversal). Uses a separator-boundary check so a sibling dir sharing the
 * root's prefix cannot pass. Exported for unit tests.
 */
export function resolveWithinRoot(root: string, urlPathname: string): string | null {
    const resolvedRoot = path.resolve(root);
    const rel = urlPathname === '/' ? 'index.html' : urlPathname.replace(/^\/+/, '');
    const filePath = path.join(resolvedRoot, rel);
    if (filePath !== resolvedRoot && !filePath.startsWith(resolvedRoot + path.sep)) return null;
    return filePath;
}

function serveApp(appDir: string): Promise<{ server: Server; baseUrl: string }> {
    const root = path.resolve(appDir);
    const server = createServer((req, res) => {
        void (async () => {
            try {
                const url = new URL(req.url ?? '/', 'http://localhost');
                const filePath = resolveWithinRoot(root, url.pathname);
                if (!filePath) {
                    res.statusCode = 403;
                    res.end('forbidden');
                    return;
                }
                const body = await readFile(filePath);
                res.statusCode = 200;
                res.setHeader('content-type', MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream');
                res.end(body);
            } catch {
                res.statusCode = 404;
                res.end('not found');
            }
        })();
    });
    return once(server.listen(0, '127.0.0.1'), 'listening').then(() => {
        const port = (server.address() as AddressInfo).port;
        return { server, baseUrl: `http://127.0.0.1:${port}` };
    });
}

/** Escape text for safe inclusion in HTML. Exported for unit tests. */
export function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c] as string));
}

/**
 * Inline `url(...woff2)` font references in CSS as base64 data URIs (read from
 * the app's built `assets/`), so the standalone HTML renders with the brand
 * fonts over `file://` with no server. A font that cannot be read is left as its
 * original (server-relative) URL and a warning is emitted — a silently broken
 * `--html` is worse than a visible warning. Exported for unit tests.
 */
export async function inlineFonts(css: string, appDir: string): Promise<string> {
    const assetsDir = path.join(appDir, 'assets');
    const re = /url\((['"]?)[^)'"]*?([^/)'"]+\.woff2)\1\)/g;
    const cache = new Map<string, string>();
    for (const m of css.matchAll(re)) {
        const name = m[2]!;
        if (cache.has(name)) continue;
        try {
            const buf = await readFile(path.join(assetsDir, name));
            cache.set(name, `data:font/woff2;base64,${buf.toString('base64')}`);
        } catch {
            cache.set(name, '');
            console.warn(`[e3-ui shot] could not inline font "${name}" into --html — it will be a relative URL that won't resolve standalone.`);
        }
    }
    return css.replace(re, (full, _q: string, name: string) => {
        const uri = cache.get(name);
        return uri ? `url(${uri})` : full;
    });
}

/**
 * Build a self-contained HTML snapshot: the rendered body + every stylesheet
 * rule serialized into one `<style>` block (Emotion injects rules via
 * `insertRule`, so they are NOT in the serialized DOM and must be read from
 * `document.styleSheets`), with fonts inlined and no scripts.
 */
async function selfContainedHtml(page: Page, appDir: string): Promise<string> {
    const { bodyHtml, cssText, title } = await page.evaluate(() => {
        // `document.styleSheets` (Emotion's injected <style>s) PLUS
        // `adoptedStyleSheets` (constructable sheets — where Vite injects the
        // @fontsource @font-face rules, which the styleSheets list misses).
        const sheets: CSSStyleSheet[] = [
            ...Array.from(document.styleSheets),
            ...(document.adoptedStyleSheets ?? []),
        ];
        const css = sheets
            .map(sheet => {
                try { return Array.from(sheet.cssRules).map(r => r.cssText).join('\n'); }
                catch { return ''; }
            })
            .filter(Boolean)
            .join('\n\n');
        return { bodyHtml: document.body.innerHTML, cssText: css, title: document.title || 'e3-ui shot' };
    });
    const inlined = await inlineFonts(cssText, appDir);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
${inlined}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

/** A single capture within an open {@link CaptureSession} — everything in
 *  {@link CaptureOptions} except the session-owned `appDir`. */
export type SessionCaptureOptions = Omit<CaptureOptions, 'appDir'>;

/** A reusable capture session: ONE served app + ONE browser across many
 *  captures (each in a fresh, isolated browser context). The per-shot browser
 *  launch dominates a multi-shot run, so the `shots` sweep opens one session. */
export interface CaptureSession {
    /** Render one payload to a PNG (and optionally a standalone HTML). */
    captureOne(opts: SessionCaptureOptions): Promise<void>;
    /** Close the browser and the app server. */
    close(): Promise<void>;
}

/**
 * Serve the prebuilt app and launch the browser once, for many captures.
 *
 * @param appDir - Directory of the prebuilt app bundle (the built `dist/app`)
 * @returns The open session
 * @throws If the prebuilt app is missing or no browser can be launched
 */
export async function openCaptureSession(appDir: string): Promise<CaptureSession> {
    // Pre-flight: fail clearly if the prebuilt app is missing, instead of
    // letting a 404 page turn into an opaque navigation timeout.
    if (!existsSync(path.join(appDir, 'index.html'))) {
        throw new Error(`Prebuilt app not found at ${appDir} — run \`make build\` (or \`npm run build\`) first.`);
    }
    const { server, baseUrl } = await serveApp(appDir);
    let browser: Browser;
    try {
        ({ browser } = await launchBrowser());
    } catch (err) {
        server.close();
        throw err;
    }
    return {
        captureOne: (opts) => captureInSession(browser, baseUrl, appDir, opts),
        close: async () => {
            await browser.close();
            server.close();
        },
    };
}

/**
 * Render a component payload to a PNG (and optionally a standalone HTML).
 *
 * @param opts - Capture options
 * @throws If the app reports a compile/render error, or capture times out
 */
export async function capture(opts: CaptureOptions): Promise<void> {
    const session = await openCaptureSession(opts.appDir);
    try {
        await session.captureOne(opts);
    } finally {
        await session.close();
    }
}

/** One capture on an already-open browser + app server. */
async function captureInSession(
    browser: Browser,
    baseUrl: string,
    appDir: string,
    opts: SessionCaptureOptions,
): Promise<void> {
    const viewport = opts.viewport ?? CAPTURE_DEFAULTS.viewport;
    const deviceScaleFactor = opts.deviceScaleFactor ?? CAPTURE_DEFAULTS.deviceScaleFactor;
    const mode = opts.mode ?? { kind: 'frame' };
    const settleMs = opts.settleMs ?? CAPTURE_DEFAULTS.settleMs;
    const timeout = opts.timeoutMs ?? CAPTURE_DEFAULTS.timeoutMs;
    const storageKey = opts.storageKey ?? CAPTURE_DEFAULTS.storageKey;

    const context = await browser.newContext({ viewport, deviceScaleFactor });
    try {
        const page = await context.newPage();

        const consoleErrors: string[] = [];
        page.on('pageerror', err => consoleErrors.push(err.message));
        page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

        // Inject the payload BEFORE any page script runs. The task-mode hard-stop
        // deadline is derived from the capture timeout (minus a buffer) so the app
        // always reports before the driver's navigation timeout fires.
        const taskDeadlineMs = Math.max(5_000, timeout - 5_000);
        await page.addInitScript(
            ([p, key, deadline, frameWidth]) => {
                (window as unknown as { __E3_UI_SHOT__: unknown }).__E3_UI_SHOT__ = p;
                (window as unknown as { __E3_UI_SHOT_KEY__: unknown }).__E3_UI_SHOT_KEY__ = key;
                (window as unknown as { __E3_UI_SHOT_DEADLINE__: unknown }).__E3_UI_SHOT_DEADLINE__ = deadline;
                (window as unknown as { __E3_UI_SHOT_FRAME_WIDTH__: unknown }).__E3_UI_SHOT_FRAME_WIDTH__ = frameWidth;
            },
            [opts.payload, storageKey, taskDeadlineMs, opts.frameWidth ?? null] as const,
        );

        // Component mode has no e3 polling, so wait for `networkidle` (catches
        // lazy chunks / Map tiles / chart sizing). Task mode polls the e3 server
        // so the network never idles — use `load` and rely on the readiness marker.
        await page.goto(`${baseUrl}/`, {
            waitUntil: opts.payload.kind === 'task' ? 'load' : 'networkidle',
            timeout,
        });
        await page.evaluate(() => document.fonts.ready);

        // Both modes signal terminal state on #shot-root[data-shot-status]:
        // 'ready' once content has rendered (component: next frame; task: once
        // e3 fetches settle), or 'error' on an East compile/render failure.
        try {
            await page.waitForFunction(
                () => {
                    const s = document.querySelector('#shot-root')?.getAttribute('data-shot-status');
                    return s === 'ready' || s === 'error';
                },
                { timeout, polling: CAPTURE_DEFAULTS.statusPollMs },
            );
        } catch {
            const detail = consoleErrors.length ? `\nBrowser errors:\n  ${consoleErrors.join('\n  ')}` : '';
            throw new Error(
                `Timed out after ${timeout}ms waiting for the render to complete.${detail}\n` +
                `(For a slow live task raise --timeout; otherwise the component may have failed to load.)`,
            );
        }

        // Surface render/compile failures via stable hooks (NOT title-text
        // scraping): data-shot-status='error', [data-east-error] from
        // EastErrorDisplay (component mode), and [data-status="error"] from
        // e3-ui's StatusDisplay / ErrorBoundary (task fetch/decode/render errors).
        const renderError = await page.evaluate((limit) => {
            const root = document.querySelector('#shot-root');
            if (root?.getAttribute('data-shot-status') === 'error') {
                return root.getAttribute('data-shot-error') ?? 'unknown render error';
            }
            const card = document.querySelector('[data-east-error], [data-status="error"]');
            return card ? (card as HTMLElement).innerText.slice(0, limit) : null;
        }, CAPTURE_DEFAULTS.errorTextLimit);
        if (renderError) {
            throw new Error(`Render failed:\n${renderError}`);
        }

        // A live task that hit its hard-stop without settling marks itself partial.
        const partial = await page.evaluate(
            () => document.querySelector('#shot-root')?.getAttribute('data-shot-partial') === 'true',
        );
        if (partial) {
            console.warn('[e3-ui shot] the live task did not finish loading before capture — the image may be incomplete (raise --timeout).');
        }

        // Let in-component skeletons clear, then settle. A component may keep a
        // skeleton legitimately (slow async chart/map) — warn rather than fail,
        // mirroring the in-repo snapshot pipeline.
        await page
            .waitForFunction(() => document.querySelectorAll('.elara-skeleton').length === 0,
                { timeout, polling: CAPTURE_DEFAULTS.skeletonPollMs })
            .catch(() => console.warn('[e3-ui shot] skeletons still present at capture — the image may be premature (raise --wait).'));
        await page.waitForTimeout(settleMs);

        // --debug-layout: after layout settles, outline any element whose
        // content overflows its box. A collapsed / clipped region is otherwise
        // invisible in the shot; the outline lands in both the PNG and (via the
        // added <style>) the --html (#320). Runs after settle so measurements
        // are final.
        if (opts.debugLayout) {
            await page.addStyleTag({ content: '[data-e3-overflow]{outline:2px solid #b85a4a !important;outline-offset:-2px;}' });
            await page.evaluate(() => {
                for (const el of Array.from(document.querySelectorAll('*'))) {
                    const h = el as HTMLElement;
                    // An intentional scroll container (overflow auto/scroll on
                    // the overflowing axis) is healthy — outline only content
                    // that escapes a box which CANNOT scroll to reveal it.
                    const cs = getComputedStyle(h);
                    const xScrolls = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
                    const yScrolls = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
                    const xOverflows = !xScrolls && h.scrollWidth > h.clientWidth + 1;
                    const yOverflows = !yScrolls && h.scrollHeight > h.clientHeight + 1;
                    if (xOverflows || yOverflows) {
                        h.setAttribute('data-e3-overflow', '');
                    }
                }
            });
        }

        if (mode.kind === 'full-page') {
            await page.screenshot({ path: opts.outPng, fullPage: true });
        } else {
            const selector = mode.kind === 'element' ? mode.selector : '#shot-frame';
            const locator = page.locator(selector);
            if (await locator.count() === 0) {
                throw new Error(`No element matches selector "${selector}" to screenshot.`);
            }
            await locator.first().screenshot({ path: opts.outPng });
        }

        if (opts.outHtml) {
            await writeFile(opts.outHtml, await selfContainedHtml(page, appDir), 'utf8');
        }
    } finally {
        await context.close();
    }
}
