import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync } from 'fs';
import { createRequire } from 'module';

/** Copy east-c-wasm assets to dist if the package is available. */
function copyWasmAssets(): Plugin {
    return {
        name: 'copy-wasm-assets',
        closeBundle() {
            try {
                const require = createRequire(import.meta.url);
                const wasmPath = require.resolve('@elaraai/east-c-wasm/east-c.wasm');
                const gluePath = require.resolve('@elaraai/east-c-wasm/glue');
                const out = resolve(__dirname, '../dist/webview');
                copyFileSync(wasmPath, resolve(out, 'east-c.wasm'));
                copyFileSync(gluePath, resolve(out, 'east-c.js'));
            } catch {
                // east-c-wasm not available — WASM decode will gracefully fall back to TS
            }
        },
    };
}

export default defineConfig({
    plugins: [react(), copyWasmAssets()],
    define: {
        // Replace process.env and process.argv for East compatibility
        'process.env': {},
        'process.argv': '[]',
        // Replace import.meta.url for IIFE compatibility (East uses this for direct execution check)
        'import.meta.url': '""',
    },
    build: {
        outDir: '../dist/webview',
        emptyOutDir: true,
        sourcemap: true,
        minify: false,
        rollupOptions: {
            external: (id: string) =>
                id.startsWith('node:') ||
                id === '@elaraai/east-c-wasm/browser',
            input: resolve(__dirname, 'src/main.tsx'),
            output: {
                entryFileNames: 'index.js',
                chunkFileNames: '[name].js',
                assetFileNames: '[name][extname]',
                // Use IIFE format for webview compatibility (no ES modules)
                format: 'iife',
            },
        },
        // Inline everything for single file output
        assetsInlineLimit: 100000,
        // Don't copy public folder
        copyPublicDir: false,
        // Handle CommonJS modules that use exports.default (like sorted-btree)
        commonjsOptions: {
            defaultIsModuleExports: true,
            include: [/sorted-btree/, /node_modules/],
        },
    },
    optimizeDeps: {
        include: ['sorted-btree', 'react-dom/client', '@chakra-ui/react'],
    },
    // Ensure we can reference assets properly in webview
    base: './',
    resolve: {
        dedupe: ['@elaraai/east', '@elaraai/east-ui', '@elaraai/east-ui-components', '@elaraai/e3-ui-components', '@elaraai/e3-api-client', '@elaraai/e3-types'],
    },
});
