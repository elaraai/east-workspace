/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    // Vite 8 holds a `?inline` import to `server.fs.allow`, and pnpm keeps a
    // dependency's stylesheet (the Flowchart's `@xyflow/react/dist/style.css`)
    // in the workspace root's store, above this package.
    server: {
        fs: {
            allow: [fileURLToPath(new URL("../../../../", import.meta.url))],
        },
    },
    test: {
        globals: true,
        environment: "node",
        include: ["src/**/*.test.{ts,tsx}"],
        // Each test a fresh page's kept state (platform/kept.ts).
        setupFiles: ["./vitest.setup.ts"],
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
