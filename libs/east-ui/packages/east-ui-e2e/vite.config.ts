/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The harness's page, built against the published `dist/` of the renderers, as the showcase's build is.
 */

import * as path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    root: __dirname,
    plugins: [react()],
    define: {
        "process.env": {},
        "process.argv": "[]",
    },
    resolve: {
        alias: [
            // The full e3 SDK reaches for Node's file and zip modules: the browser takes the snapshot harness's shim,
            // as the showcase's page does. Anchored, so `@elaraai/e3-ui` and the rest pass.
            { find: /^@elaraai\/e3$/, replacement: path.resolve(__dirname, "../e3-ui-components/snapshot/e3-shim.ts") },
        ],
        dedupe: ["react", "react-dom", "@chakra-ui/react"],
    },
    build: {
        rolldownOptions: {
            external: (id: string) => id.startsWith("node:"),
        },
    },
    server: {
        // pnpm keeps the fonts' files at the workspace's root, above the package.
        fs: { allow: [path.resolve(__dirname, "../../../..")] },
    },
});
