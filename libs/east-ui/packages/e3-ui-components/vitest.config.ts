/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: "node",
        include: ["src/**/*.test.{ts,tsx}"],
        // One realm for bytes in a DOM test, before East loads (#1375): e3-web
        // runs in a test's process, and Node's ports make Node's bytes.
        setupFiles: ["./vitest.setup.ts"],
        // One deadline for every test, well above the slowest. On a hosted
        // runner the heaviest builder tests take 13–24 s (a file's first test
        // also pays its cold import and first render, the Plan's (#1177) all
        // of east-ui-components and e3-ui), and a runner at half speed — a
        // whole shard has taken twice its usual time — doubles that: tests
        // held to 20 s or 30 s failed there, each correct, on the runner's
        // speed alone.
        testTimeout: 60_000,
        // jsdom builder suites import and compile the same large East graph.
        // Bound parallel work, so a test's time is its own work.
        ...(process.env.CI ? { maxWorkers: 2 } : {}),
    },
    define: {
        "process.env": {},
        "process.argv": "[]",
    },
});
