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
        e3TestDir: path.resolve(__dirname, '../e3-ui/test'),
        rootDir: __dirname,
      }),
      /* The e3 dataset cache (`main.tsx#seedE3DatasetCache`) is seeded ONCE per
       * document load: each example's `e3.input` default is beast2-encoded against
       * that input's East *type* at seed time. Editing an `e3-ui` IR type (e.g.
       * adding a `Config` field) or an e3 example input changes that type — but the
       * seed never re-runs on a hot update, so React Fast Refresh hot-swaps the
       * renderer (now decoding against the NEW type) over bytes the cache still holds
       * encoded against the OLD one. The mismatch surfaces as a decode failure
       * ("Buffer underflow reading varint at offset N"). `e3-ui` is pure IR (no React
       * component to Fast-Refresh), so force a full reload for its source + the e3
       * example files — the seed then re-runs in lockstep with the types. The React
       * renderer (`e3-ui-components`) keeps Fast Refresh. */
      {
        name: 'showcase:e3-seed-full-reload',
        apply: 'serve',
        handleHotUpdate({ file, server }) {
          const p = file.replace(/\\/g, '/');
          if (/\/e3-ui\/src\/.+\.tsx?$/.test(p) || /\/e3-ui\/test\/.+\.examples\.tsx?$/.test(p)) {
            server.ws.send({ type: 'full-reload' });
            return [];
          }
          return undefined;
        },
      },
    ],
    base: '/',
    define: {
      'process.env': {},
      'process.argv': '[]',
    },
    resolve: {
      alias: [
        /* The e3 example files `import * as e3 from '@elaraai/e3'` only to
         * call `e3.input(...)`. The full `@elaraai/e3` entry pulls in yazl
         * (→ node stream/events/util), which breaks in the browser — alias
         * to the snapshot harness's browser-safe shim in dev AND build.
         * Anchored ($) so `@elaraai/e3-ui` / `@elaraai/e3-types` pass. */
        {
          find: /^@elaraai\/e3$/,
          replacement: path.resolve(__dirname, '../e3-ui-components/snapshot/e3-shim.ts'),
        },
        /* Dev server (`command === 'serve'`) resolves the renderers and IR
         * layers from TypeScript source so edits hot-reload; `vite build`
         * resolves the published `dist/` through package exports.
         * Regex-anchored ($) so the base-specifier alias does not also
         * swallow subpaths — `@elaraai/east-ui-components/fonts` must reach
         * its own source entry, not `…/src/index.ts/fonts`. */
        ...(dev
          ? [
              {
                find: /^@elaraai\/east-ui-components$/,
                replacement: path.resolve(__dirname, '../east-ui-components/src/index.ts'),
              },
              {
                find: /^@elaraai\/east-ui-components\/fonts$/,
                replacement: path.resolve(__dirname, '../east-ui-components/src/fonts.ts'),
              },
              /* e3-ui-components' bind-runtime registers its platform impl
               * through this subpath — it must hit the same source registry
               * instance EastFunction reads, not a second dist copy. */
              {
                find: /^@elaraai\/east-ui-components\/platform$/,
                replacement: path.resolve(__dirname, '../east-ui-components/src/platform.ts'),
              },
              {
                find: /^@elaraai\/east-ui$/,
                replacement: path.resolve(__dirname, '../east-ui/src/index.ts'),
              },
              {
                find: /^@elaraai\/e3-ui-components$/,
                replacement: path.resolve(__dirname, '../e3-ui-components/src/index.ts'),
              },
              {
                find: /^@elaraai\/e3-ui$/,
                replacement: path.resolve(__dirname, '../e3-ui/src/index.ts'),
              },
              /* e3-ui-components reaches the IR through this subpath; the
               * example files use the bare specifier. Both must resolve to
               * the same source instance or East's reference-based type /
               * platform-declaration identity splits and `Data.bind` IR
               * stops matching its registered implementation. */
              {
                find: /^@elaraai\/e3-ui\/internal$/,
                replacement: path.resolve(__dirname, '../e3-ui/src/internal.ts'),
              },
            ]
          : []),
      ],
      /* The renderer source joins the app module graph across the pnpm
       * symlink boundary — pin one React copy so hooks don't duplicate. */
      ...(dev ? { dedupe: ['react', 'react-dom', '@chakra-ui/react'] } : {}),
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
    optimizeDeps: {
      // Include `@elaraai/east/internal` alongside `@elaraai/east` so both subpaths
      // bundle to the same module instance — otherwise types like
      // `DateTimeFormatTokenType` get duplicated across imports and East's
      // reference-based type-identity comparison fails at compile time.
      include: [
        'sorted-btree',
        '@elaraai/east', '@elaraai/east/internal',
        '@elaraai/east-ui', '@elaraai/east-ui/internal',
        // Both subpaths MUST be pre-bundled together (like east / east-ui above), or
        // the bare specifier (the example's `Experiment.Types.*`) and `/internal` (the
        // renderer's binding types) split into two type versions — a field added to a
        // type then mismatches encode vs decode ("buffer underflow reading varint").
        '@elaraai/e3-ui', '@elaraai/e3-ui/internal',
        'react-dom/client', '@chakra-ui/react',
        '@xyflow/react', 'cytoscape', 'cytoscape-cose-bilkent',
      ],
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
