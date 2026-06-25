/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Vite config for the prebuilt `e3-ui shot` browser app. Bundled ONCE at the
 * CLI's build time into `dist/app`; the CLI ships and serves that static
 * output. The component to render is injected as data at runtime — there is no
 * Vite at runtime.
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const APP_ROOT = __dirname;

export default defineConfig({
    root: APP_ROOT,
    // Relative asset URLs so the bundle is position-independent when served.
    base: './',
    plugins: [react()],
    define: {
        'process.env': {},
        'process.argv': '[]',
    },
    resolve: {
        // East's reference-based type identity breaks if `@elaraai/east` (or
        // east-ui / e3-ui) is duplicated across import paths — force a single
        // instance, and dedupe React for hook identity.
        dedupe: [
            '@elaraai/east', '@elaraai/east/internal',
            '@elaraai/east-ui', '@elaraai/east-ui/internal',
            '@elaraai/e3-ui',
            'react', 'react-dom',
        ],
    },
    build: {
        outDir: path.resolve(APP_ROOT, '../dist/app'),
        emptyOutDir: true,
        commonjsOptions: {
            defaultIsModuleExports: true,
            include: [/sorted-btree/, /node_modules/],
        },
        rollupOptions: {
            external: (id: string) => id.startsWith('node:'),
        },
    },
});
