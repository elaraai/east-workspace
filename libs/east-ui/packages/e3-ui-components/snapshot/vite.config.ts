/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Vite config for the offline snapshot harness (`snapshot/main.tsx`).
 * Standalone from the package's library build (`vite.config.ts` at the
 * package root) — this one serves a browser app for Playwright to capture.
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
    define: {
        'process.env': {},
        'process.argv': '[]',
    },
    resolve: {
        alias: [
            // The example files `import * as e3 from '@elaraai/e3'` only to
            // call `e3.input(...)`. The full `@elaraai/e3` entry pulls in
            // yazl (→ node stream/events/util), which Vite externalizes and
            // breaks in the browser. Alias to a browser-safe shim exposing
            // just `input` + the `DatasetDef` type. Scoped to this snapshot
            // config — the Node-side showcase emitter is unaffected.
            { find: /^@elaraai\/e3$/, replacement: path.resolve(__dirname, 'e3-shim.ts') },
            // The shared snapshot harness (`scripts/snapshot-app.tsx` at the
            // lib root) imports `@elaraai/east-ui-components`, which is not
            // resolvable from outside a dependent package — map it (and its
            // subpaths) to the SAME dist files this package's own dist
            // resolves through its node_modules symlink, so East's
            // reference-based identities stay single-instance.
            { find: /^@elaraai\/east-ui-components$/, replacement: path.resolve(PKG_ROOT, '../east-ui-components/dist/index.js') },
            { find: /^@elaraai\/east-ui-components\/fonts$/, replacement: path.resolve(PKG_ROOT, '../east-ui-components/dist/fonts.js') },
            { find: /^@elaraai\/east-ui-components\/platform$/, replacement: path.resolve(PKG_ROOT, '../east-ui-components/dist/platform.js') },
        ],
    },
    optimizeDeps: {
        // Bundle `@elaraai/east` and its `/internal` subpath to one module
        // instance — East's reference-based type identity breaks if a type
        // like `OntologyType` is duplicated across import paths. Same for
        // east-ui.
        include: [
            'sorted-btree',
            '@elaraai/east', '@elaraai/east/internal',
            '@elaraai/east-ui', '@elaraai/east-ui/internal',
            '@elaraai/e3-ui',
            'react-dom/client', '@chakra-ui/react',
            '@xyflow/react', 'cytoscape', 'cytoscape-cose-bilkent',
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
