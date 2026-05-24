/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE for details.
 *
 * One-shot: boot the showcase's Vite dev server, navigate Chromium to the
 * main catalog view, capture a viewport screenshot to `/tmp/showcase-chrome.png`.
 * Used to do quick visual checks of the App.tsx chrome — not part of the
 * regular snapshot pipeline.
 */

import { chromium } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = "/tmp/showcase-chrome.png";

async function main(): Promise<void> {
    console.log("[snapshot-chrome] booting vite dev server…");
    const server: ViteDevServer = await createServer({
        root: ROOT,
        server: { port: 0, host: "127.0.0.1", strictPort: false },
        logLevel: "warn",
    });
    await server.listen();
    const addr = server.httpServer?.address();
    const port = server.config.server.port ?? (addr && typeof addr === "object" ? addr.port : 5173);
    const url = `http://127.0.0.1:${port}/east-ui/`;
    console.log(`[snapshot-chrome] ${url}`);

    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
        await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(800);
        await page.screenshot({ path: OUT, fullPage: false });
        console.log(`[snapshot-chrome] wrote ${OUT}`);

        /* Also dump a collapsed-sidebar variant so we can eyeball both. */
        await page.keyboard.press("[");
        await page.waitForTimeout(400);
        await page.screenshot({ path: "/tmp/showcase-chrome-collapsed.png", fullPage: false });
        console.log(`[snapshot-chrome] wrote /tmp/showcase-chrome-collapsed.png`);
    } finally {
        await browser.close();
        await server.close();
    }
}

main().catch(err => { console.error(err); process.exit(1); });
