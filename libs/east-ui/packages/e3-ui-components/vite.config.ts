import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

// Library build configuration for @elaraai/e3-ui-components: the package's
// entry, and `query` — a query's calls without the builder, which imports no
// React and no renderer, so it loads in Node (`src/query/calls.ts`).
export default defineConfig({
  plugins: [react(), dts()],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        query: resolve(__dirname, 'src/query/calls.ts'),
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rollupOptions: {
      external: (id) => [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@chakra-ui/react',
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
