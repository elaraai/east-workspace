/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Responsive validation suite (#357, epic #345) — drives the built showcase
 * (every east-ui + e3-ui catalog page) at desktop and mobile viewports.
 *
 * Browser resolution: `npx playwright install chromium` where supported;
 * on hosts Playwright can't provision (e.g. non-LTS Ubuntu) point
 * `PW_EXECUTABLE_PATH` or `E3_UI_CHROMIUM_PATH` at a Chrome/Chromium binary
 * (the same override the e3-ui-cli capture pipeline uses).
 */

import { defineConfig } from "playwright/test";

const executablePath = process.env.PW_EXECUTABLE_PATH ?? process.env.E3_UI_CHROMIUM_PATH;

export default defineConfig({
    testDir: "./tests/responsive",
    timeout: 60_000,
    fullyParallel: true,
    reporter: [["list"]],
    webServer: {
        // Production build — dev-mode HMR/overlay noise excluded.
        command: "pnpm run build && pnpm run preview -- --port 4173 --strictPort",
        port: 4173,
        reuseExistingServer: true,
        timeout: 180_000,
    },
    use: {
        baseURL: "http://localhost:4173",
        ...(executablePath
            ? { launchOptions: { executablePath, args: ["--no-sandbox"] } }
            : {}),
    },
    projects: [
        {
            name: "desktop",
            use: { viewport: { width: 1280, height: 800 } },
        },
        {
            name: "mobile",
            use: {
                viewport: { width: 390, height: 844 },
                isMobile: true,
                hasTouch: true,
                deviceScaleFactor: 2,
            },
        },
        {
            // The tightest mainstream width — interaction smoke only.
            name: "mobile-narrow",
            grep: /@narrow/,
            use: {
                viewport: { width: 360, height: 740 },
                isMobile: true,
                hasTouch: true,
            },
        },
    ],
});
