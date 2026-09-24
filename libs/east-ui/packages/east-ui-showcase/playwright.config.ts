/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The responsive suite (#357, #833): DOM specs over the BUILT showcase.
 * They cover every east-ui and e3-ui catalog page, the shell, the code
 * reference, the Plan's geometry and the load, at desktop and mobile
 * viewports. It is one suite, run the same way everywhere:
 * `make test-responsive` (libs/east-ui) locally, and in CI sharded with
 * `SHARD=n/4`. Nothing here compares pixels.
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
    // A spec that is not deterministic under load is fixed, never retried.
    retries: 0,
    // A committed `test.only` would quietly shrink the CI run to one test.
    forbidOnly: !!process.env.CI,
    reporter: [["list"]],
    webServer: {
        // The production build `make build` made; dev-mode HMR and overlay
        // noise are excluded. `make test-responsive` builds it only when it
        // is missing, and a server already on the port is reused.
        command: "pnpm exec vite preview --port 4173 --strictPort",
        port: 4173,
        reuseExistingServer: true,
        timeout: 60_000,
    },
    use: {
        baseURL: "http://localhost:4173",
        // A failing spec leaves its screenshot and trace in test-results/,
        // which CI uploads.
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
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
