import { defineConfig, esmExternalRequirePlugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Library build configuration for @elaraai/e3-ui-components: the package's
// entry, and `query` — a query's calls without the builder, which imports no
// React and no renderer, so it loads in Node (`src/query/calls.ts`).
export default defineConfig({
  // A CommonJS dependency bundled here requires React (`__require("react")`), which
  // Rolldown leaves as a `require` in the ES output, where Node and a browser have
  // none: the plugin makes each such `require` of an external an import. These are
  // external through it alone: named in `external` as well, it never sees them.
  plugins: [react(), esmExternalRequirePlugin({ external: ['react', 'react-dom', 'react/jsx-runtime', '@chakra-ui/react'] })],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        query: resolve(__dirname, 'src/query/calls.ts'),
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rolldownOptions: {
      external: (id) => [
        // The locale's context, as React's and Chakra's: one for every
        // renderer package — bundled here, the Plan would read a context of
        // its own, which the host's `I18nProvider` never sets.
        '@react-aria/i18n',
        // Emotion's cache, for the same reason: the one Chakra's elements use.
        '@emotion/react',
        '@elaraai/e3-api-client',
        '@elaraai/e3-types',
        '@elaraai/e3-ui',
        '@elaraai/east',
        '@elaraai/east/internal',
        '@elaraai/east-ui',
        '@elaraai/east-ui-components',
        '@tanstack/react-query',
        '@tanstack/react-virtual',
      ].includes(id) || id.startsWith('node:') || id.startsWith('@elaraai/'),
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
