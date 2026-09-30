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
        // A file's first test pays the file's cold import and first render; with
        // every suite running at once on a CI runner that alone passes 5s.
        testTimeout: 20_000,
        coverage: {
            provider: "v8",
            include: ["src/**/*.{ts,tsx}"],
            exclude: ["src/**/*.test.{ts,tsx}", "src/**/index.ts"],
        },
    },
    define: {
        "process.env": {},
        "process.argv": "[]",
    },
});
