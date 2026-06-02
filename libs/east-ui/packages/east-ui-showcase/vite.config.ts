import * as path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { exampleSourcesPlugin } from './scripts/vite-plugin-example-sources';

export default defineConfig(({ command }) => {
  /* Dev server (`command === 'serve'`) resolves the renderer from its
   * TypeScript source, so launching needs no prebuilt `dist/` and component
   * / theme edits hot-reload. `vite build` (Pages deploy via
   * `make build-showcase`) is left untouched — it resolves the published
   * `dist/` through the package `exports`, exactly as before. The IR
   * (`@elaraai/east-ui` + `/internal`) stays a pre-bundled dep so its
   * single-module-instance identity (see optimizeDeps below) is preserved. */
  const dev = command === 'serve';

  return {
    plugins: [
      react(),
      exampleSourcesPlugin({
        testDir: path.resolve(__dirname, '../east-ui/test'),
      }),
    ],
    base: '/east-workspace/',
    define: {
      'process.env': {},
      'process.argv': '[]',
    },
    resolve: dev
      ? {
          /* Regex-anchored ($) so the base-specifier alias does not also
           * swallow subpaths — `@elaraai/east-ui-components/fonts` must reach
           * its own source entry, not `…/src/index.ts/fonts`. */
          alias: [
            {
              find: /^@elaraai\/east-ui-components$/,
              replacement: path.resolve(__dirname, '../east-ui-components/src/index.ts'),
            },
            {
              find: /^@elaraai\/east-ui-components\/fonts$/,
              replacement: path.resolve(__dirname, '../east-ui-components/src/fonts.ts'),
            },
            /* east-ui (the IR layer) also from source so dev never serves a
             * stale `dist` — adding an IR field (e.g. a Gantt status) shows up
             * live without rebuilding. Anchored ($) so subpaths
             * (…/internal, …/…examples) still resolve through package exports. */
            {
              find: /^@elaraai\/east-ui$/,
              replacement: path.resolve(__dirname, '../east-ui/src/index.ts'),
            },
          ],
          /* The renderer source joins the app module graph across the pnpm
           * symlink boundary — pin one React copy so hooks don't duplicate. */
          dedupe: ['react', 'react-dom', '@chakra-ui/react'],
        }
      : {},
    build: {
      commonjsOptions: {
        defaultIsModuleExports: true,
        include: [/sorted-btree/, /node_modules/],
      },
      rollupOptions: {
        external: (id: string) => id.startsWith('node:'),
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
      /* pnpm hoists fontsource woff2 payloads to the workspace-root
       * `node_modules/.pnpm/...` tree, which sits above the package root.
       * Vite's fs.allow check rejects that path by default — extend to the
       * monorepo root so the brand fonts load over the dev server. */
      fs: {
        allow: [path.resolve(__dirname, '../../../../')],
      },
    },
  };
});
