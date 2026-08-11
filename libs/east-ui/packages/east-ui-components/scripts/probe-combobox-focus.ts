/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Combobox focus-state diagnostic: boots the east-ui-showcase dev server,
 * deep-links to the `forms/combobox` examples, focuses the first combobox
 * input, and screenshots before / after. The focused shot must show ONE
 * field ring on the control shell — the merged Chakra default's outline
 * variant puts a border + inside focus ring on the INNER input (default
 * variant styles beat custom base), which reads as a boxed text area
 * inside the field unless the custom recipe restates the variant.
 *
 * Output: `dist-examples/combobox-probe-{blurred,focused}.png`.
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
        const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
        page.on('pageerror', err => console.log(`[pageerror] ${err.message}`));
        await page.goto(`http://127.0.0.1:${port}/#forms/combobox/comboboxBasic`, { waitUntil: 'networkidle', timeout: 60_000 });
        await page.waitForTimeout(3000);

        const input = page.getByPlaceholder('Search countries...').first();
        await input.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(OUT_DIR, 'combobox-probe-blurred.png') });
        console.log('[probe] wrote combobox-probe-blurred.png');

        await input.focus();
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(OUT_DIR, 'combobox-probe-focused.png') });
        console.log('[probe] wrote combobox-probe-focused.png');
    } finally {
        await browser.close();
        await server.close();
    }
}

main().catch((err) => { console.error(err); process.exit(1); });
