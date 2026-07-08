/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Expandable takeover diagnostic (issue #246): boots the east-ui-showcase dev
 * server, deep-links to the `layout/expandable` examples in the LIVE DocList
 * route (virtualized rows — the containing-block trap regressed here), clicks
 * the expand control on the State-driven example, and screenshots before /
 * after. The after shot must show the region filling the whole viewport.
 *
 * Output: `dist-examples/expandable-probe-{collapsed,expanded}.png`.
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchChromium } from '../../../scripts/snapshot-capture.mts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const SHOWCASE_ROOT = path.resolve(PKG_ROOT, '../east-ui-showcase');
const OUT_DIR = path.join(PKG_ROOT, 'dist-examples');

async function main(): Promise<void> {
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
        page.on('console', msg => { if (msg.type() === 'warning' && msg.text().includes('<Expandable>')) console.log(`[console.warn] ${msg.text()}`); });
        await page.goto(`http://127.0.0.1:${port}/#layout/expandable/expandableControlled`, { waitUntil: 'networkidle', timeout: 60_000 });
        await page.waitForTimeout(3000);

        const control = page.getByRole('button', { name: 'Expand Throughput chart' });
        await control.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(OUT_DIR, 'expandable-probe-collapsed.png') });
        console.log('[probe] wrote expandable-probe-collapsed.png');

        await control.click();
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(OUT_DIR, 'expandable-probe-expanded.png') });
        console.log('[probe] wrote expandable-probe-expanded.png');

        const box = await page.getByRole('button', { name: 'Collapse Throughput chart' }).boundingBox();
        console.log(`[probe] collapse control at ${JSON.stringify(box)} (viewport 1600x1000 — expect near top-right)`);
    } finally {
        await browser.close();
        await server.close();
    }
}

main().catch((err) => { console.error(err); process.exit(1); });
