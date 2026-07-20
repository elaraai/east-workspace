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
    /* Visual goldens (goldens.spec.ts): committed per-component baselines.
     * Tolerances absorb sub-pixel AA drift; animations are frozen and the
     * caret hidden for determinism. */
    snapshotPathTemplate: "{testDir}/__goldens__/{projectName}/{arg}{ext}",
    expect: {
        toHaveScreenshot: {
            animations: "disabled",
            caret: "hide",
            maxDiffPixelRatio: 0.002,
        },
    },
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
            /* Dark-mode goldens (#362): the same catalog sweep with the
             * showcase forced dark via `?theme=dark` (class-based Chakra v3
             * colour mode — see theme-mode.ts). `colorScheme` keeps native
             * chrome (scrollbars, form controls) consistent with the page. */
            name: "dark",
            // Goldens only: the catalog/shell behaviour sweeps are
            // colour-mode-independent (and shell.spec keys "mobile" off the
            // project name).
            testMatch: /goldens\.spec\.ts/,
            use: { viewport: { width: 1280, height: 800 }, colorScheme: "dark" },
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
