/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Scroll probe for the Story component: boots the snapshot dev server on
 * `?file=disclosure/story&example=<name>` (live React — the scroll driver
 * runs), scrolls the story's internal scrollport to several positions, and
 * screenshots the story element at each — so the mid-scroll stacking
 * behaviour (sticky chrome / stage vs prose rail) is inspectable from PNGs.
 *
 * CLI flags:
 *   --example=<name>   which example to probe (default storyStacked)
 *
 * Output: `dist-examples/story-scroll-<example>-<pct>.png`.
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_ROOT = path.join(PKG_ROOT, 'snapshot');
const OUT_DIR = path.join(PKG_ROOT, 'dist-examples');

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
        optimizeDeps: { force: true },
    });
    await server.listen();
    const addr = server.httpServer?.address();
    const port = addr && typeof addr === 'object' ? addr.port : 5173;

    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.goto(`http://127.0.0.1:${port}/?file=disclosure/story&example=${exampleName}`, { waitUntil: 'networkidle', timeout: 30_000 });
        await page.waitForTimeout(500);
        await page.reload({ waitUntil: 'networkidle', timeout: 30_000 });
        await page.waitForFunction(() => document.querySelector('[data-snapshot-boot]') === null, { timeout: 25_000, polling: 100 });
        await page.waitForFunction(() => document.querySelectorAll('.elara-skeleton').length === 0, { timeout: 25_000, polling: 200 });
        await page.waitForTimeout(600);

        const story = page.locator('[data-scope="story"]').first();
        if (await story.count() === 0) { console.error('[probe] no [data-scope="story"] on page'); process.exit(2); }
        await story.scrollIntoViewIfNeeded();

        for (const pct of [0, 35, 65, 100]) {
            await story.evaluate((el, p) => {
                el.scrollTop = (el.scrollHeight - el.clientHeight) * (p / 100);
            }, pct);
            await page.waitForTimeout(700);
            const out = path.join(OUT_DIR, `story-scroll-${exampleName}-${String(pct).padStart(3, '0')}.png`);
            await story.screenshot({ path: out });
            console.log(`[probe] wrote ${out}`);
        }
    } finally {
        await browser.close();
        await server.close();
    }
}

main().catch((err) => { console.error(err); process.exit(1); });
