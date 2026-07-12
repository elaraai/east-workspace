/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Nested-Drawer stack-rail diagnostic (#328): boots the east-ui-showcase, opens
 * the `drawerStackedNested` example, and drills three programmatic drawers deep
 * (B4418 → Decisions → Adjust setpoint). Each nested open must collapse its
 * ancestor to a labeled vertical rail that stays VISIBLE over the active
 * drawer's backdrop (the rail rides inside the active drawer's Positioner, so it
 * inherits the drawer's overlay layer — no hardcoded z-index). Then clicks the
 * "Back to B4418" rail and asserts the stack popped.
 *
 * Output: `dist-examples/drawer-stack-{1_b4418,2_rail,3_two-rails,4_popped}.png`.
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
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
        page.on('pageerror', err => console.log(`[pageerror] ${err.message}`));
        await page.goto(`http://127.0.0.1:${port}/#overlays/drawer/drawerStackedNested`, { waitUntil: 'networkidle', timeout: 60_000 });
        await page.waitForTimeout(2500);

        await page.getByRole('button', { name: 'Open B4418' }).first().click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(OUT_DIR, 'drawer-stack-1_b4418.png') });
        console.log('[probe] wrote drawer-stack-1_b4418.png (B4418 open, no rail yet)');

        // #328 fullscreen persistence — expand B4418 to full, nest two deep, pop
        // back, and confirm it re-mounts STILL fullscreen (the fullscreen flag is
        // lifted to the overlay manager, so it survives the rail unmount/remount).
        await page.getByRole('button', { name: 'Enter fullscreen' }).click();
        await page.waitForTimeout(500);
        const fsWidthBefore = await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('[data-part="content"]')) as HTMLElement[];
            return els.length ? els[els.length - 1]!.getBoundingClientRect().width : -1;
        });
        console.log(`[probe] B4418 fullscreen width=${fsWidthBefore.toFixed(0)} (expect ~1600 viewport)`);

        await page.getByRole('button', { name: 'Open decisions' }).click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(OUT_DIR, 'drawer-stack-2_rail.png') });
        console.log('[probe] wrote drawer-stack-2_rail.png (Decisions active + B4418 rail)');

        await page.getByRole('button', { name: 'Open decision detail' }).click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(OUT_DIR, 'drawer-stack-3_two-rails.png') });
        console.log('[probe] wrote drawer-stack-3_two-rails.png (Adjust setpoint active + B4418 + Decisions rails)');
        // Close-up of the rail↔panel seam: confirms the content's box-shadow no
        // longer bleeds onto the closest rail (would read as a gradient there).
        await page.screenshot({ path: path.join(OUT_DIR, 'drawer-stack-3b_seam.png'), clip: { x: 1150, y: 10, width: 200, height: 480 } });
        console.log('[probe] wrote drawer-stack-3b_seam.png (rail↔panel seam close-up)');

        // Layering proof: the ancestor rail must render at a HIGHER effective
        // stacking than the active drawer's backdrop (it rides inside the active
        // drawer's Positioner, so it inherits the drawer's layer without a
        // hardcoded z-index — the rail's own computed z-index is `auto`).
        const rails = page.locator('button[aria-label^="Back to"]');
        const railCount = await rails.count();
        const railBox = await rails.first().boundingBox();
        const railVisible = await rails.first().isVisible();
        console.log(`[probe] rails present=${railCount}, first visible=${railVisible}, box=${JSON.stringify(railBox)}`);
        // Gap check: the rail spine's right edge vs the active drawer panel's left edge.
        const gap = await page.evaluate(() => {
            const railEls = Array.from(document.querySelectorAll('button[aria-label^="Back to"]')) as HTMLElement[];
            const panels = Array.from(document.querySelectorAll('[data-part="content"]')) as HTMLElement[];
            const panel = panels[panels.length - 1] ?? null;
            if (railEls.length === 0 || !panel) return 'n/a';
            const spineRight = Math.max(...railEls.map(r => r.getBoundingClientRect().right));
            const panelLeft = panel.getBoundingClientRect().left;
            return `spine.right=${spineRight.toFixed(1)}, panel.left=${panelLeft.toFixed(1)}, gap=${(panelLeft - spineRight).toFixed(1)}px`;
        });
        console.log(`[probe] ${gap}`);

        // Click the outermost (B4418) rail → pop the stack back to it.
        await rails.first().click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(OUT_DIR, 'drawer-stack-4_popped.png') });
        const railsLeft = await page.locator('.elara-drawer-stack-rail').count();
        console.log(`[probe] wrote drawer-stack-4_popped.png (popped to B4418 — rails remaining: ${railsLeft}, expect 0)`);

        const fsWidthAfter = await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('[data-part="content"]')) as HTMLElement[];
            return els.length ? els[els.length - 1]!.getBoundingClientRect().width : -1;
        });
        const persisted = fsWidthAfter > 1000;
        console.log(`[probe] B4418 width after nest+pop=${fsWidthAfter.toFixed(0)} — fullscreen ${persisted ? 'PERSISTED ✓' : 'RESET ✗'} (expect ~1600)`);
    } finally {
        await browser.close();
        await server.close();
    }
}

main().catch((err) => { console.error(err); process.exit(1); });
