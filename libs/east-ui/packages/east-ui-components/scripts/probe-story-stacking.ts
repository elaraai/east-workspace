/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * One-shot stacking diagnostic for the Story renderer: boots the snapshot
 * dev server on `?file=disclosure/story&example=<name>`, scrolls the story
 * scrollport, and dumps computed position / z-index / background for the
 * chrome row, stage, and rail plus hit-test results at the stage's centre —
 * so sticky-stacking regressions are diagnosable without screenshots.
 *
 * CLI flags:
 *   --example=<name>   which example to probe (default storyStacked)
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from "../../../scripts/snapshot-capture.mts";
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_ROOT = path.join(PKG_ROOT, 'snapshot');

function parseArg(name: string, fallback: string): string {
    for (const arg of process.argv.slice(2)) {
        const m = new RegExp(`^--${name}=(.+)$`).exec(arg);
        if (m) return m[1];
    }
    return fallback;
}

async function main(): Promise<void> {
    const exampleName = parseArg('example', 'storyStacked');
    const server = await createServer({
        root: SNAPSHOT_ROOT,
        configFile: path.join(SNAPSHOT_ROOT, 'vite.config.ts'),
        server: { port: 0, strictPort: false, host: '127.0.0.1' },
        logLevel: 'warn',
    });
    await server.listen();
    const addr = server.httpServer?.address();
    const port = addr && typeof addr === 'object' ? addr.port : 5173;

    const browser = await launchChromium({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.goto(`http://127.0.0.1:${port}/?file=disclosure/story&example=${exampleName}`, { waitUntil: 'networkidle', timeout: 30_000 });
        await page.waitForFunction(() => document.querySelector('[data-snapshot-boot]') === null, { timeout: 25_000, polling: 100 });
        await page.waitForFunction(() => document.querySelectorAll('.elara-skeleton').length === 0, { timeout: 25_000, polling: 200 });
        await page.waitForTimeout(600);

        const story = page.locator('[data-scope="story"]').first();
        await story.scrollIntoViewIfNeeded();
        await story.evaluate(el => { el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.5; });
        await page.waitForTimeout(500);

        // tsx's esbuild keepNames transform injects `__name` calls into
        // serialized closures; give the page a no-op implementation.
        await page.evaluate('void (globalThis.__name = (fn) => fn)');
        const report = await story.evaluate((root) => {
            const pick = (el: Element | null) => {
                if (!el) return null;
                const cs = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return {
                    position: cs.position, zIndex: cs.zIndex, background: cs.backgroundColor,
                    top: cs.top, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                };
            };
            const stage = root.querySelector('[data-scope="story-stage"]');
            const rail = root.querySelector('[data-scope="story-rail"]');
            const chrome = root.querySelector('[data-scope="story-chrome"]') ?? root.firstElementChild;
            const sr = stage ? stage.getBoundingClientRect() : null;
            const hits = sr
                ? document.elementsFromPoint(sr.x + sr.width / 2, sr.y + sr.height / 2).slice(0, 6).map((el) => {
                    const cs = getComputedStyle(el);
                    const tag = el.getAttribute('data-scope') ?? el.getAttribute('data-story-step') ?? el.className.toString().slice(0, 40);
                    return el.tagName.toLowerCase() + '[' + tag + '] z=' + cs.zIndex + ' pos=' + cs.position;
                })
                : [];
            const steps = Array.from(root.querySelectorAll('[data-story-step]')).map((el) => {
                const r = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                return el.getAttribute('data-story-step') + ' y=' + Math.round(r.y) + ' h=' + Math.round(r.height)
                    + ' state=' + el.getAttribute('data-state') + ' opacity=' + cs.opacity + ' z=' + cs.zIndex;
            });
            return { chrome: pick(chrome), stage: pick(stage), rail: pick(rail), hitsAtStageCentre: hits, steps };
        });
        console.log(JSON.stringify(report, null, 2));
    } finally {
        await browser.close();
        await server.close();
    }
}

main().catch((err) => { console.error(err); process.exit(1); });
