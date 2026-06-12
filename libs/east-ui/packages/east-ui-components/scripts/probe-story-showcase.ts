/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Story-in-showcase scroll probe: boots the east-ui-showcase dev server,
 * deep-links to `#disclosure/story/<example>`, scrolls the story's internal
 * scrollport, and screenshots the story element at several positions — the
 * showcase's virtualized DocList wraps examples in transformed ancestors,
 * so sticky/stacking behaviour can differ from the snapshot harness.
 *
 * CLI flags:
 *   --example=<name>   which example to probe (default storyStacked)
 *
 * Output: `dist-examples/story-showcase-<example>-<pct>.png`.
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const SHOWCASE_ROOT = path.resolve(PKG_ROOT, '../east-ui-showcase');
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
        root: SHOWCASE_ROOT,
        configFile: path.join(SHOWCASE_ROOT, 'vite.config.ts'),
        server: { port: 0, strictPort: false, host: '127.0.0.1' },
        logLevel: 'warn',
    });
    await server.listen();
    const addr = server.httpServer?.address();
    const port = addr && typeof addr === 'object' ? addr.port : 5173;

    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        await page.goto(`http://127.0.0.1:${port}/#disclosure/story/${exampleName}`, { waitUntil: 'networkidle', timeout: 60_000 });
        await page.waitForTimeout(1000);
        await page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
        await page.waitForFunction(() => document.querySelectorAll('.elara-skeleton').length === 0, { timeout: 30_000, polling: 200 });
        await page.waitForTimeout(1500);

        // Anchor on the example's deep-link <a>, then take the story root
        // inside the same entry block (the anchor's section ancestor).
        const anchor = page.locator(`a[href="#disclosure/story/${exampleName}"]`).first();
        await anchor.waitFor({ state: "visible", timeout: 60_000 });
        await anchor.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        const story = page.locator(`a[href="#disclosure/story/${exampleName}"]`)
            .locator('xpath=ancestor::*[.//div[@data-scope="story"]][1]//div[@data-scope="story"]')
            .first();
        if (await story.count() === 0) { console.error('[probe] no story near the deep-link anchor'); process.exit(2); }
        await story.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);

        for (const pct of [0, 35, 65, 100]) {
            await story.evaluate((el, p) => {
                el.scrollTop = (el.scrollHeight - el.clientHeight) * (p / 100);
            }, pct);
            await page.waitForTimeout(700);
            const out = path.join(OUT_DIR, `story-showcase-${exampleName}-${String(pct).padStart(3, '0')}.png`);
            await story.screenshot({ path: out });
            console.log(`[probe] wrote ${out}`);
        }
    } finally {
        await browser.close();
        await server.close();
    }
}

main().catch((err) => { console.error(err); process.exit(1); });
