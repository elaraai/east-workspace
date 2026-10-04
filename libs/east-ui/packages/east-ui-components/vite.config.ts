import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

// Library build configuration for @elaraai/east-ui-components
export default defineConfig({
  plugins: [react(), dts()],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        // `@elaraai/east-ui-components/fonts` — side-effect entry that
        // app consumers import to register the self-hosted brand fonts.
        // Kept out of the main entry so Node test runners (no CSS loader)
        // can still import transitively.
        fonts: resolve(__dirname, 'src/fonts.ts'),
        // `@elaraai/east-ui-components/platform` — side-effect-free registry +
        // reactive-tracker plumbing. Split out so pure-logic consumers (the e3
        // `Data.bind` runtime) register implementations without pulling in the
        // component barrel (Chakra, overlays, react-markdown → `document`).
        platform: resolve(__dirname, 'src/platform.ts'),
        // `@elaraai/east-ui-components/internal` — the renderers' shared
        // building blocks, for the sibling renderer packages (e3-ui-components'
        // Plan, #1177). Not an app API.
        internal: resolve(__dirname, 'src/internal.ts'),
        // `@elaraai/east-ui-components/testing` — the renderer tests' DOM
        // helpers (React's `act` and the DOM, no test framework), for the
        // sibling renderer packages' tests.
        testing: resolve(__dirname, 'src/testing.ts'),
      },
      name: 'EastUIReact',
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rollupOptions: {
      external: (id) => [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@chakra-ui/react',
        'shiki',
      ].includes(id) || id.startsWith('node:') || id.startsWith('@elaraai/')
        // Self-hosted brand fonts — leave the `import "@fontsource-variable/*"`
        // statements in the published bundle so each consuming app's Vite/Rollup
        // resolves the .woff2 files in its own asset pipeline (library mode
        // can't ship binary font payloads through esbuild).
        || id.startsWith('@fontsource-variable/'),
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
          '@chakra-ui/react': 'ChakraUI',
        },
      },
    },
    sourcemap: true,
    minify: false,
  },
});
