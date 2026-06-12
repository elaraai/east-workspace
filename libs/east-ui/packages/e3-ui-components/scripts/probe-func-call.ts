/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * End-to-end probe for `Func.bind` in the browser: boots the snapshot
 * harness on the `funcBindCall` example, clicks "Run forecast", and waits
 * for the result to land through the in-memory FunctionApi — proving the
 * platform impl, reactive re-render, and beast2 round-trip work outside
 * node. Writes before/after screenshots.
 *
 * Output: `dist-examples/func-call-{before,after}.png`.
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

async function main(): Promise<void> {
    const server = await createServer({
        root: SNAPSHOT_ROOT,
        configFile: path.join(SNAPSHOT_ROOT, 'vite.config.ts'),
        server: { port: 0, strictPort: false, host: '127.0.0.1' },
        logLevel: 'warn',
    });
    await server.listen();
    const addr = server.httpServer?.address();
    const port = addr && typeof addr === 'object' ? addr.port : 5173;

    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
        page.on('pageerror', err => console.log(`[pageerror] ${err.message}`));
        await page.goto(`http://127.0.0.1:${port}/?file=func/func&example=funcBindCall`, { waitUntil: 'networkidle', timeout: 60_000 });
        await page.waitForFunction(() => document.querySelector('[data-snapshot-boot]') === null, { timeout: 30_000, polling: 100 });
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(OUT_DIR, 'func-call-before.png') });

        await page.getByRole('button', { name: 'Run forecast' }).click();
        // 12 * 1.05 * 100 = 1260 — wait for the decoded result to render.
        await page.waitForFunction(() => document.body.innerText.includes('1260'), { timeout: 15_000, polling: 100 });
        await page.screenshot({ path: path.join(OUT_DIR, 'func-call-after.png') });
        console.log('[probe] RPC round-trip OK — result rendered');
    } finally {
        await browser.close();
        await server.close();
    }
}

main().catch((err) => { console.error(err); process.exit(1); });
