/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Showcase deep-link diagnostic: boots the east-ui-showcase dev server,
 * navigates to `#<pathKey>/<example>`, and reports which example anchors are
 * mounted in the virtualized list plus the viewport-top entry — then writes
 * a viewport screenshot. Verifies the hash-scroll wiring end to end.
 *
 * CLI flags:
 *   --hash=<hash>   the location hash to test (default disclosure/story/storyBasic)
 *
 * Output: `dist-examples/deeplink-probe.png`.
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from "../../../scripts/snapshot-capture.mts";
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
    const hash = parseArg('hash', 'disclosure/story/storyBasic');
    const server = await createServer({
        root: SHOWCASE_ROOT,
        configFile: path.join(SHOWCASE_ROOT, 'vite.config.ts'),
        server: { port: 0, strictPort: false, host: '127.0.0.1' },
        logLevel: 'warn',
    });
    await server.listen();
    const addr = server.httpServer?.address();
    const port = addr && typeof addr === 'object' ? addr.port : 5173;

    const browser = await launchChromium({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        page.on('pageerror', err => console.log(`[pageerror] ${err.message}`));
        await page.goto(`http://127.0.0.1:${port}/#${hash}`, { waitUntil: 'networkidle', timeout: 60_000 });
        await page.waitForTimeout(4000);
        await page.evaluate('void (globalThis.__name = (fn) => fn)');
        const report = await page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a[href^="#"]'))
                .map((a) => a.getAttribute('href'))
                .filter((h) => h && h.split('/').length >= 3);
            const topEl = document.elementFromPoint(800, 200);
            return {
                hash: window.location.hash,
                mountedExampleAnchors: anchors.slice(0, 30),
                viewportTopElement: topEl ? topEl.tagName + '.' + String(topEl.className).slice(0, 60) : null,
            };
        });
        console.log(JSON.stringify(report, null, 2));
        await page.screenshot({ path: path.join(OUT_DIR, 'deeplink-probe.png') });
        console.log('[probe] wrote deeplink-probe.png');
    } finally {
        await browser.close();
        await server.close();
    }
}

main().catch((err) => { console.error(err); process.exit(1); });
