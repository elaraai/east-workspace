import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';
import { createRequire } from 'module';

/**
 * Copy east-c-wasm assets into `public/` so they're served by Vite in both
 * dev (as static assets) and production builds (auto-copied to `dist/`).
 *
 * The WASM module is used by `decodeBeast2Value` (state blob decoding) when
 * available; falls back to the TypeScript decoder if absent.
 */
function copyWasmAssets(): Plugin {
    return {
        name: 'copy-wasm-assets',
        buildStart() {
            try {
                const require = createRequire(import.meta.url);
                const wasmPath = require.resolve('@elaraai/east-c-wasm/east-c.wasm');
                const gluePath = require.resolve('@elaraai/east-c-wasm/glue');
                const out = resolve(__dirname, 'public');
                mkdirSync(out, { recursive: true });
                copyFileSync(wasmPath, resolve(out, 'east-c.wasm'));
                copyFileSync(gluePath, resolve(out, 'east-c.js'));
            } catch {
                // east-c-wasm not available — decoders will gracefully fall back to TS
            }
        },
    };
}

export default defineConfig({
  plugins: [react(), copyWasmAssets()],
  // Base path for GitHub Pages deployment
  base: '/east-ui/',
  define: {
    'process.env': {},
    'process.argv': '[]',
  },
  build: {
    // Handle CommonJS modules that use exports.default (like sorted-btree)
    commonjsOptions: {
      defaultIsModuleExports: true,
      include: [/sorted-btree/, /node_modules/],
    },
    rollupOptions: {
      external: (id: string) =>
        id.startsWith('node:') ||
        id === '@elaraai/east-c-wasm/browser',
    },
  },
  optimizeDeps: {
    // Include `@elaraai/east/internal` alongside `@elaraai/east` so both subpaths
    // bundle to the same module instance — otherwise types like
    // `DateTimeFormatTokenType` get duplicated across imports and East's
    // reference-based type-identity comparison fails at compile time.
    include: ['sorted-btree', '@elaraai/east', '@elaraai/east/internal', '@elaraai/east-ui', '@elaraai/east-ui/internal', 'react-dom/client', '@chakra-ui/react'],
  },
  server: {
    port: 3000,
    host: true,
  },
});
