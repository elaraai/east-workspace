import * as path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { exampleSourcesPlugin } from './scripts/vite-plugin-example-sources';

export default defineConfig({
  plugins: [
    react(),
    exampleSourcesPlugin({
      include: '**/*.examples.ts',
      cwd: path.resolve(__dirname, '../east-ui/test'),
    }),
  ],
  base: '/east-ui/',
  define: {
    'process.env': {},
    'process.argv': '[]',
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
    include: ['sorted-btree', '@elaraai/east', '@elaraai/east/internal', '@elaraai/east-ui', '@elaraai/east-ui/internal', 'react-dom/client', '@chakra-ui/react'],
  },
  server: {
    port: 3000,
    host: true,
  },
});
