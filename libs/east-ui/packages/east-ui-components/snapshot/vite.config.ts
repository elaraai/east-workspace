/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Vite config for the east-ui snapshot harness (`snapshot/main.tsx`).
 * Standalone from the package's library build — serves a browser app for
 * Playwright to capture.
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const PKG_ROOT = path.resolve(__dirname, '..');

export default defineConfig({
    root: __dirname,
    plugins: [react()],
    // Resolve the renderer from its source so snapshots reflect uncommitted
    // edits (no dist rebuild between iterations). Regex-anchored so subpaths
    // (`/fonts`) keep their own mapping.
    resolve: {
        alias: [
            { find: /^@elaraai\/east-ui-components$/, replacement: path.resolve(PKG_ROOT, 'src/index.ts') },
            { find: /^@elaraai\/east-ui-components\/fonts$/, replacement: path.resolve(PKG_ROOT, 'src/fonts.ts') },
        ],
    },
    define: {
        'process.env': {},
        'process.argv': '[]',
    },
    optimizeDeps: {
        // Bundle `@elaraai/east` and its `/internal` subpath to one module
        // instance — East's reference-based type identity breaks if a type
        // is duplicated across import paths. Same for east-ui.
        include: [
            'sorted-btree',
            '@elaraai/east', '@elaraai/east/internal',
            '@elaraai/east-ui', '@elaraai/east-ui/internal',
            'react-dom/client', '@chakra-ui/react',
        ],
    },
    build: {
        commonjsOptions: {
            defaultIsModuleExports: true,
            include: [/sorted-btree/, /node_modules/],
        },
        rollupOptions: {
            external: (id: string) => id.startsWith('node:'),
        },
    },
    server: {
        host: '127.0.0.1',
        // pnpm hoists fontsource woff2 payloads to the workspace-root
        // `.pnpm` tree, above the package root. Allow the monorepo root so
        // the brand fonts load over the dev server.
        fs: {
            allow: [path.resolve(PKG_ROOT, '../../../../')],
        },
    },
});
